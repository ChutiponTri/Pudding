'use client';

import { Calendar, ChevronDown } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatAcademicPeriod, getSemesterShortLabel } from '@/lib/utils/academicYear';
import { ALL_SEMESTERS, semesterKeyOf, type SemesterKey } from '@/lib/utils/semesterFilter';

/** The term picker shared by the dashboard, classrooms and students pages. */
export function SemesterSelect({
  value,
  onChange,
  options,
  currentPeriod,
  compact = false,
}: {
  value: SemesterKey;
  onChange: (key: SemesterKey) => void;
  options: Array<{ semester: number; yearCE: number }>;
  currentPeriod: { semester: number; yearCE: number };
  /** Full-width with the label folded into the field, for narrow panels such as the sidebar. */
  compact?: boolean;
}) {
  const { t, tr, language } = useLanguage();
  // Narrow panels get "เทอม 2 / 2569 • ปัจจุบัน" instead of the long form, so it never truncates.
  const label = (semester: number, yearCE: number) =>
    compact
      ? `${getSemesterShortLabel(semester, language)} / ${language === 'th' ? yearCE + 543 : yearCE}`
      : formatAcademicPeriod(semester, yearCE, language);
  const items = (
    <>
      {options.map((opt) => {
        const isCurrent = opt.semester === currentPeriod.semester && opt.yearCE === currentPeriod.yearCE;
        return (
          <option key={semesterKeyOf(opt.semester, opt.yearCE)} value={semesterKeyOf(opt.semester, opt.yearCE)}>
            {label(opt.semester, opt.yearCE)}
            {isCurrent ? (compact ? ` • ${tr('ปัจจุบัน', 'current')}` : ` (${t('classroom_mgmt.fields.active_semester')})`) : ''}
          </option>
        );
      })}
      <option value={ALL_SEMESTERS}>{t('classroom_mgmt.fields.all_semesters')}</option>
    </>
  );

  if (compact) {
    return (
      <label className="relative flex items-center min-w-0 w-full">
        <span className="sr-only">{t('classroom_mgmt.fields.filter_semester_label')}</span>
        <Calendar className="w-3.5 h-3.5 absolute left-3 text-amber-500 pointer-events-none" aria-hidden="true" />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="appearance-none w-full min-w-0 h-11 lg:h-9 pl-8 pr-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 hover:border-amber-400 focus:outline-hidden focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 cursor-pointer truncate transition-colors"
        >
          {items}
        </select>
        <ChevronDown className="w-3.5 h-3.5 absolute right-3 text-slate-400 pointer-events-none" aria-hidden="true" />
      </label>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold hidden sm:inline shrink-0">
        <Calendar className="w-3.5 h-3.5 inline mr-1 text-amber-500" />
        {t('classroom_mgmt.fields.filter_semester_label')}:
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full sm:w-auto h-10 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-amber-500 cursor-pointer shadow-xs"
      >
        {items}
      </select>
    </div>
  );
}
