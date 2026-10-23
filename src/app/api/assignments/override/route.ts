import { auth } from '@clerk/nextjs/server';
import { after, NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { announceScheduledPosts } from '@/lib/line/classroomAnnouncement';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { isAssignmentPublished } from '@/lib/utils/assignmentWindow';
import type { Assignment, SubmissionOverrideStatus } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES: SubmissionOverrideStatus[] = ['auto', 'force_closed', 'extended'];

/**
 * Teacher changes whether an assignment accepts work: back to the deadline,
 * close now, or extend. No LINE message is pushed (it would use the LINE
 * message quota); open student pages update right away, and the teacher can
 * ask the bot in the group ("พุดดิ้ง งาน") to post what is still open.
 * `action: 'publish_now'` instead releases scheduled work immediately (the class
 * reached the topic early); it is announced like a scheduled release.
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const assignmentId = typeof body.assignmentId === 'string' ? body.assignmentId : '';
  const status = body.status_override as SubmissionOverrideStatus;
  const extendedUntil = typeof body.extended_until === 'string' ? body.extended_until : undefined;
  const publishNow = body.action === 'publish_now';
  if (!assignmentId || (!publishNow && !STATUSES.includes(status))) {
    return NextResponse.json({ error: 'assignmentId and a valid status_override are required' }, { status: 400 });
  }
  const extendedMs = extendedUntil ? new Date(extendedUntil).getTime() : NaN;
  if (status === 'extended' && (Number.isNaN(extendedMs) || extendedMs <= Date.now())) {
    return NextResponse.json({ error: 'กรุณาเลือกเวลาขยายที่อยู่ในอนาคต' }, { status: 400 });
  }

  const supabase = createServiceSupabaseClient();
  const { data: previous } = await supabase.from('assignments').select('*').eq('id', assignmentId).maybeSingle<Assignment>();
  if (!previous) return NextResponse.json({ error: 'ไม่พบงานนี้' }, { status: 404 });

  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id, name, teacher_id, teachers, line_group_id, invite_code')
    .eq('id', previous.classroom_id)
    .maybeSingle();
  const isTeacher =
    classroom?.teacher_id === userId ||
    (classroom?.teachers || []).some((teacher: { teacher_id?: string }) => teacher.teacher_id === userId);
  if (!classroom || !isTeacher) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (publishNow) {
    if (isAssignmentPublished(previous)) return NextResponse.json({ assignment: previous });
    const nowIso = new Date().toISOString();
    const { data: published, error: publishError } = await supabase
      .from('assignments')
      .update({ publish_at: nowIso })
      .eq('id', assignmentId)
      .select('*')
      .maybeSingle<Assignment>();
    if (publishError || !published) {
      console.error('Assignment publish-now failed:', publishError);
      return NextResponse.json({ error: 'เผยแพร่งานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
    }
    // Move the held-back timeline post to now; announceScheduledPosts then
    // sends its LINE message once and refreshes open student pages.
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
            .update({ metadata: { ...post.metadata, publishAt: nowIso }, created_at: nowIso })
            .eq('id', post.id)
        )
    );
    after(async () => {
      await announceScheduledPosts(supabase, new Date(), classroom.id);
      await signalClassroom(classroom.id, { type: 'published', assignmentId });
    });
    return NextResponse.json({ assignment: published });
  }

  const patch: Partial<Assignment> = { status_override: status };
  if (status === 'extended') patch.extended_until = new Date(extendedMs).toISOString();
  const { data: updated, error } = await supabase.from('assignments').update(patch).eq('id', assignmentId).select('*').maybeSingle<Assignment>();
  if (error || !updated) {
    console.error('Assignment override update failed:', error);
    return NextResponse.json({ error: 'บันทึกสถานะการรับงานไม่สำเร็จ' }, { status: 500 });
  }

  // Open student pages pick up the new status.
  after(() => signalClassroom(classroom.id, { type: 'timeline' }));

  return NextResponse.json({ assignment: updated });
}
