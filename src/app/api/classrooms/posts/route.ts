import { randomUUID } from 'node:crypto';
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { pushLineGroupText } from '@/lib/line/messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getContext(classroomId: string) {
  const { userId } = await auth();
  if (!userId) return { userId: null, supabase: null, classroom: null };
  const supabase = createServiceSupabaseClient();
  const { data: classroom } = await supabase.from('classrooms').select('id, name, teacher_id, teachers, line_group_id').eq('id', classroomId).maybeSingle();
  const allowed = classroom?.teacher_id === userId || (classroom?.teachers || []).some((teacher: { teacher_id?: string }) => teacher.teacher_id === userId);
  return { userId, supabase, classroom: allowed ? classroom : null };
}

export async function GET(request: NextRequest) {
  const classroomId = request.nextUrl.searchParams.get('classroomId');
  const lineUid = request.nextUrl.searchParams.get('lineUid');
  if (!classroomId) return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
  const context = await getContext(classroomId);
  let supabase = context.supabase;
  let allowed = Boolean(context.userId && context.classroom);
  if (!allowed && lineUid) {
    supabase = supabase || createServiceSupabaseClient();
    const { data: classroom } = await supabase.from('classrooms').select('id, students, pending_students').eq('id', classroomId).maybeSingle();
    const { data: student } = await supabase.from('users').select('id, line_uid, role').eq('line_uid', lineUid).eq('role', 'student').maybeSingle();
    allowed = Boolean(classroom && student && [...(classroom.students || []), ...(classroom.pending_students || [])].some((item: { id?: string; line_uid?: string }) => item.id === student.id || item.line_uid === lineUid));
  }
  if (!allowed || !supabase) return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
  const { data, error } = await supabase.from('classroom_posts').select('*').eq('classroom_id', classroomId).order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'Announcement schema is not installed' }, { status: 503 });
  return NextResponse.json({ posts: data || [] });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const classroomId = typeof body.classroomId === 'string' ? body.classroomId : '';
  const postBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!classroomId || !postBody) return NextResponse.json({ error: 'classroomId and body are required' }, { status: 400 });
  const context = await getContext(classroomId);
  if (!context.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!context.classroom || !context.supabase) return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
  const { data, error } = await context.supabase.from('classroom_posts').insert({ id: randomUUID(), classroom_id: classroomId, author_id: context.userId, body: postBody }).select('*').single();
  if (error) return NextResponse.json({ error: 'บันทึกประกาศไม่สำเร็จ กรุณารัน migration ล่าสุด' }, { status: 503 });
  if (context.classroom.line_group_id) {
    try {
      await pushLineGroupText(context.classroom.line_group_id, `📢 ประกาศจากครู\nห้อง: ${context.classroom.name}\n\n${postBody}`);
    } catch (lineError) {
      console.error('Classroom announcement LINE push failed:', lineError);
    }
  }
  return NextResponse.json({ post: data }, { status: 201 });
}
