import type { Assignment, ScoreHistoryEntry, Submission } from '@/types/database';
import { formatDateTime } from '@/lib/utils/datetime';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { isGraded, isHandedIn, needsGrading } from '@/lib/utils/gradingStatus';

/**
 * Score history of a grade-book cell. A retake (สอบซ่อม) or a quiz reset
 * (สอบใหม่) replaces the student's score in the same column; the score it
 * replaced is kept in submissions.score_history, so the grade book can mark
 * the cell and the Excel export can list every earlier score in a comment.
 */

type Lang = 'th' | 'en';
type HistoryFields = Pick<Submission, 'score_history' | 'retake_submission_id' | 'retake_previous' | 'submitted_at'>;

/** Oldest first. Retakes linked before score_history existed get one entry from retake_previous. */
export function scoreHistoryOf(sub: Partial<HistoryFields> | null | undefined): ScoreHistoryEntry[] {
  if (!sub) return [];
  const list = Array.isArray(sub.score_history) ? sub.score_history.filter((e) => e && (e.kind === 'retake' || e.kind === 'reset')) : [];
  if (sub.retake_submission_id && !list.some((e) => e.kind === 'retake')) {
    list.push({
      kind: 'retake',
      previous_score: sub.retake_previous?.total_score ?? null,
      previous_max: sub.retake_previous?.max_total_score ?? null,
      previous_status: sub.retake_previous?.status ?? 'none',
      at: sub.submitted_at || '',
    });
  }
  return list;
}

/** The latest replacement, which labels the cell; null = the score was never replaced. */
export function scoreMarkOf(sub: Partial<HistoryFields> | null | undefined): ScoreHistoryEntry['kind'] | null {
  const list = scoreHistoryOf(sub);
  return list.length ? list[list.length - 1].kind : null;
}

export const scoreMarkLabel = (kind: ScoreHistoryEntry['kind'], lang: Lang) =>
  kind === 'retake' ? (lang === 'th' ? 'สอบซ่อม' : 'Retake') : lang === 'th' ? 'สอบใหม่' : 'Re-sit';

function previousText(e: ScoreHistoryEntry, lang: Lang) {
  const th = lang === 'th';
  if (e.previous_score != null) {
    const score = `${e.previous_score}${e.previous_max ? `/${e.previous_max}` : ''}`;
    return e.previous_status === 'pending' ? `${score} (${th ? 'ไม่ส่ง' : 'no submission'})` : score;
  }
  if (e.previous_status === 'submitted' || e.previous_status === 'late') return th ? 'ยังไม่ได้ตรวจ' : 'not graded yet';
  return th ? 'ไม่ส่ง' : 'no submission';
}

/** One line per replacement, oldest first: "สอบซ่อม (อ. 10 พ.ย. 2569 · 10:00 น.): คะแนนเดิม 3/10". */
export function scoreHistoryLines(sub: Partial<HistoryFields> | null | undefined, lang: Lang): string[] {
  return scoreHistoryOf(sub).map(
    (e) => `${scoreMarkLabel(e.kind, lang)}${e.at ? ` (${formatDateTime(e.at, lang)})` : ''}: ${lang === 'th' ? 'คะแนนเดิม' : 'previous score'} ${previousText(e, lang)}`
  );
}

export type GradeCellTone = 'scored' | 'missing' | 'not_yet' | 'to_grade' | 'hidden';

export interface GradeCell {
  /** Shown score: missing / not yet handed in read as 0; null = no score (to grade, or work not released yet). */
  score: number | null;
  /** Status text beside the score (ไม่ส่ง, ยังไม่ส่ง, รอตรวจ); null for an ordinary score. */
  label: string | null;
  tone: GradeCellTone;
  /** Latest สอบซ่อม / สอบใหม่ that replaced the score. */
  mark: ScoreHistoryEntry['kind'] | null;
  /** Earlier scores, one line each (empty without a mark). */
  history: string[];
}

/** What one student's cell of one work shows in the grade book and the Excel export. */
export function gradeCellOf(sub: Submission | null | undefined, assignment: Assignment, lang: Lang, now = Date.now()): GradeCell {
  const th = lang === 'th';
  const mark = scoreMarkOf(sub);
  const history = scoreHistoryLines(sub, lang);
  const base = { mark, history };
  const win = getAssignmentWindow(assignment, now);
  if (sub && isGraded(sub)) {
    return isHandedIn(sub)
      ? { ...base, score: Number(sub.total_score), label: null, tone: 'scored' }
      : { ...base, score: Number(sub.total_score), label: th ? 'ไม่ส่ง' : 'Missing', tone: 'missing' };
  }
  // Handed in and waiting for the teacher: no score yet (not a 0).
  if (sub && needsGrading(sub)) return { ...base, score: null, label: th ? 'รอตรวจ' : 'To grade', tone: 'to_grade' };
  if (win.isDraft || win.isScheduled) return { ...base, score: null, label: null, tone: 'hidden' };
  return win.acceptsSubmissions
    ? { ...base, score: 0, label: th ? 'ยังไม่ส่ง' : 'Not yet', tone: 'not_yet' }
    : { ...base, score: 0, label: th ? 'ไม่ส่ง' : 'Missing', tone: 'missing' };
}
