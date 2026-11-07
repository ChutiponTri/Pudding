'use client';

import React from 'react';
import { Submission, SubmissionEvent } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { ModalSheet, ModalSheetBody, ModalSheetFooter, ModalSheetHeader } from '@/components/ModalSheet';
import { isSuspiciousActivity, SUSPICIOUS_AWAY_SECONDS, SUSPICIOUS_TAB_SWITCHES } from '@/lib/utils/integrity';
import {
  X,
  ShieldAlert,
  ShieldCheck,
  Clock,
  Layers,
  Copy,
  ClipboardPaste,
  EyeOff,
  Eye,
  AlertOctagon,
  RotateCcw,
  Columns2,
  MousePointer2,
  Play,
  Send,
  Loader2,
} from 'lucide-react';

interface IntegrityAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
  submission: Submission | null;
  events: SubmissionEvent[];
  /** The event log is still loading: the counts on the submission show meanwhile. */
  loading?: boolean;
}

/** Trips away from the quiz: the only events with a length. */
const TRIP_TYPES = new Set(['tab_hidden', 'window_blur', 'split_screen', 'pointer_left']);

const EVENT_LOOK: Record<string, { icon: React.ElementType; tone: string }> = {
  tab_hidden: { icon: EyeOff, tone: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 ring-rose-200 dark:ring-rose-900' },
  window_blur: { icon: AlertOctagon, tone: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 ring-amber-200 dark:ring-amber-900' },
  split_screen: { icon: Columns2, tone: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/60 ring-orange-200 dark:ring-orange-900' },
  pointer_left: { icon: MousePointer2, tone: 'text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 ring-slate-200 dark:ring-slate-700' },
  copy_attempt: { icon: Copy, tone: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60 ring-purple-200 dark:ring-purple-900' },
  paste_attempt: { icon: ClipboardPaste, tone: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 ring-indigo-200 dark:ring-indigo-900' },
  quiz_reopened: { icon: RotateCcw, tone: 'text-rose-700 dark:text-rose-300 bg-rose-100 dark:bg-rose-950 ring-rose-300 dark:ring-rose-800' },
  tab_visible: { icon: Eye, tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 ring-emerald-200 dark:ring-emerald-900' },
  window_focus: { icon: Eye, tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 ring-emerald-200 dark:ring-emerald-900' },
};
const DEFAULT_LOOK = { icon: Layers, tone: 'text-slate-500 bg-slate-100 dark:bg-slate-800 ring-slate-200 dark:ring-slate-700' };

/** 8 → "8 วินาที", 125 → "2 นาที 5 วินาที". */
function formatSeconds(seconds: number, th: boolean) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (th) return m ? `${m} นาที${rest ? ` ${rest} วินาที` : ''}` : `${s} วินาที`;
  return m ? `${m} min${rest ? ` ${rest} s` : ''}` : `${s} s`;
}

/** Time into the quiz: "+3:07". */
function offset(at: string, start: number) {
  const diff = Math.round((new Date(at).getTime() - start) / 1000);
  if (!Number.isFinite(diff) || diff < 0) return '';
  return `+${Math.floor(diff / 60)}:${String(diff % 60).padStart(2, '0')}`;
}

const clock = (at: string) =>
  new Date(at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const IntegrityAuditModal: React.FC<IntegrityAuditModalProps> = ({ isOpen, onClose, submission, events, loading = false }) => {
  const { t, language } = useLanguage();
  const th = language === 'th';

  if (!isOpen || !submission) return null;

  const switches = submission.tab_switch_count || 0;
  const away = submission.total_time_away_seconds || 0;
  const exits = submission.quiz_exit_count || 0;
  const sorted = [...events].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const copies = sorted.filter((e) => e.event_type === 'copy_attempt').length;
  const pastes = sorted.filter((e) => e.event_type === 'paste_attempt').length;
  const isHighRisk = submission.is_flagged_suspicious || exits > 0 || isSuspiciousActivity(switches, away);
  const isWatch = !isHighRisk && (switches > 0 || away > 0 || sorted.length > 0);

  // Why the system flagged it, in the same terms as the server's rule (POST /api/submissions).
  const reasons = [
    exits > 0 && (th ? `ปิดข้อสอบแล้วเปิดใหม่ ${exits} ครั้ง` : `Closed and reopened the quiz ${exits}×`),
    submission.auto_forfeited &&
      (th ? 'เกินจำนวนครั้งที่เตือนไว้ ระบบส่งกระดาษเปล่าอัตโนมัติ (0 คะแนน)' : 'Over the warnings allowed: a blank sheet was handed in (0 points)'),
    switches >= SUSPICIOUS_TAB_SWITCHES && (th ? `ออกจากหน้าข้อสอบ ${switches} ครั้ง (เกณฑ์ ${SUSPICIOUS_TAB_SWITCHES} ครั้ง)` : `Left the quiz ${switches}× (limit ${SUSPICIOUS_TAB_SWITCHES})`),
    away >= SUSPICIOUS_AWAY_SECONDS && (th ? `อยู่นอกหน้าข้อสอบรวม ${formatSeconds(away, th)} (เกณฑ์ ${SUSPICIOUS_AWAY_SECONDS} วินาที)` : `Away ${formatSeconds(away, th)} in total (limit ${SUSPICIOUS_AWAY_SECONDS} s)`),
    copies > 0 && (th ? `คลุมหรือคัดลอกข้อความบนหน้าข้อสอบ ${copies} ครั้ง` : `Selected or copied quiz text ${copies}×`),
    pastes > 0 && (th ? `วางข้อความลงในคำตอบ ${pastes} ครั้ง` : `Pasted text into an answer ${pastes}×`),
  ].filter(Boolean) as string[];

  const start = new Date(submission.started_at).getTime();
  const hasStart = Number.isFinite(start);

  const metrics = [
    { label: th ? 'ออกจากหน้าข้อสอบ' : 'Left the quiz', value: `${switches}`, unit: th ? 'ครั้ง' : '×', alert: switches >= SUSPICIOUS_TAB_SWITCHES, icon: Layers },
    { label: th ? 'เวลานอกหน้าข้อสอบ' : 'Time away', value: formatSeconds(away, th), unit: '', alert: away >= SUSPICIOUS_AWAY_SECONDS, icon: Clock },
    { label: th ? 'คลุม / คัดลอก' : 'Select / copy', value: loading ? '…' : `${copies}`, unit: th ? 'ครั้ง' : '×', alert: copies > 0, icon: Copy },
    { label: th ? 'วางข้อความ' : 'Paste', value: loading ? '…' : `${pastes}`, unit: th ? 'ครั้ง' : '×', alert: pastes > 0, icon: ClipboardPaste },
  ];

  const riskTone = isHighRisk
    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/80 dark:text-rose-300'
    : isWatch
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300';
  const riskLabel = isHighRisk ? (th ? 'น่าสงสัย' : 'Suspicious') : isWatch ? (th ? 'เฝ้าระวัง' : 'Watch') : th ? 'ปกติ' : 'Normal';

  /** A timeline row: dot on the line, then a card. */
  const row = (key: string, look: { icon: React.ElementType; tone: string }, title: string, at: string | undefined, body?: React.ReactNode) => {
    const Icon = look.icon;
    return (
      <li key={key} className="relative flex items-start gap-3">
        <span className={`z-10 w-8 h-8 shrink-0 rounded-full ring-2 flex items-center justify-center ${look.tone}`}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0 p-2.5 sm:p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60 text-xs">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 font-bold text-slate-800 dark:text-slate-100 leading-snug">{title}</span>
            {at && (
              <span className="shrink-0 text-right font-mono text-[11px] leading-snug text-slate-400">
                {clock(at)}
                {hasStart && offset(at, start) && <span className="block text-slate-400/80">{offset(at, start)}</span>}
              </span>
            )}
          </div>
          {body}
        </div>
      </li>
    );
  };

  return (
    <ModalSheet onClose={onClose} size="sm:max-w-2xl">
      <ModalSheetHeader>
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2 sm:p-2.5 rounded-xl shrink-0 ${riskTone}`}>
            {isHighRisk || isWatch ? <ShieldAlert className="w-5 h-5 sm:w-6 sm:h-6" /> : <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6" />}
          </div>
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
              {t('grading.audit_modal.title')}
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${riskTone}`}>{riskLabel}</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {submission.student?.first_name} {submission.student?.last_name}
              {(submission.student?.student_id || submission.student_id) && ` · ${t('common.student')} ID ${submission.student?.student_id || submission.student_id}`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="shrink-0 p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </ModalSheetHeader>

      <ModalSheetBody className="space-y-5">
        {/* Why it was flagged */}
        {reasons.length > 0 && (
          <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-200">
            <p className="text-xs font-black mb-1.5">{th ? 'เหตุที่ระบบตั้งว่าน่าสงสัย' : 'Why it was flagged'}</p>
            <ul className="space-y-1 text-xs list-disc pl-4 marker:text-rose-400">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Counts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {metrics.map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.label} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 min-w-0">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 truncate">
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{m.label}</span>
                </span>
                <p className={`mt-0.5 text-lg font-black tabular-nums truncate ${m.alert ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}`}>
                  {m.value}
                  {m.unit && <span className="ml-1 text-xs font-semibold">{m.unit}</span>}
                </p>
              </div>
            );
          })}
        </div>

        {/* Timeline, from opening the quiz to handing it in */}
        <div>
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3 flex items-center gap-1.5">
            <span>{t('grading.audit_modal.event_timeline')}</span>
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" aria-label={th ? 'กำลังโหลด' : 'Loading'} />
            ) : (
            <span className="text-xs text-slate-500 font-normal">
              ({sorted.length} {th ? 'รายการ' : sorted.length === 1 ? 'event' : 'events'})
            </span>
            )}
          </h4>

          <ol className="relative space-y-2.5 before:absolute before:left-[15px] before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
            {hasStart &&
              row('start', { icon: Play, tone: 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/60 ring-sky-200 dark:ring-sky-900' }, th ? 'เริ่มทำข้อสอบ' : 'Started the quiz', submission.started_at)}

            {loading && sorted.length === 0 && (
              <li className="relative pl-11 space-y-2" aria-hidden>
                <div className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
                <div className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
              </li>
            )}

            {!loading && sorted.length === 0 && (
              <li className="relative pl-11">
                <p className="p-3 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-xl text-slate-400 text-xs">
                  {th ? 'ไม่พบพฤติกรรมผิดปกติระหว่างทำข้อสอบ' : 'Nothing unusual was recorded during this quiz.'}
                </p>
              </li>
            )}

            {sorted.map((evt, idx) => {
              const isTrip = TRIP_TYPES.has(evt.event_type);
              const seconds = evt.away_duration_seconds || 0;
              return row(
                evt.id || `evt-${idx}`,
                EVENT_LOOK[evt.event_type] || DEFAULT_LOOK,
                t(`grading.audit_modal.event_types.${evt.event_type}`, evt.event_type),
                evt.created_at,
                <>
                  {evt.details && <p className="mt-1 text-slate-600 dark:text-slate-300 leading-relaxed break-words">{evt.details}</p>}
                  {isTrip && seconds > 0 && (
                    <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-md">
                      <Clock className="w-3 h-3" />
                      {th ? `อยู่นอกหน้าข้อสอบ ${formatSeconds(seconds, th)}` : `Away ${formatSeconds(seconds, th)}`}
                    </span>
                  )}
                </>
              );
            })}

            {submission.submitted_at &&
              row(
                'submitted',
                { icon: Send, tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 ring-emerald-200 dark:ring-emerald-900' },
                submission.auto_forfeited ? (th ? 'ระบบส่งกระดาษเปล่า' : 'Blank sheet handed in') : th ? 'ส่งข้อสอบ' : 'Handed in',
                submission.submitted_at,
                submission.time_spent_seconds > 0 ? (
                  <p className="mt-1 text-slate-500 dark:text-slate-400">
                    {th ? `ใช้เวลาทำทั้งหมด ${formatSeconds(submission.time_spent_seconds, th)}` : `Total time ${formatSeconds(submission.time_spent_seconds, th)}`}
                  </p>
                ) : undefined
              )}
          </ol>
        </div>
      </ModalSheetBody>

      <ModalSheetFooter>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium rounded-xl bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white transition-colors cursor-pointer"
        >
          {t('common.close')}
        </button>
      </ModalSheetFooter>
    </ModalSheet>
  );
};
