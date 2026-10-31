'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { dataService } from '@/lib/supabase/dataService';
import {
  getWatchedClassroomIds,
  invalidateOnApiWrites,
  invalidateSessionCache,
  onWatchedClassroomsChange,
  setCacheOwner,
  setRealtimeLive,
} from '@/lib/cache/sessionCache';

/**
 * Keeps the teacher session cache honest while the teacher moves between
 * pages: server signals for the classrooms shown so far (student joined,
 * submitted, checked in, work published…) mark it stale, and so does any write
 * this tab sends. Renders nothing.
 */
export function SessionCacheSync() {
  const { user, isLoaded } = useUser();
  const teacherId = isLoaded ? user?.id || null : undefined;
  const [watchKey, setWatchKey] = useState('');

  useEffect(() => {
    invalidateOnApiWrites();
    const update = () => setWatchKey(getWatchedClassroomIds().sort().join(','));
    update();
    return onWatchedClassroomsChange(update);
  }, []);

  // Another account (or signing out) must never see the previous teacher's data.
  useEffect(() => {
    if (teacherId !== undefined) setCacheOwner(teacherId);
  }, [teacherId]);

  useEffect(() => {
    const ids = watchKey ? watchKey.split(',') : [];
    if (!teacherId || ids.length === 0) {
      setRealtimeLive(false);
      return;
    }
    let live = false;
    let everLive = false;
    const unsubscribe = dataService.subscribeToClassroomSignals(
      ids,
      // Other tabs hear the same signal through their own subscription.
      () => invalidateSessionCache({ broadcast: false }),
      (isLive) => {
        // Back after a dropped socket: signals sent meanwhile were missed.
        if (isLive && !live && everLive) invalidateSessionCache({ broadcast: false });
        live = isLive;
        if (isLive) everLive = true;
        setRealtimeLive(isLive);
      }
    );
    return () => {
      unsubscribe();
      setRealtimeLive(false);
    };
  }, [teacherId, watchKey]);

  return null;
}
