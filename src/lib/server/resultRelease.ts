import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Assignment, Classroom, Question, Submission, SubmissionAnswer } from '@/types/database';
import { getAssignmentWindow, QUIZ_LATE_GRACE_MS } from '@/lib/utils/assignmentWindow';
import { isObjectiveQuestion } from '@/lib/utils/autoGrade';
import { isHandedIn, isReopenActive } from '@/lib/utils/gradingStatus';

/**
 * When students see the scores of choice / true-false questions.
 *
 * Those questions are scored the moment work is handed in. Showing that
 * score (right / wrong per question, and the total) while classmates can
 * still hand in would let answers spread, so students only see it once
 * nobody can hand in any more:
 * - the work no longer takes anything (a quiz 10 minutes after its time,
 *   homework once its late window ends, or the teacher closed it), or
 * - every student on the roster has handed in,
 * and in both cases no student still holds a running "Allow edit" /
 * "Allow hand-in" permission. Written and file answers are unaffected (the
 * teacher grades them by hand). Teachers always see everything.
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

async function loadSubmissionRows(supabase: Supabase, assignmentIds: string[]): Promise<SubRow[]> {
  const read = (columns: string) =>
    Promise.all(
      chunk(assignmentIds, 10).map((part) =>
        readAll<SubRow>((from, to) => supabase.from('submissions').select(columns).in('assignment_id', part).range(from, to))
      )
    ).then((parts) => parts.flat());
  try {
    return await read('assignment_id, student_id, status, reopened_at, reopen_until');
  } catch (error) {
    // Databases without the reopen columns yet.
    if (!(error instanceof Error) || !/reopen/.test(error.message)) throw error;
    return read('assignment_id, student_id, status');
  }
}

export type ResultRelease = {
  /** Assignments whose choice / true-false results students may not see yet. */
  hidden: Set<string>;
  /** Choice / true-false question ids of those assignments. */
  objectiveQuestionIds: Set<string>;
};

/**
 * Decides, for the student's handed-in work, which assignments still hide
 * their auto-graded results. Only work the student handed in is checked (the
 * rest has nothing to hide); three reads run side by side.
 */
export async function resultRelease(
  supabase: Supabase,
  assignments: Array<Pick<Assignment, 'id' | 'classroom_id' | 'due_date' | 'status_override' | 'extended_until' | 'is_exam' | 'publish_at'>>,
  ownSubmissions: Array<Pick<Submission, 'assignment_id' | 'status'>>,
  now: number = Date.now()
): Promise<ResultRelease> {
  const handedIn = new Set(ownSubmissions.filter((s) => isHandedIn(s)).map((s) => s.assignment_id));
  const candidates = assignments.filter((a) => handedIn.has(a.id));
  const empty: ResultRelease = { hidden: new Set(), objectiveQuestionIds: new Set() };
  if (!candidates.length) return empty;
  const ids = candidates.map((a) => a.id);
  const classroomIds = [...new Set(candidates.map((a) => a.classroom_id))];

  const [questions, rows, classrooms] = await Promise.all([
    Promise.all(
      chunk(ids).map((part) =>
        readAll<Pick<Question, 'id' | 'assignment_id' | 'type'>>((from, to) =>
          supabase.from('questions').select('id, assignment_id, type').in('assignment_id', part).range(from, to)
        )
      )
    ).then((parts) => parts.flat()),
    loadSubmissionRows(supabase, ids),
    Promise.all(
      chunk(classroomIds).map((part) =>
        readAll<Pick<Classroom, 'id' | 'students'>>((from, to) => supabase.from('classrooms').select('id, students').in('id', part).range(from, to))
      )
    ).then((parts) => parts.flat()),
  ]);

  const objectiveByAssignment = new Map<string, string[]>();
  for (const q of questions) {
    if (!isObjectiveQuestion(q)) continue;
    objectiveByAssignment.set(q.assignment_id, [...(objectiveByAssignment.get(q.assignment_id) || []), q.id]);
  }
  const rosterOf = new Map(classrooms.map((c) => [c.id, c.students || []]));
  const rowsOf = new Map<string, SubRow[]>();
  for (const row of rows) rowsOf.set(row.assignment_id, [...(rowsOf.get(row.assignment_id) || []), row]);

  const result: ResultRelease = { hidden: new Set(), objectiveQuestionIds: new Set() };
  for (const a of candidates) {
    const objective = objectiveByAssignment.get(a.id);
    if (!objective?.length) continue;
    const subs = rowsOf.get(a.id) || [];
    let released: boolean;
    if (subs.some((s) => isReopenActive(s, now))) {
      released = false;
    } else if (!getAssignmentWindow(a, now, QUIZ_LATE_GRACE_MS).acceptsSubmissions) {
      released = true;
    } else {
      const done = new Set(subs.filter((s) => isHandedIn(s)).map((s) => s.student_id));
      const roster = rosterOf.get(a.classroom_id) || [];
      released = roster.length > 0 && roster.every((s) => done.has(s.id) || (!!s.line_uid && done.has(s.line_uid)));
    }
    if (released) continue;
    result.hidden.add(a.id);
    for (const id of objective) result.objectiveQuestionIds.add(id);
  }
  return result;
}

/** Student copy of a handed-in submission whose results are hidden: no total yet, flagged. */
export function maskSubmission<T extends Partial<Pick<Submission, 'total_score' | 'status'>>>(sub: T): T & { results_hidden?: boolean } {
  if (!isHandedIn(sub as Pick<Submission, 'status'>)) return sub;
  return { ...sub, total_score: null as unknown as undefined, results_hidden: true };
}

/** Student copy of an answer: choice / true-false scores and comments stay out while hidden. */
export function maskAnswer<T extends Partial<SubmissionAnswer> & { question_id: string }>(answer: T, objectiveQuestionIds: Set<string>): T {
  if (!objectiveQuestionIds.has(answer.question_id)) return answer;
  return { ...answer, teacher_score: null as unknown as undefined, teacher_comment: null as unknown as undefined, graded_at: null as unknown as undefined };
}

/** resultRelease when only the student's submissions are at hand (loads their assignments first). */
export async function resultReleaseForSubmissions(
  supabase: Supabase,
  ownSubmissions: Array<Pick<Submission, 'assignment_id' | 'status'>>,
  now: number = Date.now()
): Promise<ResultRelease> {
  const ids = [...new Set(ownSubmissions.filter((s) => isHandedIn(s)).map((s) => s.assignment_id))];
  if (!ids.length) return { hidden: new Set(), objectiveQuestionIds: new Set() };
  const assignments = (
    await Promise.all(
      chunk(ids).map((part) =>
        readAll<Assignment>((from, to) => supabase.from('assignments').select('*').in('id', part).range(from, to))
      )
    )
  ).flat();
  return resultRelease(supabase, assignments, ownSubmissions, now);
}
