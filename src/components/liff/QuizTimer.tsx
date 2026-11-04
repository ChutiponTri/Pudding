'use client';

import { useEffect, useState } from 'react';
import { AlarmClock } from 'lucide-react';

const SOON_MS = 5 * 60 * 1000;
const LAST_MS = 60 * 1000;

type Phase = 'ok' | 'soon' | 'last' | 'up';

const phaseAt = (left: number): Phase => (left <= 0 ? 'up' : left <= LAST_MS ? 'last' : left <= SOON_MS ? 'soon' : 'ok');

const TOASTS: Record<Exclude<Phase, 'ok'>, string> = {
  soon: 'เหลือเวลาไม่ถึง 5 นาที — ตรวจคำตอบแล้วกดส่ง',
  last: 'เหลือเวลา 1 นาที! กดส่งคำตอบได้เลย',
  up: 'หมดเวลาแล้ว! กดส่งคำตอบทันที',
};

function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/**
 * Quiz countdown for the student's answer sheet. Ticks on its own (the page
 * does not re-render every second). When 5 minutes, 1 minute and no time are
 * left, a toast slides in at the top: it never covers the answers or takes
 * taps, so the student keeps working and hands in. The sheet stays open at
 * the bell (the server still accepts sheets that were open, quietly marked
 * late), so the student is simply urged to send now.
 */
export function QuizTimer({ deadline, onPhase }: { deadline: number; onPhase?: (phase: Phase) => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<{ phase: Exclude<Phase, 'ok'>; key: number } | null>(null);
  const left = deadline - now;
  const phase = phaseAt(left);

  useEffect(() => {
    // Every second near the end, otherwise every 15 s.
    const timer = setInterval(() => setNow(Date.now()), left <= SOON_MS + 1000 ? 1000 : 15000);
    return () => clearInterval(timer);
  }, [left <= SOON_MS + 1000]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onPhase?.(phase);
    if (phase === 'ok') return;
    const show = setTimeout(() => setToast({ phase, key: Date.now() }), 0);
    const hide = setTimeout(() => setToast(null), phase === 'up' ? 10000 : 6000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const tone =
    phase === 'up' || phase === 'last'
      ? 'bg-rose-600 text-white shadow-rose-900/30'
      : phase === 'soon'
      ? 'bg-amber-500 text-white shadow-amber-900/30'
      : 'bg-white/90 dark:bg-slate-900/90 text-slate-700 dark:text-slate-200 ring-1 ring-slate-200 dark:ring-slate-700';

  return (
    <>
      <div
        role="timer"
        aria-live="off"
        className={`mx-auto w-fit mb-2 inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-black tabular-nums shadow-md transition-colors ${tone} ${phase === 'up' ? 'animate-pulse' : ''}`}
      >
        <AlarmClock className="w-3.5 h-3.5" />
        {phase === 'up' ? 'หมดเวลา — ส่งคำตอบเลย' : `เหลือ ${clock(left)}`}
      </div>

      {toast && (
        <div className="fixed top-[calc(4rem+env(safe-area-inset-top))] inset-x-0 z-50 mx-auto w-full max-w-md md:max-w-2xl lg:max-w-3xl px-4 pointer-events-none">
          <div
            key={toast.key}
            role="status"
            aria-live="assertive"
            className={`p-3.5 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-2 ${
              toast.phase === 'soon' ? 'bg-amber-500 text-white' : 'bg-rose-600 text-white'
            }`}
          >
            <span className={toast.phase === 'up' ? 'liff-pop' : ''}>
              <AlarmClock className="w-6 h-6 shrink-0" />
            </span>
            <p className="text-sm font-bold leading-snug">⏰ {TOASTS[toast.phase]}</p>
          </div>
        </div>
      )}
    </>
  );
}
