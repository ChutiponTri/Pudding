'use client';

import React from 'react';
import { Check, Clock, X } from 'lucide-react';

export type JoinApprovalState = 'waiting' | 'approved' | 'rejected';

const STEPS = ['กรอกข้อมูล', 'ส่งคำขอ', 'ครูอนุมัติ'] as const;
const R = 52;
const C = 2 * Math.PI * R;
const GAP = 10; // px of circumference between segments
const SEG = C / STEPS.length - GAP;

/**
 * Progress ring for a student's request to join a classroom: profile filled
 * in, request sent, teacher approval. The last segment spins while the
 * teacher has not answered and fills in once they accept.
 */
export function JoinApprovalRing({
  state,
  classroomName,
  target,
  compact = false,
}: {
  state: JoinApprovalState;
  classroomName: string;
  /** What opens after approval, e.g. "งาน “ใบงานที่ 1”". */
  target?: string;
  compact?: boolean;
}) {
  const done = state === 'approved' ? 3 : 2;
  const size = compact ? 'w-24 h-24' : 'w-36 h-36';
  const stroke =
    state === 'rejected' ? 'stroke-rose-500' : state === 'approved' ? 'stroke-emerald-500' : 'stroke-brand';

  return (
    <div className={`flex ${compact ? 'items-center gap-4 text-left' : 'flex-col items-center gap-5 text-center'}`}>
      <div className={`relative shrink-0 ${size}`}>
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          {STEPS.map((_, i) => {
            const filled = i < done;
            const isWaiting = state === 'waiting' && i === 2;
            return (
              <circle
                key={i}
                cx="60"
                cy="60"
                r={R}
                fill="none"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={`${SEG} ${C - SEG}`}
                strokeDashoffset={-(i * (SEG + GAP))}
                className={`transition-all duration-700 ${
                  state === 'rejected' && i === 2
                    ? 'stroke-rose-500'
                    : filled
                    ? stroke
                    : isWaiting
                    ? 'stroke-amber-200 dark:stroke-amber-900/70'
                    : 'stroke-slate-200 dark:stroke-slate-800'
                }`}
              />
            );
          })}
          {state === 'waiting' && (
            // A short dash running along the waiting segment.
            <circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${SEG * 0.3} ${C}`}
              className="stroke-amber-500 animate-[join-ring_1.6s_ease-in-out_infinite]"
              style={{ ['--seg-start' as string]: `${-2 * (SEG + GAP)}px`, ['--seg-end' as string]: `${-2 * (SEG + GAP) - SEG * 0.7}px` }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {state === 'approved' ? (
            <span className={`${compact ? 'w-10 h-10' : 'w-14 h-14'} rounded-full bg-emerald-500 text-white flex items-center justify-center animate-[join-pop_.4s_ease-out]`}>
              <Check className={compact ? 'w-6 h-6' : 'w-8 h-8'} strokeWidth={3} />
            </span>
          ) : state === 'rejected' ? (
            <span className={`${compact ? 'w-10 h-10' : 'w-14 h-14'} rounded-full bg-rose-100 dark:bg-rose-950 text-rose-600 flex items-center justify-center`}>
              <X className={compact ? 'w-6 h-6' : 'w-8 h-8'} strokeWidth={3} />
            </span>
          ) : (
            <>
              <Clock className={`${compact ? 'w-6 h-6' : 'w-8 h-8'} text-amber-500`} />
              {!compact && <span className="mt-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">2 / 3</span>}
            </>
          )}
        </div>
      </div>

      <div className="space-y-2 min-w-0">
        <div className="space-y-1">
          <h2 className={`${compact ? 'text-sm' : 'text-lg'} font-bold text-slate-900 dark:text-white`}>
            {state === 'approved'
              ? 'คุณครูอนุมัติแล้ว!'
              : state === 'rejected'
              ? 'คำขอไม่ได้รับการอนุมัติ'
              : 'รอคุณครูอนุมัติเข้าห้อง'}
          </h2>
          <p className={`${compact ? 'text-xs' : 'text-sm'} text-slate-500 dark:text-slate-400`}>
            {state === 'approved'
              ? target
                ? `กำลังเปิด${target}...`
                : `กำลังเข้าห้อง “${classroomName}”...`
              : state === 'rejected'
              ? `ติดต่อคุณครูของห้อง “${classroomName}” หากคิดว่าผิดพลาด`
              : `ส่งคำขอเข้าห้อง “${classroomName}” แล้ว${target ? ` เมื่อคุณครูอนุมัติจะเปิด${target}ให้ทันที` : ' หน้านี้จะเปิดให้เองเมื่อคุณครูอนุมัติ'}`}
          </p>
        </div>
        <ol className={`flex flex-wrap gap-1.5 ${compact ? '' : 'justify-center'}`}>
          {STEPS.map((label, i) => {
            const ok = i < done;
            const current = state === 'waiting' && i === 2;
            return (
              <li
                key={label}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  state === 'rejected' && i === 2
                    ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                    : ok
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : current
                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                    : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                {ok ? <Check className="w-3 h-3" /> : current ? <Clock className="w-3 h-3" /> : null}
                {label}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
