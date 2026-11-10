'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronRight, Search, Users, X } from 'lucide-react';
import { ModalSheet, ModalSheetBody, ModalSheetFooter, ModalSheetHeader } from '@/components/ModalSheet';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export type PickStudent = { id: string; first_name?: string; last_name?: string; student_id?: string; name?: string };

export const pickStudentName = (s: PickStudent) => `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.name || s.student_id || '-';

/**
 * Who takes a quiz: everyone is ticked by default; the teacher unticks the
 * students who should not. `excluded` holds the unticked roster ids.
 */
export function StudentPickerSheet({
  students,
  excluded,
  onChange,
  onClose,
  title,
}: {
  students: PickStudent[];
  excluded: string[];
  onChange: (excluded: string[]) => void;
  onClose: () => void;
  title?: string;
}) {
  const { tr } = useLanguage();
  const [query, setQuery] = useState('');
  const out = useMemo(() => new Set(excluded), [excluded]);
  const shown = students.filter((s) => !query.trim() || `${pickStudentName(s)} ${s.student_id || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const chosen = students.length - students.filter((s) => out.has(s.id)).length;
  const toggle = (id: string) => onChange(out.has(id) ? excluded.filter((x) => x !== id) : [...excluded, id]);

  return (
    <ModalSheet onClose={onClose} size="sm:max-w-md">
      <ModalSheetHeader>
        <div className="min-w-0">
          <h3 className="text-base font-black text-slate-900 dark:text-white truncate">{title || tr('นักเรียนที่ทำแบบทดสอบ', 'Who takes this quiz')}</h3>
          <p className="text-[11px] text-slate-500">{tr(`เลือก ${chosen}/${students.length} คน`, `${chosen}/${students.length} chosen`)}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={tr('ปิด', 'Close')} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer shrink-0">
          <X className="w-5 h-5" />
        </button>
      </ModalSheetHeader>
      <ModalSheetBody className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr('ค้นหาชื่อ', 'Search')}
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
            />
          </label>
          <button
            type="button"
            onClick={() => onChange(chosen === students.length ? students.map((s) => s.id) : [])}
            className="shrink-0 h-10 px-3 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            {chosen === students.length ? tr('เอาออกทั้งหมด', 'None') : tr('เลือกทั้งหมด', 'All')}
          </button>
        </div>
        {students.length === 0 && <p className="text-center text-sm text-slate-400 py-6">{tr('ยังไม่มีนักเรียนในห้อง', 'No students yet')}</p>}
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {shown.map((s) => {
            const on = !out.has(s.id);
            return (
              <li key={s.id}>
                <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(s.id)} className="w-full py-2.5 flex items-center gap-3 text-left cursor-pointer">
                  <span
                    className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                      on ? 'bg-amber-500 text-slate-950' : 'border-2 border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    {on && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-sm ${on ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-400 line-through'}`}>{pickStudentName(s)}</span>
                  {s.student_id && <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{s.student_id}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </ModalSheetBody>
      <ModalSheetFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={students.length > 0 && chosen === 0}
          className="h-10 px-5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-xs font-black cursor-pointer"
        >
          {chosen === 0 && students.length > 0 ? tr('เลือกอย่างน้อย 1 คน', 'Pick at least 1') : tr('เสร็จ', 'Done')}
        </button>
      </ModalSheetFooter>
    </ModalSheet>
  );
}

/** The small underlined link that opens the picker: "ทุกคน (30)" or "12/30 คน". */
export function StudentPickLink({ total, excludedCount, onClick }: { total: number; excludedCount: number; onClick: () => void }) {
  const { tr } = useLanguage();
  const chosen = Math.max(0, total - excludedCount);
  const everyone = excludedCount === 0;
  // A real button (not a text link): who takes the quiz is easy to miss otherwise.
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full sm:w-auto min-h-11 inline-flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 text-left text-xs font-bold cursor-pointer transition-colors ${
        everyone
          ? 'border-dashed border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/70'
          : 'border-amber-500 bg-amber-500 text-slate-950 hover:bg-amber-400'
      }`}
    >
      <Users className="w-4 h-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block leading-tight">
          {everyone ? tr(`นักเรียนที่ทำ: ทุกคน (${total} คน)`, `Who takes it: everyone (${total})`) : tr(`นักเรียนที่ทำ: ${chosen}/${total} คน`, `Who takes it: ${chosen}/${total}`)}
        </span>
        <span className={`block text-[10px] font-semibold leading-tight ${everyone ? 'text-amber-700 dark:text-amber-300' : 'text-slate-900/70'}`}>
          {everyone ? tr('แตะเพื่อเลือกเฉพาะบางคน', 'Tap to choose only some students') : tr('แตะเพื่อแก้ไขรายชื่อ', 'Tap to edit the list')}
        </span>
      </span>
      <ChevronRight className="w-4 h-4 shrink-0 opacity-70" />
    </button>
  );
}
