import 'server-only';
import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { pushLineGroupText } from '@/lib/line/messaging';
import { buildPostLineMessage, type PostActivityType } from '@/lib/line/classroomAnnouncement';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import type { LabelledClassroom } from '@/lib/utils/classroomLabel';
import { formatDateTime, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
import type { Assignment } from '@/types/database';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';

export type ClassroomPost = {
  id: string;
  classroom_id: string;
  author_id: string;
  body: string;
  activity_type: PostActivityType;
  metadata?: Record<string, unknown>;
  created_at: string;
};

/** Metadata of a work post: links it to the work, and marks a retake (its LINE message says so). */
export function assignmentPostMetadata(a: Pick<Assignment, 'is_exam' | 'due_date' | 'group_name' | 'retake_student_ids'>, assignmentId: string) {
  return {
    assignmentId,
    dueDate: a.due_date,
    groupName: a.group_name || (a.is_exam ? 'ข้อสอบ' : 'งานทั่วไป'),
    ...(Array.isArray(a.retake_student_ids) ? { retake: true } : {}),
  };
}

/** Prefixes of work posts; the edit path rewrites posts that start with one of them. */
export const ASSIGNMENT_POST_PREFIX = /^(งานใหม่|ข้อสอบใหม่|สอบซ่อม):/;

/**
 * Timeline/LINE text for new work. A retake names no students (the group
 * sees the post); only the chosen students can open it.
 */
export function assignmentPostBody(a: Pick<Assignment, 'is_exam' | 'title' | 'due_date' | 'retake_student_ids'>) {
  const due = formatDateTime(a.due_date, 'th', SCHOOL_TIME_ZONE);
  if (Array.isArray(a.retake_student_ids)) {
    return `สอบซ่อม: ${a.title} (ปิดรับคำตอบ: ${due})\nเฉพาะนักเรียนที่คุณครูแจ้ง ${a.retake_student_ids.length} คน`;
  }
  return `${a.is_exam ? 'ข้อสอบใหม่' : 'งานใหม่'}: ${a.title} (${a.is_exam ? 'ปิดรับคำตอบ' : 'กำหนดส่ง'}: ${due})`;
}

/**
 * Adds a timeline post and announces it in the classroom's LINE group.
 * Scheduled posts (publishAt in the future) appear at that time and their LINE
 * message is sent by announceScheduledPosts. Assignment posts are idempotent
 * per assignment, so a retried creation never announces twice.
 */
export async function createClassroomPost(
  supabase: ReturnType<typeof createServiceSupabaseClient>,
  input: {
    classroom: LabelledClassroom & { id: string; line_group_id?: string | null; invite_code?: string | null };
    authorId: string;
    body: string;
    activityType: PostActivityType;
    metadata?: Record<string, unknown>;
    publishAt?: string;
  }
): Promise<{
  post: ClassroomPost;
  deduplicated: boolean;
  /** 'sent' | 'failed' | 'no_group' (classroom not linked to LINE) | 'scheduled' (sent at publish time). */
  line?: 'sent' | 'failed' | 'no_group' | 'scheduled';
}> {
  const { classroom, activityType } = input;
  const body = input.body.trim();
  const metadata: Record<string, unknown> = { ...(input.metadata || {}) };
  const publishAtMs = input.publishAt ? new Date(input.publishAt).getTime() : NaN;
  const isScheduled = !Number.isNaN(publishAtMs) && publishAtMs > Date.now();
  if (isScheduled) {
    metadata.publishAt = new Date(publishAtMs).toISOString();
    metadata.pendingLine = true;
  }

  const assignmentId = typeof metadata.assignmentId === 'string' ? metadata.assignmentId : '';
  if (assignmentId && (activityType === 'assignment' || activityType === 'exam')) {
    const { data: existing } = await supabase
      .from('classroom_posts')
      .select('*')
      .eq('classroom_id', classroom.id)
      .eq('activity_type', activityType)
      .contains('metadata', { assignmentId })
      .limit(1);
    if (existing?.[0]) return { post: existing[0] as ClassroomPost, deduplicated: true };
  }

  const newPost: ClassroomPost = {
    id: `post-${Date.now()}-${randomUUID().slice(0, 8)}`,
    classroom_id: classroom.id,
    author_id: input.authorId,
    body,
    activity_type: activityType,
    metadata,
    created_at: isScheduled ? new Date(publishAtMs).toISOString() : new Date().toISOString(),
  };
  const { data: saved, error } = await supabase.from('classroom_posts').insert(newPost).select('*').single();
  if (error) throw new Error(error.message);

  let line: 'sent' | 'failed' | 'no_group' | 'scheduled' = isScheduled ? 'scheduled' : 'no_group';
  if (!isScheduled) {
    const lineGroupId = classroom.line_group_id;
    if (lineGroupId) {
      try {
        await pushLineGroupText(lineGroupId, buildPostLineMessage(activityType, classroom, body, classroom.id, metadata, classroom.invite_code));
        line = 'sent';
      } catch (lineError) {
        line = 'failed';
        console.error(`Classroom post LINE push failed for ${saved.id}:`, lineError);
      }
    }
    // Scheduled posts stay hidden from students, so there is nothing to show them yet.
    after(() => signalClassroom(classroom.id, { type: 'timeline' }));
  }
  return { post: saved as ClassroomPost, deduplicated: false, line };
}
