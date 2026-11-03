'use client';

import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 650;

/**
 * A number that counts from its previous value to the new one (ease-out),
 * so a changing total reads as movement. Jumps straight to the value when
 * the viewer prefers reduced motion. The final value is always exact.
 */
export function CountUp({ value, className }: { value: number; className?: string }) {
  // Counts up from 0 when it first appears, then from each previous value.
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = value;
    if (from === value) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reduce ? 0 : DURATION_MS;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = duration ? Math.min(1, (now - start) / duration) : 1;
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(t >= 1 ? value : Math.round(from + (value - from) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      // Interrupted: the next run starts from the target, so show it now.
      setShown(value);
    };
  }, [value]);

  return <span className={className}>{shown}</span>;
}
