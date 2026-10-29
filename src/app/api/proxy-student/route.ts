import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getActor } from '@/lib/auth/actor';
import { classroomRole, errorResponse, FORBIDDEN, HttpError, loadClassroom, requireStudent } from '@/lib/server/access';
import { resolveProxyStudent } from '@/lib/server/proxyStudent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lookups by the last 3 digits could be used to page through classmates'
 * names, so each student gets a few per minute (per server instance; enough
 * to stop trying 000–999, not a hard guarantee).
 */
const LOOKUPS_PER_MINUTE = 10;
const recentLookups = new Map<string, number[]>();
function tooManyLookups(lineUid: string) {
  const now = Date.now();
  const recent = (recentLookups.get(lineUid) || []).filter((t) => now - t < 60_000);
  if (recentLookups.size > 1000) {
    for (const [key, times] of recentLookups) if (!times.some((t) => now - t < 60_000)) recentLookups.delete(key);
  }
  if (recent.length >= LOOKUPS_PER_MINUTE) {
    recentLookups.set(lineUid, recent);
    return true;
  }
  recentLookups.set(lineUid, [...recent, now]);
  return false;
}

/**
 * GET /api/proxy-student?classroomId=…&studentNumber=…
 * A student on a borrowed phone looks up the classmate they will submit for:
 * the classmate's name (to confirm), which of the classroom's work they have
 * already handed in, and which attendance sessions they are already checked in to.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const classroomId = params.get('classroomId') || '';
    if (!classroomId) throw new HttpError(400, 'classroomId is required');
    const supabase = createServiceSupabaseClient();
    const actor = requireStudent(await getActor(request));
    if (tooManyLookups(actor.lineUid)) throw new HttpError(429, 'ค้นหาบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
    const classroom = await loadClassroom(supabase, classroomId);
    if (!classroom) throw new HttpError(404, 'ไม่พบห้องเรียน');
    if ((await classroomRole(supabase, actor, classroom)) !== 'student') throw FORBIDDEN();

    const friend = await resolveProxyStudent(supabase, actor, classroom, params.get('studentNumber'));
    const friendKeys = [friend.id, friend.line_uid].filter(Boolean) as string[];
    const { data: assignments } = await supabase.from('assignments').select('id').eq('classroom_id', classroomId);
    const assignmentIds = (assignments || []).map((a) => a.id);
    const [{ data: submissions }, { data: records }] = await Promise.all([
      assignmentIds.length
        ? supabase.from('submissions').select('assignment_id, status').in('assignment_id', assignmentIds).in('student_id', friendKeys)
        : Promise.resolve({ data: [] as Array<{ assignment_id: string; status: string }> }),
      supabase.from('attendance_records').select('session_id').eq('classroom_id', classroomId).in('student_id', friendKeys),
    ]);

    return NextResponse.json({
      student: {
        first_name: friend.first_name,
        last_name: friend.last_name,
        student_id: friend.student_id,
        avatar_url: friend.avatar_url,
      },
      submittedAssignmentIds: (submissions || []).filter((s) => s.status !== 'pending').map((s) => s.assignment_id),
      checkedSessionIds: (records || []).map((r) => r.session_id),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
