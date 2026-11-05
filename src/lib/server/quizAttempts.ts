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

/** Counts one more opening of the quiz; null when the database cannot count openings yet. */
export async function recordQuizOpen(supabase: Supabase, assignmentId: string, studentId: string): Promise<QuizAttempt | null> {
  const current = await readQuizAttempt(supabase, assignmentId, studentId);
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
