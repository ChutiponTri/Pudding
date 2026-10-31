'use client';

import { useLayoutEffect, useState } from 'react';

export type IndicatorRect = { left: number; top: number; width: number; height: number };

/**
 * Position of a segmented control's active button, for a highlight that slides
 * between options. Returns [setter for the (position: relative) group's `ref`,
 * measured rect]; mark the selected button `data-active="true"`. Re-measures when sizes change
 * (font swap, resize, label/count changes). Null until first measured, so the
 * selected button should paint its own background until then.
 */
export function useSlidingIndicator<T extends HTMLElement = HTMLDivElement>(activeKey: unknown) {
  const [group, setGroup] = useState<T | null>(null);
  const [indicator, setIndicator] = useState<IndicatorRect | null>(null);

  useLayoutEffect(() => {
    if (!group) return;
    const measure = () => {
      const active = group.querySelector<HTMLElement>('[data-active="true"]');
      // Hidden (display: none) groups keep the last position instead of collapsing to 0.
      if (!active || active.offsetWidth === 0) return;
      const next = { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
      setIndicator((prev) =>
        prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height ? prev : next
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    group.querySelectorAll('button').forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [group, activeKey]);

  return [setGroup, indicator] as const;
}

/** Inline style that moves the highlight onto the measured button. */
export const indicatorStyle = (rect: IndicatorRect) => ({
  transform: `translate(${rect.left}px, ${rect.top}px)`,
  width: rect.width,
  height: rect.height,
});
