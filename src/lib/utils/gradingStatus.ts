import type { Submission, User } from '@/types/database';
import { isSuspiciousActivity } from '@/lib/utils/integrity';

type SubmissionScore = Pick<Submission, 'status' | 'total_score'>;

/** Handed in by the student (on time or late). Rows a teacher recorded for a missing student stay 'pending'. */
export const isHandedIn = (sub: Pick<Submission, 'status'>) => sub.status === 'submitted' || sub.status === 'late';

/** Fully graded: the server sets total_score only once every question has an official score. */
export const isGraded = (sub: Pick<Submission, 'total_score'>) => sub.total_score != null;

/** Handed in and still waiting for the teacher. */
export const needsGrading = (sub: SubmissionScore) => isHandedIn(sub) && !isGraded(sub);

type IntegrityFields = Pick<Submission, 'status' | 'is_flagged_suspicious' | 'tab_switch_count' | 'total_time_away_seconds'>;

/**
 * The one rule for "left the screen during a quiz", used by every count and
 * badge: quizzes only, handed-in work only (like "waiting to be graded"), and
 * flagged when the server flagged it or the recorded activity crosses the limits.
 */
export function isIntegrityFlagged(sub: IntegrityFields, isExam?: boolean): boolean {
  if (!isExam || !isHandedIn(sub)) return false;
  return !!sub.is_flagged_suspicious || isSuspiciousActivity(sub.tab_switch_count || 0, sub.total_time_away_seconds || 0);
}

export type GradingCounts = {
  totalStudents: number;
  handedIn: number;
  graded: number;
  pending: number;
  notSubmitted: number;
  /** Quizzes only: submissions flagged for leaving the screen. */
  flagged: number;
};

/** Handed in / graded / waiting / missing for one assignment's submissions. */
export function gradingCounts(
  subs: Array<Pick<Submission, 'status' | 'total_score' | 'is_flagged_suspicious' | 'tab_switch_count' | 'total_time_away_seconds'>>,
  totalStudents: number,
  isExam?: boolean
): GradingCounts {
  const handedIn = subs.filter(isHandedIn).length;
  const pending = subs.filter(needsGrading).length;
  return {
    totalStudents,
    handedIn,
    graded: handedIn - pending,
    pending,
    notSubmitted: Math.max(0, totalStudents - handedIn),
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
