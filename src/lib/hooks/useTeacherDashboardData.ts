'use client';

import { useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { dataService } from '@/lib/supabase/dataService';
import {
  fetchCached,
  onCacheInvalidated,
  readCache,
  TEACHER_DASHBOARD_CACHE_KEY,
  watchClassrooms,
} from '@/lib/cache/sessionCache';

export type TeacherDashboardData = Awaited<ReturnType<typeof dataService.getTeacherDashboard>>;

/**
 * The teacher's courses, classrooms (with rosters), work and submissions —
 * the same session-cached data as the dashboard. Shows the cached copy at
 * once, fetches only when it may be out of date, and refetches while the page
 * is open whenever something changes (a student joins, an edit is saved…).
 */
export function useTeacherDashboardData() {
  const { user } = useUser();
  const teacherId = user?.id;
  const [data, setData] = useState<TeacherDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!teacherId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const load = async (useCache: boolean) => {
      const seq = ++seqRef.current;
      if (useCache) {
        const hit = readCache<TeacherDashboardData>(TEACHER_DASHBOARD_CACHE_KEY, teacherId);
        if (hit) {
          setData(hit.value);
          setLoading(false);
          if (hit.fresh) return;
        }
      }
      try {
        const next = await fetchCached(TEACHER_DASHBOARD_CACHE_KEY, teacherId, () => dataService.getTeacherDashboard());
        if (cancelled || seq !== seqRef.current) return;
        setData(next);
        setError(false);
        watchClassrooms(next.classrooms.map((c) => c.id));
      } catch (err) {
        console.error('Failed to load teacher data:', err);
        if (!cancelled && seq === seqRef.current) setError(true);
      } finally {
        if (!cancelled && seq === seqRef.current) setLoading(false);
      }
    };

    load(true);
    // Changes often come in bursts (realtime signal + local write); refetch once.
    const unsubscribe = onCacheInvalidated(() => {
      clearTimeout(timer);
      timer = setTimeout(() => load(false), 600);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
      cancelled = true;
    };
  }, [teacherId]);

  return { data, loading: loading || !teacherId, error, teacherId };
}
