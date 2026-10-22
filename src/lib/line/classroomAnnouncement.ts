import 'server-only';
import { withLiffLink } from '@/lib/line/liffLink';

export type PostActivityType = 'announcement' | 'assignment' | 'exam' | 'attendance';

/** LINE group text for a classroom timeline post, with a tap-through link to the right place. */
export function buildPostLineMessage(
  activityType: PostActivityType,
  classroomName: string,
  body: string,
  classroomId: string,
  metadata: Record<string, unknown> = {}
): string {
  let icon = '📢';
  let title = 'ประกาศจากครู';
  if (activityType === 'assignment') {
    icon = '📋';
    title = 'งานใหม่';
  } else if (activityType === 'exam') {
    icon = '📝';
    title = 'ข้อสอบใหม่';
  } else if (activityType === 'attendance') {
    icon = '⏰';
    title = 'เปิดคาบเช็คชื่อ';
  }
  const message = `${icon} ${title}\nห้อง: ${classroomName}\n\n${body}`;
  const assignmentId = typeof metadata.assignmentId === 'string' ? metadata.assignmentId : undefined;
  if (activityType === 'attendance') return withLiffLink(message, 'กดเพื่อเช็คชื่อ', { classroomId, view: 'attendance' });
  if ((activityType === 'assignment' || activityType === 'exam') && assignmentId) {
    return withLiffLink(message, activityType === 'exam' ? 'กดเพื่อเริ่มทำข้อสอบ' : 'กดเพื่อเปิดงานและส่งงาน', { classroomId, assignmentId });
  }
  return withLiffLink(message, 'เปิดห้องเรียนใน Pudding', { classroomId });
}
