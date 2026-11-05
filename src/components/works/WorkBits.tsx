'use client';

import { useState } from 'react';
import { BellRing, Calendar, Check, Loader2, X } from 'lucide-react';
import type { Assignment } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { GradingBar } from '@/components/AssignmentProgressCard';
import { AttachmentList } from '@/components/AssignmentAttachments';
import { DateTimeField } from '@/components/DateTimeField';
import { ModalSheet, ModalSheetBody, ModalSheetFooter, ModalSheetHeader } from '@/components/ModalSheet';
import { assignmentAttachments } from '@/lib/utils/referenceWork';
import { ASSIGNMENT_STATUS_CLASSES, getAssignmentStatus } from '@/lib/utils/assignmentWindow';
import { formatDateTime } from '@/lib/utils/datetime';
import { assignmentGroupLabel } from '@/components/AssignmentGroupHeader';
import type { WorkClass, WorkGroup, WorkTotals } from '@/lib/utils/workGroups';

/** "12 พ.ย. 23:59" — short enough for a row. */
export function shortDate(ms: number | string | null | undefined, language: string) {
  if (ms == null || ms === '') return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const locale = language === 'th' ? 'th-TH' : 'en-GB';
  const date = d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} ${time}`;
}

export type Tone = 'slate' | 'sky' | 'emerald' | 'amber' | 'rose';
export const TONE_CLASSES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
};

export function Pill({ tone, children, className = '' }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}>{children}</span>;
}

/** New deadline for one class, or for every class of the work. */
export function DueDateDialog({
  target,
  siblings,
  onClose,
  onSave,
}: {
  target: WorkClass;
  /** The work's other classes (offered as "all classes"). */
  siblings: WorkClass[];
  onClose: () => void;
  onSave: (due: string, all: boolean) => Promise<void>;
}) {
  const { tr } = useLanguage();
  const current = target.window.deadline != null ? new Date(target.window.deadline).toISOString() : target.assignment.due_date;
  const [due, setDue] = useState(current);
  const [all, setAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const others = siblings.filter((s) => s.assignment.id !== target.assignment.id);

  const save = async () => {
    if (!due) return;
    setSaving(true);
    setError('');
    try {
      await onSave(due, all);
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : tr('บันทึกไม่สำเร็จ', 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalSheet onClose={onClose} size="sm:max-w-md">
      <ModalSheetHeader>
        <div className="min-w-0">
          <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-500" />
            {tr('เปลี่ยนกำหนดส่ง', 'Change due date')}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {target.assignment.title} · {target.classroom.name}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={tr('ปิด', 'Close')} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer">
          <X className="w-5 h-5" />
        </button>
      </ModalSheetHeader>
      <ModalSheetBody className="space-y-4">
        <DateTimeField value={due} onChange={setDue} />
        {others.length > 0 && (
          <label className="flex items-center gap-2.5 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="w-4 h-4 accent-amber-500" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {tr(`ใช้กับทุกห้อง (${others.length + 1} ห้อง)`, `Apply to all ${others.length + 1} classes`)}
            </span>
          </label>
        )}
        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
      </ModalSheetBody>
      <ModalSheetFooter>
        <button type="button" onClick={onClose} className="h-10 px-4 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
          {tr('ยกเลิก', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !due}
          className="h-10 px-5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-xs font-black inline-flex items-center gap-1.5 cursor-pointer"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {tr('บันทึก', 'Save')}
        </button>
      </ModalSheetFooter>
    </ModalSheet>
  );
}

/** What the work is and where it stands in each class. */
export function WorkDetailSheet({ group, courseLabel, onClose }: { group: WorkGroup; courseLabel?: string; onClose: () => void }) {
  const { tr, language } = useLanguage();
  const th = language === 'th';
  const a: Assignment = group.rep;
  const attachments = assignmentAttachments(a);
  return (
    <ModalSheet onClose={onClose} size="sm:max-w-lg">
      <ModalSheetHeader>
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-slate-400 truncate">
            {[courseLabel, assignmentGroupLabel(group.category, th), a.is_exam ? tr('ข้อสอบ', 'Quiz') : tr('การบ้าน', 'Assignment')].filter(Boolean).join(' · ')}
          </p>
          <h3 className="text-base font-black text-slate-900 dark:text-white wrap-break-word">{a.title}</h3>
        </div>
        <button type="button" onClick={onClose} aria-label={tr('ปิด', 'Close')} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer shrink-0">
          <X className="w-5 h-5" />
        </button>
      </ModalSheetHeader>
      <ModalSheetBody className="space-y-5">
        {a.description?.trim() && <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{a.description}</p>}
        <AttachmentList attachments={attachments} size="sm" />
        <div className="space-y-2">
          <p className="text-xs font-black text-slate-900 dark:text-white">{tr(`ห้องเรียน (${group.classes.length})`, `Classes (${group.classes.length})`)}</p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
            {group.classes.map((c) => {
              const status = getAssignmentStatus(c.window, c.assignment.is_exam, language === 'th' ? 'th' : 'en');
              return (
                <li key={c.assignment.id} className="p-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{c.classroom.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {c.window.deadline != null ? `${a.is_exam ? tr('ปิดรับ', 'Closes') : tr('ส่ง', 'Due')} ${formatDateTime(new Date(c.window.deadline).toISOString(), language)}` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-black ${ASSIGNMENT_STATUS_CLASSES[status.tone]}`}>{status.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
        {a.created_at && (
          <p className="text-[11px] text-slate-400">
            {tr('สร้างเมื่อ', 'Created')} {formatDateTime(a.created_at, language)}
          </p>
        )}
      </ModalSheetBody>
    </ModalSheet>
  );
}

