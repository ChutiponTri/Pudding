import type { Submission, User } from '@/types/database';
import { countToGrade } from '@/lib/utils/groupWork';
import { isSuspiciousActivity } from '@/lib/utils/integrity';

type SubmissionScore = Pick<Submission, 'status' | 'total_score'>;

/** Handed in by the student (on time or late). Rows a teacher recorded for a missing student stay 'pending'. */
export const isHandedIn = (sub: Pick<Submission, 'status'>) => sub.status === 'submitted' || sub.status === 'late';

/** Fully graded: the server sets total_score only once every question has an official score. */
export const isGraded = (sub: Pick<Submission, 'total_score'>) => sub.total_score != null;

/** Handed in and still waiting for the teacher. */
export const needsGrading = (sub: SubmissionScore) => isHandedIn(sub) && !isGraded(sub);

/** Never handed in, but the teacher already scored it (e.g. gave 0 after it closed): checked, not missing. */
export const isScoredMissing = (sub: SubmissionScore) => !isHandedIn(sub) && isGraded(sub);

/** Still outstanding: nothing handed in and nothing scored by the teacher. */
export const isMissing = (sub: SubmissionScore | null | undefined) => !sub || (!isHandedIn(sub) && !isGraded(sub));

/** A teacher has scored it: a total, or an official score on any answer (auto-scored choices have no graded_at). */
export const isTeacherGraded = (
  sub: Pick<Submission, 'total_score'>,
  answers: Array<{ graded_at?: string | null }> = []
) => isGraded(sub) || answers.some((a) => !!a.graded_at);

/**
 * A request already on its way when the teacher's per-student time runs out
 * is still accepted. Server only (/api/submissions); screens show the real end.
 */
export const REOPEN_GRACE_MS = 2 * 60 * 1000;

/**
 * Whether the teacher's per-student permission ("Allow edit" / "Allow hand-in")
 * is in force now: reopened_at is set and its time limit (reopen_until, if
 * any) has not passed. Databases without reopen_until have no limit.
 */
export function isReopenActive(
  sub: Pick<Submission, 'reopened_at' | 'reopen_until'> | null | undefined,
  now: number = Date.now(),
  graceMs = 0
): boolean {
  if (!sub?.reopened_at) return false;
  if (!sub.reopen_until) return true;
  const until = new Date(sub.reopen_until).getTime();
  return Number.isNaN(until) || now <= until + graceMs;
}

/**
 * Whether the student may change handed-in work. Handed-in work is view-only:
 * the student opens it to see their answers and scores, but changes nothing
 * (answers, files, the hand-in button) until the teacher allows it for them
 * ("Allow edit" sets reopened_at, optionally until reopen_until). Handed-in
 * quizzes are never reopened. The submissions API enforces the same rule.
 */
export function canEditSubmission(
  sub: Pick<Submission, 'status' | 'reopened_at' | 'reopen_until'>,
  isExam: boolean | undefined,
  now: number = Date.now()
): boolean {
  if (isExam || !isHandedIn(sub)) return false;
  return isReopenActive(sub, now);
}

/**
 * Not handed in (the teacher recorded "no submission", or opened hand-in for
 * the student) but the teacher let this student hand in now, even after the
 * work closed. Homework and quizzes alike.
 */
export function isHandInAllowed(
  sub: Pick<Submission, 'status' | 'reopened_at' | 'reopen_until'> | null | undefined,
  now: number = Date.now()
): boolean {
  return !!sub && !isHandedIn(sub) && isReopenActive(sub, now);
}

/** Whether a student's answers carry anything at all (text, an uploaded file or a link). */
export function hasAnyAnswer(answers: Array<{ answer_text?: string | null; file_url?: string | null }>): boolean {
  return answers.some((a) => !!String(a.answer_text || '').trim() || !!String(a.file_url || '').trim());
}

type IntegrityFields = Pick<Submission, 'status' | 'is_flagged_suspicious' | 'tab_switch_count' | 'total_time_away_seconds'> &
  Partial<Pick<Submission, 'quiz_exit_count'>>;

