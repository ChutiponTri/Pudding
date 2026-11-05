import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getActor } from '@/lib/auth/actor';
import { classroomRole, errorResponse, HttpError, requireStudent } from '@/lib/server/access';
import { resolveProxyStudent } from '@/lib/server/proxyStudent';
import { AWAY_EVENT_TYPES, recordAwayEvent, type AwayEvent } from '@/lib/server/quizAttempts';
import type { Classroom } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/quiz-attempts/away
 * { assignment_id, proxy_student_number?, event: { id, event_type, started_at, duration_seconds, details? } }
 *
 * One trip away from a quiz, saved while it happens: once when the student
 * leaves (duration 0, sent with keepalive as the page hides) and again when
 * they come back. The hand-in merges these with the phone's own report, so
 * closing LINE mid-quiz cannot erase time spent elsewhere.
 */
export async function POST(request: NextRequest) {
  try {
    const actor = requireStudent(await getActor(request));
    const body = await request.json().catch(() => ({}));
    const assignmentId = typeof body.assignment_id === 'string' ? body.assignment_id : '';
    const raw = body.event && typeof body.event === 'object' ? body.event : null;
    if (!assignmentId || !raw) throw new HttpError(400, 'assignment_id and event are required');

    const id = typeof raw.id === 'string' ? raw.id.slice(0, 64) : '';
    const eventType = typeof raw.event_type === 'string' ? raw.event_type : '';
    const startedAt = typeof raw.started_at === 'string' && !Number.isNaN(Date.parse(raw.started_at)) ? new Date(raw.started_at) : null;
    if (!id || !(AWAY_EVENT_TYPES as readonly string[]).includes(eventType) || !startedAt) throw new HttpError(400, 'invalid event');
    // Never in the future, never before a day ago (a phone clock may be a little off).
    const now = Date.now();
    const started = new Date(Math.min(now, Math.max(now - 86_400_000, startedAt.getTime())));
    const event: AwayEvent = {
      id,
      event_type: eventType as AwayEvent['event_type'],
      started_at: started.toISOString(),
      duration_seconds: Math.max(0, Math.min(86_400, Math.round(Number(raw.duration_seconds) || 0))),
      details: typeof raw.details === 'string' ? raw.details.slice(0, 300) : undefined,
    };

    const supabase = createServiceSupabaseClient();
    const { data: assignment } = await supabase
      .from('assignments')
      .select('id, is_exam, classroom:classrooms(id, students, pending_students)')
      .eq('id', assignmentId)
      .maybeSingle();
    if (!assignment) throw new HttpError(404, 'ไม่พบข้อสอบนี้ในระบบ');
    // Homework is not tracked.
    if (!assignment.is_exam) return NextResponse.json({ saved: false });
    const classroom = assignment.classroom as unknown as Classroom | null;
    if (!classroom || (await classroomRole(supabase, actor, classroom)) !== 'student') {
      throw new HttpError(403, 'คุณยังไม่ได้อยู่ในห้องเรียนนี้');
    }
    const proxyNumber = typeof body.proxy_student_number === 'string' ? body.proxy_student_number : '';
    const proxyStudent = proxyNumber ? await resolveProxyStudent(supabase, actor, classroom, proxyNumber) : null;

    const saved = await recordAwayEvent(supabase, assignmentId, proxyStudent?.id || actor.userId, event);
    return NextResponse.json({ saved });
  } catch (error) {
    return errorResponse(error);
  }
}
