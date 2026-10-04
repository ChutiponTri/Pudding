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
  const month = refDate.getMonth(); // 0 = Jan ... 9 = Oct ... 11 = Dec
  const date = refDate.getDate();
  const yearCE = refDate.getFullYear();

  let semester = 1;
  let academicYearCE = yearCE;

  if (month >= 4 && month <= 8) {
    // May to September -> Semester 1
    semester = 1;
    academicYearCE = yearCE;
  } else if (month === 9) {
    // October: mid-to-late October begins Semester 2 preparation
    semester = date > 20 ? 2 : 1;
    academicYearCE = yearCE;
  } else if (month >= 10) {
    // November to December -> Semester 2
    semester = 2;
    academicYearCE = yearCE;
  } else {
    // January to April -> Semester 2 of preceding academic year
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
    return `ภาคเรียนที่ ${semester} / ${yearCE + 543}`;
  }
  return `Semester ${semester} / ${yearCE}`;
}

export function getAcademicYearOptions(currentYearCE: number = new Date().getFullYear()): number[] {
  return [currentYearCE - 1, currentYearCE, currentYearCE + 1];
}
