import type { TeacherRole } from '@/types/database';

type Tr = (th: string, en: string) => string;

/** One wording for a teacher's role everywhere (classroom People tab, dashboard, /classrooms). */
export function teacherRoleLabel(role: TeacherRole | undefined, tr: Tr): string {
  if (role === 'primary') return tr('ครูประจำวิชา', 'Primary teacher');
  if (role === 'researcher') return tr('ผู้ตรวจเพื่อวิจัย (IRR)', 'Research grader (IRR)');
  return tr('TA (ผู้ช่วยสอน)', 'TA (teaching assistant)');
}

/** The role badge's colours, matching teacherRoleLabel. */
export function teacherRoleBadgeClass(role: TeacherRole | undefined): string {
  if (role === 'primary') return 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-300';
  if (role === 'researcher') return 'bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border-purple-300';
  return 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border-blue-300';
}
