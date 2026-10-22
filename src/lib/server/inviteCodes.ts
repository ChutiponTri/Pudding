import 'server-only';
import { createHmac, randomInt } from 'node:crypto';

/** No 0/O or 1/I, so codes read back and type correctly. 32 symbols = 5 bits each. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A fresh classroom invite code, e.g. "PD-7KQ2MX9A" (40 random bits). */
export function newClassroomInviteCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return `PD-${code}`;
}

/** Canonical form for comparing codes typed or pasted by people. */
export function normalizeInviteCode(code: string | null | undefined): string {
  return (code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function inviteSecret(): string {
  const secret = process.env.INVITE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error('INVITE_SECRET is not configured');
  return secret;
}

/**
 * Short co-teacher invite code for a course and role: 12 characters (60 bits)
 * of an HMAC, so it cannot be guessed or edited into another course or role,
 * and needs no database column. Changing INVITE_SECRET revokes every link.
 */
export function teacherInviteCode(courseId: string, role: 'assistant' | 'researcher'): string {
  const digest = createHmac('sha256', inviteSecret()).update(`course-invite:${courseId}:${role}`).digest();
  let code = '';
  for (let i = 0; i < 12; i++) code += ALPHABET[digest[i] & 31];
  return code;
}
