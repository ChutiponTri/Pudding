import { createHash, randomBytes } from 'node:crypto';
import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { pushLineGroupText } from '@/lib/line/messaging';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN_TTL_MS = 10 * 60 * 1000;

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

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
  return NextResponse.json({
    status: classroom.line_connection_status || (classroom.line_group_id ? 'connected' : 'disconnected'),
    connectedAt: classroom.line_connected_at,
    expiresAt: classroom.line_connection_token_expires_at,
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
      line_connection_status: 'disconnected',
      line_connection_token_hash: null,
      line_connection_token_expires_at: null,
      line_connected_at: null,
    }).eq('id', classroomId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ status: 'disconnected' });
  }

  if (action === 'test') {
    if (!classroom.line_group_id) return NextResponse.json({ error: 'LINE Group is not connected' }, { status: 409 });
    await pushLineGroupText(classroom.line_group_id, `✅ Pudding เชื่อมต่อห้องเรียน “${classroom.name}” สำเร็จแล้ว`);
    return NextResponse.json({ status: 'connected' });
  }

  const token = randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const { error } = await supabase.from('classrooms').update({
    line_connection_status: 'waiting',
    line_connection_token_hash: hashToken(token),
    line_connection_token_expires_at: expiresAt,
  }).eq('id', classroomId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: 'waiting', token, expiresAt });
}
