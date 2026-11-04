'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, PencilLine, Send, X } from 'lucide-react';

/** How long the confirm button waits before it accepts a tap: a double tap on "send" never confirms. */
const ARM_MS = 700;

export type SubmitReview =
  | {
      kind: 'confirm';
      isExam: boolean;
      isEdit: boolean;
      answered: number;
      total: number;
      /** Question numbers left blank (optional ones for homework; any for quizzes). */
      unanswered: number[];
      /** Extra lines to read before sending (borrowed phone, late, …). */
      notes: string[];
    }
  | {
      kind: 'blocked';
      title: string;
      message: string;
      /** Question to scroll to after closing. */
      questionId?: string;
    };

function AnsweredRing({ answered, total }: { answered: number; total: number }) {
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const ratio = total > 0 ? answered / total : 1;
  const offset = circumference * (1 - ratio);
  const complete = answered >= total;
  return (
    <div className="relative w-24 h-24 shrink-0">
      <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90" aria-hidden>
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-slate-100 dark:stroke-slate-800" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`submit-ring ${complete ? 'stroke-line' : 'stroke-amber-500'}`}
          style={{ ['--ring-from' as string]: `${circumference}` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="liff-pop text-xl font-black tabular-nums text-slate-900 dark:text-white">
          {answered}
          <span className="text-sm font-bold text-slate-400">/{total}</span>
        </span>
        <span className="text-[10px] font-semibold text-slate-500">ตอบแล้ว</span>
      </div>
    </div>
  );
}

/**
 * Student LIFF: every hand-in asks first. Shows how much is answered, what is
 * still blank and what happens after sending (a quiz cannot be retaken,
 * homework is locked until the teacher allows an edit). The confirm button
 * arms after a moment, so a stray double tap on "send" cannot hand in.
 * `blocked` explains why the work cannot be sent yet (nothing answered,
 * required questions, a bad link).
 */
export function SubmitConfirmSheet({
  review,
  submitting,
  onConfirm,
  onClose,
}: {
  review: SubmitReview;
  submitting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), ARM_MS);
    return () => clearTimeout(timer);
  }, []);

  const close = () => !submitting && onClose();

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-950/55 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="submit-confirm-title"
        className="w-full sm:max-w-sm max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 p-5 sm:p-6 pb-[max(env(safe-area-inset-bottom),1.25rem)] shadow-2xl space-y-4"
      >
        <div className="sm:hidden mx-auto -mt-1 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
        <div className="flex justify-end -mb-2">
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            aria-label="ปิด"
            className="w-9 h-9 -mr-1 -mt-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 cursor-pointer disabled:opacity-50"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {review.kind === 'blocked' ? (
          <>
            <div className="flex flex-col items-center text-center gap-3">
              <span className="submit-shake w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <AlertTriangle className="w-8 h-8" />
              </span>
              <div className="space-y-1.5">
                <h2 id="submit-confirm-title" className="text-lg font-black text-slate-900 dark:text-white">{review.title}</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">{review.message}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              autoFocus
              className="w-full h-12 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-sm cursor-pointer active:scale-[0.98] transition-transform"
            >
              กลับไปตอบ
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-4">
              {review.total > 0 ? (
                <AnsweredRing answered={review.answered} total={review.total} />
              ) : (
                <span className="liff-pop w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950 text-line flex! items-center justify-center shrink-0">
                  <CheckCircle2 className="w-8 h-8" />
                </span>
              )}
              <div className="min-w-0 space-y-1">
                <h2 id="submit-confirm-title" className="text-lg font-black text-slate-900 dark:text-white leading-snug">
                  {review.isEdit ? 'ยืนยันส่งงานที่แก้ไข?' : review.isExam ? 'ยืนยันส่งคำตอบ?' : 'ยืนยันส่งงาน?'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {review.isExam
                    ? 'ส่งแล้วจะแก้ไขหรือทำใหม่ไม่ได้'
                    : review.isEdit
                    ? 'งานเดิมจะถูกแทนที่ และคุณครูจะตรวจงานนี้ใหม่'
                    : 'ส่งแล้วจะแก้ไขไม่ได้ จนกว่าคุณครูจะเปิดให้แก้ไข'}
                </p>
              </div>
            </div>

            {review.unanswered.length > 0 && (
              <div className="liff-rise flex items-start gap-2 p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 text-amber-900 dark:text-amber-200 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <b>ยังไม่ได้ตอบ {review.unanswered.length} ข้อ</b>
                  <span className="block mt-0.5 opacity-80">ข้อ {review.unanswered.join(', ')}</span>
                </span>
              </div>
            )}
            {review.notes.map((note) => (
              <p key={note} className="liff-rise text-xs leading-relaxed p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 whitespace-pre-line">
                {note}
              </p>
            ))}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={close}
                disabled={submitting}
                className="h-12 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm cursor-pointer active:scale-[0.98] transition-transform inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <PencilLine className="w-4 h-4" />
                กลับไปแก้
              </button>
              <button
                type="button"
                onClick={() => armed && !submitting && onConfirm()}
                disabled={!armed || submitting}
                aria-disabled={!armed || submitting}
                className="relative overflow-hidden h-12 rounded-2xl bg-line/40 text-white font-bold text-sm cursor-pointer active:scale-[0.98] transition-transform inline-flex items-center justify-center gap-1.5 disabled:cursor-wait shadow-lg shadow-emerald-600/25"
              >
                <span aria-hidden className="submit-arm absolute inset-0 bg-line" style={{ ['--arm-ms' as string]: `${ARM_MS}ms` }} />
                <span className="relative inline-flex items-center gap-1.5">
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {submitting ? 'กำลังส่ง...' : 'ยืนยันส่ง'}
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
