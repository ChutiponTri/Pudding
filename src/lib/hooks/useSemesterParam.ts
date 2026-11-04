'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useAcademicCalendar } from '@/lib/hooks/useAcademicCalendar';
import { semesterKeyFromParam, semesterKeyOf, type SemesterKey } from '@/lib/utils/semesterFilter';

/**
 * The term filter kept in `?term=` (so the dashboard's choice carries over and
 * "back" keeps it); defaults to the current academic period.
 */
export function useSemesterParam() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { currentPeriod } = useAcademicCalendar();
  const fallback = semesterKeyOf(currentPeriod.semester, currentPeriod.yearCE);
  const semesterKey = semesterKeyFromParam(search.get('term'), fallback);

  // Updates the URL without a navigation (no server round trip); useSearchParams follows it.
  const setSemesterKey = (key: SemesterKey) => {
    const params = new URLSearchParams(window.location.search);
    params.set('term', key);
    window.history.replaceState(window.history.state, '', `${pathname}?${params}`);
  };

  return { semesterKey, setSemesterKey, currentPeriod };
}
