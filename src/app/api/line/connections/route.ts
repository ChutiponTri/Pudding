import { auth } from '@clerk/nextjs/server';
import { canUseTeacherApp } from '@/lib/server/teacherProfileGuard';
import { getLineTestQuota, releaseLineTestSend, reserveLineTestSend } from '@/lib/server/lineTestQuota';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { leaveGroup, pushLineGroupText } from '@/lib/line/messaging';
import { withLiffLink } from '@/lib/line/liffLink';
import { classroomTitle } from '@/lib/utils/classroomLabel';
import { canLinkLine, getClassroom, linkErrorMessage, linkGroupByRef, listTeacherGroups } from '@/lib/line/groupLink';

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

export async function GET(request: NextRequest) {
  const classroomId = request.nextUrl.searchParams.get('classroomId');
  if (!classroomId) return NextResponse.json({ error: 'classroomId is required' }, { status: 400 });
  const { userId, classroom } = await getOwnedClassroom(classroomId);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!classroom) return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
  // Linked or not; an old "waiting" request (from before groups were picked directly) counts as not linked.
  const status = classroom.line_group_id ? 'connected' : 'disconnected';
  const supabase = createServiceSupabaseClient();
  const testQuota = classroom.line_group_id ? await getLineTestQuota(supabase, userId, classroomId) : null;
  // Groups the bot is in with this teacher, asked only when the dialog opens or refreshes (LINE calls).
  const wantsGroups = request.nextUrl.searchParams.get('groups') === '1' && !classroom.line_group_id;
  const lineUid = wantsGroups ? await teacherLineUid(userId) : null;
  const groups = lineUid
    ? (await listTeacherGroups(supabase, { id: userId, lineUid }, [])).groups.filter((group) => !group.linkedClassroomId)
    : wantsGroups ? [] : undefined;
  return NextResponse.json({
    status,
    groupName: classroom.line_group_name || undefined,
    connectedAt: classroom.line_connected_at,
    testQuota: testQuota || undefined,
    groups: groups?.map(({ ref, groupName }) => ({ ref, groupName })),
    lineLinked: wantsGroups ? Boolean(lineUid) : undefined,
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

  if (action === 'test') {
    if (!classroom.line_group_id) return NextResponse.json({ error: 'LINE Group is not connected' }, { status: 409 });
    // Each test is billed per group member, so it is rationed (see lineTestQuota).
    const reservation = await reserveLineTestSend(supabase, { teacherId: userId, classroomId, source: 'web' });
    // Everyone is limited, the admin included (raise the LINE_TEST_LIMIT_* env vars instead).
    if (!reservation.ok) {
      return NextResponse.json(
        { error: reservation.message, testQuota: reservation.quota },
        { status: 429, headers: reservation.retryAfterSeconds ? { 'Retry-After': String(reservation.retryAfterSeconds) } : undefined }
      );
    }
    try {
      await pushLineGroupText(
        classroom.line_group_id,
        withLiffLink(`✅ Pudding เชื่อมต่อ “${classroomTitle(classroom)}” สำเร็จแล้ว`, 'นักเรียนกดเพื่อเข้าห้องเรียน', { classroomId: classroom.id, inviteCode: classroom.invite_code })
      );
    } catch (pushError) {
      // Nothing was delivered, so it does not count.
      await releaseLineTestSend(supabase, reservation.id);
      console.error('LINE test push failed:', pushError);
      return NextResponse.json({ error: 'ส่งข้อความทดสอบไม่สำเร็จ กรุณาตรวจว่าบอทยังอยู่ในกลุ่ม LINE' }, { status: 502 });
    }
    return NextResponse.json({
      status: 'connected',
      groupName: classroom.line_group_name || undefined,
      connectedAt: classroom.line_connected_at,
      testQuota: reservation.quota,
    });
  }

  if (action === 'link-group') {
    // A group the bot is in, picked in the dialog (or the group whose button
    // opened "สร้างห้องเรียนใหม่"): LINE confirms the teacher is a member.
    const ref = typeof body.groupRef === 'string' ? body.groupRef : '';
    if (!ref) return NextResponse.json({ error: 'groupRef is required' }, { status: 400 });
    const linkClassroom = await getClassroom(supabase, classroomId);
    if (!linkClassroom || !canLinkLine(linkClassroom, userId)) return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });
    const lineUid = await teacherLineUid(userId);
    if (!lineUid) return NextResponse.json({ error: 'บัญชีครูยังไม่ได้เชื่อม LINE กรุณาเข้าสู่ระบบด้วย LINE' }, { status: 409 });
    const result = await linkGroupByRef(supabase, { id: userId, lineUid }, linkClassroom, ref, { move: body.move === true });
    if (!result.ok) return NextResponse.json({ error: linkErrorMessage(result.reason), reason: result.reason }, { status: 409 });
    return NextResponse.json({ status: 'connected', groupName: result.groupName, connectedAt: new Date().toISOString() });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
