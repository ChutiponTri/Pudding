import { randomUUID } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { pushLineGroupText } from '@/lib/line/messaging';
import { withLiffLink } from '@/lib/line/liffLink';
import { classroomTitle } from '@/lib/utils/classroomLabel';
import { getActor, type Actor } from '@/lib/auth/actor';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { classroomRole, HttpError, isTeacherOf } from '@/lib/server/access';
import { resolveProxyStudent, type ProxyStudent } from '@/lib/server/proxyStudent';
import type { Classroom } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AttendanceStatus = 'on_time' | 'late' | 'absent' | 'excused';

type AttendanceSession = {
  id: string;
  classroom_id: string;
  title: string;
  starts_at: string;
  on_time_until_minutes: number;
  late_until_minutes: number;
  status: 'scheduled' | 'open' | 'closed';
  closed_at?: string | null;
  created_by: string;
  created_at: string;
};

type RosterEntry = { id?: string; line_uid?: string; student_id?: string; first_name?: string; last_name?: string };

/** The caller and the classroom, if the caller is a teacher of it. */
async function getTeacherContext(actor: Actor | null, classroomId: string) {
  const supabase = createServiceSupabaseClient();
  if (actor?.kind !== 'teacher') return { userId: null, supabase, classroom: null };
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id, name, teacher_id, teachers, line_group_id, invite_code')
    .eq('id', classroomId)
    .maybeSingle();
  return { userId: actor.userId, supabase, classroom: classroom && isTeacherOf(classroom, actor.userId) ? classroom : null };
}

/** Pages with this classroom open refresh attendance once (after the response). */
const signalAttendance = (classroomId: string) => after(() => signalClassroom(classroomId, { type: 'attendance' }));

