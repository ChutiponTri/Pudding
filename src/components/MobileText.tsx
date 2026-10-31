import React from 'react';

/** Phones get the short text (small screens, little room); from sm up the full one, unchanged. */
export function MobileText({ short, full }: { short: React.ReactNode; full: React.ReactNode }) {
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{full}</span>
    </>
  );
}
