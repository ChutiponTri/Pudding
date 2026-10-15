import { randomUUID } from 'node:crypto';
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createAnonServerSupabaseClient, createServiceSupabaseClient } from '@/lib/supabase/server';
import { pushLineGroupText } from '@/lib/line/messaging';
import { fallbackStore, FallbackAttendanceSession, FallbackAttendanceRecord } from '@/lib/classroom/storageFallback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AttendanceStatus = 'on_time' | 'late' | 'absent' | 'excused';

async function getTeacherContext(classroomId: string) {
  const { userId } = await auth();
  if (!userId) return { userId: null, supabase: null, classroom: null };
  
  let supabase = createAnonServerSupabaseClient();
  let { data: classroom } = await supabase
    .from('classrooms')
    .select('id, name, teacher_id, teachers, students, line_group_id')
    .eq('id', classroomId)
    .maybeSingle();

  if (!classroom) {
    try {
      supabase = createServiceSupabaseClient();
      const res = await supabase.from('classrooms').select('id, name, teacher_id, teachers, students, line_group_id').eq('id', classroomId).maybeSingle();
      classroom = res.data;
    } catch {}
  }

  const isTeacher = classroom?.teacher_id === userId
    || (classroom?.teachers || []).some((teacher: { teacher_id?: string }) => teacher.teacher_id === userId);
  return { userId, supabase, classroom: isTeacher ? classroom : null };
}

