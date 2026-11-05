'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@clerk/nextjs';

/**
 * The work list's personal layout: the order of works and card colours. Kept on
 * the teacher's Clerk account (like their term dates), so it follows them to
 * every device. Changes show at once and are saved in the background.
 */
const METADATA_KEY = 'workPrefs';
/** Clerk metadata is small (8 KB for all keys): keep only what is in use. */
const MAX_COLORS = 100;
const MAX_ORDER = 160;

/**
 * Assignment ids are stored without their "assign-" prefix to save space.
 * Older ids are only "assign-<time>" (no random suffix), so a bare number of
 * 10+ digits is one too; missing it lost those works' place on every load.
 */
const compact = (id: string) => (id.startsWith('assign-') ? id.slice(7) : id);
const expand = (id: string) => (/^\d{10,}(-|$)/.test(id) ? `assign-${id}` : id);

export const WORK_COLORS = ['amber', 'rose', 'violet', 'sky', 'emerald', 'slate'] as const;
export type WorkColor = (typeof WORK_COLORS)[number];

type WorkPrefs = { order: string[]; colors: Record<string, WorkColor> };

function parse(raw: unknown): WorkPrefs {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<WorkPrefs>;
  const order = Array.isArray(value.order) ? value.order.filter((k): k is string => typeof k === 'string').map((k) => expand(k.split('~')[0])) : [];
  const colors: Record<string, WorkColor> = {};
  if (value.colors && typeof value.colors === 'object') {
    for (const [k, v] of Object.entries(value.colors)) {
      if ((WORK_COLORS as readonly string[]).includes(v as string)) colors[expand(k)] = v as WorkColor;
    }
  }
  return { order, colors };
}

export function useWorkPrefs() {
  const { user } = useUser();
  const savedJson = JSON.stringify(user?.unsafeMetadata?.[METADATA_KEY] ?? null);
  const saved = useMemo(() => parse(JSON.parse(savedJson)), [savedJson]);
  // Local edits win until Clerk returns the saved copy.
  const [local, setLocal] = useState<{ base: string; prefs: WorkPrefs } | null>(null);
  const prefs = local && local.base === savedJson ? local.prefs : saved;
  const latest = useRef(prefs);
  useEffect(() => {
    latest.current = prefs;
  }, [prefs]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const commit = useCallback(
    (next: WorkPrefs) => {
      setLocal({ base: savedJson, prefs: next });
      latest.current = next;
      if (!user) return;
      clearTimeout(saveTimer.current);
      // Several quick changes (drag, colour taps) save once.
      saveTimer.current = setTimeout(() => {
        const value = latest.current;
        const colorEntries = Object.entries(value.colors).slice(-MAX_COLORS).map(([k, v]) => [compact(k), v]);
        user
          .update({
            unsafeMetadata: {
              ...user.unsafeMetadata,
              [METADATA_KEY]: { order: value.order.slice(0, MAX_ORDER).map(compact), colors: Object.fromEntries(colorEntries) },
            },
          })
          .catch((err) => console.warn('Saving work list layout failed:', err));
      }, 500);
    },
    [user, savedJson]
  );

  /** New order for some works (e.g. one tab's); the others keep their place after them. */
  const setOrder = useCallback(
    (keys: string[]) => {
      // Entries are "<id>~<state>": replace any older entry of the same work.
      const idOf = (k: string) => k.split('~')[0];
      const ids = new Set(keys.map(idOf));
      const rest = latest.current.order.filter((k) => !ids.has(idOf(k)));
      commit({ ...latest.current, order: [...keys, ...rest] });
    },
    [commit]
  );

  /** `live`: group ids still on the list, so colours of deleted work are dropped. */
  const setColor = useCallback(
    (id: string, color: WorkColor | null, live?: Set<string>) => {
      const colors = Object.fromEntries(Object.entries(latest.current.colors).filter(([k]) => k !== id && (!live || live.has(k))));
      if (color) colors[id] = color;
      commit({ ...latest.current, colors });
    },
    [commit]
  );

  return { order: prefs.order, colors: prefs.colors, setOrder, setColor };
}

/** Card accents per colour: left bar, soft tint, swatch. */
export const WORK_COLOR_CLASSES: Record<WorkColor, { bar: string; tint: string; swatch: string; label: [string, string] }> = {
  amber: { bar: 'bg-amber-400', tint: 'bg-amber-50/70 dark:bg-amber-950/20', swatch: 'bg-amber-400', label: ['เหลือง', 'Amber'] },
  rose: { bar: 'bg-rose-400', tint: 'bg-rose-50/70 dark:bg-rose-950/20', swatch: 'bg-rose-400', label: ['ชมพู', 'Rose'] },
  violet: { bar: 'bg-violet-400', tint: 'bg-violet-50/70 dark:bg-violet-950/20', swatch: 'bg-violet-400', label: ['ม่วง', 'Violet'] },
  sky: { bar: 'bg-sky-400', tint: 'bg-sky-50/70 dark:bg-sky-950/20', swatch: 'bg-sky-400', label: ['ฟ้า', 'Sky'] },
  emerald: { bar: 'bg-emerald-400', tint: 'bg-emerald-50/70 dark:bg-emerald-950/20', swatch: 'bg-emerald-400', label: ['เขียว', 'Green'] },
  slate: { bar: 'bg-slate-400', tint: 'bg-slate-100/70 dark:bg-slate-800/40', swatch: 'bg-slate-400', label: ['เทา', 'Grey'] },
};
