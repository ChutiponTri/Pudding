import 'server-only';
import { isGroupWork } from '@/lib/utils/groupWork';
import { dueRows } from '@/lib/utils/lineDates';
import { after } from 'next/server';
import { buildLiffUrl } from '@/lib/line/liffLink';
import { workCard, type FlexMessage } from '@/lib/line/flex';
import type { ServiceClient } from '@/lib/line/groupLink';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { subjectName, type LabelledClassroom } from '@/lib/utils/classroomLabel';
import type { Assignment } from '@/types/database';

/**
 * The work card: a new homework or quiz, sent into the class group by the
 * teacher's LINE (teacher LIFF pages, or /liff/share from the website), or
 * pushed by the cron for scheduled work.
 */

export type CardClassroom = LabelledClassroom & { id: string; invite_code?: string | null; teacher_id?: string | null };


/** "#งานที่ 3" and "ภาษาไทย · ครูต้น": the work's place among the classroom's homework (or quizzes), and who teaches it. */
export async function workMeta(supabase: ServiceClient, assignment: Assignment, classroom: CardClassroom) {
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
  const teacherName = (teacher.data as { first_name?: string | null } | null)?.first_name || null;
  return {
    number: count.count || undefined,
    subject,
    teacherName,
    byline: [subject, teacherName ? `ครู${teacherName}` : ''].filter(Boolean).join(' · '),
  };
}

/** The work card for an assignment (null without a LIFF id, since its buttons open the LIFF app). */
export async function buildWorkCard(supabase: ServiceClient, assignment: Assignment, classroom: CardClassroom): Promise<FlexMessage | null> {
  const openUrl = buildLiffUrl({ classroomId: classroom.id, inviteCode: classroom.invite_code, assignmentId: assignment.id });
  if (!openUrl) return null;
  const statusUrl = buildLiffUrl({ classroomId: classroom.id, inviteCode: classroom.invite_code, view: 'work' });
  const { number, byline } = await workMeta(supabase, assignment, classroom);
  const rows: Array<{ label: string; value: string }> = [];
  const chosen = Array.isArray(assignment.retake_student_ids);
  const retake = chosen && !!assignment.retake_of;
  if (assignment.is_exam) {
    if (assignment.total_points) rows.push({ label: 'คะแนน', value: `${assignment.total_points} คะแนน` });
    if (assignment.quiz_duration_minutes) rows.push({ label: 'เวลาทำ', value: `${assignment.quiz_duration_minutes} นาที` });
    rows.push(...dueRows(assignment));
  } else {
    rows.push(...dueRows(assignment));
    if (assignment.total_points) rows.push({ label: 'คะแนน', value: `${assignment.total_points} คะแนน` });
    // งานกลุ่ม: students pick their group in the app; one hand-in counts for the group.
    if (isGroupWork(assignment)) rows.push({ label: 'งานกลุ่ม', value: `ไม่เกิน ${assignment.group_size} คน/กลุ่ม` });
  }

  return workCard({
    isExam: !!assignment.is_exam,
    retake,
    survey: !!assignment.is_survey,
    number,
    byline,
    title: assignment.title,
    rows,
    note: chosen ? `เฉพาะนักเรียนที่คุณครูเลือก ${(assignment.retake_student_ids || []).length} คน` : undefined,
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
