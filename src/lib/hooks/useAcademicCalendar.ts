'use client';

import { useCallback, useMemo } from 'react';
import { useUser } from '@clerk/nextjs';
import {
  DEFAULT_TERM_STARTS,
  getDefaultAcademicPeriod,
  resolveTermStarts,
  type TermStart,
} from '@/lib/utils/academicYear';

/** Where a teacher's own term dates live on their Clerk account (follows them across devices). */
const METADATA_KEY = 'termStarts';

/**
 * The signed-in teacher's academic calendar: their saved term start dates
 * (or the defaults) and the current term those dates give.
 */
export function useAcademicCalendar() {
  const { user } = useUser();
  const saved = user?.unsafeMetadata?.[METADATA_KEY];
  // Stable identity for memo deps: the metadata object is replaced on every Clerk refresh.
  const savedJson = JSON.stringify(saved ?? null);
  const termStarts = useMemo(() => resolveTermStarts(JSON.parse(savedJson)), [savedJson]);
  const isCustom = saved !== undefined && saved !== null && termStarts !== DEFAULT_TERM_STARTS;
  // Computed once per calendar change; a page left open across midnight keeps its term.
  const currentPeriod = useMemo(() => getDefaultAcademicPeriod(new Date(), termStarts), [termStarts]);

  /** Saves new dates (null = back to the defaults). */
  const saveTermStarts = useCallback(
    async (starts: ReadonlyArray<TermStart> | null) => {
      if (!user) return;
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, [METADATA_KEY]: starts ? [...starts] : null } });
    },
    [user]
  );

  return { termStarts, isCustom, currentPeriod, saveTermStarts };
}
