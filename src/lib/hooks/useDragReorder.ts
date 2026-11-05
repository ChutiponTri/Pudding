'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const EDGE = 72;

/**
 * Drag-to-reorder for a vertical list, by a handle, with pointer events (so it
 * works with a finger on iPhone / iPad as well as a mouse). The dragged item
 * follows the pointer, neighbours slide out of the way, the page scrolls near
 * the screen edges, and arrow keys on the handle move an item one place.
 *
 * Usage: put `ref={bindList}` on the list (position: relative), `bindItem(key)` and
 * `itemStyle(key)` on each item (direct children), `handleProps(key)` on the
 * grip, and render items in `order`. `onCommit` gets the new order on drop.
 *
 * With `{ grid: true }` the items may sit in a wrapping grid (several per row):
 * the dragged item follows the pointer both ways and takes the slot it is over,
 * in reading order.
 */
export function useDragReorder(keys: string[], onCommit: (keys: string[]) => void, options: { grid?: boolean } = {}) {
  const grid = !!options.grid;
  const listEl = useRef<HTMLElement | null>(null);
  const items = useRef(new Map<string, HTMLElement>());
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dragY, setDragY] = useState(0);
  const [dragX, setDragX] = useState(0);
  const drag = useRef<{
    key: string;
    grab: number;
    grabX: number;
    lastY: number;
    lastX: number;
    raf: number;
    order: string[];
    stop: () => void;
  } | null>(null);
  const prevPos = useRef(new Map<string, { top: number; left: number }>());
  const droppedAt = useRef(0);
  const latest = useRef({ keys, onCommit, dragOrder });
  useEffect(() => {
    latest.current = { keys, onCommit, dragOrder };
  });

  /** Moves the dragged item under the pointer and swaps it past neighbours' midpoints. */
  const follow = useCallback(() => {
    const s = drag.current;
    const list = listEl.current;
    const el = s && items.current.get(s.key);
    if (!s || !list || !el) return;
    const box = list.getBoundingClientRect();
    const y = s.lastY - box.top;
    const x = s.lastX - box.left;
    setDragY(y - s.grab - el.offsetTop);
    if (grid) setDragX(x - s.grabX - el.offsetLeft);
    const center = y - s.grab + el.offsetHeight / 2;
    const centerX = x - s.grabX + el.offsetWidth / 2;
    /** Whether `other` comes before the dragged item's current position. */
    const before = (other: HTMLElement) => {
      if (!grid) return other.offsetTop + other.offsetHeight / 2 < center;
      if (other.offsetTop + other.offsetHeight <= center) return true; // an earlier row
      if (other.offsetTop > center) return false; // a later row
      return other.offsetLeft + other.offsetWidth / 2 < centerX; // same row: left of it
    };
    setDragOrder((order) => {
      if (!order) return order;
      const others = order.filter((k) => k !== s.key);
      let index = 0;
      for (const k of others) {
        const other = items.current.get(k);
        if (other && before(other)) index++;
      }
      if (order.indexOf(s.key) === index) return order;
      prevPos.current = new Map(
        others.map((k) => {
          const other = items.current.get(k);
          return [k, { top: other?.offsetTop ?? 0, left: other?.offsetLeft ?? 0 }];
        })
      );
      const next = [...others.slice(0, index), s.key, ...others.slice(index)];
      // Kept on the drag itself, so the drop commits it even before React re-renders.
      s.order = next;
      return next;
    });
  }, [grid]);

  // After a swap: keep the dragged item under the pointer, slide the others (FLIP).
  useLayoutEffect(() => {
    if (!dragOrder) return;
    follow();
    for (const [k, { top, left }] of prevPos.current) {
      const el = items.current.get(k);
      if (!el) continue;
      const delta = top - el.offsetTop;
      const deltaX = left - el.offsetLeft;
      if (!delta && !deltaX) continue;
      el.style.transition = 'none';
      el.style.transform = `translate3d(${deltaX}px, ${delta}px, 0)`;
      void el.offsetHeight;
      requestAnimationFrame(() => {
        el.style.transition = 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.transform = '';
      });
    }
    prevPos.current = new Map();
  }, [dragOrder, follow]);

  const end = useCallback(() => {
    const s = drag.current;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    s.stop();
    drag.current = null;
    droppedAt.current = Date.now();
    const order = s.order;
    if (order.join('\u0000') !== latest.current.keys.join('\u0000')) latest.current.onCommit(order);
    setDragKey(null);
    setDragOrder(null);
    setDragY(0);
    setDragX(0);
  }, []);

  const start = useCallback(
    (key: string, e: { pointerId: number; clientX: number; clientY: number; pointerType: string; button: number; preventDefault?: () => void }) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const el = items.current.get(key);
      const list = listEl.current;
      if (!el || !list) return;
      e.preventDefault?.();
      // Follow the pointer on the window, not by pointer capture: React moves the
      // dragged item's DOM node while reordering, and a moved node loses its capture
      // (the drop would then never arrive).
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return;
        s.lastY = ev.clientY;
        s.lastX = ev.clientX;
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId === e.pointerId) end();
      };
      // Touch: the page must not scroll under the finger while dragging.
      const noScroll = (ev: TouchEvent) => ev.preventDefault();
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      window.addEventListener('touchmove', noScroll, { passive: false });
      const s = {
        key,
        grab: e.clientY - list.getBoundingClientRect().top - el.offsetTop,
        grabX: e.clientX - list.getBoundingClientRect().left - el.offsetLeft,
        lastY: e.clientY,
        lastX: e.clientX,
        raf: 0,
        order: latest.current.keys,
        stop: () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          window.removeEventListener('touchmove', noScroll);
        },
      };
      drag.current = s;
      setDragKey(key);
      setDragOrder(latest.current.keys);
      const tick = () => {
        if (drag.current !== s) return;
        const vh = window.innerHeight;
        const speed = s.lastY < EDGE ? -Math.ceil((EDGE - s.lastY) / 6) : s.lastY > vh - EDGE ? Math.ceil((s.lastY - (vh - EDGE)) / 6) : 0;
        if (speed) window.scrollBy(0, speed);
        follow();
        s.raf = requestAnimationFrame(tick);
      };
      s.raf = requestAnimationFrame(tick);
    },
    [follow, end]
  );

  // Leaving the page mid-drag: stop listening.
  useEffect(
    () => () => {
      const s = drag.current;
      if (!s) return;
      cancelAnimationFrame(s.raf);
      s.stop();
      drag.current = null;
    },
    []
  );

  /** For click handlers: true right after a drop (the release also fires a click). */
  const recentlyDropped = useCallback(() => Date.now() - droppedAt.current < 400, []);

  const move = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current.lastY = e.clientY;
    drag.current.lastX = e.clientX;
  }, []);

  const nudge = useCallback((key: string, step: -1 | 1) => {
    const next = [...latest.current.keys];
    const i = next.indexOf(key);
    const j = i + step;
    if (i < 0 || j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    latest.current.onCommit(next);
  }, []);

  /** Callback ref for the list (a ref object here would be read as render-time ref access). */
  const bindList = useCallback((el: HTMLElement | null) => {
    listEl.current = el;
  }, []);

  const bindItem = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) items.current.set(key, el);
      else items.current.delete(key);
    },
    []
  );

  const handleProps = useCallback(
    (key: string) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => start(key, e),
      onPointerMove: move,
      onKeyDown: (e: React.KeyboardEvent) => {
        const back = e.key === 'ArrowUp' || (grid && e.key === 'ArrowLeft');
        const forward = e.key === 'ArrowDown' || (grid && e.key === 'ArrowRight');
        if (back || forward) {
          e.preventDefault();
          nudge(key, back ? -1 : 1);
        }
      },
    }),
    [start, move, nudge, grid]
  );

  /**
   * Drag from anywhere on the item (not only the grip), without stealing taps,
   * clicks or page scrolling: a mouse drags once it moves a few pixels; a
   * finger presses and holds briefly, then drags. Buttons, links and fields
   * inside the item keep working. Pair with `recentlyDropped()` in onClick.
   */
  const pressProps = useCallback(
    (key: string) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (drag.current || (e.pointerType === 'mouse' && e.button !== 0)) return;
        if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label, [role="menu"], [data-no-drag]')) return;
        const down = { pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, pointerType: e.pointerType, button: e.button };
        const touch = e.pointerType !== 'mouse';
        let timer = 0;
        const cleanup = () => {
          window.clearTimeout(timer);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', cleanup);
          window.removeEventListener('pointercancel', cleanup);
        };
        const begin = (x: number, y: number) => {
          cleanup();
          start(key, down);
          if (drag.current) {
            drag.current.lastX = x;
            drag.current.lastY = y;
            if (touch) navigator.vibrate?.(12);
          }
        };
        const onMove = (ev: PointerEvent) => {
          if (ev.pointerId !== down.pointerId) return;
          const moved = Math.hypot(ev.clientX - down.clientX, ev.clientY - down.clientY);
          if (touch) {
            // Moving before the hold ends is a scroll, not a drag.
            if (moved > 10) cleanup();
          } else if (moved > 6) {
            begin(ev.clientX, ev.clientY);
          }
        };
        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerup', cleanup);
        window.addEventListener('pointercancel', cleanup);
        if (touch) timer = window.setTimeout(() => begin(down.clientX, down.clientY), 380);
      },
    }),
    [start]
  );

  const itemStyle = (key: string): React.CSSProperties | undefined =>
    dragKey === key ? { transform: `translate3d(${dragX}px, ${dragY}px, 0)`, transition: 'none', zIndex: 20, position: 'relative' } : undefined;

  return { bindList, order: dragOrder ?? keys, dragKey, bindItem, itemStyle, handleProps, pressProps, recentlyDropped };
}

