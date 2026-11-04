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

/** Bar (checked / waiting / not in) with "handed in" and "checked" numbers under it. */
export function ProgressLine({ totals, className = '' }: { totals: WorkTotals; className?: string }) {
  const { tr } = useLanguage();
  const { handedIn, totalStudents, graded, checkable, pending, notSubmitted } = totals;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <GradingBar graded={graded} pending={pending} notSubmitted={notSubmitted} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
        <span>
          {tr('ส่งแล้ว', 'In')} <span className="text-slate-900 dark:text-white font-black">{handedIn}</span>/{totalStudents}
        </span>
        <span>
          {tr('ตรวจแล้ว', 'Checked')} <span className="text-slate-900 dark:text-white font-black">{graded}</span>/{checkable}
        </span>
        {pending > 0 && <span className="text-amber-700 dark:text-amber-400 font-bold">{tr(`รอตรวจ ${pending}`, `${pending} to check`)}</span>}
      </div>
    </div>
  );
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
