import type { Assignment } from '@/types/database';

type AssignmentDeadlineFields = Pick<Assignment, 'due_date' | 'status_override' | 'extended_until'> &
  Partial<Pick<Assignment, 'is_exam'>>;

/** Answers a student started before a quiz closed still get this long to arrive. */
export const QUIZ_SUBMIT_GRACE_MS = 2 * 60 * 1000;

/**
 * Single source of truth for whether an assignment accepts submissions.
 * Shared by the teacher portal, the student LIFF app, and /api/submissions so
 * every surface agrees on the teacher's deadline override:
 * - force_closed: no submissions accepted
 * - extended:     deadline moves to extended_until
 * - auto:         deadline is due_date
 * After the deadline, homework is still accepted but marked late, while a
 * quiz (is_exam) closes. Pass graceMs on the server so an answer sheet that was
 * sent just before the bell is not rejected because of network delay.
 */
export function getAssignmentWindow(
  assignment: AssignmentDeadlineFields,
  now: number = Date.now(),
  graceMs = 0
) {
  const isForceClosed = assignment.status_override === 'force_closed';
  const extendedUntil = assignment.status_override === 'extended' && assignment.extended_until
    ? new Date(assignment.extended_until).getTime()
    : NaN;
  const dueDate = new Date(assignment.due_date).getTime();
  const deadline = Number.isNaN(extendedUntil) ? dueDate : extendedUntil;
  const hasDeadline = !Number.isNaN(deadline);
  const isPastDeadline = hasDeadline && now > deadline;
  const isQuizClosed = !!assignment.is_exam && hasDeadline && now > deadline + graceMs;

  return {
    isForceClosed,
    isExtended: !Number.isNaN(extendedUntil),
    deadline: hasDeadline ? deadline : null,
    isPastDeadline,
    /** Closed because a quiz's time is up (not a teacher override). */
    isQuizClosed,
    acceptsSubmissions: !isForceClosed && !isQuizClosed,
  };
}

export type AssignmentStatusTone = 'open' | 'extended' | 'closed';

/**
 * Status badge shared by the teacher portal and the student LIFF app. Past the
 * deadline an assignment is shown as closed; homework still takes late work,
 * so `note` says so.
 */
export function getAssignmentStatus(window: ReturnType<typeof getAssignmentWindow>, isExam?: boolean) {
  if (window.isForceClosed) {
    return { tone: 'closed' as AssignmentStatusTone, label: 'ปิดรับแล้ว', note: 'คุณครูปิดรับงานนี้แล้ว' };
  }
  if (window.isPastDeadline) {
    return isExam
      ? { tone: 'closed' as AssignmentStatusTone, label: 'ปิดแล้ว · หมดเวลา', note: 'หมดเวลาทำข้อสอบ' }
      : { tone: 'closed' as AssignmentStatusTone, label: 'ปิดแล้ว · เลยกำหนดส่ง', note: 'ยังส่งได้ แต่จะบันทึกว่าส่งช้า' };
  }
  if (window.isExtended) {
    return { tone: 'extended' as AssignmentStatusTone, label: 'ขยายเวลา', note: '' };
  }
  return { tone: 'open' as AssignmentStatusTone, label: 'เปิดรับอยู่', note: '' };
}

export const ASSIGNMENT_STATUS_CLASSES: Record<AssignmentStatusTone, string> = {
  open: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900',
  extended: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-900',
  closed: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-900',
};
