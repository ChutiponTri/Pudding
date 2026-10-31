'use client';

import { useState } from 'react';
import { CalendarCog, Loader2, RotateCcw, X } from 'lucide-react';
import { ModalSheet, ModalSheetBody, ModalSheetFooter, ModalSheetHeader } from '@/components/ModalSheet';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useAcademicCalendar } from '@/lib/hooks/useAcademicCalendar';
import {
  DEFAULT_TERM_STARTS,
  daysInMonth,
  getDefaultAcademicPeriod,
  getSemesterShortLabel,
  termEnd,
  termStartsProblem,
  type TermStart,
} from '@/lib/utils/academicYear';

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const selectClass =
  'h-10 px-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-amber-500 cursor-pointer';

/** Popup where a teacher sets the first day of term 1, term 2 and summer. */
export function TermDatesSettings({ onClose }: { onClose: () => void }) {
  const { tr, language } = useLanguage();
  const { termStarts, saveTermStarts } = useAcademicCalendar();
  const [draft, setDraft] = useState<TermStart[]>(() => termStarts.map((term) => ({ ...term })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const months = language === 'th' ? TH_MONTHS : EN_MONTHS;
  const dateLabel = (month: number, day: number) => `${day} ${months[month - 1]}`;
  const problem = termStartsProblem(draft, language);
  const preview = problem ? null : getDefaultAcademicPeriod(new Date(), draft);

  const setTerm = (index: number, patch: Partial<TermStart>) =>
    setDraft((current) =>
      current.map((term, i) => {
        if (i !== index) return term;
        const next = { ...term, ...patch };
        // Keep the day valid when switching to a shorter month.
        return { ...next, day: Math.min(next.day, daysInMonth(next.month)) };
      })
    );

  const save = async () => {
    if (problem) return;
    setSaving(true);
    setError('');
    try {
      const isDefault = draft.every(
        (term, i) => term.month === DEFAULT_TERM_STARTS[i].month && term.day === DEFAULT_TERM_STARTS[i].day
      );
      await saveTermStarts(isDefault ? null : draft);
      onClose();
    } catch (err) {
      console.error('Save term dates failed:', err);
      setError(tr('บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง', 'Save failed, please try again'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalSheet onClose={onClose} size="sm:max-w-md" zIndex="z-[60]" labelledBy="term-dates-title">
      <ModalSheetHeader>
        <div className="flex items-center gap-2 min-w-0">
          <CalendarCog className="w-5 h-5 text-amber-500 shrink-0" />
          <h3 id="term-dates-title" className="text-base font-bold text-slate-900 dark:text-white">
            {tr('วันเปิดภาคเรียน', 'Term dates')}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={tr('ปิด', 'Close')}
          className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </ModalSheetHeader>

      <ModalSheetBody className="space-y-4">
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          {tr(
            'ใช้เลือกภาคเรียนปัจจุบันให้อัตโนมัติ ปีการศึกษาเริ่มที่วันเปิดภาคเรียนที่ 1 แต่ละภาคเรียนสิ้นสุดก่อนวันเริ่มของภาคถัดไป 1 วัน',
            'Used to pick the current term automatically. The academic year starts on term 1’s first day; each term ends the day before the next one starts.'
          )}
        </p>

        <div className="space-y-2">
          {draft.map((term, index) => {
            const end = termEnd(draft, index);
            return (
              <div
                key={term.semester}
                className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center gap-x-3 gap-y-2"
              >
                <span className="w-16 shrink-0 text-xs font-black text-slate-900 dark:text-white">
                  {getSemesterShortLabel(term.semester, language)}
                </span>
                <div className="flex items-center gap-1.5">
                  <label className="sr-only" htmlFor={`term-${term.semester}-day`}>{tr('วันที่', 'Day')}</label>
                  <select
                    id={`term-${term.semester}-day`}
                    value={term.day}
                    onChange={(e) => setTerm(index, { day: Number(e.target.value) })}
                    className={selectClass}
                  >
                    {Array.from({ length: daysInMonth(term.month) }, (_, i) => i + 1).map((day) => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor={`term-${term.semester}-month`}>{tr('เดือน', 'Month')}</label>
                  <select
                    id={`term-${term.semester}-month`}
                    value={term.month}
                    onChange={(e) => setTerm(index, { month: Number(e.target.value) })}
                    className={selectClass}
                  >
                    {months.map((name, i) => (
                      <option key={name} value={i + 1}>{name}</option>
                    ))}
                  </select>
                </div>
                {!problem && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 ml-auto">
                    {tr('ถึง', 'to')} {dateLabel(end.month, end.day)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {problem ? (
          <p className="text-xs font-bold text-rose-600">{problem}</p>
        ) : (
          preview && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {tr('วันนี้อยู่ใน', 'Today falls in')}{' '}
              <b className="text-slate-900 dark:text-white">
                {getSemesterShortLabel(preview.semester, language)} / {language === 'th' ? preview.yearBE : preview.yearCE}
              </b>
            </p>
          )
        )}
        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
      </ModalSheetBody>

      <ModalSheetFooter className="justify-between">
        <button
          type="button"
          onClick={() => setDraft(DEFAULT_TERM_STARTS.map((term) => ({ ...term })))}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {tr('ค่าเริ่มต้น', 'Defaults')}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            {tr('ยกเลิก', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={Boolean(problem) || saving}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {tr('บันทึก', 'Save')}
          </button>
        </div>
      </ModalSheetFooter>
    </ModalSheet>
  );
}
