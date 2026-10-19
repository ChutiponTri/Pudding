import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceSupabaseClient } from '@/lib/supabase/server';
import { leaveGroup, pushLineGroupText } from '@/lib/line/messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How long a "connect this classroom" request waits for the bot to join a group. */
const CONNECT_INTENT_TTL_MS = 15 * 60 * 1000;

async function getOwnedClassroom(classroomId: string) {
  const { userId } = await auth();
  if (!userId) return { userId: null, classroom: null };
  const supabase = await createServerSupabaseClient();
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('*')
    .eq('id', classroomId)
    .maybeSingle();
  const isTeacher = classroom?.teacher_id === userId || (classroom?.teachers || []).some((teacher: { teacher_id?: string }) => teacher.teacher_id === userId);
  return { userId, classroom: isTeacher ? classroom : null };
}

export async function GET(request: NextRequest) {
  const classroomId = request.nextUrl.searchParams.get('classroomId');
  if (!classroomId) return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
  const { userId, classroom } = await getOwnedClassroom(classroomId);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!classroom) return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
  const isExpired = classroom.line_connection_status === 'waiting'
    && classroom.line_connection_token_expires_at
    && new Date(classroom.line_connection_token_expires_at).getTime() <= Date.now();
  if (isExpired) {
    await (await createServerSupabaseClient()).from('classrooms').update({
      line_connection_status: 'disconnected',
      line_connection_token_hash: null,
      line_connection_token: null,
      line_connection_token_expires_at: null,
    }).eq('id', classroomId);
  }
  return NextResponse.json({
    status: isExpired ? 'disconnected' : (classroom.line_connection_status || (classroom.line_group_id ? 'connected' : 'disconnected')),
    groupName: classroom.line_group_name || undefined,
    connectedAt: classroom.line_connected_at,
    expiresAt: isExpired ? undefined : classroom.line_connection_token_expires_at,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const classroomId = typeof body.classroomId === 'string' ? body.classroomId : '';
  const action = body.action as 'create' | 'test' | 'disconnect' | undefined;
  if (!classroomId || !action) return NextResponse.json({ error: 'classroomId and action are required' }, { status: 400 });

  const { userId, classroom } = await getOwnedClassroom(classroomId);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!classroom) return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
  const supabase = await createServerSupabaseClient();

  if (action === 'disconnect') {
    const { error } = await supabase.from('classrooms').update({
      line_group_id: null,
      line_group_name: null,
      line_connection_status: 'disconnected',
      line_connection_token_hash: null,
      line_connection_token: null,
      line_connection_token_expires_at: null,
      line_connected_at: null,
    }).eq('id', classroomId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Unlink both ways: the bot leaves the LINE group too. The resulting
    // "leave" webhook finds no linked classroom and does nothing.
    if (classroom.line_group_id) {
      try {
        await leaveGroup(classroom.line_group_id);
      } catch (leaveError) {
        console.warn('LINE bot could not leave the group:', leaveError);
      }
    }
    return NextResponse.json({ status: 'disconnected' });
  }

  if (action === 'test') {
    if (!classroom.line_group_id) return NextResponse.json({ error: 'LINE Group is not connected' }, { status: 409 });
    await pushLineGroupText(classroom.line_group_id, `✅ Pudding เชื่อมต่อห้องเรียน “${classroom.name}” สำเร็จแล้ว`);
    return NextResponse.json({ status: 'connected' });
  }

  // "create": record that this teacher wants to connect this classroom. When the
  // bot joins a LINE group, the webhook links the group to the waiting classroom
  // whose teacher is a member of that group. No pairing code is involved.
  if (classroom.line_group_id) {
    return NextResponse.json({ status: 'connected', groupName: classroom.line_group_name || undefined });
  }
  const service = createServiceSupabaseClient();
  const { data: teacher } = await service.from('users').select('line_uid').eq('id', userId).maybeSingle();
  if (!teacher?.line_uid) {
    return NextResponse.json({ error: 'บัญชีครูยังไม่ได้เชื่อม LINE กรุณาเข้าสู่ระบบด้วย LINE' }, { status: 409 });
  }

  // One pending request per teacher, so a new group can never match an older,
  // forgotten request for a different classroom.
  const { data: waitingClasses } = await service
    .from('classrooms')
    .select('id, teacher_id, teachers')
    .eq('line_connection_status', 'waiting')
    .neq('id', classroomId);
  const myOtherWaiting = (waitingClasses || [])
    .filter((item) => item.teacher_id === userId || (item.teachers || []).some((t: { teacher_id?: string }) => t.teacher_id === userId))
    .map((item) => item.id);
  if (myOtherWaiting.length > 0) {
    await service.from('classrooms').update({
      line_connection_status: 'disconnected',
      line_connection_token_expires_at: null,
    }).in('id', myOtherWaiting);
  }

  const expiresAt = new Date(Date.now() + CONNECT_INTENT_TTL_MS).toISOString();
  const { error } = await supabase.from('classrooms').update({
    line_connection_status: 'waiting',
    line_connection_token_hash: null,
    line_connection_token: null,
    line_connection_token_expires_at: expiresAt,
  }).eq('id', classroomId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: 'waiting', expiresAt });
}