/**
 * The one rule for "left the screen during a quiz", used by every count and
 * badge: quizzes only, handed-in work only (like "waiting to be graded"), and
 * flagged when the server flagged it or the recorded activity crosses the limits.
 */
export function isIntegrityFlagged(sub: IntegrityFields, isExam?: boolean): boolean {
  if (!isExam || !isHandedIn(sub)) return false;
  return !!sub.is_flagged_suspicious || (sub.quiz_exit_count || 0) > 0 || isSuspiciousActivity(sub.tab_switch_count || 0, sub.total_time_away_seconds || 0);
}

export type GradingCounts = {
  totalStudents: number;
  handedIn: number;
  /** Checked by the teacher: graded hand-ins plus scores given to students who never handed in. */
  graded: number;
  /** Of `graded`, the scores given to students who never handed in (usually a 0). */
  scoredMissing: number;
  /** Students whose hand-in waits for a grade. */
  pending: number;
  /**
   * What the teacher has to grade: like `pending`, but a group (งานกลุ่ม)
   * counts once, since one grade covers all its members.
   */
  pendingItems: number;
  /** งานกลุ่ม: the counts above are per student; pendingItems per group. */
  groupWork: boolean;
  /** What the teacher has to check: graded + pending. */
  checkable: number;
  /** Not handed in and not scored yet. */
  notSubmitted: number;
  /** Quizzes only: submissions flagged for leaving the screen. */
  flagged: number;
};

/** Handed in / checked / waiting / missing for one assignment's submissions. */
export function gradingCounts(
  subs: Array<Pick<Submission, 'status' | 'total_score' | 'is_flagged_suspicious' | 'tab_switch_count' | 'total_time_away_seconds'> & { submitted_at?: string | null }>,
  totalStudents: number,
  isExam?: boolean,
  /** งานกลุ่ม: members' copies of one hand-in count once in pendingItems. */
  groupWork = false
): GradingCounts {
  const handedIn = subs.filter(isHandedIn).length;
  const waiting = subs.filter(needsGrading);
  const pending = waiting.length;
  const scoredMissing = subs.filter(isScoredMissing).length;
  const graded = handedIn - pending + scoredMissing;
  return {
    totalStudents,
    handedIn,
    graded,
    scoredMissing,
    pending,
    pendingItems: countToGrade(waiting, groupWork),
    groupWork,
    checkable: graded + pending,
    notSubmitted: Math.max(0, totalStudents - handedIn - scoredMissing),
    flagged: subs.filter((s) => isIntegrityFlagged(s, isExam)).length,
  };
}

/**
 * Whether a submission is this roster student's. Roster entries and
 * submissions may carry users.id, the LINE id or the school number, so any of
 * them matches. Used by every page that lines students up with their work.
 */
export function isStudentSubmission(
  sub: Pick<Submission, 'student_id' | 'student'>,
  student: Pick<User, 'id' | 'line_uid' | 'student_id'>
): boolean {
  return !!(
    (sub.student_id && sub.student_id === student.id) ||
    (student.line_uid && sub.student_id === student.line_uid) ||
    (student.student_id && sub.student_id === student.student_id) ||
    (sub.student?.student_id && student.student_id && sub.student.student_id === student.student_id) ||
    (sub.student?.id && student.id && sub.student.id === student.id) ||
    (sub.student?.line_uid && student.line_uid && sub.student.line_uid === student.line_uid)
  );
}

/**
 * The "to grade" amount with both numbers when they differ: what to grade
 * (a group counts once) and, beside it, how many students that is.
 * "8", or "2 กลุ่ม (8 คน)" for group work; unit "ชิ้น" for totals over many works.
 */
export function pendingLabel(items: number, students: number, th: boolean, unit: 'group' | 'item' = 'group'): string {
  if (items === students) return String(items);
  const what = unit === 'group' ? (th ? 'กลุ่ม' : items === 1 ? 'group' : 'groups') : th ? 'ชิ้น' : items === 1 ? 'item' : 'items';
  return th ? `${items} ${what} (${students} คน)` : `${items} ${what} (${students} students)`;
}
