'use client';

import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { dataService } from '@/lib/supabase/dataService';
import { Assignment, Classroom, Submission } from '@/types/database';
import { ArrowLeft, BookOpen, CalendarCheck, Check, ClipboardList, Download, FileText, Megaphone, Plus, RefreshCw, Users } from 'lucide-react';

type Tab = 'overview' | 'classwork' | 'attendance' | 'people' | 'grades';
type AttendanceStatus = 'on_time' | 'late' | 'absent' | 'excused';
type AttendanceRecord = { id: string; student_id: string; status: AttendanceStatus };
type AttendanceSession = { id: string; title: string; starts_at: string; on_time_until_minutes: number; late_until_minutes: number; status: 'scheduled' | 'open' | 'closed' };
type Post = { id: string; body: string; created_at: string };

const tabs: Array<{ id: Tab; label: string; icon: typeof BookOpen }> = [
  { id: 'overview', label: 'ภาพรวม', icon: ClipboardList },
  { id: 'classwork', label: 'งานและเนื้อหา', icon: BookOpen },
  { id: 'attendance', label: 'เช็คชื่อ', icon: CalendarCheck },
  { id: 'people', label: 'ผู้เรียน', icon: Users },
  { id: 'grades', label: 'คะแนน', icon: FileText },
];
const statusLabels: Record<AttendanceStatus, string> = { on_time: 'มาตรงเวลา', late: 'มาสาย', absent: 'ขาด', excused: 'ลา' };

