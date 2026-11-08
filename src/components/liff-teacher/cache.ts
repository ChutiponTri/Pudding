"use client";

/**
 * The teacher LIFF's data cache: stale-while-revalidate. A page shows what it
 * had (this session, or the last time the menu was opened on this phone) at
 * once and refreshes it in the background; the same request is never in
 * flight twice. Kept per LINE account and group, so another LINE account on
 * the same phone never sees it, and a server refusal wipes it (see clear).
 */

type Entry = { data: unknown; at: number };

const PREFIX = "pudding-lt:v1:";
/** Older than this, a page refreshes it in the background when it opens. */
export const STALE_MS = 15_000;
/** Older than this, the phone's copy is not shown at all. */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

const memory = new Map<string, Entry>();

/**
 * Keys with a ":mem:" part live in this page's memory only: students'
 * answers and behaviour logs are not left on the phone.
 */
const memoryOnly = (key: string) => key.includes(":mem:");
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<() => void>>();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCache(key: string): Entry | null {
  const hit = memory.get(key);
  if (hit || memoryOnly(key)) return hit ?? null;
  try {
    const raw = storage()?.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry;
    if (!entry || typeof entry.at !== "number" || Date.now() - entry.at > MAX_AGE_MS) return null;
    memory.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

export function writeCache(key: string, data: unknown, at = Date.now()) {
  const entry = { data, at };
  memory.set(key, entry);
  try {
    if (!memoryOnly(key)) storage()?.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Full or blocked storage: this session still has it in memory.
  }
  listeners.get(key)?.forEach((notify) => notify());
}

/** Marks entries stale, so the next look refreshes them; open pages refresh now. */
export function staleCache(keys: string[]) {
  for (const key of keys) {
    const hit = readCache(key);
    if (hit) memory.set(key, { ...hit, at: 0 });
    listeners.get(key)?.forEach((notify) => notify());
  }
}

/** Every entry of this LINE account and group (the server said no: nothing is shown again). */
export function clearCache(scope: string) {
  for (const key of [...memory.keys()]) if (key.startsWith(scope)) memory.delete(key);
  const store = storage();
  if (!store) return;
  try {
    for (let i = store.length - 1; i >= 0; i--) {
      const name = store.key(i);
      if (name?.startsWith(PREFIX + scope)) store.removeItem(name);
    }
  } catch {
    // Storage blocked: nothing was saved there either.
  }
}

export function subscribeCache(key: string, notify: () => void) {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(notify);
  return () => {
    set!.delete(notify);
  };
}

/** One request per key at a time: a second caller shares the first one's answer. */
export function fetchOnce<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const promise = load()
    .then((data) => {
      writeCache(key, data);
      return data;
    })
    .finally(() => {
      inflight.delete(key);
      listeners.get(key)?.forEach((notify) => notify());
    });
  inflight.set(key, promise);
  listeners.get(key)?.forEach((notify) => notify());
  return promise;
}

/** Whether a request for this key is running (pages show a thin loading bar meanwhile). */
export const isLoading = (key: string) => inflight.has(key);

export const isFresh = (entry: Entry | null) => !!entry && Date.now() - entry.at < STALE_MS;
