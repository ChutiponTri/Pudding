/**
 * Score levels for teacher feedback suggestions, and the rules of the score
 * box. Levels go by the share of the question's full score, so they work for
 * any full score (1, 3, 5, 10, 2.5, …).
 */

export type ScoreLevel = 'full' | 'high' | 'good' | 'fair' | 'low' | 'zero';
/** Where a suggestion shows: one score level, or every level ('any'). */
export type PresetLevel = ScoreLevel | 'any';

export type FeedbackPreset = { id: string; category: string; text: string; level?: PresetLevel };

/** Highest level first. */
export const SCORE_LEVELS: ScoreLevel[] = ['full', 'high', 'good', 'fair', 'low', 'zero'];

const EPSILON = 1e-9;

/** The full score of a question as a safe number (missing or broken = 0). */
export function maxScoreOf(q: { max_score?: number | null }): number {
  const max = Number(q.max_score);
  return Number.isFinite(max) && max > 0 ? max : 0;
}

/**
 * The level of a score, or null while there is no valid score yet (empty,
 * not a number, out of range) or the question has no points to give.
 * full = full score; high ≥ 80%; good ≥ 60%; fair ≥ 40%; low > 0; zero = 0.
 */
export function scoreLevel(score: string | number | null | undefined, max: number): ScoreLevel | null {
  if (score == null || (typeof score === 'string' && score.trim() === '')) return null;
  const value = Number(score);
  if (!Number.isFinite(value) || value < 0 || !(max > 0) || value > max + EPSILON) return null;
  if (value <= EPSILON) return 'zero';
  if (value >= max - EPSILON) return 'full';
  const ratio = value / max;
  if (ratio >= 0.8 - EPSILON) return 'high';
  if (ratio >= 0.6 - EPSILON) return 'good';
  if (ratio >= 0.4 - EPSILON) return 'fair';
  return 'low';
}

