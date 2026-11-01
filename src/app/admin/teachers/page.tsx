import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { BookOpen, Building2, CheckCircle2, Clock, Mail, MessageCircle, Search, Send, UserX, Users } from 'lucide-react';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { fetchAll, getAdmin } from '@/lib/server/admin';
import { LINE_TEST_WINDOW_DAYS, lineTestWindowStart } from '@/lib/server/lineTestQuota';
import { AdminHeader, AdminMain, AdminPage, adminRecordHref } from '@/components/AdminUi';
import { AdminTeacherApproval } from '@/components/AdminTeacherApproval';
import { isTeacherProfileComplete, type TeacherApproval } from '@/lib/utils/teacherProfile';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pudding Admin', robots: { index: false, follow: false } };

type TabKey = TeacherApproval | 'all';

const TABS: Array<{ key: TabKey; label: string; icon: typeof Clock; on: string; off: string }> = [
  {
    key: 'pending',
    label: 'รอตรวจ',
    icon: Clock,
    on: 'bg-linear-to-br from-amber-400 to-orange-400 text-slate-950 border-transparent shadow-lg shadow-amber-500/25',
    off: 'bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-900/60 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30',
  },
  {
    key: 'approved',
    label: 'อนุมัติแล้ว',
    icon: CheckCircle2,
    on: 'bg-linear-to-br from-emerald-500 to-teal-500 text-white border-transparent shadow-lg shadow-emerald-500/25',
    off: 'bg-white dark:bg-slate-900 border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30',
  },
  {
    key: 'rejected',
    label: 'ปฏิเสธแล้ว',
    icon: UserX,
    on: 'bg-linear-to-br from-rose-500 to-pink-500 text-white border-transparent shadow-lg shadow-rose-500/25',
    off: 'bg-white dark:bg-slate-900 border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30',
  },
  {
    key: 'all',
    label: 'ทั้งหมด',
    icon: Users,
    on: 'bg-linear-to-br from-indigo-500 to-violet-500 text-white border-transparent shadow-lg shadow-indigo-500/25',
    off: 'bg-white dark:bg-slate-900 border-indigo-200 dark:border-indigo-900/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30',
  },
];

