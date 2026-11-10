import type { Assignment, Question, QuestionType } from '@/types/database';

/**
 * "กิจกรรม" (survey, is_survey): a Google-Forms-like work type. No scores, answer keys
 * or indicators. A handed-in response is complete as it is (total_score 0 of
 * 0), so it never waits for grading and stays out of the grade book.
 */

export const isSurvey = (a: Pick<Assignment, 'is_survey'> | null | undefined) => !!a?.is_survey;

/** The question kinds a survey offers, in the order the forms show them. */
export const SURVEY_TYPES = ['multiple_choice', 'checkboxes', 'scale', 'short_answer', 'file_upload'] as const satisfies readonly QuestionType[];
export type SurveyType = (typeof SURVEY_TYPES)[number];
export const isSurveyType = (type: QuestionType): type is SurveyType => (SURVEY_TYPES as readonly QuestionType[]).includes(type);

export const SURVEY_TYPE_LABEL: Record<SurveyType, { th: string; en: string; icon: string }> = {
  multiple_choice: { th: 'ตัวเลือกเดียว', en: 'One choice', icon: '🔘' },
  checkboxes: { th: 'หลายตัวเลือก', en: 'Checkboxes', icon: '☑️' },
  scale: { th: 'ระดับ 1–5', en: 'Scale 1–5', icon: '📶' },
  short_answer: { th: 'ข้อความ', en: 'Text', icon: '✍️' },
  file_upload: { th: 'แนบไฟล์', en: 'File', icon: '📎' },
};

/** Scale questions run 1 (lowest) to 5 (highest). */
export const SCALE_POINTS = [1, 2, 3, 4, 5] as const;

/** Question types that come with a list of options. */
export const hasOptions = (type: QuestionType) => type === 'multiple_choice' || type === 'checkboxes';

/** Checkbox picks are stored as a JSON array in answer_text; nothing picked = ''. */
export function encodeChecks(picks: string[]): string {
  const clean = [...new Set(picks.map((p) => p.trim()).filter(Boolean))];
  return clean.length ? JSON.stringify(clean) : '';
}

export function decodeChecks(text: string | null | undefined): string[] {
  const raw = (text || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((p) => String(p ?? '').trim()).filter(Boolean);
  } catch {
    // Not JSON: a single pick saved as plain text.
  }
  return [raw];
}

/** A scale answer as 1–5, or null. */
export function scaleValue(text: string | null | undefined): number | null {
  const n = Number((text || '').trim());
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** One answer as readable text (checkbox picks joined with ", "). */
export function surveyAnswerText(type: QuestionType, text: string | null | undefined): string {
  return type === 'checkboxes' ? decodeChecks(text).join(', ') : (text || '').trim();
}

/** A survey row as the server keeps it: no score, key or rubric; options only where they belong. */
export function cleanSurveyQuestion<T extends Partial<Question>>(q: T): T {
  const type = (q.type && isSurveyType(q.type) ? q.type : 'short_answer') as QuestionType;
  return {
    ...q,
    type,
    options: hasOptions(type) ? (Array.isArray(q.options) ? q.options.map((o) => String(o ?? '').trim()).filter(Boolean) : []) : [],
    ideal_answer: '',
    rubric_criteria: '',
    max_score: 0,
    indicator_id: undefined,
  };
}

/** Why a survey's questions cannot be saved, or null. */
export function surveyProblem(questions: Array<Pick<Question, 'type' | 'question_text' | 'options'>>): string | null {
  if (!questions.length) return 'เพิ่มคำถามอย่างน้อย 1 ข้อ';
  for (const [i, q] of questions.entries()) {
    if (!isSurveyType(q.type)) return `ข้อ ${i + 1}: กิจกรรมใช้คำถามประเภทนี้ไม่ได้`;
    if (!String(q.question_text || '').trim()) return `ข้อ ${i + 1}: กรุณาใส่คำถาม`;
    if (hasOptions(q.type) && (q.options || []).filter((o) => String(o).trim()).length < 2) return `ข้อ ${i + 1}: ใส่ตัวเลือกอย่างน้อย 2 ข้อ`;
  }
  return null;
}

export type SurveyQuestionSummary =
  | { kind: 'choice'; question: Question; responses: number; counts: Array<{ option: string; count: number }> }
  | { kind: 'scale'; question: Question; responses: number; counts: Array<{ option: string; count: number }>; average: number | null }
  | { kind: 'text'; question: Question; responses: number; texts: string[] }
  | { kind: 'files'; question: Question; responses: number; files: Array<{ url: string; text: string }> };

/**
 * Per-question results, like Google Forms' summary: counts per option (a
 * checkbox answer counts once for each pick), scale counts and average, and
 * every written answer. `answers` are the handed-in responses' answers.
 */
export function summarizeSurvey(
  questions: Question[],
  answers: Array<{ question_id: string; answer_text?: string | null; file_url?: string | null }>
): SurveyQuestionSummary[] {
  return questions.map((question) => {
    if (question.type === 'file_upload') {
      const files = answers
        .filter((a) => a.question_id === question.id && String(a.file_url || '').trim())
        .map((a) => ({ url: String(a.file_url).trim(), text: String(a.answer_text || '').trim() }));
      return { kind: 'files', question, responses: files.length, files };
    }
    const own = answers.filter((a) => a.question_id === question.id && String(a.answer_text || '').trim());
    if (question.type === 'scale') {
      const values = own.map((a) => scaleValue(a.answer_text)).filter((v): v is number => v !== null);
      return {
        kind: 'scale',
        question,
        responses: values.length,
        counts: SCALE_POINTS.map((p) => ({ option: String(p), count: values.filter((v) => v === p).length })),
        average: values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100 : null,
      };
    }
    if (hasOptions(question.type)) {
      const options = (question.options || []).map(String);
      const picks = own.map((a) => (question.type === 'checkboxes' ? decodeChecks(a.answer_text) : [String(a.answer_text).trim()]));
      const counts = options.map((option) => ({ option, count: picks.filter((list) => list.includes(option)).length }));
      // Answers that match no current option (the option was renamed later) are kept under their own text.
      const others = new Map<string, number>();
      picks.flat().filter((p) => !options.includes(p)).forEach((p) => others.set(p, (others.get(p) || 0) + 1));
      others.forEach((count, option) => counts.push({ option, count }));
      return { kind: 'choice', question, responses: own.length, counts };
    }
    return { kind: 'text', question, responses: own.length, texts: own.map((a) => String(a.answer_text).trim()) };
  });
}
