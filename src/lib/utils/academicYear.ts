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
