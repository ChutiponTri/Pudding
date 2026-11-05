import 'server-only';
import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { isLineQuotaError, pushLineGroupText } from '@/lib/line/messaging';
import { postLineText, type PostActivityType, type PostLineFailure } from '@/lib/line/classroomAnnouncement';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { postShareToken, reannounceShareToken, remindShareToken, resultsShareToken } from '@/lib/server/inviteCodes';
import type { LabelledClassroom } from '@/lib/utils/classroomLabel';
import { formatDateTime, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
import { rosterFor } from '@/lib/utils/retake';
import type { Assignment, User } from '@/types/database';
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
 * Timeline/LINE text for new work. A retake lists the students who take it
 * (from the classroom roster); only they can open it.
 */
export function assignmentPostBody(
  a: Pick<Assignment, 'is_exam' | 'title' | 'due_date' | 'retake_student_ids'>,
  /** The classroom roster: a retake names its students from it. */
  students?: Array<Pick<User, 'id' | 'line_uid' | 'first_name' | 'last_name'> & { name?: string }> | null
) {
  const due = formatDateTime(a.due_date, 'th', SCHOOL_TIME_ZONE);
  if (Array.isArray(a.retake_student_ids)) {
    const names = rosterFor(a, (students || []).filter((s) => !!s?.id)).map(studentName);
    // Retake titles often start with "สอบซ่อม" already; never say it twice.
    const title = a.title.replace(/^\s*สอบซ่อม(\s*[:：-]\s*|\s+)/, '') || a.title;
    const head = `สอบซ่อม: ${title}\nกำหนดส่ง: ${due}`;
    if (!names.length) return `${head}\n\nเฉพาะนักเรียนที่คุณครูแจ้ง ${a.retake_student_ids.length} คน`;
    return `${head}\n\nเฉพาะนักเรียนต่อไปนี้ (${names.length} คน):\n${names.map((name, i) => `${i + 1}. ${name}`).join('\n')}`;
  }
  return `${a.is_exam ? 'ข้อสอบใหม่' : 'งานใหม่'}: ${a.title} (${a.is_exam ? 'ปิดรับคำตอบ' : 'กำหนดส่ง'}: ${due})`;
}

const studentName = (s: Partial<User> & { name?: string }) => `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.name || 'ไม่ระบุชื่อ';

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
    /** The LINE message's own wording; otherwise it is built from the post (buildPostLineMessage). */
    lineText?: string;
  }
): Promise<{
  post: ClassroomPost;
  deduplicated: boolean;
  /**
   * 'sent' | 'failed' | 'quota' (the LINE plan's monthly messages are used up) |
   * 'no_group' (classroom not linked to LINE) | 'scheduled' (sent at publish time).
   */
  line?: 'sent' | 'failed' | 'quota' | 'no_group' | 'scheduled';
  /** The bot could not send it: the teacher shares it to LINE by hand (see postShare). */
  share?: PostShare;
}> {
  const { classroom, activityType } = input;
  const body = input.body.trim();
  const metadata: Record<string, unknown> = { ...(input.metadata || {}), ...(input.lineText ? { lineText: input.lineText } : {}) };
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

  let line: 'sent' | 'failed' | 'quota' | 'no_group' | 'scheduled' = isScheduled ? 'scheduled' : 'no_group';
  if (!isScheduled) {
    const lineGroupId = classroom.line_group_id;
    if (lineGroupId) {
      try {
        await pushLineGroupText(lineGroupId, postLineText(newPost, classroom));
        line = 'sent';
      } catch (lineError) {
        line = isLineQuotaError(lineError) ? 'quota' : 'failed';
        console.error(`Classroom post LINE push failed for ${saved.id}:`, lineError);
      }
    }
    // Scheduled posts stay hidden from students, so there is nothing to show them yet.
    after(() => signalClassroom(classroom.id, { type: 'timeline' }));
  }
  let share: PostShare | undefined;
  let result = saved as ClassroomPost;
  if (line === 'failed' || line === 'quota' || line === 'no_group') {
    share = postShare(saved.id, postLineText(newPost, classroom));
    // Remembered on the post: the teacher's timeline keeps offering to share it by hand.
    const marked = { ...metadata, lineStatus: line satisfies PostLineFailure };
    const { error: markError } = await supabase.from('classroom_posts').update({ metadata: marked }).eq('id', saved.id);
    if (!markError) result = { ...result, metadata: marked };
  }
  return { post: result, deduplicated: false, line, share };
}

/** Teachers' timeline: a post the bot could not send carries how to share it by hand. */
export function withLineShare<T extends ClassroomPost>(
  post: T,
  classroom: LabelledClassroom & { id: string; invite_code?: string | null }
): T & { line_share?: PostShare & { reason: PostLineFailure } } {
  const reason = post.metadata?.lineStatus;
  if (reason !== 'failed' && reason !== 'quota' && reason !== 'no_group') return post;
  return { ...post, line_share: { reason, ...postShare(post.id, postLineText(post, classroom)) } };
}

export interface PostShare {
  /** The full LINE text (with its link), to copy and paste. */
  text: string;
  /** LIFF page that shares the bot's message from the teacher's own LINE (/liff/share); null without a LIFF id. */
  url: string | null;
}

/**
 * A post the bot could not send (monthly quota used up, LINE error, or no
 * linked group): the teacher sends the same message from their own LINE
 * account, which costs the bot's quota nothing.
 */
export function postShare(postId: string, text: string): PostShare {
  return { text, url: shareUrl(postShareToken(postId)) };
}

/** Re-announcing a work the bot could not send: shared by hand like a post. */
export function reannounceShare(assignmentId: string, text: string): PostShare {
  return { text, url: shareUrl(reannounceShareToken(assignmentId)) };
}

/** A work's reminder ("ทวงงาน") the bot could not send: shared by hand like a post. */
export function remindShare(assignmentId: string, text: string): PostShare {
  return { text, url: shareUrl(remindShareToken(assignmentId)) };
}

/** A work's score announcement ("ประกาศคะแนน") the bot could not send: shared by hand like a post. */
export function resultsShare(assignmentId: string, text: string): PostShare {
  return { text, url: shareUrl(resultsShareToken(assignmentId)) };
}

/** The /liff/share page for a share token; null without a LIFF id. */
function shareUrl(token: string): string | null {
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID;
  return liffId ? `https://liff.line.me/${liffId}/share?t=${encodeURIComponent(token)}` : null;
}
