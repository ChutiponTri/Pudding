/**
 * Date/time helpers for teacher-entered deadlines.
 *
 * <input type="date|time|datetime-local"> work in the browser's local time and
 * have no timezone, while the database stores TIMESTAMPTZ. Always convert the
 * local parts to a full ISO string before saving, and back again before filling
 * an input — otherwise Postgres reads the value as UTC and the deadline shifts
 * by the UTC offset (7 hours in Thailand).
 */

/** The school timezone, used where there is no browser (server, LINE messages). */
export const SCHOOL_TIME_ZONE = 'Asia/Bangkok';

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO string -> 'YYYY-MM-DD' in the browser's local time ('' if invalid). */
export function toLocalDateValue(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO string -> 'HH:mm' in the browser's local time ('' if invalid). */
export function toLocalTimeValue(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local 'YYYY-MM-DD' + 'HH:mm' -> ISO string ('' if the date is missing). */
export function localPartsToIso(date: string, time: string): string {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '23:59').split(':').map(Number);
  const result = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
  return Number.isNaN(result.getTime()) ? '' : result.toISOString();
}

/** Today/tomorrow/… at a given local clock time, as ISO. */
export function daysFromNowAt(days: number, hours: number, minutes = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

/** e.g. "อ. 20 ต.ค. 2569 · 15:00 น." / "Tue, 20 Oct 2026 · 15:00" */
export function formatDateTime(
  iso: string | null | undefined,
  language: 'th' | 'en' | string = 'th',
  timeZone?: string
): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const locale = language === 'th' ? 'th-TH' : 'en-GB';
  const date = d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
  return `${date} · ${time}${language === 'th' ? ' น.' : ''}`;
}

/** e.g. "อีก 2 วัน 3 ชม." / "เลยมาแล้ว 5 นาที" */
export function formatRelative(iso: string | null | undefined, language: 'th' | 'en' | string = 'th', now = Date.now()): string {
  if (!iso) return '';
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '';
  const diffMin = Math.round((target - now) / 60000);
  const abs = Math.abs(diffMin);
  const th = language === 'th';
  let span: string;
  if (abs < 1) return th ? 'ตอนนี้' : 'now';
  if (abs < 60) span = th ? `${abs} นาที` : `${abs} min`;
  else if (abs < 24 * 60) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    span = th ? `${h} ชม.${m ? ` ${m} นาที` : ''}` : `${h} h${m ? ` ${m} min` : ''}`;
  } else {
    const d = Math.floor(abs / 1440);
    const h = Math.floor((abs % 1440) / 60);
    span = th ? `${d} วัน${h ? ` ${h} ชม.` : ''}` : `${d} day${d > 1 ? 's' : ''}${h ? ` ${h} h` : ''}`;
  }
  if (diffMin > 0) return th ? `อีก ${span}` : `in ${span}`;
  return th ? `เลยมาแล้ว ${span}` : `${span} ago`;
}
