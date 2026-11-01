import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, Database, FolderArchive, LayoutDashboard, Table2, UserCheck } from 'lucide-react';
import { AdminPrefs } from '@/components/AdminPrefs';
import { getAdminLang, translator } from '@/lib/server/adminLang';

export type AdminSection = 'overview' | 'teachers' | 'datasets' | 'storage' | 'tables';

const NAV: Array<{ id: AdminSection; label: [string, string]; href: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: ['ภาพรวม', 'Overview'], href: '/admin', icon: LayoutDashboard },
  { id: 'teachers', label: ['อนุมัติครู', 'Teachers'], href: '/admin/teachers', icon: UserCheck },
  { id: 'datasets', label: ['ชุดข้อมูล', 'Datasets'], href: '/admin#datasets', icon: Database },
  { id: 'storage', label: ['ไฟล์ R2', 'R2 files'], href: '/admin#storage', icon: FolderArchive },
  { id: 'tables', label: ['ตารางข้อมูล', 'Tables'], href: '/admin#tables', icon: Table2 },
];

/** Header shared by the admin pages: brand, section tabs, theme/language and a breadcrumb back up. */
export async function AdminHeader({
  email,
  crumbs = [],
  active = 'overview',
  pendingTeachers,
}: {
  email?: string;
  crumbs?: Array<{ label: string; href?: string }>;
  active?: AdminSection;
  /** Shows a badge on the teachers tab. */
  pendingTeachers?: number | null;
}) {
  const lang = await getAdminLang();
  const tr = translator(lang);
  return (
    <header className="sticky top-0 z-30 bg-slate-950 text-white shadow-lg shadow-slate-950/10">
      <div className="absolute inset-0 bg-linear-to-r from-indigo-950 via-slate-950 to-violet-950 opacity-90" aria-hidden />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        <div className="py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <Link href="/admin" className="w-10 h-10 shrink-0 rounded-2xl bg-linear-to-br from-amber-300 to-amber-500 flex items-center justify-center text-xl shadow-lg shadow-amber-500/30">
              🍮
            </Link>
            <div className="min-w-0">
              <nav className="flex flex-wrap items-center gap-1.5 text-base font-black">
                <Link href="/admin" className="hover:text-amber-300">Pudding Admin</Link>
                {crumbs.map((crumb) => (
                  <span key={crumb.label} className="flex items-center gap-1.5 min-w-0">
                    <span className="text-slate-500">/</span>
                    {crumb.href ? (
                      <Link href={crumb.href} className="font-mono text-sm text-slate-200 hover:text-amber-300 truncate">{crumb.label}</Link>
                    ) : (
                      <span className="font-mono text-sm text-slate-300 truncate max-w-[50vw]">{crumb.label}</span>
                    )}
                  </span>
                ))}
              </nav>
              {email && <p className="text-[11px] text-slate-400 truncate">{tr('ข้อมูลทั้งระบบ', 'All data')} • {email}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AdminPrefs serverLang={lang} />
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold text-slate-100"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{tr('กลับหน้าครู', 'Teacher app')}</span>
            </Link>
          </div>
        </div>
        <nav className="-mb-px flex gap-1 overflow-x-auto scrollbar-none" aria-label="Admin sections">
          {NAV.map(({ id, label, href, icon: Icon }) => {
            const on = active === id;
            return (
              <Link
                key={id}
                href={href}
                aria-current={on ? 'page' : undefined}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold border-b-2 transition-colors ${
                  on ? 'border-amber-400 text-white' : 'border-transparent text-slate-400 hover:text-white hover:border-slate-600'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tr(label[0], label[1])}
                {id === 'teachers' && !!pendingTeachers && (
                  <span className="min-w-5 h-5 px-1.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-black flex items-center justify-center tabular-nums">
                    {pendingTeachers}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

export function AdminMain({ children }: { children: ReactNode }) {
  return <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">{children}</main>;
}

/** Page shell: soft tinted background behind every admin page. */
export function AdminPage({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh bg-linear-to-b from-slate-100 via-slate-50 to-white dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">{children}</div>;
}

/** Section heading with an icon chip. */
export function AdminSectionTitle({ icon, title, description, tone = 'slate', action }: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  tone?: 'slate' | 'amber' | 'violet' | 'sky' | 'emerald' | 'rose' | 'indigo';
  action?: ReactNode;
}) {
  const tones = {
    slate: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
    indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  };
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-start gap-2.5">
        <span className={`p-1.5 rounded-lg ${tones[tone]}`}>{icon}</span>
        <div>
          <h2 className="text-sm font-black text-slate-900 dark:text-white">{title}</h2>
          {description && <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/** One cell's value as short text. */
export const previewValue = (value: unknown, max = 120) => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export const adminRecordHref = (table: string, id: string) => `/admin/${table}/${encodeURIComponent(id)}`;
