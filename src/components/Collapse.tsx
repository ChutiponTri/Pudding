'use client';

import { useState, type ReactNode } from 'react';

/**
 * Smoothly opens and closes its content (height + fade) by animating the grid
 * row between 0fr and 1fr, so it works with any content height. Closed content
 * stays mounted but inert (not focusable, hidden from assistive tech).
 *
 * `unclipWhenOpen`: once fully open, the content may overflow (shadows, an item
 * being dragged); it is clipped again while closing.
 */
export function Collapse({
  open,
  children,
  className = '',
  unclipWhenOpen = false,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  unclipWhenOpen?: boolean;
}) {
  const [settled, setSettled] = useState(open);
  const clip = !unclipWhenOpen || !open || !settled;
  return (
    <div
      inert={!open}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows') setSettled(open);
      }}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className={`min-h-0 ${clip ? 'overflow-hidden' : ''} ${className}`}>{children}</div>
    </div>
  );
}
