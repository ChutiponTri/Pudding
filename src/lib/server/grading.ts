import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Question } from '@/types/database';
import { isObjectiveQuestion, scoreObjectiveAnswer } from '@/lib/utils/autoGrade';

type AnswerRow = { id: string; submission_id: string; question_id: string; text_answer?: string | null; teacher_score?: number | null };

const IN_CHUNK = 150;
function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
}

async function answersFor(supabase: SupabaseClient, column: 'submission_id' | 'question_id', ids: string[]) {
  const results = await Promise.all(
    chunk(ids).map((part) =>
      supabase.from('submission_answers').select('id, submission_id, question_id, text_answer, teacher_score').in(column, part)
    )
  );
  const failed = results.find((r) => r.error)?.error;
  if (failed) throw new Error(failed.message);
  return results.flatMap((r) => (r.data || []) as AnswerRow[]);
}

/**
 * Total of a submission: the sum of every question's official score, but only
 * once every question has one. While a written / file answer still waits for
 * the teacher it stays null, so students don't see a partial total and
 * teacher pages keep the work under "to grade".
 */
export function submissionTotal(questions: Pick<Question, 'id'>[], answers: Array<Pick<AnswerRow, 'question_id' | 'teacher_score'>>): number | null {
  const byQuestion = new Map(answers.map((a) => [a.question_id, a.teacher_score]));
  let total = 0;
  for (const q of questions) {
    const score = byQuestion.get(q.id);
    if (score == null) return null;
    total += Number(score);
  }
  return Math.round(total * 10) / 10;
}

/** Recomputes total_score / max_total_score of an assignment's submissions (all, or the given ones). */
export async function recomputeSubmissionTotals(supabase: SupabaseClient, assignmentId: string, submissionIds?: string[]) {
  const { data: questions, error: qError } = await supabase.from('questions').select('id, max_score').eq('assignment_id', assignmentId);
  if (qError) throw new Error(qError.message);
  let ids = submissionIds;
  if (!ids) {
    const { data: subs, error } = await supabase.from('submissions').select('id').eq('assignment_id', assignmentId);
    if (error) throw new Error(error.message);
    ids = (subs || []).map((s) => s.id as string);
  }
  if (!ids.length) return;
  const answers = await answersFor(supabase, 'submission_id', ids);
  const bySubmission = new Map<string, AnswerRow[]>();
  for (const a of answers) bySubmission.set(a.submission_id, [...(bySubmission.get(a.submission_id) || []), a]);
  const qs = (questions || []) as Pick<Question, 'id' | 'max_score'>[];
  const maxTotal = qs.reduce((sum, q) => sum + Number(q.max_score || 0), 0);
  await Promise.all(
    ids.map(async (id) => {
      const { error } = await supabase
        .from('submissions')
        .update({ total_score: submissionTotal(qs, bySubmission.get(id) || []), ...(maxTotal > 0 ? { max_total_score: maxTotal } : {}) })
        .eq('id', id);
      if (error) throw new Error(error.message);
    })
  );
}

/**
 * Re-scores submitted answers of choice questions after their answer key (or
 * options / points) changed. An answer the teacher adjusted by hand (its score
 * differs from what the old key gave) keeps the teacher's score.
 * Returns how many answers were re-scored and how many manual scores were kept.
 */
export async function regradeObjectiveQuestions(
  supabase: SupabaseClient,
  assignmentId: string,
  changes: Array<{ before: Question | null; after: Question }>
) {
  const relevant = changes.filter(({ after }) => isObjectiveQuestion(after));
  let rescored = 0;
  let keptManual = 0;
  if (!relevant.length) return { rescored, keptManual };

  const answers = await answersFor(supabase, 'question_id', relevant.map(({ after }) => after.id));
  const changeFor = new Map(relevant.map((change) => [change.after.id, change]));
  const touched = new Set<string>();
  const now = new Date().toISOString();
  for (const answer of answers) {
    const change = changeFor.get(answer.question_id);
    if (!change) continue;
    const next = scoreObjectiveAnswer(change.after, answer.text_answer);
    const current = answer.teacher_score;
    // Only scores the system set from the old key move; a teacher's own adjustment stays.
    const wasAuto = current == null || !change.before || !isObjectiveQuestion(change.before) || Number(current) === scoreObjectiveAnswer(change.before, answer.text_answer);
    if (!wasAuto) {
      if (Number(current) !== next) keptManual += 1;
      continue;
    }
    if (current != null && Number(current) === next) continue;
    const { error } = await supabase.from('submission_answers').update({ teacher_score: next, graded_at: now, updated_at: now }).eq('id', answer.id);
    if (error) throw new Error(error.message);
    rescored += 1;
    touched.add(answer.submission_id);
  }
  if (touched.size) await recomputeSubmissionTotals(supabase, assignmentId, [...touched]);
  return { rescored, keptManual };
}
