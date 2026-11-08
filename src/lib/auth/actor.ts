import 'server-only';
import { createHash } from 'node:crypto';
import { auth } from '@clerk/nextjs/server';
import type { NextRequest } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { LIFF_TEACHER_HEADER, LINE_TOKEN_HEADER } from '@/lib/auth/lineSession';
import { teacherAccessOf } from '@/lib/utils/teacherProfile';
import { needsTeacherRepair, repairTeacherRow } from '@/lib/line/legacyTeacherRows';
import { canUseTeacherApp } from '@/lib/server/teacherProfileGuard';

/** Who is calling: a signed-in teacher (Clerk) or a student verified through LINE. */
export type Actor =
  | { kind: 'teacher'; userId: string }
  | {
      kind: 'student';
      /** LINE user id, verified with LINE. */
      lineUid: string;
      /** Every id this student may appear under (users.id and LINE id). */
      keys: string[];
      userId: string;
    };

const tokenCache = new Map<string, { lineUid: string; expiresAt: number }>();
const TOKEN_CACHE_MS = 10 * 60 * 1000;

/** LINE id → users.id of a student, per server instance. */
const studentIdCache = new Map<string, { userId: string; expiresAt: number }>();
const STUDENT_ID_CACHE_MS = 5 * 60 * 1000;

/** Drops the remembered users.id (call after a student's row is created or re-keyed). */
export function forgetStudentActor(lineUid: string) {
  studentIdCache.delete(lineUid);
}

/** LINE Login channel id: explicit env, else the number before "-" in the LIFF id. */
function lineChannelId() {
  const liffId = process.env.LINE_LIFF_ID || process.env.NEXT_PUBLIC_LINE_LIFF_ID || '';
  return process.env.LINE_LOGIN_CHANNEL_ID || liffId.split('-')[0] || '';
}

/** Resolves a LIFF access token to its LINE user id (cached briefly to save LINE API calls). */
export async function verifyLineToken(token: string): Promise<string | null> {
  const key = createHash('sha256').update(token).digest('hex');
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.lineUid;

  try {
    // Both LINE calls at once; the profile is used only if the token checks out.
    const [verify, profile] = await Promise.all([
      fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`, { cache: 'no-store' }),
      fetch('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }),
    ]);
    if (!verify.ok) return null;
    const info = (await verify.json()) as { client_id?: string; expires_in?: number };
    const channelId = lineChannelId();
    if (!channelId || info.client_id !== channelId || !info.expires_in || info.expires_in <= 0) return null;
    if (!profile.ok) return null;
    const { userId } = (await profile.json()) as { userId?: string };
    if (!userId) return null;

    if (tokenCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of tokenCache) if (v.expiresAt <= now) tokenCache.delete(k);
    }
    tokenCache.set(key, { lineUid: userId, expiresAt: Date.now() + Math.min(TOKEN_CACHE_MS, info.expires_in * 1000) });
    return userId;
  } catch (error) {
    console.warn('LINE token verification failed:', error);
    return null;
  }
}

/** LINE id → the teacher behind it and whether they may use the app, per server instance. */
const liffTeacherCache = new Map<string, { userId: string; ok: boolean; expiresAt: number }>();
const LIFF_TEACHER_CACHE_MS = 2 * 60 * 1000;

/**
 * A teacher using the teacher LIFF pages: the LINE account (verified with
 * LINE) must be a teacher's LINE sign-in (users.teacher_line_uid), the same
 * check the bot and /liff/connect use. Returns null for anyone else.
 */
async function liffTeacherActor(token: string, allowIncompleteProfile: boolean): Promise<Actor | null> {
  const lineUid = await verifyLineToken(token);
  if (!lineUid) return null;
  let known = liffTeacherCache.get(lineUid);
  if (!known || known.expiresAt <= Date.now()) {
    const { data } = await createServiceSupabaseClient()
      .from('users')
      .select('id, first_name, last_name, institution, teacher_approval')
      .eq('teacher_line_uid', lineUid)
      .eq('role', 'teacher')
      .maybeSingle();
    if (!data) return null;
    known = { userId: data.id as string, ok: teacherAccessOf(data) === 'ok', expiresAt: Date.now() + LIFF_TEACHER_CACHE_MS };
    if (liffTeacherCache.size > 1000) liffTeacherCache.clear();
    liffTeacherCache.set(lineUid, known);
  }
  if (!known.ok && !allowIncompleteProfile) return null;
  return { kind: 'teacher', userId: known.userId };
}

/** The teacher behind a request (Clerk session, or the teacher LIFF pages), or null. */
export async function getTeacherUserId(request: NextRequest | Request): Promise<string | null> {
  const actor = await getActor(request, { allowIncompleteProfile: true });
  return actor?.kind === 'teacher' ? actor.userId : null;
}

/** True when the request comes from the teacher LIFF pages (inside LINE). */
export const isLiffTeacherRequest = (request: NextRequest | Request) =>
  !!request.headers.get(LINE_TOKEN_HEADER) && request.headers.get(LIFF_TEACHER_HEADER) === '1';

/**
 * The caller of an API request. A LINE token header means a student (the LIFF
 * app), or a teacher when the teacher LIFF pages add their header; otherwise
 * the Clerk session decides. null = not signed in, or a
 * teacher who may not use the app yet: name or institution missing, or not
 * approved by the admin (see teacherProfileGuard). Pass allowIncompleteProfile
 * to get such a teacher anyway and decide per action.
 */
export async function getActor(
  request: NextRequest | Request,
  options: { allowIncompleteProfile?: boolean } = {}
): Promise<Actor | null> {
  const token = request.headers.get(LINE_TOKEN_HEADER);
  if (token && request.headers.get(LIFF_TEACHER_HEADER) === '1') return liffTeacherActor(token, !!options.allowIncompleteProfile);
  if (token) {
    const lineUid = await verifyLineToken(token);
    if (!lineUid) return null;
    // Every LIFF request needs the student's users.id; remembered briefly so a
    // screen that sends a few requests pays the database lookup once.
    const known = studentIdCache.get(lineUid);
    if (known && known.expiresAt > Date.now()) return { kind: 'student', lineUid, userId: known.userId, keys: [...new Set([known.userId, lineUid])] };
    const supabase = createServiceSupabaseClient();
    const { data } = await supabase.from('users').select('id, role, line_uid, teacher_line_uid').eq('line_uid', lineUid).limit(1).maybeSingle();
    // A teacher's own account is never their student identity (legacy rows are repaired on the way).
    let userId = data?.id || lineUid;
    if (data && needsTeacherRepair(data)) {
      await repairTeacherRow(supabase, data);
      userId = lineUid;
    } else if (data) {
      // Only an existing, settled row is remembered (a first visit creates it later).
      if (studentIdCache.size > 2000) studentIdCache.clear();
      studentIdCache.set(lineUid, { userId, expiresAt: Date.now() + STUDENT_ID_CACHE_MS });
    }
    return { kind: 'student', lineUid, userId, keys: [...new Set([userId, lineUid])] };
  }
  const { userId } = await auth();
  if (!userId) return null;
  if (!options.allowIncompleteProfile && !(await canUseTeacherApp(userId))) return null;
  return { kind: 'teacher', userId };
}
