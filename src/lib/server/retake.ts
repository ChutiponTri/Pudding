import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Assignment, ScoreHistoryEntry, Submission } from '@/types/database';
import { isHandedIn } from '@/lib/utils/gradingStatus';
import { isRetake, scaleRetakeScore } from '@/lib/utils/retake';

/**
 * Retake quizzes write their score into the student's row of the original
 * quiz, so every grade book and export keeps one column per quiz. The row's
 * values before the retake are kept in retake_previous and restored when the
 * retake is deleted (or the retake sheet stops counting as handed in).
 */

export const RETAKE_MIGRATION_MESSAGE = 'ฐานข้อมูลยังไม่รองรับการสอบซ่อม กรุณารัน SQL ใน supabase_retake_update.sql ก่อน';

type Supabase = SupabaseClient;
type RetakeSub = Pick<Submission, 'id' | 'student_id' | 'status' | 'total_score' | 'max_total_score' | 'submitted_at'>;
type OriginalRow = Pick<Submission, 'id' | 'student_id' | 'status' | 'total_score' | 'max_total_score' | 'submitted_at' | 'retake_submission_id' | 'retake_previous' | 'score_history'>;
const ORIGINAL_COLUMNS = 'id, student_id, status, total_score, max_total_score, submitted_at, retake_submission_id, retake_previous';

const IN_CHUNK = 100;
function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function fail(error: { message: string }): never {
  if (/retake_/.test(error.message)) throw new Error(RETAKE_MIGRATION_MESSAGE);
  throw new Error(error.message);
}

/** Databases without submissions.score_history (supabase_score_history_update.sql) still work, without the history. */
const missingHistory = (error: { message: string } | null) => !!error && /score_history/.test(error.message);

/** Original rows of these students, with score_history when the column exists. */
async function originalRowsOf(supabase: Supabase, originalId: string, filter: { column: 'student_id' | 'retake_submission_id'; values: string[] }) {
  const rows: OriginalRow[] = [];
  let columns = `${ORIGINAL_COLUMNS}, score_history`;
  for (const part of chunk(filter.values)) {
    let { data, error } = await supabase.from('submissions').select(columns).eq('assignment_id', originalId).in(filter.column, part);
    if (missingHistory(error)) {
      columns = ORIGINAL_COLUMNS;
      ({ data, error } = await supabase.from('submissions').select(columns).eq('assignment_id', originalId).in(filter.column, part));
    }
    if (error) fail(error);
    rows.push(...((data || []) as unknown as OriginalRow[]));
  }
  return rows;
}

/** Updates a submission; score_history is dropped when the database has no such column. */
export async function updateSubmissionRow(supabase: Supabase, id: string, patch: Record<string, unknown>) {
  let { error } = await supabase.from('submissions').update(patch).eq('id', id);
  if (missingHistory(error) && 'score_history' in patch) {
    const { score_history: _unused, ...rest } = patch;
    ({ error } = await supabase.from('submissions').update(rest).eq('id', id));
  }
  if (error) fail(error);
}

/** The row's history with one more entry at the end. */
export const withHistoryEntry = (row: Pick<Submission, 'score_history'>, entry: ScoreHistoryEntry): ScoreHistoryEntry[] => [
  ...(Array.isArray(row.score_history) ? row.score_history : []),
  entry,
];

/** Puts an original row back the way it was before a retake replaced its score. */
async function restore(supabase: Supabase, row: OriginalRow, droppedRetakeId?: string) {
  const previous = row.retake_previous;
  if (!previous) {
    // The row only existed for the retake (the student had no row on the original quiz).
    const { error } = await supabase.from('submissions').delete().eq('id', row.id);
    if (error) fail(error);
    return;
  }
  await updateSubmissionRow(supabase, row.id, {
    status: previous.status,
    total_score: previous.total_score ?? null,
    max_total_score: previous.max_total_score ?? null,
    submitted_at: previous.submitted_at ?? null,
    retake_submission_id: null,
    retake_previous: null,
    // A deleted retake leaves no trace in the history; a reopened retake sheet keeps its entries.
    ...(droppedRetakeId && Array.isArray(row.score_history)
      ? { score_history: row.score_history.filter((e) => !(e.kind === 'retake' && e.source_id === droppedRetakeId)) }
      : {}),
  });
}

/**
 * Copies retake scores into the original quiz (all of the retake's
 * submissions, or the given ones). A handed-in retake sheet replaces the
 * original score, scaled to the original's points (null while written answers
 * wait for grading); a sheet that is no longer handed in gives the original
 * score back.
 */
