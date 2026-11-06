'use client';

import { useCallback, useEffect, useRef } from 'react';

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
 * A copy of the item lifts up and follows the pointer; the page scrolls near
 * the screen edges; Escape cancels. Mark the DOM so the hook can read it:
 * - each list (category): `data-xl-list={group}`
 * - each item in it: `data-xl-item={id} data-xl-index={i}` (its place in that list), and
 *   `data-xl-shift={px}` when the page slides it aside during a drag (see `shiftFor`).
 * The landing place is worked out from where the items normally sit (not where
 * they have slid to), so the sliding never makes it flicker.
 * Buttons, links, fields and `[data-no-drag]` inside an item keep working
 * (a link with `data-drag-ok` may start a drag; block its click with `recentlyDropped`).
 */
export function useCrossListDrag({
  onStart,
  onOver,
  onDrop,
  onEnd,
}: {
  /** `size`: the item's height plus the gap below it (how far the others slide aside). */
  onStart: (id: string, source: CrossListTarget, size: number) => void;
  onOver: (target: CrossListTarget | null) => void;
  onDrop: (id: string, target: CrossListTarget) => void;
  onEnd: () => void;
}) {
  const droppedAt = useRef(0);
  const active = useRef<{ id: string; target: CrossListTarget | null; raf: number; x: number; y: number; stop: () => void } | null>(null);
  const latest = useRef({ onStart, onOver, onDrop, onEnd });
  useEffect(() => {
    latest.current = { onStart, onOver, onDrop, onEnd };
  });

  /**
   * The list under the pointer (or the nearest one, so crossing the gap between two
   * lists does not close and reopen the gaps), and before which of its items.
   * Items are placed by where they sit in the layout (offsetTop), which the sliding
   * transforms never change — so the answer is steady while the rows animate.
   * null: keep the current target.
   */
  const targetAt = (x: number, y: number): CrossListTarget | null => {
    let list = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-xl-list]') || null;
    if (!list) {
      let best: { el: HTMLElement; distance: number } | null = null;
      for (const el of document.querySelectorAll<HTMLElement>('[data-xl-list]')) {
        const box = el.getBoundingClientRect();
        if (x < box.left || x > box.right) continue;
        const distance = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
        if (!best || distance < best.distance) best = { el, distance };
      }
      if (!best || best.distance > 48) return null;
      list = best.el;
    }
    const group = list.dataset.xlList;
    if (group == null) return null;
    const listTop = list.getBoundingClientRect().top + list.clientTop;
    const items = [...list.querySelectorAll<HTMLElement>('[data-xl-item]')].filter((el) => el.closest('[data-xl-list]') === list);
    for (const item of items) {
      if (!item.offsetHeight) continue; // a folded category
      // Layout position inside the list (the list is the items' offsetParent).
      let top = 0;
      for (let el: HTMLElement | null = item; el && el !== list; el = el.offsetParent as HTMLElement | null) top += el.offsetTop;
      if (y < listTop + top + item.offsetHeight / 2) return { group, index: Number(item.dataset.xlIndex) };
    }
    return { group, index: items.length };
  };

  const finish = useCallback((drop: boolean) => {
    const s = active.current;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    s.stop();
    active.current = null;
    droppedAt.current = Date.now();
    if (drop && s.target) latest.current.onDrop(s.id, s.target);
    latest.current.onOver(null);
    latest.current.onEnd();
  }, []);

  const begin = useCallback(
    (id: string, source: HTMLElement, pointerId: number, x: number, y: number, touch: boolean) => {
      const box = source.getBoundingClientRect();
      const list = source.closest<HTMLElement>('[data-xl-list]');
      const gap = source.nextElementSibling ? source.nextElementSibling.getBoundingClientRect().top - box.bottom : 8;
      const grabX = x - box.left;
      const grabY = y - box.top;

      // The lifted copy: the row itself, tilted a little, with a shadow.
      const ghost = document.createElement('div');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.cssText = `position:fixed;left:0;top:0;width:${box.width}px;z-index:80;pointer-events:none;will-change:transform;transition:transform 140ms cubic-bezier(0.2,0.8,0.2,1),opacity 140ms;opacity:0.97;filter:drop-shadow(0 18px 30px rgb(15 23 42 / 0.25));`;
      const copy = source.cloneNode(true) as HTMLElement;
      copy.removeAttribute('data-xl-item');
      copy.style.transform = '';
      copy.style.opacity = '1';
      ghost.appendChild(copy);
      const place = (px: number, py: number, lifted: boolean) => {
        ghost.style.transform = `translate3d(${px - grabX}px, ${py - grabY}px, 0) rotate(${lifted ? 1.2 : 0}deg) scale(${lifted ? 1.03 : 1})`;
      };
      place(x, y, false);
      document.body.appendChild(ghost);
      requestAnimationFrame(() => {
        place(x, y, true);
        // After the pick-up, follow the pointer without lag.
        window.setTimeout(() => (ghost.style.transition = 'opacity 140ms'), 150);
      });

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
          ghost.style.opacity = '0';
          window.setTimeout(() => ghost.remove(), 150);
        },
      };
      active.current = s;
      latest.current.onStart(id, { group: list?.dataset.xlList || '', index: Number(source.dataset.xlIndex || 0) }, box.height + Math.max(0, gap));
      if (touch) navigator.vibrate?.(12);
      let last = '';
      const tick = () => {
        if (active.current !== s) return;
        const vh = window.innerHeight;
        const speed = s.y < EDGE ? -Math.ceil((EDGE - s.y) / 6) : s.y > vh - EDGE ? Math.ceil((s.y - (vh - EDGE)) / 6) : 0;
        if (speed) window.scrollBy(0, speed);
        place(s.x, s.y, true);
        const target = targetAt(s.x, s.y) ?? s.target;
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

  /** Props for the item's outer element (it must carry data-xl-item / data-xl-index). */
  const pressProps = useCallback(
    (id: string) => ({
      // A long press drags: no "open link" / text menu.
      // (A mouse right-click, button 2, keeps its menu.)
      onContextMenu: (e: React.MouseEvent) => {
        if (e.button !== 2) e.preventDefault();
      },
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (active.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
        // Controls inside the item keep working; a link marked data-drag-ok (e.g. the title) may start a drag.
        const hit = (e.target as HTMLElement).closest('a, button, input, select, textarea, label, [role="menu"], [data-no-drag]');
        if (hit && !hit.hasAttribute('data-drag-ok')) return;
        const source = e.currentTarget;
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
            begin(id, source, pointerId, ev.clientX, ev.clientY, false);
          }
        };
        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerup', cleanup);
        window.addEventListener('pointercancel', cleanup);
        if (touch) {
          timer = window.setTimeout(() => {
            cleanup();
            begin(id, source, pointerId, x0, y0, true);
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

  return { pressProps, recentlyDropped };
}

/**
 * How far an item slides while another is dragged, so a gap opens where it
 * would land: within one list the items between the old and new place move
 * up or down by one; in another list everything from the landing place moves
 * down. The dragged item itself (a placeholder) moves to its new slot in its
 * own list, and stays put when it is headed for another list.
 */
export function shiftFor(
  drag: { id: string; source: CrossListTarget; size: number } | null,
  target: CrossListTarget | null,
  group: string,
  index: number,
  isDragged: boolean
): number {
  if (!drag || !target) return 0;
  const { source, size } = drag;
  const within = source.group === group && target.group === group;
  if (isDragged) {
    if (!within) return 0;
    const t = target.index;
    const d = source.index;
    return t > d ? (t - d - 1) * size : t < d ? (t - d) * size : 0;
  }
  if (within) {
    const t = target.index;
    const d = source.index;
    if (t > d && index > d && index < t) return -size;
    if (t < d && index >= t && index < d) return size;
    return 0;
  }
  return target.group === group && index >= target.index ? size : 0;
}
