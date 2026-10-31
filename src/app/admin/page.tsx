import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DATASETS, ADMIN_TABLES, getAdmin, loadDataset } from '@/lib/server/admin';
import { AdminStorage } from '@/components/AdminStorage';
import { AdminHeader, AdminMain } from '@/components/AdminUi';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pudding Admin', robots: { index: false, follow: false } };

const FORMATS = ['jsonl', 'csv', 'json'] as const;

const exportHref = (name: string, format: string, anonymize = true) =>
  `/api/admin/export?name=${name}&format=${format}${anonymize ? '' : '&anonymize=0'}`;

function ExportLinks({ name, anonymize = true }: { name: string; anonymize?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {FORMATS.map((format) => (
        <a
          key={format}
          href={exportHref(name, format, anonymize)}
          className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-bold uppercase hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          {format}
        </a>
      ))}
    </div>
  );
}

function StatCard({ href, className, children }: { href?: string; className: string; children: ReactNode }) {
  return href ? <Link href={href} className={className}>{children}</Link> : <div className={className}>{children}</div>;
}

export default async function AdminPage() {
  const admin = await getAdmin();
  // Non-admins see the same page as a route that does not exist.
  if (!admin) notFound();

  const supabase = createServiceSupabaseClient();

  const [counts, proxyActivity, flaggedCount, unlinkedTeachers, pendingTeachers] = await Promise.all([
    Promise.all(
      ADMIN_TABLES.map(async (name) => {
        const { count, error } = await supabase.from(name).select('*', { count: 'exact', head: true });
        return [name, error ? null : count ?? 0] as const;
      })
    ),
    loadDataset(supabase, 'proxy_activity', false).catch(() => []),
    supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('is_flagged_suspicious', true),
    // Teachers the LINE bot cannot reach: no LINE id saved, or not its friend.
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'teacher').or('teacher_line_uid.is.null,line_bot_friend.is.null,line_bot_friend.eq.false'),
    // New sign-ups that cannot use the app until approved (NULL = never decided).
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'teacher').or('teacher_approval.is.null,teacher_approval.eq.pending'),
  ]);
  const countOf = Object.fromEntries(counts);

  const stats = [
    { label: 'ครูรออนุมัติ', value: pendingTeachers.error ? null : pendingTeachers.count ?? 0, tone: 'amber', href: '/admin/teachers?status=pending' },
    { label: 'ผู้ใช้', value: countOf.users, href: '/admin/users' },
    { label: 'ห้องเรียน', value: countOf.classrooms, href: '/admin/classrooms' },
    { label: 'งาน/ข้อสอบ', value: countOf.assignments, href: '/admin/assignments' },
    { label: 'งานที่ส่ง', value: countOf.submissions, href: '/admin/submissions' },
    { label: 'บันทึกเช็คชื่อ', value: countOf.attendance_records, href: '/admin/attendance_records' },
    { label: 'ครูที่บอท LINE ยังติดต่อไม่ได้', value: unlinkedTeachers.count ?? 0, tone: 'amber', href: '/admin/users?col=role&val=teacher' },
    { label: 'ส่ง/เช็คชื่อแทนเพื่อน', value: proxyActivity.length, tone: 'sky' },
    { label: 'งานน่าสงสัย', value: flaggedCount.count ?? 0, tone: 'rose', href: '/admin/submissions?col=is_flagged_suspicious&val=true' },
  ];

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <AdminHeader email={admin.primaryEmailAddress?.emailAddress} />

      <AdminMain>
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map((stat) => (
            <StatCard
              key={stat.label}
              href={stat.href}
              className={`p-4 rounded-2xl border bg-white dark:bg-slate-900 ${
                stat.tone === 'sky'
                  ? 'border-sky-200 dark:border-sky-900'
                  : stat.tone === 'rose'
                    ? 'border-rose-200 dark:border-rose-900'
                    : stat.tone === 'amber'
                      ? 'border-amber-200 dark:border-amber-900'
                      : 'border-slate-200 dark:border-slate-800'
              } ${stat.href ? 'hover:bg-slate-50 dark:hover:bg-slate-800/60' : ''}`}
            >
              <p className="text-[11px] font-bold text-slate-500">{stat.label}</p>
              <p className="text-2xl font-black tabular-nums">{stat.value ?? '—'}</p>
            </StatCard>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-black">ชุดข้อมูลสำหรับเทรน / Fine-tune</h2>
          <p className="text-xs text-slate-500">
            ชุดข้อมูลเหล่านี้ปกปิดตัวตนนักเรียนโดยแทนด้วยรหัสสุ่มคงที่ (ไม่มีชื่อหรือ LINE ID) — ใช้ลิงก์ &quot;ไม่ปกปิด&quot; เฉพาะเมื่อจำเป็น
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {Object.entries(ADMIN_DATASETS).map(([name, description]) => (
              <div key={name} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                <div>
                  <p className="font-mono text-sm font-bold">{name}</p>
                  <p className="text-xs text-slate-500">{description}</p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ExportLinks name={name} />
                  <a href={exportHref(name, 'csv', false)} className="text-[11px] text-slate-500 hover:underline">
                    ไม่ปกปิด (CSV)
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-black">ส่งงาน / เช็คชื่อแทนเพื่อน (ล่าสุด)</h2>
          {proxyActivity.length === 0 ? (
            <p className="text-xs text-slate-500">ยังไม่มีการใช้เครื่องของเพื่อนส่งงานหรือเช็คชื่อ</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    {['เวลา', 'ประเภท', 'ห้องเรียน', 'งาน/คาบ', 'นักเรียน (เจ้าของงาน)', 'เครื่องของ'].map((h) => (
                      <th key={h} className="px-3 py-2 font-bold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {proxyActivity.slice(0, 30).map((row, i) => (
                    <tr key={i} className="border-b last:border-0 border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 whitespace-nowrap font-mono">{row.at ? new Date(row.at).toLocaleString('th-TH') : '-'}</td>
                      <td className="px-3 py-2">{row.kind === 'submission' ? '📄 ส่งงาน' : '⏰ เช็คชื่อ'}</td>
                      <td className="px-3 py-2">{row.classroom}</td>
                      <td className="px-3 py-2">{row.item}</td>
                      <td className="px-3 py-2">{row.for_student.name} <span className="text-slate-400">{row.for_student.student_number}</span></td>
                      <td className="px-3 py-2 font-bold text-sky-700 dark:text-sky-300">📱 {row.phone_owner.name} <span className="font-normal text-slate-400">{row.phone_owner.student_number}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl border border-amber-200 dark:border-amber-900 bg-white dark:bg-slate-900">
          <div>
            <h2 className="text-sm font-black">บัญชีครู</h2>
            <p className="text-xs text-slate-500">อนุมัติหรือปฏิเสธครูที่สมัครใหม่ และดูการใช้ปุ่มทดสอบส่ง LINE ของครูแต่ละคน</p>
          </div>
          <Link href="/admin/teachers" className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold">
            จัดการครู{pendingTeachers.count ? ` (รอ ${pendingTeachers.count})` : ''} →
          </Link>
        </section>

        <AdminStorage />

        <section className="space-y-3">
          <h2 className="text-sm font-black">ตารางข้อมูลดิบ</h2>
          <p className="text-xs text-slate-500">ค้นหา เปิดดู แก้ไข หรือลบแต่ละแถวได้ • คอลัมน์ที่เป็น token/secret จะถูกตัดออกเสมอ</p>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <table className="w-full text-xs">
              <tbody>
                {ADMIN_TABLES.map((name) => (
                  <tr key={name} className="border-b last:border-0 border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 font-mono font-bold">{name}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{countOf[name] ?? 'ไม่พบตาราง'}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/${name}`} className="font-bold text-amber-700 dark:text-amber-400 hover:underline">
                        ดู / แก้ไข
                      </Link>
                    </td>
                    <td className="px-3 py-2"><ExportLinks name={name} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

      </AdminMain>
    </div>
  );
}
