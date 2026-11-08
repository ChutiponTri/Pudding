import { getTeacherUserId } from '@/lib/auth/actor';
import { getTeacherAccess, teacherBlockedResponse } from '@/lib/server/teacherProfileGuard';
import { after, NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { reannounceLineText, resultsLineText } from '@/lib/line/classroomAnnouncement';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { assignmentPostBody, assignmentPostMetadata, createClassroomPost, postShare, reannounceShare, remindShare, resultsShare } from '@/lib/server/classroomPosts';
import { botSendOrShare } from '@/lib/server/lineSend';
import { missingStudentNames, reminderLineText } from '@/lib/server/workReminder';
import { getAssignmentWindow, isAssignmentDraft, isAssignmentPublished } from '@/lib/utils/assignmentWindow';
import { questionsMissingKey } from '@/lib/utils/autoGrade';
import type { Assignment, Classroom, Question, SubmissionOverrideStatus, TeacherRole } from '@/types/database';
import { hydratedStudents, recordNoSubmissionZeros } from '@/lib/server/dataActions';
import { rosterFor } from '@/lib/utils/retake';
import { isRetake } from '@/lib/utils/retake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES: SubmissionOverrideStatus[] = ['auto', 'force_closed', 'extended'];

/**
 * Teacher changes whether an assignment accepts work: back to the deadline,
 * close now, or extend. No LINE message is pushed (it would use the LINE
 * message quota); open student pages update right away, and the teacher can
 * ask the bot in the group ("พุดดิ้ง งาน") to post what is still open.
 * Per-student "let them edit" (submissions.reopened_at) works beside this: it
 * outlasts the deadline and extensions, and only "close now" cancels it.
 * `action: 'publish_now'` instead releases scheduled work immediately (the class
 * reached the topic early); it is announced like a scheduled release. A draft
 * is published the same way and gets its timeline post and LINE message now.
 */
export async function POST(request: NextRequest) {
  // A Clerk session, or the teacher LIFF pages inside LINE.
  const userId = await getTeacherUserId(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // The access check and the work's row load together (one round trip less before the LINE popup fills in).
  const accessPromise = getTeacherAccess(userId);
  accessPromise.catch(() => {}); // awaited below; the early 400s must not leave it unhandled
  const body = await request.json().catch(() => ({}));
  const assignmentId = typeof body.assignmentId === 'string' ? body.assignmentId : '';
  const status = body.status_override as SubmissionOverrideStatus;
  const extendedUntil = typeof body.extended_until === 'string' ? body.extended_until : undefined;
  const publishNow = body.action === 'publish_now';
  const reannounce = body.action === 'reannounce';
  const remind = body.action === 'remind';
  const announceResults = body.action === 'announce_results';
  if (!assignmentId || (!publishNow && !reannounce && !remind && !announceResults && !STATUSES.includes(status))) {
    return NextResponse.json({ error: 'assignmentId and a valid status_override are required' }, { status: 400 });
  }
  const extendedMs = extendedUntil ? new Date(extendedUntil).getTime() : NaN;
  if (status === 'extended' && (Number.isNaN(extendedMs) || extendedMs <= Date.now())) {
    return NextResponse.json({ error: 'กรุณาเลือกเวลาขยายที่อยู่ในอนาคต' }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient();
  const [access, { data: previous }] = await Promise.all([
    accessPromise,
    supabase.from('assignments').select('*').eq('id', assignmentId).maybeSingle<Assignment>(),
  ]);
  if (access !== 'ok') return teacherBlockedResponse(access);
  if (!previous) return NextResponse.json({ error: 'ไม่พบงานนี้' }, { status: 404 });

  const { data: classroom } = await supabase
    .from('classrooms')
    // students: a reminder names who has not handed in.
    .select('id, name, course_name, subject_code, teacher_id, teachers, line_group_id, invite_code, students')
    .eq('id', previous.classroom_id)
    .maybeSingle();
  const isTeacher =
    classroom?.teacher_id === userId ||
    (classroom?.teachers || []).some((teacher: { teacher_id?: string }) => teacher.teacher_id === userId);
  if (!classroom || !isTeacher) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Posts the work's link to the class LINE group again (rationed: billed per group member).
  // Whenever the bot cannot (no group, re-announce limit, LINE refused), the
  // teacher gets the same message to share from their own LINE (costs no quota).
  if (reannounce || remind) {
    const win = getAssignmentWindow(previous);
    if (win.isDraft || win.isScheduled) return NextResponse.json({ error: 'งานนี้ยังไม่เผยแพร่' }, { status: 409 });
    if (!win.acceptsSubmissions) return NextResponse.json({ error: 'งานนี้ปิดรับแล้ว' }, { status: 409 });
    let text: string;
    let share: ReturnType<typeof reannounceShare>;
    if (remind) {
      // "ทวงงาน": names who still has not handed in (the retake's list, if any).
      const names = await missingStudentNames(supabase, previous, classroom);
      if (!names.length) return NextResponse.json({ assignment: previous, line: 'none', missing: 0 });
      text = reminderLineText(previous, classroom, names);
      share = remindShare(assignmentId, text);
    } else {
      text = reannounceLineText(previous, classroom);
      share = reannounceShare(assignmentId, text);
    }
    const result = await botSendOrShare(supabase, { groupId: classroom.line_group_id, text, share, teacherId: userId, classroomId: classroom.id });
    return NextResponse.json({ assignment: previous, ...result });
  }

  // "ประกาศคะแนน": results only show once the work is closed (and no per-student
  // permission still runs), so close it first, record 0 for everyone who
  // handed in nothing (so every student has a score to see), then tell the class group.
  if (announceResults) {
    const win = getAssignmentWindow(previous);
    if (win.isDraft || win.isScheduled) return NextResponse.json({ error: 'งานนี้ยังไม่เผยแพร่' }, { status: 409 });
    const { count: gradedCount } = await supabase
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .eq('assignment_id', assignmentId)
      .not('total_score', 'is', null);
    if (!gradedCount) return NextResponse.json({ error: 'ยังไม่มีงานที่ตรวจเสร็จ จึงยังประกาศคะแนนไม่ได้' }, { status: 409 });
    let assignment = previous;
    const closed = win.acceptsSubmissions;
    if (closed) {
      const { data: updated, error: closeError } = await supabase
        .from('assignments')
        .update({ status_override: 'force_closed' })
        .eq('id', assignmentId)
        .select('*')
        .maybeSingle<Assignment>();
      if (closeError || !updated) {
        console.error('Closing before announcing results failed:', closeError);
        return NextResponse.json({ error: 'ปิดรับงานไม่สำเร็จ จึงยังไม่ได้ประกาศคะแนน' }, { status: 500 });
      }
      assignment = updated;
    }
    // A running "ให้แก้ไขงาน" / "ให้ส่งงาน" would keep every result hidden.
    const clearedReopens = await clearReopens(supabase, assignmentId);
    // Nothing handed in: an official 0, or the student would have no result to see.
    // Researchers may not give real scores, so their announcement records none.
    const role: TeacherRole =
      classroom.teacher_id === userId
        ? 'primary'
        : (classroom.teachers || []).find((t: { teacher_id?: string; role?: TeacherRole }) => t.teacher_id === userId)?.role || 'assistant';
    let zeroed = 0;
    if (role !== 'researcher') {
      try {
        const [roster, { data: me }] = await Promise.all([
          hydratedStudents(supabase, classroom as Classroom),
          supabase.from('users').select('first_name, last_name').eq('id', userId).maybeSingle<{ first_name?: string | null; last_name?: string | null }>(),
        ]);
        const rows = await recordNoSubmissionZeros(
          supabase,
          assignment,
          rosterFor(assignment, roster),
          { id: userId, name: [me?.first_name, me?.last_name].filter(Boolean).join(' ') || 'คุณครู', role },
          { onlyUnscored: true }
        );
        zeroed = rows.length;
      } catch (zeroError) {
        console.error('Recording 0 for missing work before announcing failed:', zeroError);
        return NextResponse.json({ error: 'บันทึก 0 คะแนนให้นักเรียนที่ไม่ส่งงานไม่สำเร็จ จึงยังไม่ได้ประกาศคะแนน' }, { status: 500 });
      }
    }
    // Handed in but not fully graded yet: those scores stay hidden until grading is done.
    const { count: ungraded } = await supabase
      .from('submissions')
      .select('id', { count: 'exact', head: true })
      .eq('assignment_id', assignmentId)
      .in('status', ['submitted', 'late'])
      .is('total_score', null);
    if (closed || clearedReopens || zeroed) after(() => signalClassroom(classroom.id, { type: 'timeline' }));
    const text = resultsLineText(assignment, classroom);
    const result = await botSendOrShare(supabase, {
      groupId: classroom.line_group_id,
      text,
      share: resultsShare(assignmentId, text),
      teacherId: userId,
      classroomId: classroom.id,
    });
    return NextResponse.json({ assignment, closed, clearedReopens, zeroed, ungraded: ungraded || 0, ...result });
  }

  if (publishNow) {
    if (isAssignmentPublished(previous)) return NextResponse.json({ assignment: previous });
    const wasDraft = isAssignmentDraft(previous);
    // A timed quiz runs for its minutes from the moment it is published, so its deadline moves with it.
    const durationMs = previous.is_exam && Number(previous.quiz_duration_minutes) > 0 ? Number(previous.quiz_duration_minutes) * 60_000 : 0;
    // A draft may have sat past its deadline; publishing it would open already-closed work.
    if (wasDraft && !durationMs && new Date(previous.due_date).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'กำหนดส่งของฉบับร่างนี้ผ่านไปแล้ว กรุณาแก้ไขกำหนดส่งก่อนเผยแพร่' }, { status: 400 });
    }
    // Every choice / true-false question needs its correct answer before students see the work.
    // (Rows come unordered, so the message counts them rather than naming question numbers.)
    const { data: keyRows } = await supabase.from('questions').select('type, ideal_answer, options').eq('assignment_id', assignmentId);
    const noKey = questionsMissingKey((keyRows || []) as Pick<Question, 'type' | 'ideal_answer' | 'options'>[]).length;
    if (noKey) {
      return NextResponse.json(
        { error: `มี ${noKey} ข้อที่ยังไม่ได้เลือกคำตอบที่ถูกต้อง กรุณากด "แก้ไข" แล้วเลือกคำตอบก่อนเผยแพร่` },
        { status: 400 }
      );
    }
    const nowIso = new Date().toISOString();
    const { data: published, error: publishError } = await supabase
      .from('assignments')
      .update({ publish_at: nowIso, ...(durationMs ? { due_date: new Date(Date.parse(nowIso) + durationMs).toISOString() } : {}) })
      .eq('id', assignmentId)
      .select('*')
      .maybeSingle<Assignment>();
    if (publishError || !published) {
      console.error('Assignment publish-now failed:', publishError);
      return NextResponse.json({ error: 'เผยแพร่งานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
    }
    if (wasDraft) {
      // Drafts have no timeline post yet: post and announce it in LINE now.
      let line: Awaited<ReturnType<typeof createClassroomPost>>['line'];
      let share: Awaited<ReturnType<typeof createClassroomPost>>['share'];
      try {
        ({ line, share } = await createClassroomPost(supabase, {
          classroom,
          authorId: userId,
          activityType: published.is_exam ? 'exam' : 'assignment',
          body: assignmentPostBody(published),
          metadata: assignmentPostMetadata(published, assignmentId, isRetake(published) ? await hydratedStudents(supabase, classroom as Classroom) : classroom.students),
        }));
      } catch (postError) {
        console.warn('Unable to post published draft:', postError);
      }
      after(() => signalClassroom(classroom.id, { type: 'published', assignmentId }));
      return NextResponse.json({ assignment: published, line, share });
    }
    // Move the held-back timeline post to now. The teacher is here, so the
    // work card goes in from their LINE (no push): the post waits as 'card'.
    const lineStatus = classroom.line_group_id ? 'card' : 'no_group';
    const { data: posts } = await supabase
      .from('classroom_posts')
      .select('id, metadata')
      .eq('classroom_id', classroom.id)
      .contains('metadata', { assignmentId });
    await Promise.all(
      (posts || [])
        .filter((post) => typeof post.metadata?.publishAt === 'string')
        .map((post) =>
          supabase
            .from('classroom_posts')
            .update({
              metadata: {
                ...post.metadata,
                publishAt: nowIso,
                ...(durationMs ? { dueDate: published.due_date } : {}),
                pendingLine: false,
                announcedAt: nowIso,
                lineStatus,
              },
              created_at: nowIso,
              // The post spells out the deadline, which moved with the early start.
              ...(durationMs ? { body: assignmentPostBody(published) } : {}),
            })
            .eq('id', post.id)
        )
    );
    after(() => signalClassroom(classroom.id, { type: 'published', assignmentId }));
    const post = (posts || []).find((row) => typeof row.metadata?.publishAt === 'string') || posts?.[0];
    const text = reannounceLineText(published, classroom);
    return NextResponse.json({
      assignment: published,
      line: lineStatus,
      share: post ? postShare(post.id, text) : reannounceShare(assignmentId, text),
    });
  }

  const patch: Partial<Assignment> = { status_override: status };
  if (status === 'extended') patch.extended_until = new Date(extendedMs).toISOString();
  const { data: updated, error } = await supabase.from('assignments').update(patch).eq('id', assignmentId).select('*').maybeSingle<Assignment>();
  if (error || !updated) {
    console.error('Assignment override update failed:', error);
    return NextResponse.json({ error: 'บันทึกสถานะการรับงานไม่สำเร็จ' }, { status: 500 });
  }

  // "Close now" stops everyone, including students the teacher had let edit
  // handed-in work ("ให้แก้ไขงาน"): the latest teacher action wins. Letting one
  // student edit again after closing still works, since that comes later.
  // Extending or going back to the deadline leaves those permissions alone.
  const clearedReopens = status === 'force_closed' ? await clearReopens(supabase, assignmentId) : 0;

  // Open student pages pick up the new status.
  after(() => signalClassroom(classroom.id, { type: 'timeline' }));

  return NextResponse.json({ assignment: updated, clearedReopens });
}

/** Ends every running per-student permission ("ให้แก้ไขงาน" / "ให้ส่งงาน") on a work; returns how many. */
async function clearReopens(supabase: ReturnType<typeof createServiceSupabaseClient>, assignmentId: string): Promise<number> {
  const { data: cleared, error: clearError } = await supabase
    .from('submissions')
    .update({ reopened_at: null })
    .eq('assignment_id', assignmentId)
    .not('reopened_at', 'is', null)
    .select('id');
  // Databases without submissions.reopened_at have nothing to clear.
  if (clearError && !clearError.message.includes('reopened_at')) console.warn('Clearing reopened submissions failed:', clearError.message);
  return cleared?.length || 0;
}
