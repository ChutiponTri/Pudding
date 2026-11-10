import 'server-only';
import { dueText } from '@/lib/utils/lineDates';
import { withLiffLink } from '@/lib/line/liffLink';
import { classroomTitle, type LabelledClassroom } from '@/lib/utils/classroomLabel';
import { SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
import type { Assignment } from '@/types/database';

export type PostActivityType = 'announcement' | 'assignment' | 'exam' | 'attendance';

/** LINE group text for a classroom timeline post, with a tap-through link to the right place. */
export function buildPostLineMessage(
  activityType: PostActivityType,
  classroom: LabelledClassroom,
  body: string,
  classroomId: string,
  metadata: Record<string, unknown> = {},
  /** Lets group members who have not joined yet request to join from the link. */
  inviteCode?: string | null,
  /** The post itself: an announcement's link opens it in a popup in the LIFF. */
  postId?: string
): string {
  let icon = '📢';
  let title = 'ประกาศจากครู';
  if (activityType === 'assignment') {
    icon = '📋';
    title = 'งานใหม่';
  } else if (activityType === 'exam') {
    icon = metadata.retake ? '🔁' : '📝';
    title = metadata.retake ? 'สอบซ่อม' : 'ข้อสอบใหม่';
  } else if (activityType === 'attendance') {
    icon = '⏰';
    title = 'เปิดคาบเช็กชื่อ';
  }
  // A retake's LINE wording (deadline and names) differs from its one-line timeline card.
  const text = typeof metadata.lineBody === 'string' && metadata.lineBody ? metadata.lineBody : body;
  const message = `${icon} ${title}\n📘 ${classroomTitle(classroom)}\n\n${text}`;
  const assignmentId = typeof metadata.assignmentId === 'string' ? metadata.assignmentId : undefined;
  if (activityType === 'attendance') return withLiffLink(`${message}\n\n📷 สแกน QR บนหน้าจอของคุณครูเพื่อเช็กชื่อ`, 'เปิดหน้าเช็กชื่อ', { classroomId, inviteCode, view: 'attendance' });
  if ((activityType === 'assignment' || activityType === 'exam') && assignmentId) {
    return withLiffLink(message, activityType === 'exam' ? 'กดเพื่อเริ่มทำข้อสอบ' : 'กดเพื่อเปิดงานและส่งงาน', { classroomId, inviteCode, assignmentId });
  }
  // An announcement's button opens it in a popup in the LIFF.
  if (postId) return withLiffLink(message, 'อ่านประกาศใน Pudding', { classroomId, inviteCode, view: 'timeline', postId });
  return withLiffLink(message, 'เปิดห้องเรียนใน Pudding', { classroomId, inviteCode });
}

/** LINE text that posts a work's link to the class group again ("ส่งซ้ำ"). */
export function reannounceLineText(
  assignment: Assignment,
  classroom: LabelledClassroom & { id: string; invite_code?: string | null }
): string {
  const due = dueText(assignment);
  const text =
    `🔔 ${assignment.is_exam ? 'อย่าลืมทำข้อสอบ' : 'อย่าลืมส่งงาน'}\n📘 ${classroomTitle(classroom)}\n\n${assignment.title}` +
    (due ? `\n${due}` : '');
  return withLiffLink(text, assignment.is_exam ? 'กดเพื่อเริ่มทำข้อสอบ' : 'กดเพื่อเปิดงานและส่งงาน', {
    classroomId: classroom.id,
    inviteCode: classroom.invite_code,
    assignmentId: assignment.id,
  });
}

/**
 * An open attendance period called again ("ส่งซ้ำใน LINE"): the check-in
 * deadlines as clock times, since "within 10 minutes" no longer holds later.
 */
export function attendanceLineText(
  session: { title: string; starts_at: string; on_time_until_minutes: number; late_until_minutes: number },
  classroom: LabelledClassroom & { id: string; invite_code?: string | null }
): string {
  const start = new Date(session.starts_at).getTime();
  const at = (minutes: number) =>
    new Date(start + minutes * 60_000).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: SCHOOL_TIME_ZONE });
  const text =
    `⏰ อย่าลืมเช็กชื่อ\n📘 ${classroomTitle(classroom)}\nคาบ: ${session.title}\n\n` +
    `⏱️ ตรงเวลาถึง ${at(session.on_time_until_minutes)} น.\nเช็กชื่อได้ (สาย) ถึง ${at(session.late_until_minutes)} น.`;
  return withLiffLink(`${text}\n\n📷 สแกน QR บนหน้าจอของคุณครูเพื่อเช็กชื่อ`, 'เปิดหน้าเช็กชื่อ', { classroomId: classroom.id, inviteCode: classroom.invite_code, view: 'attendance' });
}

/** LINE text announcing a work's scores ("ประกาศคะแนน"); the link opens the student's own result. */
export function resultsLineText(
  assignment: Pick<Assignment, 'id' | 'title' | 'is_exam'>,
  classroom: LabelledClassroom & { id: string; invite_code?: string | null }
): string {
  const text =
    `📣 ประกาศคะแนน\n📘 ${classroomTitle(classroom)}\n📋 ${assignment.title}\n\n` +
    `คุณครูประกาศคะแนน${assignment.is_exam ? 'ข้อสอบ' : 'งาน'}นี้แล้ว ดูคะแนนและความเห็นของคุณครูได้ที่ลิงก์ด้านล่าง`;
  return withLiffLink(text, 'กดเพื่อดูคะแนน', { classroomId: classroom.id, inviteCode: classroom.invite_code, assignmentId: assignment.id });
}

/** Why a post's LINE message did not go out; kept in its metadata (lineStatus) so the teacher can share it by hand. */
/** "เชิญในไลน์": the classroom's join invitation (code + a button that opens the join form in LINE). */
export function joinLineText(classroom: LabelledClassroom & { id: string; invite_code?: string | null }): string {
  const lines = [`🎓 เชิญเข้าห้องเรียน\n📘 ${classroomTitle(classroom)}`];
  if (classroom.invite_code) lines.push(`รหัสเข้าห้อง: ${classroom.invite_code}`);
  lines.push('นักเรียนที่ยังไม่ได้เข้าห้อง กดปุ่มด้านล่าง กรอกชื่อ แล้วรอคุณครูอนุมัติ');
  return withLiffLink(lines.join('\n'), 'กดเพื่อเข้าร่วมห้องเรียน', { classroomId: classroom.id, inviteCode: classroom.invite_code });
}

/** 'card': new work waiting for the teacher to share its trigger (the bot then posts the card). */
export type PostLineFailure = 'failed' | 'quota' | 'no_group' | 'card';

/**
 * A post's LINE text: its own wording when it was saved with one
 * (metadata.lineText, e.g. attendance), otherwise built from the post.
 */
export function postLineText(
  post: { id?: string; activity_type: PostActivityType; body: string; metadata?: Record<string, unknown> | null },
  classroom: LabelledClassroom & { id: string; invite_code?: string | null }
): string {
  const metadata = (post.metadata || {}) as Record<string, unknown>;
  if (typeof metadata.lineText === 'string' && metadata.lineText) return metadata.lineText;
  return buildPostLineMessage(post.activity_type, classroom, post.body, classroom.id, metadata, classroom.invite_code, post.id);
}
