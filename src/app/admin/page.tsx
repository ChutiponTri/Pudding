import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarCheck,
  ClipboardList,
  FileText,
  Inbox,
  MessageCircleOff,
  Smartphone,
  Table2,
  UserCheck,
  Users,
} from 'lucide-react';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { ADMIN_DATASETS, ADMIN_TABLES, getAdmin, loadDataset } from '@/lib/server/admin';
import { AdminStorage } from '@/components/AdminStorage';
import { AdminDatasetBuilder } from '@/components/AdminDatasetBuilder';
import { AdminHeader, AdminMain, AdminPage, AdminSectionTitle } from '@/components/AdminUi';
import { getAdminLang, translator } from '@/lib/server/adminLang';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Pudding Admin', robots: { index: false, follow: false } };

const FORMATS = ['jsonl', 'csv', 'json'] as const;

const exportHref = (name: string, format: string, anonymize = true) =>
  `/api/admin/export?name=${name}&format=${format}${anonymize ? '' : '&anonymize=0'}`;

function ExportLinks({ name, anonymize = true }: { name: string; anonymize?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {FORMATS.map((format) => (
        <a
          key={format}
          href={exportHref(name, format, anonymize)}
          className="px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[10px] font-bold uppercase text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
        >
          {format}
        </a>
      ))}
    </div>
  );
}

type Tone = 'amber' | 'indigo' | 'emerald' | 'sky' | 'violet' | 'teal' | 'orange' | 'rose' | 'cyan';
const TONES: Record<Tone, { card: string; icon: string }> = {
  amber: { card: 'from-amber-50 to-white border-amber-200 dark:from-amber-950/40 dark:to-slate-900 dark:border-amber-900/60', icon: 'bg-amber-500 text-white' },
  indigo: { card: 'from-indigo-50 to-white border-indigo-200 dark:from-indigo-950/40 dark:to-slate-900 dark:border-indigo-900/60', icon: 'bg-indigo-500 text-white' },
  emerald: { card: 'from-emerald-50 to-white border-emerald-200 dark:from-emerald-950/40 dark:to-slate-900 dark:border-emerald-900/60', icon: 'bg-emerald-500 text-white' },
  sky: { card: 'from-sky-50 to-white border-sky-200 dark:from-sky-950/40 dark:to-slate-900 dark:border-sky-900/60', icon: 'bg-sky-500 text-white' },
  violet: { card: 'from-violet-50 to-white border-violet-200 dark:from-violet-950/40 dark:to-slate-900 dark:border-violet-900/60', icon: 'bg-violet-500 text-white' },
  teal: { card: 'from-teal-50 to-white border-teal-200 dark:from-teal-950/40 dark:to-slate-900 dark:border-teal-900/60', icon: 'bg-teal-500 text-white' },
  orange: { card: 'from-orange-50 to-white border-orange-200 dark:from-orange-950/40 dark:to-slate-900 dark:border-orange-900/60', icon: 'bg-orange-500 text-white' },
  rose: { card: 'from-rose-50 to-white border-rose-200 dark:from-rose-950/40 dark:to-slate-900 dark:border-rose-900/60', icon: 'bg-rose-500 text-white' },
  cyan: { card: 'from-cyan-50 to-white border-cyan-200 dark:from-cyan-950/40 dark:to-slate-900 dark:border-cyan-900/60', icon: 'bg-cyan-500 text-white' },
};

function StatCard({ href, tone, icon, label, value, hint }: { href?: string; tone: Tone; icon: ReactNode; label: string; value: number | null | undefined; hint?: string }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 leading-tight">{label}</p>
        <span className={`p-1.5 rounded-xl shadow-sm ${TONES[tone].icon}`}>{icon}</span>
      </div>
      <p className="mt-2 text-3xl font-black tabular-nums text-slate-900 dark:text-white">{value ?? '—'}</p>
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </>
  );
  const className = `group p-4 rounded-2xl border bg-linear-to-br ${TONES[tone].card} transition-all ${href ? 'hover:-translate-y-0.5 hover:shadow-md' : ''}`;
  return href ? <Link href={href} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

