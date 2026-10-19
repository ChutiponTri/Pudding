import type { Assignment } from '@/types/database';

type AssignmentDeadlineFields = Pick<Assignment, 'due_date' | 'status_override' | 'extended_until'>;

/**
 * Single source of truth for whether an assignment accepts submissions.
 * Shared by the teacher portal, the student LIFF app, and /api/submissions so
 * every surface agrees on the teacher's deadline override:
 * - force_closed: no submissions accepted
 * - extended:     deadline moves to extended_until
 * - auto:         deadline is due_date; later submissions are accepted as late
 */
export function getAssignmentWindow(assignment: AssignmentDeadlineFields, now: number = Date.now()) {
  const isForceClosed = assignment.status_override === 'force_closed';
  const extendedUntil = assignment.status_override === 'extended' && assignment.extended_until
    ? new Date(assignment.extended_until).getTime()
    : NaN;
  const dueDate = new Date(assignment.due_date).getTime();
  const deadline = Number.isNaN(extendedUntil) ? dueDate : extendedUntil;

  return {
    isForceClosed,
    isExtended: !Number.isNaN(extendedUntil),
    deadline: Number.isNaN(deadline) ? null : deadline,
    isPastDeadline: !Number.isNaN(deadline) && now > deadline,
    acceptsSubmissions: !isForceClosed,
  };
}
