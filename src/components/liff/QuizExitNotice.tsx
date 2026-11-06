'use client';

import { ShieldAlert } from 'lucide-react';
import type { QuizOpenResult } from '@/lib/utils/quizExit';

/** What happens on the next exit, in words for the student. */
export function quizExitRule(result: Pick<QuizOpenResult, 'exits' | 'warnings'>): string {
  const left = result.warnings - result.exits;
  return left <= 0 ? 'ออกอีกครั้ง = ส่งกระดาษเปล่า (0 คะแนน)' : `เตือนได้อีก ${left} ครั้ง แล้วส่งกระดาษเปล่า (0 คะแนน)`;
}

/** What leaving a quiz before handing in costs, for the leave confirmation. */
export function quizLeaveWarning(result: QuizOpenResult | null): string {
  if (!result?.tracked) return 'ออกจากหน้านี้? (คำตอบจะยังไม่ถูกส่ง)';
  const next = result.exits + 1;
  return result.exits >= result.warnings
    ? 'ออกจากข้อสอบ? คำตอบยังไม่ถูกส่ง\nเปิดใหม่ = ส่งกระดาษเปล่า (0 คะแนน)'
    : `ออกจากข้อสอบ? คำตอบยังไม่ถูกส่ง\nเปิดใหม่นับเป็นครั้งที่ ${next}/${result.warnings}`;
}

/**
 * Student LIFF: shown when a quiz is opened again after the student closed it
 * (LINE's X, or leaving the quiz) without handing in. They must acknowledge it.
 */
export function QuizExitWarningSheet({ result, onClose }: { result: QuizOpenResult; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="quiz-exit-title"
        className="w-full sm:max-w-xs max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] shadow-2xl space-y-3.5"
      >
        <div className="flex flex-col items-center text-center gap-2.5">
          <span className="submit-shake w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6" />
          </span>
          <div className="space-y-0.5">
            <h2 id="quiz-exit-title" className="text-base font-black text-slate-900 dark:text-white">
              ออกจากข้อสอบ ครั้งที่ {result.exits}/{result.warnings}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">คำตอบเดิมไม่ถูกบันทึก ต้องตอบใหม่</p>
          </div>
        </div>
        <p className="text-xs text-center font-semibold px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 text-rose-800 dark:text-rose-200">
          {quizExitRule(result)}
        </p>
        <button
          type="button"
          onClick={onClose}
          autoFocus
          className="w-full h-11 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-sm cursor-pointer active:scale-[0.98] transition-transform"
        >
          รับทราบ ทำข้อสอบต่อ
        </button>
      </div>
    </div>
  );
}

/**
 * Shown to the student only on a hand-in the server flagged (is_flagged_suspicious), and
 * never with a reason: what the system watches stays the teacher's to know.
 */
export function SuspiciousLabel({ className = '' }: { className?: string }) {
  return (
    <p className={`flex items-center justify-center gap-1.5 text-xs font-bold text-rose-700 dark:text-rose-300 ${className}`}>
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 dark:bg-rose-950/70 ring-1 ring-rose-200 dark:ring-rose-900">
        <ShieldAlert className="w-3.5 h-3.5" /> ระบบตรวจพบพฤติกรรมน่าสงสัย
      </span>
    </p>
  );
}
