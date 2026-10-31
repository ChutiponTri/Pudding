import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { fetchAll, getAdmin } from '@/lib/server/admin';
import { LINE_TEST_WINDOW_DAYS, lineTestWindowStart } from '@/lib/server/lineTestQuota';
import { AdminHeader, AdminMain, adminRecordHref } from '@/components/AdminUi';
import { AdminTeacherApproval } from '@/components/AdminTeacherApproval';
import { isTeacherProfileComplete, type TeacherApproval } from '@/lib/utils/teacherProfile';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pudding Admin', robots: { index: false, follow: false } };

const TABS: Array<{ key: TeacherApproval | 'all'; label: string }> = [
  { key: 'pending', label: 'รอตรวจ' },
  { key: 'approved', label: 'อนุมัติแล้ว' },
  { key: 'rejected', label: 'ปฏิเสธแล้ว' },
  { key: 'all', label: 'ทั้งหมด' },
];

const BADGE: Record<TeacherApproval, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300',
};

type TeacherRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  institution: string | null;
  email: string | null;
  teacher_approval: string | null;
  teacher_line_uid: string | null;
  created_at: string | null;
};

const approvalOf = (value: string | null): TeacherApproval => (value === 'approved' || value === 'rejected' ? value : 'pending');

export default async function AdminTeachersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const admin = await getAdmin();
  if (!admin) notFound();
  const { status: statusParam, q = '' } = await searchParams;

  const supabase = createServiceSupabaseClient();
  const since = lineTestWindowStart();
  const [teachers, classrooms, testSends] = await Promise.all([
    supabase
      .from('users')
      .select('id, first_name, last_name, institution, email, teacher_approval, teacher_line_uid, created_at')
      .eq('role', 'teacher')
      .order('created_at', { ascending: false })
      .range(0, 999),
    fetchAll(supabase, 'classrooms', 'teacher_id').catch(() => []),
    supabase.from('line_test_sends').select('teacher_id').gte('created_at', since).range(0, 9999),
  ]);
  const loadError = teachers.error?.message ?? null;
  const all = (teachers.data || []) as TeacherRow[];
  const classroomCount = new Map<string, number>();
  for (const c of classrooms) classroomCount.set(c.teacher_id, (classroomCount.get(c.teacher_id) || 0) + 1);
  const testCount = new Map<string, number>();
  for (const t of testSends.data || []) testCount.set(t.teacher_id, (testCount.get(t.teacher_id) || 0) + 1);

  const counts = { pending: 0, approved: 0, rejected: 0, all: all.length };
  for (const t of all) counts[approvalOf(t.teacher_approval)]++;

  // Open on the waiting list when someone waits; otherwise show everyone.
  const status = (TABS.some((t) => t.key === statusParam) ? statusParam : counts.pending ? 'pending' : 'all') as TeacherApproval | 'all';
  const needle = q.trim().toLowerCase();
  const rows = all.filter(
    (t) =>
      (status === 'all' || approvalOf(t.teacher_approval) === status) &&
      (!needle || [t.first_name, t.last_name, t.institution, t.email, t.id].some((v) => (v || '').toLowerCase().includes(needle)))
  );
  const href = (key: string) => `/admin/teachers?status=${key}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <AdminHeader email={admin.primaryEmailAddress?.emailAddress} crumbs={[{ label: 'teachers' }]} />
      <AdminMain>
        <div className="space-y-1">
          <h1 className="text-base font-black">อนุมัติบัญชีครู</h1>
          <p className="text-xs text-slate-500">
            ครูที่สมัครใหม่จะใช้งานระบบไม่ได้จนกว่าจะอนุมัติที่นี่ • ทดสอบส่ง LINE = จำนวนครั้งใน {LINE_TEST_WINDOW_DAYS} วันล่าสุด
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={href(tab.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border ${
                status === tab.key
                  ? 'bg-amber-500 border-amber-500 text-slate-950'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {tab.label} <span className="tabular-nums opacity-70">{counts[tab.key]}</span>
            </Link>
          ))}
          <form action="/admin/teachers" className="flex items-center gap-2 ml-auto w-full sm:w-auto">
            <input type="hidden" name="status" value={status} />
            <input
              name="q"
              defaultValue={q}
              placeholder="ค้นหาชื่อ, โรงเรียน, อีเมล"
              className="flex-1 sm:w-64 h-9 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </form>
        </div>

        {loadError ? (
          <p className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-sm">{loadError}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">ไม่มีครูในรายการนี้</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  {['ครู', 'สถานศึกษา', 'สมัครเมื่อ', 'ห้องเรียน', 'ทดสอบส่ง LINE', 'สถานะ', ''].map((h) => (
                    <th key={h} className="px-3 py-2 font-bold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const approval = approvalOf(t.teacher_approval);
                  const name = `${t.first_name || ''} ${t.last_name || ''}`.trim() || '(ไม่มีชื่อ)';
                  const tests = testCount.get(t.id) || 0;
                  return (
                    <tr key={t.id} className="border-b last:border-0 border-slate-100 dark:border-slate-800 align-top">
                      <td className="px-3 py-2.5 min-w-48">
                        <Link href={adminRecordHref('users', t.id)} className="font-bold hover:underline">{name}</Link>
                        <p className="text-slate-500">{t.email || '-'}</p>
                        <p className="text-[10px] text-slate-400">
                          {t.teacher_line_uid ? 'เชื่อม LINE แล้ว' : 'ยังไม่เชื่อม LINE'}
                          {!isTeacherProfileComplete(t) && ' • ยังกรอกโปรไฟล์ไม่ครบ'}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 min-w-40">{t.institution || <span className="text-slate-400">-</span>}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap font-mono">
                        {t.created_at ? new Date(t.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-'}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{classroomCount.get(t.id) || 0}</td>
                      <td className={`px-3 py-2.5 tabular-nums ${tests >= 5 ? 'font-black text-rose-600' : ''}`}>{tests}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${BADGE[approval]}`}>
                          {TABS.find((tab) => tab.key === approval)?.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <AdminTeacherApproval id={t.id} name={name} approval={approval} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminMain>
    </div>
  );
}