export default function ClassroomWorkspacePage() {
  const { user } = useUser();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const classroomId = params.id;
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [postBody, setPostBody] = useState('');
  const [attendanceTitle, setAttendanceTitle] = useState('เช็คชื่อ');
  const [attendanceStartsAt, setAttendanceStartsAt] = useState('');
  const [onTimeMinutes, setOnTimeMinutes] = useState(10);
  const [lateMinutes, setLateMinutes] = useState(30);

  const loadAttendance = async () => {
    const response = await fetch(`/api/attendance?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' });
    if (!response.ok) return;
    const result = await response.json();
    setSession(result.session || null);
    setRecords(result.records || []);
  };

  const loadWorkspace = async () => {
    if (!user?.id || !classroomId) return;
    setLoading(true);
    try {
      const [classrooms, allAssignments, allSubmissions, postsResponse] = await Promise.all([
        dataService.getClassrooms(user.id), dataService.getAssignments(), dataService.getAllSubmissions(),
        fetch(`/api/classrooms/posts?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' }),
      ]);
      const current = classrooms.find((item) => item.id === classroomId) || null;
      setClassroom(current);
      const classroomAssignments = allAssignments.filter((item) => item.classroom_id === classroomId);
      setAssignments(classroomAssignments);
      setSubmissions(allSubmissions.filter((item) => classroomAssignments.some((assignment) => assignment.id === item.assignment_id)));
      if (postsResponse.ok) setPosts((await postsResponse.json()).posts || []);
      await loadAttendance();
    } catch (error) {
      console.error('Failed to load classroom workspace:', error);
      setNotice('โหลดข้อมูลห้องเรียนไม่สำเร็จ');
    } finally { setLoading(false); }
  };
  useEffect(() => { loadWorkspace(); }, [user?.id, classroomId]);

  const attendanceCounts = useMemo(() => records.reduce((result, record) => {
    result[record.status] = (result[record.status] || 0) + 1;
    return result;
  }, {} as Record<string, number>), [records]);

  const createPost = async () => {
    if (!postBody.trim()) return;
    const response = await fetch('/api/classrooms/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ classroomId, body: postBody }) });
    if (!response.ok) { setNotice('สร้างประกาศไม่สำเร็จ'); return; }
    setPostBody(''); setNotice('ประกาศแล้ว และส่งเข้า LINE Group หากเชื่อมต่ออยู่'); await loadWorkspace();
  };
  const createAttendance = async () => {
    const startsAt = attendanceStartsAt ? new Date(attendanceStartsAt).toISOString() : new Date().toISOString();
    const response = await fetch('/api/attendance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ classroomId, title: attendanceTitle, startsAt, onTimeUntilMinutes: onTimeMinutes, lateUntilMinutes: lateMinutes }) });
    if (!response.ok) { setNotice('สร้างคาบเช็คชื่อไม่สำเร็จ กรุณารัน migration attendance'); return; }
    setNotice('เปิดคาบเช็คชื่อแล้ว'); await loadAttendance();
  };
  const updateAttendanceRecord = async (studentId: string, status: AttendanceStatus) => {
    if (!session) return;
    const response = await fetch('/api/attendance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'record', classroomId, sessionId: session.id, studentId, status }) });
    if (response.ok) await loadAttendance();
  };
  const sessionAction = async (action: 'close' | 'extend') => {
    if (!session) return;
    const lateUntil = action === 'extend' ? session.late_until_minutes + 10 : undefined;
    await fetch('/api/attendance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, classroomId, sessionId: session.id, ...(lateUntil ? { lateUntilMinutes: lateUntil } : {}) }) });
    await loadAttendance();
  };
  const exportAttendance = () => {
    if (!classroom || !session) return;
    const rows = [['นักเรียน', 'รหัสนักเรียน', 'สถานะ'], ...(classroom.students || []).map((student) => {
      const record = records.find((item) => item.student_id === student.id || item.student_id === student.line_uid);
      return [`${student.first_name} ${student.last_name}`, student.student_id || '', statusLabels[record?.status || 'absent']];
    })];
    const csv = '\ufeff' + rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `attendance-${classroom.name}-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  if (loading && !classroom) return <div className="p-6 sm:p-10 text-sm text-slate-500">กำลังโหลดห้องเรียน...</div>;
  if (!classroom) return <div className="p-6 sm:p-10 space-y-3"><p className="font-bold">ไม่พบห้องเรียนหรือไม่มีสิทธิ์เข้าถึง</p><button onClick={() => router.push('/dashboard')} className="text-amber-600 text-sm font-bold cursor-pointer hover:underline">กลับแดชบอร์ด</button></div>;

  return <div className="min-h-screen bg-slate-50 dark:bg-slate-950 -m-4 md:-m-8">
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0"><Link href="/dashboard" aria-label="กลับแดชบอร์ด" className="shrink-0 p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"><ArrowLeft className="w-4 h-4" /></Link><div className="min-w-0"><p className="text-[11px] font-bold text-amber-600 mb-0.5">{classroom.subject_code || 'CLASSROOM'} · {classroom.academic_year}</p><h1 className="text-lg sm:text-xl font-black truncate">{classroom.name}</h1></div></div>
        <div className="flex items-center gap-2 w-full sm:w-auto"><button onClick={loadWorkspace} aria-label="รีเฟรช" className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-amber-400 hover:text-amber-600 transition-colors cursor-pointer"><RefreshCw className="w-4 h-4" /></button><Link href={`/assignments/new?classroomId=${classroom.id}`} className="flex-1 sm:flex-none justify-center px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black inline-flex items-center gap-1.5 transition-colors cursor-pointer"><Plus className="w-3.5 h-3.5" />สร้างงาน</Link></div>
      </div>
      <nav aria-label="เมนูห้องเรียน" className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 sm:gap-5 overflow-x-auto">{tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`shrink-0 py-3 px-2 border-b-2 text-xs font-black whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer ${tab === id ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}><Icon className="w-3.5 h-3.5" />{label}{id === 'attendance' && session ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> : null}</button>)}</nav>
    </header>
    <main className="max-w-7xl mx-auto p-4 sm:p-6 space-y-5">
      {notice && <div role="status" className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold"><Check className="w-4 h-4" />{notice}</div>}
      {tab === 'overview' && <div className="grid xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] gap-5"><section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 space-y-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-black flex items-center gap-2"><Megaphone className="w-4 h-4 text-amber-500" />ประกาศห้องเรียน</h2><span className="text-[10px] text-slate-400">{classroom.line_group_id ? 'เชื่อม LINE Group แล้ว' : 'ยังไม่ได้เชื่อม LINE Group'}</span></div><textarea value={postBody} onChange={(e) => setPostBody(e.target.value)} placeholder="ประกาศสิ่งที่นักเรียนควรรู้..." className="w-full min-h-28 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm outline-none focus:ring-2 focus:ring-amber-200 resize-y" /><button onClick={createPost} disabled={!postBody.trim()} className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-700 disabled:opacity-40 text-white text-xs font-black transition-colors cursor-pointer disabled:cursor-not-allowed">โพสต์ประกาศ</button><div className="space-y-3">{posts.map((post) => <article key={post.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 transition-colors"><p className="text-sm whitespace-pre-wrap">{post.body}</p><time className="text-[10px] text-slate-400 mt-2 block">{new Date(post.created_at).toLocaleString('th-TH')}</time></article>)}{posts.length === 0 && <p className="text-xs text-slate-400">ยังไม่มีประกาศ</p>}</div></section><section className="grid grid-cols-2 xl:grid-cols-1 gap-3 auto-rows-min"><div className="col-span-2 xl:col-span-1 bg-gradient-to-br from-amber-500 to-orange-500 text-slate-950 rounded-2xl p-5 shadow-sm"><p className="text-xs font-bold opacity-75">ห้องเรียนนี้มี</p><p className="text-3xl font-black mt-1">{classroom.students?.length || 0}</p><p className="text-xs font-bold mt-1">นักเรียนที่ลงทะเบียน</p></div><div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 hover:border-amber-300 transition-colors"><p className="text-2xl font-black">{assignments.length}</p><p className="text-xs text-slate-500 mt-1">งานทั้งหมด</p></div><button onClick={() => setTab('attendance')} className="text-left bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 hover:border-emerald-300 transition-colors cursor-pointer"><p className="text-2xl font-black text-emerald-600">{session ? attendanceCounts.on_time || 0 : '-'}</p><p className="text-xs text-slate-500 mt-1">มาเรียนในคาบล่าสุด</p></button></section></div>}
      {tab === 'classwork' && <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 mb-5"><div><h2 className="font-black">งานและเนื้อหา</h2><p className="text-xs text-slate-500 mt-1">จัดการงานของห้อง {classroom.name}</p></div><Link href={`/assignments/new?classroomId=${classroom.id}`} className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-xs font-black transition-colors cursor-pointer">+ เพิ่มงาน</Link></div><div className="grid md:grid-cols-2 gap-3">{assignments.map((assignment) => <Link key={assignment.id} href={`/assignments/${assignment.id}/grading`} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-amber-400 hover:shadow-sm transition-all cursor-pointer"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-sm">{assignment.title}</p><p className="text-xs text-slate-500 mt-1">กำหนดส่ง {new Date(assignment.due_date).toLocaleString('th-TH')}</p></div><span className="text-xs font-bold text-slate-500 whitespace-nowrap">{assignment.total_points || 0} คะแนน</span></div></Link>)}{assignments.length === 0 && <p className="md:col-span-2 py-10 text-center text-sm text-slate-400">ยังไม่มีงานในห้องนี้</p>}</div></section>}
      {tab === 'attendance' && <AttendancePanel classroom={classroom} session={session} records={records} counts={attendanceCounts} attendanceTitle={attendanceTitle} setAttendanceTitle={setAttendanceTitle} attendanceStartsAt={attendanceStartsAt} setAttendanceStartsAt={setAttendanceStartsAt} onTimeMinutes={onTimeMinutes} setOnTimeMinutes={setOnTimeMinutes} lateMinutes={lateMinutes} setLateMinutes={setLateMinutes} createAttendance={createAttendance} updateAttendanceRecord={updateAttendanceRecord} sessionAction={sessionAction} exportAttendance={exportAttendance} />}
      {tab === 'people' && <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-sm"><div className="flex items-center justify-between mb-5"><div><h2 className="font-black">ผู้เรียน</h2><p className="text-xs text-slate-500 mt-1">{classroom.students?.length || 0} คนในห้องเรียน</p></div><Users className="w-5 h-5 text-amber-500" /></div><div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{(classroom.students || []).map((student) => <div key={student.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-transparent hover:border-amber-300 transition-colors"><div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-black text-sm">{(student.first_name || student.name || '?').charAt(0)}</div><div className="min-w-0"><p className="text-sm font-bold truncate">{student.first_name} {student.last_name}</p><p className="text-[11px] text-slate-500 font-mono">{student.student_id || 'ยังไม่มีรหัสนักเรียน'}</p></div></div>)}{!classroom.students?.length && <p className="sm:col-span-2 xl:col-span-3 py-10 text-center text-sm text-slate-400">ยังไม่มีนักเรียนในห้องนี้</p>}</div></section>}
      {tab === 'grades' && <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-sm"><div className="flex items-center justify-between mb-5"><div><h2 className="font-black">ตารางคะแนน</h2><p className="text-xs text-slate-500 mt-1">รวม {submissions.length} การส่งงาน</p></div><FileText className="w-5 h-5 text-blue-500" /></div><div className="overflow-x-auto"><table className="w-full text-xs min-w-[620px]"><thead><tr className="text-left border-b border-slate-200 dark:border-slate-700"><th className="p-3">นักเรียน</th>{assignments.map((assignment) => <th key={assignment.id} className="p-3 min-w-32">{assignment.title}</th>)}</tr></thead><tbody>{(classroom.students || []).map((student) => <tr key={student.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60"><td className="p-3 font-bold whitespace-nowrap">{student.first_name} {student.last_name}</td>{assignments.map((assignment) => { const submission = submissions.find((item) => item.assignment_id === assignment.id && (item.student_id === student.id || item.student_id === student.line_uid)); return <td key={assignment.id} className="p-3">{submission ? submission.total_score ?? submission.status : '-'}</td>; })}</tr>)}</tbody></table>{!classroom.students?.length && <p className="py-10 text-center text-sm text-slate-400">ยังไม่มีข้อมูลคะแนน</p>}</div></section>}
    </main>
  </div>;
}

function AttendancePanel({ classroom, session, records, counts, attendanceTitle, setAttendanceTitle, attendanceStartsAt, setAttendanceStartsAt, onTimeMinutes, setOnTimeMinutes, lateMinutes, setLateMinutes, createAttendance, updateAttendanceRecord, sessionAction, exportAttendance }: { classroom: Classroom; session: AttendanceSession | null; records: AttendanceRecord[]; counts: Record<string, number>; attendanceTitle: string; setAttendanceTitle: (value: string) => void; attendanceStartsAt: string; setAttendanceStartsAt: (value: string) => void; onTimeMinutes: number; setOnTimeMinutes: (value: number) => void; lateMinutes: number; setLateMinutes: (value: number) => void; createAttendance: () => void; updateAttendanceRecord: (studentId: string, status: AttendanceStatus) => void; sessionAction: (action: 'close' | 'extend') => void; exportAttendance: () => void }) {
  const cards: Array<[AttendanceStatus, string, string]> = [['on_time', 'ตรงเวลา', 'emerald'], ['late', 'มาสาย', 'amber'], ['absent', 'ขาด', 'rose'], ['excused', 'ลา', 'blue']];
  const cardStyles: Record<string, string> = { emerald: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300', amber: 'bg-amber-50 dark:bg-amber-950/30 border-amber-100 dark:border-amber-900/40 text-amber-700 dark:text-amber-300', rose: 'bg-rose-50 dark:bg-rose-950/30 border-rose-100 dark:border-rose-900/40 text-rose-700 dark:text-rose-300', blue: 'bg-blue-50 dark:bg-blue-950/30 border-blue-100 dark:border-blue-900/40 text-blue-700 dark:text-blue-300' };
  return <section className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold text-emerald-600">ATTENDANCE</p><h2 className="text-xl font-black mt-1">เช็คชื่อรายคาบ</h2><p className="text-xs text-slate-500 mt-1">สร้างคาบ แล้วปรับสถานะผู้เรียนได้จากหน้านี้</p></div>{session && <button onClick={exportAttendance} className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-emerald-400 text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"><Download className="w-3.5 h-3.5" />ส่งออก CSV</button>}</div><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{cards.map(([key, label, color]) => <div key={key} className={`p-4 rounded-2xl border ${cardStyles[color]}`}><p className="text-2xl font-black">{counts[key] || 0}</p><p className="text-xs font-bold opacity-80 mt-1">{label}</p></div>)}</div><div className="grid xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-5"><div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4 shadow-sm"><div><h3 className="font-black">เปิดคาบเช็คชื่อใหม่</h3><p className="text-xs text-slate-500 mt-1">ตั้งเวลาเกณฑ์การมาสายได้</p></div><div className="grid sm:grid-cols-2 xl:grid-cols-1 gap-3"><label className="text-xs font-bold">ชื่อคาบ<input value={attendanceTitle} onChange={(e) => setAttendanceTitle(e.target.value)} className="mt-1 w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-emerald-200" /></label><label className="text-xs font-bold">เริ่มคาบ<input type="datetime-local" value={attendanceStartsAt} onChange={(e) => setAttendanceStartsAt(e.target.value)} className="mt-1 w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs outline-none focus:ring-2 focus:ring-emerald-200" /></label></div><div className="grid grid-cols-2 gap-3"><label className="text-xs font-bold">ตรงเวลาภายใน<input type="number" min="0" value={onTimeMinutes} onChange={(e) => setOnTimeMinutes(Number(e.target.value))} className="mt-1 w-full p-2.5 rounded-xl border text-xs" /></label><label className="text-xs font-bold">สายได้ถึง<input type="number" min={onTimeMinutes} value={lateMinutes} onChange={(e) => setLateMinutes(Number(e.target.value))} className="mt-1 w-full p-2.5 rounded-xl border text-xs" /></label></div><button onClick={createAttendance} className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-colors cursor-pointer">เปิดคาบเช็คชื่อ</button>{session && <div className="flex gap-2"><button onClick={() => sessionAction('extend')} disabled={session.status === 'closed'} className="flex-1 py-2 rounded-xl border hover:border-amber-400 text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">เพิ่มเวลา 10 นาที</button><button onClick={() => sessionAction('close')} disabled={session.status === 'closed'} className="flex-1 py-2 rounded-xl border hover:border-rose-400 text-xs font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">{session.status === 'closed' ? 'ปิดรับแล้ว' : 'ปิดรับเช็คชื่อ'}</button></div>}</div><div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm"><div className="flex items-center justify-between gap-3 mb-4"><div><h3 className="font-black">รายชื่อและสถานะ</h3><p className="text-xs text-slate-500 mt-1">{session ? `${session.title} · ${session.status === 'closed' ? 'ปิดรับแล้ว' : 'กำลังเปิดรับ'}` : 'ยังไม่มีคาบที่เลือก'}</p></div><CalendarCheck className="w-5 h-5 text-emerald-500" /></div><div className="space-y-2">{(classroom.students || []).map((student) => { const record = records.find((item) => item.student_id === student.id || item.student_id === student.line_uid); return <div key={student.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"><span className="text-xs font-bold truncate">{student.first_name} {student.last_name}</span><select disabled={!session || session.status === 'closed'} value={record?.status || 'absent'} onChange={(e) => updateAttendanceRecord(student.id, e.target.value as AttendanceStatus)} className="shrink-0 p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs cursor-pointer disabled:cursor-not-allowed">{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>; })}{!classroom.students?.length && <p className="py-10 text-center text-sm text-slate-400">ยังไม่มีนักเรียนในห้องนี้</p>}</div></div></div></section>;
}
