import { randomUUID } from 'node:crypto';
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AttendanceStatus = 'on_time' | 'late' | 'absent' | 'excused';

async function getTeacherContext(classroomId: string) {
  const { userId } = await auth();
  if (!userId) return { userId: null, supabase: null, classroom: null };
  const supabase = createServiceSupabaseClient();
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id, name, teacher_id, teachers, students')
    .eq('id', classroomId)
    .maybeSingle();
  const isTeacher = classroom?.teacher_id === userId
    || (classroom?.teachers || []).some((teacher: { teacher_id?: string }) => teacher.teacher_id === userId);
  return { userId, supabase, classroom: isTeacher ? classroom : null };
}

export async function GET(request: NextRequest) {
  const classroomId = request.nextUrl.searchParams.get('classroomId');
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!classroomId) return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
  const context = await getTeacherContext(classroomId);
  if (!context.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!context.classroom || !context.supabase) return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });

  let sessionQuery = context.supabase
    .from('attendance_sessions')
    .select('*')
    .eq('classroom_id', classroomId)
    .order('starts_at', { ascending: false });
  if (sessionId) sessionQuery = sessionQuery.eq('id', sessionId);
  const { data: sessions, error: sessionsError } = await sessionQuery;
  if (sessionsError) return NextResponse.json({ error: 'Attendance schema is not installed' }, { status: 503 });

  const selectedSession = sessions?.[0] || null;
  const { data: records, error: recordsError } = selectedSession
    ? await context.supabase.from('attendance_records').select('*').eq('session_id', selectedSession.id)
    : { data: [], error: null };
  if (recordsError) return NextResponse.json({ error: 'Unable to load attendance records' }, { status: 500 });
  return NextResponse.json({ sessions: sessions || [], session: selectedSession, records: records || [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const classroomId = typeof body.classroomId === 'string' ? body.classroomId : '';
  if (!classroomId) return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
  const context = await getTeacherContext(classroomId);
  if (!context.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!context.classroom || !context.supabase) return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });

  const action = body.action || 'create';
  if (action === 'create') {
    const startsAt = typeof body.startsAt === 'string' ? body.startsAt : new Date().toISOString();
    const onTimeUntilMinutes = Math.max(0, Number(body.onTimeUntilMinutes ?? 10));
    const lateUntilMinutes = Math.max(onTimeUntilMinutes, Number(body.lateUntilMinutes ?? 30));
    const startsAtDate = new Date(startsAt);
    if (Number.isNaN(startsAtDate.getTime())) return NextResponse.json({ error: 'Invalid startsAt' }, { status: 400 });
    const session = {
      id: randomUUID(),
      classroom_id: classroomId,
      title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'เช็กชื่อ',
      starts_at: startsAtDate.toISOString(),
      on_time_until_minutes: onTimeUntilMinutes,
      late_until_minutes: lateUntilMinutes,
      status: startsAtDate.getTime() > Date.now() ? 'scheduled' : 'open',
      created_by: context.userId,
    };
    const { data: created, error } = await context.supabase.from('attendance_sessions').insert(session).select('*').single();
    if (error) return NextResponse.json({ error: 'สร้างคาบเช็กชื่อไม่สำเร็จ กรุณารัน migration attendance' }, { status: 503 });

    const roster = (context.classroom.students || []) as Array<{ id?: string; line_uid?: string }>;
    const { data: users } = await context.supabase.from('users').select('id, line_uid').eq('role', 'student');
    const userById = new Map((users || []).map((user: { id: string; line_uid?: string }) => [user.id, user.id]));
    const userByLineUid = new Map((users || []).filter((user: { line_uid?: string }) => user.line_uid).map((user: { id: string; line_uid?: string }) => [user.line_uid as string, user.id]));
    const records = roster.map((student) => userById.get(student.id || '') || userByLineUid.get(student.line_uid || '')).filter(Boolean).map((studentId) => ({
      id: randomUUID(), session_id: created.id, classroom_id: classroomId, student_id: studentId, status: 'absent',
    }));
    if (records.length) await context.supabase.from('attendance_records').insert(records);
    return NextResponse.json({ session: created }, { status: 201 });
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (!sessionId) return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  if (action === 'close') {
    const { data, error } = await context.supabase.from('attendance_sessions').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', sessionId).eq('classroom_id', classroomId).select('*').single();
    if (error) return NextResponse.json({ error: 'ปิดรับเช็กชื่อไม่สำเร็จ' }, { status: 500 });
    return NextResponse.json({ session: data });
  }
  if (action === 'extend') {
    const lateUntilMinutes = Math.max(0, Number(body.lateUntilMinutes));
    const { data, error } = await context.supabase.from('attendance_sessions').update({ late_until_minutes: lateUntilMinutes, status: 'open', closed_at: null }).eq('id', sessionId).eq('classroom_id', classroomId).select('*').single();
    if (error) return NextResponse.json({ error: 'เพิ่มเวลาไม่สำเร็จ' }, { status: 500 });
    return NextResponse.json({ session: data });
  }
  if (action === 'record') {
    const studentId = typeof body.studentId === 'string' ? body.studentId : '';
    const status = body.status as AttendanceStatus;
    if (!studentId || !['on_time', 'late', 'absent', 'excused'].includes(status)) return NextResponse.json({ error: 'Invalid attendance record' }, { status: 400 });
    const { data, error } = await context.supabase.from('attendance_records').update({ status, checked_at: status === 'absent' ? null : new Date().toISOString(), adjusted_at: new Date().toISOString(), adjusted_by: context.userId }).eq('session_id', sessionId).eq('classroom_id', classroomId).eq('student_id', studentId).select('*').single();
    if (error) return NextResponse.json({ error: 'ปรับสถานะนักเรียนไม่สำเร็จ' }, { status: 500 });
    return NextResponse.json({ record: data });
  }
  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
}