/** users.id for a LINE uid (attendance_records.student_id references users.id). */
async function resolveUserId(supabase: ReturnType<typeof createServiceSupabaseClient>, lineUid: string) {
  const { data } = await supabase.from('users').select('id').eq('line_uid', lineUid).maybeSingle();
  return data?.id || lineUid;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const classroomId = params.get('classroomId');
  const sessionId = params.get('sessionId');
  const requestedIds = (params.get('classroomIds') || '').split(',').map((id) => id.trim()).filter(Boolean);
  const supabase = createServiceSupabaseClient();
  const actor = await getActor(request);

  // Student overview: sessions + this student's records for many classrooms in
  // one request (the LIFF home screen). Only classrooms they belong to.
  if (!classroomId && requestedIds.length > 0 && actor?.kind === 'student') {
    const { data: rows } = await supabase.from('classrooms').select('*').in('id', requestedIds);
    const roles = await Promise.all(((rows || []) as Classroom[]).map((c) => classroomRole(supabase, actor, c)));
    const classroomIds = ((rows || []) as Classroom[]).filter((_, i) => roles[i]).map((c) => c.id);
    if (!classroomIds.length) return NextResponse.json({ byClassroom: {} });
    const [sessionsRes, recordsRes] = await Promise.all([
      supabase.from('attendance_sessions').select('*').in('classroom_id', classroomIds).order('starts_at', { ascending: false }),
      supabase.from('attendance_records').select('*').in('classroom_id', classroomIds).in('student_id', actor.keys),
    ]);
    const byClassroom: Record<string, { sessions: unknown[]; records: unknown[] }> = {};
    for (const id of classroomIds) {
      byClassroom[id] = {
        sessions: (sessionsRes.data || []).filter((s) => s.classroom_id === id),
        records: (recordsRes.data || []).filter((r) => r.classroom_id === id),
      };
    }
    return NextResponse.json({ byClassroom });
  }

  if (!classroomId) return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });

  // Builders mutate on .eq(), so each query gets a fresh one.
  const sessionsQuery = () =>
    supabase.from('attendance_sessions').select('*').eq('classroom_id', classroomId).order('starts_at', { ascending: false });
  const sessionQuery = sessionId ? sessionsQuery().eq('id', sessionId) : sessionsQuery();

  const context = await getTeacherContext(actor, classroomId);

  // Student perspective: their own records only, in a classroom they belong to.
  if (!context.classroom && actor?.kind === 'student') {
    const { data: classroomRow } = await supabase.from('classrooms').select('*').eq('id', classroomId).maybeSingle();
    if (!classroomRow || !(await classroomRole(supabase, actor, classroomRow as Classroom))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const [{ data: sessions }, { data: records }] = await Promise.all([
      sessionQuery,
      supabase.from('attendance_records').select('*').eq('classroom_id', classroomId).in('student_id', actor.keys),
    ]);
    return NextResponse.json({ sessions: sessions || [], session: sessions?.[0] || null, records: records || [] });
  }

  if (!context.classroom) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Teachers always get every session; `sessionId` only picks which one's
  // records to return (filtering the list made other classes vanish).
  // `allRecords=1` returns every session's records in the same round trip so
  // the workspace can switch sessions without another request.
  const allRecords = params.get('allRecords') === '1';
  const [{ data: sessions, error }, allRecordsRes] = await Promise.all([
    sessionsQuery(),
    allRecords ? supabase.from('attendance_records').select('*').eq('classroom_id', classroomId) : Promise.resolve(null),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const selectedSession = (sessionId ? sessions?.find((s) => s.id === sessionId) : sessions?.[0]) || null;
  let records: unknown[] = [];
  if (allRecordsRes) {
    records = allRecordsRes.data || [];
  } else if (selectedSession) {
    const { data } = await supabase.from('attendance_records').select('*').eq('session_id', selectedSession.id);
    records = data || [];
  }
  return NextResponse.json({ sessions: sessions || [], session: selectedSession, records });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const classroomId = typeof body.classroomId === 'string' ? body.classroomId : '';
  const action = body.action || 'create';
  if (!classroomId) return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
  const actor = await getActor(request);

  // ----------------------------------------------------
  // STUDENT SELF CHECK-IN
  // ----------------------------------------------------
  if (action === 'check_in') {
    // The student is whoever LINE says the token belongs to, never an id from the body.
    if (actor?.kind !== 'student') return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบผ่าน LINE' }, { status: 401 });
    const lineUid = actor.lineUid;
    const studentId = actor.userId;
    const targetSessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';

    const sb = createServiceSupabaseClient();
    // The session must belong to this classroom.
    const sessionQuery = targetSessionId
      ? sb.from('attendance_sessions').select('*').eq('id', targetSessionId).eq('classroom_id', classroomId).maybeSingle()
      : sb.from('attendance_sessions').select('*').eq('classroom_id', classroomId).eq('status', 'open').order('starts_at', { ascending: false }).limit(1).maybeSingle();
    const [{ data: session }, { data: lineUser }, { data: classroom }] = await Promise.all([
      sessionQuery,
      sb.from('users').select('id, first_name, last_name').eq('line_uid', lineUid).maybeSingle(),
      sb.from('classrooms').select('*').eq('id', classroomId).maybeSingle(),
    ]);

    // Only admitted students of this classroom can check in.
    if (!classroom || (await classroomRole(sb, actor, classroom as Classroom)) !== 'student') {
      return NextResponse.json({ error: 'คุณยังไม่ได้อยู่ในห้องเรียนนี้ หรือยังรอคุณครูอนุมัติ' }, { status: 403 });
    }
    if (!session || session.status === 'closed') {
      return NextResponse.json({ error: 'ขณะนี้ไม่มีคาบเช็คชื่อที่เปิดอยู่' }, { status: 400 });
    }
    // Borrowed phone: check in the classmate; the phone's owner is recorded as the sender.
    let proxyStudent: ProxyStudent | null = null;
    if (body.proxyStudentNumber) {
      try {
        proxyStudent = await resolveProxyStudent(sb, actor, classroom as Classroom, body.proxyStudentNumber);
      } catch (proxyError) {
        if (proxyError instanceof HttpError) return NextResponse.json({ error: proxyError.message }, { status: proxyError.status });
        throw proxyError;
      }
    }

    const now = Date.now();
    const startTime = new Date(session.starts_at).getTime();
    if (now < startTime) {
      return NextResponse.json({ error: 'ยังไม่ถึงเวลาเช็คชื่อของคาบนี้' }, { status: 400 });
    }
    const onTimeLimit = startTime + (session.on_time_until_minutes || 10) * 60 * 1000;
    const lateLimit = startTime + (session.late_until_minutes || 30) * 60 * 1000;
    const computedStatus: AttendanceStatus = now > lateLimit ? 'absent' : now > onTimeLimit ? 'late' : 'on_time';

    // A student can only check in once. Re-tapping (or a second device) must not
    // overwrite the first check-in time or a status the teacher adjusted.
    const candidateIds = proxyStudent
      ? ([proxyStudent.id, proxyStudent.line_uid].filter(Boolean) as string[])
      : ([...new Set([lineUser?.id, studentId, lineUid].filter(Boolean))] as string[]);
    const { data: existingRecord } = await sb
      .from('attendance_records')
      .select('*')
      .eq('session_id', session.id)
      .in('student_id', candidateIds)
      .limit(1)
      .maybeSingle();
    if (existingRecord) {
      return NextResponse.json({ success: true, alreadyCheckedIn: true, status: existingRecord.status, record: existingRecord, session });
    }

    // Resolve the canonical users.id and the student's real name: from the
    // synced LINE profile first, then the classroom roster or school number.
    const matches = (value?: string) => !!value && (value.trim() === studentId || value.trim() === lineUid);
    const rosterStudent = ((classroom?.students || []) as RosterEntry[]).find(
      (st) => st && (matches(st.id) || matches(st.line_uid) || matches(st.student_id))
    );
    let canonicalUserId = proxyStudent?.id || lineUser?.id || rosterStudent?.id || studentId || lineUid;
    let firstName = proxyStudent?.first_name.trim() || lineUser?.first_name?.trim() || rosterStudent?.first_name?.trim() || '';
    let lastName = proxyStudent?.last_name.trim() || lineUser?.last_name?.trim() || rosterStudent?.last_name?.trim() || '';
    if (!proxyStudent && !lineUser && studentId) {
      const { data: studentUser } = await sb.from('users').select('id, first_name, last_name').eq('student_id', studentId).maybeSingle();
      if (studentUser?.id) {
        canonicalUserId = studentUser.id;
        firstName = studentUser.first_name?.trim() || firstName;
        lastName = studentUser.last_name?.trim() || lastName;
      }
    }

    // Never create a placeholder student profile.
    if (!firstName || !lastName) {
      return NextResponse.json({ error: 'ยังไม่พบชื่อและนามสกุลจาก LIFF กรุณาซิงค์โปรไฟล์นักเรียนแล้วลองเช็คชื่ออีกครั้ง' }, { status: 409 });
    }

    const record: Record<string, unknown> = {
      id: `att-rec-${Date.now()}-${randomUUID().slice(0, 6)}`,
      session_id: session.id,
      classroom_id: classroomId,
      student_id: canonicalUserId,
      status: computedStatus,
      checked_at: new Date().toISOString(),
      ...(proxyStudent ? { checked_in_by: studentId } : {}),
    };
    // The classmate's profile already exists; only the phone owner's may need creating.
    const { error: userError } = proxyStudent
      ? { error: null }
      : await sb.from('users').upsert(
          { id: canonicalUserId, role: 'student', line_uid: lineUid || undefined, first_name: firstName, last_name: lastName },
          { onConflict: 'id', ignoreDuplicates: true }
        );
    let { error: attendanceError } = userError
      ? { error: userError }
      : await sb.from('attendance_records').upsert(record, { onConflict: 'session_id,student_id' });
    // Databases without attendance_records.checked_in_by yet still save the check-in.
    if (attendanceError?.message?.includes('checked_in_by')) {
      console.warn('attendance_records.checked_in_by is missing; run supabase_proxy_submission_update.sql');
      const { checked_in_by: _unused, ...withoutSender } = record;
      ({ error: attendanceError } = await sb.from('attendance_records').upsert(withoutSender, { onConflict: 'session_id,student_id' }));
    }
    if (attendanceError) {
      // Without the database row the teacher never sees this check-in.
      console.error('Attendance check-in failed:', attendanceError);
      return NextResponse.json({ error: 'บันทึกการเช็คชื่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 503 });
    }
    signalAttendance(classroomId);
    return NextResponse.json({ success: true, status: computedStatus, record, session, proxyStudent: proxyStudent ? { first_name: firstName, last_name: lastName } : undefined });
  }

  // ----------------------------------------------------
  // TEACHER ACTIONS
  // ----------------------------------------------------
  const context = await getTeacherContext(actor, classroomId);
  if (!context.userId || !context.classroom) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { supabase, userId, classroom } = context;

  if (action === 'create') {
    const onTimeUntilMinutes = Math.max(0, Number(body.onTimeUntilMinutes ?? 10));
    const lateUntilMinutes = Math.max(onTimeUntilMinutes, Number(body.lateUntilMinutes ?? 30));
    const startsAtDate = new Date(typeof body.startsAt === 'string' ? body.startsAt : Date.now());
    const sessionTitle = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'เช็กชื่อ';
    const createdAt = new Date().toISOString();

    const session: AttendanceSession = {
      id: `att-sess-${Date.now()}-${randomUUID().slice(0, 6)}`,
      classroom_id: classroomId,
      title: sessionTitle,
      starts_at: Number.isNaN(startsAtDate.getTime()) ? createdAt : startsAtDate.toISOString(),
      on_time_until_minutes: onTimeUntilMinutes,
      late_until_minutes: lateUntilMinutes,
      status: 'open',
      created_by: userId,
      created_at: createdAt,
    };
    const { error } = await supabase.from('attendance_sessions').insert(session);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Timeline post (best effort).
    const { error: postError } = await supabase.from('classroom_posts').insert({
      id: `post-${Date.now()}-${randomUUID().slice(0, 6)}`,
      classroom_id: classroomId,
      author_id: userId,
      body: `เปิดคาบเช็คชื่อ: ${sessionTitle} (ตรงเวลาใน ${onTimeUntilMinutes} นาที, สายได้ถึง ${lateUntilMinutes} นาที)`,
      activity_type: 'attendance',
      metadata: { sessionId: session.id },
      created_at: createdAt,
    });
    if (postError) console.warn('Attendance timeline post failed:', postError.message);

    // Push to LINE after responding so the teacher sees the new session immediately.
    const lineGroupId = classroom.line_group_id;
    if (lineGroupId) {
      after(async () => {
        try {
          await pushLineGroupText(
            lineGroupId,
            withLiffLink(
              `⏰ เปิดคาบเช็คชื่อ\n📘 ${classroomTitle(classroom)}\nคาบ: ${sessionTitle}\n\n⏱️ เช็คชื่อตรงเวลาได้ภายใน ${onTimeUntilMinutes} นาที\n(หลังจากนั้นถือว่ามาสายถึง ${lateUntilMinutes} นาที)`,
              'กดเพื่อเช็คชื่อ',
              { classroomId, inviteCode: classroom.invite_code, view: 'attendance' }
            )
          );
        } catch (err) {
          console.error('Attendance LINE push failed:', err);
        }
      });
    }
    signalAttendance(classroomId);
    after(() => signalClassroom(classroomId, { type: 'timeline' }));
    return NextResponse.json({ session }, { status: 201 });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });

  const updateSession = async (fields: Record<string, unknown>) => {
    const { error } = await supabase.from('attendance_sessions').update(fields).eq('id', sessionId).eq('classroom_id', classroomId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    signalAttendance(classroomId);
    return null;
  };

  /**
   * Closing a session turns every roster student who never checked in into an
   * explicit "absent" record. Existing records (incl. a check-in racing the
   * close) are left untouched.
   */
  const markUncheckedAbsent = async () => {
    const [{ data: roomRow }, { data: existing }] = await Promise.all([
      supabase.from('classrooms').select('students').eq('id', classroomId).maybeSingle(),
      supabase.from('attendance_records').select('student_id').eq('session_id', sessionId),
    ]);
    const roster = ((roomRow?.students || []) as RosterEntry[]).filter((st) => st && (st.id || st.line_uid));
    const recorded = new Set((existing || []).map((r) => r.student_id));
    const missing = roster.filter((st) => ![st.id, st.line_uid, st.student_id].some((key) => key && recorded.has(key)));
    if (!missing.length) return [];

    // Roster ids may be a LINE uid; attendance_records.student_id must be users.id.
    const rosterKeys = missing.map((st) => (st.id || st.line_uid) as string);
    const { data: users } = await supabase.from('users').select('id, line_uid').in('line_uid', rosterKeys);
    const userIdByLineUid = new Map((users || []).map((u) => [u.line_uid, u.id]));
    const rows = [...new Set(rosterKeys.map((key) => userIdByLineUid.get(key) || key))].map((userKey) => ({
      id: `att-rec-${sessionId}-${userKey}`,
      session_id: sessionId,
      classroom_id: classroomId,
      student_id: userKey,
      status: 'absent' as AttendanceStatus,
      checked_at: null,
    }));
    const { error } = await supabase
      .from('attendance_records')
      .upsert(rows, { onConflict: 'session_id,student_id', ignoreDuplicates: true });
    if (error) {
      console.error('Marking unchecked students absent failed:', error);
      return [];
    }
    return rows;
  };

  /**
   * Reopening undoes markUncheckedAbsent: its rows (absent, never checked in,
   * not set by a teacher) are removed so those students can check in again.
   */
  const clearAutoAbsent = () =>
    supabase
      .from('attendance_records')
      .delete()
      .eq('session_id', sessionId)
      .eq('status', 'absent')
      .is('checked_at', null)
      .is('adjusted_by', null);

  if (action === 'close') {
    const failed = await updateSession({ status: 'closed', closed_at: new Date().toISOString() });
    if (failed) return failed;
    return NextResponse.json({ success: true, sessionId, records: await markUncheckedAbsent() });
  }

  if (action === 'update_session') {
    const fields: Record<string, unknown> = {};
    if (typeof body.title === 'string' && body.title.trim()) fields.title = body.title.trim();
    if (body.status === 'open' || body.status === 'closed') {
      fields.status = body.status;
      fields.closed_at = body.status === 'closed' ? new Date().toISOString() : null;
    }
    const onTime = Number(body.onTimeUntilMinutes);
    const late = Number(body.lateUntilMinutes);
    if (body.onTimeUntilMinutes !== undefined && !Number.isNaN(onTime)) fields.on_time_until_minutes = onTime;
    if (body.lateUntilMinutes !== undefined && !Number.isNaN(late)) fields.late_until_minutes = late;
    if (typeof body.startsAt === 'string') fields.starts_at = body.startsAt;
    const failed = await updateSession(fields);
    if (failed) return failed;
    if (fields.status === 'open') await clearAutoAbsent();
    const records = fields.status === 'closed' ? await markUncheckedAbsent() : [];
    return NextResponse.json({ success: true, sessionId, records });
  }

  if (action === 'delete_session') {
    await supabase.from('attendance_records').delete().eq('session_id', sessionId);
    const { error } = await supabase.from('attendance_sessions').delete().eq('id', sessionId).eq('classroom_id', classroomId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    signalAttendance(classroomId);
    return NextResponse.json({ success: true, deletedSessionId: sessionId });
  }

  if (action === 'extend') {
    const lateUntilMinutes = Math.max(0, Number(body.lateUntilMinutes || 40));
    const failed = await updateSession({ late_until_minutes: lateUntilMinutes, status: 'open', closed_at: null });
    return failed || NextResponse.json({ success: true, sessionId, lateUntilMinutes });
  }

  if (action === 'record') {
    const studentId = typeof body.studentId === 'string' ? body.studentId : '';
    const status = body.status as AttendanceStatus;
    if (!studentId || !['on_time', 'late', 'absent', 'excused'].includes(status)) {
      return NextResponse.json({ error: 'Invalid attendance record' }, { status: 400 });
    }
    // Roster ids may be a LINE uid; attendance_records.student_id must be users.id.
    const userKey = await resolveUserId(supabase, studentId);
    const now = new Date().toISOString();
    const record = {
      id: `att-rec-${sessionId}-${userKey}`,
      session_id: sessionId,
      classroom_id: classroomId,
      student_id: userKey,
      status,
      checked_at: status === 'absent' ? null : now,
      adjusted_at: now,
      adjusted_by: userId,
    };
    const { error } = await supabase.from('attendance_records').upsert(record, { onConflict: 'session_id,student_id' });
    if (error) {
      console.error('Manual attendance record failed:', error);
      return NextResponse.json({ error: 'บันทึกสถานะการเข้าเรียนไม่สำเร็จ' }, { status: 503 });
    }
    signalAttendance(classroomId);
    return NextResponse.json({ record });
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  const classroomId = request.nextUrl.searchParams.get('classroomId');
  if (!sessionId || !classroomId) {
    return NextResponse.json({ error: 'sessionId and classroomId are required' }, { status: 400 });
  }
  const { supabase, classroom } = await getTeacherContext(await getActor(request), classroomId);
  if (!classroom) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await supabase.from('attendance_records').delete().eq('session_id', sessionId);
  const { error } = await supabase.from('attendance_sessions').delete().eq('id', sessionId).eq('classroom_id', classroomId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  signalAttendance(classroomId);
  return NextResponse.json({ success: true, deletedSessionId: sessionId });
}
