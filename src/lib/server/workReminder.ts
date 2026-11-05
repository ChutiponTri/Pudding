import 'server-only';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';
import { withLiffLink } from '@/lib/line/liffLink';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { classroomTitle, type LabelledClassroom } from '@/lib/utils/classroomLabel';
import { formatDateTime, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
import { isHandedIn } from '@/lib/utils/gradingStatus';
import { rosterFor } from '@/lib/utils/retake';
import type { Assignment, User } from '@/types/database';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;
type ReminderClassroom = LabelledClassroom & { id: string; invite_code?: string | null; students?: User[] | null };

const nameOf = (s: Partial<User> & { name?: string }) => `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.name || 'ไม่ระบุชื่อ';

/** Students who take this work (the retake's list, if any) and have not handed it in. */
export async function missingStudentNames(supabase: Supabase, assignment: Assignment, classroom: ReminderClassroom): Promise<string[]> {
  const roster = rosterFor(assignment, (classroom.students || []).filter((s): s is User => !!s?.id));
  if (!roster.length) return [];
  const { data } = await supabase.from('submissions').select('student_id, status').eq('assignment_id', assignment.id);
  const handedIn = new Set((data || []).filter((row) => isHandedIn(row)).map((row) => row.student_id as string));
  return roster.filter((s) => !handedIn.has(s.id) && !(s.line_uid && handedIn.has(s.line_uid))).map(nameOf);
}

/** The "ทวงงาน" LINE text: the work, its deadline (or late window), and who has not handed in. */
export function reminderLineText(assignment: Assignment, classroom: ReminderClassroom, names: string[]): string {
  const win = getAssignmentWindow(assignment);
  const at = (ms: number | null | undefined) => (ms != null ? formatDateTime(new Date(ms).toISOString(), 'th', SCHOOL_TIME_ZONE) : '');
  const due = win.isPastDeadline && win.lateUntil
    ? `เลยกำหนดส่งแล้ว • ส่งช้าได้ถึง ${at(win.lateUntil)}`
    : win.deadline != null
    ? `${assignment.is_exam ? 'ปิดรับคำตอบ' : 'กำหนดส่ง'}: ${at(win.deadline)}`
    : '';
  const text =
    `🔔 ${assignment.is_exam ? 'แจ้งเตือนทำข้อสอบ' : 'แจ้งเตือนส่งงาน'}\n📘 ${classroomTitle(classroom)}\n📋 ${assignment.title}` +
    (due ? `\n${due}` : '') +
    `\n\nยังไม่ส่ง (${names.length} คน):\n${names.map((name, index) => `${index + 1}. ${name}`).join('\n')}`;
  return withLiffLink(text, assignment.is_exam ? 'กดเพื่อทำข้อสอบ' : 'กดเพื่อส่งงาน', {
    classroomId: classroom.id,
    inviteCode: classroom.invite_code,
    assignmentId: assignment.id,
  });
}
