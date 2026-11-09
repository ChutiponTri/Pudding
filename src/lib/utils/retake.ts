import type { Assignment, User } from '@/types/database';

/**
 * Retake quizzes: a quiz only the chosen students of a classroom may see and
 * take (e.g. after a suspected cheat). Its score replaces the student's score
 * of the original quiz (`retake_of`), so grade books and exports keep one
 * column per quiz; the retake itself is not a column of its own.
 */

type RetakeFields = Pick<Assignment, 'retake_student_ids'>;

/**
 * Only some students may see and take this work: a retake, or a quiz the
 * teacher gave to chosen students only (retake_student_ids without retake_of).
 */
export const isRetake = (a: RetakeFields | null | undefined): boolean => Array.isArray(a?.retake_student_ids);

/** A real retake: chosen students, and its score replaces the original quiz's (retake_of). */
export const isRetakeOf = (a: (RetakeFields & Pick<Assignment, 'retake_of'>) | null | undefined): boolean => isRetake(a) && !!a?.retake_of;

/** Whether a student (any of their ids: users.id, LINE id) may see and take this work. */
export function retakeIncludes(a: RetakeFields, keys: Array<string | null | undefined>): boolean {
  if (!isRetake(a)) return true;
  const ids = new Set(a.retake_student_ids || []);
  return keys.some((key) => !!key && ids.has(key));
}

/** The roster students who take this work: everyone, or only the retake's students. */
export function rosterFor<T extends Pick<User, 'id' | 'line_uid'>>(a: RetakeFields | null | undefined, roster: T[]): T[] {
  if (!a || !isRetake(a)) return roster;
  const ids = new Set(a.retake_student_ids || []);
  return roster.filter((s) => ids.has(s.id) || (!!s.line_uid && ids.has(s.line_uid)));
}

/** Number of students who take this work (classroom size, or the retake's list). */
export const rosterSizeFor = (a: RetakeFields | null | undefined, classroomSize: number): number =>
  a && isRetake(a) ? (a.retake_student_ids || []).length : classroomSize;

/** A retake score on the original quiz's scale (the two quizzes may be worth different points). */
export function scaleRetakeScore(score: number | null | undefined, retakeMax: number, originalMax: number): number | null {
  if (score == null) return null;
  if (!retakeMax || !originalMax || retakeMax === originalMax) return Math.round(Number(score) * 10) / 10;
  return Math.round((Number(score) / retakeMax) * originalMax * 10) / 10;
}
