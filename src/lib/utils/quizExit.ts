/**
 * Closing a quiz (LINE's X button, or leaving the quiz screen) and opening it
 * again starts the answer sheet afresh, so the away-from-screen count would be
 * lost. The server counts every opening of a quiz instead (quiz_attempts):
 * each opening after the first means the student left without handing in.
 *
 * How many such exits are only warned about depends on the quiz's length; the
 * next one hands in a blank sheet (0 points):
 * - 1 question: no warning, the first reopen hands in blank
 * - 2 questions: 1 warning, the second reopen hands in blank
 * - 3 or more: 2 warnings, the third reopen hands in blank
 * Any exit flags the submission as suspicious.
 */
export function quizExitWarnings(questionCount: number): number {
  return Math.min(2, Math.max(0, questionCount - 1));
}

export type QuizOpenAction = 'start' | 'warn' | 'forfeit';

/** What opening the quiz does, given how many times the student has already left it. */
export function quizOpenAction(exits: number, questionCount: number): QuizOpenAction {
  if (exits <= 0) return 'start';
  return exits > quizExitWarnings(questionCount) ? 'forfeit' : 'warn';
}

/** What /api/quiz-attempts answers when a quiz is opened. */
export interface QuizOpenResult {
  action: QuizOpenAction;
  /** Times the student left the quiz without handing in (openings - 1). */
  exits: number;
  /** Exits only warned about; one more hands in a blank sheet. */
  warnings: number;
  /** false: not tracked (homework, or the database has no quiz_attempts table yet). */
  tracked: boolean;
  /** action 'forfeit': the blank sheet the server already handed in (student copy). */
  submission?: import('@/types/database').Submission;
}
