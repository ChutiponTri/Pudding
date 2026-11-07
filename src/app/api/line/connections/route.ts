import { auth } from '@clerk/nextjs/server';
import { canUseTeacherApp } from '@/lib/server/teacherProfileGuard';
import { getLineTestQuota } from '@/lib/server/lineTestQuota';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { leaveGroup } from '@/lib/line/messaging';
import { sendLineTestMessage, type TestSendClassroom } from '@/lib/server/lineTestSend';
import { canLinkLine, getClassroom, linkErrorMessage, linkGroupByRef, listUnlinkedTeacherGroups, type ServiceClient } from '@/lib/line/groupLink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getOwnedClassroom(classroomId: string) {
  const { userId } = await auth();
  // A teacher who still has to fill in their profile or wait for approval is treated as signed out here.
  if (!userId || !(await canUseTeacherApp(userId))) return { userId: null, classroom: null };
  const supabase = createServiceSupabaseClient();
  const { data: classroom } = await supabase
    .from('classrooms')
    .select('*')
    .eq('id', classroomId)
    .maybeSingle();
  const isTeacher = classroom?.teacher_id === userId || (classroom?.teachers || []).some((teacher: { teacher_id?: string }) => teacher.teacher_id === userId);
  return { userId, classroom: isTeacher ? classroom : null };
}

async function teacherLineUid(userId: string) {
  const { data } = await createServiceSupabaseClient().from('users').select('teacher_line_uid').eq('id', userId).maybeSingle();
  return (data?.teacher_line_uid as string | null | undefined) || null;
}

/**
 * GET ?groups=1: the LINE groups the bot is in with the signed-in teacher and
 * no classroom linked yet. It is per teacher (the same for every classroom),
 * so the dashboard asks once and reuses it; `fresh=1` (the refresh button)
 * asks LINE again instead of using remembered membership answers.
 * GET ?classroomId=…: that classroom's LINE status.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const classroomId = params.get('classroomId');
  if (!classroomId) {
    if (params.get('groups') !== '1') return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
    const { userId } = await auth();
    if (!userId || !(await canUseTeacherApp(userId))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const lineUid = await teacherLineUid(userId);
    if (!lineUid) return NextResponse.json({ groups: [], lineLinked: false });
    const groups = await listUnlinkedTeacherGroups(createServiceSupabaseClient(), lineUid, { fresh: params.get('fresh') === '1' });
    return NextResponse.json({ groups, lineLinked: true });
  }

  const { userId, classroom } = await getOwnedClassroom(classroomId);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!classroom) return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
  // Linked or not; an old "waiting" request (from before groups were picked directly) counts as not linked.
  const status = classroom.line_group_id ? 'connected' : 'disconnected';
  const testQuota = classroom.line_group_id ? await getLineTestQuota(createServiceSupabaseClient(), userId, classroomId) : null;
  return NextResponse.json({
    status,
    groupName: classroom.line_group_name || undefined,
    connectedAt: classroom.line_connected_at,
    testQuota: testQuota || undefined,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const classroomId = typeof body.classroomId === 'string' ? body.classroomId : '';
  const action = body.action as 'test' | 'disconnect' | 'link-group' | undefined;
  if (!classroomId || !action) return NextResponse.json({ error: 'classroomId and action are required' }, { status: 400 });

  const { userId, classroom } = await getOwnedClassroom(classroomId);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!classroom) return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
  const supabase = createServiceSupabaseClient();

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

  if (action === 'test') return sendTestMessage(supabase, userId, classroom);

  if (action === 'link-group') {
    // A group the bot is in, picked in the dialog (or the group whose button
    // opened "สร้างห้องเรียนใหม่"): LINE confirms the teacher is a member.
    const ref = typeof body.groupRef === 'string' ? body.groupRef : '';
    if (!ref) return NextResponse.json({ error: 'groupRef is required' }, { status: 400 });
    const linkClassroom = await getClassroom(supabase, classroomId);
    if (!linkClassroom || !canLinkLine(linkClassroom, userId)) return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
    const lineUid = await teacherLineUid(userId);
    if (!lineUid) return NextResponse.json({ error: 'บัญชีครูยังไม่ได้เชื่อม LINE กรุณาเข้าสู่ระบบด้วย LINE' }, { status: 409 });
    const result = await linkGroupByRef(supabase, { id: userId, lineUid }, linkClassroom, ref);
    if (!result.ok) return NextResponse.json({ error: linkErrorMessage(result.reason), reason: result.reason }, { status: 409 });
    return NextResponse.json({ status: 'connected', groupName: result.groupName, connectedAt: new Date().toISOString() });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

/** "ทดสอบส่งข้อความ" (see sendLineTestMessage); the answer carries `tone` for the toast. */
async function sendTestMessage(supabase: ServiceClient, userId: string, classroom: TestSendClassroom & { line_connected_at?: string | null }) {
  const result = await sendLineTestMessage(supabase, { teacherId: userId, classroom, source: 'web' });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.message,
        code: result.code,
        tone: result.tone,
        testQuota: result.testQuota,
        ...(result.code === 'no_group' || result.unlinked ? { status: 'disconnected' } : {}),
      },
      { status: result.httpStatus, headers: result.retryAfterSeconds ? { 'Retry-After': String(result.retryAfterSeconds) } : undefined }
    );
  }
  return NextResponse.json({
    status: 'connected',
    groupName: result.groupName,
    connectedAt: classroom.line_connected_at,
    testQuota: result.testQuota,
    lineMessagesLeft: result.lineMessagesLeft,
  });
}
