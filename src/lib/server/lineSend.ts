import 'server-only';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';
import { groupPushAffordable, isLineQuotaError, pushLineGroupText } from '@/lib/line/messaging';
import { releaseLineTestSend, reserveLineTestSend } from '@/lib/server/lineTestQuota';
import type { PostShare } from '@/lib/server/classroomPosts';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

export type BotSendStatus = 'sent' | 'no_group' | 'quota' | 'limit' | 'failed';

export interface BotSendResult {
  line: BotSendStatus;
  /** Whenever the bot did not send: the same message for the teacher to share from their own LINE. */
  share?: PostShare;
  /** Why, in words (rationing, or how many messages are left against the group's size). */
  message?: string;
}

/**
 * A teacher asks the bot to send something to the class group again (re-announce
 * a work or a post, or remind who has not handed in). In order:
 * 1. no linked group → share by hand;
 * 2. the plan's messages left this month do not cover one push to this group
 *    (billed per member) → share by hand, without trying (it would fail);
 * 3. this teacher / class used up their re-sends for now (rationing) → share by hand;
 * 4. push; LINE refusing it (quota or other) also falls back to sharing by hand,
 *    and gives the rationed send back.
 */
export async function botSendOrShare(
  supabase: Supabase,
  input: { groupId?: string | null; text: string; share: PostShare; teacherId: string; classroomId: string }
): Promise<BotSendResult> {
  const { groupId, text, share, teacherId, classroomId } = input;
  if (!groupId) return { line: 'no_group', share };

  const budget = await groupPushAffordable(groupId);
  if (budget.affordable === false) {
    return {
      line: 'quota',
      share,
      message:
        budget.remaining != null && budget.members != null
          ? `โควตาข้อความ LINE เดือนนี้เหลือ ${budget.remaining} ข้อความ แต่กลุ่มนี้มีสมาชิก ${budget.members} คน (ส่งเข้ากลุ่มนับ 1 ข้อความต่อสมาชิก 1 คน)`
          : undefined,
    };
  }

  const reservation = await reserveLineTestSend(supabase, { teacherId, classroomId, source: 'reannounce' });
  if (!reservation.ok) return { line: 'limit', share, message: reservation.message };
  try {
    await pushLineGroupText(groupId, text);
  } catch (pushError) {
    await releaseLineTestSend(supabase, reservation.id);
    console.error('LINE bot send failed:', pushError);
    return { line: isLineQuotaError(pushError) ? 'quota' : 'failed', share };
  }
  return { line: 'sent' };
}
