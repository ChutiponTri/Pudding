'use client';

import React from 'react';
import { AlertTriangle, ChevronRight, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { isSuspiciousActivity } from '@/lib/utils/integrity';

interface AntiCheatingBadgeProps {
  isFlagged: boolean;
  tabSwitchCount: number;
  totalTimeAwaySeconds: number;
  /** Times the student closed the quiz and opened it again before handing in. */
  quizExitCount?: number | null;
  /** The system handed in a blank sheet after too many exits. */
  autoForfeited?: boolean | null;
  /** Opens the behaviour log; the chip is only a button when given (and something was recorded). */
  onClick?: () => void;
  /** Show the one-line counts under the chip. */
  showDetails?: boolean;
}

/** 35 → "35 วิ", 125 → "2:05 นาที". */
function formatAway(seconds: number, th: boolean) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return th ? `${s} วิ` : `${s}s`;
  const m = Math.floor(s / 60);
  const rest = String(s % 60).padStart(2, '0');
  return th ? `${m}:${rest} นาที` : `${m}:${rest} min`;
}

/**
 * One compact chip per level (normal / watch / suspicious) plus, when
 * anything was recorded, a single muted line of counts. The chip itself opens
 * the behaviour log, so no separate link is needed.
 */
export const AntiCheatingBadge: React.FC<AntiCheatingBadgeProps> = ({
  isFlagged,
  tabSwitchCount,
  totalTimeAwaySeconds,
  quizExitCount,
  autoForfeited,
  onClick,
  showDetails = true,
}) => {
  const { language } = useLanguage();
  const th = language === 'th';

  // Same limits as every count (isIntegrityFlagged): flagged means "suspicious"; any lesser activity is a watch.
  const exits = quizExitCount || 0;
  const switches = tabSwitchCount || 0;
  const away = totalTimeAwaySeconds || 0;
  const isSevere = isFlagged || exits > 0 || isSuspiciousActivity(switches, away);
  const isModerate = !isSevere && (switches > 0 || away > 0);

  if (!isSevere && !isModerate) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap"
        title={th ? 'พฤติกรรมปกติ ไม่พบการออกจากหน้าข้อสอบ' : 'Normal behaviour, never left the quiz'}
      >
        <ShieldCheck className="w-3.5 h-3.5" />
        {th ? 'ปกติ' : 'Normal'}
      </span>
    );
  }

  const details = [
    switches > 0 && (th ? `ออกจอ ${switches} ครั้ง` : `Left ${switches}×`),
    away > 0 && (th ? `นอกจอ ${formatAway(away, th)}` : `away ${formatAway(away, th)}`),
    exits > 0 && (th ? `ปิดข้อสอบ ${exits} ครั้ง` : `closed quiz ${exits}×`),
  ].filter(Boolean) as string[];

  const tone = isSevere
    ? 'bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900 dark:hover:bg-rose-900/60'
    : 'bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900 dark:hover:bg-amber-900/50';
  const Icon = isSevere ? ShieldAlert : AlertTriangle;
  const label = isSevere ? (th ? 'น่าสงสัย' : 'Suspicious') : th ? 'เฝ้าระวัง' : 'Watch';
  const chipClass = `inline-flex items-center gap-1 h-6 pl-2 ${onClick ? 'pr-1' : 'pr-2'} rounded-full ring-1 text-[11px] font-bold whitespace-nowrap transition-colors ${tone}`;
  const chipContent = (
    <>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{label}</span>
      {autoForfeited && (
        <span className="ml-0.5 px-1.5 rounded-full bg-rose-600 text-white text-[10px] leading-4">{th ? 'ส่งเปล่า' : 'Blank'}</span>
      )}
      {onClick && <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
    </>
  );
  const fullText = [label, ...details, autoForfeited ? (th ? 'ระบบส่งกระดาษเปล่าอัตโนมัติ' : 'auto-submitted blank') : '']
    .filter(Boolean)
    .join(' • ');

  return (
    <span className="inline-flex flex-col items-start gap-0.5 min-w-0">
      {onClick ? (
        <button type="button" onClick={onClick} className={`${chipClass} cursor-pointer`} title={th ? `${fullText} — ดูบันทึกพฤติกรรม` : `${fullText} — view log`}>
          {chipContent}
        </button>
      ) : (
        <span className={chipClass} title={fullText}>
          {chipContent}
        </span>
      )}
      {showDetails && details.length > 0 && (
        <span className="text-[11px] leading-tight text-slate-500 dark:text-slate-400 whitespace-nowrap">{details.join(' · ')}</span>
      )}
    </span>
  );
};
