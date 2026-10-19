import 'server-only';
import { clerkClient } from '@clerk/nextjs/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

export type TeacherLineStatus = 'connected' | 'missing_line' | 'conflict' | 'not_found';

export interface TeacherLineIdentity {
  status: TeacherLineStatus;
  lineUid?: string;
  /** null when LINE did not report friendship (e.g. no OAuth token available). */
  botFriend: boolean | null;
}

/** LINE's friendship API, called with the teacher's LINE Login token held by Clerk. */
async function fetchBotFriendship(clerkUserId: string): Promise<boolean | null> {
  try {
    const client = await clerkClient();
    const tokens = await client.users.getUserOauthAccessToken(clerkUserId, 'line');
    const accessToken = tokens.data[0]?.token;
    if (!accessToken) return null;
    const response = await fetch('https://api.line.me/friendship/v1/status', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const json = await response.json();
    return Boolean(json.friendFlag);
  } catch (error) {
    console.warn('LINE friendship lookup failed:', error);
    return null;
  }
}

/**
 * Teachers sign up with LINE through Clerk, so the LINE user id is already on
 * their Clerk account. Copy it to users.line_uid so the bot recognises the
 * teacher without any pairing code. The LINE Login channel used by Clerk must
 * belong to the same LINE provider as the Messaging API bot for the ids to match.
 */
export async function syncTeacherLineIdentity(clerkUserId: string): Promise<TeacherLineIdentity> {
  const client = await clerkClient();
  const clerkUser = await client.users.getUser(clerkUserId);
  const lineAccount = clerkUser.externalAccounts.find(
    (account) => account.provider === 'line' || account.provider === 'oauth_line'
  );
  const lineUid = lineAccount?.providerUserId;

  const supabase = createServiceSupabaseClient();
  const selectTeacher = () => supabase
    .from('users')
    .select('id, line_uid, line_bot_friend')
    .eq('id', clerkUserId)
    .eq('role', 'teacher')
    .maybeSingle();
  let { data: teacher, error: teacherError } = await selectTeacher();
  // e.g. the line_bot_friend column is missing because the migration was not run
  if (teacherError) throw teacherError;
  if (!teacher) {
    // Right after sign-up the client-side profile sync may not have created the
    // row yet; create it here so linking does not depend on that race.
    await supabase.from('users').upsert({
      id: clerkUserId,
      clerk_id: clerkUserId,
      role: 'teacher',
      first_name: clerkUser.firstName || 'คุณครู',
      last_name: clerkUser.lastName || '',
      email: clerkUser.primaryEmailAddress?.emailAddress || null,
      avatar_url: clerkUser.imageUrl || null,
    }, { onConflict: 'id', ignoreDuplicates: true });
    ({ data: teacher, error: teacherError } = await selectTeacher());
    if (teacherError) throw teacherError;
  }
  if (!teacher) return { status: 'not_found', botFriend: null };
  if (!lineUid) return { status: 'missing_line', botFriend: null };

  // Never take over a LINE id that already belongs to another account
  // (for example the same person's student LIFF profile).
  const { data: owner } = await supabase.from('users').select('id').eq('line_uid', lineUid).maybeSingle();
  if (owner && owner.id !== clerkUserId) return { status: 'conflict', lineUid, botFriend: null };

  const friendship = await fetchBotFriendship(clerkUserId);
  const botFriend = friendship ?? (teacher.line_bot_friend ?? null);

  if (teacher.line_uid !== lineUid || (friendship !== null && friendship !== teacher.line_bot_friend)) {
    const { error } = await supabase.from('users').update({
      line_uid: lineUid,
      is_line_connected: true,
      line_link_status: 'connected',
      ...(friendship !== null ? { line_bot_friend: friendship } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', clerkUserId).eq('role', 'teacher');
    if (error) throw error;
  }

  return { status: 'connected', lineUid, botFriend };
}
