'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useTeacherDashboardData } from '@/lib/hooks/useTeacherDashboardData';
import { buildWorkGroups } from '@/lib/utils/workGroups';

/**
 * On the grading page opened from the work list: one chip per classroom that
 * has the same work, so the teacher can grade every class in a row.
 */
function Tabs({ assignmentId }: { assignmentId: string }) {
  const { tr } = useLanguage();
  const search = useSearchParams();
  const { data } = useTeacherDashboardData();

  const group = useMemo(() => {
    if (!data) return null;
    const groups = buildWorkGroups(data.assignments, data.classrooms, data.courses, data.submissions);
    return groups.find((g) => g.classes.some((c) => c.assignment.id === assignmentId)) || null;
  }, [data, assignmentId]);

  const published = group?.classes.filter((c) => c.published) || [];
  if (published.length < 2) return null;
  const query = search.toString();

  return (
    <nav aria-label={tr('ห้องที่มีงานนี้', 'Classes with this work')} className="-mx-1 px-1 flex gap-1.5 overflow-x-auto scrollbar-none">
      {published.map((c) => {
        const active = c.assignment.id === assignmentId;
        return (
          <Link
            key={c.assignment.id}
            href={`/assignments/${c.assignment.id}/grading${query ? `?${query}` : ''}`}
            replace
            scroll={false}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 h-9 px-3 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-colors ${
              active
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-amber-400'
            }`}
          >
            <span className="max-w-36 truncate">{c.classroom.name}</span>
            {c.counts.pending > 0 && (
              <span className={`min-w-5 px-1 rounded-full text-[10px] font-black ${active ? 'bg-amber-400 text-slate-950' : 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'}`}>
                {c.counts.pending}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function SiblingClassTabs({ assignmentId }: { assignmentId: string }) {
  const search = useSearchParams();
  // Only from the work list, so other entry points don't load the dashboard data.
  if (search.get('from') !== 'works') return null;
  return <Tabs assignmentId={assignmentId} />;
}
