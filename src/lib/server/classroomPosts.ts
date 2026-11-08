import 'server-only';
import { dueText } from '@/lib/utils/lineDates';
import { lineDate } from '@/lib/utils/datetime';
import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { isLineQuotaError, lineMessagesForText, pushLineGroupText } from '@/lib/line/messaging';
import { workMessages, type LineMessage } from '@/lib/line/teacherCards';
import { postLineText, type PostActivityType, type PostLineFailure } from '@/lib/line/classroomAnnouncement';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { attendanceShareToken, joinShareToken, postShareToken, teacherInviteShareToken, reannounceShareToken, remindShareToken, resultsShareToken } from '@/lib/server/inviteCodes';
import type { LabelledClassroom } from '@/lib/utils/classroomLabel';
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

type RosterStudent = Pick<User, 'id' | 'line_uid' | 'first_name' | 'last_name'> & { name?: string };

/**
 * Metadata of a work post: links it to the work, and marks a retake. A
 * retake's LINE message has its own wording (lineBody: due date and the
 * students' names), while the timeline card keeps the one-line body.
 */
export function assignmentPostMetadata(
  a: Pick<Assignment, 'is_exam' | 'title' | 'due_date' | 'group_name' | 'retake_student_ids'>,
  assignmentId: string,
  /** The classroom roster: a retake's LINE message names its students from it. */
  students?: RosterStudent[] | null
) {
  return {
    assignmentId,
    dueDate: a.due_date,
    groupName: a.group_name || (a.is_exam ? 'ข้อสอบ' : 'งานทั่วไป'),
    ...(Array.isArray(a.retake_student_ids) ? { retake: true, lineBody: retakeLineBody(a, students) } : {}),
  };
}

/** Prefixes of work posts; the edit path rewrites posts that start with one of them. */
export const ASSIGNMENT_POST_PREFIX = /^(งานใหม่|ข้อสอบใหม่|ข้อสอบซ่อม|สอบซ่อม):/;

/**
 * The system adds "สอบซ่อม" itself (labels, posts, LINE), so a title that
 * already starts with it (older retakes) is shown without it.
 */
export const retakeTitle = (title: string) => title.replace(/^\s*สอบซ่อม(\s*[:：-]\s*|\s+)/, '') || title;

/** Timeline card text for new work: one line, title and deadline. */
export function assignmentPostBody(a: Pick<Assignment, 'is_exam' | 'title' | 'due_date' | 'retake_student_ids'> & Partial<Pick<Assignment, 'close_at' | 'status_override' | 'extended_until'>>) {
  const due = dueText({ ...a, status_override: a.status_override || 'auto', extended_until: a.extended_until }, ' · ');
  if (Array.isArray(a.retake_student_ids)) return `ข้อสอบซ่อม: ${retakeTitle(a.title)} (${due})`;
  return `${a.is_exam ? 'ข้อสอบใหม่' : 'งานใหม่'}: ${a.title} (${due})`;
}

