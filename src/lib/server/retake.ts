import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Assignment, Submission } from '@/types/database';
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
type OriginalRow = Pick<Submission, 'id' | 'student_id' | 'status' | 'total_score' | 'max_total_score' | 'submitted_at' | 'retake_submission_id' | 'retake_previous'>;

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

/** Puts an original row back the way it was before a retake replaced its score. */
async function restore(supabase: Supabase, row: OriginalRow) {
  const previous = row.retake_previous;
  if (!previous) {
    // The row only existed for the retake (the student had no row on the original quiz).
    const { error } = await supabase.from('submissions').delete().eq('id', row.id);
    if (error) fail(error);
    return;
  }
  const { error } = await supabase
    .from('submissions')
    .update({
      status: previous.status,
      total_score: previous.total_score ?? null,
      max_total_score: previous.max_total_score ?? null,
      submitted_at: previous.submitted_at ?? null,
      retake_submission_id: null,
      retake_previous: null,
    })
    .eq('id', row.id);
  if (error) fail(error);
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

  const originalRows: OriginalRow[] = [];
  for (const part of chunk([...new Set(subs.map((s) => s.student_id))])) {
    const { data, error } = await supabase
      .from('submissions')
      .select('id, student_id, status, total_score, max_total_score, submitted_at, retake_submission_id, retake_previous')
      .eq('assignment_id', originalId)
      .in('student_id', part);
    if (error) fail(error);
    originalRows.push(...((data || []) as OriginalRow[]));
  }
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
    if (!row) {
      const { error } = await supabase.from('submissions').upsert(
        {
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
        },
        { onConflict: 'assignment_id,student_id' }
      );
      if (error) fail(error);
      continue;
    }
    const linked = !!row.retake_submission_id;
    const handedInBefore = isHandedIn(row.retake_previous || row);
    const { error } = await supabase
      .from('submissions')
      .update({
        total_score: score,
        max_total_score: originalMax,
        // Work recorded as "no submission" now counts as handed in (by the retake).
        ...(handedInBefore ? {} : { status: sub.status, submitted_at: sub.submitted_at }),
        retake_submission_id: sub.id,
        // The first link keeps what was there; later syncs keep that snapshot.
        ...(linked
          ? {}
          : { retake_previous: { status: row.status, total_score: row.total_score ?? null, max_total_score: row.max_total_score ?? null, submitted_at: row.submitted_at ?? null } }),
      })
      .eq('id', row.id);
    if (error) fail(error);
  }
}

/** Before a retake is deleted: every original score it replaced comes back. */
export async function unlinkRetake(supabase: Supabase, retake: Pick<Assignment, 'id' | 'retake_of' | 'retake_student_ids'>) {
  if (!isRetake(retake) || !retake.retake_of) return;
  const { data: subs, error } = await supabase.from('submissions').select('id').eq('assignment_id', retake.id);
  if (error) fail(error);
  const ids = (subs || []).map((s) => s.id as string);
  for (const part of chunk(ids)) {
    const { data, error: rowsError } = await supabase
      .from('submissions')
      .select('id, student_id, status, total_score, max_total_score, submitted_at, retake_submission_id, retake_previous')
      .eq('assignment_id', retake.retake_of)
      .in('retake_submission_id', part);
    if (rowsError) fail(rowsError);
    for (const row of (data || []) as OriginalRow[]) await restore(supabase, row);
  }
}

/** After an original quiz's points changed: its retakes rescale the scores they wrote. */
export async function resyncRetakesOf(supabase: Supabase, originalId: string) {
  const { data, error } = await supabase.from('assignments').select('*').eq('retake_of', originalId);
  if (error) return; // databases without retakes
  for (const retake of (data || []) as Assignment[]) await syncRetakeScores(supabase, retake);
}
