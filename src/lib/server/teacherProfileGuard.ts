import 'server-only';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { HttpError } from '@/lib/server/access';
import { teacherAccessOf, type TeacherAccess } from '@/lib/utils/teacherProfile';

/**
 * Server side of the teacher gate. A teacher may use the app only when
 *   1. their first name, last name and institution are filled in, and
 *   2. the admin has approved the account (users.teacher_approval).
 * Until then they may only call the few actions that fill in the profile.
 *
 * Cache: only "ok" answers are kept (60 s, per server instance), so a teacher
 * who was just approved or just saved their profile is never wrongly blocked
 * by an old answer on another instance. A rejection or a removed name is
 * enforced within 60 s everywhere, at once on the instance that saw the
 * change. Parallel requests on a page load share one query.
 */
const OK_TTL_MS = 60 * 1000;
const MAX_ENTRIES = 2000;

const okUntil = new Map<string, number>();
const inflight = new Map<string, Promise<TeacherAccess>>();
/** Bumped on every remember(); a query that started before a change must not cache its answer. */
const generation = new Map<string, number>();

export const PROFILE_INCOMPLETE_MESSAGE = 'กรุณากรอกชื่อ นามสกุล และสถานศึกษาให้ครบก่อนใช้งาน';
export const APPROVAL_PENDING_MESSAGE = 'บัญชีครูของคุณกำลังรอผู้ดูแลระบบตรวจสอบ จะใช้งานได้เมื่อได้รับการอนุมัติ';
export const APPROVAL_REJECTED_MESSAGE = 'บัญชีครูนี้ไม่ได้รับการอนุมัติให้ใช้งาน กรุณาติดต่อผู้ดูแลระบบ';

/** Why a teacher is blocked, as a message for the API response. */
export function teacherAccessMessage(access: TeacherAccess) {
  if (access === 'pending') return APPROVAL_PENDING_MESSAGE;
  if (access === 'rejected') return APPROVAL_REJECTED_MESSAGE;
  return PROFILE_INCOMPLETE_MESSAGE;
}

function cacheOk(userId: string) {
  if (okUntil.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [id, until] of okUntil) if (until <= now) okUntil.delete(id);
    // Still full: drop the oldest entries (Map keeps insertion order).
    for (const id of okUntil.keys()) {
      if (okUntil.size < MAX_ENTRIES) break;
      okUntil.delete(id);
    }
  }
  okUntil.delete(userId); // re-insert so it counts as newest
  okUntil.set(userId, Date.now() + OK_TTL_MS);
}

/** Records an access state this instance just read or wrote, so the next request needs no query. */
export function rememberTeacherAccess(userId: string, access: TeacherAccess) {
  generation.set(userId, (generation.get(userId) || 0) + 1);
  inflight.delete(userId);
  if (access === 'ok') cacheOk(userId);
  else okUntil.delete(userId);
  // The generation map only matters while a query is running; keep it small.
  if (generation.size > MAX_ENTRIES) generation.clear();
}

/** Forgets what this instance knows (e.g. after the admin changed the approval). */
export function forgetTeacherAccess(userId: string) {
  generation.set(userId, (generation.get(userId) || 0) + 1);
  inflight.delete(userId);
  okUntil.delete(userId);
}

/** The teacher's access state. Errors count as "incomplete" (fail closed). */
export async function getTeacherAccess(userId: string): Promise<TeacherAccess> {
  const until = okUntil.get(userId);
  if (until && until > Date.now()) return 'ok';
  if (until) okUntil.delete(userId);

  const running = inflight.get(userId);
  if (running) return running;

  const startedAt = generation.get(userId) || 0;
  const query = readTeacherAccess(userId).then((access) => {
    if (inflight.get(userId) === query) inflight.delete(userId);
    if (access === 'ok' && (generation.get(userId) || 0) === startedAt) cacheOk(userId);
    return access;
  });
  inflight.set(userId, query);
  return query;
}

/** Whether the teacher may use the app (complete profile and approved). */
export async function canUseTeacherApp(userId: string): Promise<boolean> {
  return (await getTeacherAccess(userId)) === 'ok';
}

/** One users-row read; never rejects. */
async function readTeacherAccess(userId: string): Promise<TeacherAccess> {
  try {
    const { data, error } = await createServiceSupabaseClient()
      .from('users')
      .select('first_name, last_name, institution, teacher_approval')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      if (error.message.includes('teacher_approval')) {
        console.error('users.teacher_approval is missing: run supabase_teacher_approval_update.sql. Every teacher is blocked until then.');
      } else {
        console.warn('Teacher access check failed:', error.message);
      }
      return 'incomplete';
    }
    return teacherAccessOf(data);
  } catch (error) {
    console.warn('Teacher access check failed:', error);
    return 'incomplete';
  }
}

/** Throws 403 unless the teacher may use the app. */
export async function requireTeacherAccess(userId: string) {
  const access = await getTeacherAccess(userId);
  if (access !== 'ok') throw new HttpError(403, teacherAccessMessage(access));
}

/** 403 response for routes that answer with NextResponse directly. */
export function teacherBlockedResponse(access: TeacherAccess) {
  return Response.json({ error: teacherAccessMessage(access), teacherAccess: access }, { status: 403 });
}

/** Test hook: forget everything. */
export function resetTeacherAccessCache() {
  okUntil.clear();
  inflight.clear();
  generation.clear();
}