/** A retake's LINE message body: title, deadline, and who takes it (only they can open it). */
function retakeLineBody(a: Pick<Assignment, 'title' | 'due_date' | 'retake_student_ids'>, students?: RosterStudent[] | null) {
  const names = rosterFor(a, (students || []).filter((s) => !!s?.id)).map(studentName);
  const head = `สอบซ่อม: ${retakeTitle(a.title)}\nปิดรับคำตอบ ${lineDate(a.due_date)}`;
  if (!names.length) return `${head}\n\nเฉพาะนักเรียนที่คุณครูแจ้ง ${(a.retake_student_ids || []).length} คน`;
  return `${head}\n\nเฉพาะนักเรียนต่อไปนี้ (${names.length} คน):\n${names.map((name, i) => `${i + 1}. ${name}`).join('\n')}`;
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
    /** The work this post announces (assignment / exam): its card comes with the share. */
    assignment?: Assignment;
  }
): Promise<{
  post: ClassroomPost;
  deduplicated: boolean;
  /**
   * 'sent' | 'failed' | 'quota' (the LINE plan's monthly messages are used up) |
   * 'no_group' (classroom not linked to LINE) | 'scheduled' (sent at publish time) |
   * 'card' (new work: the teacher posts its trigger link, the bot answers with the card).
   */
  line?: 'sent' | 'failed' | 'quota' | 'no_group' | 'scheduled' | 'card';
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
  // The work's card is built while the post is saved, so the share carries it.
  const isWork = activityType === 'assignment' || activityType === 'exam';
  const cardPromise: Promise<LineMessage[] | null | undefined> =
    !isScheduled && isWork && input.assignment
      ? workMessages(supabase, input.assignment, classroom).catch((cardError) => {
          console.warn('Building the work card failed:', cardError);
          return null;
        })
      : Promise.resolve(isWork ? undefined : null);
  const { data: saved, error } = await supabase.from('classroom_posts').insert(newPost).select('*').single();
  if (error) throw new Error(error.message);

  // Check-ins never go to LINE: students check in by scanning the QR on the
  // teacher's screen. The timeline post is enough.
  if (activityType === 'attendance') {
    after(() => signalClassroom(classroom.id, { type: 'timeline' }));
    return { post: saved as ClassroomPost, deduplicated: false };
  }

  let line: 'sent' | 'failed' | 'quota' | 'no_group' | 'scheduled' | 'card' = isScheduled ? 'scheduled' : 'no_group';
  // New work in a linked group is not pushed (a push costs one
  // message per member): the teacher's LINE sends the card into the group
  // (teacher LIFF pages: straight in; website: /liff/share).
  const asCard = !isScheduled && !!classroom.line_group_id && (activityType === 'assignment' || activityType === 'exam');
  if (asCard) {
    line = 'card';
    after(() => signalClassroom(classroom.id, { type: 'timeline' }));
  } else if (!isScheduled) {
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
  if (line === 'failed' || line === 'quota' || line === 'no_group' || line === 'card') {
    share = postShare(saved.id, postLineText(newPost, classroom), await cardPromise);
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
  if (reason !== 'failed' && reason !== 'quota' && reason !== 'no_group' && reason !== 'card') return post;
  return { ...post, line_share: { reason, ...postShare(post.id, postLineText(post, classroom)) } };
}

export interface PostShare {
  /** The full LINE text (with its link), to copy and paste. */
  text: string;
  /** LIFF page that shares the bot's message from the teacher's own LINE (/liff/share); null without a LIFF id. */
  url: string | null;
  /**
   * What the teacher's LINE sends (the card), built with the action's answer so
   * the website and teacher LIFF need no second request. Missing: they load it
   * from GET /api/line/share with the url's token.
   */
  messages?: LineMessage[];
}

/**
 * A share with its card: `messages` when built, the plain text card when the
 * card could not be made (null), none when not built here (undefined).
 */
function withMessages(text: string, messages: LineMessage[] | null | undefined, url: string | null): PostShare {
  if (!url || messages === undefined) return { text, url };
  return { text, url, messages: messages || lineMessagesForText(text) };
}

/**
 * A post the bot could not send (monthly quota used up, LINE error, or no
 * linked group): the teacher sends the same message from their own LINE
 * account, which costs the bot's quota nothing.
 */
export function postShare(postId: string, text: string, messages?: LineMessage[] | null): PostShare {
  return withMessages(text, messages, shareUrl(postShareToken(postId)));
}

/** Re-announcing a work the bot could not send: shared by hand like a post. */
export function reannounceShare(assignmentId: string, text: string, messages?: LineMessage[] | null): PostShare {
  return withMessages(text, messages, shareUrl(reannounceShareToken(assignmentId)));
}

/** A work's reminder ("ทวงงาน") the bot could not send: shared by hand like a post. */
export function remindShare(assignmentId: string, text: string, messages?: LineMessage[] | null): PostShare {
  return withMessages(text, messages, shareUrl(remindShareToken(assignmentId)));
}

/** A work's score announcement ("ประกาศคะแนน") the bot could not send: shared by hand like a post. */
export function resultsShare(assignmentId: string, text: string, messages?: LineMessage[] | null): PostShare {
  return withMessages(text, messages, shareUrl(resultsShareToken(assignmentId)));
}

/** A classroom's join invitation ("เชิญในไลน์") the bot could not send: shared by hand like a post. */
export function joinShare(classroomId: string, text: string, messages?: LineMessage[] | null): PostShare {
  return withMessages(text, messages, shareUrl(joinShareToken(classroomId)));
}

/** An open attendance period's check-in call sent again, shared by hand when the bot cannot. */
export function attendanceShare(sessionId: string, text: string, messages?: LineMessage[] | null): PostShare {
  return withMessages(text, messages, shareUrl(attendanceShareToken(sessionId)));
}

/** /liff/share page that sends a co-teacher invitation from the teacher's own LINE; null without a LIFF id. */
export function teacherInviteShareUrl(code: string): string | null {
  return shareUrl(teacherInviteShareToken(code));
}

/** The /liff/share page for a share token; null without a LIFF id. */
function shareUrl(token: string): string | null {
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID;
  return liffId ? `https://liff.line.me/${liffId}/share?t=${encodeURIComponent(token)}` : null;
}
