'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** Close transition length; the popup unmounts (onClose) once it has played. */
export const POPUP_CLOSE_MS = 180;

/**
 * Open / close animation state for a popup. `shown` turns true on the frame after
 * mount (so the enter transition runs from the hidden styles); `close()` plays the
 * exit transition and then calls onClose.
 */
export function usePopupTransition(onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const [shown, setShown] = useState(false);
  const closingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      window.clearTimeout(timerRef.current);
    };
  }, []);
  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setShown(false);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    timerRef.current = window.setTimeout(() => onCloseRef.current(), reduced ? 0 : POPUP_CLOSE_MS);
  }, []);
  return { shown, close };
}

/** Backdrop fade for usePopupTransition. */
export const popupBackdropClass = (shown: boolean) =>
  `transition-opacity motion-reduce:transition-none ${shown ? 'opacity-100 duration-200 ease-out' : 'opacity-0 duration-[180ms] ease-in'}`;

/** Panel motion for usePopupTransition: slides up from the bottom on phones, rises and scales in from `sm` up. */
export const popupPanelClass = (shown: boolean) =>
  `transition-[translate,scale,opacity] will-change-transform motion-reduce:transition-none ${
    shown
      ? 'translate-y-0 sm:scale-100 opacity-100 duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
      : 'max-sm:translate-y-full sm:translate-y-3 sm:scale-[0.97] sm:opacity-0 duration-[180ms] ease-[cubic-bezier(0.4,0,1,1)]'
  }`;

/**
 * Popup shell for long forms. On phones it is a bottom sheet that fills most of the
 * screen; from `sm` up it is a centered card. The header and footer stay put while
 * only the body scrolls, so the title and the Save button are always reachable.
 *
 * Usage:
 *   <ModalSheet onClose={close} size="max-w-2xl">
 *     <ModalSheetHeader>…</ModalSheetHeader>
 *     <ModalSheetBody>…</ModalSheetBody>
 *     <ModalSheetFooter>…</ModalSheetFooter>
 *   </ModalSheet>
 * A <form> may wrap body + footer; give it `className={MODAL_SHEET_FORM}`.
 */
export function ModalSheet({
  onClose,
  size = 'sm:max-w-lg',
  zIndex = 'z-50',
  labelledBy,
  children,
}: {
  onClose: () => void;
  /** Width cap from `sm` up, e.g. "sm:max-w-2xl". */
  size?: string;
  zIndex?: string;
  /** id of the element that titles the dialog. */
  labelledBy?: string;
  children: ReactNode;
}) {
  // Backdrop tap and Escape play the close animation before calling onClose.
  const { shown, close } = usePopupTransition(onClose);

  useEffect(() => {
    // Keep the page behind from scrolling (and stealing the swipe) while the sheet is open.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);

  return (
    <div
      className={`fixed inset-0 ${zIndex} flex items-end sm:items-center justify-center sm:p-4`}
      onClick={close}
    >
      <div className={`absolute inset-0 bg-black/60 backdrop-blur-xs ${popupBackdropClass(shown)}`} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`relative w-full ${size} flex flex-col max-h-[92dvh] sm:max-h-[90dvh] overflow-hidden bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl ${popupPanelClass(shown)}`}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Grab handle: tells phone users this is a sheet. */}
        <div className="sm:hidden shrink-0 flex justify-center pt-2 -mb-1" aria-hidden>
          <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>
        {children}
      </div>
    </div>
  );
}

/** Class for a <form> that wraps ModalSheetBody + ModalSheetFooter. */
export const MODAL_SHEET_FORM = 'flex flex-col flex-1 min-h-0';

export function ModalSheetHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 pt-3 sm:pt-5 pb-3 border-b border-slate-100 dark:border-slate-800 ${className}`}
    >
      {children}
    </div>
  );
}

export function ModalSheetBody({ children, className = 'space-y-5' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 py-4 sm:py-5 ${className}`}>
      {children}
    </div>
  );
}

export function ModalSheetFooter({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`shrink-0 flex flex-wrap items-center justify-end gap-2 px-4 sm:px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 ${className}`}
    >
      {children}
    </div>
  );
}
