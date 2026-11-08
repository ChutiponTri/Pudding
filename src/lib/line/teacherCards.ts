import 'server-only';
import { buildLiffUrl } from '@/lib/line/liffLink';
import { attendanceCard, inviteCard, openClassCard, remindCard, resultsCard, welcomeCard } from '@/lib/line/flex';
import type { FlexMessage } from '@/lib/line/flexKit';
import { webUrl, type ServiceClient } from '@/lib/line/groupLink';
import { isGroupMember } from '@/lib/line/messaging';
import { buildWorkCard, workMeta, type CardClassroom } from '@/lib/line/workCard';
import { missingStudents, studentLabel } from '@/lib/server/workReminder';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { classroomTitle, subjectName } from '@/lib/utils/classroomLabel';
import { formatDateTime, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
import type { Assignment, User } from '@/types/database';

/**
 * What the teacher's LINE sends into the class group, ready to send: from
 * the teacher LIFF pages (liff.sendMessages, straight into the group they
 * were opened from) or from /liff/share (the website; the teacher picks the
 * group). These are the finished cards, so no bot reply is needed and no
 * message quota is used. The one exception is "ทวงงาน": the teacher sends the
 * reminder picture, and the bot answers it with the card and @mentions of
 * who has not handed in (only the bot can mention people).
 */

export type LineMessage = Record<string, unknown>;
type Session = { id: string; title: string; starts_at: string; on_time_until_minutes: number; late_until_minutes: number };

const liff = (classroom: CardClassroom, options: Parameters<typeof buildLiffUrl>[0] = {}) =>
  buildLiffUrl({ classroomId: classroom.id, inviteCode: classroom.invite_code, ...options });

const at = (ms: number) => formatDateTime(new Date(ms).toISOString(), 'th', SCHOOL_TIME_ZONE);

export async function workMessages(supabase: ServiceClient, assignment: Assignment, classroom: CardClassroom): Promise<LineMessage[] | null> {
  const card = await buildWorkCard(supabase, assignment, classroom);
  return card ? [card] : null;
}

export async function resultsMessages(supabase: ServiceClient, assignment: Assignment, classroom: CardClassroom): Promise<LineMessage[] | null> {
  const url = liff(classroom, { assignmentId: assignment.id });
  if (!url) return null;
  const { number, byline } = await workMeta(supabase, assignment, classroom);
  return [resultsCard({ isExam: !!assignment.is_exam, number, byline, title: assignment.title, url, statusUrl: liff(classroom, { view: 'work' }) })];
}

/** Clock time ("14:30") a check-in period's minute mark falls on. */
const clockAt = (startsAt: string, minutes: number) =>
  new Date(new Date(startsAt).getTime() + minutes * 60_000).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: SCHOOL_TIME_ZONE });

export function attendanceMessages(session: Session, classroom: CardClassroom): LineMessage[] | null {
  const url = liff(classroom, { view: 'attendance' });
  if (!url) return null;
  return [
    attendanceCard({
      classroomTitle: classroomTitle(classroom),
      sessionTitle: session.title,
      onTimeUntil: clockAt(session.starts_at, session.on_time_until_minutes),
      lateUntil: clockAt(session.starts_at, session.late_until_minutes),
      url,
    }),
  ];
}

export function inviteMessages(classroom: CardClassroom): LineMessage[] | null {
  const url = liff(classroom);
  return url ? [inviteCard({ classroomTitle: classroomTitle(classroom), inviteCode: classroom.invite_code, url })] : null;
}

async function teacherFirstName(supabase: ServiceClient, classroom: CardClassroom) {
  if (!classroom.teacher_id) return null;
  const { data } = await supabase.from('users').select('first_name').eq('id', classroom.teacher_id).maybeSingle();
  return (data?.first_name as string | null) || null;
}

/** "เปิดห้องเรียน": the group now belongs to the classroom (and "พุดดิ้ง หน้าหลัก"). */
export async function openClassMessages(supabase: ServiceClient, classroom: CardClassroom): Promise<FlexMessage[] | null> {
  const url = liff(classroom);
  if (!url) return null;
  const teacherName = await teacherFirstName(supabase, classroom);
  return [openClassCard({ classroomTitle: classroomTitle(classroom), subject: subjectName(classroom), teacherName, url })];
}

