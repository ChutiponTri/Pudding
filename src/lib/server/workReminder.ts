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

/**
 * A deadline reminder the cron could not send (assignments.line_reminder_unsent):
 * 'quota' / 'failed' / 'no_group' wait for the teacher to share it by hand
 * (UnsentReminderNotice on teacher pages); 'retry' = a LINE error the next
 * runs try again (up to REMINDER_TRIES), not shown to the teacher yet.
 */
export type UnsentReminder = { reason: 'quota' | 'failed' | 'no_group' | 'retry'; at: string; attempts?: number };
export const REMINDER_TRIES = 3;

/** Whether this database has assignments.line_reminder_unsent (supabase_reminder_unsent_update.sql). */
const missingColumn = (error: { message?: string } | null) => !!error?.message?.includes('line_reminder_unsent');

/**
 * Saves how a deadline reminder went. `done` moves line_last_reminded_at on
 * (this reminder is not sent again); without the column only that is saved.
 */
export async function saveReminderOutcome(supabase: Supabase, assignmentId: string, unsent: UnsentReminder | null, done: boolean, now: Date) {
  const patch: Record<string, unknown> = { line_reminder_unsent: unsent, ...(done ? { line_last_reminded_at: now.toISOString() } : {}) };
  const { error } = await supabase.from('assignments').update(patch).eq('id', assignmentId);
  if (!missingColumn(error)) {
    if (error) console.error(`Saving reminder outcome failed for ${assignmentId}:`, error);
    return;
  }
  // Older database: no record of the failure; a finished reminder still must not repeat every run.
  if (done) await supabase.from('assignments').update({ line_last_reminded_at: now.toISOString() }).eq('id', assignmentId);
}

/** The teacher shared (or dismissed) a reminder the bot could not send. */
export async function clearUnsentReminder(supabase: Supabase, assignmentId: string) {
  const { error } = await supabase.from('assignments').update({ line_reminder_unsent: null }).eq('id', assignmentId).not('line_reminder_unsent', 'is', null);
  if (error && !missingColumn(error)) console.error(`Clearing unsent reminder failed for ${assignmentId}:`, error);
}
