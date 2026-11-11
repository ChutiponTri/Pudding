import type { Assignment } from '@/types/database';

/** งานกลุ่ม: homework (not a quiz or an activity) with group_size of 2 or more. */
export const isGroupWork = (a: Pick<Assignment, 'group_size' | 'is_exam' | 'is_survey'> | null | undefined) =>
  !!a && !a.is_exam && !a.is_survey && Number(a.group_size) >= 2;

/**
 * How many hand-ins wait for grading. Group work has one copy per member, all
 * with the same submitted_at, so each group counts once.
 */
export function countToGrade(
  rows: Array<{ submitted_at?: string | null }>,
  groupWork: boolean
): number {
  if (!groupWork) return rows.length;
  return new Set(rows.map((row, i) => row.submitted_at || `#${i}`)).size;
}
