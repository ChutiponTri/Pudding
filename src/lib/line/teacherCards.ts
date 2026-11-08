import 'server-only';
import { lineDate } from '@/lib/utils/datetime';
import { buildLiffUrl } from '@/lib/line/liffLink';
import { attendanceCard, inviteCard, openClassCard, openWorkCard, remindCard, resultsCard, submitCarousel, welcomeCard, type WorkStatusInput } from '@/lib/line/flex';
import type { FlexMessage } from '@/lib/line/flexKit';
import { webUrl, type ServiceClient } from '@/lib/line/groupLink';
import { isGroupMember } from '@/lib/line/messaging';
import { buildWorkCard, workMeta, type CardClassroom } from '@/lib/line/workCard';
import { missingStudents, remindFooter, remindHeader, studentLabel } from '@/lib/server/workReminder';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { classroomTitle, subjectName } from '@/lib/utils/classroomLabel';
import { SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
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

/** A work's card data with who has not handed it in (reminder card, "ส่งงาน" pages). */
async function workStatus(supabase: ServiceClient, assignment: Assignment, classroom: CardClassroom & { students?: User[] | null }) {
  const url = liff(classroom, { assignmentId: assignment.id });
  if (!url) return null;
  const [{ roster, missing }, meta] = await Promise.all([missingStudents(supabase, assignment, classroom), workMeta(supabase, assignment, classroom)]);
  const win = getAssignmentWindow(assignment);
  const card: WorkStatusInput = {
    isExam: !!assignment.is_exam,
    number: meta.number,
    subject: meta.subject,
    title: assignment.title,
    due: win.deadline != null ? lineDate(win.deadline) : 'ไม่ระบุ',
    closes: !assignment.is_exam && win.lateUntil != null && win.lateUntil !== win.deadline ? lineDate(win.lateUntil) : undefined,
    names: missing.map(studentLabel),
    total: roster.length,
    url,
    statusUrl: liff(classroom, { view: 'work' }),
  };
  return { card, missing };
}

type OpenWork = Array<{ assignment: Assignment; window: ReturnType<typeof getAssignmentWindow> }>;

/** "เหลือ 3 ชม." style countdown to a deadline. */
function timeLeft(deadline: number, now: number) {
  const minutes = Math.floor((deadline - now) / 60000);
  if (minutes < 0) return 'เลยกำหนดแล้ว (ส่งช้าได้)';
  if (minutes < 60) return `เหลือ ${minutes} นาที`;
  if (minutes < 24 * 60) return `เหลือ ${Math.floor(minutes / 60)} ชม.`;
  return `เหลือ ${Math.floor(minutes / (24 * 60))} วัน`;
}

/** "พุดดิ้ง งาน": the "งานที่เปิดรับ" card (open work, most urgent first). */
export function openWorkMessages(classroom: CardClassroom, open: OpenWork): LineMessage[] | null {
  const url = liff(classroom, { view: 'work' });
  if (!url) return null;
  const now = Date.now();
  const rows = open.map(({ assignment, window }) => {
    const deadline = window.deadline;
    const hours = deadline == null ? Infinity : (deadline - now) / 3600000;
    const due = deadline == null ? 'ไม่มีกำหนดส่ง' : `${assignment.is_exam ? 'ปิดรับคำตอบ' : 'กำหนดส่ง'} ${lineDate(deadline)}`;
    return {
      isExam: !!assignment.is_exam,
      title: assignment.title,
      left: deadline == null ? 'เปิดรับอยู่' : timeLeft(deadline, now),
      due: window.isPastDeadline && window.lateUntil ? `ปิดรับส่งงาน ${lineDate(window.lateUntil)}` : due,
      urgency: hours < 24 ? '🔴' : hours < 72 ? '🟡' : '🟢',
      url: liff(classroom, { assignmentId: assignment.id }) || url,
    };
  });
  return [openWorkCard({ classroomTitle: classroomTitle(classroom), rows, total: rows.length, url })];
}

/** "พุดดิ้ง ส่งงาน": one "ส่งงาน" page per open work, each with who has not handed it in. */
export async function submitMessages(
  supabase: ServiceClient,
  classroom: CardClassroom & { students?: User[] | null },
  open: OpenWork
): Promise<LineMessage[] | null> {
  const statuses = await Promise.all(open.slice(0, 10).map(({ assignment }) => workStatus(supabase, assignment, classroom)));
  const pages = statuses.filter((status): status is NonNullable<typeof status> => !!status).map((status) => status.card);
  return pages.length ? [submitCarousel(pages)] : null;
}

/** LINE's textV2 needs literal braces doubled. */
const escapeBraces = (value: string) => value.replace(/[{}]/g, (brace) => brace + brace);
/**
 * The @mention list after the reminder card, sized for a big class: a reply
 * holds 5 messages, so the card plus up to 4 lists of 40 students (well under
 * LINE's 100 mentions and 5000 characters per message), one numbered student
 * per line. Anyone past that is counted at the end.
 */
const PER_MESSAGE = 40;
const MAX_LIST_MESSAGES = 4;
const MAX_TEXT = 4800;

/** Runs `task` over `items`, `limit` at a time (LINE's member checks for a whole class). */
async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]);
      }
    })
  );
  return results;
}

