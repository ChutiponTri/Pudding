'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BellRing, Calendar, Check, Loader2, Megaphone, X } from 'lucide-react';
import type { Assignment } from '@/types/database';
import type { GradingCounts } from '@/lib/utils/gradingStatus';
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
    <span className="@lg:w-16 @4xl:w-21 shrink-0 h-9 inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
      <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">{label}</span>
      <span className={`text-sm font-black ${strong ? 'text-amber-700 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>{value}</span>
      <span className="text-[11px] font-semibold text-slate-400">/{of}</span>
    </span>
  );
  return (
    <>
      {cell(tr('ส่ง', 'In'), handedIn, totalStudents, false)}
      {cell(tr('ตรวจ', 'Checked'), graded, checkable, pending > 0)}
      <span className="h-9 flex items-center gap-2 flex-1 min-w-20 @lg:@max-4xl:hidden @4xl:flex-none @4xl:w-28" title={tr(`ตรวจแล้ว ${percent}% ของนักเรียนทั้งหมด`, `${percent}% of students checked`)}>
        <span className="flex-1 min-w-0">
          <GradingBar graded={graded} pending={pending} notSubmitted={notSubmitted} />
        </span>
        <span className={`w-9 text-right text-xs font-black tabular-nums ${percent === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>{percent}%</span>
      </span>
    </>
  );
}

/**
 * Phones: a work's whole progress on one line — handed in, checked, and a bar
 * with the checked share (as MetricCells shows on wider screens). Fixed widths,
 * so the numbers line up row after row.
 */
