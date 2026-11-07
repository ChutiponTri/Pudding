import { auth } from '@clerk/nextjs/server';
import { canUseTeacherApp } from '@/lib/server/teacherProfileGuard';
import { getLineTestQuota, releaseLineTestSend, reserveLineTestSend } from '@/lib/server/lineTestQuota';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getGroupSummary, leaveGroup, pushLineGroupText } from '@/lib/line/messaging';
import { withLiffLink } from '@/lib/line/liffLink';
import { classroomTitle } from '@/lib/utils/classroomLabel';
import {
  armConnectRequest,
  canLinkLine,
  canUnlinkLine,
  claimLinkToken,
  findCandidateGroups,
  findLinkedClassroom,
  getClassroom,
  linkCandidateGroup,
  linkClassroomToGroup,
  linkErrorMessage,
} from '@/lib/line/groupLink';

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
  const isExpired = classroom.line_connection_status === 'waiting'
    && classroom.line_connection_token_expires_at
    && new Date(classroom.line_connection_token_expires_at).getTime() <= Date.now();
  if (isExpired) {
    await createServiceSupabaseClient().from('classrooms').update({
      line_connection_status: 'disconnected',
      line_connection_token_hash: null,
      line_connection_token: null,
      line_connection_token_expires_at: null,
    }).eq('id', classroomId);
  }
  const status = isExpired ? 'disconnected' : (classroom.line_connection_status || (classroom.line_group_id ? 'connected' : 'disconnected'));
  // Only a connected group can be tested; skip the quota query while polling a waiting link.
  const testQuota = classroom.line_group_id ? await getLineTestQuota(createServiceSupabaseClient(), userId, classroomId) : null;
  // Groups the bot already sits in, asked only when the dialog opens (polling skips the LINE calls).
  const wantsCandidates = request.nextUrl.searchParams.get('candidates') === '1' && !classroom.line_group_id;
  const candidates = wantsCandidates ? await findCandidateGroups(createServiceSupabaseClient(), await teacherLineUid(userId)) : undefined;
  return NextResponse.json({
    status,
    groupName: classroom.line_group_name || undefined,
    connectedAt: classroom.line_connected_at,
    expiresAt: isExpired ? undefined : classroom.line_connection_token_expires_at,
    testQuota: testQuota || undefined,
    candidates,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const classroomId = typeof body.classroomId === 'string' ? body.classroomId : '';
  const action = body.action as 'create' | 'test' | 'disconnect' | 'link-group' | 'claim' | undefined;
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

  if (action === 'link-group' || action === 'claim') {
    if (classroom.line_group_id) {
      return NextResponse.json({ error: 'ห้องเรียนนี้เชื่อมกับกลุ่ม LINE อื่นอยู่แล้ว' }, { status: 409 });
    }
    const linkClassroom = await getClassroom(supabase, classroomId);
    if (!linkClassroom || !canLinkLine(linkClassroom, userId)) return NextResponse.json({ error: 'Classroom not found' }, { status: 404 });

    if (action === 'link-group') {
      // A group the bot is already in, picked in the dialog: LINE confirms the teacher is a member.
      const groupId = typeof body.groupId === 'string' ? body.groupId : '';
      const lineUid = await teacherLineUid(userId);
      if (!groupId || !lineUid) return NextResponse.json({ error: 'groupId is required' }, { status: 400 });
      const result = await linkCandidateGroup(supabase, { id: userId, lineUid }, linkClassroom, groupId);
      if (!result.ok) return NextResponse.json({ error: linkErrorMessage(result.reason) }, { status: 409 });
      return NextResponse.json({ status: 'connected', groupName: result.groupName, connectedAt: new Date().toISOString() });
    }

    // "claim": a classroom just created from the bot's "สร้างห้องเรียนใหม่" link.
    const token = typeof body.token === 'string' ? body.token : '';
    const groupId = await claimLinkToken(supabase, token, userId);
    if (!groupId) return NextResponse.json({ error: linkErrorMessage('expired') }, { status: 410 });
    // The bot may have been removed since the link was sent.
    if (!(await getGroupSummary(groupId).catch(() => null))) {
      return NextResponse.json({ error: 'Pudding Bot ไม่ได้อยู่ในกลุ่มนั้นแล้ว กรุณาเชิญบอทเข้ากลุ่มอีกครั้ง' }, { status: 409 });
    }
    const linked = await findLinkedClassroom(supabase, groupId);
    // A group linked to another of this teacher's classrooms moves here (they chose it in the group).
    if (linked && !canUnlinkLine(linked, userId)) return NextResponse.json({ error: linkErrorMessage('group-taken') }, { status: 409 });
    const result = await linkClassroomToGroup(supabase, groupId, linkClassroom, linked);
    if (!result.ok) return NextResponse.json({ error: linkErrorMessage(result.reason) }, { status: 409 });
    return NextResponse.json({ status: 'connected', groupName: result.groupName, connectedAt: new Date().toISOString() });
  }

  // "create": record which teacher wants to connect this classroom. Only that
  // teacher's own message or tap in a LINE group links it (see the webhook),
  // so other teachers or students in the group cannot. No pairing code. Groups
  // the bot already sits in with this teacher come back as `candidates`, to
  // link with one click (action "link-group").
  if (classroom.line_group_id) {
    return NextResponse.json({ status: 'connected', groupName: classroom.line_group_name || undefined });
  }
  const lineUid = await teacherLineUid(userId);
  if (!lineUid) {
    return NextResponse.json({ error: 'บัญชีครูยังไม่ได้เชื่อม LINE กรุณาเข้าสู่ระบบด้วย LINE' }, { status: 409 });
  }
  const [armed, candidates] = await Promise.all([
    armConnectRequest(supabase, userId, classroomId),
    findCandidateGroups(supabase, lineUid),
  ]);
  if (armed.error) return NextResponse.json({ error: armed.error }, { status: 500 });
  return NextResponse.json({ status: 'waiting', expiresAt: armed.expiresAt, candidates });
}
