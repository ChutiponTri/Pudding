'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, ChevronDown, School, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export type ComboOption = { value: string; label: string; sub?: string; kind: 'subject' | 'class' };

/**
 * Subject / class filter: a text field that narrows a dropdown list as you
 * type (subjects first, then classrooms). Picking one filters the list; the
 * × clears it. Arrow keys, Enter and Escape work as in any combobox.
 */
export function ComboFilter({
  value,
  options,
  onChange,
  className = '',
}: {
  /** Selected option value, or 'all'. */
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const { tr } = useLanguage();
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value) || null;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [hi, setHi] = useState(0);

  const q = text.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? options.filter((o) => `${o.label} ${o.sub || ''}`.toLowerCase().includes(q)) : options),
    [options, q]
  );

  // Close on a tap outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setText('');
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const pick = (option: ComboOption | null) => {
    onChange(option ? option.value : 'all');
    setOpen(false);
    setText('');
    // Close the phone keyboard (the field is the focused element).
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setHi((i) => (shown.length ? (i + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length : 0));
    } else if (e.key === 'Enter') {
      if (open && shown[hi]) {
        e.preventDefault();
        pick(shown[hi]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setText('');
    }
  };

  const active = !!selected;
  const groups: Array<[ComboOption['kind'], string]> = [
    ['subject', tr('วิชา', 'Subjects')],
    ['class', tr('ห้องเรียน', 'Classes')],
  ];

  return (
    <div ref={wrapRef} className={`relative min-w-0 ${className}`}>
      <div
        className={`h-9 sm:h-10 rounded-xl border flex items-center gap-1.5 pl-2.5 sm:pl-3 pr-0.5 sm:pr-1 overflow-hidden transition-colors ${
          active && !open
            ? 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:border-white dark:text-slate-900'
            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 focus-within:border-amber-500'
        }`}
      >
        {selected?.kind === 'class' ? <School className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 opacity-60" /> : <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 opacity-60" />}
        <span className="min-w-0 flex-1 h-full flex items-center">
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={open ? text : selected ? selected.label : ''}
          placeholder={open && selected ? selected.label : tr('วิชาหรือห้องเรียน', 'Subject or class')}
          onFocus={() => {
            setOpen(true);
            setHi(0);
          }}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setHi(0);
          }}
          onKeyDown={onKey}
          className={`phone-small-field min-w-0 w-full h-full bg-transparent text-xs font-black outline-none placeholder:font-semibold ${
            active && !open ? 'placeholder:text-white/60 dark:placeholder:text-slate-900/60' : 'placeholder:text-slate-400'
          }`}
        />
        </span>
        {active ? (
          <button
            type="button"
            onClick={() => pick(null)}
            aria-label={tr('ล้างวิชา/ห้อง', 'Clear subject or class')}
            className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => (open ? setOpen(false) : inputRef.current?.focus())}
            aria-label={tr('เปิดรายการ', 'Show list')}
            className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center opacity-60 cursor-pointer"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-40 left-0 min-w-full w-[min(20rem,calc(100vw-2rem))] mt-1.5 max-h-[min(60dvh,22rem)] overflow-y-auto overscroll-contain p-1.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl animate-in fade-in zoom-in-95 [--tw-duration:140ms]"
        >
          {shown.length === 0 ? (
            <p className="px-3 py-4 text-xs text-slate-400 text-center">{tr('ไม่พบวิชาหรือห้องที่ค้นหา', 'No subject or class matches')}</p>
          ) : (
            groups.map(([kind, title]) => {
              const items = shown.filter((o) => o.kind === kind);
              if (!items.length) return null;
              return (
                <div key={kind}>
                  <p className="px-2.5 pt-2 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">{title}</p>
                  {items.map((o) => {
                    const index = shown.indexOf(o);
                    const isSel = o.value === value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        role="option"
                        aria-selected={isSel}
                        onPointerEnter={() => setHi(index)}
                        onClick={() => pick(o)}
                        className={`w-full min-h-10 px-2.5 py-1.5 rounded-xl flex items-center gap-2 text-left cursor-pointer ${
                          index === hi ? 'bg-slate-100 dark:bg-slate-800' : ''
                        }`}
                      >
                        {kind === 'class' ? <School className="w-4 h-4 shrink-0 text-slate-400" /> : <BookOpen className="w-4 h-4 shrink-0 text-slate-400" />}
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-bold text-slate-800 dark:text-slate-100 truncate">{o.label}</span>
                          {o.sub && <span className="block text-[11px] text-slate-400 truncate">{o.sub}</span>}
                        </span>
                        {isSel && <Check className="w-4 h-4 shrink-0 text-amber-600" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
