import 'server-only';
import { groupPresence, groupPushAffordable, isLineQuotaError, LineApiError, pushLineGroupText } from '@/lib/line/messaging';
import { withLiffLink } from '@/lib/line/liffLink';
import { unlinkClassroom, type ServiceClient } from '@/lib/line/groupLink';
import { releaseLineTestSend, reserveLineTestSend, type LineTestQuota } from '@/lib/server/lineTestQuota';
import { classroomTitle, type LabelledClassroom } from '@/lib/utils/classroomLabel';

export type TestSendClassroom = LabelledClassroom & {
  id: string;
  line_group_id?: string | null;
  line_group_name?: string | null;
  invite_code?: string | null;
};

export type TestSendCode = 'no_group' | 'bot_not_in_group' | 'line_quota' | 'test_limit' | 'rate_limited' | 'bot_config' | 'push_refused' | 'line_error';

export type TestSendResult =
  | {
      ok: true;
      groupName?: string;
      testQuota: LineTestQuota;
      /** This month's LINE messages left after this push, when LINE told us. */
      lineMessagesLeft?: number;
    }
  | {
      ok: false;
      code: TestSendCode;
      /** In words the teacher can act on (Thai). */
      message: string;
      /** warn: nothing is broken, just not now; error: something needs fixing. */
      tone: 'warn' | 'error';
      /** HTTP status for the web API. */
      httpStatus: number;
      /** The link was found broken and removed. */
      unlinked?: boolean;
      testQuota?: LineTestQuota;
      retryAfterSeconds?: number;
    };

/**
 * "Send a test message" to a classroom's LINE group, for the web button and
 * the bot's `#pudding test` alike (same checks, same words). Checked before
 * pushing, so the teacher learns why instead of a generic failure:
 *   - the bot is no longer in the group (the link is then removed: it can't work)
 *   - this month's LINE messages don't cover the group (one per member)
 *   - this teacher/classroom used up their test sends (rationing)
 * and a push LINE still refuses is explained by its status. A send that did
 * not go out never counts against the test ration.
 */
export async function sendLineTestMessage(
  supabase: ServiceClient,
  input: { teacherId: string; classroom: TestSendClassroom; source: 'web' | 'line' }
): Promise<TestSendResult> {
  const { classroom } = input;
  const groupId = classroom.line_group_id;
  const groupLabel = classroom.line_group_name ? `“${classroom.line_group_name}”` : 'LINE';
  if (!groupId) {
    return { ok: false, code: 'no_group', tone: 'warn', httpStatus: 409, message: `“${classroomTitle(classroom)}” ยังไม่ได้เชื่อมกลุ่ม LINE` };
  }

  const [presence, budget] = await Promise.all([groupPresence(groupId), groupPushAffordable(groupId)]);
  if (presence.state === 'gone') {
    await unlinkClassroom(supabase, classroom.id);
    return {
      ok: false,
      code: 'bot_not_in_group',
      tone: 'error',
      httpStatus: 409,
      unlinked: true,
      message: `Pudding Bot ไม่ได้อยู่ในกลุ่ม ${groupLabel} แล้ว ระบบจึงยกเลิกการเชื่อมให้ เชิญบอทเข้ากลุ่มอีกครั้งแล้วเชื่อมใหม่`,
    };
  }
  if (budget.affordable === false) {
    return {
      ok: false,
      code: 'line_quota',
      tone: 'warn',
      httpStatus: 429,
      message:
        budget.remaining != null && budget.members != null
          ? `โควตาข้อความ LINE เดือนนี้เหลือ ${budget.remaining} ข้อความ แต่กลุ่มนี้มีสมาชิก ${budget.members} คน (ส่งเข้ากลุ่มนับ 1 ข้อความต่อสมาชิก 1 คน) จึงยังไม่ได้ส่ง โควตาจะเริ่มใหม่ต้นเดือนหน้า`
          : 'โควตาข้อความ LINE เดือนนี้ไม่พอสำหรับกลุ่มนี้ จึงยังไม่ได้ส่ง โควตาจะเริ่มใหม่ต้นเดือนหน้า',
    };
  }

  // Each test is billed per group member, so it is rationed (see lineTestQuota).
  // Everyone is limited, the admin included (raise the LINE_TEST_LIMIT_* env vars instead).
  const reservation = await reserveLineTestSend(supabase, { teacherId: input.teacherId, classroomId: classroom.id, source: input.source });
  if (!reservation.ok) {
    return {
      ok: false,
      code: 'test_limit',
      tone: 'warn',
      httpStatus: 429,
      message: reservation.message,
      testQuota: reservation.quota,
      retryAfterSeconds: reservation.retryAfterSeconds,
    };
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
      return { ok: false, code: 'line_quota', tone: 'warn', httpStatus: 429, message: 'โควตาข้อความ LINE เดือนนี้หมดแล้ว จึงส่งไม่ได้ โควตาจะเริ่มใหม่ต้นเดือนหน้า' };
    }
    const status = pushError instanceof LineApiError ? pushError.status : 0;
    if (status === 429) return { ok: false, code: 'rate_limited', tone: 'warn', httpStatus: 429, message: 'LINE ขอให้รอสักครู่ กรุณาลองใหม่ในอีก 1 นาที' };
    if (status === 401 || !(pushError instanceof LineApiError)) {
      return { ok: false, code: 'bot_config', tone: 'error', httpStatus: 503, message: 'การตั้งค่าบอท LINE บนเซิร์ฟเวอร์ไม่ถูกต้อง (Channel access token) กรุณาแจ้งผู้ดูแลระบบ' };
    }
    if (status === 400 || status === 403 || status === 404) {
      return { ok: false, code: 'push_refused', tone: 'error', httpStatus: 502, message: `LINE ไม่รับข้อความเข้ากลุ่ม ${groupLabel} (รหัส ${status}) ตรวจว่าบอทยังอยู่ในกลุ่ม แล้วลองใหม่` };
    }
    return { ok: false, code: 'line_error', tone: 'error', httpStatus: 502, message: `ระบบ LINE ขัดข้องชั่วคราว (รหัส ${status}) กรุณาลองใหม่อีกครั้ง` };
  }
  const left = budget.remaining != null && budget.members != null ? Math.max(0, budget.remaining - budget.members) : undefined;
  return {
    ok: true,
    groupName: (presence.state === 'in' && presence.groupName) || classroom.line_group_name || undefined,
    testQuota: reservation.quota,
    lineMessagesLeft: left,
  };
}

/** The success line both the toast and the bot use. */
export function testSentText(result: Extract<TestSendResult, { ok: true }>) {
  const parts = [`✅ ส่งข้อความทดสอบเข้ากลุ่ม${result.groupName ? ` “${result.groupName}”` : ''} แล้ว`];
  parts.push(`(ทดสอบได้อีก ${result.testQuota.remaining} ครั้งใน ${result.testQuota.windowDays} วัน)`);
  if (typeof result.lineMessagesLeft === 'number') parts.push(`· โควตา LINE เดือนนี้เหลือประมาณ ${result.lineMessagesLeft} ข้อความ`);
  return parts.join(' ');
}
