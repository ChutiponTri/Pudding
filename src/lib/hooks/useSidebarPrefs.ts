'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/** The sidebar choices a teacher makes, remembered per teacher in this browser. */
export interface SidebarPrefs {
  /** Term filter (`${semester}_${yearCE}` or 'all'); unset means the current term. */
  term?: string;
  /** Subject keys in the order the teacher dragged them into. */
  order: string[];
  /** Subject keys the teacher collapsed. */
  collapsed: string[];
}

const EMPTY: SidebarPrefs = { order: [], collapsed: [] };
const storageKey = (teacherId: string) => `pudding:sidebar-prefs:${teacherId}`;

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

function readPrefs(teacherId: string): SidebarPrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(storageKey(teacherId)) || 'null');
    if (!raw || typeof raw !== 'object') return EMPTY;
    return {
      term: typeof raw.term === 'string' ? raw.term : undefined,
      order: strings(raw.order),
      collapsed: strings(raw.collapsed),
    };
  } catch {
    return EMPTY;
  }
}

function writePrefs(teacherId: string, prefs: SidebarPrefs) {
  try {
    window.localStorage.setItem(storageKey(teacherId), JSON.stringify(prefs));
  } catch {
    // Storage unavailable (private mode etc.): the choice lasts for this page only.
  }
}

/**
 * Reads and saves the sidebar's term, subject order and collapsed subjects.
 * Read lazily (the sidebar renders nothing before mount, so hydration is
 * unaffected), written on every change, and kept in step across tabs.
 */
export function useSidebarPrefs(teacherId: string | undefined) {
  const [saved, setSaved] = useState<{ teacherId: string; prefs: SidebarPrefs } | null>(null);

  const prefs = useMemo(() => {
    if (!teacherId || typeof window === 'undefined') return EMPTY;
    return saved?.teacherId === teacherId ? saved.prefs : readPrefs(teacherId);
  }, [saved, teacherId]);

  const update = useCallback(
    (change: (prev: SidebarPrefs) => SidebarPrefs) => {
      if (!teacherId) return;
      const next = change(prefs);
      writePrefs(teacherId, next);
      setSaved({ teacherId, prefs: next });
    },
    [prefs, teacherId]
  );

  // Another tab changed them: follow along.
  useEffect(() => {
    if (!teacherId) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey(teacherId)) setSaved({ teacherId, prefs: readPrefs(teacherId) });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [teacherId]);

  return { prefs, update };
}

/**
 * Orders items by the saved keys. Items not in the saved order (new subjects)
 * come first, in their incoming order, so they are easy to spot.
 */
export function applySavedOrder<T>(items: T[], keyOf: (item: T) => string, order: string[]): T[] {
  const rank = new Map(order.map((key, i) => [key, i]));
  const unranked = items.filter((item) => !rank.has(keyOf(item)));
  const ranked = items.filter((item) => rank.has(keyOf(item))).sort((a, b) => rank.get(keyOf(a))! - rank.get(keyOf(b))!);
  return [...unranked, ...ranked];
}

/**
 * The full saved order after the visible subjects were rearranged. Subjects
 * hidden by the term filter keep their slots; the visible ones fill their own
 * slots in the new order.
 */
export function mergeVisibleOrder(saved: string[], visibleBefore: string[], visibleAfter: string[]): string[] {
  const known = new Set(saved);
  const full = [...visibleBefore.filter((key) => !known.has(key)), ...saved];
  const visible = new Set(visibleAfter);
  let next = 0;
  return full.map((key) => (visible.has(key) ? visibleAfter[next++] : key));
}
