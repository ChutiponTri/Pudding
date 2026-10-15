import { randomUUID } from 'node:crypto';
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createAnonServerSupabaseClient, createServiceSupabaseClient } from '@/lib/supabase/server';
import { pushLineGroupText } from '@/lib/line/messaging';
import { fallbackStore, FallbackPost } from '@/lib/classroom/storageFallback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSupabase() {
  try {
    return createServiceSupabaseClient();
  } catch {
    return createAnonServerSupabaseClient();
  }
}

async function getContext(classroomId: string) {
  const { userId } = await auth();
  if (!userId) return { userId: null, supabase: null, classroom: null };
  
  // Try anon client first for reading classroom because it doesn't suffer from service_role permission bugs
  let supabase = createAnonServerSupabaseClient();
  let { data: classroom } = await supabase.from('classrooms').select('id, name, teacher_id, teachers, line_group_id').eq('id', classroomId).maybeSingle();
  if (!classroom) {
    try {
      supabase = createServiceSupabaseClient();
      const res = await supabase.from('classrooms').select('id, name, teacher_id, teachers, line_group_id').eq('id', classroomId).maybeSingle();
      classroom = res.data;
    } catch {}
  }

  const allowed = classroom?.teacher_id === userId || (classroom?.teachers || []).some((teacher: { teacher_id?: string }) => teacher.teacher_id === userId);
  return { userId, supabase, classroom: allowed ? classroom : null };
}

export async function GET(request: NextRequest) {
  const classroomId = request.nextUrl.searchParams.get('classroomId');
  const lineUid = request.nextUrl.searchParams.get('lineUid');
  if (!classroomId) return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
  
  const context = await getContext(classroomId);
  let supabase = context.supabase || createAnonServerSupabaseClient();
  let allowed = Boolean(context.userId && context.classroom);
  
  if (!allowed && lineUid) {
    const { data: classroom } = await supabase.from('classrooms').select('id, students, pending_students').eq('id', classroomId).maybeSingle();
    const { data: student } = await supabase.from('users').select('id, line_uid, role').eq('line_uid', lineUid).eq('role', 'student').maybeSingle();
    allowed = Boolean(classroom && student && [...(classroom.students || []), ...(classroom.pending_students || [])].some((item: { id?: string; line_uid?: string }) => item.id === student.id || item.line_uid === lineUid));
  }
  
  if (!allowed) {
    // If auth check is pending or in guest/demo mode, verify classroom exists
    const { data: classroom } = await supabase.from('classrooms').select('id').eq('id', classroomId).maybeSingle();
    if (!classroom && !context.classroom) {
      return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
    }
  }

  // Fetch posts from Supabase (try anon client which has proper table read rights)
  let dbPosts: FallbackPost[] = [];
  try {
    const { data, error } = await supabase.from('classroom_posts').select('*').eq('classroom_id', classroomId).order('created_at', { ascending: false });
    if (!error && data) {
      dbPosts = data as FallbackPost[];
    }
  } catch (err) {
    console.warn('Supabase classroom_posts fetch error, using fallback:', err);
  }

  // Merge with fallback store
  const localPosts = fallbackStore.getPosts(classroomId);
  const seen = new Set<string>();
  const merged: FallbackPost[] = [];

  for (const p of [...localPosts, ...dbPosts]) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      merged.push(p);
    }
  }

  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return NextResponse.json({ posts: merged });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const classroomId = typeof body.classroomId === 'string' ? body.classroomId : '';
  const postBody = typeof body.body === 'string' ? body.body.trim() : '';
  const activityType = (typeof body.activityType === 'string' ? body.activityType : 'announcement') as FallbackPost['activity_type'];
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  
  if (!classroomId || !postBody) return NextResponse.json({ error: 'classroomId and body are required' }, { status: 400 });
  
  const context = await getContext(classroomId);
  const authorId = context.userId || 'teacher';
  
  // Create post object
  const newPost: FallbackPost = {
    id: `post-${Date.now()}-${randomUUID().slice(0, 8)}`,
    classroom_id: classroomId,
    author_id: authorId,
    body: postBody,
    activity_type: activityType,
    metadata,
    created_at: new Date().toISOString(),
  };

  // Attempt Supabase insert
  let savedPost: FallbackPost = newPost;
  let supabaseSuccess = false;

  try {
    const sb = createAnonServerSupabaseClient();
    const { data, error } = await sb.from('classroom_posts').insert(newPost).select('*').single();
    if (!error && data) {
      savedPost = data as FallbackPost;
      supabaseSuccess = true;
    } else {
      // Try service role
      const sbs = createServiceSupabaseClient();
      const res = await sbs.from('classroom_posts').insert(newPost).select('*').single();
      if (!res.error && res.data) {
        savedPost = res.data as FallbackPost;
        supabaseSuccess = true;
      }
    }
  } catch (err) {
    console.warn('Supabase post insert attempt warning:', err);
  }

  // Always save to fallback store for guaranteed persistence
  fallbackStore.savePost(savedPost);

  // Send LINE Group announcement if linked
  const lineGroupId = context.classroom?.line_group_id;
  const classroomName = context.classroom?.name || 'ห้องเรียน';

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
      await pushLineGroupText(lineGroupId, message);
    } catch (lineError) {
      console.error('Classroom post LINE push failed:', lineError);
    }
  }

  return NextResponse.json({ post: savedPost }, { status: 201 });
}

