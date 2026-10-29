import Link from 'next/link';
import type { ReactNode } from 'react';

/** Header shared by the admin pages, with a breadcrumb back up. */
export function AdminHeader({ email, crumbs = [] }: { email?: string; crumbs?: Array<{ label: string; href?: string }> }) {
  return (
    <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <nav className="flex flex-wrap items-center gap-1.5 text-lg font-black">
            <Link href="/admin" className="hover:underline">Pudding Admin</Link>
            {crumbs.map((crumb) => (
              <span key={crumb.label} className="flex items-center gap-1.5 min-w-0">
                <span className="text-slate-300 dark:text-slate-600">/</span>
                {crumb.href ? (
                  <Link href={crumb.href} className="font-mono text-base hover:underline truncate">{crumb.label}</Link>
                ) : (
                  <span className="font-mono text-base truncate max-w-[60vw]">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
          {email && <p className="text-xs text-slate-500">ข้อมูลทั้งระบบ • {email}</p>}
        </div>
        <Link href="/dashboard" className="text-xs font-bold text-slate-600 dark:text-slate-300 hover:underline">
          ← กลับหน้าครู
        </Link>
      </div>
    </header>
  );
}

export function AdminMain({ children }: { children: ReactNode }) {
  return <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">{children}</main>;
}

/** One cell's value as short text. */
export const previewValue = (value: unknown, max = 120) => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export const adminRecordHref = (table: string, id: string) => `/admin/${table}/${encodeURIComponent(id)}`;
