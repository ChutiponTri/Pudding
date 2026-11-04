import 'server-only';

/**
 * A simple per-caller request limit (fixed one-minute windows, kept in this
 * server instance's memory). It stops one caller from flooding the data
 * endpoint; with several instances each one counts on its own, so it is a
 * brake, not an exact quota.
 */
const WINDOW_MS = 60_000;
const MAX_KEYS = 10_000;
const windows = new Map<string, { start: number; count: number }>();

/** Counts one request for `key`; false when it is over `limit` in the current minute. */
export function takeRequest(key: string, limit: number, now: number = Date.now()): boolean {
  const current = windows.get(key);
  if (!current || now - current.start >= WINDOW_MS) {
    if (windows.size >= MAX_KEYS) {
      for (const [k, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(k);
      if (windows.size >= MAX_KEYS) windows.clear();
    }
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

/** The caller's address as the hosting proxy reports it. */
export function clientIp(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
}
