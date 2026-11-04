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

/** Of the given submissions, those whose score a retake replaced (none on databases without the column). */
async function retakeReplacedIds(supabase: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!ids.length) return out;
  const results = await Promise.all(
    chunk(ids).map((part) => supabase.from('submissions').select('id').in('id', part).not('retake_submission_id', 'is', null))
  );
  for (const r of results) {
    if (r.error) return new Set();
    for (const row of r.data || []) out.add(row.id as string);
  }
  return out;
}

/**
 * Recomputes total_score / max_total_score of an assignment's submissions (all, or the given ones).
 * Callers that already loaded the assignment's questions pass them to save a round trip.
 */
export async function recomputeSubmissionTotals(
  supabase: SupabaseClient,
  assignmentId: string,
  submissionIds?: string[],
  knownQuestions?: Pick<Question, 'id' | 'max_score'>[]
) {
  // Questions, the submission ids and (when ids are given) the answers load side by side.
  const questionsPromise = knownQuestions
    ? Promise.resolve(knownQuestions)
    : supabase
        .from('questions')
        .select('id, max_score')
        .eq('assignment_id', assignmentId)
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return (data || []) as Pick<Question, 'id' | 'max_score'>[];
        });
  const idsPromise = submissionIds
    ? Promise.resolve(submissionIds)
    : supabase
        .from('submissions')
        .select('id')
        .eq('assignment_id', assignmentId)
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return (data || []).map((s) => s.id as string);
        });
  const answersPromise = idsPromise.then((ids) => (ids.length ? answersFor(supabase, 'submission_id', ids) : []));
  // Rows whose score a retake replaced keep the retake's score (see syncRetakeScores).
  const replacedPromise = idsPromise.then((ids) => retakeReplacedIds(supabase, ids));
  const [qs, allIds, answers, replaced] = await Promise.all([questionsPromise, idsPromise, answersPromise, replacedPromise]);
  const ids = allIds.filter((id) => !replaced.has(id));
  if (!ids.length) return;
  const bySubmission = new Map<string, AnswerRow[]>();
  for (const a of answers) bySubmission.set(a.submission_id, [...(bySubmission.get(a.submission_id) || []), a]);
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
  const updates: Array<{ id: string; score: number }> = [];
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
    updates.push({ id: answer.id, score: next });
    rescored += 1;
    touched.add(answer.submission_id);
  }
  // Each answer gets its own score, so one update per row, sent a batch at a time instead of one after another.
  for (const part of chunk(updates, 25)) {
    const results = await Promise.all(
      part.map(({ id, score }) => supabase.from('submission_answers').update({ teacher_score: score, graded_at: now, updated_at: now }).eq('id', id))
    );
    const failed = results.find((r) => r.error)?.error;
    if (failed) throw new Error(failed.message);
  }
  if (touched.size) await recomputeSubmissionTotals(supabase, assignmentId, [...touched]);
  return { rescored, keptManual };
}

/**
 * A question that stopped being multiple choice / true-false (e.g. a teacher
 * fixing the wrong question type after students handed in): the score the
 * old answer key gave is removed, so the answer goes back to "to grade"
 * instead of keeping a meaningless auto score. Scores a teacher set by hand,
 * and the 0s of students recorded as "no submission", are kept.
 * Returns how many answers were sent back to the teacher.
 */
export async function clearRetiredAutoScores(
  supabase: SupabaseClient,
  changes: Array<{ before: Question; after: Question }>
) {
  const relevant = changes.filter(({ before, after }) => isObjectiveQuestion(before) && !isObjectiveQuestion(after));
  if (!relevant.length) return 0;
  const beforeOf = new Map(relevant.map(({ before }) => [before.id, before]));
  const answers = await answersFor(supabase, 'question_id', [...beforeOf.keys()]);
  const subIds = [...new Set(answers.map((a) => a.submission_id))];
  const handedIn = new Set<string>();
  for (const part of chunk(subIds)) {
    const { data, error } = await supabase.from('submissions').select('id').in('id', part).in('status', ['submitted', 'late']);
    if (error) throw new Error(error.message);
    for (const row of data || []) handedIn.add(row.id as string);
  }
  const ids = answers
    .filter((a) => handedIn.has(a.submission_id) && a.teacher_score != null)
    .filter((a) => Number(a.teacher_score) === scoreObjectiveAnswer(beforeOf.get(a.question_id)!, a.text_answer))
    .map((a) => a.id);
  const now = new Date().toISOString();
  for (const part of chunk(ids)) {
    const { error } = await supabase.from('submission_answers').update({ teacher_score: null, graded_at: null, updated_at: now }).in('id', part);
    if (error) throw new Error(error.message);
  }
  return ids.length;
}

/**
 * Students recorded as "no submission" keep a 0 on every question, also on
 * questions added later (otherwise their total would turn back to missing).
 */
export async function zeroFillNoSubmissions(supabase: SupabaseClient, assignmentId: string, questionIds: string[]) {
  if (!questionIds.length) return;
  const { data, error } = await supabase
    .from('submissions')
    .select('id')
    .eq('assignment_id', assignmentId)
    .eq('status', 'pending')
    .not('total_score', 'is', null);
  if (error) throw new Error(error.message);
  const subIds = (data || []).map((r) => r.id as string);
  if (!subIds.length) return;
  const now = new Date().toISOString();
  const rows = subIds.flatMap((subId) =>
    questionIds.map((qid) => ({
      id: `ans-${subId}-${qid}`,
      submission_id: subId,
      question_id: qid,
      text_answer: '',
      teacher_score: 0,
      graded_at: now,
      updated_at: now,
    }))
  );
  // Existing rows (already 0, or anything the teacher set) stay as they are.
  for (const part of chunk(rows, 500)) {
    const { error: upsertError } = await supabase
      .from('submission_answers')
      .upsert(part, { onConflict: 'submission_id,question_id', ignoreDuplicates: true });
    if (upsertError) throw new Error(upsertError.message);
  }
}
