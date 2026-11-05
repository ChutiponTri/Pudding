'use client';

import { useSyncExternalStore } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatAcademicPeriod, getSemesterShortLabel } from '@/lib/utils/academicYear';
import { ALL_SEMESTERS, semesterKeyOf, type SemesterKey } from '@/lib/utils/semesterFilter';

const PHONE_QUERY = '(max-width: 639.98px)';
function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
/** True below Tailwind's `sm` breakpoint (false on the server). */
function useIsPhone() {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}

/** The term picker shared by the dashboard, classrooms and students pages. */
export function SemesterSelect({
  value,
  onChange,
  options,
  currentPeriod,
  compact = false,
  dense = false,
}: {
  value: SemesterKey;
  onChange: (key: SemesterKey) => void;
  options: Array<{ semester: number; yearCE: number }>;
  currentPeriod: { semester: number; yearCE: number };
  /** Full-width with the label folded into the field, for narrow panels such as the sidebar. */
  compact?: boolean;
  /** On phones: a small field with the short term names ("เทอม 2 / 2569"). Wider screens are unchanged. */
  dense?: boolean;
}) {
  const { t, tr, language } = useLanguage();
  const isPhone = useIsPhone();
  const short = compact || (dense && isPhone);
  // Narrow panels get "เทอม 2 / 2569 • ปัจจุบัน" instead of the long form, so it never truncates.
  const label = (semester: number, yearCE: number) =>
    short
      ? `${getSemesterShortLabel(semester, language)} / ${language === 'th' ? yearCE + 543 : yearCE}`
      : formatAcademicPeriod(semester, yearCE, language);
  const items = (
    <>
      {options.map((opt) => {
        const isCurrent = opt.semester === currentPeriod.semester && opt.yearCE === currentPeriod.yearCE;
        return (
          <option key={semesterKeyOf(opt.semester, opt.yearCE)} value={semesterKeyOf(opt.semester, opt.yearCE)}>
            {label(opt.semester, opt.yearCE)}
            {isCurrent ? (short ? ` • ${tr('ปัจจุบัน', 'current')}` : ` (${t('classroom_mgmt.fields.active_semester')})`) : ''}
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

  const select = (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t('classroom_mgmt.fields.filter_semester_label')}
      className="w-full sm:w-auto h-10 px-3 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-amber-500 cursor-pointer shadow-xs"
    >
      {items}
    </select>
  );

  // Phones force <select> text to 16px (so iOS does not zoom); the dense phone
  // field shows its own small label with the real select invisible on top.
  if (dense && isPhone) {
    const selected = options.find((opt) => semesterKeyOf(opt.semester, opt.yearCE) === value);
    const isCurrent = selected && selected.semester === currentPeriod.semester && selected.yearCE === currentPeriod.yearCE;
    return (
      <div className="relative min-w-0 h-8 pl-2.5 pr-7 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xs flex items-center gap-1.5 text-[11px] font-bold text-slate-800 dark:text-slate-200 focus-within:border-amber-500">
        <Calendar className="w-3.5 h-3.5 shrink-0 text-amber-500" aria-hidden="true" />
        <span aria-hidden className="truncate">
          {selected
            ? `${label(selected.semester, selected.yearCE)}${isCurrent ? ` • ${tr('ปัจจุบัน', 'current')}` : ''}`
            : t('classroom_mgmt.fields.all_semesters')}
        </span>
        <ChevronDown className="w-3.5 h-3.5 absolute right-2 text-slate-400 pointer-events-none" aria-hidden="true" />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={t('classroom_mgmt.fields.filter_semester_label')}
          className="absolute inset-0 w-full h-full opacity-0 appearance-none cursor-pointer"
        >
          {items}
        </select>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold hidden sm:inline shrink-0">
        <Calendar className="w-3.5 h-3.5 inline mr-1 text-amber-500" />
        {t('classroom_mgmt.fields.filter_semester_label')}:
      </span>
      {select}
    </div>
  );
}
