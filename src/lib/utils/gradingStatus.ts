import type { Submission } from '@/types/database';

type SubmissionScore = Pick<Submission, 'status' | 'total_score'>;

/** Handed in by the student (on time or late). Rows a teacher recorded for a missing student stay 'pending'. */
export const isHandedIn = (sub: Pick<Submission, 'status'>) => sub.status === 'submitted' || sub.status === 'late';

/** Fully graded: the server sets total_score only once every question has an official score. */
export const isGraded = (sub: Pick<Submission, 'total_score'>) => sub.total_score != null;

/** Handed in and still waiting for the teacher. */
export const needsGrading = (sub: SubmissionScore) => isHandedIn(sub) && !isGraded(sub);
