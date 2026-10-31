import type { Classroom, Course } from '@/types/database';

/** Semester filter value: `${semester}_${yearCE}`, or 'all'. */
export type SemesterKey = string;
export const ALL_SEMESTERS: SemesterKey = 'all';

export const semesterKeyOf = (semester: number, yearCE: number): SemesterKey => `${semester}_${yearCE}`;

/** Semesters 1–3 of the current year, plus every term a course or classroom uses; newest year first. */
export function semesterOptions(courses: Course[], classrooms: Classroom[], currentYearCE: number) {
  const map = new Map<string, { semester: number; yearCE: number }>();
  [1, 2, 3].forEach((s) => {
    map.set(semesterKeyOf(s, currentYearCE), { semester: s, yearCE: currentYearCE });
  });
  courses.forEach((c) => {
    if (c.semester && c.year_ce) {
      map.set(semesterKeyOf(c.semester, c.year_ce), { semester: c.semester, yearCE: c.year_ce });
    }
  });
  classrooms.forEach((cls) => {
    if (cls.semester && cls.year_ce) {
      map.set(semesterKeyOf(cls.semester, cls.year_ce), { semester: cls.semester, yearCE: cls.year_ce });
    }
  });
  return Array.from(map.values()).sort((a, b) => {
    if (b.yearCE !== a.yearCE) return b.yearCE - a.yearCE;
    return a.semester - b.semester;
  });
}

/** Classrooms of the selected term; a classroom without its own term takes its course's. */
export function filterClassroomsBySemester(
  classrooms: Classroom[],
  courses: Course[],
  key: SemesterKey,
  currentYearCE: number
): Classroom[] {
  if (key === ALL_SEMESTERS) return classrooms;
  const [semStr, yrStr] = key.split('_');
  const sem = Number(semStr);
  const yr = Number(yrStr);
  return classrooms.filter((cls) => {
    const parentCourse = courses.find((c) => c.id === cls.course_id);
    const clsSem = cls.semester ?? parentCourse?.semester ?? 1;
    const clsYr = cls.year_ce ?? parentCourse?.year_ce ?? currentYearCE;
    return clsSem === sem && clsYr === yr;
  });
}

/** A `?term=` value from the URL, if it is well-formed; otherwise the fallback. */
export function semesterKeyFromParam(param: string | null, fallback: SemesterKey): SemesterKey {
  if (!param) return fallback;
  return param === ALL_SEMESTERS || /^[1-3]_\d{4}$/.test(param) ? param : fallback;
}