export function PhoneProgress({ totals, bar = true }: { totals: WorkTotals; bar?: boolean }) {
  const { tr } = useLanguage();
  const { handedIn, totalStudents, graded, checkable, pending, notSubmitted } = totals;
  const percent = totalStudents > 0 ? Math.round((graded / totalStudents) * 100) : 0;
  const cell = (label: string, value: number, of: number, strong: boolean, width: string) => (
    <span className={`${width} shrink-0 inline-flex items-baseline gap-0.5 whitespace-nowrap tabular-nums`}>
      <span className="text-[10px] font-semibold text-slate-400">{label}</span>
      <span className={`text-xs font-black ${strong ? 'text-amber-700 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>{value}</span>
      <span className="text-[10px] font-semibold text-slate-400">/{of}</span>
    </span>
  );
  return (
    <>
      {/* The two counts side by side, centred in the space between the type and the bar. */}
      <span className="min-w-0 flex-1 flex items-center justify-center gap-3">
        {cell(tr('ส่ง', 'In'), handedIn, totalStudents, false, '')}
        {cell(tr('ตรวจ', 'Chk'), graded, checkable, pending > 0, '')}
      </span>
      {/* A short bar at the right end, under the row's controls (not stretched across the line). */}
      {bar && <span className="w-24 shrink-0 flex items-center gap-1.5" title={tr(`ตรวจแล้ว ${percent}% ของนักเรียนทั้งหมด`, `${percent}% of students checked`)}>
        <span className="flex-1 min-w-0">
          <GradingBar graded={graded} pending={pending} notSubmitted={notSubmitted} />
        </span>
        <span className={`w-8 text-right text-[11px] font-black tabular-nums ${percent === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>{percent}%</span>
      </span>}
    </>
  );
}

/** Right padding per level, so a work's numbers line up with its classes' (cards nest 13 px further in). */
/**
 * "ทวงงาน" beside "ตรวจงาน": how many students have not handed in sits in the
 * button's top-right corner (part of the button, not a separate badge).
 */
export function RemindButton({
  missing,
  onClick,
  title,
  closed = false,
  size = 'md',
}: {
  missing: number;
  onClick: () => void;
  title?: string;
  /** The work no longer takes hand-ins: shown, but greyed out. */
  closed?: boolean;
  /** 'sm': 32 px, 11 px text. 'xs': the two-line phone row (28 px, the bell and its count only). */
  size?: 'xs' | 'sm' | 'md';
}) {
  const { tr } = useLanguage();
  // Always shown on published work (so it is easy to find); greyed out when there is nobody to remind.
  const disabled = closed || missing === 0;
  const reason = closed
    ? tr('ปิดรับงานแล้ว จึงทวงงานไม่ได้', 'Closed: nothing to remind')
    : missing === 0
    ? tr('นักเรียนส่งครบแล้ว', 'Everyone has handed in')
    : title || tr(`ทวงงานในกลุ่ม LINE • ยังไม่ส่ง ${missing} คน`, `Remind in the LINE group • ${missing} not handed in`);
  return (
    <button
      type="button"
      draggable={false}
      onClick={onClick}
      disabled={disabled}
      title={reason}
      aria-label={reason}
      className={`relative ${size === 'xs' ? 'h-7 pl-1.5 text-[10px] rounded-lg' : size === 'sm' ? 'h-8 pl-2 text-[11px] rounded-xl' : 'h-9 pl-2.5 text-xs rounded-xl'} ${missing > 0 ? (size === 'xs' ? 'pr-1.5' : 'pr-6') : size === 'xs' ? 'pr-1.5' : size === 'sm' ? 'pr-2' : 'pr-2.5'} font-black inline-flex items-center gap-1 whitespace-nowrap ring-1 transition-colors ${
        disabled
          ? 'bg-slate-50 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 ring-slate-200 dark:ring-slate-700 cursor-not-allowed'
          : 'bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-900/50 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900 cursor-pointer'
      }`}
    >
      <BellRing className="w-3.5 h-3.5 shrink-0" />
      {size !== 'xs' && <span className={size === 'md' ? '@lg:@max-4xl:hidden' : ''}>{tr('ทวงงาน', 'Remind')}</span>}
      {missing > 0 && (
        <span
          className={`absolute ${size === 'xs' ? '-top-1.5 -right-1.5 ring-2 ring-white dark:ring-slate-900' : 'top-1 right-1'} min-w-4 h-4 px-1 rounded-full text-[10px] leading-4 text-center tabular-nums ${
            disabled ? 'bg-slate-300 dark:bg-slate-600 text-white' : 'bg-rose-600 text-white'
          }`}
        >
          {missing > 99 ? '99+' : missing}
        </span>
      )}
    </button>
  );
}

/**
 * "ตรวจงาน": filled amber while work waits; how many wait sits in the button's
 * top-right corner, the same way as RemindButton.
 */
export function GradeButton({ pending, href, size = 'md' }: { pending: number; href: string; size?: 'xs' | 'sm' | 'md' }) {
  const { tr } = useLanguage();
  return (
    <Link
      href={href}
      draggable={false}
      className={`relative ${size === 'xs' ? 'h-7 px-2 text-[11px] rounded-lg' : size === 'sm' ? 'h-8 pl-2.5 text-[11px] rounded-xl' : 'h-9 pl-3 text-xs rounded-xl'} ${size === 'xs' ? '' : pending > 0 ? 'pr-6' : size === 'sm' ? 'pr-2.5' : 'pr-3'} font-black inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
        pending > 0
          ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-sm shadow-amber-500/20'
          : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
      }`}
    >
      {size === 'xs' ? (
        tr('ตรวจ', 'Grade')
      ) : size === 'md' ? (
        <>
          <span className="@lg:@max-4xl:hidden">{tr('ตรวจงาน', 'Grade')}</span>
          <span className="hidden @lg:@max-4xl:inline">{tr('ตรวจ', 'Grade')}</span>
        </>
      ) : (
        tr('ตรวจงาน', 'Grade')
      )}
      {pending > 0 && (
        <span className={`absolute ${size === 'xs' ? '-top-1.5 -right-1.5 ring-2 ring-white dark:ring-slate-900' : 'top-1 right-1'} min-w-4 h-4 px-1 rounded-full text-[10px] leading-4 text-center tabular-nums bg-slate-950 text-white`}>
          {pending > 99 ? '99+' : pending}
        </span>
      )}
    </Link>
  );
}

/**
 * "ทวงงาน" turns into "ประกาศคะแนน" once there is nobody left to remind:
 * everyone handed in or has a score, or the work no longer takes hand-ins.
 */
export function announcesResults(counts: Pick<GradingCounts, 'notSubmitted'>, acceptsSubmissions: boolean): boolean {
  return counts.notSubmitted === 0 || !acceptsSubmissions;
}

/**
 * "ประกาศคะแนน" in RemindButton's place. Its label stays "ประกาศ" so the
 * button is never wider than the bell + "ทวงงาน" (the full wording is its
 * tooltip and the ⋯ menu item).
 */
export function AnnounceButton({ graded, onClick, title, size = 'md' }: { graded: number; onClick: () => void; title?: string; size?: 'xs' | 'sm' | 'md' }) {
  const { tr } = useLanguage();
  const disabled = graded === 0;
  const reason = disabled ? tr('ยังไม่มีงานที่ตรวจเสร็จ', 'Nothing graded yet') : title || tr('ประกาศคะแนนในกลุ่ม LINE', 'Announce scores in the LINE group');
  return (
    <button
      type="button"
      draggable={false}
      onClick={onClick}
      disabled={disabled}
      title={reason}
      aria-label={reason}
      className={`${size === 'xs' ? 'h-7 px-1.5 text-[10px] rounded-lg' : size === 'sm' ? 'h-8 px-2 text-[11px] rounded-xl' : 'h-9 px-2.5 text-xs rounded-xl'} font-black inline-flex items-center gap-1 whitespace-nowrap ring-1 transition-colors ${
        disabled
          ? 'bg-slate-50 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 ring-slate-200 dark:ring-slate-700 cursor-not-allowed'
          : 'bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900 cursor-pointer'
      }`}
    >
      <Megaphone className="w-3.5 h-3.5 shrink-0" />
      {size !== 'xs' && <span className={size === 'md' ? '@lg:@max-4xl:hidden' : ''}>{tr('ประกาศ', 'Scores')}</span>}
    </button>
  );
}

export const ROW_INSET = {
  /** Class rows sit one border + 12 px padding further in. */
  work: 'max-sm:pr-[13px] @4xl:pr-[13px]',
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
  phone,
  phoneMeta,
  inset = '',
}: {
  lead: React.ReactNode;
  status?: React.ReactNode;
  metrics?: React.ReactNode;
  action?: React.ReactNode;
  menu?: React.ReactNode;
  /** Phones only: a short summary kept on the title's line (PhoneWorkSummary); status, buttons and numbers then hide below `sm`. */
  phone?: React.ReactNode;
  /**
   * Phones only, with `phone`: a second line under the title, full width (e.g. the
   * work type and its whole progress); the title shares the first line with
   * `phone` (then just the controls) and ⋯.
   */
  phoneMeta?: React.ReactNode;
  /** ROW_INSET for the level, so columns line up across levels. */
  inset?: string;
}) {
  // Wide board (container ≥ 56rem): one line. The name takes the free space;
  // status, numbers, button and ⋯ keep fixed widths at the right, so every
  // row's status button starts at the same x (each sized to its label).
  // Medium (32–56rem, e.g. a 650–980 px screen): one line too, with compact
  // fixed columns (no bar; ทวงงาน / ประกาศ as icons, ตรวจงาน as ตรวจ).
  // Narrow: name + ⋯ / status + button / numbers. Phones with `phone`: their own layout.
  const wide = phone ? 'max-sm:hidden' : '';
  const stacked = !!(phone && phoneMeta);
  return (
    <div
      className={`flex flex-wrap @lg:flex-nowrap items-center gap-x-3 @lg:gap-x-2 @4xl:gap-x-3 gap-y-1.5 ${
        phone ? (stacked ? 'max-sm:gap-x-1.5 max-sm:gap-y-1' : 'max-sm:flex-nowrap max-sm:gap-x-1.5') : ''
      } ${inset}`}
    >
      <div
        className={`order-1 basis-[calc(100%-3rem)] @lg:basis-auto min-w-0 flex-1 min-h-9 flex items-center ${
          phone ? 'max-sm:basis-0' : ''
        }`}
      >
        {lead}
      </div>
      {phone && <div className="sm:hidden order-1 shrink-0 flex items-center">{phone}</div>}
      {stacked && <div className="sm:hidden order-3 basis-full min-w-0 flex items-center gap-2">{phoneMeta}</div>}
      <div className="order-2 @lg:order-6 shrink-0 w-9 h-9 flex items-center justify-end">{menu}</div>
      <div className={`order-3 @lg:order-2 min-w-0 shrink-0 @lg:w-24 @4xl:w-36 h-9 flex items-center ${status ? '' : 'hidden @lg:flex'} ${wide}`}>{status}</div>
      <div className={`order-4 @lg:order-5 ml-auto @lg:ml-0 shrink-0 @lg:w-30 @4xl:w-52 h-9 flex items-center justify-end gap-1.5 ${wide}`}>{action}</div>
      <div className={`order-5 @lg:order-4 basis-full @lg:basis-auto @lg:w-[8.5rem] @4xl:w-76 shrink-0 min-w-0 h-9 flex items-center gap-3 @lg:gap-2 @4xl:gap-3 ${wide}`}>{metrics}</div>
    </div>
  );
}
