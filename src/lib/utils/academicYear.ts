export interface AcademicPeriod {
  semester: number;
  yearCE: number;
  yearBE: number;
}

/** First day of a term (month 1–12). */
export interface TermStart {
  semester: number;
  month: number;
  day: number;
}

/**
 * Default Thai academic calendar (each teacher can change it; see useAcademicCalendar).
 * The default term only picks the initial filter; teachers can still choose any term.
 *
 * An academic year starts on term 1's first day. With the defaults, ปีการศึกษา 2569 is
 * 10 May 2569 – 9 May 2570 (calendar dates, B.E.):
 *   - Semester 1: 10 May 2569 – 15 Oct 2569
 *   - Semester 2: 16 Oct 2569 – 15 Mar 2570
 *   - Semester 3 (summer): 16 Mar 2570 – 9 May 2570
 * All three are labelled with academic year 2569 (e.g. "ซัมเมอร์ / 2569").
 */
export const DEFAULT_TERM_STARTS: ReadonlyArray<TermStart> = [
  { semester: 1, month: 5, day: 10 },
  { semester: 2, month: 10, day: 16 },
  { semester: 3, month: 3, day: 16 },
];

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const daysInMonth = (month: number) => DAYS_IN_MONTH[month - 1] ?? 31;

/** Comparable position of a calendar day inside the academic year that starts at `yearStart`. */
function academicOrdinal(month: number, day: number, yearStart: TermStart): number {
  let monthsIn = (month - yearStart.month + 12) % 12;
  // Same month as the start but earlier day: that is the very end of the year.
  if (monthsIn === 0 && day < yearStart.day) monthsIn = 12;
  return monthsIn * 100 + day;
}

/**
 * Returns the reason a set of term starts is unusable, or null when it is valid:
 * semesters 1, 2, 3 each once, real dates, and in calendar order starting from term 1.
 */
export function termStartsProblem(starts: ReadonlyArray<TermStart> | null | undefined, language: 'th' | 'en' = 'th'): string | null {
  const th = language === 'th';
  if (!starts || starts.length !== 3 || [1, 2, 3].some((sem) => starts[sem - 1]?.semester !== sem)) {
    return th ? 'ต้องมีภาคเรียนที่ 1, 2 และ 3' : 'Terms 1, 2 and 3 are required';
  }
  for (const term of starts) {
    if (!Number.isInteger(term.month) || term.month < 1 || term.month > 12 || !Number.isInteger(term.day) || term.day < 1 || term.day > daysInMonth(term.month)) {
      return th ? `วันเริ่มภาคเรียนที่ ${term.semester} ไม่ถูกต้อง` : `Term ${term.semester} start date is invalid`;
    }
  }
  const [t1, t2, t3] = starts.map((term) => academicOrdinal(term.month, term.day, starts[0]));
  if (!(t1 < t2 && t2 < t3)) {
    return th
      ? 'วันเริ่มต้องเรียงตามลำดับ: ภาคเรียนที่ 1 → 2 → ซัมเมอร์ ภายในหนึ่งปีการศึกษา'
      : 'Start dates must run in order within one academic year: term 1 → term 2 → summer';
  }
  return null;
}

/** The given term starts when valid, otherwise the defaults. */
export function resolveTermStarts(starts: unknown): ReadonlyArray<TermStart> {
  if (!Array.isArray(starts)) return DEFAULT_TERM_STARTS;
  const parsed = starts.map((term) => ({
    semester: Number((term as TermStart)?.semester),
    month: Number((term as TermStart)?.month),
    day: Number((term as TermStart)?.day),
  }));
  return termStartsProblem(parsed) ? DEFAULT_TERM_STARTS : parsed;
}

/** The academic term (and its academic year) that a date falls in. */
export function getDefaultAcademicPeriod(
  refDate: Date = new Date(),
  termStarts: ReadonlyArray<TermStart> = DEFAULT_TERM_STARTS
): AcademicPeriod {
  const starts = termStartsProblem(termStarts) ? DEFAULT_TERM_STARTS : termStarts;
  const month = refDate.getMonth() + 1;
  const day = refDate.getDate();
  const yearStart = starts[0];

  // Before the year's first day (e.g. Jan–early May), the date belongs to the previous academic year.
  const beforeYearStart = month < yearStart.month || (month === yearStart.month && day < yearStart.day);
  const academicYearCE = refDate.getFullYear() - (beforeYearStart ? 1 : 0);

  const position = academicOrdinal(month, day, yearStart);
  let semester = yearStart.semester;
  for (const term of starts) {
    if (position >= academicOrdinal(term.month, term.day, yearStart)) semester = term.semester;
  }

  return {
    semester,
    yearCE: academicYearCE,
    yearBE: academicYearCE + 543,
  };
}

