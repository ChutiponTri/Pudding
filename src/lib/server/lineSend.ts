import 'server-only';
import type { createServiceSupabaseClient } from '@/lib/supabase/server';
import type { PostShare } from '@/lib/server/classroomPosts';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

export type BotSendStatus = 'card' | 'no_group';

export interface BotSendResult {
  /** 'card': the teacher's LINE sends it into the linked group; 'no_group': there is none, so they pick a chat. */
  line: BotSendStatus;
  /** The message to send from the teacher's own LINE (/liff/share, or straight in from the teacher LIFF pages). */
  share: PostShare;
  message?: string;
}

/**
 * A teacher sends something to the class group again (re-announce a work or
 * a post, remind who has not handed in, announce scores, call a check-in,
 * invite students). The bot no longer pushes these (a group push costs one
 * message per member): the teacher's own LINE sends the card, which uses no
 * quota. Kept as one place so every re-send behaves the same.
 */
export async function botSendOrShare(
  _supabase: Supabase,
  input: { groupId?: string | null; text: string; share: PostShare; teacherId: string; classroomId: string }
): Promise<BotSendResult> {
  return { line: input.groupId ? 'card' : 'no_group', share: input.share };
}