export function scoreLevelLabel(level: PresetLevel, th: boolean): string {
  const labels: Record<PresetLevel, [string, string]> = {
    full: ['คะแนนเต็ม', 'Full marks'],
    high: ['ดีมาก (80% ขึ้นไป)', 'Very good (80%+)'],
    good: ['ดี (60–79%)', 'Good (60–79%)'],
    fair: ['พอใช้ (40–59%)', 'Fair (40–59%)'],
    low: ['ต้องปรับปรุง (ต่ำกว่า 40%)', 'Needs work (under 40%)'],
    zero: ['ไม่ได้คะแนน', 'No score'],
    any: ['ใช้ได้ทุกระดับ', 'Any score'],
  };
  return labels[level][th ? 0 : 1];
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/**
 * Cleans what the teacher typed into a score box. Returns the text to show,
 * or null to refuse the keystroke (letters, a minus sign, more than two
 * decimals, or more than the full score). Thai digits and a decimal comma are
 * accepted; an empty box stays empty (not graded yet).
 */
export function normalizeScoreInput(raw: string, max: number): string | null {
  let value = raw
    .replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
    .replace(/,/g, '.')
    .replace(/\s+/g, '');
  if (value === '') return '';
  if (!/^\d*\.?\d{0,2}$/.test(value)) return null;
  if (value.startsWith('.')) value = `0${value}`;
  value = value.replace(/^0+(?=\d)/, '');
  const number = Number(value);
  if (!Number.isFinite(number) || number > max + EPSILON) return null;
  return value;
}

/** The tidy form of a score once the teacher leaves the box: "3." → "3", "2.50" → "2.5". */
export function finalizeScoreInput(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  const number = Number(trimmed);
  return Number.isFinite(number) ? String(number) : trimmed;
}

/** Built-in suggestions: several per score level, plus a few that fit any score. */
export function defaultFeedbackPresets(th: boolean): FeedbackPreset[] {
  const rows: Array<[PresetLevel, string, string, string]> = [
    ['full', 'praise', 'ยอดเยี่ยม! ตอบถูกต้องครบถ้วนทุกประเด็น', 'Excellent! Complete and correct on every point'],
    ['full', 'praise', 'แสดงความเข้าใจเนื้อหาอย่างลึกซึ้ง', 'Shows a deep understanding of the topic'],
    ['full', 'reasoning', 'อธิบายเหตุผลได้ชัดเจนและเป็นลำดับขั้นตอน', 'Clear, well-ordered reasoning'],
    ['high', 'praise', 'ดีมาก เกือบสมบูรณ์แล้ว', 'Very good, almost complete'],
    ['high', 'missing', 'ตอบได้ดี ขาดรายละเอียดเพียงเล็กน้อย', 'Good answer, only a small detail missing'],
    ['high', 'improvement', 'ตรวจทานจุดเล็ก ๆ อีกนิดจะได้คะแนนเต็ม', 'Check the small details to reach full marks'],
    ['good', 'missing', 'ตอบถูกในประเด็นหลัก แต่ยังขาดรายละเอียดบางส่วน', 'Main point is right, but some details are missing'],
    ['good', 'missing', 'ควรอธิบายขั้นตอนหรือเหตุผลเพิ่มเติม', 'Explain your steps or reasoning in more detail'],
    ['good', 'missing', 'ควรยกตัวอย่างประกอบให้ชัดเจนขึ้น', 'Add an example to support your answer'],
    ['fair', 'improvement', 'เข้าใจบางส่วน ควรทบทวนเนื้อหาเพิ่มเติม', 'Partly understood; review the topic again'],
    ['fair', 'missing', 'คำตอบยังไม่ครอบคลุมประเด็นสำคัญ', 'The answer misses some key points'],
    ['fair', 'improvement', 'ลองเรียบเรียงคำตอบให้เป็นลำดับขั้นตอน', 'Try to organise your answer step by step'],
    ['low', 'improvement', 'คำตอบยังคลาดเคลื่อนจากประเด็นหลัก', 'The answer is off the main point'],
    ['low', 'improvement', 'ควรทบทวนเนื้อหาเรื่องนี้อีกครั้ง', 'Please review this topic again'],
    ['low', 'improvement', 'ถ้ายังไม่เข้าใจ ปรึกษาคุณครูได้เลย', 'Ask your teacher if anything is unclear'],
    ['zero', 'missing', 'ยังไม่ได้ตอบคำถามข้อนี้', 'This question was not answered'],
    ['zero', 'improvement', 'คำตอบไม่ตรงกับคำถาม ลองอ่านโจทย์อีกครั้ง', 'The answer does not match the question; read it again'],
    ['zero', 'missing', 'ไม่พบคำตอบหรือไฟล์ที่แนบมา', 'No answer or attached file was found'],
    ['any', 'improvement', 'ควรตรวจทานความถูกต้องอีกครั้งก่อนส่ง', 'Check your answer again before handing in'],
    ['any', 'improvement', 'ลายมืออ่านยาก ควรเขียนให้ชัดเจนขึ้น', 'Handwriting is hard to read; write more clearly'],
    ['any', 'integrity', 'ควรเรียบเรียงคำตอบด้วยความเข้าใจและสำนวนของตนเอง', 'Write the answer in your own words'],
  ];
  return rows.map(([level, category, thText, enText], i) => ({ id: `lv-${level}-${i}`, category, level, text: th ? thText : enText }));
}

/** Suggestions for a score: those of its level first, then the ones for any score. No valid score yet: only the general ones. */
export function presetsForLevel(presets: FeedbackPreset[], level: ScoreLevel | null): FeedbackPreset[] {
  const own = level ? presets.filter((p) => p.level === level) : [];
  const general = presets.filter((p) => !p.level || p.level === 'any');
  return [...own, ...general];
}

/**
 * Reads a teacher's saved suggestions. Lists saved before score levels
 * existed keep the teacher's own additions (as "any score") next to the new
 * built-in level suggestions; their old built-in chips (p1–p6) are replaced.
 */
export function loadFeedbackPresets(storedV2: string | null, storedV1: string | null, th: boolean): FeedbackPreset[] {
  const valid = (list: unknown): FeedbackPreset[] | null =>
    Array.isArray(list)
      ? list
          .filter((p): p is FeedbackPreset => !!p && typeof p === 'object' && typeof p.text === 'string' && !!p.text.trim() && typeof p.id === 'string')
          .map((p) => ({ ...p, category: typeof p.category === 'string' ? p.category : 'custom', level: SCORE_LEVELS.includes(p.level as ScoreLevel) ? p.level : 'any' }))
      : null;
  const parse = (raw: string | null) => {
    if (!raw) return null;
    try {
      return valid(JSON.parse(raw));
    } catch {
      return null;
    }
  };
  const current = parse(storedV2);
  if (current) return current;
  const legacyCustom = (parse(storedV1) || []).filter((p) => !/^p\d+$/.test(p.id)).map((p) => ({ ...p, level: 'any' as const }));
  return [...defaultFeedbackPresets(th), ...legacyCustom];
}
