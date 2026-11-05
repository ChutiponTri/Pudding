import { after, NextRequest, NextResponse } from 'next/server';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getActor } from '@/lib/auth/actor';
import { classroomRole, errorResponse, HttpError, requireStudent } from '@/lib/server/access';
import { resolveProxyStudent } from '@/lib/server/proxyStudent';
import { handInBlankQuiz, readQuizAttempt, recordQuizOpen } from '@/lib/server/quizAttempts';
import { maskSubmission } from '@/lib/server/resultRelease';
import { syncRetakeScores } from '@/lib/server/retake';
import { getAssignmentWindow, QUIZ_LATE_GRACE_MS } from '@/lib/utils/assignmentWindow';
import { isHandedIn, isReopenActive, REOPEN_GRACE_MS } from '@/lib/utils/gradingStatus';
import { quizExitWarnings, quizOpenAction, type QuizOpenResult } from '@/lib/utils/quizExit';
import { isRetake, retakeIncludes } from '@/lib/utils/retake';
import type { Assignment, Classroom, Submission } from '@/types/database';

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
    const proxyNumber = typeof body.proxy_student_number === 'string' ? body.proxy_student_number : '';
    // Own phone: the student is known already, so their row and openings load alongside the quiz
    // (one round instead of four). A borrowed phone needs the classroom first to find the classmate.
    const ownRows = (studentId: string) =>
      Promise.all([
        supabase.from('submissions').select('*').eq('assignment_id', assignmentId).eq('student_id', studentId).maybeSingle(),
        readQuizAttempt(supabase, assignmentId, studentId),
      ]);
    const [{ data: assignmentRow }, ownEarly] = await Promise.all([
      supabase.from('assignments').select('*, classroom:classrooms(id, students, pending_students), questions(id, max_score)').eq('id', assignmentId).maybeSingle(),
      proxyNumber ? Promise.resolve(null) : ownRows(actor.userId),
    ]);
    if (!assignmentRow) throw new HttpError(404, 'ไม่พบข้อสอบนี้ในระบบ อาจถูกลบไปแล้ว');
    const { classroom, questions, ...assignment } = assignmentRow as Assignment & {
      classroom: Classroom | null;
      questions: Array<{ id: string; max_score: number | null }> | null;
    };
    if (!assignment.is_exam) return NextResponse.json(untracked);

    if (!classroom || (await classroomRole(supabase, actor, classroom)) !== 'student') {
      throw new HttpError(403, 'คุณยังไม่ได้อยู่ในห้องเรียนนี้ หรือยังรอคุณครูอนุมัติ');
    }
    const proxyStudent = proxyNumber ? await resolveProxyStudent(supabase, actor, classroom, proxyNumber) : null;
    if (!retakeIncludes(assignment, proxyStudent ? [proxyStudent.id, proxyStudent.line_uid || ''] : actor.keys)) {
      throw new HttpError(403, 'ข้อสอบนี้เป็นการสอบซ่อมสำหรับนักเรียนที่คุณครูเลือกเท่านั้น');
    }
    const ownerId = proxyStudent?.id || actor.userId;
    const [{ data: existing }, current] = ownEarly || (await ownRows(ownerId));

    // Only an opening that could lead to a hand-in counts.
    if (existing && isHandedIn(existing)) return NextResponse.json(untracked);
    const quizWindow = getAssignmentWindow(assignment, Date.now(), QUIZ_LATE_GRACE_MS);
    if (!quizWindow.acceptsSubmissions && !(existing && isReopenActive(existing, Date.now(), REOPEN_GRACE_MS))) {
      throw new HttpError(409, `หมดเวลาทำข้อสอบ “${assignment.title}” แล้ว`);
    }

    const attempt = await recordQuizOpen(supabase, assignmentId, ownerId, current);
    if (!attempt) {
      console.warn('[POST /api/quiz-attempts] quiz_attempts is missing; run supabase_quiz_exit_update.sql');
      return NextResponse.json(untracked);
    }
    const questionList = questions || [];
    const result: QuizOpenResult = {
      action: quizOpenAction(attempt.exits, questionList.length),
      exits: attempt.exits,
      warnings: quizExitWarnings(questionList.length),
      tracked: true,
    };
    if (result.action !== 'forfeit') return NextResponse.json(result);

    // Left more often than warned: the blank sheet is handed in now, in this same request.
    const submission = await handInBlankQuiz(supabase, {
      assignmentId,
      studentId: ownerId,
      questions: questionList,
      attempt,
      existing: existing as Record<string, unknown> | null,
      isPastDeadline: quizWindow.isPastDeadline,
      submittedBy: proxyStudent ? actor.userId : null,
    });
    if (isRetake(assignment)) {
      try {
        await syncRetakeScores(supabase, assignment, [submission.id]);
      } catch (syncError) {
        console.error('[POST /api/quiz-attempts] Retake score sync failed:', syncError);
      }
    }
    after(() => signalClassroom(assignment.classroom_id, { type: 'submission', assignmentId }));
    // The quiz still takes work (checked above), so its results stay hidden like any hand-in.
    return NextResponse.json({ ...result, submission: maskSubmission(submission as unknown as Submission) });
  } catch (error) {
    return errorResponse(error);
  }
}
