'use client';

import React, { useState } from 'react';
import { Calendar, Clock, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  formatDateTime,
  formatRelative,
  localPartsToIso,
  toLocalDateValue,
  toLocalTimeValue,
} from '@/lib/utils/datetime';

type PresetKind = 'deadline' | 'start' | 'none';

const pad = (n: number) => String(n).padStart(2, '0');
/** ISO time `minutes` from now (called from event handlers only). */
const isoFromNow = (minutes = 0) => new Date(Date.now() + minutes * 60000).toISOString();
const clockNow = () => Date.now();
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
  /** Highlight values in the past and stop the date picker before today (deadlines). */
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
    setNow(clockNow());
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

  // Quick picks in labelled rows: fixed moments ("set to") and shifts of the current value ("add").
  // A fixed moment is highlighted while it is the chosen value.
  type Chip = { label: string; onClick: () => void; target?: string };
  // Targets come from the `now` state (not a fresh clock read) so rendering stays pure.
  const dayAt = (days: number, hours: number, minutes = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hours, minutes, 0, 0);
    return d.toISOString();
  };
  const fixed = (label: string, target: string): Chip => ({ label, target, onClick: () => setIso(target) });
  const chipRows: Array<{ title: string; chips: Chip[] }> =
    presets === 'deadline'
      ? [
          {
            title: th ? 'ตั้งเป็น' : 'Set to',
            chips: [
              fixed(th ? 'วันนี้ 23:59' : 'Today 23:59', dayAt(0, 23, 59)),
              fixed(th ? 'พรุ่งนี้ 08:00' : 'Tmrw 08:00', dayAt(1, 8)),
              fixed(th ? 'พรุ่งนี้ 23:59' : 'Tmrw 23:59', dayAt(1, 23, 59)),
            ],
          },
          {
            title: th ? 'เลื่อนออก' : 'Add',
            chips: [
              { label: '+1 ' + (th ? 'วัน' : 'day'), onClick: () => addDays(1) },
              { label: '+3 ' + (th ? 'วัน' : 'days'), onClick: () => addDays(3) },
              { label: '+1 ' + (th ? 'สัปดาห์' : 'week'), onClick: () => addDays(7) },
            ],
          },
        ]
      : presets === 'start'
      ? [
          {
            title: th ? 'ตั้งเป็น' : 'Set to',
            chips: [
              { label: th ? 'ตอนนี้' : 'Now', onClick: () => setIso(isoFromNow()) },
              { label: th ? 'อีก 15 นาที' : 'In 15 min', onClick: () => setIso(isoFromNow(15)) },
              fixed(th ? 'พรุ่งนี้ 08:00' : 'Tmrw 08:00', dayAt(1, 8)),
            ],
          },
        ]
      : [];
  const sameMinute = (a: string, b: string) => !!a && !!b && Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 60000;

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
            min={warnPast ? toLocalDateValue(new Date(now).toISOString()) : undefined}
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

      {chipRows.length > 0 && (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1.5">
          {chipRows.map((row) => (
            <React.Fragment key={row.title}>
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 whitespace-nowrap">{row.title}</span>
              <div className="grid grid-cols-3 gap-1.5">
                {row.chips.map((chip) => {
                  const active = !!chip.target && sameMinute(value, chip.target);
                  return (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={chip.onClick}
                      aria-pressed={chip.target ? active : undefined}
                      className={`min-w-0 h-8 px-2 rounded-lg border text-[11px] font-bold truncate transition-colors cursor-pointer ${
                        active
                          ? accent === 'emerald'
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'bg-amber-500 border-amber-500 text-slate-950'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                      }`}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </React.Fragment>
          ))}
        </div>
      )}

      <p className={`text-[11px] font-semibold break-words ${isPast ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
        {value ? (
          <>
            {formatDateTime(value, language)} <span className="opacity-80">({formatRelative(value, language, now)})</span>
            {isPast && <> · {th ? 'กรุณาเลือกเวลาในอนาคต' : 'Please pick a future time'}</>}
          </>
        ) : (
          emptyHint || (th ? 'ยังไม่ได้เลือกวันเวลา' : 'No date selected')
        )}
      </p>
    </div>
  );
}