/**
 * `useDragReorder` as a component, for a list rendered inside a loop (one
 * drag-reorder per subject, say) where a hook cannot be called.
 */
export function DragReorder({
  keys,
  onCommit,
  grid,
  children,
}: {
  keys: string[];
  onCommit: (keys: string[]) => void;
  grid?: boolean;
  children: (drag: ReturnType<typeof useDragReorder>) => ReactNode;
}) {
  return children(useDragReorder(keys, onCommit, { grid }));
}

/** A list order kept in this browser (localStorage), per scope. */
const storageKey = (scope: string) => `pudding:order:${scope}`;
export function readLocalOrder(scope: string): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(scope)) || '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
export function writeLocalOrder(scope: string, keys: string[]) {
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(keys.slice(0, 200)));
  } catch {
    // Order lasts for this visit only.
  }
}

/** `items` in the saved order; ones not saved yet keep their default place. */
export function applySavedOrder<T>(items: T[], keyOf: (item: T) => string, saved: string[], insertBefore?: (item: T, other: T) => boolean): T[] {
  if (!saved.length) return items;
  const index = new Map(saved.map((k, i) => [k, i]));
  const known = items.filter((it) => index.has(keyOf(it))).sort((a, b) => index.get(keyOf(a))! - index.get(keyOf(b))!);
  const result = [...known];
  for (const item of items.filter((it) => !index.has(keyOf(it)))) {
    const at = insertBefore ? result.findIndex((other) => insertBefore(item, other)) : -1;
    if (at === -1) result.push(item);
    else result.splice(at, 0, item);
  }
  return result;
}
