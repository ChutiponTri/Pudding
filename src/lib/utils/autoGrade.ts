import type { Question } from '@/types/database';
import { parseTrueFalse } from '@/lib/utils/trueFalse';

type ObjectiveFields = Pick<Question, 'type' | 'ideal_answer' | 'options' | 'max_score'>;

/** Multiple choice and true/false: scored from the answer key, no rubric needed. */
export function isObjectiveQuestion(question: Pick<Question, 'type'>) {
  return question.type === 'multiple_choice' || question.type === 'true_false';
}

/**
 * Compares a choice answer with an answer key that may be the option text or,
 * on older questions, a letter / number ("ข", "B", "2").
 */
function isChoiceCorrect(ideal: string, studentText: string, options: unknown): boolean {
  const norm = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const answer = norm(studentText);
  if (!answer) return false;
  if (norm(ideal) === answer) return true;
  const list = Array.isArray(options) ? options.map((o) => String(o)) : [];
  const key = ideal.trim().replace(/^(ข้อ|ตัวเลือก|option)\s*/i, '').replace(/[.)]$/, '').trim();
  let index = -1;
  if (/^[ก-ฮ]$/.test(key)) index = 'กขคงจฉชซฌญ'.indexOf(key);
  else if (/^[a-z]$/i.test(key)) index = key.toUpperCase().charCodeAt(0) - 65;
  else if (/^\d+$/.test(key)) index = Number(key) - 1;
  return index >= 0 && index < list.length && norm(list[index]) === answer;
}

/**
 * Whether a choice answer matches the key. null when there is no key yet (or
 * the question is not a choice question), so the teacher decides.
 */
export function isObjectiveAnswerCorrect(question: ObjectiveFields, answerText: string | null | undefined): boolean | null {
  if (!isObjectiveQuestion(question)) return null;
  const ideal = (question.ideal_answer || '').trim();
  if (!ideal) return null;
  const studentText = (answerText || '').trim();
  if (!studentText) return false;
  // True/false compares meaning ("จริง" = "ถูก" = "True").
  if (question.type === 'true_false') {
    const idealBool = parseTrueFalse(ideal);
    const studentBool = parseTrueFalse(studentText);
    if (idealBool !== null && studentBool !== null) return idealBool === studentBool;
  }
  return isChoiceCorrect(ideal, studentText, question.options);
}

/** Auto score for a choice answer: full marks when correct, otherwise 0 (also when blank or no key). */
export function scoreObjectiveAnswer(question: ObjectiveFields, answerText: string | null | undefined): number {
  return isObjectiveAnswerCorrect(question, answerText) ? Number(question.max_score || 0) : 0;
}
