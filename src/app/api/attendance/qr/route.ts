import { NextRequest, NextResponse } from 'next/server';
import { getActor } from '@/lib/auth/actor';
import { isTeacherOf } from '@/lib/server/access';
import { attendanceQrKey, attendanceQrUrl, QR_ROTATE_MS } from '@/lib/server/attendanceQr';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/attendance/qr?classroomId=…&sessionId=…
 * The check-in QR code for the teacher's screen (website or teacher LIFF),
 * asked for again every QR_ROTATE_MS: the code to show now, when it changes,
 * and how many students have checked in so far. Teachers of the classroom only.
 */
export async function GET(request: NextRequest) {
  const classroomId = request.nextUrl.searchParams.get('classroomId') || '';
  const sessionId = request.nextUrl.searchParams.get('sessionId') || '';
  if (!classroomId || !sessionId) return NextResponse.json({ error: 'classroomId and sessionId are required' }, { status: 400 });
  const actor = await getActor(request);
  if (actor?.kind !== 'teacher') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = createServiceSupabaseClient();
  const [{ data: classroom }, { data: session }, { data: records }, { count: students }] = await Promise.all([
    supabase.from('classrooms').select('id, teacher_id, teachers').eq('id', classroomId).maybeSingle(),
    supabase.from('attendance_sessions').select('id, title, status, starts_at, on_time_until_minutes, late_until_minutes').eq('id', sessionId).eq('classroom_id', classroomId).maybeSingle(),
    supabase.from('attendance_records').select('status').eq('session_id', sessionId),
    supabase.from('classroom_students').select('id', { count: 'exact', head: true }).eq('classroom_id', classroomId).eq('status', 'active'),
  ]);
  if (!classroom || !isTeacherOf(classroom, actor.userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!session) return NextResponse.json({ error: 'ไม่พบคาบเช็กชื่อนี้' }, { status: 404 });

  const rows = records || [];
  const counts = {
    onTime: rows.filter((row) => row.status === 'on_time').length,
    late: rows.filter((row) => row.status === 'late').length,
    students: students ?? null,
  };
  if (session.status !== 'open') return NextResponse.json({ open: false, session, counts });
  const { key, nextAt } = attendanceQrKey(sessionId);
  const url = attendanceQrUrl(classroomId, sessionId, key);
  if (!url) return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า LIFF ของระบบ' }, { status: 503 });
  return NextResponse.json({ open: true, session, counts, url, nextAt, rotateMs: QR_ROTATE_MS, serverNow: Date.now() });
}
