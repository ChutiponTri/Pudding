/**
 * In-memory cache for teacher pages, kept for the life of the browser tab, so
 * moving between routes reuses data instead of refetching it.
 *
 * An entry stays fresh until something may have changed it:
 * - any write this tab sends (dataService actions, non-GET /api/* requests),
 * - a server signal for one of the watched classrooms (student joined,
 *   submitted, checked in, work published…) — see SessionCacheSync,
 * - a write in another tab of this browser,
 * - a maximum age (short while the realtime socket is down).
 * A stale entry is still shown at once, then replaced by a background fetch.
 */

const MAX_AGE_LIVE_MS = 5 * 60 * 1000;
const MAX_AGE_OFFLINE_MS = 30 * 1000;
const TAB_CHANNEL = 'pudding_session_cache';

/** Shared by the dashboard and the grading hub (same data). */
export const TEACHER_DASHBOARD_CACHE_KEY = 'teacherDashboard';

type Entry = { owner: string; value: unknown; version: number; fetchedAt: number };

let version = 0;
let realtimeLive = false;
const entries = new Map<string, Entry>();
const inflight = new Map<string, { owner: string; version: number; promise: Promise<unknown> }>();
const watchedClassroomIds = new Set<string>();
const watchListeners = new Set<() => void>();
const invalidationListeners = new Set<() => void>();

/** Called whenever entries turn stale, so an open page can refetch what it shows. */
export function onCacheInvalidated(listener: () => void) {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}

function bumpVersion() {
  version++;
  invalidationListeners.forEach((listener) => listener());
}

let tabChannel: BroadcastChannel | null = null;
function getTabChannel() {
  if (tabChannel || typeof window === 'undefined' || !('BroadcastChannel' in window)) return tabChannel;
  try {
    tabChannel = new BroadcastChannel(TAB_CHANNEL);
    tabChannel.onmessage = (event) => {
      if (event.data?.type === 'invalidate') bumpVersion();
    };
  } catch {}
  return tabChannel;
}

/** Marks every entry stale (the next read refetches) and tells this browser's other tabs. */
export function invalidateSessionCache(options: { broadcast?: boolean } = {}) {
  bumpVersion();
  if (options.broadcast === false) return;
  try {
    getTabChannel()?.postMessage({ type: 'invalidate' });
  } catch {}
}

/** Whether server signals currently reach this tab (decides the maximum age). */
export function setRealtimeLive(live: boolean) {
  realtimeLive = live;
}

/** The cached value for `key` if it belongs to `owner`; `fresh` = nothing may have changed it since. */
export function readCache<T>(key: string, owner: string): { value: T; fresh: boolean } | null {
  getTabChannel();
  const entry = entries.get(key);
  if (!entry || entry.owner !== owner) return null;
  const maxAge = realtimeLive ? MAX_AGE_LIVE_MS : MAX_AGE_OFFLINE_MS;
  return { value: entry.value as T, fresh: entry.version === version && Date.now() - entry.fetchedAt < maxAge };
}

/**
 * Stores a value. `startedAt` is the cache version when its fetch began, so a
 * response that raced a write is kept but already stale.
 */
export function writeCache<T>(key: string, owner: string, value: T, startedAt = version) {
  entries.set(key, { owner, value, version: startedAt, fetchedAt: Date.now() });
}

/**
 * Replaces a cached value with what the page now shows (after a refetch of one
 * part, or a local edit) without changing how fresh the entry is, so the next
 * visit starts from the latest data but still refetches if it was stale.
 */
export function patchCache<T>(key: string, owner: string, value: T) {
  const entry = entries.get(key);
  if (!entry || entry.owner !== owner) return;
  entries.set(key, { ...entry, value });
}

/** The current version, to pass back to writeCache for a fetch starting now. */
export function cacheVersion() {
  return version;
}

/** Always fetches (sharing a request already running since the last change) and stores the result. */
export function fetchCached<T>(key: string, owner: string, load: () => Promise<T>): Promise<T> {
  getTabChannel();
  const startedAt = version;
  const running = inflight.get(key);
  if (running && running.owner === owner && running.version === startedAt) return running.promise as Promise<T>;
  const promise = load().then((value) => {
    writeCache(key, owner, value, startedAt);
    return value;
  });
  inflight.set(key, { owner, version: startedAt, promise });
  promise
    .finally(() => {
      if (inflight.get(key)?.promise === promise) inflight.delete(key);
    })
    .catch(() => {});
  return promise;
}

/** The cached value while fresh, otherwise a fetch. */
export function cachedCall<T>(key: string, owner: string, load: () => Promise<T>): Promise<T> {
  const hit = readCache<T>(key, owner);
  return hit?.fresh ? Promise.resolve(hit.value) : fetchCached(key, owner, load);
}

/** Classrooms whose server signals should invalidate the cache (pages add the ones they show). */
export function watchClassrooms(ids: Array<string | null | undefined>) {
  let added = false;
  for (const id of ids) {
    if (id && !watchedClassroomIds.has(id)) {
      watchedClassroomIds.add(id);
      added = true;
    }
  }
  if (added) watchListeners.forEach((listener) => listener());
}

export function getWatchedClassroomIds(): string[] {
  return [...watchedClassroomIds];
}

export function onWatchedClassroomsChange(listener: () => void) {
  watchListeners.add(listener);
  return () => {
    watchListeners.delete(listener);
  };
}

let currentOwner: string | null = null;
/** Clears everything when the signed-in teacher changes (sign-out or another account). */
export function setCacheOwner(owner: string | null) {
  if (owner === currentOwner) return;
  currentOwner = owner;
  entries.clear();
  inflight.clear();
  watchedClassroomIds.clear();
  version++;
  watchListeners.forEach((listener) => listener());
}

let fetchPatched = false;
/**
 * Any non-GET request to this app's own /api routes counts as a write. Many
 * pages call fetch directly (posts, attendance, LINE, uploads), so this catches
 * them in one place. /api/data is handled per action by dataService.
 */
export function invalidateOnApiWrites() {
  if (fetchPatched || typeof window === 'undefined') return;
  fetchPatched = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'GET' || method === 'HEAD') return originalFetch(input, init);
    let path = '';
    try {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      if (url.origin === window.location.origin) path = url.pathname;
    } catch {}
    if (!path.startsWith('/api/') || path === '/api/data') return originalFetch(input, init);
    try {
      return await originalFetch(input, init);
    } finally {
      invalidateSessionCache();
    }
  };
}
