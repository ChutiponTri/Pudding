'use client';

import { useState } from 'react';
import { Check, ChevronDown, Clock, Loader2, Lock, Rocket, Unlock, X } from 'lucide-react';
import type { Assignment, SubmissionOverrideStatus } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { DateTimeField } from '@/components/DateTimeField';
import { ModalSheet, ModalSheetBody, ModalSheetFooter, ModalSheetHeader } from '@/components/ModalSheet';
import { ASSIGNMENT_STATUS_CLASSES, getAssignmentStatus, type AssignmentStatusTone } from '@/lib/utils/assignmentWindow';
import { daysFromNowAt } from '@/lib/utils/datetime';
import { shortDate } from '@/components/works/WorkBits';
import type { WorkClass } from '@/lib/utils/workGroups';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const span = (ms: number, th: boolean) => {
  const days = Math.floor(ms / DAY);
  const hours = Math.max(1, Math.floor(ms / HOUR));
  return ms >= DAY ? (th ? `${days} วัน` : `${days}d`) : th ? `${hours} ชม.` : `${hours}h`;
};

/** Dot colour per acceptance state (same palette as the status badges elsewhere). */
const STATUS_DOT: Record<AssignmentStatusTone, string> = {
  draft: 'bg-slate-400',
  scheduled: 'bg-sky-500',
  open: 'bg-emerald-500',
  late: 'bg-amber-500',
  closed: 'bg-rose-500',
};

export type AcceptStatus = { tone: AssignmentStatusTone; label: string; hint: string };

/** Whether a class's copy takes work (the main word) and the time that matters (the hint). */
export function acceptStatus(c: Pick<WorkClass, 'assignment' | 'window' | 'counts'>, th: boolean, language: string, now: number): AcceptStatus {
  const w = c.window;
  const s = getAssignmentStatus(w, c.assignment.is_exam, th ? 'th' : 'en');
  let hint = '';
  if (s.tone === 'scheduled') hint = shortDate(c.assignment.publish_at, language);
  else if (s.tone === 'late' && w.deadline != null) hint = th ? `เลยกำหนด ${span(now - w.deadline, true)}` : `${span(now - w.deadline, false)} late`;
  else if (s.tone === 'open' && w.deadline != null) {
    const left = w.deadline - now;
    hint = left < 7 * DAY ? (th ? `เหลือ ${span(left, true)}` : `${span(left, false)} left`) : shortDate(w.deadline, language);
  } else if (s.tone === 'closed') {
    const allChecked = c.counts.pending === 0 && c.counts.notSubmitted === 0 && c.counts.totalStudents > 0;
    hint = allChecked ? (th ? 'ตรวจครบ' : 'all checked') : w.isForceClosed ? (th ? 'โดยครู' : 'by you') : '';
  }
  return { tone: s.tone, label: s.label, hint };
}

/** Several copies at once: their state when they agree, else "Open · k/n". */
export function combinedStatus(list: AcceptStatus[], unit: [string, string], th: boolean): AcceptStatus {
  if (!list.length) return { tone: 'draft', label: th ? 'ฉบับร่าง' : 'Draft', hint: '' };
  if (new Set(list.map((s) => `${s.tone}|${s.hint}`)).size === 1) return list[0];
  if (new Set(list.map((s) => s.tone)).size === 1) return { ...list[0], hint: th ? `${list.length} ${unit[0]}` : `${list.length} ${unit[1]}` };
  const u = th ? unit[0] : unit[1];
  const open = list.filter((s) => s.tone === 'open' || s.tone === 'late').length;
  if (open > 0) return { tone: 'open', label: th ? 'เปิดรับ' : 'Open', hint: `${open}/${list.length} ${u}` };
  const closed = list.filter((s) => s.tone === 'closed').length;
  if (closed > 0) return { tone: 'closed', label: th ? 'ปิดรับ' : 'Closed', hint: `${closed}/${list.length} ${u}` };
  return list[0];
}

