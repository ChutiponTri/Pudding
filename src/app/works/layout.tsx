import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Browser tab: "งานและข้อสอบ | Pudding" (signed-in page, not in search results). */
export const metadata: Metadata = { title: 'งานและข้อสอบ', robots: { index: false, follow: false } };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
