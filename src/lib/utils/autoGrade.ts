import type { Question } from '@/types/database';
import { parseTrueFalse } from '@/lib/utils/trueFalse';

type ObjectiveFields = Pick<Question, 'type' | 'ideal_answer' | 'options' | 'max_score'>;

/** Multiple choice and true/false: scored from the answer key, no rubric needed. */
export function isObjectiveQuestion(question: Pick<Question, 'type'>) {
  return question.type === 'multiple_choice' || question.type === 'true_false';
}

const normChoice = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
/** "ข. ภาษาท่าทาง" → "ภาษาท่าทาง" (a choice written with its own letter or number). */
const withoutChoiceLabel = (value: string) => value.trim().replace(/^([ก-ฮ]|[a-z]|\d{1,2})\s*[.)]\s+/i, '');

/**
 * Which option an answer key points at, or -1. Keys may be the option text
 * (with stray tabs or spaces), or on older / imported questions a letter or
 * number: "ข", "B", "2", "ข้อ ข", "ตอบ ข", "ข.", or "ข. <text>".
 */
export function matchChoiceOption(ideal: string | null | undefined, options: unknown): number {
  const list = Array.isArray(options) ? options.map((o) => String(o ?? '')) : [];
  const key = normChoice(ideal || '');
  if (!key || !list.length) return -1;
  const exact = list.findIndex((o) => o.trim() && normChoice(o) === key);
  if (exact >= 0) return exact;
  // Same text once a leading "ก." / "1)" label is dropped on either side.
  const bare = normChoice(withoutChoiceLabel(ideal || ''));
  const byText = list.findIndex((o) => o.trim() && normChoice(withoutChoiceLabel(o)) === bare);
  if (bare && byText >= 0) return byText;
  // A bare letter / number, possibly after "ข้อ" / "ตอบ" and before "." or ")".
  const letter = key.replace(/^(คำตอบ|ตอบ|ข้อ|ตัวเลือก|answer|option)\s*[:：]?\s*/i, '').replace(/[.)]$/, '').trim();
  let index = -1;
  if (/^[ก-ฮ]$/.test(letter)) index = 'กขคงจฉชซฌญ'.indexOf(letter);
  else if (/^[a-z]$/i.test(letter)) index = letter.toUpperCase().charCodeAt(0) - 65;
  else if (/^\d{1,2}$/.test(letter)) index = Number(letter) - 1;
  return index >= 0 && index < list.length ? index : -1;
}

/** Compares a choice answer with the answer key (see matchChoiceOption). */
function isChoiceCorrect(ideal: string, studentText: string, options: unknown): boolean {
  const answer = normChoice(studentText);
  if (!answer) return false;
  if (normChoice(ideal) === answer) return true;
  const list = Array.isArray(options) ? options.map((o) => String(o ?? '')) : [];
  const index = matchChoiceOption(ideal, list);
  return index >= 0 && normChoice(list[index]) === answer;
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

/** Whether a student's saved answer is this option (true/false by meaning: "จริง" picks "ถูก"). */
export function isPickedOption(question: Pick<Question, 'type'>, option: string, answerText: string | null | undefined): boolean {
  const answer = (answerText || '').trim();
  if (!answer) return false;
  if (question.type === 'true_false') {
    const a = parseTrueFalse(answer);
    const o = parseTrueFalse(option);
    if (a !== null && o !== null) return a === o;
  }
  return normChoice(option) === normChoice(answer);
}

/**
 * Choice / true-false questions without a usable answer key (1-based numbers).
 * Work cannot be published with any: they would auto-score 0 for everyone.
 */
export function questionsMissingKey(questions: Array<Pick<Question, 'type' | 'ideal_answer' | 'options'>>): number[] {
  const missing: number[] = [];
  questions.forEach((q, i) => {
    if (q.type === 'multiple_choice' && matchChoiceOption(q.ideal_answer, q.options) < 0) missing.push(i + 1);
    else if (q.type === 'true_false' && parseTrueFalse(q.ideal_answer) === null) missing.push(i + 1);
  });
  return missing;
}

/** Why work with these questions cannot be published yet, or null. */
export function missingKeyMessage(questions: Array<Pick<Question, 'type' | 'ideal_answer' | 'options'>>): string | null {
  const missing = questionsMissingKey(questions);
  return missing.length ? `ข้อ ${missing.join(', ')} ยังไม่ได้เลือกคำตอบที่ถูกต้อง กรุณาเลือกก่อนเผยแพร่ (บันทึกเป็นฉบับร่างได้)` : null;
}

/** A full score below 0 (or not a number) is refused everywhere a question is saved. */
export function invalidMaxScoreMessage(questions: Array<Pick<Question, 'max_score'>>): string | null {
  const bad = questions
    .map((q, i) => ({ i, v: Number(q.max_score) }))
    .filter(({ v }) => !Number.isFinite(v) || v < 0)
    .map(({ i }) => i + 1);
  return bad.length ? `ข้อ ${bad.join(', ')} คะแนนเต็มต้องไม่ติดลบ` : null;
}

/** A typed full score, never below 0. */
export function nonNegativeScore(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
