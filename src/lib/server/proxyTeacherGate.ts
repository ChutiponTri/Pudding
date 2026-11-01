import { createClient } from '@supabase/supabase-js';
import { teacherAccessOf, type TeacherAccess } from '@/lib/utils/teacherProfile';

/**
 * Teacher gate for proxy.ts: decides before a page renders whether a
 * signed-in teacher may see it, so a pending teacher never sees the app shell
 * (not even for a moment) before TeacherProfileGate sends them away.
 *
 * Optimistic only: the API still checks every request (teacherProfileGuard).
 * An "ok" answer is kept in a signed, short-lived cookie so approved teachers
 * pay for the users-row read once per TTL, not on every navigation. Other
 * answers are never cached, so an approval takes effect on the next page load.
 *
 * No 'server-only' / next/headers imports here: this runs inside the proxy bundle.
 */
export const TEACHER_OK_COOKIE = 'pudding_teacher_ok';
export const TEACHER_OK_TTL_SECONDS = 10 * 60;

const encoder = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;

function signingKey() {
  const secret = process.env.CLERK_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!secret) return null;
  keyPromise ??= crypto.subtle.importKey(
    'raw',
    encoder.encode(`pudding-teacher-ok:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return keyPromise;
}

async function sign(payload: string) {
  const key = await signingKey();
  if (!key) return null;
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Cookie value saying `userId` was approved, valid for TEACHER_OK_TTL_SECONDS. */
export async function teacherOkCookieValue(userId: string) {
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + TEACHER_OK_TTL_SECONDS}`;
  const mac = await sign(payload);
  return mac ? `${payload}.${mac}` : null;
}

/** Whether the cookie is a valid, unexpired "ok" for this user. */
export async function hasValidTeacherOkCookie(value: string | undefined, userId: string) {
  if (!value) return false;
  const last = value.lastIndexOf('.');
  if (last < 0) return false;
  const payload = value.slice(0, last);
  const [id, exp] = [payload.slice(0, payload.lastIndexOf('.')), payload.slice(payload.lastIndexOf('.') + 1)];
  if (id !== userId || !(Number(exp) > Date.now() / 1000)) return false;
  const expected = await sign(payload);
  return expected !== null && expected === value.slice(last + 1);
}

/** The teacher's access, or null when it could not be read (the proxy then lets the page through). */
export async function readTeacherAccessForProxy(userId: string): Promise<TeacherAccess | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  try {
    const { data, error } = await createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
      .from('users')
      .select('first_name, last_name, institution, teacher_approval')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.warn('[proxy] teacher access check failed:', error.message);
      return null;
    }
    // No row yet (first visit after sign-up) counts as an incomplete profile.
    return teacherAccessOf(data);
  } catch (error) {
    console.warn('[proxy] teacher access check failed:', error);
    return null;
  }
}
