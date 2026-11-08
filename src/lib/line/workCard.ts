import 'server-only';
import { after } from 'next/server';
import { buildLiffUrl } from '@/lib/line/liffLink';
import { workCard, type FlexMessage } from '@/lib/line/flex';
import type { ServiceClient } from '@/lib/line/groupLink';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { subjectName, type LabelledClassroom } from '@/lib/utils/classroomLabel';
import { formatDateTime, SCHOOL_TIME_ZONE } from '@/lib/utils/datetime';
import type { Assignment } from '@/types/database';

/**
 * New work reaches the class LINE group as a card without using the monthly
 * message quota: the teacher shares a short "trigger" (the work's title and
 * its LIFF link) to the group from their own LINE (/liff/share), the bot sees
 * that message and answers it with the work card. Replies are free. The link
 * alone still opens the work, so the trigger is useful even where the bot is
 * not in the group.
 */

type CardClassroom = LabelledClassroom & { id: string; invite_code?: string | null; teacher_id?: string | null };

const when = (ms: number) => formatDateTime(new Date(ms).toISOString(), 'th', SCHOOL_TIME_ZONE);

/**
 * Marks the link as a card request. Other messages the teacher shares (a
 * reminder, a score announcement) also link to a work but must not get a card.
 */
const CARD_PARAM = 'card';

/** The trigger the teacher shares: one line naming the work, then its LIFF link. */
export function workTriggerText(
  assignment: Pick<Assignment, 'id' | 'title' | 'is_exam'>,
  classroom: { id: string; invite_code?: string | null }
): string | null {
  const url = buildLiffUrl({ classroomId: classroom.id, inviteCode: classroom.invite_code, assignmentId: assignment.id });
  if (!url) return null;
  return `${assignment.is_exam ? '📝 ข้อสอบ' : '📋 งาน'}: ${assignment.title} 👇\n${url}&${CARD_PARAM}=1`;
}

/** The work id in a message carrying one of our work-card trigger links, if any. */
export function workIdInText(text: string): string | null {
  if (!text.includes('assignmentId=') || !text.includes(`${CARD_PARAM}=1`)) return null;
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    try {
      const url = new URL(match[0]);
      const ours = url.hostname === 'liff.line.me' ? !liffId || url.pathname.startsWith(`/${liffId}`) : url.pathname.startsWith('/liff');
      const id = ours && url.searchParams.get(CARD_PARAM) === '1' ? url.searchParams.get('assignmentId') : null;
      if (id && /^[\w-]{1,80}$/.test(id)) return id;
    } catch {
      // not a URL after all
    }
  }
  return null;
}

/** The work card for an assignment (null without a LIFF id, since its buttons open the LIFF app). */
export async function buildWorkCard(supabase: ServiceClient, assignment: Assignment, classroom: CardClassroom): Promise<FlexMessage | null> {
  const openUrl = buildLiffUrl({ classroomId: classroom.id, inviteCode: classroom.invite_code, assignmentId: assignment.id });
  if (!openUrl) return null;
  const statusUrl = buildLiffUrl({ classroomId: classroom.id, inviteCode: classroom.invite_code, view: 'work' });

  // Its place among the classroom's homework (or quizzes), and the teacher's name, side by side.
  const [count, teacher] = await Promise.all([
    assignment.created_at
      ? supabase
          .from('assignments')
          .select('id', { count: 'exact', head: true })
          .eq('classroom_id', classroom.id)
          .eq('is_exam', !!assignment.is_exam)
          .lte('created_at', assignment.created_at)
      : Promise.resolve({ count: null }),
    classroom.teacher_id
      ? supabase.from('users').select('first_name').eq('id', classroom.teacher_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const subject = subjectName(classroom);
  const teacherName = (teacher.data as { first_name?: string | null } | null)?.first_name;
  const byline = [subject, teacherName ? `ครู${teacherName}` : ''].filter(Boolean).join(' · ');

  const win = getAssignmentWindow(assignment);
  const rows: Array<{ label: string; value: string }> = [];
  const retake = Array.isArray(assignment.retake_student_ids);
  if (assignment.is_exam) {
    if (assignment.total_points) rows.push({ label: 'คะแนน', value: `${assignment.total_points} คะแนน` });
    if (assignment.quiz_duration_minutes) rows.push({ label: 'เวลาทำ', value: `${assignment.quiz_duration_minutes} นาที` });
    if (win.deadline != null) rows.push({ label: 'ปิดรับคำตอบ', value: when(win.deadline) });
  } else {
    if (win.deadline != null) rows.push({ label: 'กำหนดส่ง', value: when(win.deadline) });
    if (win.lateUntil != null && win.lateUntil !== win.deadline) rows.push({ label: 'ปิดรับส่งงาน', value: when(win.lateUntil) });
    if (assignment.total_points) rows.push({ label: 'คะแนน', value: `${assignment.total_points} คะแนน` });
  }

  return workCard({
    isExam: !!assignment.is_exam,
    retake,
    number: count.count || undefined,
    byline,
    title: assignment.title,
    rows,
    note: retake ? `เฉพาะนักเรียนที่คุณครูเลือก ${(assignment.retake_student_ids || []).length} คน` : undefined,
    openUrl,
    statusUrl,
  });
}

/**
 * The card reached the group: the work's timeline post stops asking the
 * teacher to post it (lineStatus 'card' or an older unsent status).
 */
export async function markWorkCardPosted(supabase: ServiceClient, classroomId: string, assignmentId: string) {
  const { data: posts } = await supabase
    .from('classroom_posts')
    .select('id, metadata')
    .eq('classroom_id', classroomId)
    .contains('metadata', { assignmentId });
  const waiting = (posts || []).filter((post) => (post.metadata as Record<string, unknown> | null)?.lineStatus);
  if (!waiting.length) return;
  await Promise.all(
    waiting.map((post) => {
      const metadata: Record<string, unknown> = { ...((post.metadata || {}) as Record<string, unknown>), sharedManuallyAt: new Date().toISOString() };
      delete metadata.lineStatus;
      return supabase.from('classroom_posts').update({ metadata }).eq('id', post.id);
    })
  );
  after(() => signalClassroom(classroomId, { type: 'timeline' }));
}