export async function GET(request: NextRequest) {
  const classroomId = request.nextUrl.searchParams.get('classroomId');
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  const lineUid = request.nextUrl.searchParams.get('lineUid');
  if (!classroomId) return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });

  const context = await getTeacherContext(classroomId);
  const supabase = context.supabase || createAnonServerSupabaseClient();

  // Student perspective
  if (!context.userId && lineUid) {
    // 1. Fetch sessions from Supabase & fallback
    let sessions: FallbackAttendanceSession[] = [];
    try {
      let query = supabase.from('attendance_sessions').select('*').eq('classroom_id', classroomId).order('starts_at', { ascending: false });
      if (sessionId) query = query.eq('id', sessionId);
      const { data, error } = await query;
      if (!error && data) sessions = data as FallbackAttendanceSession[];
    } catch {}

    const localSessions = fallbackStore.getAttendanceSessions(classroomId);
    const seenSess = new Set<string>();
    const mergedSessions: FallbackAttendanceSession[] = [];
    for (const s of [...localSessions, ...sessions]) {
      if (!seenSess.has(s.id)) {
        seenSess.add(s.id);
        mergedSessions.push(s);
      }
    }
    mergedSessions.sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

    // 2. Resolve student ID
    let studentId = lineUid;
    try {
      const { data: student } = await supabase.from('users').select('id, line_uid').eq('line_uid', lineUid).maybeSingle();
      if (student?.id) studentId = student.id;
    } catch {}

    // 3. Fetch records for student
    let records: FallbackAttendanceRecord[] = [];
    try {
      const { data, error } = await supabase.from('attendance_records').select('*').eq('classroom_id', classroomId).or(`student_id.eq.${studentId},student_id.eq.${lineUid}`);
      if (!error && data) records = data as FallbackAttendanceRecord[];
    } catch {}

    const localRecords = [...fallbackStore.getStudentRecords(classroomId, studentId), ...fallbackStore.getStudentRecords(classroomId, lineUid)];
    const seenRec = new Set<string>();
    const mergedRecords: FallbackAttendanceRecord[] = [];
    for (const r of [...localRecords, ...records]) {
      const key = `${r.session_id}-${r.student_id}`;
      if (!seenRec.has(key)) {
        seenRec.add(key);
        mergedRecords.push(r);
      }
    }

    const selectedSession = mergedSessions[0] || null;
    return NextResponse.json({
      sessions: mergedSessions,
      session: selectedSession,
      records: mergedRecords,
    });
  }

  // Teacher perspective
  let sessions: FallbackAttendanceSession[] = [];
  try {
    let sessionQuery = supabase.from('attendance_sessions').select('*').eq('classroom_id', classroomId).order('starts_at', { ascending: false });
    if (sessionId) sessionQuery = sessionQuery.eq('id', sessionId);
    const { data, error } = await sessionQuery;
    if (!error && data) sessions = data as FallbackAttendanceSession[];
  } catch {}

  const localSessions = fallbackStore.getAttendanceSessions(classroomId);
  const seenSess = new Set<string>();
  const mergedSessions: FallbackAttendanceSession[] = [];
  for (const s of [...localSessions, ...sessions]) {
    if (!seenSess.has(s.id)) {
      seenSess.add(s.id);
      mergedSessions.push(s);
    }
  }
  mergedSessions.sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

  const selectedSession = (sessionId ? mergedSessions.find((s) => s.id === sessionId) : mergedSessions[0]) || null;
  let records: FallbackAttendanceRecord[] = [];
  if (selectedSession) {
    try {
      const { data, error } = await supabase.from('attendance_records').select('*').eq('session_id', selectedSession.id);
      if (!error && data) records = data as FallbackAttendanceRecord[];
    } catch {}
    const localRecs = fallbackStore.getAttendanceRecords(selectedSession.id);
    const seenR = new Set<string>();
    const mergedR: FallbackAttendanceRecord[] = [];
    for (const r of [...localRecs, ...records]) {
      if (!seenR.has(r.student_id)) {
        seenR.add(r.student_id);
        mergedR.push(r);
      }
    }
    records = mergedR;
  }

  return NextResponse.json({ sessions: mergedSessions, session: selectedSession, records });
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

    let sb = createServiceSupabaseClient();
    // Find active session
    let session: FallbackAttendanceSession | null = null;
    if (targetSessionId) {
      const local = fallbackStore.getAttendanceSessions(classroomId).find((s) => s.id === targetSessionId);
      if (local) session = local;
      else {
        try {
          const { data } = await sb.from('attendance_sessions').select('*').eq('id', targetSessionId).maybeSingle();
          if (data) session = data as FallbackAttendanceSession;
        } catch {}
      }
    } else {
      const all = fallbackStore.getAttendanceSessions(classroomId);
      session = all.find((s) => s.status === 'open') || null;
      if (!session) {
        try {
          const { data } = await sb.from('attendance_sessions').select('*').eq('classroom_id', classroomId).eq('status', 'open').order('starts_at', { ascending: false }).maybeSingle();
          if (data) session = data as FallbackAttendanceSession;
        } catch {}
      }
    }

    if (!session || session.status === 'closed') {
      return NextResponse.json({ error: 'ขณะนี้ไม่มีคาบเช็คชื่อที่เปิดอยู่' }, { status: 400 });
    }

    const now = Date.now();
    const startTime = new Date(session.starts_at).getTime();
    const onTimeLimit = startTime + (session.on_time_until_minutes || 10) * 60 * 1000;
    const lateLimit = startTime + (session.late_until_minutes || 30) * 60 * 1000;

    let computedStatus: AttendanceStatus = 'on_time';
    if (now > lateLimit) {
      computedStatus = 'absent';
    } else if (now > onTimeLimit) {
      computedStatus = 'late';
    }

    const checkInTime = new Date().toISOString();
    const cleanStudentId = studentId.trim();
    const cleanLineUid = lineUid.trim();
    const primaryId = cleanStudentId || cleanLineUid;

    const record: FallbackAttendanceRecord = {
      id: `att-rec-${Date.now()}-${randomUUID().slice(0, 6)}`,
      session_id: session.id,
      classroom_id: classroomId,
      student_id: primaryId,
      status: computedStatus,
      checked_at: checkInTime,
    };

    // Save to fallback store for primary studentId
    fallbackStore.saveAttendanceRecord(record);
    if (cleanLineUid && cleanLineUid !== primaryId) {
      fallbackStore.saveAttendanceRecord({ ...record, id: `att-rec-uid-${Date.now()}`, student_id: cleanLineUid });
    }

    // Resolve the real profile from the classroom enrollment snapshot first.
    // LIFF syncs this profile to users before check-in.
    let resolvedFirstName = '';
    let resolvedLastName = '';
    let matchedStudent: any = null;

    // Try finding matching student in classroom to cross-bind student_id, id, and line_uid
    let canonicalUserId = primaryId;
    try {
      const { data: clsData } = await sb.from('classrooms').select('students').eq('id', classroomId).maybeSingle();
      const studentsList: any[] = clsData?.students || [];
      matchedStudent = studentsList.find((st: any) => {
        if (!st) return false;
        if (cleanStudentId && st.id && String(st.id).trim() === cleanStudentId) return true;
        if (cleanLineUid && st.id && String(st.id).trim() === cleanLineUid) return true;
        if (cleanLineUid && st.line_uid && String(st.line_uid).trim() === cleanLineUid) return true;
        if (cleanStudentId && st.line_uid && String(st.line_uid).trim() === cleanStudentId) return true;
        if (cleanStudentId && st.student_id && String(st.student_id).trim() === cleanStudentId) return true;
        if (cleanLineUid && st.student_id && String(st.student_id).trim() === cleanLineUid) return true;
        return false;
      });

      if (matchedStudent) {
        if (typeof matchedStudent.first_name === 'string' && matchedStudent.first_name.trim()) {
          resolvedFirstName = matchedStudent.first_name.trim();
        }
        if (typeof matchedStudent.last_name === 'string') {
          resolvedLastName = matchedStudent.last_name.trim();
        }
        if (matchedStudent.id && String(matchedStudent.id).trim()) {
          const mId = String(matchedStudent.id).trim();
          canonicalUserId = mId;
          fallbackStore.saveAttendanceRecord({ ...record, student_id: mId });
        }
        if (matchedStudent.line_uid && String(matchedStudent.line_uid).trim()) {
          fallbackStore.saveAttendanceRecord({ ...record, student_id: String(matchedStudent.line_uid).trim() });
        }
        if (matchedStudent.student_id && String(matchedStudent.student_id).trim()) {
          fallbackStore.saveAttendanceRecord({ ...record, student_id: String(matchedStudent.student_id).trim() });
        }
      }
    } catch {}

    // Resolve the canonical Supabase user first. The LIFF client may send either
    // the LINE id or the student's school id, while attendance_records.student_id
    // has a foreign key to users.id.
    try {
      if (cleanLineUid) {
        const { data: lineUser } = await sb.from('users').select('id, first_name, last_name').eq('line_uid', cleanLineUid).maybeSingle();
        if (lineUser?.id) {
          canonicalUserId = lineUser.id;
          if (typeof lineUser.first_name === 'string' && lineUser.first_name.trim()) resolvedFirstName = lineUser.first_name.trim();
          if (typeof lineUser.last_name === 'string') resolvedLastName = lineUser.last_name.trim();
        }
      }
      if (canonicalUserId === primaryId && studentId) {
        const { data: studentUser } = await sb.from('users').select('id, first_name, last_name').eq('student_id', cleanStudentId).maybeSingle();
        if (studentUser?.id) {
          canonicalUserId = studentUser.id;
          if (typeof studentUser.first_name === 'string' && studentUser.first_name.trim()) resolvedFirstName = studentUser.first_name.trim();
          if (typeof studentUser.last_name === 'string') resolvedLastName = studentUser.last_name.trim();
        }
      }

      // Production must never create a placeholder student profile. Both names
      // must come from the synced LIFF/user record or classroom enrollment.
      if (!resolvedFirstName || !resolvedLastName) {
        return NextResponse.json({ error: 'ยังไม่พบชื่อและนามสกุลจาก LIFF กรุณาซิงค์โปรไฟล์นักเรียนแล้วลองเช็คชื่ออีกครั้ง' }, { status: 409 });
      }

      const { error: userError } = await sb.from('users').upsert({
        id: canonicalUserId,
        role: 'student',
        line_uid: cleanLineUid || undefined,
        first_name: resolvedFirstName,
        last_name: resolvedLastName,
      }, { onConflict: 'id', ignoreDuplicates: true });
      if (userError) throw userError;

      const { error: attendanceError } = await sb.from('attendance_records').upsert({
        id: record.id,
        session_id: session.id,
        classroom_id: classroomId,
        student_id: canonicalUserId,
        status: computedStatus,
        checked_at: record.checked_at,
      }, { onConflict: 'session_id,student_id' });
      if (attendanceError) throw attendanceError;
    } catch (dbErr) {
      console.warn('Supabase attendance record upsert note:', dbErr);
    }

    return NextResponse.json({ success: true, status: computedStatus, record, session });
  }

  // ----------------------------------------------------
  // TEACHER ACTIONS
  // ----------------------------------------------------
  const context = await getTeacherContext(classroomId);
  const supabase = context.supabase || createAnonServerSupabaseClient();
  const userId = context.userId || 'teacher';

  if (action === 'create') {
    const startsAt = typeof body.startsAt === 'string' ? body.startsAt : new Date().toISOString();
    const onTimeUntilMinutes = Math.max(0, Number(body.onTimeUntilMinutes ?? 10));
    const lateUntilMinutes = Math.max(onTimeUntilMinutes, Number(body.lateUntilMinutes ?? 30));
    const startsAtDate = new Date(startsAt);
    const sessionTitle = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'เช็กชื่อ';

    const session: FallbackAttendanceSession = {
      id: `att-sess-${Date.now()}-${randomUUID().slice(0, 6)}`,
      classroom_id: classroomId,
      title: sessionTitle,
      starts_at: Number.isNaN(startsAtDate.getTime()) ? new Date().toISOString() : startsAtDate.toISOString(),
      on_time_until_minutes: onTimeUntilMinutes,
      late_until_minutes: lateUntilMinutes,
      status: 'open',
      created_by: userId,
      created_at: new Date().toISOString(),
    };

    // Try Supabase insert
    try {
      await supabase.from('attendance_sessions').insert(session);
    } catch {}

    fallbackStore.saveAttendanceSession(session);

    // Also publish to classroom timeline post
    fallbackStore.savePost({
      id: `post-${Date.now()}-${randomUUID().slice(0, 6)}`,
      classroom_id: classroomId,
      author_id: userId,
      body: `เปิดคาบเช็คชื่อ: ${sessionTitle} (ตรงเวลาใน ${onTimeUntilMinutes} นาที, สายได้ถึง ${lateUntilMinutes} นาที)`,
      activity_type: 'attendance',
      created_at: session.created_at,
    });

    // Send LINE Group notification
    const lineGroupId = context.classroom?.line_group_id;
    const classroomName = context.classroom?.name || 'ห้องเรียน';
    if (lineGroupId) {
      try {
        await pushLineGroupText(
          lineGroupId,
          `⏰ เปิดคาบเช็คชื่อ\nห้อง: ${classroomName}\nคาบ: ${sessionTitle}\n\n⏱️ เช็คชื่อตรงเวลาได้ภายใน ${onTimeUntilMinutes} นาที\n(หลังจากนั้นถือว่ามาสายถึง ${lateUntilMinutes} นาที)`
        );
      } catch (err) {
        console.error('Attendance LINE push failed:', err);
      }
    }

    return NextResponse.json({ session }, { status: 201 });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });

  if (action === 'close') {
    const existing = fallbackStore.getAttendanceSessions(classroomId).find((s) => s.id === sessionId);
    if (existing) {
      existing.status = 'closed';
      existing.closed_at = new Date().toISOString();
      fallbackStore.saveAttendanceSession(existing);
    }
    try {
      await supabase.from('attendance_sessions').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', sessionId);
    } catch {}
    return NextResponse.json({ success: true, sessionId });
  }

  if (action === 'update_session') {
    const newTitle = typeof body.title === 'string' ? body.title.trim() : '';
    const newStatus = body.status === 'open' || body.status === 'closed' ? body.status : undefined;
    const onTimeMinutes = body.onTimeUntilMinutes !== undefined ? Number(body.onTimeUntilMinutes) : undefined;
    const lateMinutes = body.lateUntilMinutes !== undefined ? Number(body.lateUntilMinutes) : undefined;
    const startsAt = typeof body.startsAt === 'string' ? body.startsAt : undefined;

    const existing = fallbackStore.getAttendanceSessions(classroomId).find((s) => s.id === sessionId);
    if (existing) {
      if (newTitle) existing.title = newTitle;
      if (onTimeMinutes !== undefined && !isNaN(onTimeMinutes)) existing.on_time_until_minutes = onTimeMinutes;
      if (lateMinutes !== undefined && !isNaN(lateMinutes)) existing.late_until_minutes = lateMinutes;
      if (startsAt) existing.starts_at = startsAt;
      if (newStatus) {
        existing.status = newStatus;
        if (newStatus === 'open') existing.closed_at = null;
        if (newStatus === 'closed') existing.closed_at = new Date().toISOString();
      }
      fallbackStore.saveAttendanceSession(existing);
    }
    try {
      const updateData: Record<string, any> = {};
      if (newTitle) updateData.title = newTitle;
      if (newStatus) updateData.status = newStatus;
      if (onTimeMinutes !== undefined && !isNaN(onTimeMinutes)) updateData.on_time_until_minutes = onTimeMinutes;
      if (lateMinutes !== undefined && !isNaN(lateMinutes)) updateData.late_until_minutes = lateMinutes;
      if (startsAt) updateData.starts_at = startsAt;
      await supabase.from('attendance_sessions').update(updateData).eq('id', sessionId);
    } catch {}
    return NextResponse.json({ success: true, sessionId });
  }

  if (action === 'delete_session') {
    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    fallbackStore.deleteAttendanceSession(sessionId);
    try {
      await supabase.from('attendance_records').delete().eq('session_id', sessionId);
      await supabase.from('attendance_sessions').delete().eq('id', sessionId);
    } catch {}
    return NextResponse.json({ success: true, deletedSessionId: sessionId });
  }

  if (action === 'extend') {
    const lateUntilMinutes = Math.max(0, Number(body.lateUntilMinutes || 40));
    const existing = fallbackStore.getAttendanceSessions(classroomId).find((s) => s.id === sessionId);
    if (existing) {
      existing.late_until_minutes = lateUntilMinutes;
      existing.status = 'open';
      existing.closed_at = null;
      fallbackStore.saveAttendanceSession(existing);
    }
    try {
      await supabase.from('attendance_sessions').update({ late_until_minutes: lateUntilMinutes, status: 'open', closed_at: null }).eq('id', sessionId);
    } catch {}
    return NextResponse.json({ success: true, sessionId, lateUntilMinutes });
  }

  if (action === 'record') {
    const studentId = typeof body.studentId === 'string' ? body.studentId : '';
    const status = body.status as AttendanceStatus;
    if (!studentId || !['on_time', 'late', 'absent', 'excused'].includes(status)) {
      return NextResponse.json({ error: 'Invalid attendance record' }, { status: 400 });
    }
    const rec: FallbackAttendanceRecord = {
      id: `rec-${Date.now()}`,
      session_id: sessionId,
      classroom_id: classroomId,
      student_id: studentId,
      status,
      checked_at: status === 'absent' ? null : new Date().toISOString(),
      adjusted_at: new Date().toISOString(),
      adjusted_by: userId,
    };
    fallbackStore.saveAttendanceRecord(rec);
    try {
      await supabase.from('attendance_records').upsert({
        session_id: sessionId,
        classroom_id: classroomId,
        student_id: studentId,
        status,
        checked_at: rec.checked_at,
        adjusted_at: rec.adjusted_at,
        adjusted_by: rec.adjusted_by,
      });
    } catch {}
    return NextResponse.json({ record: rec });
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  const classroomId = request.nextUrl.searchParams.get('classroomId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const context = classroomId ? await getTeacherContext(classroomId) : { supabase: null };
  const supabase = context.supabase || createAnonServerSupabaseClient();

  fallbackStore.deleteAttendanceSession(sessionId);
  try {
    await supabase.from('attendance_records').delete().eq('session_id', sessionId);
    await supabase.from('attendance_sessions').delete().eq('id', sessionId);
  } catch {}

  return NextResponse.json({ success: true, deletedSessionId: sessionId });
}
