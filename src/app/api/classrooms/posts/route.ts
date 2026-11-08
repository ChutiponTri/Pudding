import { after, NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { announceScheduledPosts, postLineText } from '@/lib/line/classroomAnnouncement';
import { botSendOrShare } from '@/lib/server/lineSend';
import { signalClassroom } from '@/lib/realtime/classroomSignal';
import { getActor } from '@/lib/auth/actor';
import { classroomRole, errorResponse, FORBIDDEN, HttpError, loadClassroom, requireTeacherOfClassroom } from '@/lib/server/access';
import { createClassroomPost, postShare, withLineShare, type ClassroomPost } from '@/lib/server/classroomPosts';
import type { PostActivityType } from '@/lib/line/classroomAnnouncement';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Timeline of a classroom: its teachers see everything, its students (verified via LINE) see published posts. */
export async function GET(request: NextRequest) {
  try {
    const classroomId = request.nextUrl.searchParams.get('classroomId') || '';
    if (!classroomId) return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
    const supabase = createServiceSupabaseClient();
    const [actor, classroom] = await Promise.all([getActor(request), loadClassroom(supabase, classroomId)]);
    if (!classroom) throw new HttpError(404, 'ไม่พบห้องเรียน');
    const role = await classroomRole(supabase, actor, classroom);
    if (!role) throw FORBIDDEN();

    // Scheduled work whose time has come: announce it in LINE now, without
    // waiting for the cron and without slowing this response.
    after(() => announceScheduledPosts(supabase, new Date(), classroomId));

    const { data, error } = await supabase
      .from('classroom_posts')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Students don't see scheduled work before its publish time; teachers see everything.
    const now = Date.now();
    // Teachers: posts the bot could not send carry how to share them by hand.
    const posts = role === 'teacher'
      ? ((data || []) as ClassroomPost[]).map((post) => withLineShare(post, classroom))
      : (data || []).filter((post: ClassroomPost) => {
          const publishAt = typeof post.metadata?.publishAt === 'string' ? new Date(post.metadata.publishAt).getTime() : NaN;
          return Number.isNaN(publishAt) || publishAt <= now;
        });
    return NextResponse.json({ posts });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === 'resend') return resendPost(request, typeof body.id === 'string' ? body.id : '');
    const classroomId = typeof body.classroomId === 'string' ? body.classroomId : '';
    const postBody = typeof body.body === 'string' ? body.body.trim() : '';
    const activityType = (typeof body.activityType === 'string' ? body.activityType : 'announcement') as PostActivityType;
    if (!classroomId || !postBody) return NextResponse.json({ error: 'classroomId and body are required' }, { status: 400 });

    const supabase = createServiceSupabaseClient();
    const actor = await getActor(request);
    const classroom = await requireTeacherOfClassroom(supabase, actor, classroomId);
    const { post, deduplicated, line, share } = await createClassroomPost(supabase, {
      classroom,
      authorId: actor!.kind === 'teacher' ? actor!.userId : '',
      body: postBody,
      activityType,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
      publishAt: typeof body.publishAt === 'string' ? body.publishAt : undefined,
    });
    return NextResponse.json({ post, deduplicated, line, share }, { status: deduplicated ? 200 : 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST { action: 'resend', id }: the teacher asks the bot to send a timeline
 * post to the class LINE group again. Falls back to sharing it by hand when the
 * bot cannot (see botSendOrShare: no group, monthly quota, rationing, LINE error).
 */
async function resendPost(request: NextRequest, id: string) {
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const supabase = createServiceSupabaseClient();
  const actor = await getActor(request);
  const { data: post } = await supabase.from('classroom_posts').select('*').eq('id', id).maybeSingle<ClassroomPost>();
  if (!post) throw new HttpError(404, 'ไม่พบโพสต์');
  const classroom = await requireTeacherOfClassroom(supabase, actor, post.classroom_id);
  const metadata = (post.metadata || {}) as Record<string, unknown>;
  const publishAt = typeof metadata.publishAt === 'string' ? new Date(metadata.publishAt).getTime() : NaN;
  if (metadata.pendingLine || publishAt > Date.now()) {
    return NextResponse.json({ error: 'โพสต์นี้ยังไม่ถึงเวลาเผยแพร่ ระบบจะส่งเข้า LINE ให้เองเมื่อถึงเวลา' }, { status: 409 });
  }
  const text = postLineText({ ...post, activity_type: post.activity_type as PostActivityType }, classroom);
  const result = await botSendOrShare(supabase, {
    groupId: classroom.line_group_id,
    text,
    share: postShare(post.id, text),
    teacherId: actor!.kind === 'teacher' ? actor!.userId : '',
    classroomId: classroom.id,
  });
  // The teacher's LINE sends it (the share page clears the post's "not sent" state once shared).
  return NextResponse.json(result);
}

/** Load a post and confirm the caller teaches its classroom. */
async function getOwnedPost(request: NextRequest, id: string) {
  const supabase = createServiceSupabaseClient();
  const { data: post } = await supabase.from('classroom_posts').select('id, classroom_id').eq('id', id).maybeSingle();
  if (!post) throw new HttpError(404, 'ไม่พบโพสต์');
  await requireTeacherOfClassroom(supabase, await getActor(request), post.classroom_id);
  return { supabase, classroomId: post.classroom_id as string };
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === 'string' ? body.id : '';
    const postBody = typeof body.body === 'string' ? body.body.trim() : '';
    if (!id || !postBody) return NextResponse.json({ error: 'id and body are required' }, { status: 400 });

    const owned = await getOwnedPost(request, id);
    const { data: post, error } = await owned.supabase.from('classroom_posts').update({ body: postBody }).eq('id', id).select('*').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    after(() => signalClassroom(owned.classroomId, { type: 'timeline' }));
    return NextResponse.json({ success: true, post });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const urlId = request.nextUrl.searchParams.get('id');
    const body = await request.json().catch(() => ({}));
    const id = urlId || (typeof body.id === 'string' ? body.id : '');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const owned = await getOwnedPost(request, id);
    const { error } = await owned.supabase.from('classroom_posts').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    after(() => signalClassroom(owned.classroomId, { type: 'timeline' }));
    return NextResponse.json({ success: true, deletedPostId: id });
  } catch (error) {
    return errorResponse(error);
  }
}
