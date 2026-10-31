import 'server-only';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { HttpError } from '@/lib/server/access';
import { isTeacherProfileComplete } from '@/lib/utils/teacherProfile';

/**
 * Server side of the profile popup: a teacher without a first name, last name
 * and institution may only call the few actions that fill them in.
 *
 * Cache: only "complete" answers are kept (60 s, per server instance), so a
 * teacher who just saved their profile is never wrongly blocked by an old
 * "incomplete" answer on another instance. A name removed in the database
 * is enforced within 60 s everywhere, at once on the instance that saw the
 * change. Parallel requests on a page load share one query.
 */
const COMPLETE_TTL_MS = 60 * 1000;
const MAX_ENTRIES = 2000;

const completeUntil = new Map<string, number>();
const inflight = new Map<string, Promise<boolean>>();
/** Bumped on every remember(); a query that started before a change must not cache its answer. */
const generation = new Map<string, number>();

export const PROFILE_INCOMPLETE_MESSAGE = 'กรุณากรอกชื่อ นามสกุล และสถานศึกษาให้ครบก่อนใช้งาน';

function cacheComplete(userId: string) {
  if (completeUntil.size >= MAX_ENTRIES) {
    const now = Date.now();
    for (const [id, until] of completeUntil) if (until <= now) completeUntil.delete(id);
    // Still full: drop the oldest entries (Map keeps insertion order).
    for (const id of completeUntil.keys()) {
      if (completeUntil.size < MAX_ENTRIES) break;
      completeUntil.delete(id);
    }
  }
  completeUntil.delete(userId); // re-insert so it counts as newest
  completeUntil.set(userId, Date.now() + COMPLETE_TTL_MS);
}

/** Records a profile this instance just read or wrote, so the next request needs no query. */
export function rememberTeacherProfile(userId: string, complete: boolean) {
  generation.set(userId, (generation.get(userId) || 0) + 1);
  inflight.delete(userId);
  if (complete) cacheComplete(userId);
  else completeUntil.delete(userId);
  // The generation map only matters while a query is running; keep it small.
  if (generation.size > MAX_ENTRIES) generation.clear();
}

/** Whether the teacher's users row has all three fields. Errors count as "not complete". */
export async function hasCompleteTeacherProfile(userId: string): Promise<boolean> {
  const until = completeUntil.get(userId);
  if (until && until > Date.now()) return true;
  if (until) completeUntil.delete(userId);

  const running = inflight.get(userId);
  if (running) return running;

  const startedAt = generation.get(userId) || 0;
  const query = readProfileComplete(userId).then((complete) => {
    if (inflight.get(userId) === query) inflight.delete(userId);
    if (complete && (generation.get(userId) || 0) === startedAt) cacheComplete(userId);
    return complete;
  });
  inflight.set(userId, query);
  return query;
}

/** One users-row read; never rejects. */
async function readProfileComplete(userId: string): Promise<boolean> {
  try {
    const { data, error } = await createServiceSupabaseClient()
      .from('users')
      .select('first_name, last_name, institution')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.warn('Teacher profile check failed:', error.message);
      return false;
    }
    return isTeacherProfileComplete(data);
  } catch (error) {
    console.warn('Teacher profile check failed:', error);
    return false;
  }
}

/** Throws 403 unless the teacher's profile is complete. */
export async function requireCompleteTeacherProfile(userId: string) {
  if (!(await hasCompleteTeacherProfile(userId))) throw new HttpError(403, PROFILE_INCOMPLETE_MESSAGE);
}

/** Response for routes that answer with NextResponse directly. */
export function profileIncompleteResponse() {
  return Response.json({ error: PROFILE_INCOMPLETE_MESSAGE }, { status: 403 });
}

/** Test hook: forget everything. */
export function resetTeacherProfileCache() {
  completeUntil.clear();
  inflight.clear();
  generation.clear();
}
