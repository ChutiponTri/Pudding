import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { getAdmin } from '@/lib/server/admin';
import { getRecord, isAdminTable, isReadOnlyColumn, linkedTable, relatedCounts } from '@/lib/server/adminRecords';
import { AdminHeader, AdminMain } from '@/components/AdminUi';
import { AdminRecordEditor } from '@/components/AdminRecordEditor';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pudding Admin', robots: { index: false, follow: false } };

/** Whether the LINE bot can see this user as a friend right now (null = could not ask LINE). */
async function liveBotFriendship(lineUid: string): Promise<boolean | null> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUid)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (response.ok) return true;
    return response.status === 404 ? false : null;
  } catch {
    return null;
  }
}

export default async function AdminRecordPage({ params }: { params: Promise<{ table: string; id: string }> }) {
  const admin = await getAdmin();
  if (!admin) notFound();
  const { table, id: rawId } = await params;
  if (!isAdminTable(table)) notFound();
  const id = decodeURIComponent(rawId);
  const supabase = createServiceSupabaseClient();
  const record = await getRecord(supabase, table, id);
  if (!record) notFound();

  const lineUid = table === 'users' ? record.teacher_line_uid || record.line_uid : null;
  const [related, friend] = await Promise.all([
    relatedCounts(supabase, table, id),
    lineUid ? liveBotFriendship(lineUid) : Promise.resolve(null),
  ]);
  const columns = Object.keys(record);
  const links = Object.fromEntries(columns.map((c) => [c, linkedTable(table, c)]).filter(([, target]) => target));

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <AdminHeader email={admin.primaryEmailAddress?.emailAddress} crumbs={[{ label: table, href: `/admin/${table}` }, { label: id }]} />
      <AdminMain>
        {lineUid && (
          <section className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs space-y-1">
            <p className="font-black text-sm">สถานะ LINE (ตรวจสดจาก LINE)</p>
            <p>
              LINE ID: <span className="font-mono">{lineUid}</span>
            </p>
            <p>
              เป็นเพื่อนกับบอท:{' '}
              <span className="font-bold">{friend === null ? 'ตรวจไม่ได้' : friend ? '✅ ใช่' : '❌ ไม่ใช่'}</span>
              {record.role === 'teacher' && friend !== null && record.line_bot_friend !== friend && (
                <span className="ml-2 text-rose-600 dark:text-rose-400 font-bold">
                  ไม่ตรงกับฐานข้อมูล (line_bot_friend = {String(record.line_bot_friend)}) — แก้ค่าด้านล่างได้
                </span>
              )}
            </p>
          </section>
        )}

        {related.length > 0 && (
          <section className="flex flex-wrap gap-2">
            {related.map((child) => (
              <Link
                key={`${child.table}.${child.column}`}
                href={`/admin/${child.table}?col=${child.column}&val=${encodeURIComponent(id)}`}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <span className="font-mono">{child.table}</span>
                <span className="text-slate-400 font-normal"> ({child.column})</span>{' '}
                <span className="tabular-nums text-amber-700 dark:text-amber-400">{child.count}</span>
              </Link>
            ))}
          </section>
        )}

        <AdminRecordEditor
          table={table}
          id={id}
          record={record}
          readOnly={columns.filter((c) => isReadOnlyColumn(table, c))}
          links={links as Record<string, string>}
        />
      </AdminMain>
    </div>
  );
}
