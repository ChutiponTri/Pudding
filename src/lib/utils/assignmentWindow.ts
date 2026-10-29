import type { Assignment } from '@/types/database';
import { formatDateTime, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';

type AssignmentDeadlineFields = Pick<Assignment, 'due_date' | 'status_override' | 'extended_until'> &
  Partial<Pick<Assignment, 'is_exam' | 'publish_at'>>;

/**
 * A draft is stored with this publish time, so every check that hides
 * unpublished work (student lists, LINE reminders, submissions) covers drafts
 * too. Only the teacher publishes it, from the classwork list or the grading page.
 */
export const DRAFT_PUBLISH_AT = '9999-12-31T00:00:00.000Z';

/** Drafts never published are deleted this long after they were created. */
export const DRAFT_RETENTION_DAYS = 30;
export const DRAFT_RETENTION_MS = DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function isAssignmentDraft(assignment: Partial<Pick<Assignment, 'publish_at'>>) {
  return !!assignment.publish_at && new Date(assignment.publish_at).getUTCFullYear() >= 9999;
}

/** When an unpublished draft is deleted automatically. */
export function draftExpiresAt(assignment: Partial<Pick<Assignment, 'created_at'>>) {
  const created = assignment.created_at ? new Date(assignment.created_at).getTime() : NaN;
  return Number.isNaN(created) ? null : new Date(created + DRAFT_RETENTION_MS).toISOString();
}

/** False while a scheduled assignment's publish time is still ahead (and for drafts). */
export function isAssignmentPublished(assignment: Partial<Pick<Assignment, 'publish_at'>>, now: number = Date.now()) {
  const publishAt = assignment.publish_at ? new Date(assignment.publish_at).getTime() : NaN;
  return Number.isNaN(publishAt) || now >= publishAt;
}

/**
 * A quiz answer sheet that was already open still arrives up to this long
 * after the bell, and is saved as late. Students are never told: their screen
 * shows the quiz closed at its deadline. Server-side (/api/submissions) and
 * teacher-facing text only.
 */
export const QUIZ_LATE_GRACE_MS = 10 * 60 * 1000;
export const QUIZ_LATE_GRACE_MINUTES = QUIZ_LATE_GRACE_MS / (60 * 1000);

/** Homework past its deadline is still accepted (marked late) for this long, then closes by itself. */
export const LATE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const LATE_WINDOW_HOURS = LATE_WINDOW_MS / (60 * 60 * 1000);

/**
 * Single source of truth for whether an assignment accepts submissions.
 * Shared by the teacher portal, the student LIFF app, and /api/submissions so
 * every surface agrees on the teacher's deadline override:
 * - force_closed: no submissions accepted
 * - extended:     deadline moves to extended_until
 * - auto:         deadline is due_date
 * After the deadline, homework is still accepted but marked late for
 * LATE_WINDOW_MS and then closes, while a quiz (is_exam) closes at once. The
 * teacher can still extend (the late window follows the new deadline) or close
 * early. Only the server passes graceMs (QUIZ_LATE_GRACE_MS), so a quiz
 * still takes answer sheets that were open at the bell, as late.
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
  const lateUntil = hasDeadline && !assignment.is_exam ? deadline + LATE_WINDOW_MS : null;
  const isLateClosed = lateUntil !== null && now > lateUntil + graceMs;
  const isDraft = isAssignmentDraft(assignment);
  const isScheduled = !isDraft && !isAssignmentPublished(assignment, now);

  return {
    isForceClosed,
    isExtended: !Number.isNaN(extendedUntil),
    deadline: hasDeadline ? deadline : null,
    isPastDeadline,
    /** Closed because a quiz's time is up (not a teacher override). */
    isQuizClosed,
    /** Homework: late work is accepted until this time (null for quizzes / no deadline). */
    lateUntil,
    /** Closed because homework's late window is over (not a teacher override). */
    isLateClosed,
    /** Not released to students yet (publish_at is in the future). */
    isScheduled,
    /** Saved as a draft: hidden from students until the teacher publishes it. */
    isDraft,
    acceptsSubmissions: !isForceClosed && !isQuizClosed && !isLateClosed && !isScheduled && !isDraft,
  };
}

export type AssignmentStatusTone = 'draft' | 'scheduled' | 'open' | 'late' | 'closed';

/**
 * Teacher-facing acceptance state, kept to three short labels:
 * accepting, accepting late work (homework past its deadline), closed.
 */
export function getAssignmentStatus(
  window: ReturnType<typeof getAssignmentWindow>,
  isExam?: boolean,
  language: 'th' | 'en' = 'th'
) {
  const th = language === 'th';
  if (window.isDraft) {
    return {
      tone: 'draft' as AssignmentStatusTone,
      label: th ? 'ฉบับร่าง' : 'Draft',
      note: th ? 'นักเรียนยังไม่เห็นงานนี้ จนกว่าคุณครูจะกดเผยแพร่' : 'Hidden from students until you publish it',
    };
  }
  if (window.isScheduled && !window.isForceClosed) {
    return {
      tone: 'scheduled' as AssignmentStatusTone,
      label: th ? 'ตั้งเวลาไว้' : 'Scheduled',
      note: th ? 'นักเรียนจะเห็นงานเมื่อถึงเวลาเผยแพร่' : 'Students see it at the publish time',
    };
  }
  if (!window.acceptsSubmissions) {
    return {
      tone: 'closed' as AssignmentStatusTone,
      label: th ? 'ปิดรับงาน' : 'Closed',
      note: window.isForceClosed
        ? th ? 'คุณครูปิดรับงานแล้ว' : 'Closed by the teacher'
        : window.isLateClosed
          ? th ? `ปิดรับอัตโนมัติ (เลยกำหนดส่ง ${LATE_WINDOW_HOURS} ชม.)` : `Closed automatically ${LATE_WINDOW_HOURS}h after the deadline`
          : th ? 'หมดเวลาทำข้อสอบ' : 'Quiz time is over',
    };
  }
  if (window.isPastDeadline && !isExam) {
    return {
      tone: 'late' as AssignmentStatusTone,
      label: th ? 'รับงานส่งช้า' : 'Accepting late',
      note: th
        ? `เลยกำหนดส่งแล้ว งานที่ส่งจะถูกบันทึกว่าส่งช้า • ปิดรับอัตโนมัติ ${formatLateUntil(window.lateUntil, language)}`
        : `Past due; new work is marked late • closes automatically ${formatLateUntil(window.lateUntil, language)}`,
    };
  }
  return {
    tone: 'open' as AssignmentStatusTone,
    label: th ? 'เปิดรับงาน' : 'Accepting',
    note: window.isExtended ? (th ? 'ขยายเวลาส่งแล้ว' : 'Deadline extended') : '',
  };
}

function formatLateUntil(lateUntil: number | null, language: 'th' | 'en') {
  return lateUntil === null ? '' : formatDateTime(new Date(lateUntil).toISOString(), language, SCHOOL_TIME_ZONE);
}

export const ASSIGNMENT_STATUS_CLASSES: Record<AssignmentStatusTone, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-300 border-dashed dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
  scheduled: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-900',
  open: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-900',
  late: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-900',
  closed: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-900',
};
