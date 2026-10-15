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
  ChevronLeft,
  ClipboardList,
  Clock,
  Download,
  Edit2,
  ExternalLink,
  FileText,
  FolderPlus,
  Layers,
  Megaphone,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
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
  { id: 'people', label: 'ผู้สอนและผู้เรียน', icon: Users },
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [selectedSemesterFilter, setSelectedSemesterFilter] = useState('all');

  // Overview Facebook-style post form state
  const [isPostExpanded, setIsPostExpanded] = useState(false);
  const [postActivityType, setPostActivityType] = useState<TimelineItem['type']>('announcement');
  const [postBody, setPostBody] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  // Attendance form & edit session state
  const [attendanceTitle, setAttendanceTitle] = useState('เช็คชื่อประจำคาบ');
  const [attendanceStartsAt, setAttendanceStartsAt] = useState('');
  const [onTimeMinutes, setOnTimeMinutes] = useState(10);
  const [lateMinutes, setLateMinutes] = useState(30);
  const [editingSession, setEditingSession] = useState<AttendanceSession | null>(null);
  const [editSessionTitle, setEditSessionTitle] = useState('');
  const [isUpdatingSession, setIsUpdatingSession] = useState(false);

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

  // Listen to Navbar Sidebar Toggle Button
  useEffect(() => {
    const handleToggle = () => {
      if (window.innerWidth >= 1024) {
        setIsSidebarCollapsed((prev) => !prev);
      } else {
        setSidebarOpen((prev) => !prev);
      }
    };
    window.addEventListener('toggle-classroom-sidebar', handleToggle);
    return () => window.removeEventListener('toggle-classroom-sidebar', handleToggle);
  }, []);

  // Fetch Grades when switching to Grades tab
  useEffect(() => {
    if (tab !== 'grades' || !assignments.length) return;
    setGradesLoading(true);
    Promise.all(assignments.map((item) => dataService.getSubmissions(item.id)))
      .then((results) => setSubmissions(results.flat()))
      .finally(() => setGradesLoading(false));
  }, [tab, assignments]);

  // Realtime Polling & Broadcast listener (Every 3.5s when teacher is viewing)
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        const hasOpenSession = sessions.some((s) => s.status === 'open');
        if (tab === 'attendance' || hasOpenSession) {
          loadAttendance();
        }
        if (tab === 'grades' && assignments.length > 0) {
          Promise.all(assignments.map((item) => dataService.getSubmissions(item.id)))
            .then((results) => setSubmissions(results.flat()))
            .catch(() => {});
        }
      }
    }, 3500);

    const handleRealtimeEvent = () => {
      loadAttendance();
      if (assignments.length > 0) {
        Promise.all(assignments.map((item) => dataService.getSubmissions(item.id)))
          .then((results) => setSubmissions(results.flat()))
          .catch(() => {});
      }
    };

    window.addEventListener('pudding-submission-created', handleRealtimeEvent);
    window.addEventListener('pudding-attendance-checked', handleRealtimeEvent);
    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('pudding-realtime');
      bc.onmessage = (event) => {
        if (event.data?.type === 'submission_created' || event.data?.type === 'attendance_checked') {
          handleRealtimeEvent();
        }
      };
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener('pudding-submission-created', handleRealtimeEvent);
      window.removeEventListener('pudding-attendance-checked', handleRealtimeEvent);
      if (bc) bc.close();
    };
  }, [tab, assignments, sessions]);

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

  // Available Academic Years / Semesters for filter
  const availableSemesters = useMemo(() => {
    const set = new Set<string>();
    classrooms.forEach((cls) => {
      if (cls.academic_year && cls.academic_year.trim()) {
        set.add(cls.academic_year.trim());
      }
    });
    return Array.from(set).sort().reverse();
  }, [classrooms]);

  // Group Classrooms by Subject / Course for Sidebar (filtered by Semester)
  const coursesMap = useMemo(() => {
    const map = new Map<string, { label: string; classrooms: Classroom[] }>();
    const filteredList =
      selectedSemesterFilter === 'all'
        ? classrooms
        : classrooms.filter((cls) => (cls.academic_year || 'ปัจจุบัน') === selectedSemesterFilter);

    for (const cls of filteredList) {
      const key = cls.course_name || cls.subject_code || 'รายวิชาทั่วไป';
      if (!map.has(key)) {
        map.set(key, { label: key, classrooms: [] });
      }
      map.get(key)!.classrooms.push(cls);
    }
    return map;
  }, [classrooms, selectedSemesterFilter]);

  // Existing group names across assignments
  const existingGroupNames = useMemo(() => {
    const set = new Set<string>();
    assignments.forEach((a) => {
      if (a.group_name && a.group_name.trim()) set.add(a.group_name.trim());
    });
    return Array.from(set);
  }, [assignments]);

  // Post Announcement or Activity (Facebook style)
  const createPost = async () => {
    if (!postBody.trim()) return;
    setIsPosting(true);
    try {
      const response = await fetch('/api/classrooms/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classroomId, body: postBody, activityType: postActivityType }),
      });
      if (!response.ok) {
        setNotice('บันทึกโพสต์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        return;
      }
      setPostBody('');
      setIsPostExpanded(false);
      setNotice('โพสต์เรียบร้อย และส่งแจ้งเตือนเข้า LINE Group แล้ว');
      await loadWorkspace();
    } catch {
      setNotice('เกิดข้อผิดพลาดในการโพสต์');
    } finally {
      setIsPosting(false);
    }
  };

  // Update Session details (title / status)
  const handleUpdateSession = async (sessionId: string, newTitle: string, newStatus?: 'open' | 'closed') => {
    setIsUpdatingSession(true);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'update_session',
          classroomId,
          sessionId,
          title: newTitle,
          status: newStatus,
        }),
      });
      if (res.ok) {
        setNotice('อัปเดตข้อมูลคาบเช็คชื่อเรียบร้อย');
        await loadAttendance();
        setEditingSession(null);
      } else {
        setNotice('อัปเดตคาบเช็คชื่อไม่สำเร็จ');
      }
    } catch {
      setNotice('เกิดข้อผิดพลาดในการอัปเดตคาบเช็คชื่อ');
    } finally {
      setIsUpdatingSession(false);
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
        const record = records.find(
          (item) =>
            item.student_id === student.id ||
            (student.line_uid && item.student_id === student.line_uid) ||
            (student.student_id && item.student_id === student.student_id)
        );
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
          className={`fixed lg:sticky top-0 left-0 z-50 lg:z-10 h-screen w-72 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-all duration-200 ease-in-out ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          } ${isSidebarCollapsed ? 'lg:hidden' : 'lg:flex'}`}
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
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setIsSidebarCollapsed(true);
                  setSidebarOpen(false);
                }}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"
                title="ซ่อนแถบข้าง"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setSidebarOpen(false)}
                className="lg:hidden p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Current Classroom Card in Sidebar */}
          <div className="p-4 bg-linear-to-b from-amber-500/10 to-transparent border-b border-slate-200 dark:border-slate-800">
            <span className="text-[10px] font-black uppercase text-amber-600">ห้องเรียนปัจจุบัน</span>
            <p className="text-sm font-black text-slate-900 dark:text-white truncate mt-0.5">{classroom.name}</p>
            <p className="text-[11px] text-slate-500 truncate">
              {classroom.course_name || classroom.subject_code} · {classroom.student_count || classroom.students?.length || 0} ผู้เรียน
            </p>
          </div>

          {/* Semester / Academic Year Filter */}
          {availableSemesters.length > 0 && (
            <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-black uppercase text-slate-400">ภาคเรียน / ปีการศึกษา</span>
                {selectedSemesterFilter !== 'all' && (
                  <button
                    onClick={() => setSelectedSemesterFilter('all')}
                    className="text-[10px] text-amber-600 font-bold hover:underline cursor-pointer"
                  >
                    รีเซ็ต
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none">
                <button
                  type="button"
                  onClick={() => setSelectedSemesterFilter('all')}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                    selectedSemesterFilter === 'all'
                      ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 border border-slate-200 dark:border-slate-700'
                  }`}
                >
                  ทั้งหมด
                </button>
                {availableSemesters.map((sem) => (
                  <button
                    key={sem}
                    type="button"
                    onClick={() => setSelectedSemesterFilter(sem)}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                      selectedSemesterFilter === sem
                        ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {sem}
                  </button>
                ))}
              </div>
            </div>
          )}

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
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 text-xs font-bold shadow-xs cursor-pointer"
                title={isSidebarCollapsed ? "เปิดแถบรายวิชา/ห้องเรียน" : "ซ่อนแถบข้าง"}
              >
                <Layers className="w-4 h-4 text-amber-500" />
                <span>{isSidebarCollapsed ? "สลับห้องเรียน" : "ซ่อนแถบข้าง"}</span>
              </button>
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-amber-600 mb-1">
                  <span>{classroom.subject_code || 'CLASSROOM'}</span>
                  <span>•</span>
                  <span>ภาคเรียน {classroom.academic_year || 'ปัจจุบัน'}</span>
                </div>
                <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{classroom.name}</h1>
              </div>
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
          {/* TAB 1: OVERVIEW (ภาพรวม) - Facebook-Style Post & Timeline Feed */}
          {/* ============================================================ */}
          {tab === 'overview' && (
            <div className="max-w-3xl mx-auto space-y-4">
              {/* Facebook-style Post Box (ช่องพิมพ์ข้อความขึ้นก่อน บรรทัดเดียว พอกดแล้วขยาย) */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs transition-all">
                {!isPostExpanded ? (
                  <div
                    onClick={() => setIsPostExpanded(true)}
                    className="flex items-center gap-3 cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 font-black flex items-center justify-center shrink-0 text-sm">
                      {user?.firstName?.[0] || 'ครู'}
                    </div>
                    <div className="flex-1 bg-slate-100 hover:bg-slate-200/80 dark:bg-slate-800 dark:hover:bg-slate-750 rounded-full px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400 select-none transition-colors">
                      แชร์อะไรบางอย่างกับชั้นเรียนของคุณ...
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <span className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold flex items-center gap-1">
                        <Megaphone className="w-4 h-4 text-amber-500" />
                        <span className="hidden sm:inline">ประกาศ</span>
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Header with Author and Activity Type Selector */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-full bg-amber-500 text-slate-950 font-black flex items-center justify-center text-xs">
                          {user?.firstName?.[0] || 'ครู'}
                        </div>
                        <div>
                          <p className="text-xs font-black text-slate-900 dark:text-white">
                            {user?.fullName || user?.firstName || 'ครูผู้สอน'}
                          </p>
                          <p className="text-[10px] text-slate-400">โพสต์ไปยัง: {classroom.name}</p>
                        </div>
                      </div>

                      {/* Post Type Selector Tabs */}
                      <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-[11px] font-bold">
                        {(
                          [
                            ['announcement', '📢 ประกาศ'],
                            ['assignment', '📋 งาน'],
                            ['exam', '📝 ข้อสอบ'],
                            ['attendance', '⏰ เช็คชื่อ'],
                          ] as const
                        ).map(([typeKey, typeLabel]) => (
                          <button
                            key={typeKey}
                            type="button"
                            onClick={() => setPostActivityType(typeKey)}
                            className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                              postActivityType === typeKey
                                ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs font-black'
                                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                            }`}
                          >
                            {typeLabel}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Expandable Textarea */}
                    <textarea
                      autoFocus
                      value={postBody}
                      onChange={(e) => setPostBody(e.target.value)}
                      placeholder={
                        postActivityType === 'assignment'
                          ? 'รายละเอียดการมอบหมายงาน เช่น คำชี้แจง และกำหนดส่ง...'
                          : postActivityType === 'exam'
                          ? 'แจ้งการสอบ เช่น หัวข้อสอบ เวลาเริ่มสอบ และคำแนะนำ...'
                          : postActivityType === 'attendance'
                          ? 'แจ้งให้นักเรียนเข้าเช็คชื่อในคาบเรียนนี้...'
                          : 'เขียนข้อความประกาศแจ้งเตือนถึงนักเรียนทุกคนในห้อง...'
                      }
                      rows={4}
                      className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-400 resize-y leading-relaxed"
                    />

                    {/* Footer Controls */}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-slate-400">
                        {classroom.line_group_id ? '📢 แจ้งเตือนเข้า LINE Group ทันที' : '⚠️ ยังไม่ได้เชื่อม LINE Group'}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsPostExpanded(false);
                            setPostBody('');
                          }}
                          className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          onClick={createPost}
                          disabled={!postBody.trim() || isPosting}
                          className="px-4 py-1.5 rounded-xl bg-slate-950 dark:bg-amber-500 hover:bg-slate-800 dark:hover:bg-amber-600 disabled:opacity-40 text-white dark:text-slate-950 text-xs font-black transition-all cursor-pointer shadow-xs"
                        >
                          {isPosting ? 'กำลังโพสต์...' : 'โพสต์'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Facebook-style Timeline Feed (ประวัติไทม์ไลน์แสดงเรียงกันลงมาด้านล่าง) */}
              <div className="space-y-3">
                {timeline.map((item) => (
                  <article
                    key={item.id}
                    className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3"
                  >
                    {/* Post Header: Avatar, Name, Timestamp, Badge */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold flex items-center justify-center shrink-0 text-xs">
                          {classroom.name[0] || 'P'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-slate-900 dark:text-white">
                              {classroom.name}
                            </span>
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md ${item.badgeColor}`}>
                              {item.badgeLabel}
                            </span>
                          </div>
                          <time className="text-[10px] text-slate-400 block mt-0.5">
                            {new Date(item.created_at).toLocaleString('th-TH', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </time>
                        </div>
                      </div>
                    </div>

                    {/* Post Body Text */}
                    <p className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                      {item.body}
                    </p>

                    {/* If attached link (e.g. assignment/exam card) */}
                    {item.href && (
                      <Link
                        href={item.href}
                        className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-amber-50/50 dark:hover:bg-amber-950/20 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 transition-colors group cursor-pointer block"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <BookOpen className="w-4 h-4 text-amber-500 shrink-0" />
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-amber-600 truncate">
                            {item.title}
                          </span>
                        </div>
                        <span className="text-[11px] font-bold text-amber-600 inline-flex items-center gap-1 shrink-0">
                          <span>เปิดดู</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </span>
                      </Link>
                    )}

                    {/* Post Footer note */}
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                      <span>📢 ประกาศใน LINE Group แล้ว</span>
                      <span>{item.badgeLabel}</span>
                    </div>
                  </article>
                ))}

                {!timeline.length && (
                  <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs text-slate-400">
                    ยังไม่มีโพสต์หรือประกาศในห้องนี้ เริ่มต้นแชร์ข้อความแรกของคุณได้เลย
                  </div>
                )}
              </div>
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
              onUpdateSession={handleUpdateSession}
              isUpdatingSession={isUpdatingSession}
            />
          )}

          {/* ============================================================ */}
          {/* TAB 4: PEOPLE (ผู้สอนและผู้เรียน) */}
          {/* ============================================================ */}
          {tab === 'people' && (
            <section className="max-w-4xl mx-auto space-y-6">
              {/* 1. Instructors Section (แสดงผู้สอนด้านบน) */}
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
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-200 font-bold flex items-center justify-center text-xs">
                          {teacher.name?.[0] || 'T'}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-white">{teacher.name || teacher.teacher_id}</p>
                          <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                            {teacher.role === 'primary' ? 'ครูผู้สอนหลัก' : teacher.role === 'researcher' ? 'ผู้ตรวจวิจัย (IRR)' : 'ครูผู้ช่วยสอน'}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                        {teacher.role === 'primary' ? 'หัวหน้าวิชา' : 'ผู้ช่วยสอน'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 2. Students Section (แสดงผู้เรียนด้านล่าง แยกการ์ด) */}
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
                            (s) =>
                              s.assignment_id === item.id &&
                              (s.student_id === student.id ||
                                (student.line_uid && s.student_id === student.line_uid) ||
                                (student.student_id && s.student_id === student.student_id))
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
  onUpdateSession,
  isUpdatingSession,
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
  onUpdateSession?: (id: string, newTitle: string, newStatus?: 'open' | 'closed') => void;
  isUpdatingSession?: boolean;
}) {
  const [editingTitle, setEditingTitle] = useState('');
  const [isEditingTitleActive, setIsEditingTitleActive] = useState(false);

  // Sync editing title when selected session changes
  useEffect(() => {
    if (session) {
      setEditingTitle(session.title);
      setIsEditingTitleActive(false);
    }
  }, [session?.id]);

  const activeOpenSession = sessions.find((s) => s.status === 'open');

  return (
    <section className="max-w-4xl mx-auto space-y-6">
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
            <span>ส่งออก CSV ({session.title})</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

      {/* ============================================================== */}
      {/* 1. เปิดคาบเช็คชื่อขึ้นก่อน (Top Section: Open Session Form) */}
      {/* ============================================================== */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-emerald-600" />
            <span>เปิดคาบเช็คชื่อใหม่</span>
          </h3>
          {activeOpenSession && (
            <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 animate-pulse">
              มีคาบที่กำลังเปิดรับอยู่ 🟢
            </span>
          )}
        </div>

        {/* Live Active Session Banner if one is already open */}
        {activeOpenSession && (
          <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-black text-slate-900 dark:text-white">
                กำลังเปิดรับ: {activeOpenSession.title}
              </p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                เริ่มเมื่อ {new Date(activeOpenSession.starts_at).toLocaleTimeString('th-TH')} • ตรงเวลา {activeOpenSession.on_time_until_minutes}m / สายได้ถึง {activeOpenSession.late_until_minutes}m
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  selectSession(activeOpenSession.id);
                  action('extend');
                }}
                className="px-3 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 cursor-pointer shadow-xs"
              >
                +10 นาที
              </button>
              <button
                onClick={() => {
                  selectSession(activeOpenSession.id);
                  action('close');
                }}
                className="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold hover:bg-rose-100 cursor-pointer shadow-xs"
              >
                ปิดรับเช็คชื่อ
              </button>
            </div>
          </div>
        )}

        {/* Create Session Form */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className="text-[11px] font-bold text-slate-400 block mb-1">ชื่อคาบเรียน</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500"
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
              <label className="text-[11px] font-bold text-slate-400 block mb-1">ตรงเวลา (น.)</label>
              <input
                type="number"
                min="1"
                value={onTime}
                onChange={(e) => setOnTime(Number(e.target.value))}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1">สายถึง (น.)</label>
              <input
                type="number"
                min={onTime}
                value={late}
                onChange={(e) => setLate(Number(e.target.value))}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none"
              />
            </div>
          </div>
        </div>

        <button
          onClick={create}
          className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black cursor-pointer shadow-md transition-all active:scale-[0.99] flex items-center justify-center gap-2"
        >
          <CalendarCheck className="w-4 h-4" />
          <span>เปิดคาบเช็คชื่อ (ประกาศเข้า LINE Group ทันที)</span>
        </button>
      </div>

      {/* ============================================================== */}
      {/* 2. ประวัติอยู่ด้านล่าง เรียงลงมา และกดเข้าไปแก้ไขได้ (Bottom History) */}
      {/* ============================================================== */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <h3 className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" />
            <span>ประวัติคาบเช็คชื่อทั้งหมด ({sessions.length})</span>
          </h3>
          <span className="text-[11px] text-slate-400">คลิกที่คาบเพื่อดูและแก้ไขรายชื่อผู้เรียน</span>
        </div>

        <div className="space-y-3">
          {sessions.map((item) => {
            const isSelected = item.id === session?.id;

            return (
              <div
                key={item.id}
                className={`rounded-2xl border transition-all overflow-hidden ${
                  isSelected
                    ? 'border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850 hover:border-slate-300'
                }`}
              >
                {/* Session Card Header */}
                <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-black text-slate-900 dark:text-white truncate">{item.title}</p>
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                          item.status === 'open'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 animate-pulse'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {item.status === 'open' ? 'เปิดอยู่' : 'ปิดแล้ว'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {new Date(item.starts_at).toLocaleString('th-TH')} • ตรงเวลา {item.on_time_until_minutes} นาที / สายได้ถึง {item.late_until_minutes} นาที
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Status Toggle Button for Past Sessions */}
                    {item.status === 'closed' ? (
                      <button
                        type="button"
                        onClick={() => {
                          selectSession(item.id);
                          if (onUpdateSession) onUpdateSession(item.id, item.title, 'open');
                        }}
                        className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 cursor-pointer"
                        title="เปิดรับเช็คชื่ออีกครั้ง"
                      >
                        เปิดรับอีกครั้ง 🔄
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          selectSession(item.id);
                          action('close');
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] font-bold text-rose-700 hover:bg-rose-100 cursor-pointer"
                      >
                        ปิดรับ ⛔
                      </button>
                    )}

                    {/* View/Edit Session Button */}
                    <button
                      type="button"
                      onClick={() => selectSession(item.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs ${
                        isSelected
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-emerald-500'
                      }`}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      <span>{isSelected ? 'กำลังดู/แก้ไข' : 'ดูและแก้ไข ✏️'}</span>
                    </button>
                  </div>
                </div>

                {/* Expanded Session Detail & Student Attendance Editor */}
                {isSelected && (
                  <div className="p-4 bg-white dark:bg-slate-900 border-t border-emerald-200 dark:border-emerald-800/60 space-y-4">
                    {/* Edit Session Title Box */}
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex-1 min-w-48 flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 whitespace-nowrap">แก้ไขชื่อคาบ:</label>
                        <input
                          value={editingTitle}
                          onChange={(e) => {
                            setEditingTitle(e.target.value);
                            setIsEditingTitleActive(true);
                          }}
                          className="flex-1 p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none bg-white dark:bg-slate-900"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        {isEditingTitleActive && (
                          <button
                            type="button"
                            disabled={isUpdatingSession}
                            onClick={() => {
                              if (onUpdateSession && editingTitle.trim()) {
                                onUpdateSession(item.id, editingTitle.trim());
                                setIsEditingTitleActive(false);
                              }
                            }}
                            className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-black cursor-pointer shadow-xs"
                          >
                            บันทึกชื่อคาบ
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={exportCsv}
                          className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 flex items-center gap-1 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>CSV</span>
                        </button>
                      </div>
                    </div>

                    {/* Student Roster in this Session with Interactive Status Switcher */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-black text-slate-800 dark:text-slate-200">
                          รายชื่อผู้เรียนและสถานะเช็คชื่อ (คลิกเพื่อแก้ไขสถานะได้ตลอดเวลา):
                        </h4>
                        <span className="text-[10px] text-slate-400">
                          ทั้งหมด {classroom.students?.length || 0} คน
                        </span>
                      </div>

                      <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                        {(classroom.students || []).map((student) => {
                          const record = records.find(
                            (r) =>
                              r.student_id === student.id ||
                              (student.line_uid && r.student_id === student.line_uid) ||
                              (student.student_id && r.student_id === student.student_id)
                          );
                          const currentStatus = record?.status || 'absent';

                          return (
                            <div
                              key={student.id}
                              className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-2 text-xs"
                            >
                              <div className="min-w-44">
                                <span className="font-bold text-slate-900 dark:text-white block">
                                  {student.first_name} {student.last_name}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  รหัส: {student.student_id || '-'}
                                  {record?.checked_at && ` • เช็คเมื่อ ${new Date(record.checked_at).toLocaleTimeString('th-TH')}`}
                                </span>
                              </div>

                              {/* Interactive Quick Status Buttons (แก้ไขได้ตลอดเวลา แม้คาบจะปิดแล้ว) */}
                              <div className="flex items-center gap-1">
                                {(
                                  [
                                    ['on_time', 'ตรงเวลา 🟢', 'bg-emerald-100 text-emerald-800 border-emerald-300'],
                                    ['late', 'มาสาย 🟡', 'bg-amber-100 text-amber-800 border-amber-300'],
                                    ['excused', 'ลา 🔵', 'bg-blue-100 text-blue-800 border-blue-300'],
                                    ['absent', 'ขาด 🔴', 'bg-rose-100 text-rose-800 border-rose-300'],
                                  ] as const
                                ).map(([stKey, stLabel, activeCls]) => {
                                  const isActive = currentStatus === stKey;
                                  return (
                                    <button
                                      key={stKey}
                                      type="button"
                                      onClick={() => update(student.id, stKey as AttendanceStatus)}
                                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                                        isActive
                                          ? `${activeCls} font-black shadow-xs ring-1 ring-current`
                                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 hover:border-slate-400'
                                      }`}
                                    >
                                      {stLabel}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}

                        {!classroom.students?.length && (
                          <p className="text-xs text-slate-400 text-center py-6">
                            ยังไม่มีนักเรียนในห้องเรียนนี้
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {!sessions.length && (
            <div className="p-8 text-center bg-slate-50 dark:bg-slate-800 rounded-2xl text-xs text-slate-400">
              ยังไม่มีประวัติคาบเช็คชื่อ เริ่มเปิดคาบแรกจากด้านบนได้เลย
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