/** "แนะนำนักเรียน": the welcome card, without a name, with the open work count. */
export async function guideMessages(supabase: ServiceClient, classroom: CardClassroom): Promise<LineMessage[] | null> {
  const url = liff(classroom);
  if (!url) return null;
  const { data } = await supabase.from('assignments').select('*').eq('classroom_id', classroom.id);
  const open = ((data || []) as Assignment[]).filter((work) => getAssignmentWindow(work).acceptsSubmissions).length;
  return [welcomeCard({ classroomTitle: classroomTitle(classroom), subject: subjectName(classroom), openWork: open, url })];
}

// ---------------------------------------------------------------------------
// ทวงงาน: the teacher's picture, then the bot's card and @mentions
// ---------------------------------------------------------------------------

/**
 * The reminder picture the teacher sends ("ส่งงานกันน้า~ พุดดิ้งมาทวงแล้ว!").
 * Its address carries which work it is about (see cardTrigger): LINE gives the
 * bot the address of a picture sent through LIFF, so nothing else needs to be
 * posted for the bot to answer with the reminder card.
 */
export function remindPicture(classroom: CardClassroom, assignment: Pick<Assignment, 'id'>): LineMessage {
  const query = `v=3&card=remind&classId=${encodeURIComponent(classroom.id)}&assignmentId=${encodeURIComponent(assignment.id)}`;
  return {
    type: 'image',
    originalContentUrl: webUrl(`/cards/line/remind-teacher-send.jpg?${query}`),
    previewImageUrl: webUrl(`/cards/line/remind-teacher-send-preview.jpg?${query}`),
  };
}

/** LINE's textV2 needs literal braces doubled. */
const escapeBraces = (value: string) => value.replace(/[{}]/g, (brace) => brace + brace);
const MAX_MENTIONS = 50;

/**
 * The bot's answer to the reminder picture: the "ส่งให้ครูหน่อยน้า~" card,
 * then a message that @mentions each student who has not handed in and is
 * in the group (LINE confirms membership; others are listed by name).
 * null = everyone has handed in.
 */
export async function remindReply(
  supabase: ServiceClient,
  assignment: Assignment,
  classroom: CardClassroom & { students?: User[] | null },
  groupId: string
): Promise<LineMessage[] | null> {
  const url = liff(classroom, { assignmentId: assignment.id });
  if (!url) return null;
  const [{ roster, missing }, meta] = await Promise.all([missingStudents(supabase, assignment, classroom), workMeta(supabase, assignment, classroom)]);
  if (!missing.length) return null;
  const win = getAssignmentWindow(assignment);
  const due = win.isPastDeadline && win.lateUntil ? `เลยกำหนดแล้ว • ส่งช้าได้ถึง ${at(win.lateUntil)}` : win.deadline != null ? at(win.deadline) : 'ไม่ระบุ';
  const card = remindCard({
    isExam: !!assignment.is_exam,
    number: meta.number,
    subject: meta.subject,
    title: assignment.title,
    due,
    names: missing.map(studentLabel),
    total: roster.length,
    url,
    statusUrl: liff(classroom, { view: 'work' }),
  });

  // Mention only students LINE says are in this group (a mention of anyone else would not work).
  const candidates = missing.filter((s) => s.line_uid).slice(0, MAX_MENTIONS);
  const inGroup = await Promise.all(candidates.map((s) => isGroupMember(groupId, s.line_uid!).catch(() => false)));
  const mentionable = new Set(candidates.filter((_, index) => inGroup[index]).map((s) => s.id));
  const substitution: Record<string, unknown> = {};
  const parts = missing.map((student, index) => {
    if (!mentionable.has(student.id)) return escapeBraces(studentLabel(student));
    const key = `s${index}`;
    substitution[key] = { type: 'mention', mentionee: { type: 'user', userId: student.line_uid } };
    return `{${key}}`;
  });
  const what = assignment.is_exam ? 'มาทำข้อสอบ' : 'มาส่งงานให้ครู';
  const mention = {
    type: 'textV2',
    text: `☝️ พุดดิ้งขออนุญาตทวง นักเรียนต่อไปนี้${what}หน่อยน้า ทวง ทวง\n${parts.join('\n')}`.slice(0, 5000),
    ...(Object.keys(substitution).length ? { substitution } : {}),
  };
  return [card, mention];
}
