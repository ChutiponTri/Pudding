import type { Submission } from '@/types/database';

type SubmissionScore = Pick<Submission, 'status' | 'total_score'>;

/** Handed in by the student (on time or late). Rows a teacher recorded for a missing student stay 'pending'. */
export const isHandedIn = (sub: Pick<Submission, 'status'>) => sub.status === 'submitted' || sub.status === 'late';

/** Fully graded: the server sets total_score only once every question has an official score. */
export const isGraded = (sub: Pick<Submission, 'total_score'>) => sub.total_score != null;

/** Handed in and still waiting for the teacher. */
export const needsGrading = (sub: SubmissionScore) => isHandedIn(sub) && !isGraded(sub);

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
  subs: Array<Pick<Submission, 'status' | 'total_score' | 'is_flagged_suspicious'>>,
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
    flagged: isExam ? subs.filter((s) => s.is_flagged_suspicious).length : 0,
  };
}
