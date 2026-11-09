'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, Loader2, Minus, PencilLine, Plus, RotateCcw, Send, X } from 'lucide-react';
import { ModalSheet, ModalSheetBody, ModalSheetFooter, ModalSheetHeader } from '@/components/ModalSheet';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { formatDateTime } from '@/lib/utils/datetime';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MINUTES = 1;
const MAX_MINUTES = 30 * 24 * 60;
/** Least time suggested: a student needs a few minutes to fix and hand in. */
const MIN_SUGGESTED_MINUTES = 10;
/** Suggested when the deadline has already passed. */
const AFTER_DEADLINE_MINUTES = 30;
const PRESETS = [10, 15, 30, 60, 120, 1440];

/**
 * Whether "Allow edit" / "Allow hand-in" needs a time limit, and the minutes
 * to suggest. Work still open for more than a day needs none (the student has
 * time anyway: no popup). Close to the deadline the suggestion is the time
 * left (at least MIN_SUGGESTED_MINUTES); after it, AFTER_DEADLINE_MINUTES.
 */
export function reopenTimeSuggestion(
  window: { deadline: number | null; acceptsSubmissions: boolean },
  now: number = Date.now()
): { needsTime: false } | { needsTime: true; minutes: number } {
  const { deadline, acceptsSubmissions } = window;
  if (acceptsSubmissions && deadline !== null && deadline - now > DAY_MS) return { needsTime: false };
  if (acceptsSubmissions && deadline === null) return { needsTime: false };
  if (deadline !== null && deadline > now) {
    return { needsTime: true, minutes: Math.max(MIN_SUGGESTED_MINUTES, Math.ceil((deadline - now) / 60000)) };
  }
  return { needsTime: true, minutes: AFTER_DEADLINE_MINUTES };
}

function formatMinutes(minutes: number, th: boolean) {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const parts = th
    ? [d && `${d} วัน`, h && `${h} ชม.`, m && `${m} นาที`]
    : [d && `${d}d`, h && `${h}h`, m && `${m}m`];
  return parts.filter(Boolean).join(' ') || (th ? '0 นาที' : '0m');
}

/**
 * Teacher picks how long one student may edit / hand in, close to or after
 * the deadline. The class deadline stays.
 */
