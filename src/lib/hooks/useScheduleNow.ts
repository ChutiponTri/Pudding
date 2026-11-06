'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Assignment } from '@/types/database';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';

type Timed = Pick<Assignment, 'due_date' | 'status_override' | 'extended_until'> & Partial<Pick<Assignment, 'is_exam' | 'publish_at'>>;

// setTimeout overflows past ~24.8 days; a later boundary is re-armed when this fires.
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
// Fire just after the boundary, so every Date.now() check on the page (and the server's) agrees.
const AFTER_MS = 1000;

/**
 * "Now" for a page that shows work status (scheduled → open → late → closed).
 * Statuses are worked out from the clock, and nothing on the server changes at
 * those moments, so neither a refetch nor the session cache can flip them: the
 * page has to re-render. This re-renders exactly when the next one passes (a
 * scheduled publish time, a deadline, the end of homework's late window), and
 * every `tickMs` as well when given (for "2 days left" style text).
 */
export function useScheduleNow(assignments: ReadonlyArray<Timed> | null | undefined, tickMs?: number): number {
  const [now, setNow] = useState(() => Date.now());

  // Every boundary as a stable string, so a refetch with the same times does not re-arm the timer.
  const boundariesKey = useMemo(() => {
    const times = new Set<number>();
    for (const a of assignments || []) {
      const win = getAssignmentWindow(a);
      if (!win.isDraft && a.publish_at) times.add(new Date(a.publish_at).getTime());
      if (win.deadline != null) times.add(win.deadline);
      if (win.lateUntil != null) times.add(win.lateUntil);
    }
    return [...times].filter((t) => Number.isFinite(t)).sort((x, y) => x - y).join(',');
  }, [assignments]);

  useEffect(() => {
    const current = Date.now();
    const next = boundariesKey
      .split(',')
      .map(Number)
      .find((t) => t + AFTER_MS > current);
    if (next === undefined || !boundariesKey) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(next + AFTER_MS - current, MAX_TIMEOUT_MS));
    return () => clearTimeout(timer);
  }, [boundariesKey, now]);

  useEffect(() => {
    if (!tickMs) return;
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  // A tab left in the background may have slept through a boundary.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return now;
}