export default async function AdminOverviewPage() {
  const admin = await getAdmin();
  // Non-admins see the same page as a route that does not exist.
  if (!admin) notFound();

  const supabase = createServiceSupabaseClient();
  const lang = await getAdminLang();
  const tr = translator(lang);

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
  const pending = pendingTeachers.error ? null : pendingTeachers.count ?? 0;

  const stats: Array<{ label: string; value: number | null | undefined; tone: Tone; icon: ReactNode; href?: string }> = [
    { label: tr('ผู้ใช้', 'Users'), value: countOf.users, tone: 'indigo', icon: <Users className="w-4 h-4" />, href: '/admin/users' },
    { label: tr('ห้องเรียน', 'Classrooms'), value: countOf.classrooms, tone: 'emerald', icon: <BookOpen className="w-4 h-4" />, href: '/admin/classrooms' },
    { label: tr('งาน/ข้อสอบ', 'Assignments'), value: countOf.assignments, tone: 'sky', icon: <ClipboardList className="w-4 h-4" />, href: '/admin/assignments' },
    { label: tr('งานที่ส่ง', 'Submissions'), value: countOf.submissions, tone: 'violet', icon: <Inbox className="w-4 h-4" />, href: '/admin/submissions' },
    { label: tr('บันทึกเช็กชื่อ', 'Attendance records'), value: countOf.attendance_records, tone: 'teal', icon: <CalendarCheck className="w-4 h-4" />, href: '/admin/attendance_records' },
    { label: tr('ครูที่บอท LINE ยังติดต่อไม่ได้', 'Teachers the LINE bot cannot reach'), value: unlinkedTeachers.count ?? 0, tone: 'orange', icon: <MessageCircleOff className="w-4 h-4" />, href: '/admin/users?col=role&val=teacher' },
    { label: tr('ส่ง/เช็กชื่อแทนเพื่อน', "From a classmate's phone"), value: proxyActivity.length, tone: 'cyan', icon: <Smartphone className="w-4 h-4" />, href: '#proxy' },
    { label: tr('งานน่าสงสัย', 'Flagged work'), value: flaggedCount.count ?? 0, tone: 'rose', icon: <AlertTriangle className="w-4 h-4" />, href: '/admin/submissions?col=is_flagged_suspicious&val=true' },
  ];

  return (
    <AdminPage>
      <AdminHeader email={admin.primaryEmailAddress?.emailAddress} active="overview" pendingTeachers={pending} />

      <AdminMain>
        {/* Pending teachers: the one thing that blocks people, so it leads. */}
        <section
          className={`relative overflow-hidden rounded-3xl p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4 ${
            pending
              ? 'bg-linear-to-r from-amber-400 via-amber-300 to-orange-300 text-slate-950'
              : 'bg-linear-to-r from-emerald-500 to-teal-500 text-white'
          }`}
        >
          <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-white/20 blur-2xl" aria-hidden />
          <div className="relative flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/30 backdrop-blur flex items-center justify-center">
              <UserCheck className="w-7 h-7" />
            </div>
            <div>
              <p className="text-xs font-bold opacity-80">{tr('บัญชีครู', 'Teacher accounts')}</p>
              <h1 className="text-xl sm:text-2xl font-black">
                {pending ? tr(`มีครูรออนุมัติ ${pending} คน`, `${pending} teacher${pending > 1 ? 's' : ''} waiting for approval`) : tr('ไม่มีครูรออนุมัติ', 'No teachers waiting')}
              </h1>
              <p className="text-xs opacity-80">{tr('ครูที่สมัครใหม่ใช้งานระบบไม่ได้จนกว่าจะอนุมัติ', 'New teachers cannot use the app until approved')}</p>
            </div>
          </div>
          <Link
            href={pending ? '/admin/teachers?status=pending' : '/admin/teachers'}
            className={`relative inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-sm font-black shadow-lg ${
              pending ? 'bg-slate-950 text-white hover:bg-slate-800' : 'bg-white text-emerald-700 hover:bg-emerald-50'
            }`}
          >
            {pending ? tr('ตรวจและอนุมัติ', 'Review & approve') : tr('ดูครูทั้งหมด', 'All teachers')} <ArrowRight className="w-4 h-4" />
          </Link>
        </section>

        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </section>

        <AdminDatasetBuilder />

        <section className="space-y-3">
          <AdminSectionTitle
            icon={<FileText className="w-4 h-4" />}
            tone="indigo"
            title={tr('ชุดข้อมูลสำเร็จรูป (ดาวน์โหลดด่วน)', 'Ready-made datasets (quick download)')}
            description={tr('ปกปิดตัวตนนักเรียนด้วยรหัสสุ่มคงที่ (ไม่มีชื่อหรือ LINE ID) — ใช้ลิงก์ "ไม่ปกปิด" เฉพาะเมื่อจำเป็น', 'Students are replaced by stable random ids (no names or LINE ids) — use "not anonymised" only when needed')}
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(ADMIN_DATASETS).map(([name, description]) => (
              <div key={name} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col gap-3">
                <div className="flex-1">
                  <p className="font-mono text-sm font-bold text-indigo-700 dark:text-indigo-300">{name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{tr(description[0], description[1])}</p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ExportLinks name={name} />
                  <a href={exportHref(name, 'csv', false)} className="text-[10px] text-slate-400 hover:text-rose-600 hover:underline">
                    {tr('ไม่ปกปิด (CSV)', 'Not anonymised (CSV)')}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="proxy" className="space-y-3 scroll-mt-28">
          <AdminSectionTitle icon={<Smartphone className="w-4 h-4" />} tone="sky" title={tr('ส่งงาน / เช็กชื่อแทนเพื่อน (ล่าสุด)', "From a classmate's phone (latest)")} />
          {proxyActivity.length === 0 ? (
            <p className="p-4 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500">{tr('ยังไม่มีการใช้เครื่องของเพื่อนส่งงานหรือเช็กชื่อ', "Nobody has used a classmate's phone yet")}</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500 bg-slate-50 dark:bg-slate-800/60">
                  <tr>
                    {[tr('เวลา', 'Time'), tr('ประเภท', 'Type'), tr('ห้องเรียน', 'Classroom'), tr('งาน/คาบ', 'Work/period'), tr('นักเรียน (เจ้าของงาน)', 'Student (owner)'), tr('เครื่องของ', 'Phone of')].map((h) => (
                      <th key={h} className="px-3 py-2 font-bold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {proxyActivity.slice(0, 30).map((row, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800 hover:bg-sky-50/50 dark:hover:bg-sky-950/20">
                      <td className="px-3 py-2 whitespace-nowrap font-mono">{row.at ? new Date(row.at).toLocaleString(lang === 'en' ? 'en-GB' : 'th-TH', { timeZone: 'Asia/Bangkok' }) : '-'}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${row.kind === 'submission' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' : 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300'}`}>
                          {row.kind === 'submission' ? tr('ส่งงาน', 'Work') : tr('เช็กชื่อ', 'Check-in')}
                        </span>
                      </td>
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

        <AdminStorage />

        <section id="tables" className="space-y-3 scroll-mt-28">
          <AdminSectionTitle
            icon={<Table2 className="w-4 h-4" />}
            title={tr('ตารางข้อมูลดิบ', 'Raw tables')}
            description={tr('ค้นหา เปิดดู แก้ไข หรือลบแต่ละแถวได้ • คอลัมน์ที่เป็น token/secret จะถูกตัดออกเสมอ', 'Search, open, edit or delete rows • token/secret columns are always removed')}
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {ADMIN_TABLES.map((name) => (
              <div key={name} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-indigo-300 dark:hover:border-indigo-800">
                <Link href={`/admin/${name}`} className="min-w-0 group">
                  <p className="font-mono text-xs font-bold text-slate-800 dark:text-slate-100 group-hover:text-indigo-700 dark:group-hover:text-indigo-300 truncate">{name}</p>
                  <p className="text-[10px] text-slate-400 tabular-nums">{countOf[name] === null || countOf[name] === undefined ? tr('ไม่พบตาราง', 'Table missing') : `${countOf[name].toLocaleString()} ${tr('แถว', 'rows')}`}</p>
                </Link>
                <ExportLinks name={name} />
              </div>
            ))}
          </div>
        </section>
      </AdminMain>
    </AdminPage>
  );
}
