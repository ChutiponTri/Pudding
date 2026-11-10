import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Browser tab: "งานทั้งหมด | Pudding" (signed-in page, not in search results). */
export const metadata: Metadata = { title: 'งานทั้งหมด', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
