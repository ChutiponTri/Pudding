'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, X, XCircle } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export type ToastTone = 'ok' | 'warn' | 'error';
export type ToastState = { message: string; tone: ToastTone; id: number } | null;

/** Long enough to read a sentence; problems stay up longer than confirmations. */
const DURATION_MS: Record<ToastTone, number> = { ok: 3500, warn: 7000, error: 7000 };

/**
 * One toast at a time. A new toast replaces the old one and restarts the
 * timer (an older timer can never hide a newer toast).
 */
export function useActionToast() {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const hideToast = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const showToast = useCallback((message: string, tone: ToastTone = 'ok') => {
    if (!message) return;
    if (timer.current) clearTimeout(timer.current);
    const id = ++seq.current;
    setToast({ message, tone, id });
    timer.current = setTimeout(() => setToast((current) => (current?.id === id ? null : current)), DURATION_MS[tone]);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { toast, showToast, hideToast };
}

const STYLES: Record<ToastTone, { box: string; icon: React.ReactNode }> = {
  ok: {
    box: 'bg-slate-900 dark:bg-white text-white dark:text-slate-900',
    icon: <Check className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400 dark:text-emerald-600" />,
  },
  warn: {
    box: 'bg-amber-50 dark:bg-amber-950 text-amber-950 dark:text-amber-100 ring-1 ring-amber-300 dark:ring-amber-800',
    icon: <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />,
  },
  error: {
    box: 'bg-rose-50 dark:bg-rose-950 text-rose-950 dark:text-rose-100 ring-1 ring-rose-300 dark:ring-rose-800',
    icon: <XCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />,
  },
};

/** Bottom toast above dialogs (z-[70]); errors are announced to screen readers right away. */
export const ActionToast: React.FC<{ toast: ToastState; onClose: () => void }> = ({ toast, onClose }) => {
  const { tr } = useLanguage();
  if (!toast) return null;
  const style = STYLES[toast.tone];
  return (
    <div
      key={toast.id}
      role={toast.tone === 'ok' ? 'status' : 'alert'}
      aria-live={toast.tone === 'ok' ? 'polite' : 'assertive'}
      className={`fixed bottom-[max(env(safe-area-inset-bottom),1rem)] inset-x-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:max-w-md z-[70] p-4 pr-3 rounded-2xl font-semibold shadow-2xl flex items-start gap-2.5 text-sm animate-in fade-in slide-in-from-bottom-5 ${style.box}`}
    >
      {style.icon}
      <span className="flex-1 min-w-0 wrap-break-word leading-snug">{toast.message}</span>
      <button type="button" onClick={onClose} aria-label={tr('ปิด', 'Close')} className="shrink-0 -mt-0.5 p-1 rounded-lg opacity-60 hover:opacity-100 cursor-pointer">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

/**
 * Reads an API answer for a toast: the server's own `error` and `tone`, or a
 * plain explanation when the answer is not JSON (proxy error, timeout).
 */
export async function readActionResult(response: Response, tr: (th: string, en: string) => string): Promise<{ ok: boolean; data: Record<string, unknown>; message: string; tone: ToastTone }> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.ok) return { ok: true, data, message: '', tone: 'ok' };
  const tone: ToastTone = data.tone === 'warn' ? 'warn' : 'error';
  let message = typeof data.error === 'string' && data.error ? data.error : '';
  if (!message) {
    message = response.status === 401
      ? tr('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'Your session expired. Please sign in again')
      : response.status >= 500
      ? tr(`เซิร์ฟเวอร์ขัดข้อง (รหัส ${response.status}) กรุณาลองใหม่อีกครั้ง`, `Server error (${response.status}). Please try again`)
      : tr(`ทำรายการไม่สำเร็จ (รหัส ${response.status})`, `Request failed (${response.status})`);
  }
  return { ok: false, data, message, tone };
}

/** Message for a request that never got an answer (offline, blocked). */
export const networkErrorMessage = (tr: (th: string, en: string) => string) =>
  tr('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', 'Could not reach the server. Check your connection and try again');
