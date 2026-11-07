'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { subscribeFetchActivity } from '@/lib/net/fetchActivity';

/** Wait this long before showing (fast requests never flash), then stay at least this long. */
const SHOW_AFTER_MS = 250;
const MIN_VISIBLE_MS = 400;

/**
 * Teacher pages: a thin bar across the top and a small "loading" chip whenever
 * the page is still fetching data (first load or a refresh after a change), so
 * a half-filled page reads as "still loading", not as missing data.
 */
export const FetchActivityBar: React.FC = () => {
  const { language } = useLanguage();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let shownAt = 0;
    const unsubscribe = subscribeFetchActivity((count) => {
      if (count > 0) {
        clearTimeout(hideTimer);
        if (!shownAt && !showTimer) {
          showTimer = setTimeout(() => {
            showTimer = undefined;
            shownAt = Date.now();
            setVisible(true);
          }, SHOW_AFTER_MS);
        }
        return;
      }
      clearTimeout(showTimer);
      showTimer = undefined;
      if (!shownAt) return;
      hideTimer = setTimeout(() => {
        shownAt = 0;
        setVisible(false);
      }, Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt)));
    });
    return () => {
      unsubscribe();
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  return (
    <>
      <div
        aria-hidden
        className={`fixed top-0 inset-x-0 z-100 h-0.5 overflow-hidden pointer-events-none transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="h-full w-full bg-amber-500 animate-fetch-bar" />
      </div>
      <div
        role="status"
        aria-live="polite"
        className={`fixed z-100 top-[calc(env(safe-area-inset-top)+0.6rem)] left-1/2 -translate-x-1/2 pointer-events-none transition-all duration-300 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
        }`}
      >
        {visible && (
          <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-slate-900/90 dark:bg-white/90 text-white dark:text-slate-900 text-[11px] font-bold shadow-lg backdrop-blur">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {language === 'th' ? 'กำลังโหลดข้อมูล…' : 'Loading data…'}
          </span>
        )}
      </div>
    </>
  );
};

/** Placeholder blocks shaped like the content that is on its way. */
export const SkeletonBlock: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`rounded-2xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse ${className}`} />
);

/** A short "loading" line with a spinner, for sections that wait on their own data. */
export const LoadingLine: React.FC<{ label?: string; className?: string }> = ({ label, className = '' }) => {
  const { language } = useLanguage();
  return (
    <div role="status" className={`flex items-center justify-center gap-2 py-8 text-xs font-semibold text-slate-400 ${className}`}>
      <Loader2 className="w-4 h-4 animate-spin" />
      <span>{label || (language === 'th' ? 'กำลังโหลด…' : 'Loading…')}</span>
    </div>
  );
};

const PANEL = 'rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs';

/** Page title + subtitle, like each page's heading. */
const TitleSkeleton: React.FC = () => (
  <div className="space-y-2">
    <SkeletonBlock className="h-7 w-48 sm:w-64" />
    <SkeletonBlock className="h-3.5 w-64 sm:w-96 max-w-full" />
  </div>
);

export type PageSkeletonVariant = 'dashboard' | 'list' | 'classroom' | 'grading' | 'form' | 'card';

/**
 * The target page's layout drawn as placeholders while it loads, instead of a
 * blank screen with a spinner: the teacher sees where things will appear.
 */
export const PageSkeleton: React.FC<{ variant?: PageSkeletonVariant; label?: string }> = ({ variant = 'list', label }) => {
  const { language } = useLanguage();
  const th = language === 'th';
  const status = <span className="sr-only">{label || (th ? 'กำลังโหลด…' : 'Loading…')}</span>;

  if (variant === 'card') {
    return (
      <div className="min-h-[60dvh] flex items-center justify-center p-4" role="status" aria-busy="true">
        {status}
        <div className={`${PANEL} w-full max-w-md p-6 space-y-4`}>
          <SkeletonBlock className="h-14 w-14 mx-auto rounded-3xl" />
          <SkeletonBlock className="h-5 w-2/3 mx-auto" />
          <SkeletonBlock className="h-3.5 w-5/6 mx-auto" />
          {label && <LoadingLine className="py-1" label={label} />}
          <SkeletonBlock className="h-11" />
        </div>
      </div>
    );
  }

  if (variant === 'form') {
    return (
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6 pb-24" role="status" aria-busy="true">
        {status}
        <SkeletonBlock className="h-8 w-28" />
        <div className={`${PANEL} p-4 sm:p-6 space-y-4`}>
          {label && <LoadingLine className="py-2" label={label} />}
          <SkeletonBlock className="h-11" />
          <SkeletonBlock className="h-24" />
          <div className="grid sm:grid-cols-2 gap-3">
            <SkeletonBlock className="h-11" />
            <SkeletonBlock className="h-11" />
          </div>
        </div>
        <div className={`${PANEL} p-4 sm:p-6 space-y-3`}>
          {[0, 1, 2].map((i) => (
            <SkeletonBlock key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'grading') {
    return (
      <div className="space-y-5 sm:space-y-6 pb-20" role="status" aria-busy="true">
        {status}
        <SkeletonBlock className="h-4 w-32" />
        <div className={`${PANEL} p-3 sm:p-6 space-y-3`}>
          <SkeletonBlock className="h-4 w-20" />
          <SkeletonBlock className="h-6 w-2/3" />
          <SkeletonBlock className="h-3.5 w-1/2" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonBlock key={i} className="h-16" />
            ))}
          </div>
        </div>
        <div className={`${PANEL} overflow-hidden`}>
          <LoadingLine label={label || (th ? 'กำลังโหลดรายชื่อนักเรียนและงานที่ส่ง…' : 'Loading students and submissions…')} />
          <div className="px-3 sm:px-6 pb-4 space-y-2.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <SkeletonBlock key={i} className="h-12" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'classroom') {
    return (
      <div className="space-y-4 sm:space-y-6 pb-20" role="status" aria-busy="true">
        {status}
        <SkeletonBlock className="h-4 w-28" />
        {/* Classroom banner */}
        <div className={`${PANEL} p-4 sm:p-6 space-y-3`}>
          <div className="flex items-center gap-3">
            <SkeletonBlock className="w-12 h-12 shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-6 w-1/2" />
              <SkeletonBlock className="h-3.5 w-1/3" />
            </div>
          </div>
          {label && <LoadingLine className="py-1 justify-start" label={label} />}
        </div>
        {/* Tabs */}
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonBlock key={i} className="h-9 w-24 shrink-0 rounded-xl" />
          ))}
        </div>
        {/* Tab content */}
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${PANEL} p-4 space-y-2.5`}>
              <SkeletonBlock className="h-4 w-1/3" />
              <SkeletonBlock className="h-3.5 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'dashboard') {
    return (
      <div className="space-y-5 sm:space-y-6" role="status" aria-busy="true">
        {status}
        <TitleSkeleton />
        <div className="grid grid-cols-4 gap-2 sm:gap-4">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBlock key={i} className="h-20 sm:h-28" />
          ))}
        </div>
        <SkeletonBlock className="h-10 w-full sm:w-80" />
        <div className="space-y-3 sm:space-y-6">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${PANEL} p-4 sm:p-6 space-y-3`}>
              <SkeletonBlock className="h-5 w-1/3" />
              <SkeletonBlock className="h-3.5 w-1/2" />
              <div className="grid sm:grid-cols-2 gap-3 pt-1">
                <SkeletonBlock className="h-20" />
                <SkeletonBlock className="h-20 hidden sm:block" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 'list': heading, a row of filters, then cards (works, students, combined grading).
  return (
    <div className="space-y-4 sm:space-y-6" role="status" aria-busy="true">
      {status}
      <TitleSkeleton />
      <div className="flex flex-wrap gap-2">
        <SkeletonBlock className="h-10 w-full sm:w-72" />
        <SkeletonBlock className="h-10 w-28" />
        <SkeletonBlock className="h-10 w-28" />
      </div>
      {label && <LoadingLine className="py-2" label={label} />}
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${PANEL} p-4 flex items-center gap-3`}>
            <SkeletonBlock className="w-10 h-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-1/2" />
              <SkeletonBlock className="h-3.5 w-1/3" />
            </div>
            <SkeletonBlock className="h-8 w-20 hidden sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
};

/** A whole teacher screen (top bar + page) as placeholders, for covers drawn above the app shell. */
export const ShellSkeleton: React.FC = () => (
  <div className="min-h-dvh flex flex-col" aria-busy="true">
    <div className="h-14 sm:h-16 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 px-4 sm:px-6 flex items-center justify-between gap-3">
      <SkeletonBlock className="h-8 w-28" />
      <SkeletonBlock className="h-8 w-8 rounded-full" />
    </div>
    <div className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      <PageSkeleton variant="dashboard" />
    </div>
  </div>
);
