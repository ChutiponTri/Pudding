import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth/actor';
import { isTeacherOf } from '@/lib/server/access';
import { attendanceQrKey, attendanceQrUrl, QR_ROTATE_MS } from '@/lib/server/attendanceQr';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { loadRoster } from '@/lib/server/roster';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/attendance/qr?classroomId=…&sessionId=…
 * The check-in QR code for the teacher's screen (website or teacher LIFF),
 * asked for again every QR_ROTATE_MS: the code to show now, when it changes,
 * and the class list with each student's status so far (the teacher changes
 * them there). Teachers of the classroom only.
 */
export async function GET(request: NextRequest) {
  const classroomId = request.nextUrl.searchParams.get('classroomId') || '';
  const sessionId = request.nextUrl.searchParams.get('sessionId') || '';
  if (!classroomId || !sessionId) return NextResponse.json({ error: 'classroomId and sessionId are required' }, { status: 400 });
  const actor = await getActor(request);
  if (actor?.kind !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = createServiceSupabaseClient();
  const [{ data: classroom }, { data: session }, { data: records }, roster] = await Promise.all([
    supabase.from('classrooms').select('id, teacher_id, teachers').eq('id', classroomId).maybeSingle(),
    supabase.from('attendance_sessions').select('id, title, status, starts_at, on_time_until_minutes, late_until_minutes').eq('id', sessionId).eq('classroom_id', classroomId).maybeSingle(),
    supabase.from('attendance_records').select('student_id, status, checked_at').eq('session_id', sessionId),
    loadRoster(supabase, classroomId),
  ]);
  if (!classroom || !isTeacherOf(classroom, actor.userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session) return NextResponse.json({ error: 'ไม่พบคาบเช็กชื่อนี้' }, { status: 404 });

  const rows = records || [];
  const byStudent = new Map(rows.map((row) => [row.student_id as string, row]));
  const list = roster.students.map((student) => {
    const record = byStudent.get(student.id) || (student.line_uid ? byStudent.get(student.line_uid) : undefined);
    return {
      id: student.id,
      name: `${student.first_name || ''} ${student.last_name || ''}`.trim() || 'นักเรียน',
      number: student.student_id ? student.student_id.slice(-3) : '',
      status: (record?.status as string | undefined) || null,
      checkedAt: (record?.checked_at as string | undefined) || null,
    };
  });
  const counts = {
    onTime: list.filter((row) => row.status === 'on_time').length,
    late: list.filter((row) => row.status === 'late').length,
    students: list.length,
  };
  if (session.status !== 'open') return NextResponse.json({ open: false, session, counts, students: list });
  const { key, nextAt } = attendanceQrKey(sessionId);
  const url = attendanceQrUrl(classroomId, sessionId, key);
  if (!url) return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า LIFF ของระบบ' }, { status: 503 });
  return NextResponse.json({ open: true, session, counts, students: list, url, nextAt, rotateMs: QR_ROTATE_MS, serverNow: Date.now() });
}