/**
 * One line of numbers shared by category, work and class rows: handed in,
 * checked, and a short bar with the checked share as a percentage.
 * Fixed widths from `sm` up, so the columns line up row after row.
 */
export function MetricCells({ totals }: { totals: WorkTotals }) {
  const { tr } = useLanguage();
  const { handedIn, totalStudents, graded, checkable, pending, notSubmitted } = totals;
  const percent = totalStudents > 0 ? Math.round((graded / totalStudents) * 100) : 0;
  // One line each, same height, so every row's numbers sit on the same line.
  const cell = (label: string, value: number, of: number, strong: boolean) => (
    <span className="@4xl:w-21 shrink-0 h-9 inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
      <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">{label}</span>
      <span className={`text-sm font-black ${strong ? 'text-amber-700 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>{value}</span>
      <span className="text-[11px] font-semibold text-slate-400">/{of}</span>
    </span>
  );
  return (
    <>
      {cell(tr('ส่ง', 'In'), handedIn, totalStudents, false)}
      {cell(tr('ตรวจ', 'Checked'), graded, checkable, pending > 0)}
      <span className="h-9 flex items-center gap-2 flex-1 min-w-20 @4xl:flex-none @4xl:w-28" title={tr(`ตรวจแล้ว ${percent}% ของนักเรียนทั้งหมด`, `${percent}% of students checked`)}>
        <span className="flex-1 min-w-0">
          <GradingBar graded={graded} pending={pending} notSubmitted={notSubmitted} />
        </span>
        <span className={`w-9 text-right text-xs font-black tabular-nums ${percent === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>{percent}%</span>
      </span>
    </>
  );
}

/** Right padding per level, so a work's numbers line up with its classes' (cards nest 13 px further in). */
/**
 * "ทวงงาน" beside "ตรวจงาน": how many students have not handed in sits in the
 * button's top-right corner (part of the button, not a separate badge).
 */
export function RemindButton({ missing, onClick, title }: { missing: number; onClick: () => void; title?: string }) {
  const { tr } = useLanguage();
  return (
    <button
      type="button"
      draggable={false}
      onClick={onClick}
      title={title || tr(`ทวงงานในกลุ่ม LINE • ยังไม่ส่ง ${missing} คน`, `Remind in the LINE group • ${missing} not handed in`)}
      className="relative h-9 pl-2.5 pr-6 rounded-xl text-xs font-black inline-flex items-center gap-1 whitespace-nowrap bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900 cursor-pointer transition-colors"
    >
      <BellRing className="w-3.5 h-3.5 shrink-0" />
      {tr('ทวงงาน', 'Remind')}
      <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] leading-4 text-center tabular-nums">
        {missing > 99 ? '99+' : missing}
      </span>
    </button>
  );
}

export const ROW_INSET = {
  /** Class rows sit one border + 12 px padding further in. */
  work: '@4xl:pr-[13px]',
  class: '',
} as const;

/**
 * Row skeleton: [lead] [status] [numbers + action] [menu]. From `sm` up it is
 * one line; on phones the numbers drop to a second line under the name.
 */
export function WorkRowLayout({
  lead,
  status,
  metrics,
  action,
  menu,
  inset = '',
}: {
  lead: React.ReactNode;
  status?: React.ReactNode;
  metrics?: React.ReactNode;
  action?: React.ReactNode;
  menu?: React.ReactNode;
  /** ROW_INSET for the level, so columns line up across levels. */
  inset?: string;
}) {
  // Wide board (container ≥ 56rem): one line. The status sits right after the
  // name; numbers, button and ⋯ keep fixed widths at the right so they line up.
  // Narrow: name + ⋯ / status + button / numbers.
  return (
    <div className={`flex flex-wrap @4xl:flex-nowrap items-center gap-x-3 gap-y-1.5 ${inset}`}>
      <div className="order-1 basis-[calc(100%-3rem)] @4xl:basis-auto min-w-0 flex-1 @4xl:flex-initial min-h-9 flex items-center">{lead}</div>
      <div className="order-2 @4xl:order-6 shrink-0 w-9 h-9 flex items-center justify-end">{menu}</div>
      {status && <div className="order-3 @4xl:order-2 min-w-0 shrink-0 h-9 flex items-center">{status}</div>}
      <div aria-hidden className="hidden @4xl:block @4xl:order-3 flex-1" />
      <div className="order-4 @4xl:order-5 ml-auto @4xl:ml-0 shrink-0 @4xl:w-48 h-9 flex items-center justify-end gap-1.5">{action}</div>
      <div className="order-5 @4xl:order-4 basis-full @4xl:basis-auto @4xl:w-76 shrink-0 min-w-0 h-9 flex items-center gap-3">{metrics}</div>
    </div>
  );
}
