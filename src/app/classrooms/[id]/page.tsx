'use client';

import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { dataService } from '@/lib/supabase/dataService';
import { Assignment, Classroom, Submission } from '@/types/database';
import {
  ArrowLeft,
  BookOpen,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  ExternalLink,
  FileText,
  FolderPlus,
  Layers,
  Megaphone,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Tag,
  UserCheck,
  Users,
  X,
} from 'lucide-react';

type Tab = 'overview' | 'classwork' | 'attendance' | 'people' | 'grades';
type AttendanceStatus = 'on_time' | 'late' | 'absent' | 'excused';
type AttendanceRecord = { id: string; student_id: string; status: AttendanceStatus; checked_at?: string };
type AttendanceSession = {
  id: string;
  title: string;
  starts_at: string;
  on_time_until_minutes: number;
  late_until_minutes: number;
  status: 'scheduled' | 'open' | 'closed';
};
type TimelineItem = {
  id: string;
  title: string;
  body: string;
  type: 'announcement' | 'assignment' | 'exam' | 'attendance';
  created_at: string;
  href?: string;
  badgeLabel: string;
  badgeColor: string;
};
type Post = {
  id: string;
  body: string;
  created_at: string;
  activity_type?: TimelineItem['type'];
  metadata?: { assignmentId?: string; groupName?: string };
};

const tabs: Array<{ id: Tab; label: string; icon: typeof BookOpen }> = [
  { id: 'overview', label: 'ภาพรวม', icon: ClipboardList },
  { id: 'classwork', label: 'งานและเนื้อหา', icon: BookOpen },
  { id: 'attendance', label: 'เช็คชื่อ', icon: CalendarCheck },
  { id: 'people', label: 'ผู้เรียน', icon: Users },
  { id: 'grades', label: 'คะแนน', icon: FileText },
];

const statusLabels: Record<AttendanceStatus, string> = {
  on_time: 'มาตรงเวลา',
  late: 'มาสาย',
  absent: 'ขาด',
  excused: 'ลา',
};

