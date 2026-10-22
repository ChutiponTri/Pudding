import 'server-only';
import { withLiffLink } from '@/lib/line/liffLink';
import { pushLineGroupText } from '@/lib/line/messaging';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';

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
    const { data: classroom } = await supabase.from('classrooms').select('name, line_group_id').eq('id', post.classroom_id).maybeSingle();
    if (!classroom?.line_group_id) continue;
    try {
      await pushLineGroupText(
        classroom.line_group_id,
        buildPostLineMessage(post.activity_type, classroom.name || 'ห้องเรียน', post.body, post.classroom_id, metadata)
      );
      count += 1;
    } catch (pushError) {
      console.error(`Scheduled LINE announcement failed for post ${post.id}:`, pushError);
    }
  }
  return count;
}
