'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';

export type ActionMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Small grey text at the right (e.g. "2 ห้อง"). */
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** Opens a second panel in the same popover instead of running an action. */
  panel?: { title: string; render: (close: () => void) => ReactNode };
};

const MENU_WIDTH = 236;
const GAP = 6;
const EDGE = 8;

/**
 * A "⋯" button with a small popover next to it (not a full-screen sheet, on
 * phones too). It opens below the button, or above when there is no room, and
 * stays inside the screen. Items can open a second panel (colour picker,
 * classroom chooser). Closes on outside tap, Escape, scroll or resize.
 */
export function ActionMenu({
  items,
  label,
  buttonClassName = '',
  size = 'md',
}: {
  items: Array<ActionMenuItem | false | null | undefined>;
  label: string;
  buttonClassName?: string;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<ActionMenuItem['panel'] | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; origin: string } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const list = items.filter(Boolean) as ActionMenuItem[];

  const close = useCallback(() => {
    setOpen(false);
    setPanel(null);
    setPos(null);
  }, []);

  const place = useCallback(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const r = button.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = menu.offsetHeight;
    const w = Math.min(MENU_WIDTH, vw - EDGE * 2);
    // Right edges line up; slide in if it would leave the screen.
    let left = r.right - w;
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
    const below = r.bottom + GAP;
    const fitsBelow = below + h <= vh - EDGE;
    const fitsAbove = r.top - GAP - h >= EDGE;
    const top = fitsBelow || !fitsAbove ? Math.min(below, Math.max(EDGE, vh - h - EDGE)) : r.top - GAP - h;
    setPos({ top, left, origin: `${fitsBelow || !fitsAbove ? 'top' : 'bottom'} right` });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, panel, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  // Focus the first item for keyboard users.
  useEffect(() => {
    if (open && pos) menuRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus({ preventScroll: true });
  }, [open, panel, pos]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') || [])];
    const i = buttons.indexOf(document.activeElement as HTMLElement);
    buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  };

  const dim = size === 'sm' ? 'w-8 h-8' : 'w-9 h-9';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        draggable={false}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) close();
          else setOpen(true);
        }}
        className={`${dim} shrink-0 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer ${
          open ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : ''
        } ${buttonClassName}`}
      >
        <MoreHorizontal className="w-4.5 h-4.5" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKey}
            onClick={(e) => e.stopPropagation()}
            style={{
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              width: `min(${MENU_WIDTH}px, calc(100vw - ${EDGE * 2}px))`,
              transformOrigin: pos?.origin,
            }}
            className={`fixed z-70 p-1.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-900/10 dark:shadow-black/40 max-h-[min(70dvh,26rem)] overflow-y-auto overscroll-contain ${
              pos ? 'animate-in fade-in zoom-in-95 [--tw-duration:160ms]' : 'invisible'
            }`}
          >
            {panel ? (
              <div key="panel" className="animate-in fade-in [--tw-enter-translate-x:0.75rem] [--tw-duration:180ms]">
                <button
                  type="button"
                  onClick={() => setPanel(null)}
                  className="w-full flex items-center gap-1.5 px-2 h-9 rounded-xl text-xs font-black text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4 text-slate-400" />
                  <span className="truncate">{panel.title}</span>
                </button>
                <div className="h-px bg-slate-100 dark:bg-slate-800 my-1" />
                {panel.render(close)}
              </div>
            ) : (
              <div key="list">
                {list.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      if (item.panel) {
                        setPanel(item.panel);
                        return;
                      }
                      close();
                      item.onSelect?.();
                    }}
                    className={`w-full flex items-center gap-2.5 px-2.5 min-h-10 rounded-xl text-left text-[13px] font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800 ${
                      item.danger
                        ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className={`w-4 h-4 shrink-0 flex items-center justify-center ${item.danger ? '' : 'text-slate-400 dark:text-slate-500'}`}>{item.icon}</span>
                    <span className="flex-1 min-w-0 truncate">{item.label}</span>
                    {item.hint && <span className="shrink-0 text-[11px] font-medium text-slate-400">{item.hint}</span>}
                    {item.panel && <ChevronRight className="w-3.5 h-3.5 shrink-0 text-slate-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

/** A row inside a panel (e.g. one classroom), styled like a menu item. */
export function ActionMenuRow({ children, onClick, active }: { children: ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 min-h-10 rounded-xl text-left text-[13px] font-semibold transition-colors cursor-pointer outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800 ${
        active ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  );
}
