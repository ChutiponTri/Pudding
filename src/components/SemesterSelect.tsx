'use client';

import { Calendar } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatAcademicPeriod } from '@/lib/utils/academicYear';
import { ALL_SEMESTERS, semesterKeyOf, type SemesterKey } from '@/lib/utils/semesterFilter';

/** The term picker shared by the dashboard, classrooms and students pages. */
export function SemesterSelect({
  value,
  onChange,
  options,
  currentPeriod,
}: {
  value: SemesterKey;
  onChange: (key: SemesterKey) => void;
  options: Array<{ semester: number; yearCE: number }>;
  currentPeriod: { semester: number; yearCE: number };
}) {
  const { t, language } = useLanguage();
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
        {options.map((opt) => (
          <option key={semesterKeyOf(opt.semester, opt.yearCE)} value={semesterKeyOf(opt.semester, opt.yearCE)}>
            {formatAcademicPeriod(opt.semester, opt.yearCE, language)}{' '}
            {opt.semester === currentPeriod.semester && opt.yearCE === currentPeriod.yearCE
              ? `(${t('classroom_mgmt.fields.active_semester')})`
              : ''}
          </option>
        ))}
        <option value={ALL_SEMESTERS}>{t('classroom_mgmt.fields.all_semesters')}</option>
      </select>
    </div>
  );
}
