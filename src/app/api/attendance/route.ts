import { randomUUID } from 'node:crypto';
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { pushLineGroupText } from '@/lib/line/messaging';
import { withLiffLink } from '@/lib/line/liffLink';

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

/** The signed-in user and the classroom, if they teach it. */
async function getTeacherContext(classroomId: string) {
  const { userId } = await auth();
  const supabase = createServiceSupabaseClient();
  if (!userId) return { userId: null, supabase, classroom: null };
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id, name, teacher_id, teachers, line_group_id')
    .eq('id', classroomId)
    .maybeSingle();
  const isTeacher =
    classroom?.teacher_id === userId ||
    (classroom?.teachers || []).some((teacher: { teacher_id?: string }) => teacher.teacher_id === userId);
  return { userId, supabase, classroom: isTeacher ? classroom : null };
}

/** users.id for a LINE uid (attendance_records.student_id references users.id). */
async function resolveUserId(supabase: ReturnType<typeof createServiceSupabaseClient>, lineUid: string) {
  const { data } = await supabase.from('users').select('id').eq('line_uid', lineUid).maybeSingle();
  return data?.id || lineUid;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const classroomId = params.get('classroomId');
  const sessionId = params.get('sessionId');
  const lineUid = params.get('lineUid');
  const classroomIds = (params.get('classroomIds') || '').split(',').map((id) => id.trim()).filter(Boolean);
  const supabase = createServiceSupabaseClient();

  // Student overview: sessions + this student's records for many classrooms in
  // one request (the LIFF home screen).
  if (!classroomId && classroomIds.length > 0 && lineUid) {
    const studentId = await resolveUserId(supabase, lineUid);
    const [sessionsRes, recordsRes] = await Promise.all([
      supabase.from('attendance_sessions').select('*').in('classroom_id', classroomIds).order('starts_at', { ascending: false }),
      supabase.from('attendance_records').select('*').in('classroom_id', classroomIds).in('student_id', [...new Set([studentId, lineUid])]),
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

  let sessionQuery = supabase.from('attendance_sessions').select('*').eq('classroom_id', classroomId).order('starts_at', { ascending: false });
  if (sessionId) sessionQuery = sessionQuery.eq('id', sessionId);

  const context = await getTeacherContext(classroomId);

  // Student perspective: their own records only.
  if (!context.classroom && lineUid) {
    const studentId = await resolveUserId(supabase, lineUid);
    const [{ data: sessions }, { data: records }] = await Promise.all([
      sessionQuery,
      supabase.from('attendance_records').select('*').eq('classroom_id', classroomId).in('student_id', [...new Set([studentId, lineUid])]),
    ]);
    return NextResponse.json({ sessions: sessions || [], session: sessions?.[0] || null, records: records || [] });
  }

  if (!context.classroom) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: sessions, error } = await sessionQuery;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const selectedSession = (sessionId ? sessions?.find((s) => s.id === sessionId) : sessions?.[0]) || null;
  let records: unknown[] = [];
  if (selectedSession) {
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

  // ----------------------------------------------------
  // STUDENT SELF CHECK-IN
  // ----------------------------------------------------
  if (action === 'check_in') {
    const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : '';
    const lineUid = typeof body.lineUid === 'string' ? body.lineUid.trim() : '';
    const targetSessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!studentId && !lineUid) {
      return NextResponse.json({ error: 'Student identity (studentId or lineUid) is required' }, { status: 400 });
    }

    const sb = createServiceSupabaseClient();
    const sessionQuery = targetSessionId
      ? sb.from('attendance_sessions').select('*').eq('id', targetSessionId).maybeSingle()
      : sb.from('attendance_sessions').select('*').eq('classroom_id', classroomId).eq('status', 'open').order('starts_at', { ascending: false }).limit(1).maybeSingle();
    const [{ data: session }, { data: lineUser }, { data: classroom }] = await Promise.all([
      sessionQuery,
      lineUid ? sb.from('users').select('id, first_name, last_name').eq('line_uid', lineUid).maybeSingle() : Promise.resolve({ data: null }),
      sb.from('classrooms').select('students').eq('id', classroomId).maybeSingle(),
    ]);

    if (!session || session.status === 'closed') {
      return NextResponse.json({ error: 'ขณะนี้ไม่มีคาบเช็คชื่อที่เปิดอยู่' }, { status: 400 });
    }

    const now = Date.now();
    const startTime = new Date(session.starts_at).getTime();
    const onTimeLimit = startTime + (session.on_time_until_minutes || 10) * 60 * 1000;
    const lateLimit = startTime + (session.late_until_minutes || 30) * 60 * 1000;
    const computedStatus: AttendanceStatus = now > lateLimit ? 'absent' : now > onTimeLimit ? 'late' : 'on_time';

    // A student can only check in once. Re-tapping (or a second device) must not
    // overwrite the first check-in time or a status the teacher adjusted.
    const candidateIds = [...new Set([lineUser?.id, studentId, lineUid].filter(Boolean))] as string[];
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
    let canonicalUserId = lineUser?.id || rosterStudent?.id || studentId || lineUid;
    let firstName = lineUser?.first_name?.trim() || rosterStudent?.first_name?.trim() || '';
    let lastName = lineUser?.last_name?.trim() || rosterStudent?.last_name?.trim() || '';
    if (!lineUser && studentId) {
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

    const record = {
      id: `att-rec-${Date.now()}-${randomUUID().slice(0, 6)}`,
      session_id: session.id,
      classroom_id: classroomId,
      student_id: canonicalUserId,
      status: computedStatus,
      checked_at: new Date().toISOString(),
    };
    const { error: userError } = await sb.from('users').upsert(
      { id: canonicalUserId, role: 'student', line_uid: lineUid || undefined, first_name: firstName, last_name: lastName },
      { onConflict: 'id', ignoreDuplicates: true }
    );
    const { error: attendanceError } = userError
      ? { error: userError }
      : await sb.from('attendance_records').upsert(record, { onConflict: 'session_id,student_id' });
    if (attendanceError) {
      // Without the database row the teacher never sees this check-in.
      console.error('Attendance check-in failed:', attendanceError);
      return NextResponse.json({ error: 'บันทึกการเช็คชื่อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 503 });
    }
    return NextResponse.json({ success: true, status: computedStatus, record, session });
  }

  // ----------------------------------------------------
  // TEACHER ACTIONS
  // ----------------------------------------------------
  const context = await getTeacherContext(classroomId);
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

    if (classroom.line_group_id) {
      try {
        await pushLineGroupText(
          classroom.line_group_id,
          withLiffLink(
            `⏰ เปิดคาบเช็คชื่อ\nห้อง: ${classroom.name || 'ห้องเรียน'}\nคาบ: ${sessionTitle}\n\n⏱️ เช็คชื่อตรงเวลาได้ภายใน ${onTimeUntilMinutes} นาที\n(หลังจากนั้นถือว่ามาสายถึง ${lateUntilMinutes} นาที)`,
            'กดเพื่อเช็คชื่อ',
            { classroomId, view: 'attendance' }
          )
        );
      } catch (err) {
        console.error('Attendance LINE push failed:', err);
      }
    }
    return NextResponse.json({ session }, { status: 201 });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });

  const updateSession = async (fields: Record<string, unknown>) => {
    const { error } = await supabase.from('attendance_sessions').update(fields).eq('id', sessionId).eq('classroom_id', classroomId);
    return error ? NextResponse.json({ error: error.message }, { status: 500 }) : null;
  };

  if (action === 'close') {
    const failed = await updateSession({ status: 'closed', closed_at: new Date().toISOString() });
    return failed || NextResponse.json({ success: true, sessionId });
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
    return failed || NextResponse.json({ success: true, sessionId });
  }

  if (action === 'delete_session') {
    await supabase.from('attendance_records').delete().eq('session_id', sessionId);
    const { error } = await supabase.from('attendance_sessions').delete().eq('id', sessionId).eq('classroom_id', classroomId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
  const { supabase, classroom } = await getTeacherContext(classroomId);
  if (!classroom) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await supabase.from('attendance_records').delete().eq('session_id', sessionId);
  const { error } = await supabase.from('attendance_sessions').delete().eq('id', sessionId).eq('classroom_id', classroomId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, deletedSessionId: sessionId });
}
