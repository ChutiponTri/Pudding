'use client';

import React from 'react';
import { AlertTriangle, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface AntiCheatingBadgeProps {
  isFlagged: boolean;
  tabSwitchCount: number;
  totalTimeAwaySeconds: number;
  onClick?: () => void;
  showDetails?: boolean;
}

export const AntiCheatingBadge: React.FC<AntiCheatingBadgeProps> = ({
  isFlagged,
  tabSwitchCount,
  totalTimeAwaySeconds,
  onClick,
  showDetails = true,
}) => {
  const { t, language } = useLanguage();

  const isSevere = isFlagged || tabSwitchCount >= 4 || totalTimeAwaySeconds >= 60;
  const isModerate = !isSevere && (tabSwitchCount > 0 || totalTimeAwaySeconds > 10);

  if (!isSevere && !isModerate) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 transition-colors hover:bg-emerald-100"
        title={language === 'th' ? 'พฤติกรรมปกติ ไม่พบการสลับหน้าจอ' : 'Normal behavior, no tab switches recorded'}
      >
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
        <span>{language === 'th' ? 'ปกติ' : 'Normal'}</span>
      </button>
    );
  }

  if (isSevere) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-800 transition-all hover:bg-rose-100 dark:hover:bg-rose-900/60 shadow-xs cursor-pointer group"
        title={t('grading.audit_modal.title')}
      >
        <ShieldAlert className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 animate-pulse" />
        <span>{language === 'th' ? 'พฤติกรรมน่าสงสัย' : 'Flagged Suspicious'}</span>
        {showDetails && (
          <span className="bg-rose-200/80 dark:bg-rose-900 text-rose-800 dark:text-rose-200 px-1.5 py-0.2 rounded text-[11px]">
            {tabSwitchCount} {language === 'th' ? 'ครั้ง' : 'switches'} ({totalTimeAwaySeconds}s)
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800 transition-colors hover:bg-amber-100 cursor-pointer"
      title={t('grading.audit_modal.title')}
    >
      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
      <span>{language === 'th' ? 'เฝ้าระวัง' : 'Watchlist'}</span>
      {showDetails && (
        <span className="bg-amber-200/60 dark:bg-amber-900 text-amber-900 dark:text-amber-200 px-1.5 py-0.2 rounded text-[11px]">
          {tabSwitchCount} {language === 'th' ? 'ครั้ง' : 'sw'}
        </span>
      )}
    </button>
  );
};
