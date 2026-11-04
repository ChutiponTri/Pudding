import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Browser tab: "ห้องเรียน | Pudding" (signed-in page, not in search results). */
export const metadata: Metadata = { title: 'ห้องเรียน', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
