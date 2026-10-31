'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAcademicCalendar } from '@/lib/hooks/useAcademicCalendar';
import { semesterKeyFromParam, semesterKeyOf, type SemesterKey } from '@/lib/utils/semesterFilter';

/**
 * The term filter kept in `?term=` (so the dashboard's choice carries over and
 * "back" keeps it); defaults to the current academic period.
 */
export function useSemesterParam() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { currentPeriod } = useAcademicCalendar();
  const fallback = semesterKeyOf(currentPeriod.semester, currentPeriod.yearCE);
  const semesterKey = semesterKeyFromParam(search.get('term'), fallback);

  const setSemesterKey = (key: SemesterKey) => {
    const params = new URLSearchParams(search.toString());
    params.set('term', key);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  return { semesterKey, setSemesterKey, currentPeriod };
}
