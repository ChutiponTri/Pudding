'use client';

import { useState } from 'react';
import { Calendar, Check, Loader2, X } from 'lucide-react';
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

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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

const span = (ms: number, th: boolean) =>
  ms >= DAY ? (th ? `${Math.floor(ms / DAY)} วัน` : `${Math.floor(ms / DAY)}d`) : th ? `${Math.max(1, Math.floor(ms / HOUR))} ชม.` : `${Math.max(1, Math.floor(ms / HOUR))}h`;

/** The one thing worth knowing about a class's copy right now. */
export function classStatus(c: WorkClass, th: boolean, language: string, now: number): { label: string; tone: Tone } {
  const w = c.window;
  if (w.isDraft) return { label: th ? 'ฉบับร่าง' : 'Draft', tone: 'slate' };
  if (w.isScheduled) return { label: `${th ? 'เผยแพร่' : 'Publishes'} ${shortDate(c.assignment.publish_at, language)}`, tone: 'sky' };
  const allChecked = c.counts.pending === 0 && c.counts.notSubmitted === 0 && c.counts.totalStudents > 0;
  if (!w.acceptsSubmissions) {
    if (allChecked) return { label: th ? 'ตรวจครบแล้ว' : 'All checked', tone: 'emerald' };
    return { label: th ? 'ปิดรับแล้ว' : 'Closed', tone: 'slate' };
  }
  if (w.deadline == null) return { label: th ? 'เปิดรับ' : 'Open', tone: 'emerald' };
  if (w.isPastDeadline) return { label: th ? `เลยกำหนด ${span(now - w.deadline, true)}` : `${span(now - w.deadline, false)} past due`, tone: 'rose' };
  const left = w.deadline - now;
  if (left < 2 * DAY) return { label: th ? `เหลือ ${span(left, true)}` : `${span(left, false)} left`, tone: 'amber' };
  if (left < 7 * DAY) return { label: th ? `เหลือ ${span(left, true)}` : `${span(left, false)} left`, tone: 'emerald' };
  return { label: `${th ? 'ส่ง' : 'Due'} ${shortDate(w.deadline, language)}`, tone: 'emerald' };
}

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
  const cell = (label: string, value: number, of: number, strong: boolean) => (
    <span className="w-16 shrink-0 leading-tight">
      <span className="block text-[10px] font-semibold text-slate-400 dark:text-slate-500 truncate">{label}</span>
      <span className={`text-sm font-black tabular-nums ${strong ? 'text-amber-700 dark:text-amber-400' : 'text-slate-900 dark:text-white'}`}>
        {value}
        <span className="text-[11px] font-semibold text-slate-400">/{of}</span>
      </span>
    </span>
  );
  return (
    <>
      {cell(tr('ส่งแล้ว', 'Handed in'), handedIn, totalStudents, false)}
      {cell(tr('ตรวจแล้ว', 'Checked'), graded, checkable, pending > 0)}
      <span className="flex items-center gap-2 w-28 shrink-0" title={tr(`ตรวจแล้ว ${percent}% ของนักเรียนทั้งหมด`, `${percent}% of students checked`)}>
        <span className="flex-1 min-w-0">
          <GradingBar graded={graded} pending={pending} notSubmitted={notSubmitted} />
        </span>
        <span className={`w-9 text-right text-xs font-black tabular-nums ${percent === 100 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-200'}`}>{percent}%</span>
      </span>
    </>
  );
}

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
}: {
  lead: React.ReactNode;
  status?: React.ReactNode;
  metrics?: React.ReactNode;
  action?: React.ReactNode;
  menu?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2">
      <div className="order-1 min-w-0 flex-1">{lead}</div>
      <div className="order-2 shrink-0 sm:w-32 flex sm:justify-start">{status}</div>
      <div className="order-4 sm:order-3 basis-full sm:basis-auto flex items-center gap-3 min-w-0">
        {metrics}
        <span className="ml-auto sm:ml-0 shrink-0">{action}</span>
      </div>
      <div className="order-3 sm:order-4 shrink-0 w-9 flex justify-end">{menu}</div>
    </div>
  );
}