export function ReopenTimeDialog({
  studentName,
  kind,
  deadline,
  defaultMinutes,
  busy,
  onConfirm,
  onClose,
}: {
  studentName: string;
  /** edit: handed-in homework; handin: nothing handed in yet (or recorded as missing); retry: a quiz taken again, blank. */
  kind: 'edit' | 'handin' | 'retry';
  deadline: number | null;
  defaultMinutes: number;
  busy?: boolean;
  onConfirm: (minutes: number) => void;
  onClose: () => void;
}) {
  const { language } = useLanguage();
  const th = language === 'th';
  const [value, setValue] = useState(String(defaultMinutes));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  const parsed = Math.round(Number(value));
  const valid = Number.isFinite(parsed) && parsed >= MIN_MINUTES && parsed <= MAX_MINUTES;
  const minutes = valid ? parsed : null;
  const until = minutes !== null ? new Date(now + minutes * 60000).toISOString() : null;
  const step = (delta: number) => {
    const base = Number.isFinite(parsed) ? parsed : defaultMinutes;
    setValue(String(Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, base + delta))));
  };
  const left = deadline !== null ? deadline - now : null;

  const title = kind === 'retry'
    ? th ? `ให้ ${studentName} สอบใหม่` : `Let ${studentName} retake`
    : kind === 'edit'
    ? th ? `ให้ ${studentName} แก้ไขงาน` : `Let ${studentName} edit`
    : th ? `ให้ ${studentName} ส่งงาน` : `Let ${studentName} hand in`;

  return (
    <ModalSheet onClose={() => !busy && onClose()} size="sm:max-w-md" zIndex="z-[60]" labelledBy="reopen-time-title">
      <ModalSheetHeader>
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-2xl bg-orange-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-orange-500/30">
            {kind === 'retry' ? <RotateCcw className="w-5 h-5" /> : kind === 'edit' ? <PencilLine className="w-5 h-5" /> : <Send className="w-5 h-5" />}
          </span>
          <div className="min-w-0">
            <h2 id="reopen-time-title" className="text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">{title}</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {th ? 'เฉพาะนักเรียนคนนี้ • กำหนดส่งของทั้งห้องไม่เปลี่ยน' : 'This student only • the class deadline stays'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={th ? 'ปิด' : 'Close'}
          className="w-9 h-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 cursor-pointer shrink-0 disabled:opacity-50"
        >
          <X className="w-4.5 h-4.5" />
        </button>
      </ModalSheetHeader>

      <form
        className="flex flex-col flex-1 min-h-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (minutes !== null && !busy) onConfirm(minutes);
        }}
      >
        <ModalSheetBody className="space-y-4">
          {kind === 'retry' && (
            <div className="flex items-start gap-2 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-700 dark:text-rose-300 font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {th
                  ? 'คำตอบ คะแนน และบันทึกการออกจากหน้าจอของครั้งก่อนจะถูกลบทั้งหมด นักเรียนเริ่มทำข้อสอบใหม่จากกระดาษเปล่า'
                  : 'The earlier answers, score and screen-exit log are deleted. The student starts the quiz again from a blank sheet.'}
              </span>
            </div>
          )}
          {deadline !== null && (
            <div className="flex items-start gap-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-600 dark:text-slate-300">
              <Clock className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
              <span>
                {th ? 'กำหนดส่ง' : 'Due'} <b>{formatDateTime(new Date(deadline).toISOString(), language)}</b>
                {' • '}
                {left !== null && left > 0 ? (
                  <span className="font-bold text-orange-600 dark:text-orange-400">
                    {th ? `เหลือ ${formatMinutes(Math.ceil(left / 60000), th)}` : `${formatMinutes(Math.ceil(left / 60000), th)} left`}
                  </span>
                ) : (
                  <span className="font-bold text-rose-600 dark:text-rose-400">{th ? 'เลยกำหนดแล้ว' : 'past due'}</span>
                )}
              </span>
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="reopen-minutes" className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {kind === 'retry'
                ? th ? 'เวลาให้เริ่มและส่งข้อสอบใหม่ (นาที)' : 'Time to take and hand in the quiz again (minutes)'
                : th ? 'ให้เวลานักเรียนคนนี้ (นาที)' : 'Time for this student (minutes)'}
            </label>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => step(-5)}
                aria-label={th ? 'ลด 5 นาที' : '5 minutes less'}
                className="w-12 h-12 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
              >
                <Minus className="w-4 h-4" />
              </button>
              <input
                id="reopen-minutes"
                type="number"
                inputMode="numeric"
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                // Mouse / trackpad only: on phones (the teacher LIFF too) focusing would pop the keyboard over the presets.
                autoFocus={typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches}
                className={`flex-1 min-w-0 h-12 px-3 rounded-2xl text-center text-xl font-black tabular-nums bg-white dark:bg-slate-800 text-slate-900 dark:text-white outline-hidden ring-2 transition-colors ${
                  valid ? 'ring-orange-300 focus:ring-orange-500 dark:ring-orange-800' : 'ring-rose-400'
                }`}
              />
              <button
                type="button"
                onClick={() => step(5)}
                aria-label={th ? 'เพิ่ม 5 นาที' : '5 minutes more'}
                className="w-12 h-12 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer active:scale-95 transition-transform"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setValue(String(preset))}
                  className={`h-9 rounded-xl text-[11px] font-bold cursor-pointer transition-colors ${
                    parsed === preset
                      ? 'bg-orange-500 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-orange-50 hover:text-orange-700 dark:hover:bg-orange-950/40 dark:hover:text-orange-300'
                  }`}
                >
                  {formatMinutes(preset, th)}
                </button>
              ))}
            </div>
            {!valid && (
              <p className="text-[11px] font-semibold text-rose-600">
                {th ? `ใส่ได้ ${MIN_MINUTES}–${MAX_MINUTES.toLocaleString()} นาที` : `Enter ${MIN_MINUTES}–${MAX_MINUTES.toLocaleString()} minutes`}
              </p>
            )}
          </div>

          {until && (
            <div key={until.slice(0, 16)} className="animate-in fade-in zoom-in-95 p-3.5 rounded-2xl bg-orange-50 dark:bg-orange-950/40 ring-1 ring-orange-200 dark:ring-orange-900 text-orange-900 dark:text-orange-200">
              <p className="text-[11px] font-semibold opacity-80">{th ? 'นักเรียนส่งได้ถึง' : 'They can hand in until'}</p>
              <p className="text-base font-black">{formatDateTime(until, language)}</p>
              <p className="text-[11px] mt-0.5 opacity-80">({formatMinutes(minutes!, th)})</p>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            {kind === 'retry'
              ? th
                ? 'ระบบนับการออกจากหน้าจอใหม่ตั้งแต่ต้น • ส่งแล้วตรวจอัตโนมัติเหมือนเดิม'
                : 'Screen exits are counted from zero again • auto-graded on hand-in as usual'
              : kind === 'edit'
              ? th
                ? 'ส่งใหม่แล้วคะแนนเดิมถูกล้างเพื่อตรวจใหม่'
                : 'Handing in again clears the score for regrading'
              : th
              ? 'งานที่ส่งแทนคะแนน 0 • เลยกำหนด = ส่งช้า'
              : 'Replaces any 0 • marked late if past due'}
          </p>
        </ModalSheetBody>

        <ModalSheetFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-11 px-4 rounded-2xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
          >
            {th ? 'ยกเลิก' : 'Cancel'}
          </button>
          <button
            type="submit"
            disabled={!valid || busy}
            className="h-11 px-5 rounded-2xl text-sm font-black bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/30 inline-flex items-center gap-2 cursor-pointer active:scale-[0.98] transition-transform disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : kind === 'retry' ? <RotateCcw className="w-4 h-4" /> : kind === 'edit' ? <PencilLine className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            {kind === 'retry'
              ? th ? 'ล้างคำตอบและให้สอบใหม่' : 'Clear and allow retake'
              : kind === 'edit'
              ? th ? 'เปิดให้แก้ไข' : 'Allow edit'
              : th ? 'เปิดให้ส่ง' : 'Allow hand-in'}
          </button>
        </ModalSheetFooter>
      </form>
    </ModalSheet>
  );
}
