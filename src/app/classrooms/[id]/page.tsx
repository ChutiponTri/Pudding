'use client';

import { useUser } from '@clerk/nextjs';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { dataService } from '@/lib/supabase/dataService';
import { Assignment, Classroom, Submission } from '@/types/database';
import { ArrowLeft, BookOpen, CalendarCheck, ClipboardList, Download, Megaphone, Plus, RefreshCw, Users } from 'lucide-react';

type Tab = 'overview' | 'classwork' | 'people' | 'grades' | 'summary';
type AttendanceRecord = { id: string; student_id: string; status: 'on_time' | 'late' | 'absent' | 'excused' };
type AttendanceSession = { id: string; title: string; starts_at: string; on_time_until_minutes: number; late_until_minutes: number; status: 'scheduled' | 'open' | 'closed' };
type Post = { id: string; body: string; created_at: string };

const tabs: Array<{ id: Tab; label: string; icon: typeof BookOpen }> = [
  { id: 'overview', label: 'ภาพรวม', icon: ClipboardList },
  { id: 'classwork', label: 'Classwork', icon: BookOpen },
  { id: 'people', label: 'People', icon: Users },
  { id: 'grades', label: 'Grade', icon: ClipboardList },
  { id: 'summary', label: 'Summary', icon: CalendarCheck },
];

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
  const [attendanceTitle, setAttendanceTitle] = useState('เช็กชื่อ');
  const [attendanceStartsAt, setAttendanceStartsAt] = useState('');
  const [onTimeMinutes, setOnTimeMinutes] = useState(10);
  const [lateMinutes, setLateMinutes] = useState(30);

  const loadWorkspace = async () => {
    if (!user?.id || !classroomId) return;
    setLoading(true);
    try {
      const [classrooms, allAssignments, allSubmissions, postsResponse] = await Promise.all([
        dataService.getClassrooms(user.id),
        dataService.getAssignments(),
        dataService.getAllSubmissions(),
        fetch(`/api/classrooms/posts?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' }),
      ]);
      const current = classrooms.find((item) => item.id === classroomId) || null;
      setClassroom(current);
      setAssignments(allAssignments.filter((item) => item.classroom_id === classroomId));
      setSubmissions(allSubmissions.filter((item) => allAssignments.some((assignment) => assignment.id === item.assignment_id && assignment.classroom_id === classroomId)));
      if (postsResponse.ok) setPosts((await postsResponse.json()).posts || []);
      await loadAttendance();
    } catch (error) {
      console.error('Failed to load classroom workspace:', error);
      setNotice('โหลดข้อมูลห้องเรียนไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const loadAttendance = async () => {
    const response = await fetch(`/api/attendance?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' });
    if (!response.ok) return;
    const result = await response.json();
    setSession(result.session || null);
    setRecords(result.records || []);
  };

  useEffect(() => {
    loadWorkspace();
  }, [user?.id, classroomId]);

  const attendanceCounts = useMemo(() => records.reduce((result, record) => {
    result[record.status] = (result[record.status] || 0) + 1;
    return result;
  }, {} as Record<string, number>), [records]);

  const createPost = async () => {
    if (!postBody.trim()) return;
    const response = await fetch('/api/classrooms/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ classroomId, body: postBody }) });
    if (!response.ok) { setNotice('สร้างประกาศไม่สำเร็จ'); return; }
    setPostBody('');
    setNotice('ประกาศแล้ว และส่งเข้า LINE Group หากเชื่อมต่ออยู่');
    await loadWorkspace();
  };

  const createAttendance = async () => {
    const startsAt = attendanceStartsAt ? new Date(attendanceStartsAt).toISOString() : new Date().toISOString();
    const response = await fetch('/api/attendance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ classroomId, title: attendanceTitle, startsAt, onTimeUntilMinutes: onTimeMinutes, lateUntilMinutes: lateMinutes }) });
    if (!response.ok) { setNotice('สร้างคาบเช็กชื่อไม่สำเร็จ กรุณารัน migration attendance'); return; }
    setNotice('เปิดคาบเช็กชื่อแล้ว');
    await loadAttendance();
  };

  const updateAttendanceRecord = async (studentId: string, status: AttendanceRecord['status']) => {
    if (!session) return;
    const response = await fetch('/api/attendance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'record', classroomId, sessionId: session.id, studentId, status }) });
    if (response.ok) await loadAttendance();
  };

  const closeAttendance = async () => {
    if (!session) return;
    await fetch('/api/attendance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'close', classroomId, sessionId: session.id }) });
    await loadAttendance();
  };

  const extendAttendance = async () => {
    if (!session) return;
    const extraMinutes = Number(window.prompt('ต้องการเพิ่มเวลารับเช็กชื่ออีกกี่นาที?', '10'));
    if (!Number.isFinite(extraMinutes) || extraMinutes <= 0) return;
    const response = await fetch('/api/attendance', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'extend', classroomId, sessionId: session.id, lateUntilMinutes: session.late_until_minutes + extraMinutes }) });
    if (response.ok) { setNotice(`เพิ่มเวลารับเช็กชื่ออีก ${extraMinutes} นาทีแล้ว`); await loadAttendance(); }
  };

  const exportAttendance = () => {
    if (!classroom || !session) return;
    const rows = [['นักเรียน', 'รหัสนักเรียน', 'สถานะ'], ...(classroom.students || []).map((student) => {
      const record = records.find((item) => item.student_id === student.id || item.student_id === student.line_uid);
      return [`${student.first_name} ${student.last_name}`, student.student_id || '', record?.status || 'absent'];
    })];
    const csv = '\ufeff' + rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `attendance-${classroom.name}-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };

  if (loading && !classroom) return <div className="p-8 text-sm text-slate-500">กำลังโหลดห้องเรียน...</div>;
  if (!classroom) return <div className="p-8 space-y-3"><p className="font-bold">ไม่พบห้องเรียนหรือไม่มีสิทธิ์เข้าถึง</p><button onClick={() => router.push('/classrooms')} className="text-amber-600 text-sm font-bold">กลับไปหน้าห้องเรียน</button></div>;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 -m-4 md:-m-8">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-5 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0"><Link href="/classrooms" className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"><ArrowLeft className="w-4 h-4" /></Link><div className="min-w-0"><h1 className="text-xl font-black truncate">{classroom.name}</h1><p className="text-xs text-slate-500 mt-1">{classroom.subject_code || 'Classroom'} · {classroom.academic_year}</p></div></div>
          <div className="flex items-center gap-2"><button onClick={() => loadWorkspace()} className="p-2 rounded-xl border border-slate-200 dark:border-slate-700"><RefreshCw className="w-4 h-4" /></button><Link href={`/assignments/new?classroomId=${classroom.id}`} className="px-3 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-black inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" />สร้างงาน</Link></div>
        </div>
        <nav className="max-w-7xl mx-auto px-5 flex gap-5 overflow-x-auto">{tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`py-3 border-b-2 text-xs font-black whitespace-nowrap flex items-center gap-1.5 ${tab === id ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500'}`}><Icon className="w-3.5 h-3.5" />{label}</button>)}</nav>
      </header>
      <main className="max-w-7xl mx-auto p-5 space-y-5">
        {notice && <div className="p-3 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold">{notice}</div>}
        {tab === 'overview' && <div className="grid lg:grid-cols-[1.3fr_1fr] gap-5"><section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4"><div className="flex items-center justify-between"><h2 className="font-black flex items-center gap-2"><Megaphone className="w-4 h-4 text-amber-500" />ประกาศห้องเรียน</h2><span className="text-[10px] text-slate-400">{classroom.line_group_id ? 'ส่ง LINE Group แล้วเมื่อประกาศ' : 'ยังไม่ได้เชื่อม LINE Group'}</span></div><textarea value={postBody} onChange={(e) => setPostBody(e.target.value)} placeholder="ประกาศสิ่งที่นักเรียนควรรู้..." className="w-full min-h-24 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm" /><button onClick={createPost} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black">โพสต์ประกาศ</button><div className="space-y-3">{posts.map((post) => <article key={post.id} className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800"><p className="text-sm whitespace-pre-wrap">{post.body}</p><time className="text-[10px] text-slate-400">{new Date(post.created_at).toLocaleString('th-TH')}</time></article>)}</div></section><section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5"><h2 className="font-black mb-4">ภาพรวมงาน</h2><div className="grid grid-cols-2 gap-3"><div className="p-4 rounded-xl bg-amber-50 text-amber-800"><p className="text-2xl font-black">{assignments.length}</p><p className="text-xs font-bold">งานทั้งหมด</p></div><div className="p-4 rounded-xl bg-blue-50 text-blue-800"><p className="text-2xl font-black">{classroom.students?.length || 0}</p><p className="text-xs font-bold">นักเรียน</p></div></div></section></div>}
        {tab === 'classwork' && <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5"><div className="flex items-center justify-between mb-4"><h2 className="font-black">งานและเนื้อหา</h2><Link href={`/assignments/new?classroomId=${classroom.id}`} className="px-3 py-2 rounded-xl bg-amber-500 text-xs font-black">+ เพิ่มงาน</Link></div><div className="space-y-2">{assignments.map((assignment) => <div key={assignment.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 flex justify-between"><div><p className="font-bold text-sm">{assignment.title}</p><p className="text-xs text-slate-500 mt-1">กำหนดส่ง {new Date(assignment.due_date).toLocaleString('th-TH')}</p></div><span className="text-xs font-bold text-slate-500">{assignment.total_points || 0} คะแนน</span></div>)}{assignments.length === 0 && <p className="text-sm text-slate-400">ยังไม่มีงานในห้องนี้</p>}</div></section>}
        {tab === 'people' && <section className="grid lg:grid-cols-2 gap-5"><div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5"><h2 className="font-black mb-4">ครูผู้สอน</h2><p className="text-sm font-bold">{classroom.teacher_id}</p>{(classroom.teachers || []).map((teacher) => <p key={teacher.teacher_id} className="text-sm text-slate-600 mt-2">{teacher.name} · {teacher.role}</p>)}</div><div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5"><h2 className="font-black mb-4">นักเรียน ({classroom.students?.length || 0})</h2><div className="space-y-2">{(classroom.students || []).map((student) => <div key={student.id} className="flex justify-between text-sm"><span>{student.first_name} {student.last_name}</span><span className="font-mono text-slate-400">{student.student_id || '-'}</span></div>)}</div></div></section>}
        {tab === 'grades' && <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 overflow-x-auto"><div className="flex items-center justify-between mb-4"><h2 className="font-black">ตารางคะแนน</h2><span className="text-xs text-slate-500">รวม {submissions.length} การส่งงาน</span></div><table className="w-full text-xs"><thead><tr className="text-left border-b border-slate-200"><th className="p-3">นักเรียน</th>{assignments.map((assignment) => <th key={assignment.id} className="p-3 min-w-28">{assignment.title}</th>)}</tr></thead><tbody>{(classroom.students || []).map((student) => <tr key={student.id} className="border-b border-slate-100"><td className="p-3 font-bold whitespace-nowrap">{student.first_name} {student.last_name}</td>{assignments.map((assignment) => { const submission = submissions.find((item) => item.assignment_id === assignment.id && (item.student_id === student.id || item.student_id === student.line_uid)); return <td key={assignment.id} className="p-3">{submission ? submission.status : '-'}</td>; })}</tr>)}</tbody></table></section>}
        {tab === 'summary' && <div className="grid lg:grid-cols-[1fr_1.4fr] gap-5"><section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4"><div className="flex items-center justify-between"><h2 className="font-black flex items-center gap-2"><CalendarCheck className="w-4 h-4 text-emerald-500" />เช็กชื่อรายคาบ</h2>{session && <button onClick={exportAttendance} className="text-xs font-bold text-emerald-600 inline-flex items-center gap-1"><Download className="w-3.5 h-3.5" />Export Excel</button>}</div><div className="grid grid-cols-3 gap-2 text-center text-xs"><div className="p-3 rounded-xl bg-emerald-50 text-emerald-700"><b className="text-lg">{attendanceCounts.on_time || 0}</b><br />มาตรงเวลา</div><div className="p-3 rounded-xl bg-amber-50 text-amber-700"><b className="text-lg">{attendanceCounts.late || 0}</b><br />มาสาย</div><div className="p-3 rounded-xl bg-rose-50 text-rose-700"><b className="text-lg">{attendanceCounts.absent || 0}</b><br />ขาด</div></div><div className="grid grid-cols-2 gap-2"><input value={attendanceTitle} onChange={(e) => setAttendanceTitle(e.target.value)} className="p-2.5 rounded-xl border text-xs" placeholder="ชื่อคาบ" /><input type="datetime-local" value={attendanceStartsAt} onChange={(e) => setAttendanceStartsAt(e.target.value)} className="p-2.5 rounded-xl border text-xs" /></div><div className="grid grid-cols-2 gap-2"><label className="text-xs font-bold">มาตรงเวลาภายใน (นาที)<input type="number" min="0" value={onTimeMinutes} onChange={(e) => setOnTimeMinutes(Number(e.target.value))} className="mt-1 w-full p-2.5 rounded-xl border text-xs" /></label><label className="text-xs font-bold">มาสายได้ถึง (นาที)<input type="number" min={onTimeMinutes} value={lateMinutes} onChange={(e) => setLateMinutes(Number(e.target.value))} className="mt-1 w-full p-2.5 rounded-xl border text-xs" /></label></div><button onClick={createAttendance} className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black">เปิด/ตั้งคาบเช็กชื่อ</button>{session && <div className="flex gap-2"><button onClick={extendAttendance} disabled={session.status === 'closed'} className="flex-1 py-2 rounded-xl border text-xs font-bold">เพิ่มเวลา</button><button onClick={closeAttendance} disabled={session.status === 'closed'} className="flex-1 py-2 rounded-xl border text-xs font-bold">{session.status === 'closed' ? 'ปิดรับแล้ว' : 'ปิดรับเช็กชื่อ'}</button><button onClick={loadAttendance} className="px-3 rounded-xl border"><RefreshCw className="w-3.5 h-3.5" /></button></div>}</section><section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5"><h2 className="font-black mb-4">รายชื่อและการปรับสถานะ</h2><div className="space-y-2">{(classroom.students || []).map((student) => { const record = records.find((item) => item.student_id === student.id || item.student_id === student.line_uid); return <div key={student.id} className="flex items-center justify-between gap-3 p-2 rounded-xl bg-slate-50 dark:bg-slate-800"><span className="text-xs font-bold truncate">{student.first_name} {student.last_name}</span><select disabled={!session || session.status === 'closed'} value={record?.status || 'absent'} onChange={(e) => updateAttendanceRecord(student.id, e.target.value as AttendanceRecord['status'])} className="p-1.5 rounded-lg border text-xs"><option value="on_time">มาตรงเวลา</option><option value="late">มาสาย</option><option value="absent">ขาด</option><option value="excused">ลา</option></select></div>; })}</div></section></div>}
      </main>
    </div>
  );
}
