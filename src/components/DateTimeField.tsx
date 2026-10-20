'use client';

import React, { useState } from 'react';
import { Calendar, Clock, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  daysFromNowAt,
  formatDateTime,
  formatRelative,
  localPartsToIso,
  toLocalDateValue,
  toLocalTimeValue,
} from '@/lib/utils/datetime';

type PresetKind = 'deadline' | 'start' | 'none';

const pad = (n: number) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
// Every 5 minutes, plus :59 for "end of day" deadlines.
const MINUTES = [...Array.from({ length: 12 }, (_, i) => pad(i * 5)), '59'];

interface DateTimeFieldProps {
  /** Full ISO string, or '' when empty. */
  value: string;
  onChange: (iso: string) => void;
  /** Quick-pick chips: deadline (today 23:59, +1 day, …) or start (now, +15 min, …). */
  presets?: PresetKind;
  /** Time used when only the date is picked. */
  defaultTime?: string;
  /** Show a clear button and accept ''. */
  allowEmpty?: boolean;
  emptyHint?: string;
  /** Highlight values in the past (deadlines). */
  warnPast?: boolean;
  accent?: 'amber' | 'emerald';
  className?: string;
}

/**
 * Date + time picker that is easy to use on phones and desktops: a native date
 * box that opens on any click, 24-hour hour/minute selects, quick-pick chips,
 * and a readable summary of the chosen moment. Works in ISO so callers never
 * handle timezone-less strings.
 */
export function DateTimeField({
  value,
  onChange,
  presets = 'deadline',
  defaultTime = presets === 'start' ? '08:00' : '23:59',
  allowEmpty = false,
  emptyHint,
  warnPast = presets === 'deadline',
  accent = 'amber',
  className = '',
}: DateTimeFieldProps) {
  const { language } = useLanguage();
  const th = language === 'th';

  const [date, setDate] = useState(() => toLocalDateValue(value));
  const [time, setTime] = useState(() => toLocalTimeValue(value) || defaultTime);

  const [now, setNow] = useState(() => Date.now());

  // Follow changes made by the parent (e.g. loading a saved deadline).
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    if (!value) {
      setDate('');
    } else if (value !== localPartsToIso(date, time)) {
      setDate(toLocalDateValue(value));
      setTime(toLocalTimeValue(value) || defaultTime);
    }
  }

  const commit = (nextDate: string, nextTime: string) => {
    setNow(Date.now());
    setDate(nextDate);
    setTime(nextTime);
    const iso = localPartsToIso(nextDate, nextTime || defaultTime);
    if (iso || allowEmpty) onChange(iso);
  };

  const setIso = (iso: string) => commit(toLocalDateValue(iso), toLocalTimeValue(iso));

  const addDays = (days: number) => {
    const base = value ? new Date(value) : new Date(localPartsToIso(toLocalDateValue(new Date().toISOString()), defaultTime));
    base.setDate(base.getDate() + days);
    setIso(base.toISOString());
  };

  const openPicker = (e: React.MouseEvent<HTMLInputElement>) => {
    try {
      e.currentTarget.showPicker?.();
    } catch {
      // Some browsers only allow showPicker from certain gestures; typing still works.
    }
  };

  const chips: Array<{ label: string; onClick: () => void }> =
    presets === 'deadline'
      ? [
          { label: th ? 'วันนี้ 23:59' : 'Today 23:59', onClick: () => setIso(daysFromNowAt(0, 23, 59)) },
          { label: th ? 'พรุ่งนี้ 08:00' : 'Tomorrow 08:00', onClick: () => setIso(daysFromNowAt(1, 8)) },
          { label: th ? 'พรุ่งนี้ 23:59' : 'Tomorrow 23:59', onClick: () => setIso(daysFromNowAt(1, 23, 59)) },
          { label: '+1 ' + (th ? 'วัน' : 'day'), onClick: () => addDays(1) },
          { label: '+3 ' + (th ? 'วัน' : 'days'), onClick: () => addDays(3) },
          { label: '+1 ' + (th ? 'สัปดาห์' : 'week'), onClick: () => addDays(7) },
        ]
      : presets === 'start'
      ? [
          { label: th ? 'ตอนนี้' : 'Now', onClick: () => setIso(new Date().toISOString()) },
          { label: th ? 'อีก 15 นาที' : 'In 15 min', onClick: () => setIso(new Date(Date.now() + 15 * 60000).toISOString()) },
          { label: th ? 'พรุ่งนี้ 08:00' : 'Tomorrow 08:00', onClick: () => setIso(daysFromNowAt(1, 8)) },
        ]
      : [];

  const [hour, minute] = (time || defaultTime).split(':');
  // Keep a saved time like 10:07 selectable even though it is off the 5-minute grid.
  const minuteOptions = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort();

  const isPast = warnPast && !!value && new Date(value).getTime() < now;
  const focus = accent === 'emerald' ? 'focus:border-emerald-500' : 'focus:border-amber-500';
  const icon = accent === 'emerald' ? 'text-emerald-500' : 'text-amber-500';
  const focusWithin = accent === 'emerald' ? 'focus-within:border-emerald-500' : 'focus-within:border-amber-500';
  const selectBase =
    'py-2.5 bg-transparent text-sm font-semibold tabular-nums text-slate-900 dark:text-white focus:outline-hidden cursor-pointer';
  const inputBase = `w-full pl-9 pr-2 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white focus:outline-hidden ${focus} cursor-pointer`;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-stretch gap-2">
        <div className="relative flex-1 min-w-36">
          <Calendar className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${icon}`} />
          <input
            type="date"
            value={date}
            onClick={openPicker}
            onChange={(e) => commit(e.target.value, time)}
            aria-label={th ? 'วันที่' : 'Date'}
            className={`${inputBase} min-w-0 appearance-none`}
          />
        </div>
        {/* Hour/minute selects instead of <input type="time">, which shows AM/PM in some locales. */}
        <div
          className={`flex items-center gap-1 pl-3 pr-1 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shrink-0 ${focusWithin}`}
        >
          <Clock className={`w-4 h-4 shrink-0 pointer-events-none ${icon}`} />
          <select
            value={hour}
            onChange={(e) => commit(date || toLocalDateValue(new Date().toISOString()), `${e.target.value}:${minute}`)}
            aria-label={th ? 'ชั่วโมง' : 'Hour'}
            className={selectBase}
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <span className="text-sm font-bold text-slate-400">:</span>
          <select
            value={minute}
            onChange={(e) => commit(date || toLocalDateValue(new Date().toISOString()), `${hour}:${e.target.value}`)}
            aria-label={th ? 'นาที' : 'Minute'}
            className={selectBase}
          >
            {minuteOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {th && <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 pr-1">น.</span>}
        </div>
        {allowEmpty && value && (
          <button
            type="button"
            onClick={() => commit('', defaultTime)}
            title={th ? 'ล้างค่า' : 'Clear'}
            className="px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={chip.onClick}
              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-amber-100 dark:hover:bg-amber-950 text-slate-700 dark:text-slate-300 text-[11px] font-bold transition-colors cursor-pointer"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      <p className={`text-[11px] font-semibold break-words ${isPast ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
        {value ? (
          <>
            {formatDateTime(value, language)} <span className="opacity-80">({formatRelative(value, language, now)})</span>
          </>
        ) : (
          emptyHint || (th ? 'ยังไม่ได้เลือกวันเวลา' : 'No date selected')
        )}
      </p>
    </div>
  );
}
