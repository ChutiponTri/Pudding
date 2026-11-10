import type { Course, LearningIndicator } from '@/types/database';

/**
 * Every graded question (homework and quiz) must name what it assesses: a
 * lesson plan (แผนการสอน → สมรรถนะ) in competency courses, otherwise one of
 * the course's indicators (or, for courses without their own, the shared
 * indicator list). There is no default: the teacher picks one per question.
 * Surveys have none.
 */

type Lang = 'th' | 'en';
export type IndicatorChoice = { id: string; label: string };
export type IndicatorChoices = { kind: 'plan' | 'indicator'; choices: IndicatorChoice[] };

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function indicatorChoicesFor(
  course: Pick<Course, 'indicator_mode' | 'indicators' | 'lesson_plans'> | null | undefined,
  shared: Array<Pick<LearningIndicator, 'id' | 'title'>> = [],
  lang: Lang = 'th'
): IndicatorChoices {
  const th = lang === 'th';
  if (course?.indicator_mode === 'competency') {
    const indicators = course.indicators || [];
    return {
      kind: 'plan',
      choices: (course.lesson_plans || []).map((plan, i) => {
        const mapped = (plan.mapped_indicator_ids || [])
          .map((id) => indicators.findIndex((c) => c.id === id))
          .filter((n) => n >= 0)
          .map((n) => `${th ? 'สมรรถนะ' : 'Competency'} ${n + 1}`)
          .join(', ');
        return { id: plan.id, label: `${th ? 'แผน' : 'Plan'} ${i + 1}: ${clip(plan.title || (th ? '(ไม่มีชื่อ)' : '(untitled)'), 35)}${mapped ? ` → ${mapped}` : ''}` };
      }),
    };
  }
  const list = (course?.indicators || []).length ? course!.indicators : shared;
  return {
    kind: 'indicator',
    choices: list.map((ind, i) => ({ id: ind.id, label: `${th ? 'ข้อ' : 'Item'} ${i + 1}: ${clip(ind.title || '', 50)}` })),
  };
}

/** Why these questions cannot be saved (no choices set up, or one not picked), or null. */
export function missingIndicatorMessage(questions: Array<{ indicator_id?: string | null }>, choices: IndicatorChoices): string | null {
  if (!questions.length) return null;
  if (!choices.choices.length) {
    return choices.kind === 'plan'
      ? 'รายวิชานี้ยังไม่มีแผนการสอน / สมรรถนะ กรุณาตั้งค่าที่แดชบอร์ดก่อนสร้างงาน'
      : 'รายวิชานี้ยังไม่มีตัวชี้วัด กรุณาตั้งค่าที่แดชบอร์ดก่อนสร้างงาน';
  }
  const ids = new Set(choices.choices.map((c) => c.id));
  const missing = questions.map((q, i) => (q.indicator_id && ids.has(q.indicator_id) ? 0 : i + 1)).filter(Boolean);
  if (!missing.length) return null;
  return `ข้อ ${missing.join(', ')} ยังไม่ได้เลือก${choices.kind === 'plan' ? 'แผนการสอน / สมรรถนะ' : 'ตัวชี้วัด'}`;
}
