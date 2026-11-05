import 'server-only';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

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

/**
 * Share link token for one assignment used as a template by other teachers:
 * `<assignmentId>.<16-char HMAC>`. Anyone holding it may copy the work (title,
 * instructions, questions with answer keys), never its students or scores.
 * Needs no database column; changing INVITE_SECRET revokes every link.
 */
export function assignmentTemplateToken(assignmentId: string): string {
  const digest = createHmac('sha256', inviteSecret()).update(`assignment-template:${assignmentId}`).digest();
  let sig = '';
  for (let i = 0; i < 16; i++) sig += ALPHABET[digest[i] & 31];
  return `${assignmentId}.${sig}`;
}

/** The assignment id a template token was made for, or null if it was not made here. */
export function assignmentIdFromTemplateToken(token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const expected = Buffer.from(assignmentTemplateToken(id));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

/**
 * Link token for sharing one timeline post to LINE by hand (when the bot
 * cannot send it): `<postId>.<16-char HMAC>`. It only reveals that post's LINE
 * message, which was meant for the class group anyway.
 */
export function postShareToken(postId: string): string {
  const digest = createHmac('sha256', inviteSecret()).update(`post-share:${postId}`).digest();
  let sig = '';
  for (let i = 0; i < 16; i++) sig += ALPHABET[digest[i] & 31];
  return `${postId}.${sig}`;
}

/** The post id a share token was made for, or null if it was not made here. */
export function postIdFromShareToken(token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const expected = Buffer.from(postShareToken(id));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

/** Prefix of share tokens for re-announcing a work (no timeline post behind them). */
const REANNOUNCE_PREFIX = 'r:';

/** Link token for re-announcing one work to LINE by hand: `r:<assignmentId>.<16-char HMAC>`. */
export function reannounceShareToken(assignmentId: string): string {
  const digest = createHmac('sha256', inviteSecret()).update(`reannounce-share:${assignmentId}`).digest();
  let sig = '';
  for (let i = 0; i < 16; i++) sig += ALPHABET[digest[i] & 31];
  return `${REANNOUNCE_PREFIX}${assignmentId}.${sig}`;
}

/** Prefix of share tokens for a work's reminder ("ทวงงาน": who has not handed in yet). */
const REMIND_PREFIX = 'm:';

/** Link token for a work's reminder shared by hand: `m:<assignmentId>.<16-char HMAC>`. */
export function remindShareToken(assignmentId: string): string {
  const digest = createHmac('sha256', inviteSecret()).update(`remind-share:${assignmentId}`).digest();
  let sig = '';
  for (let i = 0; i < 16; i++) sig += ALPHABET[digest[i] & 31];
  return `${REMIND_PREFIX}${assignmentId}.${sig}`;
}

/** What a share token points at: a timeline post, a work to re-announce, or a work's reminder. null if it was not made here. */
export function parseShareToken(token: unknown): { kind: 'post' | 'reannounce' | 'remind'; id: string } | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  if (token.startsWith(REMIND_PREFIX)) {
    const dot = token.lastIndexOf('.');
    if (dot <= REMIND_PREFIX.length) return null;
    const id = token.slice(REMIND_PREFIX.length, dot);
    const expected = Buffer.from(remindShareToken(id));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given) ? { kind: 'remind', id } : null;
  }
  if (token.startsWith(REANNOUNCE_PREFIX)) {
    const dot = token.lastIndexOf('.');
    if (dot <= REANNOUNCE_PREFIX.length) return null;
    const id = token.slice(REANNOUNCE_PREFIX.length, dot);
    const expected = Buffer.from(reannounceShareToken(id));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given) ? { kind: 'reannounce', id } : null;
  }
  const id = postIdFromShareToken(token);
  return id ? { kind: 'post', id } : null;
}