export async function syncRetakeScores(supabase: Supabase, retake: Assignment, submissionIds?: string[]) {
  if (!isRetake(retake) || !retake.retake_of) return;
  const originalId = retake.retake_of;
  const [{ data: original, error: originalError }, subs] = await Promise.all([
    supabase.from('assignments').select('id, total_points').eq('id', originalId).maybeSingle(),
    (async () => {
      const columns = 'id, student_id, status, total_score, max_total_score, submitted_at';
      if (!submissionIds) {
        const { data, error } = await supabase.from('submissions').select(columns).eq('assignment_id', retake.id);
        if (error) fail(error);
        return (data || []) as RetakeSub[];
      }
      const rows: RetakeSub[] = [];
      for (const part of chunk(submissionIds)) {
        const { data, error } = await supabase.from('submissions').select(columns).in('id', part).eq('assignment_id', retake.id);
        if (error) fail(error);
        rows.push(...((data || []) as RetakeSub[]));
      }
      return rows;
    })(),
  ]);
  if (originalError) fail(originalError);
  if (!original || !subs.length) return;

  const originalRows = await originalRowsOf(supabase, originalId, { column: 'student_id', values: [...new Set(subs.map((s) => s.student_id))] });
  const rowOf = new Map(originalRows.map((r) => [r.student_id, r]));
  const originalMax = Number(original.total_points) || 20;
  const retakeMax = Number(retake.total_points) || 20;

  for (const sub of subs) {
    const row = rowOf.get(sub.student_id);
    if (!isHandedIn(sub)) {
      if (row?.retake_submission_id === sub.id) await restore(supabase, row);
      continue;
    }
    const score = scaleRetakeScore(sub.total_score, Number(sub.max_total_score) || retakeMax, originalMax);
    const entry: ScoreHistoryEntry = {
      kind: 'retake',
      previous_score: row?.total_score ?? null,
      previous_max: row?.max_total_score ?? null,
      previous_status: row?.status ?? 'none',
      at: sub.submitted_at || new Date().toISOString(),
      source_id: retake.id,
    };
    if (!row) {
      const fresh = {
          id: `sub-${originalId}-${sub.student_id}`,
          assignment_id: originalId,
          student_id: sub.student_id,
          status: sub.status,
          started_at: sub.submitted_at,
          submitted_at: sub.submitted_at,
          time_spent_seconds: 0,
          tab_switch_count: 0,
          total_time_away_seconds: 0,
          is_flagged_suspicious: false,
          total_score: score,
          max_total_score: originalMax,
          retake_submission_id: sub.id,
          retake_previous: null,
          score_history: [entry],
        };
      let { error } = await supabase.from('submissions').upsert(fresh, { onConflict: 'assignment_id,student_id' });
      if (missingHistory(error)) {
        const { score_history: _unused, ...rest } = fresh;
        ({ error } = await supabase.from('submissions').upsert(rest, { onConflict: 'assignment_id,student_id' }));
      }
      if (error) fail(error);
      continue;
    }
    const linked = !!row.retake_submission_id;
    const handedInBefore = isHandedIn(row.retake_previous || row);
    await updateSubmissionRow(supabase, row.id, {
        total_score: score,
        max_total_score: originalMax,
        // Work recorded as "no submission" now counts as handed in (by the retake).
        ...(handedInBefore ? {} : { status: sub.status, submitted_at: sub.submitted_at }),
        retake_submission_id: sub.id,
        // The first link keeps what was there; later syncs keep that snapshot.
        ...(linked
          ? {}
          : { retake_previous: { status: row.status, total_score: row.total_score ?? null, max_total_score: row.max_total_score ?? null, submitted_at: row.submitted_at ?? null } }),
        // A retake sheet linked for the first time (or after a re-sit) adds the score it replaced.
        ...(row.retake_submission_id === sub.id ? {} : { score_history: withHistoryEntry(row, entry) }),
      });
  }
}

/** Before a retake is deleted: every original score it replaced comes back. */
export async function unlinkRetake(supabase: Supabase, retake: Pick<Assignment, 'id' | 'retake_of' | 'retake_student_ids'>) {
  if (!isRetake(retake) || !retake.retake_of) return;
  const { data: subs, error } = await supabase.from('submissions').select('id').eq('assignment_id', retake.id);
  if (error) fail(error);
  const ids = (subs || []).map((s) => s.id as string);
  const rows = await originalRowsOf(supabase, retake.retake_of, { column: 'retake_submission_id', values: ids });
  for (const row of rows) await restore(supabase, row, retake.id);
}

/**
 * ให้สอบใหม่ on a retake sheet: the original quiz's row, whose score that
 * sheet wrote, records the score being given up (before the restore).
 */
export async function noteRetakeSheetReset(supabase: Supabase, retake: Pick<Assignment, 'id' | 'retake_of' | 'retake_student_ids'>, retakeSubmissionId: string, at: string) {
  if (!isRetake(retake) || !retake.retake_of) return;
  const [row] = await originalRowsOf(supabase, retake.retake_of, { column: 'retake_submission_id', values: [retakeSubmissionId] });
  if (!row) return;
  await updateSubmissionRow(supabase, row.id, {
    score_history: withHistoryEntry(row, {
      kind: 'reset',
      previous_score: row.total_score ?? null,
      previous_max: row.max_total_score ?? null,
      previous_status: row.status,
      at,
      source_id: retake.id,
    }),
  });
}

/** After an original quiz's points changed: its retakes rescale the scores they wrote. */
export async function resyncRetakesOf(supabase: Supabase, originalId: string) {
  const { data, error } = await supabase.from('assignments').select('*').eq('retake_of', originalId);
  if (error) return; // databases without retakes
  for (const retake of (data || []) as Assignment[]) await syncRetakeScores(supabase, retake);
}
