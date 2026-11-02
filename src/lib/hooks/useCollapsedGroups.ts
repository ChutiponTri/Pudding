'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * Which assignment categories (or other folds) the viewer collapsed, per list,
 * remembered in this browser. Open is the default, so only collapsed keys are
 * stored. Kept in step across components and tabs.
 */
const storageKey = (scope: string) => `pudding:collapsed-groups:${scope}`;

// Fallback when storage is unavailable (private mode etc.): lasts for this page only.
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readRaw(scope: string): string {
  try {
    return window.localStorage.getItem(storageKey(scope)) ?? memory.get(scope) ?? '[]';
  } catch {
    return memory.get(scope) ?? '[]';
  }
}

function writeRaw(scope: string, raw: string) {
  memory.set(scope, raw);
  try {
    window.localStorage.setItem(storageKey(scope), raw);
  } catch {
    // Kept in memory only.
  }
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith('pudding:collapsed-groups:')) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function parse(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function useCollapsedGroups(scope: string) {
  // Server and first client render: everything open, then the saved state.
  const raw = useSyncExternalStore(subscribe, () => readRaw(scope), () => '[]');
  const collapsed = useMemo(() => new Set(parse(raw)), [raw]);

  const isOpen = useCallback((key: string) => !collapsed.has(key), [collapsed]);
  const toggle = useCallback(
    (key: string) => {
      const next = new Set(parse(readRaw(scope)));
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeRaw(scope, JSON.stringify([...next]));
    },
    [scope]
  );

  return { isOpen, toggle };
}
