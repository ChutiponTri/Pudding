import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getAdmin } from '@/lib/server/admin';
import { isAdminTable, linkedTable, listRecords, LIST_COLUMNS, primaryKeyOf } from '@/lib/server/adminRecords';
import { AdminHeader, AdminMain, adminRecordHref, previewValue } from '@/components/AdminUi';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pudding Admin', robots: { index: false, follow: false } };

const PAGE_SIZE = 50;

export default async function AdminTablePage({
  params,
  searchParams,
}: {
  params: Promise<{ table: string }>;
  searchParams: Promise<{ q?: string; page?: string; col?: string; val?: string }>;
}) {
  const admin = await getAdmin();
  if (!admin) notFound();
  const { table } = await params;
  if (!isAdminTable(table)) notFound();
  const { q = '', page: pageParam, col, val } = await searchParams;
  const filter = col && val !== undefined ? { column: col, value: val } : undefined;

  let result: Awaited<ReturnType<typeof listRecords>> | null = null;
  let loadError: string | null = null;
  try {
    result = await listRecords(createServiceSupabaseClient(), table, { q, filter, page: Number(pageParam) || 1, pageSize: PAGE_SIZE });
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ';
  }
  const pk = primaryKeyOf(table);
  const columns = LIST_COLUMNS[table];
  const pageCount = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;
  const pageHref = (page: number) => {
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (filter) {
      query.set('col', filter.column);
      query.set('val', filter.value);
    }
    if (page > 1) query.set('page', String(page));
    const text = query.toString();
    return `/admin/${table}${text ? `?${text}` : ''}`;
  };

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <AdminHeader email={admin.primaryEmailAddress?.emailAddress} crumbs={[{ label: table }]} />
      <AdminMain>
        <form className="flex flex-wrap items-center gap-2" action={`/admin/${table}`}>
          <input
            name="q"
            defaultValue={q}
            placeholder="ค้นหา (ชื่อ, id, อีเมล, ชื่องาน …)"
            className="flex-1 min-w-48 h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
          {filter && (
            <>
              <input type="hidden" name="col" value={filter.column} />
              <input type="hidden" name="val" value={filter.value} />
            </>
          )}
          <button className="h-10 px-4 rounded-xl bg-amber-500 text-slate-950 text-sm font-bold cursor-pointer">ค้นหา</button>
          {(q || filter) && (
            <Link href={`/admin/${table}`} className="text-xs font-bold text-slate-500 hover:underline">ล้างตัวกรอง</Link>
          )}
        </form>

        {filter && (
          <p className="text-xs text-slate-500">
            เฉพาะแถวที่ <span className="font-mono font-bold">{filter.column}</span> ={' '}
            <span className="font-mono font-bold">{filter.value}</span>
          </p>
        )}

        {loadError ? (
          <p className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-sm">{loadError}</p>
        ) : result && result.rows.length === 0 ? (
          <p className="text-sm text-slate-500">ไม่พบข้อมูล</p>
        ) : result ? (
          <>
            <p className="text-xs text-slate-500 tabular-nums">
              {result.total} แถว • หน้า {result.page}/{pageCount}
            </p>
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className="px-3 py-2 font-mono font-bold whitespace-nowrap">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row[pk]} className="border-b last:border-0 border-slate-100 dark:border-slate-800 hover:bg-amber-50/60 dark:hover:bg-amber-950/20">
                      {columns.map((c) => {
                        const target = linkedTable(table, c);
                        const value = row[c];
                        return (
                          <td key={c} className="px-3 py-2 max-w-xs truncate" title={previewValue(value, 2000)}>
                            {c === pk ? (
                              <Link href={adminRecordHref(table, String(value))} className="font-mono font-bold text-amber-700 dark:text-amber-400 hover:underline">
                                {previewValue(value, 40)}
                              </Link>
                            ) : target && value ? (
                              <Link href={adminRecordHref(target, String(value))} className="font-mono text-sky-700 dark:text-sky-400 hover:underline">
                                {previewValue(value, 40)}
                              </Link>
                            ) : (
                              previewValue(value)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="flex items-center gap-3 text-xs font-bold">
                {result.page > 1 && <Link href={pageHref(result.page - 1)} className="hover:underline">← ก่อนหน้า</Link>}
                {result.page < pageCount && <Link href={pageHref(result.page + 1)} className="hover:underline">ถัดไป →</Link>}
              </div>
            )}
          </>
        ) : null}
      </AdminMain>
    </div>
  );
}
