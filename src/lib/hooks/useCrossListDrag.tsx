'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const EDGE = 72;

export type CrossListTarget = { group: string; index: number };

/**
 * Drag an item from anywhere on it into a position in any of several lists
 * (e.g. classwork rows between categories), with pointer events so it works
 * with a mouse and with a finger:
 *
 * - mouse: the drag starts once the pointer moves a few pixels (a click stays a click);
 * - touch: press and hold briefly, then drag (moving earlier just scrolls the page).
 *
 * A small label follows the pointer; the page scrolls near the screen edges.
 * Mark the DOM so the hook can tell what is under the pointer:
 * - each item: `data-xl-item={id} data-xl-group={group} data-xl-index={i}`
 * - each list (drops at its end when not over an item): `data-xl-list={group} data-xl-count={n}`
 * Buttons, links, fields and `[data-no-drag]` inside an item keep working
 * (a link with `data-drag-ok` may start a drag; block its click with `recentlyDropped`).
 */
export function useCrossListDrag({
  onStart,
  onOver,
  onDrop,
  onEnd,
}: {
  onStart: (id: string) => void;
  onOver: (target: CrossListTarget | null) => void;
  onDrop: (id: string, target: CrossListTarget) => void;
  onEnd: () => void;
}) {
  // Only the label is state; the label's position is written straight to the DOM each frame.
  const [ghost, setGhost] = useState<{ label: string; x: number; y: number } | null>(null);
  const ghostEl = useRef<HTMLDivElement | null>(null);
  const droppedAt = useRef(0);
  const active = useRef<{ id: string; target: CrossListTarget | null; raf: number; x: number; y: number; stop: () => void } | null>(null);
  const latest = useRef({ onStart, onOver, onDrop, onEnd });
  useEffect(() => {
    latest.current = { onStart, onOver, onDrop, onEnd };
  });

  /** What lies under the pointer: an item (before/after by its halves) or a list (its end). */
  const targetAt = (x: number, y: number): CrossListTarget | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const item = el?.closest<HTMLElement>('[data-xl-item]');
    if (item?.dataset.xlGroup != null && item.dataset.xlIndex != null) {
      const box = item.getBoundingClientRect();
      return { group: item.dataset.xlGroup, index: Number(item.dataset.xlIndex) + (y > box.top + box.height / 2 ? 1 : 0) };
    }
    const list = el?.closest<HTMLElement>('[data-xl-list]');
    if (list?.dataset.xlList != null) return { group: list.dataset.xlList, index: Number(list.dataset.xlCount || 0) };
    return null;
  };

  const finish = useCallback((drop: boolean) => {
    const s = active.current;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    s.stop();
    active.current = null;
    droppedAt.current = Date.now();
    setGhost(null);
    if (drop && s.target) latest.current.onDrop(s.id, s.target);
    latest.current.onOver(null);
    latest.current.onEnd();
  }, []);

  const begin = useCallback(
    (id: string, label: string, pointerId: number, x: number, y: number, touch: boolean) => {
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId || !active.current) return;
        active.current.x = ev.clientX;
        active.current.y = ev.clientY;
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId === pointerId) finish(ev.type === 'pointerup');
      };
      const noScroll = (ev: TouchEvent) => ev.preventDefault();
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') finish(false);
      };
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      window.addEventListener('touchmove', noScroll, { passive: false });
      window.addEventListener('keydown', onKey);
      const s = {
        id,
        target: null as CrossListTarget | null,
        raf: 0,
        x,
        y,
        stop: () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          window.removeEventListener('touchmove', noScroll);
          window.removeEventListener('keydown', onKey);
        },
      };
      active.current = s;
      latest.current.onStart(id);
      setGhost({ label, x, y });
      if (touch) navigator.vibrate?.(12);
      let last = '';
      const tick = () => {
        if (active.current !== s) return;
        const vh = window.innerHeight;
        const speed = s.y < EDGE ? -Math.ceil((EDGE - s.y) / 6) : s.y > vh - EDGE ? Math.ceil((s.y - (vh - EDGE)) / 6) : 0;
        if (speed) window.scrollBy(0, speed);
        if (ghostEl.current) {
          ghostEl.current.style.left = `${s.x}px`;
          ghostEl.current.style.top = `${s.y}px`;
        }
        const target = targetAt(s.x, s.y);
        const key = target ? `${target.group}\u0000${target.index}` : '';
        if (key !== last) {
          last = key;
          s.target = target;
          latest.current.onOver(target);
        }
        s.raf = requestAnimationFrame(tick);
      };
      s.raf = requestAnimationFrame(tick);
    },
    [finish]
  );

  /** Props for the item's outer element. */
  const pressProps = useCallback(
    (id: string, label: string) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (active.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
        // Controls inside the item keep working; a link marked data-drag-ok (e.g. the title) may start a drag.
        const hit = (e.target as HTMLElement).closest('a, button, input, select, textarea, label, [role="menu"], [data-no-drag]');
        if (hit && !hit.hasAttribute('data-drag-ok')) return;
        const pointerId = e.pointerId;
        const x0 = e.clientX;
        const y0 = e.clientY;
        const touch = e.pointerType !== 'mouse';
        let timer = 0;
        const cleanup = () => {
          window.clearTimeout(timer);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', cleanup);
          window.removeEventListener('pointercancel', cleanup);
        };
        const onMove = (ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return;
          const moved = Math.hypot(ev.clientX - x0, ev.clientY - y0);
          if (touch) {
            if (moved > 10) cleanup(); // a scroll, not a drag
          } else if (moved > 6) {
            cleanup();
            begin(id, label, pointerId, ev.clientX, ev.clientY, false);
          }
        };
        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerup', cleanup);
        window.addEventListener('pointercancel', cleanup);
        if (touch) {
          timer = window.setTimeout(() => {
            cleanup();
            begin(id, label, pointerId, x0, y0, true);
          }, 380);
        }
      },
    }),
    [begin]
  );

  // Leaving the page mid-drag.
  useEffect(
    () => () => {
      const s = active.current;
      if (!s) return;
      cancelAnimationFrame(s.raf);
      s.stop();
      active.current = null;
    },
    []
  );

  /** For click handlers: true right after a drop (the release may also fire a click). */
  const recentlyDropped = useCallback(() => Date.now() - droppedAt.current < 400, []);

  const ghostLayer: ReactNode =
    ghost && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={ghostEl}
            aria-hidden
            style={{ left: ghost.x, top: ghost.y }}
            className="pointer-events-none fixed z-80 -translate-x-1/2 -translate-y-[130%] max-w-[min(80vw,20rem)] truncate px-3 py-2 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-xs font-black shadow-2xl ring-2 ring-amber-400"
          >
            {ghost.label}
          </div>,
          document.body
        )
      : null;

  return { pressProps, recentlyDropped, ghostLayer };
}
