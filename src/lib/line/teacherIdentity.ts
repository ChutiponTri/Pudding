import 'server-only';
import { clerkClient } from '@clerk/nextjs/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';

export type TeacherLineStatus = 'connected' | 'missing_line' | 'conflict' | 'previous_account' | 'not_found';

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
 * Fallback that needs no linked login bot: the Messaging API only returns a
 * profile for users who currently have the bot as a friend. This also catches
 * teachers who added the bot before their line_uid was saved, whose `follow`
 * webhook matched no row.
 */
async function fetchBotProfileFriendship(lineUid: string): Promise<boolean | null> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUid)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (response.ok) return true;
    if (response.status === 404) return false;
    return null;
  } catch (error) {
    console.warn('LINE bot profile lookup failed:', error);
    return null;
  }
}

/**
 * Teachers sign up with LINE through Clerk, so the LINE user id is already on
 * their Clerk account. Copy it to users.teacher_line_uid so the bot recognises
 * the teacher without any pairing code. users.line_uid stays the student
 * identity, so the same person may also have a student LIFF account. The LINE Login channel used by Clerk must
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
    .select('id, teacher_line_uid, line_bot_friend')
    .eq('id', clerkUserId)
    .eq('role', 'teacher')
    .maybeSingle();
  let { data: teacher, error: teacherError } = await selectTeacher();
  // e.g. the line_bot_friend column is missing because the migration was not run
  if (teacherError) throw teacherError;
  if (!teacher) {
    // The same person may already have a teacher row under an older Clerk
    // account (e.g. from email/Google sign-in). Creating a second row would
    // collide on email, and the old row owns their courses, so report it.
    const email = clerkUser.primaryEmailAddress?.emailAddress;
    if (email) {
      const { data: previous } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .neq('id', clerkUserId)
        .limit(1)
        .maybeSingle();
      if (previous) return { status: 'previous_account', botFriend: null };
    }

    // Right after sign-up the client-side profile sync may not have created the
    // row yet; create it here so linking does not depend on that race.
    const { error: createError } = await supabase.from('users').upsert({
      id: clerkUserId,
      clerk_id: clerkUserId,
      role: 'teacher',
      first_name: clerkUser.firstName || 'คุณครู',
      last_name: clerkUser.lastName || '',
      email: clerkUser.primaryEmailAddress?.emailAddress || null,
      avatar_url: clerkUser.imageUrl || null,
    }, { onConflict: 'id', ignoreDuplicates: true });
    if (createError) throw createError;
    ({ data: teacher, error: teacherError } = await selectTeacher());
    if (teacherError) throw teacherError;
  }
  if (!teacher) return { status: 'not_found', botFriend: null };
  if (!lineUid) return { status: 'missing_line', botFriend: null };

  // Never take over a LINE id that already belongs to another teacher account.
  const { data: owner } = await supabase.from('users').select('id').eq('teacher_line_uid', lineUid).maybeSingle();
  if (owner && owner.id !== clerkUserId) return { status: 'conflict', lineUid, botFriend: null };

  const friendship = (await fetchBotFriendship(clerkUserId)) ?? (await fetchBotProfileFriendship(lineUid));
  const botFriend = friendship ?? (teacher.line_bot_friend ?? null);

  if (teacher.teacher_line_uid !== lineUid || (friendship !== null && friendship !== teacher.line_bot_friend)) {
    const { error } = await supabase.from('users').update({
      teacher_line_uid: lineUid,
      is_line_connected: true,
      line_link_status: 'connected',
      ...(friendship !== null ? { line_bot_friend: friendship } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', clerkUserId).eq('role', 'teacher');
    if (error) throw error;
  }

  return { status: 'connected', lineUid, botFriend };
}
