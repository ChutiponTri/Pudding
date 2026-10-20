import { randomUUID } from 'node:crypto';
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { pushLineGroupText } from '@/lib/line/messaging';
import { withLiffLink } from '@/lib/line/liffLink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ClassroomPost = {
  id: string;
  classroom_id: string;
  author_id: string;
  body: string;
  activity_type: 'announcement' | 'assignment' | 'exam' | 'attendance';
  metadata?: Record<string, unknown>;
  created_at: string;
};

/** The signed-in teacher and the classroom, if they teach it. */
async function getTeacherContext(classroomId: string) {
  const { userId } = await auth();
  const supabase = createServiceSupabaseClient();
  if (!userId) return { userId: null, supabase, classroom: null };
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('id, name, teacher_id, teachers, line_group_id')
    .eq('id', classroomId)
    .maybeSingle();
  const allowed =
    classroom?.teacher_id === userId ||
    (classroom?.teachers || []).some((teacher: { teacher_id?: string }) => teacher.teacher_id === userId);
  return { userId, supabase, classroom: allowed ? classroom : null };
}

export async function GET(request: NextRequest) {
  const classroomId = request.nextUrl.searchParams.get('classroomId');
  const lineUid = request.nextUrl.searchParams.get('lineUid');
  if (!classroomId) return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });

  const { supabase, classroom: teacherClassroom } = await getTeacherContext(classroomId);
  let allowed = Boolean(teacherClassroom);

  // Students read the timeline of a classroom they belong to (or asked to join).
  if (!allowed && lineUid) {
    const [{ data: classroom }, { data: student }] = await Promise.all([
      supabase.from('classrooms').select('id, students, pending_students').eq('id', classroomId).maybeSingle(),
      supabase.from('users').select('id, line_uid').eq('line_uid', lineUid).eq('role', 'student').maybeSingle(),
    ]);
    allowed = Boolean(
      classroom &&
        student &&
        [...(classroom.students || []), ...(classroom.pending_students || [])].some(
          (item: { id?: string; line_uid?: string }) => item.id === student.id || item.line_uid === lineUid
        )
    );
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabase
    .from('classroom_posts')
    .select('*')
    .eq('classroom_id', classroomId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ posts: data || [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const classroomId = typeof body.classroomId === 'string' ? body.classroomId : '';
  const postBody = typeof body.body === 'string' ? body.body.trim() : '';
  const activityType = (typeof body.activityType === 'string' ? body.activityType : 'announcement') as ClassroomPost['activity_type'];
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};

  if (!classroomId || !postBody) return NextResponse.json({ error: 'classroomId and body are required' }, { status: 400 });

  const context = await getTeacherContext(classroomId);
  if (!context.userId || !context.classroom) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { supabase } = context;

  // Assignment creation can be retried by the client after a slow response.
  // Use the assignment id as an idempotency key so one assignment produces one
  // timeline post and one LINE notification.
  const assignmentId = typeof (metadata as { assignmentId?: unknown }).assignmentId === 'string'
    ? (metadata as { assignmentId: string }).assignmentId
    : '';
  if (assignmentId && (activityType === 'assignment' || activityType === 'exam')) {
    const { data: existingPosts } = await supabase
      .from('classroom_posts')
      .select('*')
      .eq('classroom_id', classroomId)
      .eq('activity_type', activityType)
      .contains('metadata', { assignmentId })
      .limit(1);
    if (existingPosts?.[0]) return NextResponse.json({ post: existingPosts[0], deduplicated: true }, { status: 200 });
  }

  const newPost: ClassroomPost = {
    id: `post-${Date.now()}-${randomUUID().slice(0, 8)}`,
    classroom_id: classroomId,
    author_id: context.userId,
    body: postBody,
    activity_type: activityType,
    metadata,
    created_at: new Date().toISOString(),
  };
  const { data: savedPost, error } = await supabase.from('classroom_posts').insert(newPost).select('*').single();
  if (error) {
    console.error('Classroom post insert failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Send LINE Group announcement if linked
  const lineGroupId = context.classroom.line_group_id;
  const classroomName = context.classroom.name || 'ห้องเรียน';

  if (lineGroupId) {
    try {
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
      const message = `${icon} ${title}\nห้อง: ${classroomName}\n\n${postBody}`;
      // Always include a tap-through link to the exact place students need.
      const linkedAssignmentId = typeof metadata?.assignmentId === 'string' ? metadata.assignmentId : undefined;
      const linked = activityType === 'attendance'
        ? withLiffLink(message, 'กดเพื่อเช็คชื่อ', { classroomId, view: 'attendance' })
        : (activityType === 'assignment' || activityType === 'exam') && linkedAssignmentId
          ? withLiffLink(message, activityType === 'exam' ? 'กดเพื่อเริ่มทำข้อสอบ' : 'กดเพื่อเปิดงานและส่งงาน', { classroomId, assignmentId: linkedAssignmentId })
          : withLiffLink(message, 'เปิดห้องเรียนใน Pudding', { classroomId });
      await pushLineGroupText(lineGroupId, linked);
    } catch (lineError) {
      console.error('Classroom post LINE push failed:', lineError);
    }
  }

  return NextResponse.json({ post: savedPost }, { status: 201 });
}

/** Load a post and confirm the signed-in user teaches its classroom. */
async function getOwnedPost(id: string) {
  const supabase = createServiceSupabaseClient();
  const { data: post } = await supabase.from('classroom_posts').select('id, classroom_id').eq('id', id).maybeSingle();
  if (!post) return null;
  const context = await getTeacherContext(post.classroom_id);
  return context.classroom ? context.supabase : null;
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === 'string' ? body.id : '';
  const postBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!id || !postBody) {
    return NextResponse.json({ error: 'id and body are required' }, { status: 400 });
  }

  const supabase = await getOwnedPost(id);
  if (!supabase) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { data: post, error } = await supabase
    .from('classroom_posts')
    .update({ body: postBody })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, post });
}

export async function DELETE(request: NextRequest) {
  const urlId = request.nextUrl.searchParams.get('id');
  const body = await request.json().catch(() => ({}));
  const id = urlId || (typeof body.id === 'string' ? body.id : '');
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const supabase = await getOwnedPost(id);
  if (!supabase) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { error } = await supabase.from('classroom_posts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, deletedPostId: id });
}
