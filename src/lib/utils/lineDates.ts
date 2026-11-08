import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { lineDate } from '@/lib/utils/datetime';

type DueFields = Parameters<typeof getAssignmentWindow>[0];

/**
 * The deadline lines every LINE message about a work uses:
 * homework "กำหนดส่ง 15 พ.ย. 2569" and "ปิดรับส่งงาน 16 พ.ย. 2569";
 * a quiz "ปิดรับคำตอบ 15 พ.ย. 2569 10:30 น.".
 */
export function dueRows(assignment: DueFields): Array<{ label: string; value: string }> {
  const win = getAssignmentWindow(assignment);
  if (win.deadline == null) return [];
  if (assignment.is_exam) return [{ label: 'ปิดรับคำตอบ', value: lineDate(win.deadline) }];
  const rows = [{ label: 'กำหนดส่ง', value: lineDate(win.deadline) }];
  if (win.lateUntil != null && win.lateUntil !== win.deadline) rows.push({ label: 'ปิดรับส่งงาน', value: lineDate(win.lateUntil) });
  return rows;
}

/** dueRows as text lines: "กำหนดส่ง 15 พ.ย. 2569\nปิดรับส่งงาน 16 พ.ย. 2569". */
export const dueText = (assignment: DueFields, separator = '\n') => dueRows(assignment).map((row) => `${row.label} ${row.value}`).join(separator);
