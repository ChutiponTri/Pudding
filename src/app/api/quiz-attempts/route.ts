import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getActor } from '@/lib/auth/actor';
import { classroomRole, errorResponse, HttpError, loadClassroom, requireStudent } from '@/lib/server/access';
import { resolveProxyStudent } from '@/lib/server/proxyStudent';
import { recordQuizOpen } from '@/lib/server/quizAttempts';
import { getAssignmentWindow, QUIZ_LATE_GRACE_MS } from '@/lib/utils/assignmentWindow';
import { isHandedIn, isReopenActive, REOPEN_GRACE_MS } from '@/lib/utils/gradingStatus';
import { quizExitWarnings, quizOpenAction, type QuizOpenResult } from '@/lib/utils/quizExit';
import { retakeIncludes } from '@/lib/utils/retake';
import type { Classroom } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const untracked: QuizOpenResult = { action: 'start', exits: 0, warnings: 0, tracked: false };

/**
 * POST /api/quiz-attempts { assignment_id, proxy_student_number? }
 * The student is opening a quiz. Counted on the server, so closing LINE and
 * opening the quiz again cannot wipe the record of having left it; the answer
 * says whether to start, warn, or hand in a blank sheet (quizExit.ts).
 */
export async function POST(request: NextRequest) {
  try {
    const actor = requireStudent(await getActor(request));
    const body = await request.json().catch(() => ({}));
    const assignmentId = typeof body.assignment_id === 'string' ? body.assignment_id : '';
    if (!assignmentId) throw new HttpError(400, 'assignment_id is required');

    const supabase = createServiceSupabaseClient();
    const [{ data: assignment }, { count: questionCount }] = await Promise.all([
      supabase.from('assignments').select('*').eq('id', assignmentId).maybeSingle(),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('assignment_id', assignmentId),
    ]);
    if (!assignment) throw new HttpError(404, 'ไม่พบข้อสอบนี้ในระบบ อาจถูกลบไปแล้ว');
    if (!assignment.is_exam) return NextResponse.json(untracked);

    const classroom = await loadClassroom(supabase, assignment.classroom_id);
    if (!classroom || (await classroomRole(supabase, actor, classroom as Classroom)) !== 'student') {
      throw new HttpError(403, 'คุณยังไม่ได้อยู่ในห้องเรียนนี้ หรือยังรอคุณครูอนุมัติ');
    }
    const proxyStudent = body.proxy_student_number
      ? await resolveProxyStudent(supabase, actor, classroom as Classroom, body.proxy_student_number)
      : null;
    if (!retakeIncludes(assignment, proxyStudent ? [proxyStudent.id, proxyStudent.line_uid || ''] : actor.keys)) {
      throw new HttpError(403, 'ข้อสอบนี้เป็นการสอบซ่อมสำหรับนักเรียนที่คุณครูเลือกเท่านั้น');
    }
    const ownerId = proxyStudent?.id || actor.userId;

    // Only an opening that could lead to a hand-in counts.
    const { data: existing } = await supabase
      .from('submissions')
      .select('*')
      .eq('assignment_id', assignmentId)
      .eq('student_id', ownerId)
      .maybeSingle();
    if (existing && isHandedIn(existing)) return NextResponse.json(untracked);
    const quizWindow = getAssignmentWindow(assignment, Date.now(), QUIZ_LATE_GRACE_MS);
    if (!quizWindow.acceptsSubmissions && !(existing && isReopenActive(existing, Date.now(), REOPEN_GRACE_MS))) {
      throw new HttpError(409, `หมดเวลาทำข้อสอบ “${assignment.title}” แล้ว`);
    }

    const attempt = await recordQuizOpen(supabase, assignmentId, ownerId);
    if (!attempt) {
      console.warn('[POST /api/quiz-attempts] quiz_attempts is missing; run supabase_quiz_exit_update.sql');
      return NextResponse.json(untracked);
    }
    const questions = questionCount || 0;
    const result: QuizOpenResult = {
      action: quizOpenAction(attempt.exits, questions),
      exits: attempt.exits,
      warnings: quizExitWarnings(questions),
      tracked: true,
    };
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
