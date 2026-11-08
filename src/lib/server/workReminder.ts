import 'server-only';
import { dueText } from '@/lib/utils/lineDates';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';
import { withLiffLink } from '@/lib/line/liffLink';
import { classroomTitle, type LabelledClassroom } from '@/lib/utils/classroomLabel';
import { isHandedIn } from '@/lib/utils/gradingStatus';
import { isRetake, rosterFor } from '@/lib/utils/retake';
import { hydratedStudents } from '@/lib/server/dataActions';
import type { Assignment, Classroom, User } from '@/types/database';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;
type ReminderClassroom = LabelledClassroom & { id: string; invite_code?: string | null; students?: User[] | null };

const nameOf = (s: Partial<User> & { name?: string }) => `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.name || 'ไม่ระบุชื่อ';

/** Who takes this work (the retake's list, if any), and which of them have not handed it in. */
export async function missingStudents(supabase: Supabase, assignment: Assignment, classroom: ReminderClassroom): Promise<{ roster: User[]; missing: User[] }> {
  // A retake's list holds the ids the teacher's pages use; match it against the same roster.
  const students = isRetake(assignment) ? await hydratedStudents(supabase, classroom as Classroom) : classroom.students || [];
  const roster = rosterFor(assignment, students.filter((s): s is User => !!s?.id));
  if (!roster.length) return { roster, missing: [] };
  const { data } = await supabase.from('submissions').select('student_id, status').eq('assignment_id', assignment.id);
  const handedIn = new Set((data || []).filter((row) => isHandedIn(row)).map((row) => row.student_id as string));
  return { roster, missing: roster.filter((s) => !handedIn.has(s.id) && !(s.line_uid && handedIn.has(s.line_uid))) };
}

/** Names of the students who have not handed this work in. */
export async function missingStudentNames(supabase: Supabase, assignment: Assignment, classroom: ReminderClassroom): Promise<string[]> {
  return (await missingStudents(supabase, assignment, classroom)).missing.map(nameOf);
}

/** "[123] ชื่อ นามสกุล" for lists in LINE: the last 3 digits of the student number are enough. */
export const studentLabel = (s: Partial<User> & { name?: string }) => {
  const number = (s.student_id || '').trim();
  return `${number ? `[${number.slice(-3)}] ` : ''}${nameOf(s)}`;
};

/** The "ทวงงาน" LINE text: the work, its deadline (or late window), and who has not handed in. */
/**
 * ทวงงาน's words (the teacher's templates, homework and quiz): the opening with
 * how many are left, then the numbered names, then the closing line.
 */
export function remindHeader(missing: number, isExam: boolean): string {
  return isExam
    ? `🚨 ปุกาศ ๆ ~ จากน้องพุดดิ้ง 🍮💗\n\nตอนนี้ยังเหลือเพื่อน ๆ ที่ยัง “ไม่ได้สอบ” อีก ${missing} คน น้าาา\n\n📋 รายชื่อคนเก่งที่พุดดิ้งรอ\n`
    : `🚨ปุกาศ ๆ ~ จาก น้องพุดดิ้ง 🍮💗\n\n📝 ตอนนี้เหลืออีก ${missing} คน เท่านั้นเอง`;
}

export function remindFooter(isExam: boolean): string {
  return isExam ? '✅ อย่าลืมมา “สอบ” กันน้าาา\nพุดดิ้งรออยู่นะค้าบบบ 🥺✨' : 'พุดดิ้งรอรับงานอยู่น้า ส่งมาให้พุดดิ้งชื่นใจหน่อยเร็ววว 🥺✨';
}

export function reminderLineText(assignment: Assignment, classroom: ReminderClassroom, names: string[]): string {
  const due = dueText(assignment);
  // Same words as the group message (remindHeader / remindFooter), with the work it is about after the first line.
  const isExam = !!assignment.is_exam;
  const [opening, ...rest] = remindHeader(names.length, isExam).split('\n');
  const work = `📘 ${classroomTitle(classroom)}\n📋 ${assignment.title}${due ? `\n${due}` : ''}`;
  const text =
    `${opening}\n${work}\n${rest.join('\n')}\n${names.map((name, index) => `${index + 1}. ${name}`).join('\n')}` +
    `\n\n${remindFooter(isExam)}`;
  return withLiffLink(text, assignment.is_exam ? 'กดเพื่อทำข้อสอบ' : 'กดเพื่อส่งงาน', {
    classroomId: classroom.id,
    inviteCode: classroom.invite_code,
    assignmentId: assignment.id,
  });
}
