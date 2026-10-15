'use client';

import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { dataService } from '@/lib/supabase/dataService';
import { defaultTeachersList } from '@/lib/supabase/mockData';
import { Assignment, Classroom, ClassroomTeacher, Submission } from '@/types/database';
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
  Edit2,
  ExternalLink,
  FileText,
  FolderPlus,
  Layers,
  Megaphone,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Tag,
  Trash2,
  UserCheck,
  UserPlus,
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
  rawId?: string;
  isPost?: boolean;
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

  // Active attendance session ref to prevent auto-polling from dropping or resetting current session
  const activeSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeSessionIdRef.current = session?.id || null;
  }, [session?.id]);

  // Overview Facebook-style post form state
  const [isPostExpanded, setIsPostExpanded] = useState(false);
  const [postActivityType, setPostActivityType] = useState<TimelineItem['type']>('announcement');
  const [postBody, setPostBody] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  // Edit Post Modal State
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editPostBody, setEditPostBody] = useState('');
  const [isUpdatingPost, setIsUpdatingPost] = useState(false);

  // Edit Assignment Modal State
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [editAssignTitle, setEditAssignTitle] = useState('');
  const [editAssignDueDate, setEditAssignDueDate] = useState('');
  const [editAssignPoints, setEditAssignPoints] = useState(20);
  const [editAssignGroup, setEditAssignGroup] = useState('');
  const [isUpdatingAssignment, setIsUpdatingAssignment] = useState(false);

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

  // People Tab: Add Teacher & Add Student Modals
  const [showAddTeacherModal, setShowAddTeacherModal] = useState(false);
  const [newTeacherName, setNewTeacherName] = useState('');
  const [newTeacherEmail, setNewTeacherEmail] = useState('');
  const [newTeacherRole, setNewTeacherRole] = useState<'primary' | 'assistant' | 'researcher'>('assistant');

  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [newStudentFirst, setNewStudentFirst] = useState('');
  const [newStudentLast, setNewStudentLast] = useState('');
  const [newStudentId, setNewStudentId] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');

  // ----------------------------------------------------
  // HIGH-SPEED OPTIMIZED PARALLEL DATA LOADER
  // ----------------------------------------------------
  const loadWorkspace = async () => {
    if (!classroomId) return;
    setLoading(true);
    try {
      // Fire all requests concurrently in parallel
      const [allClasses, classAssignments, postsRes, attRes] = await Promise.all([
        dataService.getClassrooms(),
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
        activeSessionIdRef.current = attJson.session?.id || null;
        setRecords(attJson.records || []);
      }

      // Concurrently fetch submissions for all assignments to show submit counts
      if (classAssignments.length > 0) {
        Promise.all(classAssignments.map((item) => dataService.getSubmissions(item.id)))
          .then((results) => setSubmissions(results.flat()))
          .catch(() => {});
      }
    } catch (error) {
      console.error('Failed to load classroom workspace:', error);
      setNotice('โหลดข้อมูลห้องเรียนไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const loadAttendance = async (preferredSessionId?: string) => {
    try {
      const targetSessionId = preferredSessionId || activeSessionIdRef.current || session?.id || '';
      const url = `/api/attendance?classroomId=${encodeURIComponent(classroomId)}${
        targetSessionId ? `&sessionId=${encodeURIComponent(targetSessionId)}` : ''
      }`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json();
      setSessions(result.sessions || []);
      if (result.session) {
        setSession(result.session);
        activeSessionIdRef.current = result.session.id;
      } else if (!targetSessionId) {
        setSession(result.session || null);
      }
      setRecords(result.records || []);
    } catch (e) {
      console.error(e);
    }
  };

  const loadAttendanceSession = async (sessionId: string) => {
    try {
      activeSessionIdRef.current = sessionId;
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
        if ((tab === 'grades' || tab === 'classwork') && assignments.length > 0) {
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
        if (event.data?.type === 'attendance_checked' || event.data?.type === 'submission_created') {
          handleRealtimeEvent();
        }
      };
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener('pudding-submission-created', handleRealtimeEvent);
      window.removeEventListener('pudding-attendance-checked', handleRealtimeEvent);
      bc?.close();
    };
  }, [classroomId, tab, sessions, assignments]);

  // ----------------------------------------------------
  // UNIFIED TIMELINE BUILDER (Feed of Announcements, Work, Exams, Attendance)
  // ----------------------------------------------------
  const timeline = useMemo<TimelineItem[]>(() => {
    const list: TimelineItem[] = [
      ...posts.map((post) => {
        let title = 'ประกาศ';
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
          rawId: post.id,
          isPost: true,
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
        rawId: item.id,
        isPost: false,
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
        rawId: item.id,
        isPost: false,
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

  // Existing group names across assignments
  const existingGroupNames = useMemo(() => {
    const set = new Set<string>();
    assignments.forEach((a) => {
      if (a.group_name && a.group_name.trim()) set.add(a.group_name.trim());
    });
    return Array.from(set);
  }, [assignments]);

  // ----------------------------------------------------
  // CRUD HANDLERS: POSTS
  // ----------------------------------------------------
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

  const handleUpdatePost = async (postId: string, newBody: string) => {
    if (!newBody.trim()) return;
    setIsUpdatingPost(true);
    try {
      const res = await fetch('/api/classrooms/posts', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: postId, body: newBody.trim() }),
      });
      if (res.ok) {
        setNotice('แก้ไขโพสต์เรียบร้อยแล้ว');
        setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, body: newBody.trim() } : p)));
        setEditingPost(null);
      } else {
        setNotice('แก้ไขโพสต์ไม่สำเร็จ');
      }
    } catch {
      setNotice('เกิดข้อผิดพลาดในการแก้ไขโพสต์');
    } finally {
      setIsUpdatingPost(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบโพสต์นี้?')) return;
    try {
      const res = await fetch(`/api/classrooms/posts?id=${encodeURIComponent(postId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setNotice('ลบโพสต์เรียบร้อยแล้ว');
        setPosts((prev) => prev.filter((p) => p.id !== postId));
      } else {
        setNotice('ลบโพสต์ไม่สำเร็จ');
      }
    } catch {
      setNotice('เกิดข้อผิดพลาดในการลบโพสต์');
    }
  };

  // ----------------------------------------------------
  // CRUD HANDLERS: ASSIGNMENTS / EXAMS
  // ----------------------------------------------------
  const handleUpdateAssignment = async (
    assignmentId: string,
    updates: { title: string; due_date: string; total_points: number; group_name?: string }
  ) => {
    setIsUpdatingAssignment(true);
    try {
      await dataService.updateAssignment(assignmentId, updates);
      setAssignments((prev) => prev.map((a) => (a.id === assignmentId ? { ...a, ...updates } : a)));
      setNotice('แก้ไขข้อมูลงาน/ข้อสอบเรียบร้อยแล้ว');
      setEditingAssignment(null);
    } catch {
      setNotice('เกิดข้อผิดพลาดในการแก้ไขงาน/ข้อสอบ');
    } finally {
      setIsUpdatingAssignment(false);
    }
  };

  const handleDeleteAssignment = async (assignmentId: string) => {
    if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบงาน/ข้อสอบนี้? (คะแนนและข้อสอบทั้งหมดจะถูกลบออก)')) return;
    try {
      await dataService.deleteAssignment(assignmentId);
      setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
      setSubmissions((prev) => prev.filter((s) => s.assignment_id !== assignmentId));
      setNotice('ลบงาน/ข้อสอบเรียบร้อยแล้ว');
    } catch {
      setNotice('เกิดข้อผิดพลาดในการลบงาน/ข้อสอบ');
    }
  };

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

  // ----------------------------------------------------
  // CRUD HANDLERS: ATTENDANCE SESSIONS & RECORDS
  // ----------------------------------------------------
  const handleUpdateSession = async (
    sessionId: string,
    newTitle: string,
    newStatus?: 'open' | 'closed',
    startsAt?: string,
    onTime?: number,
    late?: number
  ) => {
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
          startsAt,
          onTimeUntilMinutes: onTime,
          lateUntilMinutes: late,
        }),
      });
      if (res.ok) {
        setNotice('อัปเดตข้อมูลคาบเช็คชื่อเรียบร้อย');
        await loadAttendance(sessionId);
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

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบคาบเช็คชื่อนี้พร้อมบันทึกทั้งหมด?')) return;
    try {
      const res = await fetch(
        `/api/attendance?sessionId=${encodeURIComponent(sessionId)}&classroomId=${encodeURIComponent(classroomId)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        setNotice('ลบคาบเช็คชื่อเรียบร้อยแล้ว');
        const remaining = sessions.filter((s) => s.id !== sessionId);
        setSessions(remaining);
        if (session?.id === sessionId) {
          setSession(remaining[0] || null);
          loadAttendance(remaining[0]?.id);
        }
      } else {
        setNotice('ลบคาบเช็คชื่อไม่สำเร็จ');
      }
    } catch {
      setNotice('เกิดข้อผิดพลาดในการลบคาบเช็คชื่อ');
    }
  };

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

  const updateAttendanceRecord = async (studentId: string, status: AttendanceStatus) => {
    if (!session) return;
    const response = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'record', classroomId, sessionId: session.id, studentId, status }),
    });
    if (response.ok) await loadAttendance(session.id);
  };

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
    await loadAttendance(session.id);
  };

  // Export Attendance CSV
  const exportAttendance = () => {
    if (!classroom || !session) return;
    const rows = [
      ['นักเรียน', 'รหัสนักเรียน', 'สถานะ', 'เวลาที่เช็ค'],
      ...(classroom.students || []).map((student) => {
        const record = records.find(
          (item) =>
            (student.id && item.student_id === student.id) ||
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
  };

  // ----------------------------------------------------
  // PEOPLE TAB: TEACHERS & STUDENTS MANAGEMENT
  // ----------------------------------------------------
  const teachersList: ClassroomTeacher[] = useMemo(() => {
    if (!classroom) return [];
    if (classroom.teachers && classroom.teachers.length > 0) {
      return classroom.teachers;
    }
    return defaultTeachersList;
  }, [classroom]);

  const handleAddTeacher = async (name: string, email: string, role: 'primary' | 'assistant' | 'researcher') => {
    if (!name.trim() || !classroom) return;
    const newT: ClassroomTeacher = {
      teacher_id: `t-${Date.now()}`,
      name: name.trim(),
      email: email.trim() || undefined,
      role,
    };
    const updated = [...teachersList, newT];
    await dataService.updateClassroom(classroom.id, { teachers: updated });
    setClassroom((prev) => (prev ? { ...prev, teachers: updated } : prev));
    setNotice(
      `เพิ่ม ${role === 'primary' ? 'ครูประจำวิชา' : role === 'assistant' ? 'TA ผู้ช่วยสอน' : 'ผู้ตรวจวิจัย (IRR)'} "${name.trim()}" เรียบร้อยแล้ว`
    );
    setShowAddTeacherModal(false);
    setNewTeacherName('');
    setNewTeacherEmail('');
  };

  const handleRemoveTeacher = async (teacherId: string) => {
    if (!classroom) return;
    if (teachersList.length <= 1) {
      alert('ไม่สามารถลบครูผู้สอนได้ ต้องมีครูผู้สอนในห้องเรียนอย่างน้อย 1 ท่าน');
      return;
    }
    if (!confirm('ต้องการนำครูผู้สอนท่านนี้ออกจากห้องเรียนหรือไม่?')) return;
    const updated = teachersList.filter((t) => t.teacher_id !== teacherId);
    await dataService.updateClassroom(classroom.id, { teachers: updated });
    setClassroom((prev) => (prev ? { ...prev, teachers: updated } : prev));
    setNotice('นำครูผู้สอนออกจากห้องเรียนเรียบร้อย');
  };

  const handleAddStudent = async (first_name: string, last_name: string, student_id: string, email: string) => {
    if (!first_name.trim() || !classroom) return;
    const newS = {
      id: `std-${Date.now()}`,
      first_name: first_name.trim(),
      last_name: last_name.trim(),
      student_id: student_id.trim() || undefined,
      email: email.trim() || undefined,
      role: 'student' as const,
    };
    const currentStudents = classroom.students || [];
    const updated = [...currentStudents, newS];
    await dataService.updateClassroom(classroom.id, { students: updated, student_count: updated.length });
    setClassroom((prev) => (prev ? { ...prev, students: updated, student_count: updated.length } : prev));
    setNotice(`เพิ่มผู้เรียน "${first_name.trim()} ${last_name.trim()}" เรียบร้อยแล้ว`);
    setShowAddStudentModal(false);
    setNewStudentFirst('');
    setNewStudentLast('');
    setNewStudentId('');
    setNewStudentEmail('');
  };

  const handleRemoveStudent = async (studentId: string) => {
    if (!classroom) return;
    if (!confirm('ต้องการนำผู้เรียนคนนี้ออกจากห้องเรียนหรือไม่?')) return;
    const currentStudents = classroom.students || [];
    const updated = currentStudents.filter((s) => s.id !== studentId);
    await dataService.updateClassroom(classroom.id, { students: updated, student_count: updated.length });
    setClassroom((prev) => (prev ? { ...prev, students: updated, student_count: updated.length } : prev));
    setNotice('นำผู้เรียนออกจากห้องเรียนเรียบร้อย');
  };

  const attendanceCounts = useMemo(() => {
    const counts: Record<string, number> = { on_time: 0, late: 0, absent: 0, excused: 0 };
    (classroom?.students || []).forEach((student) => {
      const record = records.find(
        (item) =>
          (student.id && item.student_id === student.id) ||
          (student.line_uid && item.student_id === student.line_uid) ||
          (student.student_id && item.student_id === student.student_id)
      );
      const status = record?.status || 'absent';
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }, [classroom?.students, records]);

  // Loading skeleton
  if (loading && !classroom) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-bold text-slate-500">กำลังเข้าสู่ห้องเรียน...</p>
        </div>
      </div>
    );
  }

  if (!classroom) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-slate-50 dark:bg-slate-950">
        <h2 className="text-lg font-black text-slate-800 dark:text-white">ไม่พบห้องเรียนที่ต้องการ</h2>
        <p className="text-xs text-slate-500 mt-1 mb-4">ห้องเรียนอาจถูกลบหรือคุณไม่มีสิทธิ์ในการเข้าถึง</p>
        <Link href="/dashboard" className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs">
          กลับสู่แดชบอร์ด
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 -m-4 md:-m-8">
      {/* Mobile Top App Bar with Drawer Toggle */}
      <div className="lg:hidden sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('toggle-classroom-sidebar'))}
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
        {/* ============================================================== */}
        {/* MAIN WORKSPACE CONTENT AREA (Full Width, No inner sidebar) */}
        {/* ============================================================== */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
          {/* Header Row */}
          <div className="hidden lg:flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('toggle-classroom-sidebar'))}
                className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 text-xs font-bold shadow-xs cursor-pointer"
                title="เปิดแถบวิชาและห้องเรียน"
              >
                <Layers className="w-4 h-4 text-amber-500" />
                <span>สลับห้องเรียน</span>
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
              <Link
                href={`/assignments/new?classroomId=${classroom.id}`}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>สร้างงาน / ข้อสอบ</span>
              </Link>
            </div>
          </div>

          {/* Toast Notification Notice */}
          {notice && (
            <div className="mb-6 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center justify-between">
              <span>{notice}</span>
              <button onClick={() => setNotice('')} className="text-amber-600 hover:text-amber-800 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Navigation Tab Bar */}
          <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2 mb-6 overflow-x-auto">
            {tabs.map((item) => {
              const Icon = item.icon;
              const isActive = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setTab(item.id);
                    router.replace(`/classrooms/${classroom.id}?tab=${item.id}`, { scroll: false });
                  }}
                  className={`px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* ============================================================ */}
          {/* TAB 1: OVERVIEW (ภาพรวม & Facebook-style Teacher Timeline) */}
          {/* ============================================================ */}
          {tab === 'overview' && (
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Left Column (Meta & Quick Info Cards) */}
              <div className="space-y-4">
                {/* Classroom Invite Code Card */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
                  <span className="text-[10px] font-black uppercase text-amber-600">รหัสเข้าร่วมห้องเรียน (LIFF Code)</span>
                  <div className="flex items-center justify-between p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
                    <span className="font-mono text-lg font-black text-slate-900 dark:text-white tracking-wider">
                      {classroom.invite_code || 'THAI-401'}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(classroom.invite_code || '');
                        setNotice('คัดลอกรหัสเข้าห้องเรียนแล้ว');
                      }}
                      className="px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold cursor-pointer"
                    >
                      คัดลอก
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    นักเรียนสามารถนำรหัสนี้ไปกรอกใน LINE LIFF เพื่อผูกบัญชีเข้าห้องเรียนได้ทันที
                  </p>
                </div>

                {/* LINE Group Status */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-2">
                  <span className="text-[10px] font-black uppercase text-slate-400">การเชื่อมต่อ LINE Group</span>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {classroom.line_connection_status === 'connected' ? 'เชื่อมต่อ LINE Group แล้ว' : 'พร้อมส่งแจ้งเตือน'}
                    </p>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    เมื่อโพสต์ประกาศ สั่งงาน หรือเปิดคาบเช็คชื่อ ระบบจะส่ง Push Notification เข้ากลุ่มทันที
                  </p>
                </div>
              </div>

              {/* Right Column: Facebook-style Posting & Full Activity Feed */}
              <div className="lg:col-span-2 space-y-4">
                {/* 1. Facebook-style Teacher Post Composer */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 font-black flex items-center justify-center text-sm">
                      {user?.firstName?.[0] || 'T'}
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        {user?.fullName || user?.firstName || 'ครูผู้สอน'}
                      </p>
                      <span className="text-[10px] text-slate-400">แชร์ประกาศ ข้อมูล หรือแจ้งเตือนเข้า LINE Group</span>
                    </div>
                  </div>

                  <textarea
                    rows={isPostExpanded ? 4 : 2}
                    value={postBody}
                    onFocus={() => setIsPostExpanded(true)}
                    onChange={(e) => setPostBody(e.target.value)}
                    placeholder="ประกาศข้อความถึงนักเรียนในห้องนี้ (จะถูกส่งเข้า LINE Group อัตโนมัติ)..."
                    className="w-full p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 transition-all resize-none"
                  />

                  {isPostExpanded && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-bold text-slate-400 mr-1">ประเภท:</span>
                        {(
                          [
                            ['announcement', '📢 ประกาศ'],
                            ['assignment', '📋 งาน'],
                            ['exam', '📝 ข้อสอบ'],
                            ['attendance', '⏰ เช็คชื่อ'],
                          ] as const
                        ).map(([type, label]) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setPostActivityType(type)}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                              postActivityType === type
                                ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setIsPostExpanded(false);
                            setPostBody('');
                          }}
                          className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          disabled={isPosting || !postBody.trim()}
                          onClick={createPost}
                          className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-xs transition-all"
                        >
                          {isPosting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          <span>โพสต์ประกาศ</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Unified Timeline Feed */}
                {timeline.map((item) => (
                  <article
                    key={item.id}
                    className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3"
                  >
                    {/* Post Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-700 dark:text-slate-300">
                          {item.type === 'exam' ? '📝' : item.type === 'assignment' ? '📋' : item.type === 'attendance' ? '⏰' : '📢'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
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

                      {/* Edit / Delete Buttons for Posts */}
                      {item.isPost && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              const found = posts.find((p) => p.id === item.rawId);
                              if (found) {
                                setEditingPost(found);
                                setEditPostBody(found.body);
                              }
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            title="แก้ไขโพสต์"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeletePost(item.rawId!)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            title="ลบโพสต์"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
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
                          <span>เปิดตรวจคะแนน</span>
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
                      {items.map((item) => {
                        const submittedCount = submissions.filter((s) => s.assignment_id === item.id).length;
                        return (
                          <div
                            key={item.id}
                            className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-amber-400 transition-all bg-slate-50/60 dark:bg-slate-850 space-y-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
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
                                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{item.title}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                  <span>กำหนดส่ง: {new Date(item.due_date).toLocaleString('th-TH')} • คะแนนเต็ม: {item.total_points || 20}</span>
                                  <span className="font-bold text-amber-600">
                                    • ส่งแล้ว {submittedCount}/{classroom.students?.length || 0} คน
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  onClick={() => {
                                    setEditingAssignment(item);
                                    setEditAssignTitle(item.title);
                                    setEditAssignDueDate(
                                      item.due_date ? new Date(item.due_date).toISOString().slice(0, 16) : ''
                                    );
                                    setEditAssignPoints(item.total_points || 20);
                                    setEditAssignGroup(item.group_name || '');
                                  }}
                                  className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-amber-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                  title="แก้ไขงาน/ข้อสอบ"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteAssignment(item.id)}
                                  className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                  title="ลบงาน/ข้อสอบ"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                <Link
                                  href={`/assignments/${item.id}/grading`}
                                  className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-amber-500 hover:text-slate-950 text-xs font-bold transition-colors cursor-pointer shrink-0"
                                >
                                  ตรวจคะแนน
                                </Link>
                              </div>
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
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Modal: Create Category Group */}
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
              onDeleteSession={handleDeleteSession}
              isUpdatingSession={isUpdatingSession}
            />
          )}

          {/* ============================================================ */}
          {/* TAB 4: PEOPLE (ผู้สอนและผู้เรียน) */}
          {/* ============================================================ */}
          {tab === 'people' && (
            <section className="max-w-4xl mx-auto space-y-6">
              {/* 1. Instructors Section (แสดงรายชื่อผู้สอน ละเอียดทุกท่าน พร้อมหน้าที่) */}
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h2 className="font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-amber-500" />
                    <span>รายชื่อผู้สอน ({teachersList.length})</span>
                  </h2>
                  <button
                    onClick={() => setShowAddTeacherModal(true)}
                    className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-xs transition-all"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>+ เพิ่มผู้สอน</span>
                  </button>
                </div>

                <div className="space-y-2.5">
                  {teachersList.map((teacher) => {
                    const isPrimary = teacher.role === 'primary';
                    const isResearcher = teacher.role === 'researcher';
                    const roleLabel = isPrimary
                      ? 'ครูประจำวิชา'
                      : isResearcher
                      ? 'วิจัย (ผู้ตรวจวิจัย/IRR)'
                      : 'TA (ผู้ช่วยสอน)';
                    const roleBadgeClass = isPrimary
                      ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-300'
                      : isResearcher
                      ? 'bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300 border-purple-300'
                      : 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 border-blue-300';

                    return (
                      <div
                        key={teacher.teacher_id}
                        className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-between gap-3 border border-slate-100 dark:border-slate-700/60"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-200 font-bold flex items-center justify-center text-sm shrink-0">
                            {teacher.name?.[0] || 'T'}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {teacher.name || teacher.teacher_id}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate mt-0.5">
                              {teacher.email || 'ไม่มีอีเมล'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${roleBadgeClass}`}>
                            {roleLabel}
                          </span>
                          <button
                            onClick={() => handleRemoveTeacher(teacher.teacher_id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                            title="ลบผู้สอนออกจากห้องเรียน"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 2. Students Section (แสดงผู้เรียน พร้อมปุ่มเพิ่มและลบ) */}
              <StudentList
                classroom={classroom}
                onOpenAddStudent={() => setShowAddStudentModal(true)}
                onRemoveStudent={handleRemoveStudent}
              />
            </section>
          )}

          {/* ============================================================ */}
          {/* TAB 5: GRADES (คะแนน) */}
          {/* ============================================================ */}
          {tab === 'grades' && (
            <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-4 overflow-x-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-black text-slate-900 dark:text-white">ตารางคะแนนรวมทั้งห้อง</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    แสดงคะแนนผลงาน ข้อสอบ และสถานะรอตรวจของนักเรียนทุกคน
                  </p>
                </div>
                <span className="text-xs text-slate-400 font-bold">{assignments.length} งาน/ข้อสอบ</span>
              </div>

              {gradesLoading ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-500" />
                  กำลังโหลดผลคะแนนนักเรียน...
                </div>
              ) : (
                <table className="w-full min-w-160 text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 text-left">
                      <th className="p-3">ชื่อ-นามสกุล</th>
                      <th className="p-3">รหัสนักเรียน</th>
                      {assignments.map((item) => (
                        <th key={item.id} className="p-3 text-center">
                          <span className="block truncate max-w-28 mx-auto font-bold text-slate-700 dark:text-slate-300">
                            {item.title}
                          </span>
                          <span className="text-[10px] text-slate-400 font-normal">
                            (เต็ม {item.total_points || 20})
                          </span>
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
                              ((s.student_id && s.student_id === student.id) ||
                                (student.line_uid && s.student_id === student.line_uid) ||
                                (student.student_id && s.student_id === student.student_id) ||
                                (s.student?.student_id && student.student_id && s.student.student_id === student.student_id) ||
                                (s.student?.id && student.id && s.student.id === student.id) ||
                                (s.student?.line_uid && student.line_uid && s.student.line_uid === student.line_uid))
                          );
                          return (
                            <td key={item.id} className="p-3 text-center font-bold">
                              {sub?.total_score !== undefined ? (
                                <span className="text-emerald-600 dark:text-emerald-400 font-black text-sm">
                                  {sub.total_score}
                                </span>
                              ) : sub ? (
                                <span className="text-amber-500 text-[10px] bg-amber-50 dark:bg-amber-950 px-2 py-0.5 rounded-full font-bold">
                                  รอตรวจ
                                </span>
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

      {/* ============================================================== */}
      {/* MODAL: EDIT POST */}
      {/* ============================================================== */}
      {editingPost && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-amber-500" />
                <span>แก้ไขข้อความโพสต์</span>
              </h3>
              <button onClick={() => setEditingPost(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              rows={4}
              value={editPostBody}
              onChange={(e) => setEditPostBody(e.target.value)}
              className="w-full p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 resize-none font-medium"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditingPost(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isUpdatingPost || !editPostBody.trim()}
                onClick={() => handleUpdatePost(editingPost.id, editPostBody)}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black shadow-xs cursor-pointer"
              >
                {isUpdatingPost ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: EDIT ASSIGNMENT / EXAM */}
      {/* ============================================================== */}
      {editingAssignment && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-amber-500" />
                <span>แก้ไขงาน / ข้อสอบ</span>
              </h3>
              <button onClick={() => setEditingAssignment(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">ชื่องาน / ข้อสอบ</label>
                <input
                  value={editAssignTitle}
                  onChange={(e) => setEditAssignTitle(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">กำหนดส่ง</label>
                <input
                  type="datetime-local"
                  value={editAssignDueDate}
                  onChange={(e) => setEditAssignDueDate(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">คะแนนเต็ม</label>
                  <input
                    type="number"
                    value={editAssignPoints}
                    onChange={(e) => setEditAssignPoints(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">หมวดหมู่</label>
                  <input
                    value={editAssignGroup}
                    onChange={(e) => setEditAssignGroup(e.target.value)}
                    placeholder="เช่น การเคลื่อนที่"
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none bg-slate-50 dark:bg-slate-800"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingAssignment(null)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isUpdatingAssignment || !editAssignTitle.trim()}
                onClick={() =>
                  handleUpdateAssignment(editingAssignment.id, {
                    title: editAssignTitle.trim(),
                    due_date: editAssignDueDate ? new Date(editAssignDueDate).toISOString() : editingAssignment.due_date,
                    total_points: editAssignPoints,
                    group_name: editAssignGroup.trim() || undefined,
                  })
                }
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black shadow-xs cursor-pointer"
              >
                {isUpdatingAssignment ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: ADD TEACHER */}
      {/* ============================================================== */}
      {showAddTeacherModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-amber-500" />
                <span>เพิ่มผู้สอนในห้องเรียน</span>
              </h3>
              <button onClick={() => setShowAddTeacherModal(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">ชื่อ-นามสกุลครูผู้สอน *</label>
                <input
                  value={newTeacherName}
                  onChange={(e) => setNewTeacherName(e.target.value)}
                  placeholder="เช่น ครูอัญชลี รัตนโชติ"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">อีเมลผู้สอน</label>
                <input
                  type="email"
                  value={newTeacherEmail}
                  onChange={(e) => setNewTeacherEmail(e.target.value)}
                  placeholder="anchalee.r@school.ac.th"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">หน้าที่ / บทบาท</label>
                <select
                  value={newTeacherRole}
                  onChange={(e) => setNewTeacherRole(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none bg-slate-50 dark:bg-slate-800"
                >
                  <option value="primary">ครูประจำวิชา (Primary)</option>
                  <option value="assistant">TA (ผู้ช่วยสอน)</option>
                  <option value="researcher">วิจัย (ผู้ตรวจวิจัย / IRR Evaluator)</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddTeacherModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={!newTeacherName.trim()}
                onClick={() => handleAddTeacher(newTeacherName, newTeacherEmail, newTeacherRole)}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black shadow-xs cursor-pointer"
              >
                เพิ่มผู้สอน
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: ADD STUDENT */}
      {/* ============================================================== */}
      {showAddStudentModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-amber-500" />
                <span>เพิ่มผู้เรียนในห้องเรียน</span>
              </h3>
              <button onClick={() => setShowAddStudentModal(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">ชื่อ *</label>
                  <input
                    value={newStudentFirst}
                    onChange={(e) => setNewStudentFirst(e.target.value)}
                    placeholder="ชลสิทธิ์"
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none bg-slate-50 dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">นามสกุล *</label>
                  <input
                    value={newStudentLast}
                    onChange={(e) => setNewStudentLast(e.target.value)}
                    placeholder="วงศ์สว่าง"
                    className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none bg-slate-50 dark:bg-slate-800"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">รหัสนักเรียน</label>
                <input
                  value={newStudentId}
                  onChange={(e) => setNewStudentId(e.target.value)}
                  placeholder="54107"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-mono outline-none bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-400 block mb-1">อีเมลผู้เรียน</label>
                <input
                  type="email"
                  value={newStudentEmail}
                  onChange={(e) => setNewStudentEmail(e.target.value)}
                  placeholder="student@school.ac.th"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddStudentModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={!newStudentFirst.trim()}
                onClick={() => handleAddStudent(newStudentFirst, newStudentLast, newStudentId, newStudentEmail)}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black shadow-xs cursor-pointer"
              >
                เพิ่มผู้เรียน
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StudentList({
  classroom,
  onOpenAddStudent,
  onRemoveStudent,
}: {
  classroom: Classroom;
  onOpenAddStudent: () => void;
  onRemoveStudent: (id: string) => void;
}) {
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
        <button
          onClick={onOpenAddStudent}
          className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-xs transition-all"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>+ เพิ่มผู้เรียน</span>
        </button>
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
          <div key={student.id} className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-between gap-2 border border-slate-100 dark:border-slate-700/60">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                {student.first_name} {student.last_name}
              </p>
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">{student.student_id || 'ไม่มีรหัส'}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {student.line_uid && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  LINE
                </span>
              )}
              <button
                onClick={() => onRemoveStudent(student.id)}
                className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title="ลบผู้เรียนออกจากห้องเรียน"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
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
  onDeleteSession,
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
  onUpdateSession?: (
    id: string,
    newTitle: string,
    newStatus?: 'open' | 'closed',
    startsAt?: string,
    onTime?: number,
    late?: number
  ) => void;
  onDeleteSession?: (id: string) => void;
  isUpdatingSession?: boolean;
}) {
  const [editingTitle, setEditingTitle] = useState('');
  const [editingStartsAt, setEditingStartsAt] = useState('');
  const [editingOnTime, setEditingOnTime] = useState(10);
  const [editingLate, setEditingLate] = useState(30);
  const [isEditingTitleActive, setIsEditingTitleActive] = useState(false);

  // Sync editing title and config when selected session changes
  useEffect(() => {
    if (session) {
      setEditingTitle(session.title);
      setEditingStartsAt(session.starts_at ? new Date(session.starts_at).toISOString().slice(0, 16) : '');
      setEditingOnTime(session.on_time_until_minutes || 10);
      setEditingLate(session.late_until_minutes || 30);
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
          <p className="text-xs text-slate-500 mt-0.5">เปิดคาบเช็คชื่อ ตรวจสอบสถานะผู้เรียน แก้ไข หรือลบประวัติ</p>
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
                onChange={(e) => setOnTime(Math.max(1, Number(e.target.value)))}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs outline-none text-center font-bold"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1">สายถึง (น.)</label>
              <input
                type="number"
                min={onTime}
                value={late}
                onChange={(e) => setLate(Math.max(onTime, Number(e.target.value)))}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs outline-none text-center font-bold"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-1">
          <button
            onClick={create}
            className="px-5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs inline-flex items-center gap-2 cursor-pointer shadow-md transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>เริ่มเปิดเช็คชื่อและส่งแจ้งเตือน LINE</span>
          </button>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 2. ประวัติคาบเช็คชื่อ & ตัวสลับ/แก้ไขสถานะรายคน */}
      {/* ============================================================== */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <span>ประวัติและคาบที่เปิดไว้ทั้งหมด</span>
            <span className="text-slate-400 font-normal">({sessions.length} คาบ)</span>
          </h3>
          <span className="text-[10px] text-slate-400">
            คลิกที่คาบเพื่อดูสถานะหรือแก้ไขรายละเอียด
          </span>
        </div>

        <div className="space-y-3">
          {sessions.map((item) => {
            const isSelected = session?.id === item.id;
            const isOpen = item.status === 'open';

            return (
              <div
                key={item.id}
                className={`rounded-3xl border transition-all overflow-hidden ${
                  isSelected
                    ? 'border-emerald-500 shadow-md bg-white dark:bg-slate-900 ring-2 ring-emerald-500/10'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
                }`}
              >
                {/* Session Card Header */}
                <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div
                    onClick={() => selectSession(item.id)}
                    className="flex-1 min-w-56 cursor-pointer"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          isOpen
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {isOpen ? '🟢 เปิดรับเช็คชื่อ' : '⚪ ปิดแล้ว'}
                      </span>
                      <h4 className="text-sm font-black text-slate-900 dark:text-white">{item.title}</h4>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      เริ่ม {new Date(item.starts_at).toLocaleString('th-TH')} • ตรงเวลา {item.on_time_until_minutes} นาที / สาย {item.late_until_minutes} นาที
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {isOpen && (
                      <>
                        <button
                          onClick={() => {
                            selectSession(item.id);
                            action('extend');
                          }}
                          className="px-2.5 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-100 cursor-pointer shadow-xs"
                        >
                          +10 นาที
                        </button>
                        <button
                          onClick={() => {
                            selectSession(item.id);
                            action('close');
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold hover:bg-rose-100 cursor-pointer shadow-xs"
                        >
                          ปิดรับ
                        </button>
                      </>
                    )}

                    <button
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

                    {onDeleteSession && (
                      <button
                        onClick={() => onDeleteSession(item.id)}
                        className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        title="ลบคาบเช็คชื่อนี้"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded Session Detail & Student Attendance Editor */}
                {isSelected && (
                  <div className="p-4 bg-white dark:bg-slate-900 border-t border-emerald-200 dark:border-emerald-800/60 space-y-4">
                    {/* Edit Session Title & Config Box */}
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
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
                                  onUpdateSession(
                                    item.id,
                                    editingTitle.trim(),
                                    undefined,
                                    editingStartsAt ? new Date(editingStartsAt).toISOString() : undefined,
                                    editingOnTime,
                                    editingLate
                                  );
                                  setIsEditingTitleActive(false);
                                }
                              }}
                              className="px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-black cursor-pointer shadow-xs"
                            >
                              บันทึกการแก้ไขคาบ
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
                          {onDeleteSession && (
                            <button
                              type="button"
                              onClick={() => onDeleteSession(item.id)}
                              className="px-2.5 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 text-xs font-bold text-rose-600 hover:bg-rose-50 flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>ลบคาบ</span>
                            </button>
                          )}
                        </div>
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
                              (student.id && r.student_id === student.id) ||
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
