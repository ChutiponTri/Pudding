import { useCallback, useEffect, useState } from 'react';

/**
 * Browser-side copy of "LINE groups the bot is in with me, not linked yet"
 * (GET /api/line/connections?groups=1). The list belongs to the teacher, not
 * to a classroom, so every LINE dialog shares one copy: it is fetched once in
 * the background when a page has an unlinked classroom, shown instantly when
 * a dialog opens, and refreshed behind it when older than STALE_MS.
 */
export type LineGroupChoice = { ref: string; groupName?: string };
export type LineGroupChoices = { groups: LineGroupChoice[]; lineLinked: boolean };

const STALE_MS = 30 * 1000;

let cached: { at: number; data: LineGroupChoices } | null = null;
let inflight: Promise<LineGroupChoices | null> | null = null;
const listeners = new Set<(data: LineGroupChoices) => void>();

function publish(data: LineGroupChoices) {
  cached = { at: Date.now(), data };
  for (const listener of listeners) listener(data);
}

/** The remembered list (any age), or undefined if never fetched. */
export function peekLineGroups(): LineGroupChoices | undefined {
  return cached?.data;
}

/**
 * Fetches the list. Calls while one is running share it; without `fresh`, a
 * list younger than STALE_MS is returned as is. `fresh` also makes the server
 * ask LINE again (the refresh button).
 */
export function loadLineGroups(options: { fresh?: boolean } = {}): Promise<LineGroupChoices | null> {
  if (!options.fresh && cached && Date.now() - cached.at < STALE_MS) return Promise.resolve(cached.data);
  if (inflight && !options.fresh) return inflight;
  const request = fetch(`/api/line/connections?groups=1${options.fresh ? '&fresh=1' : ''}`, { cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((json: LineGroupChoices | null) => {
      if (json) publish({ groups: json.groups || [], lineLinked: json.lineLinked !== false });
      return json;
    })
    .catch(() => null)
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  inflight = request;
  return request;
}

/** Warm the list in the background (idle time), e.g. when a page shows an unlinked classroom. */
export function prefetchLineGroups() {
  if (cached && Date.now() - cached.at < STALE_MS) return;
  const run = () => void loadLineGroups();
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 300);
}

/** A group just got linked: it is no longer a choice anywhere. */
export function dropLineGroup(ref: string) {
  if (!cached) return;
  publish({ ...cached.data, groups: cached.data.groups.filter((group) => group.ref !== ref) });
}

/** Follow list updates (another dialog's refresh or link). Returns the unsubscribe function. */
export function subscribeLineGroups(listener: (data: LineGroupChoices) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The shared list for a LINE dialog: shows the remembered copy at once, and
 * refetches (if stale) each time `open` turns true. `refresh` asks LINE again.
 */
export function useLineGroupChoices(open: boolean) {
  const [data, setData] = useState<LineGroupChoices | undefined>(peekLineGroups);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => subscribeLineGroups(setData), []);
  useEffect(() => {
    if (!open) return;
    void loadLineGroups();
  }, [open]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadLineGroups({ fresh: true });
    } finally {
      setRefreshing(false);
    }
  }, []);
  return { groups: data?.groups, lineLinked: data?.lineLinked, refresh, refreshing };
}
