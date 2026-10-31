'use client';

import { useEffect, useRef, type ReactNode } from 'react';

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
  // Callers pass inline closures; read the latest one without re-running the effect.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    // Keep the page behind from scrolling (and stealing the swipe) while the sheet is open.
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 ${zIndex} flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-xs`}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`relative w-full ${size} flex flex-col max-h-[92dvh] sm:max-h-[90dvh] overflow-hidden bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl`}
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
