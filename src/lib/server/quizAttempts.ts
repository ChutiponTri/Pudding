import 'server-only';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

/** A student's openings of one quiz (see quizExit.ts). */
export interface QuizAttempt {
  openCount: number;
  /** Times the quiz was left without handing in: every opening after the first. */
  exits: number;
  /** ISO time of every opening, oldest first. */
  openedAt: string[];
}

const attemptId = (assignmentId: string, studentId: string) => `att-${assignmentId}-${studentId}`;

/** Databases without supabase_quiz_exit_update.sql: openings are simply not counted. */
const isMissingTable = (error: { message?: string; code?: string } | null) =>
  !!error && (error.code === '42P01' || error.code === 'PGRST205' || /quiz_attempts/.test(error.message || ''));

/**
 * How often the student has opened (and left) the quiz so far; no row = never
 * opened. null when the database cannot count openings yet.
 */
export async function readQuizAttempt(supabase: Supabase, assignmentId: string, studentId: string): Promise<QuizAttempt | null> {
  const { data, error } = await supabase
    .from('quiz_attempts')
    .select('open_count, opened_at')
    .eq('id', attemptId(assignmentId, studentId))
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  const openCount = Math.max(0, Number(data?.open_count || 0));
  const openedAt = Array.isArray(data?.opened_at) ? (data.opened_at as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  return { openCount, exits: Math.max(0, openCount - 1), openedAt };
}

/**
 * Counts one more opening of the quiz; null when the database cannot count openings yet.
 * Pass `current` when it was already read (saves a round trip).
 */
export async function recordQuizOpen(
  supabase: Supabase,
  assignmentId: string,
  studentId: string,
  known?: QuizAttempt | null
): Promise<QuizAttempt | null> {
  const current = known === undefined ? await readQuizAttempt(supabase, assignmentId, studentId) : known;
  if (!current) return null;
  const now = new Date().toISOString();
  const openCount = current.openCount + 1;
  const openedAt = [...current.openedAt, now];
  const { error } = await supabase.from('quiz_attempts').upsert({
    id: attemptId(assignmentId, studentId),
    assignment_id: assignmentId,
    student_id: studentId,
    open_count: openCount,
    opened_at: openedAt,
    updated_at: now,
  });
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return { openCount, exits: openCount - 1, openedAt };
}

/**
 * Opened again after leaving more often than warned: the blank sheet (0 on
 * every question) is handed in right here, in the same request as the
 * opening, instead of a second full hand-in from the phone. Same row and
 * events as POST /api/submissions writes for a forfeited quiz.
 */
export async function handInBlankQuiz(
  supabase: Supabase,
  args: {
    assignmentId: string;
    studentId: string;
    questions: Array<{ id: string; max_score?: number | null }>;
    attempt: QuizAttempt;
    existing: Record<string, unknown> | null;
    isPastDeadline: boolean;
    submittedBy: string | null;
  }
) {
  const { assignmentId, studentId, questions, attempt, existing, isPastDeadline, submittedBy } = args;
  const subId = (existing?.id as string | undefined) || `sub-${assignmentId}-${studentId}`;
  const now = new Date();
  const maxTotal = questions.reduce((sum, q) => sum + Number(q.max_score || 0), 0) || 20;
  const row: Record<string, unknown> = {
    id: subId,
    assignment_id: assignmentId,
    student_id: studentId,
    status: isPastDeadline ? 'late' : 'submitted',
    started_at: new Date(now.getTime() - 120000).toISOString(),
    submitted_at: now.toISOString(),
    time_spent_seconds: 120,
    tab_switch_count: 0,
    total_time_away_seconds: 0,
    is_flagged_suspicious: true,
    total_score: 0,
    max_total_score: maxTotal,
    quiz_exit_count: attempt.exits,
    auto_forfeited: true,
    ...(submittedBy ? { submitted_by: submittedBy } : {}),
    ...(existing && 'reopened_at' in existing ? { reopened_at: null } : {}),
    ...(existing && 'reopen_until' in existing ? { reopen_until: null } : {}),
  };
  let { error } = await supabase.from('submissions').upsert(row);
  if (error?.message?.includes('submitted_by')) {
    const { submitted_by: _unused, ...withoutSender } = row;
    ({ error } = await supabase.from('submissions').upsert(withoutSender));
  }
  if (error) throw error;

  const reopenedAt = attempt.openedAt.slice(1);
  await Promise.all([
    (async () => {
      // A row the teacher recorded earlier may carry old answers: the blank sheet replaces them.
      if (existing) {
        const { error: clearError } = await supabase.from('submission_answers').delete().eq('submission_id', subId);
        if (clearError) throw clearError;
      }
      if (!questions.length) return;
      const { error: answerError } = await supabase.from('submission_answers').upsert(
        questions.map((q) => ({
          id: `ans-${subId}-${q.id}`,
          submission_id: subId,
          question_id: q.id,
          text_answer: '',
          file_url: null,
          teacher_score: 0,
        })),
        { onConflict: 'submission_id,question_id' }
      );
      if (answerError) throw answerError;
    })(),
    reopenedAt.length
      ? supabase
          .from('submission_events')
          .insert(
            reopenedAt.map((at, i) => ({
              id: `evt-${subId}-reopen-${i + 1}`,
              submission_id: subId,
              event_type: 'quiz_reopened',
              away_duration_seconds: 0,
              created_at: at,
              details:
                i === reopenedAt.length - 1
                  ? `ปิดข้อสอบแล้วเปิดใหม่ ครั้งที่ ${i + 1} — เกินจำนวนที่เตือนไว้ ระบบส่งกระดาษเปล่าอัตโนมัติ (0 คะแนน)`
                  : `ปิดข้อสอบแล้วเปิดใหม่ ครั้งที่ ${i + 1} (เตือนแล้ว)`,
            }))
          )
          .then(({ error: eventError }) => {
            // Supplementary: the hand-in itself is saved.
            if (eventError) console.warn('[handInBlankQuiz] reopen event write warning:', eventError);
          })
      : Promise.resolve(),
  ]);
  return { ...row, id: subId, answers: questions.map((q) => ({ question_id: q.id, answer_text: '', file_url: null })) };
}
