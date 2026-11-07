import { auth } from '@clerk/nextjs/server';
import { canUseTeacherApp } from '@/lib/server/teacherProfileGuard';
import { getLineTestQuota, releaseLineTestSend, reserveLineTestSend } from '@/lib/server/lineTestQuota';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { groupPresence, groupPushAffordable, isLineQuotaError, LineApiError, leaveGroup, pushLineGroupText } from '@/lib/line/messaging';
import { withLiffLink } from '@/lib/line/liffLink';
import { classroomTitle } from '@/lib/utils/classroomLabel';
import { canLinkLine, getClassroom, linkErrorMessage, linkGroupByRef, listUnlinkedTeacherGroups, unlinkClassroom, type ServiceClient } from '@/lib/line/groupLink';

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
    const result = await linkGroupByRef(supabase, { id: userId, lineUid }, linkClassroom, ref, { move: body.move === true });
    if (!result.ok) return NextResponse.json({ error: linkErrorMessage(result.reason), reason: result.reason }, { status: 409 });
    return NextResponse.json({ status: 'connected', groupName: result.groupName, connectedAt: new Date().toISOString() });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

type TestClassroom = { id: string; line_group_id?: string | null; line_group_name?: string | null; line_connected_at?: string | null; invite_code?: string | null } & Parameters<typeof classroomTitle>[0];

/** A failed test send, in words the teacher can act on. `tone` picks the toast style. */
function testFailure(status: number, code: string, error: string, extra: Record<string, unknown> = {}, tone: 'error' | 'warn' = 'error') {
  return NextResponse.json({ error, code, tone, ...extra }, { status });
}

/**
 * "ทดสอบส่งข้อความ": push one message to the linked group. Checked first, so
 * the teacher learns why instead of a generic failure:
 *   - the bot is no longer in the group (the link is then removed: it can't work)
 *   - this month's LINE messages don't cover the group (one per member)
 *   - this teacher/classroom used up their test sends (rationing)
 * and a push LINE still refuses is explained by its status.
 */
async function sendTestMessage(supabase: ServiceClient, userId: string, classroom: TestClassroom) {
  const groupId = classroom.line_group_id;
  const groupLabel = classroom.line_group_name ? `“${classroom.line_group_name}”` : 'LINE';
  if (!groupId) return testFailure(409, 'no_group', 'ห้องเรียนนี้ยังไม่ได้เชื่อมกลุ่ม LINE', { status: 'disconnected' }, 'warn');

  const [presence, budget] = await Promise.all([groupPresence(groupId), groupPushAffordable(groupId)]);
  if (presence.state === 'gone') {
    await unlinkClassroom(supabase, classroom.id);
    return testFailure(
      409,
      'bot_not_in_group',
      `Pudding Bot ไม่ได้อยู่ในกลุ่ม ${groupLabel} แล้ว ระบบจึงยกเลิกการเชื่อมให้ เชิญบอทเข้ากลุ่มอีกครั้งแล้วเชื่อมใหม่`,
      { status: 'disconnected' }
    );
  }
  if (budget.affordable === false) {
    return testFailure(
      429,
      'line_quota',
      budget.remaining != null && budget.members != null
        ? `โควตาข้อความ LINE เดือนนี้เหลือ ${budget.remaining} ข้อความ แต่กลุ่มนี้มีสมาชิก ${budget.members} คน (ส่งเข้ากลุ่มนับ 1 ข้อความต่อสมาชิก 1 คน) จึงยังไม่ได้ส่ง โควตาจะเริ่มใหม่ต้นเดือนหน้า`
        : 'โควตาข้อความ LINE เดือนนี้ไม่พอสำหรับกลุ่มนี้ จึงยังไม่ได้ส่ง โควตาจะเริ่มใหม่ต้นเดือนหน้า',
      {},
      'warn'
    );
  }

  // Each test is billed per group member, so it is rationed (see lineTestQuota).
  // Everyone is limited, the admin included (raise the LINE_TEST_LIMIT_* env vars instead).
  const reservation = await reserveLineTestSend(supabase, { teacherId: userId, classroomId: classroom.id, source: 'web' });
  if (!reservation.ok) {
    return NextResponse.json(
      { error: reservation.message, code: 'test_limit', tone: 'warn', testQuota: reservation.quota },
      { status: 429, headers: reservation.retryAfterSeconds ? { 'Retry-After': String(reservation.retryAfterSeconds) } : undefined }
    );
  }
  try {
    await pushLineGroupText(
      groupId,
      withLiffLink(`✅ Pudding เชื่อมต่อ “${classroomTitle(classroom)}” สำเร็จแล้ว`, 'นักเรียนกดเพื่อเข้าห้องเรียน', { classroomId: classroom.id, inviteCode: classroom.invite_code })
    );
  } catch (pushError) {
    // Nothing was delivered, so it does not count.
    await releaseLineTestSend(supabase, reservation.id);
    console.error('LINE test push failed:', pushError);
    if (isLineQuotaError(pushError)) {
      return testFailure(429, 'line_quota', 'โควตาข้อความ LINE เดือนนี้หมดแล้ว จึงส่งไม่ได้ โควตาจะเริ่มใหม่ต้นเดือนหน้า', {}, 'warn');
    }
    const status = pushError instanceof LineApiError ? pushError.status : 0;
    if (status === 429) return testFailure(429, 'rate_limited', 'LINE ขอให้รอสักครู่ กรุณาลองใหม่ในอีก 1 นาที', {}, 'warn');
    if (status === 401 || !(pushError instanceof LineApiError)) {
      return testFailure(503, 'bot_config', 'การตั้งค่าบอท LINE บนเซิร์ฟเวอร์ไม่ถูกต้อง (Channel access token) กรุณาแจ้งผู้ดูแลระบบ');
    }
    if (status === 400 || status === 403 || status === 404) {
      return testFailure(502, 'push_refused', `LINE ไม่รับข้อความเข้ากลุ่ม ${groupLabel} (รหัส ${status}) ตรวจว่าบอทยังอยู่ในกลุ่ม แล้วลองใหม่`);
    }
    return testFailure(502, 'line_error', `ระบบ LINE ขัดข้องชั่วคราว (รหัส ${status}) กรุณาลองใหม่อีกครั้ง`);
  }
  const left = budget.remaining != null && budget.members != null ? Math.max(0, budget.remaining - budget.members) : null;
  return NextResponse.json({
    status: 'connected',
    groupName: presence.state === 'in' ? presence.groupName || classroom.line_group_name || undefined : classroom.line_group_name || undefined,
    connectedAt: classroom.line_connected_at,
    testQuota: reservation.quota,
    lineMessagesLeft: left ?? undefined,
  });
}
