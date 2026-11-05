import 'server-only';
import { withLiffLink } from '@/lib/line/liffLink';
import { isLineQuotaError, pushLineGroupText } from '@/lib/line/messaging';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { classroomTitle, type LabelledClassroom } from '@/lib/utils/classroomLabel';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { formatDateTime, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
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
    title = 'เปิดคาบเช็คชื่อ';
  }
  // A retake's LINE wording (deadline and names) differs from its one-line timeline card.
  const text = typeof metadata.lineBody === 'string' && metadata.lineBody ? metadata.lineBody : body;
  const message = `${icon} ${title}\n📘 ${classroomTitle(classroom)}\n\n${text}`;
  const assignmentId = typeof metadata.assignmentId === 'string' ? metadata.assignmentId : undefined;
  if (activityType === 'attendance') return withLiffLink(message, 'กดเพื่อเช็คชื่อ', { classroomId, inviteCode, view: 'attendance' });
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
  const win = getAssignmentWindow(assignment);
  const due = win.deadline != null ? formatDateTime(new Date(win.deadline).toISOString(), 'th', SCHOOL_TIME_ZONE) : '';
  const text =
    `🔔 ${assignment.is_exam ? 'อย่าลืมทำข้อสอบ' : 'อย่าลืมส่งงาน'}\n📘 ${classroomTitle(classroom)}\n\n${assignment.title}` +
    (due ? `\n${assignment.is_exam ? 'ปิดรับคำตอบ' : 'กำหนดส่ง'}: ${due}` : '');
  return withLiffLink(text, assignment.is_exam ? 'กดเพื่อเริ่มทำข้อสอบ' : 'กดเพื่อเปิดงานและส่งงาน', {
    classroomId: classroom.id,
    inviteCode: classroom.invite_code,
    assignmentId: assignment.id,
  });
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

export type PostLineFailure = 'failed' | 'quota' | 'no_group';

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

/**
 * Sends the LINE "new work" message for scheduled posts whose publish time has
 * passed (the posts API holds it back with metadata.pendingLine). Runs from the
 * reminder cron and whenever a classroom timeline is opened, so the message
 * goes out at publish time even if the cron is late or not set up.
 */
export async function announceScheduledPosts(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  now: Date = new Date(),
  classroomId?: string
): Promise<number> {
  let query = supabase
    .from('classroom_posts')
    .select('id, classroom_id, body, activity_type, metadata')
    .contains('metadata', { pendingLine: true });
  /** Marks a post the bot could not send, so the teacher's timeline offers to share it by hand. */
  const markUnsent = (id: string, metadata: Record<string, unknown>, lineStatus: PostLineFailure) =>
    supabase.from('classroom_posts').update({ metadata: { ...metadata, lineStatus } }).eq('id', id);
  if (classroomId) query = query.eq('classroom_id', classroomId);
  const { data: pending, error } = await query;
  if (error) {
    console.error('Scheduled post lookup failed:', error);
    return 0;
  }

  let count = 0;
  for (const post of pending || []) {
    const metadata = (post.metadata || {}) as Record<string, unknown>;
    const publishAt = typeof metadata.publishAt === 'string' ? new Date(metadata.publishAt).getTime() : 0;
    if (publishAt > now.getTime()) continue;

    // Claim the post first (only if still pending) so overlapping runs can't announce twice.
    const { data: claimed, error: claimError } = await supabase
      .from('classroom_posts')
      .update({ metadata: { ...metadata, pendingLine: false, announcedAt: now.toISOString() } })
      .eq('id', post.id)
      .contains('metadata', { pendingLine: true })
      .select('id');
    if (claimError || !claimed?.length) continue;

    // The assignment may have been deleted while it was scheduled.
    if (typeof metadata.assignmentId === 'string') {
      const { data: assignment } = await supabase.from('assignments').select('id').eq('id', metadata.assignmentId).maybeSingle();
      if (!assignment) continue;
    }
    // Open student/teacher pages show the work right away.
    await signalClassroom(post.classroom_id, {
      type: 'published',
      assignmentId: typeof metadata.assignmentId === 'string' ? metadata.assignmentId : undefined,
    });
    const { data: classroom } = await supabase.from('classrooms').select('id, name, course_name, subject_code, line_group_id, invite_code').eq('id', post.classroom_id).maybeSingle();
    const claimedMetadata = { ...metadata, pendingLine: false, announcedAt: now.toISOString() };
    if (!classroom) continue;
    if (!classroom.line_group_id) {
      await markUnsent(post.id, claimedMetadata, 'no_group');
      continue;
    }
    try {
      await pushLineGroupText(classroom.line_group_id, postLineText(post, classroom));
      count += 1;
    } catch (pushError) {
      console.error(`Scheduled LINE announcement failed for post ${post.id}:`, pushError);
      // Put it back in the queue for the next run; give up after three tries.
      // Out of monthly messages: retrying this month cannot help, the teacher shares it by hand.
      const quota = isLineQuotaError(pushError);
      const attempts = Number(metadata.lineAttempts || 0) + 1;
      if (!quota && attempts < 3) {
        await supabase
          .from('classroom_posts')
          .update({ metadata: { ...metadata, pendingLine: true, lineAttempts: attempts } })
          .eq('id', post.id);
      } else {
        await markUnsent(post.id, claimedMetadata, quota ? 'quota' : 'failed');
      }
    }
  }
  return count;
}