/** The acceptance state as a pill: coloured dot, state, and a chevron when it can be changed (the time hint is in the tooltip). */
export function StatusButton({ status, onClick }: { status: AcceptStatus; onClick?: () => void }) {
  const { tr } = useLanguage();
  const inner = (
    <>
      <span className="relative flex w-2 h-2 shrink-0">
        {status.tone === 'open' && <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-75 animate-ping" />}
        <span className={`relative w-2 h-2 rounded-full ${STATUS_DOT[status.tone]}`} />
      </span>
      <span className="font-black truncate">{status.label}</span>
      {onClick && <ChevronDown className="w-3 h-3 shrink-0 ml-auto opacity-60" />}
    </>
  );
  const cls = `h-7 max-w-full min-w-0 px-2.5 rounded-full border text-[11px] inline-flex items-center gap-1.5 ${ASSIGNMENT_STATUS_CLASSES[status.tone]}`;
  return onClick ? (
    <button
      type="button"
      draggable={false}
      onClick={onClick}
      title={`${status.label}${status.hint ? ` · ${status.hint}` : ''} — ${tr('กดเพื่อเปลี่ยนสถานะ', 'tap to change')}`}
      className={`${cls} cursor-pointer hover:brightness-95 dark:hover:brightness-125 transition`}
    >
      {inner}
    </button>
  ) : (
    <span className={cls} title={status.hint ? `${status.label} · ${status.hint}` : undefined}>
      {inner}
    </span>
  );
}

/**
 * Status for several copies at once (a work in all its classes, or every work
 * of a category): follow the due date, close now, or extend to a new time.
 * Unpublished copies can be published from here too.
 */
export function BulkStatusDialog({
  title,
  scope,
  items,
  onClose,
  onDone,
}: {
  title: string;
  /** e.g. "3 ห้อง" / "5 งาน · 12 ห้อง" */
  scope: string;
  items: WorkClass[];
  onClose: () => void;
  /** Every changed row, to show the change at once, and a message for the toast. */
  onDone: (changes: Array<{ id: string; change: Partial<Assignment> }>, message: string) => void;
}) {
  const { tr } = useLanguage();
  const published = items.filter((c) => c.published);
  const hidden = items.filter((c) => !c.published);
  const modes = new Set(published.map((c) => c.assignment.status_override || 'auto'));
  const [mode, setMode] = useState<SubmissionOverrideStatus>(modes.size === 1 ? [...modes][0] : 'auto');
  const [until, setUntil] = useState(() => daysFromNowAt(1, 23, 59));
  const [saving, setSaving] = useState<'status' | 'publish' | null>(null);
  const [error, setError] = useState('');

  const run = async (kind: 'status' | 'publish') => {
    const list = kind === 'publish' ? hidden : published;
    if (kind === 'status' && mode === 'extended' && new Date(until).getTime() <= new Date().getTime()) {
      setError(tr('กรุณาเลือกเวลาในอนาคต', 'Pick a time in the future'));
      return;
    }
    setSaving(kind);
    setError('');
    const changes: Array<{ id: string; change: Partial<Assignment> }> = [];
    let failed = '';
    await Promise.all(
      list.map(async (c) => {
        try {
          if (kind === 'publish') {
            const updated = await dataService.publishAssignmentNow(c.assignment.id);
            changes.push({ id: c.assignment.id, change: { publish_at: updated?.publish_at || new Date().toISOString() } });
          } else {
            const extendedUntil = mode === 'extended' ? new Date(until).toISOString() : undefined;
            const updated = await dataService.updateAssignmentDeadlineOverride(c.assignment.id, { status_override: mode, extended_until: extendedUntil });
            changes.push({
              id: c.assignment.id,
              change: { status_override: updated?.status_override || mode, ...(extendedUntil ? { extended_until: updated?.extended_until || extendedUntil } : {}) },
            });
          }
        } catch (err) {
          failed ||= err instanceof Error && err.message ? err.message : tr('บันทึกไม่สำเร็จ', 'Could not save');
        }
      })
    );
    setSaving(null);
    if (failed && !changes.length) {
      setError(failed);
      return;
    }
    const done = kind === 'publish' ? tr('เผยแพร่แล้ว', 'Published') : tr('เปลี่ยนสถานะแล้ว', 'Status changed');
    onDone(changes, failed ? `${done} ${changes.length}/${list.length} · ${failed}` : done);
    onClose();
  };

  const options: Array<{ id: SubmissionOverrideStatus; icon: typeof Clock; label: string; note: string; active: string }> = [
    {
      id: 'auto',
      icon: Clock,
      label: tr('ตามกำหนดส่ง', 'Follow the due date'),
      note: tr('เปิดรับถึงกำหนดส่งของแต่ละห้อง', 'Open until each class’s due date'),
      active: 'ring-2 ring-emerald-400 bg-emerald-50 dark:bg-emerald-950/40',
    },
    {
      id: 'force_closed',
      icon: Lock,
      label: tr('ปิดรับทันที', 'Close now'),
      note: tr('นักเรียนส่งไม่ได้จนกว่าจะเปิดอีกครั้ง', 'No hand-ins until you reopen it'),
      active: 'ring-2 ring-rose-400 bg-rose-50 dark:bg-rose-950/40',
    },
    {
      id: 'extended',
      icon: Unlock,
      label: tr('ขยายเวลาถึง', 'Extend until'),
      note: tr('ทุกห้องเปิดรับถึงเวลาที่เลือก', 'Every class stays open until the time you pick'),
      active: 'ring-2 ring-amber-400 bg-amber-50 dark:bg-amber-950/40',
    },
  ];

  return (
    <ModalSheet onClose={onClose} size="sm:max-w-md">
      <ModalSheetHeader>
        <div className="min-w-0">
          <h3 className="text-base font-black text-slate-900 dark:text-white">{tr('สถานะการรับงาน', 'Submission status')}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {title} · {scope}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={tr('ปิด', 'Close')} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer shrink-0">
          <X className="w-5 h-5" />
        </button>
      </ModalSheetHeader>
      <ModalSheetBody className="space-y-3">
        {hidden.length > 0 && (
          <div className="p-3 rounded-2xl bg-sky-50 dark:bg-sky-950/40 flex items-center gap-3">
            <p className="flex-1 text-xs font-bold text-sky-800 dark:text-sky-200">{tr(`ยังไม่เผยแพร่ ${hidden.length} ห้อง`, `${hidden.length} not published yet`)}</p>
            <button
              type="button"
              onClick={() => run('publish')}
              disabled={!!saving}
              className="h-9 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer"
            >
              {saving === 'publish' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
              {tr('เผยแพร่ตอนนี้', 'Publish now')}
            </button>
          </div>
        )}
        {published.length > 0 && (
          <div className="space-y-2">
            {options.map(({ id, icon: Icon, label, note, active }) => {
              const selected = mode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={`w-full p-3 rounded-2xl text-left flex items-start gap-3 cursor-pointer transition ${selected ? active : 'ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300 dark:hover:ring-slate-600'}`}
                >
                  <Icon className="w-4 h-4 mt-0.5 shrink-0 text-slate-600 dark:text-slate-300" />
                  <span className="min-w-0">
                    <span className="block text-sm font-black text-slate-900 dark:text-white">{label}</span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">{note}</span>
                  </span>
                  {selected && <Check className="w-4 h-4 ml-auto shrink-0 text-slate-900 dark:text-white" />}
                </button>
              );
            })}
            {mode === 'extended' && <DateTimeField value={until} onChange={setUntil} />}
          </div>
        )}
        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
      </ModalSheetBody>
      {published.length > 0 && (
        <ModalSheetFooter>
          <button type="button" onClick={onClose} className="h-10 px-4 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            {tr('ยกเลิก', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => run('status')}
            disabled={!!saving}
            className="h-10 px-5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-xs font-black inline-flex items-center gap-1.5 cursor-pointer"
          >
            {saving === 'status' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {tr(`ใช้กับ ${published.length} ห้อง`, `Apply to ${published.length} classes`)}
          </button>
        </ModalSheetFooter>
      )}
    </ModalSheet>
  );
}
