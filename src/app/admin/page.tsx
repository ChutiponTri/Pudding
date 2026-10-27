import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DATASETS, ADMIN_TABLES, getAdmin, loadDataset, loadTable, type AdminTable } from '@/lib/server/admin';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pudding Admin', robots: { index: false, follow: false } };

const PREVIEW_ROWS = 50;
const FORMATS = ['jsonl', 'csv', 'json'] as const;

const exportHref = (name: string, format: string, anonymize = true) =>
  `/api/admin/export?name=${name}&format=${format}${anonymize ? '' : '&anonymize=0'}`;

const preview = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
};

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

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ table?: string }> }) {
  const admin = await getAdmin();
  // Non-admins see the same page as a route that does not exist.
  if (!admin) notFound();

  const { table } = await searchParams;
  const selectedTable = (ADMIN_TABLES as readonly string[]).includes(table || '') ? (table as AdminTable) : null;
  const supabase = createServiceSupabaseClient();

  const [counts, proxyActivity, flaggedCount, previewRows] = await Promise.all([
    Promise.all(
      ADMIN_TABLES.map(async (name) => {
        const { count, error } = await supabase.from(name).select('*', { count: 'exact', head: true });
        return [name, error ? null : count ?? 0] as const;
      })
    ),
    loadDataset(supabase, 'proxy_activity', false).catch(() => []),
    supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('is_flagged_suspicious', true),
    selectedTable ? loadTable(supabase, selectedTable).then((rows) => rows.slice(0, PREVIEW_ROWS)) : Promise.resolve([]),
  ]);
  const countOf = Object.fromEntries(counts);
  const previewColumns = [...new Set(previewRows.flatMap((row) => Object.keys(row)))];

  const stats = [
    { label: 'ผู้ใช้', value: countOf.users },
    { label: 'ห้องเรียน', value: countOf.classrooms },
    { label: 'งาน/ข้อสอบ', value: countOf.assignments },
    { label: 'งานที่ส่ง', value: countOf.submissions },
    { label: 'คำตอบ', value: countOf.submission_answers },
    { label: 'บันทึกเช็คชื่อ', value: countOf.attendance_records },
    { label: 'ส่ง/เช็คชื่อแทนเพื่อน', value: proxyActivity.length, tone: 'sky' },
    { label: 'งานน่าสงสัย', value: flaggedCount.count ?? 0, tone: 'rose' },
  ];

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-black">Pudding Admin</h1>
            <p className="text-xs text-slate-500">ข้อมูลทั้งระบบ • {admin.primaryEmailAddress?.emailAddress}</p>
          </div>
          <Link href="/dashboard" className="text-xs font-bold text-slate-600 dark:text-slate-300 hover:underline">
            ← กลับหน้าครู
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className={`p-4 rounded-2xl border bg-white dark:bg-slate-900 ${
                stat.tone === 'sky'
                  ? 'border-sky-200 dark:border-sky-900'
                  : stat.tone === 'rose'
                    ? 'border-rose-200 dark:border-rose-900'
                    : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <p className="text-[11px] font-bold text-slate-500">{stat.label}</p>
              <p className="text-2xl font-black tabular-nums">{stat.value ?? '—'}</p>
            </div>
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

        <section className="space-y-3">
          <h2 className="text-sm font-black">ตารางข้อมูลดิบ</h2>
          <p className="text-xs text-slate-500">คอลัมน์ที่เป็น token/secret จะถูกตัดออกเสมอ</p>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <table className="w-full text-xs">
              <tbody>
                {ADMIN_TABLES.map((name) => (
                  <tr key={name} className={`border-b last:border-0 border-slate-100 dark:border-slate-800 ${name === selectedTable ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}>
                    <td className="px-3 py-2 font-mono font-bold">{name}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{countOf[name] ?? 'ไม่พบตาราง'}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin?table=${name}`} className="font-bold text-amber-700 dark:text-amber-400 hover:underline">
                        ดูข้อมูล
                      </Link>
                    </td>
                    <td className="px-3 py-2"><ExportLinks name={name} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {selectedTable && (
          <section className="space-y-3">
            <h2 className="text-sm font-black">
              {selectedTable} <span className="font-normal text-slate-500">({previewRows.length} แถวแรก)</span>
            </h2>
            <div className="overflow-auto max-h-[70vh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <table className="text-[11px] font-mono">
                <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800">
                  <tr>
                    {previewColumns.map((c) => (
                      <th key={c} className="px-2 py-1.5 text-left whitespace-nowrap">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800 align-top">
                      {previewColumns.map((c) => (
                        <td key={c} className="px-2 py-1 whitespace-nowrap max-w-xs truncate" title={preview(row[c])}>
                          {preview(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