/**
 * The bot's answer to the reminder picture: the "ส่งให้ครูหน่อยน้า~" card,
 * then messages that @mention each student who has not handed in and is
 * in the group (LINE confirms membership; others are listed by name).
 * null = everyone has handed in.
 */
export async function remindReply(
  supabase: ServiceClient,
  assignment: Assignment,
  classroom: CardClassroom & { students?: User[] | null },
  groupId: string
): Promise<LineMessage[] | null> {
  const status = await workStatus(supabase, assignment, classroom);
  if (!status || !status.missing.length) return null;
  const { missing } = status;
  const card = remindCard(status.card);

  const listed = missing.slice(0, PER_MESSAGE * MAX_LIST_MESSAGES);
  // Mention only students LINE says are in this group (a mention of anyone else would not work).
  const inGroup = await mapLimit(listed, 10, (s) => (s.line_uid ? isGroupMember(groupId, s.line_uid).catch(() => false) : Promise.resolve(false)));

  const header = remindHeader(missing.length, !!assignment.is_exam);
  const footer = remindFooter(!!assignment.is_exam);
  const chunks: Array<{ lines: string[]; substitution: Record<string, unknown>; length: number }> = [];
  listed.forEach((student, index) => {
    const mention = inGroup[index] && student.line_uid;
    const line = `${index + 1}. ${mention ? `{s${index}}` : escapeBraces(studentLabel(student))}`;
    let chunk = chunks[chunks.length - 1];
    // A new message every PER_MESSAGE names, or before the text would get too long: never cut inside a line.
    if (!chunk || chunk.lines.length >= PER_MESSAGE || chunk.length + line.length + 1 > MAX_TEXT) {
      chunk = { lines: [], substitution: {}, length: header.length + footer.length + 40 };
      chunks.push(chunk);
    }
    chunk.lines.push(line);
    chunk.length += line.length + 1;
    if (mention) chunk.substitution[`s${index}`] = { type: 'mention', mentionee: { type: 'user', userId: student.line_uid } };
  });
  const rest = missing.length - listed.length;
  const lists = chunks.slice(0, MAX_LIST_MESSAGES).map((chunk, index, all) => {
    const head = index === 0 ? header : `(ต่อ ${index + 1}/${all.length})`;
    const last = index === all.length - 1;
    const tail = (last && rest > 0 ? `\n…และอีก ${rest} คน ดูรายชื่อครบได้ในเมนูครู` : '') + (last ? `\n\n${footer}` : '');
    return {
      type: 'textV2',
      text: `${head}\n${chunk.lines.join('\n')}${tail}`,
      ...(Object.keys(chunk.substitution).length ? { substitution: chunk.substitution } : {}),
    };
  });
  return [card, ...lists];
}