const STATUS_STYLE: Record<TeacherApproval, { badge: string; strip: string; label: string }> = {
  pending: { badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300', strip: 'from-amber-400 to-orange-400', label: 'รอตรวจ' },
  approved: { badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300', strip: 'from-emerald-400 to-teal-400', label: 'อนุมัติแล้ว' },
  rejected: { badge: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300', strip: 'from-rose-400 to-pink-400', label: 'ปฏิเสธแล้ว' },
};

const AVATAR_TONES = [
  'from-sky-400 to-indigo-500',
  'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500',
  'from-violet-400 to-fuchsia-500',
  'from-rose-400 to-pink-500',
  'from-cyan-400 to-sky-500',
];

type TeacherRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  institution: string | null;
  email: string | null;
  avatar_url: string | null;
  teacher_approval: string | null;
  teacher_line_uid: string | null;
  created_at: string | null;
};

const approvalOf = (value: string | null): TeacherApproval => (value === 'approved' || value === 'rejected' ? value : 'pending');

function relativeThai(iso: string | null) {
  if (!iso) return '';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} นาทีที่แล้ว`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ชม.ที่แล้ว`;
  const days = Math.round(hours / 24);
  return days < 60 ? `${days} วันที่แล้ว` : `${Math.round(days / 30)} เดือนที่แล้ว`;
}

export default async function AdminTeachersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const admin = await getAdmin();
  if (!admin) notFound();
  const { status: statusParam, q = '' } = await searchParams;

  const supabase = createServiceSupabaseClient();
  const since = lineTestWindowStart();
  const [teachers, classrooms, testSends] = await Promise.all([
    supabase
      .from('users')
      .select('id, first_name, last_name, institution, email, avatar_url, teacher_approval, teacher_line_uid, created_at')
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
  const status = (TABS.some((t) => t.key === statusParam) ? statusParam : counts.pending ? 'pending' : 'all') as TabKey;
  const needle = q.trim().toLowerCase();
  const rows = all.filter(
    (t) =>
      (status === 'all' || approvalOf(t.teacher_approval) === status) &&
      (!needle || [t.first_name, t.last_name, t.institution, t.email, t.id].some((v) => (v || '').toLowerCase().includes(needle)))
  );
  const href = (key: string) => `/admin/teachers?status=${key}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  return (
    <AdminPage>
      <AdminHeader email={admin.primaryEmailAddress?.emailAddress} crumbs={[{ label: 'teachers' }]} active="teachers" pendingTeachers={counts.pending} />
      <AdminMain>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white">อนุมัติบัญชีครู</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              ครูที่สมัครใหม่จะใช้งานระบบไม่ได้จนกว่าจะอนุมัติที่นี่ • ทดสอบส่ง LINE = จำนวนครั้งใน {LINE_TEST_WINDOW_DAYS} วันล่าสุด
            </p>
          </div>
          <form action="/admin/teachers" className="relative w-full sm:w-80">
            <input type="hidden" name="status" value={status} />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              name="q"
              defaultValue={q}
              placeholder="ค้นหาชื่อ, โรงเรียน, อีเมล"
              className="w-full h-10 pl-9 pr-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </form>
        </div>

        <nav className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-label="สถานะ">
          {TABS.map(({ key, label, icon: Icon, on, off }) => (
            <Link
              key={key}
              href={href(key)}
              aria-current={status === key ? 'page' : undefined}
              className={`p-4 rounded-2xl border transition-all ${status === key ? on : off}`}
            >
              <span className="flex items-center gap-1.5 text-xs font-bold">
                <Icon className="w-4 h-4" /> {label}
              </span>
              <span className="block text-3xl font-black tabular-nums mt-1">{counts[key]}</span>
            </Link>
          ))}
        </nav>

        {loadError ? (
          <p className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-sm">{loadError}</p>
        ) : rows.length === 0 ? (
          <div className="p-10 rounded-3xl border border-dashed border-slate-300 dark:border-slate-700 text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
            <p className="mt-2 text-sm font-bold text-slate-700 dark:text-slate-200">{status === 'pending' ? 'ไม่มีครูรอตรวจ 🎉' : 'ไม่มีครูในรายการนี้'}</p>
            {needle && <p className="text-xs text-slate-500 mt-1">ลองล้างคำค้นหา “{q}”</p>}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {rows.map((t, index) => {
              const approval = approvalOf(t.teacher_approval);
              const style = STATUS_STYLE[approval];
              const name = `${t.first_name || ''} ${t.last_name || ''}`.trim() || '(ไม่มีชื่อ)';
              const initials = (t.first_name?.[0] || '') + (t.last_name?.[0] || '') || '?';
              const tests = testCount.get(t.id) || 0;
              const complete = isTeacherProfileComplete(t);
              return (
                <article
                  key={t.id}
                  className={`relative overflow-hidden rounded-3xl border bg-white dark:bg-slate-900 shadow-sm hover:shadow-md transition-shadow ${
                    approval === 'pending' ? 'border-amber-200 dark:border-amber-900/60' : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className={`h-1.5 bg-linear-to-r ${style.strip}`} />
                  <div className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      {t.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.avatar_url} alt="" className="w-12 h-12 rounded-2xl object-cover shrink-0 ring-2 ring-white dark:ring-slate-800 shadow" />
                      ) : (
                        <div className={`w-12 h-12 rounded-2xl shrink-0 bg-linear-to-br ${AVATAR_TONES[index % AVATAR_TONES.length]} text-white font-black text-lg flex items-center justify-center shadow`}>
                          {initials}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <Link href={adminRecordHref('users', t.id)} className="font-black text-sm text-slate-900 dark:text-white hover:text-indigo-700 dark:hover:text-indigo-300 truncate">
                            {name}
                          </Link>
                          <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black ${style.badge}`}>{style.label}</span>
                        </div>
                        <p className="text-xs text-slate-500 flex items-center gap-1 truncate"><Mail className="w-3 h-3 shrink-0" />{t.email || '-'}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1 truncate"><Building2 className="w-3 h-3 shrink-0" />{t.institution || <span className="text-slate-400">ไม่ระบุสถานศึกษา</span>}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                      <span className={`px-2 py-0.5 rounded-full flex items-center gap-1 ${t.teacher_line_uid ? 'bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                        <MessageCircle className="w-3 h-3" /> {t.teacher_line_uid ? 'เชื่อม LINE แล้ว' : 'ยังไม่เชื่อม LINE'}
                      </span>
                      {!complete && <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300">โปรไฟล์ยังไม่ครบ</span>}
                    </div>

                    <dl className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 py-2">
                        <dt className="text-[10px] text-slate-500 flex items-center justify-center gap-1"><BookOpen className="w-3 h-3" />ห้องเรียน</dt>
                        <dd className="text-base font-black tabular-nums">{classroomCount.get(t.id) || 0}</dd>
                      </div>
                      <div className={`rounded-xl py-2 ${tests >= 5 ? 'bg-rose-50 dark:bg-rose-950/40' : 'bg-slate-50 dark:bg-slate-800/60'}`}>
                        <dt className="text-[10px] text-slate-500 flex items-center justify-center gap-1"><Send className="w-3 h-3" />ทดสอบ LINE</dt>
                        <dd className={`text-base font-black tabular-nums ${tests >= 5 ? 'text-rose-600' : ''}`}>{tests}</dd>
                      </div>
                      <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 py-2" title={t.created_at ? new Date(t.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : ''}>
                        <dt className="text-[10px] text-slate-500 flex items-center justify-center gap-1"><Clock className="w-3 h-3" />สมัคร</dt>
                        <dd className="text-[11px] font-bold pt-1">{relativeThai(t.created_at) || '-'}</dd>
                      </div>
                    </dl>

                    <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
                      <AdminTeacherApproval id={t.id} name={name} approval={approval} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </AdminMain>
    </AdminPage>
  );
}
