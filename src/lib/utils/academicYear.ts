export interface AcademicPeriod {
  semester: number;
  yearCE: number;
  yearBE: number;
}

/**
 * Returns default academic semester and year based on Thai educational calendar:
 * - Semester 1: May - October (academic year = current CE year)
 * - Semester 2: Late October / November - March (if Jan-Mar, academic year is CE year - 1)
 */
export function getDefaultAcademicPeriod(refDate: Date = new Date()): AcademicPeriod {
  const month = refDate.getMonth(); // 0 = Jan ... 11 = Dec
  const date = refDate.getDate();
  const yearCE = refDate.getFullYear();

  // วันแรกของ "ครึ่งหลังเดือน" ที่ถือว่าเริ่มเทอมใหม่
  const MID_MONTH = 16;

  // ค่าเทียบลำดับในปี เช่น 16 ต.ค. -> 916, 5 ก.พ. -> 105
  const md = month * 100 + date;
  const START_SEM1 = 4 * 100 + MID_MONTH; // กลาง พ.ค.
  const START_SEM2 = 9 * 100 + MID_MONTH; // กลาง ต.ค.
  const START_SEM3 = 1 * 100 + MID_MONTH; // กลาง ก.พ.

  let semester: number;
  let academicYearCE: number;

  if (md >= START_SEM2) {
    // กลาง ต.ค. - 31 ธ.ค. -> เทอม 2 ของปีการศึกษาปัจจุบัน
    semester = 2;
    academicYearCE = yearCE;
  } else if (md >= START_SEM1) {
    // กลาง พ.ค. - กลาง ต.ค. -> เทอม 1 ของปีการศึกษาปัจจุบัน
    semester = 1;
    academicYearCE = yearCE;
  } else if (md >= START_SEM3) {
    // กลาง ก.พ. - กลาง พ.ค. -> เทอม 3 (ซัมเมอร์) ของปีการศึกษาก่อนหน้า
    semester = 3;
    academicYearCE = yearCE - 1;
  } else {
    // 1 ม.ค. - กลาง ก.พ. -> เทอม 2 ของปีการศึกษาก่อนหน้า
    semester = 2;
    academicYearCE = yearCE - 1;
  }

  return {
    semester,
    yearCE: academicYearCE,
    yearBE: academicYearCE + 543,
  };
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