/** The day before the next term starts, as { month, day } (for showing each term's end). */
export function termEnd(starts: ReadonlyArray<TermStart>, index: number): { month: number; day: number } {
  const next = starts[(index + 1) % starts.length];
  if (next.day > 1) return { month: next.month, day: next.day - 1 };
  const month = next.month === 1 ? 12 : next.month - 1;
  return { month, day: month === 2 ? 28 : daysInMonth(month) };
}

export function formatAcademicPeriod(
  semester: number,
  yearCE: number,
  language: 'th' | 'en'
): string {
  if (language === 'th') {
    if (semester === 3) {
      return `ภาคเรียนที่ 3 (ซัมเมอร์) / ${yearCE + 543}`;
    }
    return `ภาคเรียนที่ ${semester} / ${yearCE + 543}`;
  }
  if (semester === 3) {
    return `Semester 3 (Summer) / ${yearCE}`;
  }
  return `Semester ${semester} / ${yearCE}`;
}

export function formatSemesterLabel(semester: number, language: 'th' | 'en' = 'th'): string {
  if (language === 'th') {
    if (semester === 3) return 'ภาคเรียนที่ 3 (ซัมเมอร์)';
    return `ภาคเรียนที่ ${semester}`;
  }
  if (semester === 3) return 'Semester 3 (Summer)';
  return `Semester ${semester}`;
}

export function getSemesterShortLabel(semester: number, language: 'th' | 'en' = 'th'): string {
  if (language === 'th') {
    if (semester === 3) return 'ซัมเมอร์';
    return `เทอม ${semester}`;
  }
  if (semester === 3) return 'Summer';
  return `Term ${semester}`;
}

export function getAcademicYearOptions(currentYearCE: number = new Date().getFullYear()): number[] {
  return [currentYearCE - 1, currentYearCE, currentYearCE + 1];
}

/**
 * Parses academic semester and year from arbitrary text representations
 * e.g. "2569 / ภาคเรียนที่ 1", "ภาคเรียนที่ 2 / 2568", "1/2569", "Semester 1 / 2026"
 */
export function parseAcademicPeriod(
  academicYearStr?: string | null
): { semester: number; yearCE: number; yearBE: number } | null {
  if (!academicYearStr || typeof academicYearStr !== 'string') return null;

  const str = academicYearStr.trim();
  if (!str) return null;

  // 1. Extract semester: looks for "ภาคเรียนที่ X", "เทอม X", "Semester X", "X/YYYY", or "ซัมเมอร์"
  let semester = 1;
  if (/ซัมเมอร์|summer/i.test(str) || /ภาคเรียนที่\s*3/i.test(str) || /เทอม\s*3/i.test(str) || /semester\s*3/i.test(str)) {
    semester = 3;
  } else if (/ภาคเรียนที่\s*2/i.test(str) || /เทอม\s*2/i.test(str) || /semester\s*2/i.test(str) || /^2\s*[\/\-]/i.test(str) || /[\/\-]\s*2$/i.test(str)) {
    semester = 2;
  } else if (/ภาคเรียนที่\s*1/i.test(str) || /เทอม\s*1/i.test(str) || /semester\s*1/i.test(str) || /^1\s*[\/\-]/i.test(str) || /[\/\-]\s*1$/i.test(str)) {
    semester = 1;
  }

  // 2. Extract 4-digit year (e.g. 2567, 2568, 2569 or 2024, 2025, 2026)
  const fourDigitMatch = str.match(/\b(25\d{2}|20\d{2})\b/);
  if (fourDigitMatch) {
    const rawYear = parseInt(fourDigitMatch[1], 10);
    if (rawYear >= 2500) {
      // Thai Buddhist Era (BE)
      const yearCE = rawYear - 543;
      return { semester, yearCE, yearBE: rawYear };
    } else {
      // Christian Era (CE)
      return { semester, yearCE: rawYear, yearBE: rawYear + 543 };
    }
  }

  // Fallback: 2-digit BE year e.g. "67", "68", "69"
  const twoDigitMatch = str.match(/(?:ปี|ปีการศึกษา|\/)\s*(\d{2})\b/);
  if (twoDigitMatch) {
    const raw2 = parseInt(twoDigitMatch[1], 10);
    const yearBE = 2500 + raw2;
    return { semester, yearCE: yearBE - 543, yearBE };
  }

  return null;
}
