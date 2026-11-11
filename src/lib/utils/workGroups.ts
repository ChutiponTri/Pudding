import type { Assignment, Classroom, Course, Submission } from '@/types/database';
import { assignmentGroupKey } from '@/components/AssignmentGroupHeader';
import { getAssignmentWindow, isAssignmentPublished } from '@/lib/utils/assignmentWindow';
import { gradingCounts, type GradingCounts } from '@/lib/utils/gradingStatus';
import { isRetake, rosterSizeFor } from '@/lib/utils/retake';
import { isGroupWork } from '@/lib/utils/groupWork';

/**
 * A teacher's "work" as one thing across classrooms. Creating work for several
 * classrooms saves one assignment row per classroom (each with its own
 * students, deadline and LINE post), so the rows are grouped back together by
 * course + type + title. Retakes are per classroom and stay on their own.
 */

/** Category for work no classroom can see yet (drafts and scheduled work). */
export const UNPUBLISHED_CATEGORY = '__unpublished';

export type WorkClass = {
  assignment: Assignment;
  classroom: Classroom;
  counts: GradingCounts;
  window: ReturnType<typeof getAssignmentWindow>;
  published: boolean;
};

export type WorkTotals = Pick<GradingCounts, 'totalStudents' | 'handedIn' | 'graded' | 'pending' | 'checkable' | 'notSubmitted' | 'flagged'>;

export type WorkGroup = {
  key: string;
  /** The oldest row: its id names the group (card colour) and it opens "edit"/"copy". */
  rep: Assignment;
  courseId: string;
  isExam: boolean;
  /** Classwork category key (group name, or the exam / general default). */
  category: string;
  classes: WorkClass[];
  /** At least one classroom can see it. */
  published: boolean;
  /** Published classrooms only. */
  totals: WorkTotals;
  /** Latest deadline among its classrooms (for sorting), or 0. */
  lastDeadline: number;
};

export const EMPTY_TOTALS: WorkTotals = { totalStudents: 0, handedIn: 0, graded: 0, pending: 0, checkable: 0, notSubmitted: 0, flagged: 0 };

export function addTotals(a: WorkTotals, b: WorkTotals): WorkTotals {
  return {
    totalStudents: a.totalStudents + b.totalStudents,
    handedIn: a.handedIn + b.handedIn,
    graded: a.graded + b.graded,
    pending: a.pending + b.pending,
    checkable: a.checkable + b.checkable,
    notSubmitted: a.notSubmitted + b.notSubmitted,
    flagged: a.flagged + b.flagged,
  };
}

const normalizeTitle = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase();

const belongsToCourse = (course: Course, cls: Classroom) => cls.course_id === course.id || !!cls.subject_code?.startsWith(course.code);

/** Course of a row: its own course_id, else its classroom's course. */
export function courseIdOf(assignment: Assignment, classroom: Classroom | undefined, courses: Course[]): string {
  if (assignment.course_id) return assignment.course_id;
  if (classroom?.course_id) return classroom.course_id;
  return (classroom && courses.find((c) => belongsToCourse(c, classroom))?.id) || '';
}

export function workGroupKey(assignment: Assignment, courseId: string) {
  if (isRetake(assignment)) return `retake:${assignment.id}`;
  return `${courseId}|${assignment.is_exam ? 'q' : 'h'}|${normalizeTitle(assignment.title || '')}`;
}

export function buildWorkGroups(
  assignments: Assignment[],
  classrooms: Classroom[],
  courses: Course[],
  submissions: Submission[],
  now: number = Date.now()
): WorkGroup[] {
  const byClassroom = new Map(classrooms.map((c) => [c.id, c]));
  const subsByAssignment = new Map<string, Submission[]>();
  for (const s of submissions) {
    const list = subsByAssignment.get(s.assignment_id);
    if (list) list.push(s);
    else subsByAssignment.set(s.assignment_id, [s]);
  }

  const groups = new Map<string, WorkClass[]>();
  const courseOf = new Map<string, string>();
  for (const assignment of assignments) {
    const classroom = byClassroom.get(assignment.classroom_id);
    if (!classroom) continue;
    const courseId = courseIdOf(assignment, classroom, courses);
    const key = workGroupKey(assignment, courseId);
    const rosterSize = classroom.students?.length || classroom.student_count || 0;
    const item: WorkClass = {
      assignment,
      classroom,
      counts: gradingCounts(subsByAssignment.get(assignment.id) || [], rosterSizeFor(assignment, rosterSize), assignment.is_exam, isGroupWork(assignment)),
      window: getAssignmentWindow(assignment, now),
      published: isAssignmentPublished(assignment, now),
    };
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
    courseOf.set(key, courseId);
  }

  return [...groups.entries()].map(([key, classes]) => {
    classes.sort((a, b) => a.classroom.name.localeCompare(b.classroom.name, 'th', { numeric: true }));
    const byAge = [...classes].sort(
      (a, b) => new Date(a.assignment.created_at || 0).getTime() - new Date(b.assignment.created_at || 0).getTime() || a.assignment.id.localeCompare(b.assignment.id)
    );
    const rep = byAge[0].assignment;
    const published = classes.some((c) => c.published);
    // The category most of its published rows use (all rows if none is published).
    const votes = new Map<string, number>();
    for (const c of classes.filter((x) => x.published || !published)) {
      const k = assignmentGroupKey(c.assignment);
      votes.set(k, (votes.get(k) || 0) + 1);
    }
    const category = [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const totals = classes.filter((c) => c.published).reduce<WorkTotals>((sum, c) => addTotals(sum, c.counts), EMPTY_TOTALS);
    const lastDeadline = Math.max(0, ...classes.map((c) => c.window.deadline || 0));
    return { key, rep, courseId: courseOf.get(key) || '', isExam: !!rep.is_exam, category, classes, published, totals, lastDeadline };
  });
}

/** Where the "grade" button of a work should go first: the class with the most waiting, else the first. */
export function firstClassToGrade(group: WorkGroup): WorkClass {
  const published = group.classes.filter((c) => c.published);
  const pool = published.length ? published : group.classes;
  return [...pool].sort((a, b) => b.counts.pending - a.counts.pending)[0];
}
