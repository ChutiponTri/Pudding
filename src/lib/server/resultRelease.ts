import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Assignment, Question, Submission, SubmissionAnswer } from '@/types/database';
import { getAssignmentWindow, QUIZ_LATE_GRACE_MS } from '@/lib/utils/assignmentWindow';
import { isHandedIn, isReopenActive, REOPEN_GRACE_MS } from '@/lib/utils/gradingStatus';

/**
 * When students see the results of work they handed in: scores (choice /
 * true-false ones are scored the moment work is handed in), the total, and
 * the teacher's comments.
 *
 * Until then the student only sees that the work was handed in, and can read
 * their own answers. Results show once both hold:
 * - the work is closed: it no longer takes anything (a quiz 10 minutes after
 *   its time, homework once its late window ends, or the teacher closed it),
 *   and no student still holds a running "Allow edit" / "Allow hand-in"
 *   permission (answers could still spread);
 * - the teacher has finished grading this student's work (total_score is set
 *   only once every question has an official score).
 * Teachers always see everything.
 */

type Supabase = SupabaseClient;
const IN_CHUNK = 40;
const PAGE = 1000;

function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Every row of a filtered read (PostgREST returns at most PAGE per request). */
async function readAll<T>(run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

type SubRow = Pick<Submission, 'assignment_id' | 'student_id' | 'status' | 'reopened_at' | 'reopen_until'>;

/** Rows still holding a teacher's per-student permission (only those can keep work open). */
async function loadReopenRows(supabase: Supabase, assignmentIds: string[]): Promise<SubRow[]> {
  const read = () =>
    Promise.all(
      chunk(assignmentIds, 10).map((part) =>
        readAll<SubRow>((from, to) =>
          supabase
            .from('submissions')
            .select('assignment_id, student_id, status, reopened_at, reopen_until')
            .in('assignment_id', part)
            .not('reopened_at', 'is', null)
            .range(from, to)
        )
      )
    ).then((parts) => parts.flat());
  try {
    return await read();
  } catch (error) {
    // Databases without the reopen columns yet: nobody holds a permission.
    if (!(error instanceof Error) || !/reopen/.test(error.message)) throw error;
    return [];
  }
}

export type ResultRelease = {
  /** Assignments whose results the student may not see yet. */
  hidden: Set<string>;
  /** Every question id of those assignments: their scores and comments stay out of the student's copy. */
  hiddenQuestionIds: Set<string>;
};

/**
 * Decides, for the student's handed-in work, which assignments still hide
 * their results (see above). Only work the student handed in is checked
 * (the rest has nothing to hide). `total_score` of the student's own
 * submission says whether the teacher has finished grading it.
 */
export async function resultRelease(
  supabase: Supabase,
  assignments: Array<Pick<Assignment, 'id' | 'classroom_id' | 'due_date' | 'status_override' | 'extended_until' | 'is_exam' | 'publish_at' | 'retake_student_ids' | 'is_survey'>>,
  ownSubmissions: Array<Pick<Submission, 'assignment_id' | 'status'> & { total_score?: number | null }>,
  now: number = Date.now()
): Promise<ResultRelease> {
  const own = new Map(ownSubmissions.filter((s) => isHandedIn(s)).map((s) => [s.assignment_id, s]));
  // กิจกรรม has no score to hold back: the teacher's feedback shows at once.
  const candidates = assignments.filter((a) => own.has(a.id) && !a.is_survey);
  const empty: ResultRelease = { hidden: new Set(), hiddenQuestionIds: new Set() };
  if (!candidates.length) return empty;

  const result: ResultRelease = { hidden: new Set(), hiddenQuestionIds: new Set() };
  // Not finished grading, or still taking work: hidden without asking anything else.
  const stillOpen: string[] = [];
  for (const a of candidates) {
    const graded = own.get(a.id)?.total_score != null;
    if (!graded || getAssignmentWindow(a, now, QUIZ_LATE_GRACE_MS).acceptsSubmissions) result.hidden.add(a.id);
    else stillOpen.push(a.id);
  }
  // Closed and graded: hidden only while some student still holds a running permission
  // (same grace the server gives one: a sheet already on its way).
  if (stillOpen.length) {
    const reopenRows = await loadReopenRows(supabase, stillOpen);
    for (const row of reopenRows) if (isReopenActive(row, now, REOPEN_GRACE_MS)) result.hidden.add(row.assignment_id);
  }
  if (!result.hidden.size) return result;
  const hiddenIds = [...result.hidden];
  const questions = (
    await Promise.all(
      chunk(hiddenIds).map((part) =>
        readAll<Pick<Question, 'id'>>((from, to) => supabase.from('questions').select('id').in('assignment_id', part).range(from, to))
      )
    )
  ).flat();
  for (const q of questions) result.hiddenQuestionIds.add(q.id);
  return result;
}

/** Student copy of a handed-in submission whose results are hidden: no total yet, flagged. */
export function maskSubmission<T extends Partial<Pick<Submission, 'total_score' | 'status'>>>(sub: T): T & { results_hidden?: boolean } {
  if (!isHandedIn(sub as Pick<Submission, 'status'>)) return sub;
  return { ...sub, total_score: null as unknown as undefined, results_hidden: true };
}

/** Student copy of an answer: scores and comments stay out while the results are hidden. */
export function maskAnswer<T extends Partial<SubmissionAnswer> & { question_id: string }>(answer: T, hiddenQuestionIds: Set<string>): T {
  if (!hiddenQuestionIds.has(answer.question_id)) return answer;
  return { ...answer, teacher_score: null as unknown as undefined, teacher_comment: null as unknown as undefined, graded_at: null as unknown as undefined };
}

/** resultRelease when only the student's submissions are at hand (loads their assignments first). */
export async function resultReleaseForSubmissions(
  supabase: Supabase,
  ownSubmissions: Array<Pick<Submission, 'assignment_id' | 'status'> & { total_score?: number | null }>,
  now: number = Date.now()
): Promise<ResultRelease> {
  const ids = [...new Set(ownSubmissions.filter((s) => isHandedIn(s)).map((s) => s.assignment_id))];
  if (!ids.length) return { hidden: new Set(), hiddenQuestionIds: new Set() };
  const assignments = (
    await Promise.all(
      chunk(ids).map((part) =>
        readAll<Assignment>((from, to) => supabase.from('assignments').select('*').in('id', part).range(from, to))
      )
    )
  ).flat();
  return resultRelease(supabase, assignments, ownSubmissions, now);
}