export default function ClassroomWorkspacePage() {
  const { user } = useUser();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const classroomId = params.id;

  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);

  const [tab, setTab] = useState<Tab>((search.get('tab') as Tab) || 'overview');
  const [loading, setLoading] = useState(true);
  const [gradesLoading, setGradesLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Overview announcement form
  const [postBody, setPostBody] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  // Attendance form state
  const [attendanceTitle, setAttendanceTitle] = useState('เช็คชื่อประจำคาบ');
  const [attendanceStartsAt, setAttendanceStartsAt] = useState('');
  const [onTimeMinutes, setOnTimeMinutes] = useState(10);
  const [lateMinutes, setLateMinutes] = useState(30);

  // Group Management State for Classwork
  const [newGroupName, setNewGroupName] = useState('');
  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [editingAssignmentGroup, setEditingAssignmentGroup] = useState<Assignment | null>(null);
  const [targetGroupForAssignment, setTargetGroupForAssignment] = useState('');

  // ----------------------------------------------------
  // HIGH-SPEED OPTIMIZED PARALLEL DATA LOADER
  // ----------------------------------------------------
  const loadWorkspace = async () => {
    if (!classroomId) return;
    setLoading(true);
    try {
      // 1. Fire all requests concurrently in parallel
      const [allClasses, classAssignments, postsRes, attRes] = await Promise.all([
        dataService.getClassrooms(user?.id),
        dataService.getAssignmentsByClassroomId(classroomId),
        fetch(`/api/classrooms/posts?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' }),
        fetch(`/api/attendance?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' }),
      ]);

      const current = allClasses.find((item) => item.id === classroomId) || null;
      setClassrooms(allClasses);
      setClassroom(current);
      setAssignments(classAssignments);

      if (postsRes.ok) {
        const postsJson = await postsRes.json();
        setPosts(postsJson.posts || []);
      }

      if (attRes.ok) {
        const attJson = await attRes.json();
        setSessions(attJson.sessions || []);
        setSession(attJson.session || null);
        setRecords(attJson.records || []);
      }
    } catch (error) {
      console.error('Failed to load classroom workspace:', error);
      setNotice('โหลดข้อมูลห้องเรียนไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const loadAttendance = async () => {
    try {
      const response = await fetch(`/api/attendance?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json();
      setSessions(result.sessions || []);
      setSession(result.session || null);
      setRecords(result.records || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadAttendanceSession = async (sessionId: string) => {
    try {
      const response = await fetch(
        `/api/attendance?classroomId=${encodeURIComponent(classroomId)}&sessionId=${encodeURIComponent(sessionId)}`,
        { cache: 'no-store' }
      );
      if (!response.ok) return;
      const result = await response.json();
      setSession(result.session || null);
      setRecords(result.records || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, [user?.id, classroomId]);

  useEffect(() => {
    if (tab !== 'grades' || !assignments.length || submissions.length || gradesLoading) return;
    setGradesLoading(true);
    Promise.all(assignments.map((item) => dataService.getSubmissions(item.id)))
      .then((results) => setSubmissions(results.flat()))
      .finally(() => setGradesLoading(false));
  }, [tab, assignments]);

  const setActiveTab = (next: Tab) => {
    setTab(next);
    window.history.replaceState({}, '', `/classrooms/${classroomId}?tab=${next}`);
  };

  const attendanceCounts = useMemo(
    () =>
      records.reduce(
        (result, record) => {
          result[record.status] = (result[record.status] || 0) + 1;
          return result;
        },
        {} as Record<string, number>
      ),
    [records]
  );

  // Unified Chronological Timeline (Announcements, Assignments, Exams, Attendance)
  const timeline = useMemo<TimelineItem[]>(() => {
    const list: TimelineItem[] = [
      ...posts.map((post) => {
        let title = 'ประกาศจากคุณครู';
        let badgeLabel = 'ประกาศ';
        let badgeColor = 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300';
        if (post.activity_type === 'assignment') {
          title = 'มอบหมายงานใหม่';
          badgeLabel = 'งาน';
          badgeColor = 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300';
        } else if (post.activity_type === 'exam') {
          title = 'สร้างข้อสอบใหม่';
          badgeLabel = 'ข้อสอบ';
          badgeColor = 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300';
        } else if (post.activity_type === 'attendance') {
          title = 'เปิดคาบเช็คชื่อ';
          badgeLabel = 'เช็คชื่อ';
          badgeColor = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300';
        }

        return {
          id: `post-${post.id}`,
          title,
          body: post.body,
          type: post.activity_type || 'announcement',
          created_at: post.created_at,
          badgeLabel,
          badgeColor,
          href: post.metadata?.assignmentId ? `/assignments/${post.metadata.assignmentId}/grading` : undefined,
        };
      }),
      ...assignments.map((item) => ({
        id: `assignment-${item.id}`,
        title: item.is_exam ? 'ข้อสอบในระบบ' : 'งานที่มอบหมาย',
        body: `${item.title} (กำหนดส่ง: ${new Date(item.due_date).toLocaleString('th-TH')})`,
        type: item.is_exam ? ('exam' as const) : ('assignment' as const),
        badgeLabel: item.is_exam ? 'ข้อสอบ' : 'งาน',
        badgeColor: item.is_exam
          ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
        created_at: item.created_at || item.due_date,
        href: `/assignments/${item.id}/grading`,
      })),
      ...sessions.map((item) => ({
        id: `attendance-${item.id}`,
        title: 'เปิดคาบเช็คชื่อ',
        body: `${item.title} (สถานะ: ${item.status === 'open' ? 'เปิดรับอยู่' : 'ปิดแล้ว'})`,
        type: 'attendance' as const,
        badgeLabel: 'เช็คชื่อ',
        badgeColor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
        created_at: item.starts_at,
      })),
    ];

    // Deduplicate posts that mirror the exact same assignment or session
    const seen = new Set<string>();
    const filtered: TimelineItem[] = [];
    for (const item of list) {
      const key = `${item.type}-${item.body.trim().slice(0, 30)}`;
      if (!seen.has(key)) {
        seen.add(key);
        filtered.push(item);
      }
    }

    return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [posts, assignments, sessions]);

  // Group Classrooms by Subject / Course for Sidebar
  const coursesMap = useMemo(() => {
    const map = new Map<string, { label: string; classrooms: Classroom[] }>();
    for (const cls of classrooms) {
      const key = cls.course_name || cls.subject_code || 'รายวิชาทั่วไป';
      if (!map.has(key)) {
        map.set(key, { label: key, classrooms: [] });
      }
      map.get(key)!.classrooms.push(cls);
    }
    return map;
  }, [classrooms]);

  // Existing group names across assignments
  const existingGroupNames = useMemo(() => {
    const set = new Set<string>();
    assignments.forEach((a) => {
      if (a.group_name && a.group_name.trim()) set.add(a.group_name.trim());
    });
    return Array.from(set);
  }, [assignments]);

  // Post Announcement
  const createPost = async () => {
    if (!postBody.trim()) return;
    setIsPosting(true);
    try {
      const response = await fetch('/api/classrooms/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classroomId, body: postBody, activityType: 'announcement' }),
      });
      if (!response.ok) {
        setNotice('บันทึกประกาศไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        return;
      }
      setPostBody('');
      setNotice('โพสต์ประกาศเรียบร้อย และส่งเข้า LINE Group แล้ว');
      await loadWorkspace();
    } catch {
      setNotice('เกิดข้อผิดพลาดในการโพสต์ประกาศ');
    } finally {
      setIsPosting(false);
    }
  };

  // Create Attendance Session
  const createAttendance = async () => {
    const startsAt = attendanceStartsAt ? new Date(attendanceStartsAt).toISOString() : new Date().toISOString();
    try {
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          classroomId,
          title: attendanceTitle,
          startsAt,
          onTimeUntilMinutes: onTimeMinutes,
          lateUntilMinutes: lateMinutes,
        }),
      });
      if (!response.ok) {
        setNotice('สร้างคาบเช็คชื่อไม่สำเร็จ');
        return;
      }
      setNotice('เปิดคาบเช็คชื่อแล้ว และส่งแจ้งเตือนเข้า LINE Group');
      await loadAttendance();
      await loadWorkspace();
    } catch {
      setNotice('เกิดข้อผิดพลาดในการเปิดคาบเช็คชื่อ');
    }
  };

  // Update Attendance Record
  const updateAttendanceRecord = async (studentId: string, status: AttendanceStatus) => {
    if (!session) return;
    const response = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'record', classroomId, sessionId: session.id, studentId, status }),
    });
    if (response.ok) await loadAttendance();
  };

  // Close or Extend Session
  const sessionAction = async (action: 'close' | 'extend') => {
    if (!session) return;
    await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action,
        classroomId,
        sessionId: session.id,
        ...(action === 'extend' ? { lateUntilMinutes: session.late_until_minutes + 10 } : {}),
      }),
    });
    await loadAttendance();
  };

  // Move / Update assignment group
  const handleUpdateAssignmentGroup = async (assignmentId: string, newGroup: string) => {
    const clean = newGroup.trim();
    try {
      await dataService.updateAssignment(assignmentId, { group_name: clean || undefined });
      setAssignments((prev) =>
        prev.map((a) => (a.id === assignmentId ? { ...a, group_name: clean || undefined } : a))
      );
      setEditingAssignmentGroup(null);
      setNotice(`ย้ายงานไปยังหมวดหมู่ "${clean || 'งานทั่วไป'}" เรียบร้อย`);
    } catch {
      setNotice('อัปเดตกลุ่มงานไม่สำเร็จ');
    }
  };

  // Export Attendance CSV
  const exportAttendance = () => {
    if (!classroom || !session) return;
    const rows = [
      ['นักเรียน', 'รหัสนักเรียน', 'สถานะ', 'เวลาที่เช็ค'],
      ...(classroom.students || []).map((student) => {
        const record = records.find((item) => item.student_id === student.id || item.student_id === student.line_uid);
        return [
          `${student.first_name} ${student.last_name}`,
          student.student_id || '',
          statusLabels[record?.status || 'absent'],
          record?.checked_at ? new Date(record.checked_at).toLocaleTimeString('th-TH') : '-',
        ];
      }),
    ];
    const url = URL.createObjectURL(
      new Blob(['\ufeff' + rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')], {
        type: 'text/csv;charset=utf-8',
      })
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `attendance-${classroom.name}-${new Date().toLocaleDateString('th-TH')}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (loading && !classroom) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-sm text-slate-500 space-y-3">
        <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
        <p className="font-bold">กำลังโหลดห้องเรียนอย่างรวดเร็ว...</p>
      </div>
    );
  }

  if (!classroom) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center space-y-4">
        <p className="font-black text-lg text-slate-800 dark:text-slate-100">ไม่พบห้องเรียนหรือไม่มีสิทธิ์เข้าถึง</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="px-5 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs cursor-pointer shadow-md"
        >
          กลับสู่แดชบอร์ด
        </button>
      </div>
    );
  }

  const teachers = [
    { teacher_id: classroom.teacher_id, name: 'ครูผู้สอนหลัก', role: 'primary' },
    ...(classroom.teachers || []),
  ].filter((teacher, index, list) => list.findIndex((item) => item.teacher_id === teacher.teacher_id) === index);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 -m-4 md:-m-8">
      {/* Mobile Top App Bar with Drawer Toggle */}
      <div className="lg:hidden sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
            aria-label="เปิดเมนูวิชาและห้องเรียน"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-amber-600 truncate">{classroom.course_name || classroom.subject_code || 'CLASSROOM'}</p>
            <h1 className="text-sm font-black text-slate-900 dark:text-white truncate">{classroom.name}</h1>
          </div>
        </div>
        <button onClick={loadWorkspace} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-slate-500">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="max-w-[1700px] mx-auto min-h-screen flex">
        {/* Backdrop for Mobile Sidebar */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs transition-opacity"
          />
        )}

        {/* ============================================================== */}
        {/* PERSISTENT & RESPONSIVE SIDEBAR (วิชาต่างๆ และห้องแต่ละห้อง) */}
        {/* ============================================================== */}
        <aside
          className={`fixed lg:sticky top-0 left-0 z-50 lg:z-10 h-screen w-72 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-transform duration-200 ease-in-out ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
        >
          {/* Sidebar Header */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-amber-600 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>แดชบอร์ดครู</span>
            </Link>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Current Classroom Card in Sidebar */}
          <div className="p-4 bg-linear-to-b from-amber-500/10 to-transparent border-b border-slate-200 dark:border-slate-800">
            <span className="text-[10px] font-black uppercase text-amber-600">ห้องเรียนปัจจุบัน</span>
            <p className="text-sm font-black text-slate-900 dark:text-white truncate mt-0.5">{classroom.name}</p>
            <p className="text-[11px] text-slate-500 truncate">
              {classroom.course_name || classroom.subject_code} · {classroom.student_count || classroom.students?.length || 0} ผู้เรียน
            </p>
          </div>

          {/* Tab Navigation in Sidebar */}
          <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-1">
            <p className="text-[10px] font-black uppercase text-slate-400 px-2 py-1">เมนูห้องเรียน</p>
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => {
                  setActiveTab(id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold text-left transition-colors cursor-pointer ${
                  tab === id
                    ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {/* Grouped Subjects and Classrooms List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <div className="flex items-center justify-between px-2">
              <p className="text-[10px] font-black uppercase text-slate-400">สลับรายวิชา / ห้องเรียน</p>
              <span className="text-[10px] text-slate-400 font-bold">{classrooms.length} ห้อง</span>
            </div>

            {Array.from(coursesMap.entries()).map(([courseTitle, group]) => (
              <div key={courseTitle} className="space-y-1">
                <div className="px-2 py-1 flex items-center justify-between">
                  <p className="text-xs font-black text-slate-800 dark:text-slate-200 truncate">{courseTitle}</p>
                  <span className="text-[10px] text-slate-400 font-mono">({group.classrooms.length})</span>
                </div>
                <div className="space-y-0.5 pl-1">
                  {group.classrooms.map((item) => {
                    const isActive = item.id === classroomId;
                    return (
                      <Link
                        key={item.id}
                        href={`/classrooms/${item.id}?tab=${tab}`}
                        onClick={() => setSidebarOpen(false)}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          isActive
                            ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-900 dark:text-amber-200 font-black border border-amber-300 dark:border-amber-700'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <span className="truncate">{item.name}</span>
                        <span className="text-[10px] text-slate-400 font-normal shrink-0">
                          {item.student_count || item.students?.length || 0} คน
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Sidebar Footer */}
          <div className="p-3 border-t border-slate-200 dark:border-slate-800 text-center">
            <span className="text-[10px] text-slate-400 font-medium">Pudding Assessment Platform</span>
          </div>
        </aside>

        {/* ============================================================== */}
        {/* MAIN WORKSPACE CONTENT AREA */}
        {/* ============================================================== */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
          {/* Header Row */}
          <div className="hidden lg:flex items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-amber-600 mb-1">
                <span>{classroom.subject_code || 'CLASSROOM'}</span>
                <span>•</span>
                <span>ภาคเรียน {classroom.academic_year || 'ปัจจุบัน'}</span>
              </div>
              <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{classroom.name}</h1>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">
                {classroom.line_group_id ? '🟢 เชื่อมต่อ LINE Group แล้ว' : '⚪ ยังไม่เชื่อม LINE Group'}
              </span>
              <button
                onClick={loadWorkspace}
                className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-amber-400 text-slate-600 dark:text-slate-300 hover:text-amber-600 transition-colors cursor-pointer"
                aria-label="รีเฟรชข้อมูล"
                title="รีเฟรชข้อมูล"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Quick Tab Switcher on Desktop */}
          <nav className="flex gap-1.5 overflow-x-auto border-b border-slate-200 dark:border-slate-800 pb-3 mb-6 scrollbar-none">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`shrink-0 px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all cursor-pointer ${
                  tab === id
                    ? 'bg-amber-500 text-slate-950 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          {/* Alert / Notice Banner */}
          {notice && (
            <div className="mb-6 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 text-xs font-bold flex items-center justify-between gap-2 border border-emerald-200 dark:border-emerald-800 animate-in fade-in duration-200">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{notice}</span>
              </div>
              <button onClick={() => setNotice('')} className="p-1 hover:opacity-75 cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 1: OVERVIEW (ภาพรวม) - Unified Timeline & Fast Post */}
          {/* ============================================================ */}
          {tab === 'overview' && (
            <div className="grid xl:grid-cols-[1.1fr_0.9fr] gap-6">
              {/* Left Column: Post Announcement */}
              <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <h2 className="font-black text-slate-900 dark:text-white flex items-center gap-2 text-base">
                    <Megaphone className="w-4 h-4 text-amber-500" />
                    <span>ประกาศและแจ้งข่าวสารในห้องเรียน</span>
                  </h2>
                  <span className="text-[11px] font-bold text-slate-400">
                    {classroom.line_group_id ? '📢 แจ้งเตือนเข้า LINE Group ทันที' : '⚠️ ยังไม่ได้เชื่อม LINE Group'}
                  </span>
                </div>

                <textarea
                  value={postBody}
                  onChange={(e) => setPostBody(e.target.value)}
                  placeholder="เขียนประกาศ มอบหมาย หรือข้อความแจ้งเตือนถึงนักเรียนทุกคนในห้อง..."
                  className="w-full min-h-36 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-400 leading-relaxed resize-y"
                />

                <div className="flex items-center justify-between pt-2">
                  <p className="text-[11px] text-slate-400">โพสต์จะปรากฏในไทม์ไลน์ของห้องเรียนและฝั่งนักเรียนทันที</p>
                  <button
                    onClick={createPost}
                    disabled={!postBody.trim() || isPosting}
                    className="px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-amber-500 hover:bg-slate-800 dark:hover:bg-amber-600 disabled:opacity-40 text-white dark:text-slate-950 text-xs font-black transition-all cursor-pointer shadow-sm"
                  >
                    {isPosting ? 'กำลังโพสต์...' : 'โพสต์ประกาศ'}
                  </button>
                </div>
              </section>

              {/* Right Column: Unified Activity Timeline */}
              <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="font-black text-slate-900 dark:text-white text-base">ประวัติและไทม์ไลน์ของห้องเรียน</h2>
                  <span className="text-xs font-bold text-slate-400">{timeline.length} รายการ</span>
                </div>

                <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
                  {timeline.map((item) => (
                    <div key={item.id} className="relative pl-6 pb-4 border-l-2 border-slate-200 dark:border-slate-800 last:border-l-0 last:pb-0">
                      <span className="absolute -left-1.5 top-1 w-3 h-3 rounded-full bg-amber-500 ring-4 ring-amber-100 dark:ring-amber-950" />
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${item.badgeColor}`}>
                              {item.badgeLabel}
                            </span>
                            <p className="text-xs font-black text-slate-800 dark:text-slate-200">{item.title}</p>
                          </div>
                          <time className="text-[10px] text-slate-400 whitespace-nowrap">
                            {new Date(item.created_at).toLocaleString('th-TH')}
                          </time>
                        </div>
                        {item.href ? (
                          <Link href={item.href} className="text-xs font-bold text-amber-600 hover:underline inline-flex items-center gap-1 cursor-pointer">
                            <span>{item.body}</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        ) : (
                          <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{item.body}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  {!timeline.length && <p className="text-sm text-slate-400 text-center py-8">ยังไม่มีกิจกรรมในห้องนี้</p>}
                </div>
              </section>
            </div>
          )}

          {/* ============================================================ */}
          {/* TAB 2: CLASSWORK & CONTENT (งานและเนื้อหา) + Group Management */}
          {/* ============================================================ */}
          {tab === 'classwork' && (
            <section className="space-y-6">
              {/* Header with Actions */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div>
                  <h2 className="text-lg font-black text-slate-900 dark:text-white">งานและเนื้อหา</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    จัดกลุ่มตามหมวดหมู่ที่คุณครูบริหารจัดการได้เอง นักเรียนจะเห็นการจัดหมวดหมู่นี้ในหน้าของตนเอง
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAddGroupModal(true)}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 cursor-pointer"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
                    <span>+ สร้างกลุ่มหมวดหมู่ใหม่</span>
                  </button>
                  <Link
                    href={`/assignments/new?classroomId=${classroom.id}`}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-sm transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    <span>สร้างงาน / ข้อสอบ</span>
                  </Link>
                </div>
              </div>

              {/* Grouped Assignments List */}
              <div className="grid md:grid-cols-2 gap-4">
                {Object.entries(
                  assignments.reduce<Record<string, Assignment[]>>((groups, item) => {
                    const key = item.group_name || (item.is_exam ? 'ข้อสอบ' : 'งานทั่วไป');
                    (groups[key] ||= []).push(item);
                    return groups;
                  }, {})
                ).map(([group, items]) => (
                  <div key={group} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-600">
                          <Layers className="w-4 h-4" />
                        </span>
                        <h3 className="font-black text-sm text-slate-900 dark:text-white">
                          {group} <span className="text-slate-400 font-normal">({items.length})</span>
                        </h3>
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-amber-400 transition-all bg-slate-50/60 dark:bg-slate-850 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5 mb-1">
                                <span
                                  className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${
                                    item.is_exam
                                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                                      : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                  }`}
                                >
                                  {item.is_exam ? 'ข้อสอบ' : 'งาน'}
                                </span>
                                <p className="text-sm font-bold text-slate-900 dark:text-white">{item.title}</p>
                              </div>
                              <p className="text-[11px] text-slate-500">
                                กำหนดส่ง: {new Date(item.due_date).toLocaleString('th-TH')} • คะแนนเต็ม: {item.total_points || 20}
                              </p>
                            </div>

                            <Link
                              href={`/assignments/${item.id}/grading`}
                              className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-amber-500 hover:text-slate-950 text-xs font-bold transition-colors cursor-pointer shrink-0"
                            >
                              ตรวจคะแนน
                            </Link>
                          </div>

                          {/* Quick Group Switcher for Teacher */}
                          <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-800 text-[11px]">
                            <span className="text-slate-400 flex items-center gap-1">
                              <Tag className="w-3 h-3" />
                              <span>หมวดหมู่: {item.group_name || 'ไม่ได้จัดกลุ่ม'}</span>
                            </span>
                            <button
                              onClick={() => {
                                setEditingAssignmentGroup(item);
                                setTargetGroupForAssignment(item.group_name || '');
                              }}
                              className="text-amber-600 font-bold hover:underline cursor-pointer"
                            >
                              ย้ายกลุ่ม
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {!assignments.length && (
                  <div className="col-span-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-12 text-center space-y-3">
                    <BookOpen className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-sm font-bold text-slate-600 dark:text-slate-400">ยังไม่มีงานหรือข้อสอบในห้องนี้</p>
                    <Link
                      href={`/assignments/new?classroomId=${classroom.id}`}
                      className="inline-block px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-black cursor-pointer shadow-sm"
                    >
                      + เริ่มสร้างงานชิ้นแรก
                    </Link>
                  </div>
                )}
              </div>

              {/* Modal: Add New Group */}
              {showAddGroupModal && (
                <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
                  <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full space-y-4 shadow-xl">
                    <h3 className="font-black text-sm text-slate-900 dark:text-white">เพิ่มหมวดหมู่ใหม่</h3>
                    <input
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder="เช่น บทที่ 1 การเคลื่อนที่, ข้อสอบกลางภาค..."
                      className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowAddGroupModal(false)}
                        className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                      <button
                        onClick={() => {
                          if (newGroupName.trim()) {
                            setShowAddGroupModal(false);
                            setNotice(`เพิ่มหมวดหมู่ "${newGroupName.trim()}" เรียบร้อยแล้ว สามารถย้ายงานเข้ามาได้ทันที`);
                            setNewGroupName('');
                          }
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-black cursor-pointer"
                      >
                        บันทึกกลุ่ม
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal: Move Assignment to Group */}
              {editingAssignmentGroup && (
                <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
                  <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full space-y-4 shadow-xl">
                    <h3 className="font-black text-sm text-slate-900 dark:text-white">ย้ายหมวดหมู่ของงาน</h3>
                    <p className="text-xs text-slate-500 font-bold truncate">{editingAssignmentGroup.title}</p>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-400">เลือกกลุ่มที่มีอยู่ หรือพิมพ์กลุ่มใหม่</label>
                      <input
                        value={targetGroupForAssignment}
                        onChange={(e) => setTargetGroupForAssignment(e.target.value)}
                        placeholder="ชื่อหมวดหมู่..."
                        className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none"
                      />
                      {existingGroupNames.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-2">
                          {existingGroupNames.map((gn) => (
                            <button
                              key={gn}
                              type="button"
                              onClick={() => setTargetGroupForAssignment(gn)}
                              className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-amber-100 dark:hover:bg-amber-950 text-[10px] font-bold text-slate-700 dark:text-slate-300 cursor-pointer"
                            >
                              {gn}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => setEditingAssignmentGroup(null)}
                        className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                      <button
                        onClick={() => handleUpdateAssignmentGroup(editingAssignmentGroup.id, targetGroupForAssignment)}
                        className="flex-1 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-black cursor-pointer"
                      >
                        บันทึกการย้าย
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ============================================================ */}
          {/* TAB 3: ATTENDANCE (เช็คชื่อ) */}
          {/* ============================================================ */}
          {tab === 'attendance' && (
            <AttendancePanel
              classroom={classroom}
              sessions={sessions}
              session={session}
              records={records}
              counts={attendanceCounts}
              title={attendanceTitle}
              setTitle={setAttendanceTitle}
              startsAt={attendanceStartsAt}
              setStartsAt={setAttendanceStartsAt}
              onTime={onTimeMinutes}
              setOnTime={setOnTimeMinutes}
              late={lateMinutes}
              setLate={setLateMinutes}
              create={createAttendance}
              update={updateAttendanceRecord}
              action={sessionAction}
              exportCsv={exportAttendance}
              selectSession={loadAttendanceSession}
            />
          )}

          {/* ============================================================ */}
          {/* TAB 4: PEOPLE (ผู้เรียน + ผู้สอน) */}
          {/* ============================================================ */}
          {tab === 'people' && (
            <section className="grid xl:grid-cols-2 gap-6">
              {/* Teachers Section */}
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h2 className="font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-amber-500" />
                    <span>ผู้สอนในห้องเรียน ({teachers.length})</span>
                  </h2>
                </div>
                <div className="space-y-2.5">
                  {teachers.map((teacher) => (
                    <div
                      key={teacher.teacher_id}
                      className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{teacher.name || teacher.teacher_id}</p>
                        <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {teacher.role === 'primary' ? 'ครูผู้สอนหลัก' : teacher.role === 'researcher' ? 'ผู้ตรวจวิจัย (IRR)' : 'ครูผู้ช่วยสอน'}
                        </p>
                      </div>
                      <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                        {teacher.role === 'primary' ? 'หัวหน้าวิชา' : 'ผู้ช่วยสอน'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Students Section */}
              <StudentList classroom={classroom} />
            </section>
          )}

          {/* ============================================================ */}
          {/* TAB 5: GRADES (คะแนน) */}
          {/* ============================================================ */}
          {tab === 'grades' && (
            <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4 overflow-x-auto">
              <div className="flex items-center justify-between">
                <h2 className="font-black text-slate-900 dark:text-white">ตารางคะแนนรวมทั้งห้อง</h2>
                <span className="text-xs text-slate-400">{assignments.length} งาน/ข้อสอบ</span>
              </div>

              {gradesLoading ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-500" />
                  กำลังโหลดผลคะแนนนักเรียน...
                </div>
              ) : (
                <table className="w-full min-w-160 text-xs">
                  <thead>
                    <tr className="text-left border-b border-slate-200 dark:border-slate-800 text-slate-400">
                      <th className="p-3">นักเรียน</th>
                      <th className="p-3">รหัสนักเรียน</th>
                      {assignments.map((item) => (
                        <th key={item.id} className="p-3 text-center">
                          {item.title}
                          <span className="block text-[10px] text-slate-400">({item.total_points || 20} คะแนน)</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(classroom.students || []).map((student) => (
                      <tr key={student.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850">
                        <td className="p-3 font-bold text-slate-900 dark:text-white">
                          {student.first_name} {student.last_name}
                        </td>
                        <td className="p-3 text-slate-500 font-mono">{student.student_id || '-'}</td>
                        {assignments.map((item) => {
                          const sub = submissions.find(
                            (s) => s.assignment_id === item.id && (s.student_id === student.id || s.student_id === student.line_uid)
                          );
                          return (
                            <td key={item.id} className="p-3 text-center font-bold">
                              {sub?.total_score !== undefined ? (
                                <span className="text-emerald-600 dark:text-emerald-400">{sub.total_score}</span>
                              ) : sub ? (
                                <span className="text-amber-500 text-[10px]">รอตรวจ</span>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

function StudentList({ classroom }: { classroom: Classroom }) {
  const [query, setQuery] = useState('');
  const students = classroom.students || [];
  const filtered = students.filter(
    (s) =>
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(query.toLowerCase()) ||
      (s.student_id && s.student_id.includes(query))
  );

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
        <h2 className="font-black text-slate-900 dark:text-white flex items-center gap-2">
          <Users className="w-4 h-4 text-amber-500" />
          <span>รายชื่อผู้เรียน ({students.length})</span>
        </h2>
      </div>

      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาชื่อหรือรหัสนักเรียน..."
          className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none bg-slate-50 dark:bg-slate-800"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-2 max-h-[480px] overflow-y-auto">
        {filtered.map((student) => (
          <div key={student.id} className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                {student.first_name} {student.last_name}
              </p>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">{student.student_id || 'ไม่มีรหัส'}</p>
            </div>
            {student.line_uid && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                LINE
              </span>
            )}
          </div>
        ))}
        {!filtered.length && <p className="col-span-full text-xs text-slate-400 text-center py-6">ไม่พบรายชื่อผู้เรียน</p>}
      </div>
    </div>
  );
}

function AttendancePanel({
  classroom,
  sessions,
  session,
  records,
  counts,
  title,
  setTitle,
  startsAt,
  setStartsAt,
  onTime,
  setOnTime,
  late,
  setLate,
  create,
  update,
  action,
  exportCsv,
  selectSession,
}: {
  classroom: Classroom;
  sessions: AttendanceSession[];
  session: AttendanceSession | null;
  records: AttendanceRecord[];
  counts: Record<string, number>;
  title: string;
  setTitle: (v: string) => void;
  startsAt: string;
  setStartsAt: (v: string) => void;
  onTime: number;
  setOnTime: (v: number) => void;
  late: number;
  setLate: (v: number) => void;
  create: () => void;
  update: (id: string, status: AttendanceStatus) => void;
  action: (a: 'close' | 'extend') => void;
  exportCsv: () => void;
  selectSession: (id: string) => void;
}) {
  return (
    <section className="space-y-6">
      {/* Header and Statistics Cards */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white">เช็คชื่อรายคาบ</h2>
          <p className="text-xs text-slate-500 mt-0.5">เปิดคาบเช็คชื่อ ตรวจสอบสถานะผู้เรียน และส่งออกประวัติ</p>
        </div>
        {session && (
          <button
            onClick={exportCsv}
            className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold inline-flex items-center gap-1.5 hover:bg-slate-100 cursor-pointer shadow-xs"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600" />
            <span>ส่งออก CSV</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['on_time', 'ตรงเวลา', 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'],
          ['late', 'มาสาย', 'text-amber-600 bg-amber-50 dark:bg-amber-950/40'],
          ['absent', 'ขาด', 'text-rose-600 bg-rose-50 dark:bg-rose-950/40'],
          ['excused', 'ลา', 'text-blue-600 bg-blue-50 dark:bg-blue-950/40'],
        ].map(([key, label, colorCls]) => (
          <div key={key} className={`p-4 rounded-3xl border border-slate-200 dark:border-slate-800 ${colorCls}`}>
            <p className="text-3xl font-black">{counts[key] || 0}</p>
            <p className="text-xs font-bold mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Grid: Create session on left, Sessions list on right */}
      <div className="grid xl:grid-cols-[0.8fr_1.2fr] gap-6">
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-xs">
          <h3 className="font-black text-sm text-slate-900 dark:text-white">เปิดคาบเช็คชื่อใหม่</h3>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1">ชื่อคาบเรียน</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none"
                placeholder="เช่น คาบที่ 1 ฟิสิกส์พื้นฐาน"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1">เวลาเริ่ม (เว้นว่าง = ทันที)</label>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">ตรงเวลา (นาที)</label>
                <input
                  type="number"
                  min="1"
                  value={onTime}
                  onChange={(e) => setOnTime(Number(e.target.value))}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">สายได้ถึง (นาที)</label>
                <input
                  type="number"
                  min={onTime}
                  value={late}
                  onChange={(e) => setLate(Number(e.target.value))}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none"
                />
              </div>
            </div>
            <button
              onClick={create}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black cursor-pointer shadow-sm transition-all"
            >
              เปิดคาบเช็คชื่อ (ประกาศเข้า LINE)
            </button>
            {session && (
              <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={() => action('extend')}
                  disabled={session.status === 'closed'}
                  className="flex-1 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 text-xs font-bold cursor-pointer disabled:opacity-40"
                >
                  +10 นาที
                </button>
                <button
                  onClick={() => action('close')}
                  disabled={session.status === 'closed'}
                  className="flex-1 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold cursor-pointer disabled:opacity-40"
                >
                  ปิดรับเช็คชื่อ
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sessions list & selected session status */}
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-3">
            <h3 className="font-black text-sm text-slate-900 dark:text-white">ประวัติคาบเช็คชื่อ ({sessions.length})</h3>
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {sessions.map((item) => (
                <button
                  key={item.id}
                  onClick={() => selectSession(item.id)}
                  className={`w-full text-left p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                    item.id === session?.id
                      ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 hover:border-slate-300'
                  }`}
                >
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-white">{item.title}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {new Date(item.starts_at).toLocaleString('th-TH')} • ตรงเวลา {item.on_time_until_minutes}m / สายถึง {item.late_until_minutes}m
                    </p>
                  </div>
                  <span
                    className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                      item.status === 'open'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 animate-pulse'
                        : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {item.status === 'open' ? 'เปิดอยู่' : 'ปิดแล้ว'}
                  </span>
                </button>
              ))}
              {!sessions.length && <p className="text-xs text-slate-400 text-center py-6">ยังไม่มีประวัติคาบเช็คชื่อ</p>}
            </div>
          </div>

          {/* Student attendance in currently selected session */}
          {session && (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-black text-sm text-slate-900 dark:text-white">
                  สถานะผู้เรียนในคาบ: <span className="text-emerald-600">{session.title}</span>
                </h3>
              </div>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {(classroom.students || []).map((student) => {
                  const record = records.find((item) => item.student_id === student.id || item.student_id === student.line_uid);
                  return (
                    <div
                      key={student.id}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-bold text-slate-900 dark:text-white truncate block">
                          {student.first_name} {student.last_name}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {student.student_id || '-'}
                          {record?.checked_at && ` • เช็คเมื่อ ${new Date(record.checked_at).toLocaleTimeString('th-TH')}`}
                        </span>
                      </div>
                      <select
                        value={record?.status || 'absent'}
                        disabled={session.status === 'closed'}
                        onChange={(e) => update(student.id, e.target.value as AttendanceStatus)}
                        className={`px-2 py-1 rounded-lg text-xs font-bold border border-slate-200 dark:border-slate-700 cursor-pointer ${
                          record?.status === 'on_time'
                            ? 'bg-emerald-100 text-emerald-800'
                            : record?.status === 'late'
                            ? 'bg-amber-100 text-amber-800'
                            : record?.status === 'excused'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        <option value="on_time">มาตรงเวลา</option>
                        <option value="late">มาสาย</option>
                        <option value="absent">ขาด</option>
                        <option value="excused">ลา</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
