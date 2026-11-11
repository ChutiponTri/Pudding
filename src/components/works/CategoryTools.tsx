'use client';

import { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import type { Assignment } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { ModalSheet, ModalSheetBody, ModalSheetFooter, ModalSheetHeader } from '@/components/ModalSheet';
import { getAssignmentWindow, isAssignmentPublished } from '@/lib/utils/assignmentWindow';
import type { GradingCounts } from '@/lib/utils/gradingStatus';
import { WORK_COLOR_CLASSES, type WorkColor } from '@/lib/hooks/useWorkPrefs';

/** A classwork category card: neutral by default (clear border, grey header), or the colour the teacher picked. */
export function categoryLook(color?: WorkColor | null) {
  if (!color) {
    return { bar: '', head: 'bg-slate-100 dark:bg-slate-800/80', border: 'border-slate-300 dark:border-slate-700' };
  }
  const borders: Record<WorkColor, string> = {
    amber: 'border-amber-300 dark:border-amber-800/70',
    rose: 'border-rose-300 dark:border-rose-800/70',
    violet: 'border-violet-300 dark:border-violet-800/70',
    sky: 'border-sky-300 dark:border-sky-800/70',
    emerald: 'border-emerald-300 dark:border-emerald-800/70',
    slate: 'border-slate-400 dark:border-slate-600',
  };
  return { bar: WORK_COLOR_CLASSES[color].bar, head: WORK_COLOR_CLASSES[color].tint, border: borders[color] };
}

/** What a category holds: how many works, how they stand, how grading is going. */
export function CategoryDetailSheet({
  title,
  items,
  onClose,
}: {
  title: string;
  items: Array<{ assignment: Assignment; counts: GradingCounts }>;
  onClose: () => void;
}) {
  const { tr } = useLanguage();
  const quizzes = items.filter((i) => i.assignment.is_exam).length;
  const hidden = items.filter((i) => !isAssignmentPublished(i.assignment)).length;
  const open = items.filter((i) => getAssignmentWindow(i.assignment).acceptsSubmissions).length;
  const published = items.filter((i) => isAssignmentPublished(i.assignment));
  const pending = published.reduce((n, i) => n + i.counts.pending, 0);
  // A group counts once; the students it covers in brackets.
  const pendingItems = published.reduce((n, i) => n + i.counts.pendingItems, 0);
  const done = published.filter((i) => i.counts.pending === 0 && i.counts.notSubmitted === 0 && i.counts.totalStudents > 0).length;
  const tiles: Array<[string, number | string]> = [
    [tr('งานทั้งหมด', 'Items'), items.length],
    [tr('การบ้าน', 'Homework'), items.length - quizzes],
    [tr('ข้อสอบ', 'Quizzes'), quizzes],
    [tr('เปิดรับอยู่', 'Open'), open],
    [tr('ยังไม่เผยแพร่', 'Not published'), hidden],
    [tr('ตรวจครบแล้ว', 'Fully graded'), done],
    [tr('รอตรวจ (ชิ้น)', 'To grade'), pendingItems === pending ? pending : `${pendingItems} (${pending} ${tr('คน', 'st.')})`],
  ];
  return (
    <ModalSheet onClose={onClose} size="sm:max-w-md">
      <ModalSheetHeader>
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-400">{tr('หมวดหมู่', 'Category')}</p>
          <h3 className="text-base font-black text-slate-900 dark:text-white truncate">{title}</h3>
        </div>
        <button type="button" onClick={onClose} aria-label={tr('ปิด', 'Close')} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer shrink-0">
          <X className="w-5 h-5" />
        </button>
      </ModalSheetHeader>
      <ModalSheetBody className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {tiles.map(([label, value]) => (
            <div key={label} className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
              <span className="block text-[11px] font-bold text-slate-500 dark:text-slate-400">{label}</span>
              <span className="text-xl font-black text-slate-900 dark:text-white tabular-nums">{value}</span>
            </div>
          ))}
        </div>
        {items.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
            {items.map(({ assignment, counts }) => (
              <li key={assignment.id} className="px-3 py-2 flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-bold text-slate-800 dark:text-slate-100">{assignment.title}</span>
                <span className="shrink-0 text-[11px] font-semibold text-slate-500 tabular-nums">
                  {tr(`ส่ง ${counts.handedIn}/${counts.totalStudents}`, `${counts.handedIn}/${counts.totalStudents} in`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ModalSheetBody>
    </ModalSheet>
  );
}

/** New name for a category; every work in it moves to the new name. */
export function RenameCategoryDialog({
  current,
  count,
  onClose,
  onSave,
}: {
  current: string;
  count: number;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const { tr } = useLanguage();
  const [name, setName] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    const clean = name.trim();
    if (!clean || clean === current) {
      onClose();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(clean);
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : tr('บันทึกไม่สำเร็จ', 'Could not save'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalSheet onClose={onClose} size="sm:max-w-md">
      <form
        className="flex flex-col flex-1 min-h-0"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <ModalSheetHeader>
          <h3 className="text-base font-black text-slate-900 dark:text-white">{tr('แก้ไขหมวดหมู่', 'Edit category')}</h3>
          <button type="button" onClick={onClose} aria-label={tr('ปิด', 'Close')} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </ModalSheetHeader>
        <ModalSheetBody className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{tr('ชื่อหมวดหมู่', 'Category name')}</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="w-full h-11 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
            />
          </label>
          {count > 0 && (
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {tr(`งานในหมวดนี้ ${count} งานจะย้ายไปชื่อใหม่ นักเรียนเห็นชื่อใหม่ทันที`, `The ${count} items in it move to the new name; students see it at once`)}
            </p>
          )}
          {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
        </ModalSheetBody>
        <ModalSheetFooter>
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            {tr('ยกเลิก', 'Cancel')}
          </button>
          <button type="submit" disabled={saving} className="h-10 px-5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-xs font-black inline-flex items-center gap-1.5 cursor-pointer">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {tr('บันทึก', 'Save')}
          </button>
        </ModalSheetFooter>
      </form>
    </ModalSheet>
  );
}
