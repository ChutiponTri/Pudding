import type { ReactNode } from 'react';

/**
 * Smoothly opens and closes its content (height + fade) by animating the grid
 * row between 0fr and 1fr, so it works with any content height. Closed content
 * stays mounted but inert (not focusable, hidden from assistive tech).
 */
export function Collapse({ open, children, className = '' }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      inert={!open}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className={`min-h-0 overflow-hidden ${className}`}>{children}</div>
    </div>
  );
}
