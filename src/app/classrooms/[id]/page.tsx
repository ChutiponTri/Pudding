'use client';

import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { dataService } from '@/lib/supabase/dataService';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { LineGroupConnectSteps } from '@/components/LineGroupConnectSteps';
import { DateTimeField } from '@/components/DateTimeField';
import { EditStudentModal } from '@/components/EditStudentModal';
import { formatDateTime } from '@/lib/utils/datetime';
import { Assignment, Classroom, ClassroomTeacher, Submission, User } from '@/types/database';
import {
  ArrowLeft,
  AlertCircle,
  BookOpen,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  Clock,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  FileText,
  Filter,
  FolderPlus,
  Layers,
  Megaphone,
  Menu,
  MessageSquare,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Share2,
  Sparkles,
  Tag,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
  Loader2,
  MessageCircle,
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
  const [newTeacherRole, setNewTeacherRole] = useState<'primary' | 'assistant' | 'researcher'>('assistant');
  const [teacherSearchQuery, setTeacherSearchQuery] = useState('');
  const [teacherSearchResults, setTeacherSearchResults] = useState<any[]>([]);
  const [isSearchingTeachers, setIsSearchingTeachers] = useState(false);

  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteTab, setInviteTab] = useState<'search' | 'link' | 'pending'>('search');
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentSearchResults, setStudentSearchResults] = useState<any[]>([]);
  const [isSearchingStudents, setIsSearchingStudents] = useState(false);
  const [isCopiedLiff, setIsCopiedLiff] = useState(false);
  const [isCopiedCode, setIsCopiedCode] = useState(false);

  const [newStudentFirst, setNewStudentFirst] = useState('');
  const [newStudentLast, setNewStudentLast] = useState('');
  const [newStudentId, setNewStudentId] = useState('');
  const [newStudentEmail, setNewStudentEmail] = useState('');

  // LINE Group Connection Modal state
  const [showLineConnectModal, setShowLineConnectModal] = useState(false);
  const [lineConnection, setLineConnection] = useState<{
    status: 'disconnected' | 'waiting' | 'connected';
    groupName?: string;
    expiresAt?: string;
    connectedAt?: string;
  }>({ status: 'disconnected' });
  const [isLineLoading, setIsLineLoading] = useState(false);
  const [teacherBot, setTeacherBot] = useState<{ botFriend?: boolean | null; addFriendUrl?: string }>({});

  // Teacher's bot friendship (for the "add Pudding Bot" hint) when the dialog opens.
  useEffect(() => {
    if (!showLineConnectModal) return;
    fetch('/api/line/teacher-link', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => result && setTeacherBot({ botFriend: result.botFriend, addFriendUrl: result.addFriendUrl }))
      .catch(() => {});
  }, [showLineConnectModal]);

  // While waiting for the bot to join a group, poll until the webhook links it.
  useEffect(() => {
    if (lineConnection.status !== 'waiting' || !classroomId) return;
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/line/connections?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const result = await response.json();
        if (result.status === 'waiting') return;
        setLineConnection(result);
        setClassroom((prev) => (prev ? {
          ...prev,
          line_connection_status: result.status,
          line_group_name: result.groupName,
          line_group_id: result.status === 'connected' ? prev.line_group_id || 'linked' : undefined,
        } : null));
        if (result.status === 'connected') setNotice(`เชื่อม LINE Group${result.groupName ? ` “${result.groupName}”` : ''} เรียบร้อยแล้ว`);
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [lineConnection.status, classroomId]);

  const getRealLiffUrl = (cls?: Classroom | null) => {
    if (!cls) return '';
    const liffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID || '2011818142-BznwnWyj';
    return `https://liff.line.me/${liffId}?classId=${cls.id}&code=${cls.invite_code || ''}`;
  };

  const getWebInviteUrl = (cls?: Classroom | null) => {
    if (!cls) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/liff?classId=${cls.id}&code=${cls.invite_code || ''}`;
  };

  const handleLineConnection = async (action: 'create' | 'test' | 'disconnect') => {
    if (!classroom) return;
    setIsLineLoading(true);
    try {
      const response = await fetch('/api/line/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomId: classroom.id, action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'LINE connection failed');
      setLineConnection(result);
      setClassroom((prev) => (prev ? {
        ...prev,
        line_connection_status: result.status,
        ...(action === 'disconnect' ? { line_group_id: undefined, line_group_name: undefined } : {}),
      } : null));
      setNotice(
        action === 'disconnect'
          ? 'ยกเลิกการเชื่อมต่อแล้ว และบอทออกจากกลุ่ม LINE แล้ว'
          : action === 'test'
          ? 'ส่งข้อความทดสอบเข้ากลุ่ม LINE แล้ว'
          : 'พร้อมเชื่อมต่อ: เพิ่ม Pudding Bot เข้ากลุ่ม LINE ได้เลย'
      );
    } catch (error: any) {
      setNotice(error?.message || 'ไม่สามารถเชื่อมต่อ LINE Group ได้');
    } finally {
      setIsLineLoading(false);
    }
  };

  const handleSearchStudents = async (q: string) => {
    setStudentSearchQuery(q);
    if (!q.trim()) {
      setStudentSearchResults([]);
      return;
    }
    setIsSearchingStudents(true);
    try {
      const res = await dataService.searchStudentsByInstitution(q);
      setStudentSearchResults(res);
    } catch (e) {
      console.error('Search students error:', e);
    } finally {
      setIsSearchingStudents(false);
    }
  };

  const handleSearchTeachers = async (q: string) => {
    setTeacherSearchQuery(q);
    if (!q.trim()) {
      setTeacherSearchResults([]);
      return;
    }
    setIsSearchingTeachers(true);
    try {
      const res = await dataService.searchTeachers(q);
      setTeacherSearchResults(res);
    } catch (e) {
      console.error('Search teachers error:', e);
    } finally {
      setIsSearchingTeachers(false);
    }
  };

  // ----------------------------------------------------
  // HIGH-SPEED OPTIMIZED PARALLEL DATA LOADER
  // ----------------------------------------------------
  const loadWorkspace = async () => {
    if (!classroomId) return;
    setLoading(true);
    try {
      // Fire all requests concurrently in parallel
      const [current, classAssignments, postsRes, attRes] = await Promise.all([
        dataService.getClassroomById(classroomId),
        dataService.getAssignmentsByClassroomId(classroomId),
        fetch(`/api/classrooms/posts?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' }),
        fetch(`/api/attendance?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' }),
      ]);

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
        dataService.getSubmissionsByAssignmentIds(classAssignments.map((item) => item.id))
          .then(setSubmissions)
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
      // The teacher switched sessions while this request was in flight: keep
      // their selection instead of snapping back to the old one.
      if (targetSessionId && activeSessionIdRef.current !== targetSessionId) return;
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
      if (activeSessionIdRef.current !== sessionId) return;
      setSession(result.session || null);
      setRecords(result.records || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, [user?.id, classroomId]);

  // Live roster: students join from LIFF by writing the classroom row or a
  // classroom_students link, so listen for those changes and refetch only the
  // roster (debounced, so a burst of joins costs one request). Polling is only
  // a fallback for when the realtime channel can't connect.
  useEffect(() => {
    if (!classroomId) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setInterval> | undefined;
    let disposed = false;
    const refreshRoster = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        dataService.getClassroomById(classroomId)
          .then((current) => current && setClassroom(current))
          .catch(() => {});
      }, 400);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshRoster();
    };
    const startFallback = () => {
      if (fallback || disposed) return;
      fallback = setInterval(() => {
        if (document.visibilityState === 'visible') refreshRoster();
      }, 15000);
    };

    const supabase = isSupabaseConfigured ? createClient() : null;
    const channel = supabase
      ?.channel(`classroom-roster-${classroomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classrooms', filter: `id=eq.${classroomId}` }, refreshRoster)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'classroom_students', filter: `classroom_id=eq.${classroomId}` }, refreshRoster)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearInterval(fallback);
          fallback = undefined;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          startFallback();
        }
      });
    if (!channel) startFallback();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      clearTimeout(debounce);
      clearInterval(fallback);
      document.removeEventListener('visibilitychange', onVisible);
      if (channel) supabase?.removeChannel(channel);
    };
  }, [classroomId]);

  // Fetch Grades when switching to Grades tab
  useEffect(() => {
    if (tab !== 'grades' || !assignments.length) return;
    setGradesLoading(true);
    dataService.getSubmissionsByAssignmentIds(assignments.map((item) => item.id))
      .then(setSubmissions)
      .finally(() => setGradesLoading(false));
  }, [tab, assignments]);

  // Background refresh while the teacher is viewing (every 10s, paused when
  // the tab is hidden), plus instant refresh on same-browser events.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        const hasOpenSession = sessions.some((s) => s.status === 'open');
        if (tab === 'attendance' || hasOpenSession) {
          loadAttendance();
        }
        if ((tab === 'grades' || tab === 'classwork') && assignments.length > 0) {
          dataService.getSubmissionsByAssignmentIds(assignments.map((item) => item.id))
            .then(setSubmissions)
            .catch(() => {});
        }
      }
    }, 10000);

    const handleRealtimeEvent = () => {
      loadAttendance();
      if (assignments.length > 0) {
        dataService.getSubmissionsByAssignmentIds(assignments.map((item) => item.id))
          .then(setSubmissions)
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
    const list: TimelineItem[] = [];
    const seenAssignmentIds = new Set<string>();
    const seenSessionIds = new Set<string>();
    const seenContentKeys = new Set<string>();

    // 1. Process posts first
    for (const post of posts) {
      const aId = post.metadata?.assignmentId;
      const sId = (post.metadata as any)?.sessionId;

      if (aId) {
        if (seenAssignmentIds.has(aId)) continue;
        seenAssignmentIds.add(aId);
      }
      if (sId) {
        if (seenSessionIds.has(sId)) continue;
        seenSessionIds.add(sId);
      }

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

      // Check content key to avoid duplicate identical messages
      const normalizedBody = post.body.replace(/^(ข้อสอบใหม่:|งานใหม่:|เปิดคาบเช็คชื่อ:)\s*/, '').trim().toLowerCase();
      const contentKey = `${post.activity_type || 'announcement'}-${normalizedBody.slice(0, 40)}`;
      if (seenContentKeys.has(contentKey)) continue;
      seenContentKeys.add(contentKey);

      list.push({
        id: `post-${post.id}`,
        rawId: post.id,
        isPost: true,
        title,
        body: post.body,
        type: post.activity_type || 'announcement',
        created_at: post.created_at,
        badgeLabel,
        badgeColor,
        href: aId ? `/assignments/${aId}/grading?from=classroom&classroomId=${classroomId}` : undefined,
      });
    }

    // 2. Add assignments that do NOT already have a timeline post
    for (const item of assignments) {
      if (seenAssignmentIds.has(item.id)) continue;
      const normalizedTitle = item.title.trim().toLowerCase();
      const contentKey = `${item.is_exam ? 'exam' : 'assignment'}-${normalizedTitle.slice(0, 40)}`;
      if (seenContentKeys.has(contentKey)) continue;

      seenAssignmentIds.add(item.id);
      seenContentKeys.add(contentKey);

      list.push({
        id: `assignment-${item.id}`,
        rawId: item.id,
        isPost: false,
        title: item.is_exam ? 'ข้อสอบในระบบ' : 'งานที่มอบหมาย',
        body: `${item.title} (${item.is_exam ? 'ปิดรับ' : 'กำหนดส่ง'}: ${formatDateTime(item.due_date, 'th')})`,
        type: item.is_exam ? ('exam' as const) : ('assignment' as const),
        badgeLabel: item.is_exam ? 'ข้อสอบ' : 'งาน',
        badgeColor: item.is_exam
          ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
        created_at: item.created_at || item.due_date,
        href: `/assignments/${item.id}/grading?from=classroom&classroomId=${classroomId}`,
      });
    }

    // 3. Add sessions that do NOT already have a timeline post
    for (const item of sessions) {
      if (seenSessionIds.has(item.id)) continue;
      const normalizedTitle = item.title.trim().toLowerCase();
      const contentKey = `attendance-${normalizedTitle.slice(0, 40)}`;
      if (seenContentKeys.has(contentKey)) continue;

      seenSessionIds.add(item.id);
      seenContentKeys.add(contentKey);

      list.push({
        id: `attendance-${item.id}`,
        rawId: item.id,
        isPost: false,
        title: 'เปิดคาบเช็คชื่อ',
        body: `${item.title} (สถานะ: ${item.status === 'open' ? 'เปิดรับอยู่' : 'ปิดแล้ว'})`,
        type: 'attendance' as const,
        badgeLabel: 'เช็คชื่อ',
        badgeColor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
        created_at: item.starts_at,
      });
    }

    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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
    // Old (already passed) deadlines may be kept when only the title/points change.
    const previous = assignments.find((a) => a.id === assignmentId)?.due_date;
    const dueChanged = !previous || new Date(previous).getTime() !== new Date(updates.due_date).getTime();
    if (dueChanged && new Date(updates.due_date).getTime() <= Date.now()) {
      alert('กำหนดส่งต้องเป็นเวลาในอนาคต');
      return;
    }
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
    const startsAt = attendanceStartsAt || new Date().toISOString();
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
      const { session: created } = (await response.json()) as { session: AttendanceSession };
      setNotice('เปิดคาบเช็คชื่อแล้ว และส่งแจ้งเตือนเข้า LINE Group');
      // Show and select the new session right away, then sync in the background.
      activeSessionIdRef.current = created.id;
      setSessions((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      setSession(created);
      setRecords([]);
      loadAttendance(created.id);
      fetch(`/api/classrooms/posts?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => json && setPosts(json.posts || []))
        .catch(() => {});
    } catch {
      setNotice('เกิดข้อผิดพลาดในการเปิดคาบเช็คชื่อ');
    }
  };

  // Both handlers take the session explicitly: the parent `session` can lag
  // behind the card the teacher clicked, which used to write to the wrong class.
  const updateAttendanceRecord = async (sessionId: string, studentId: string, status: AttendanceStatus) => {
    activeSessionIdRef.current = sessionId;
    const response = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'record', classroomId, sessionId, studentId, status }),
    });
    if (response.ok) await loadAttendance(sessionId);
    else setNotice('บันทึกสถานะการเข้าเรียนไม่สำเร็จ กรุณาลองใหม่');
  };

  const sessionAction = async (sessionId: string, action: 'close' | 'extend') => {
    const target = sessions.find((s) => s.id === sessionId);
    if (!target) return;
    activeSessionIdRef.current = sessionId;
    await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action,
        classroomId,
        sessionId,
        ...(action === 'extend' ? { lateUntilMinutes: target.late_until_minutes + 10 } : {}),
      }),
    });
    await loadAttendance(sessionId);
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
    return classroom.teachers || [];
  }, [classroom]);

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

  const handleSelectFoundStudent = async (std: any) => {
    if (!classroom) return;
    const alreadyEnrolled = [...(classroom.students || []), ...(classroom.pending_students || [])]
      .some((student) => student.id === std.id || (student.student_id && std.student_id && student.student_id === std.student_id));
    if (alreadyEnrolled) {
      setNotice('นักเรียนคนนี้อยู่ในห้องเรียนแล้ว');
      return;
    }
    await dataService.addStudentToClassroom(
      classroom.id,
      {
        id: std.id,
        first_name: std.first_name,
        last_name: std.last_name,
        student_id: std.student_id,
        email: std.email,
        avatar_url: std.avatar_url,
        institution: std.institution,
      },
      { autoAdmit: true }
    );
    setNotice(`เพิ่ม ${std.first_name} ${std.last_name} สำเร็จ`);
    setStudentSearchQuery('');
    setStudentSearchResults([]);
    await loadWorkspace();
  };

  const handleAdmitStudent = async (studentId: string) => {
    if (!classroom) return;
    try {
      await dataService.admitStudentToClassroom(classroom.id, studentId);
      setNotice('อนุมัตินักเรียนเข้าห้องเรียนสำเร็จ');
      await loadWorkspace();
    } catch (e) {
      console.error(e);
      setNotice('เกิดข้อผิดพลาดในการอนุมัติ');
    }
  };

  const handleRejectStudent = async (studentId: string) => {
    if (!classroom) return;
    if (!confirm('ต้องการปฏิเสธคำขอนี้หรือไม่?')) return;
    try {
      await dataService.rejectStudentFromClassroom(classroom.id, studentId);
      setNotice('ปฏิเสธคำขอเข้าห้องเรียนแล้ว');
      await loadWorkspace();
    } catch (e) {
      console.error(e);
      setNotice('เกิดข้อผิดพลาดในการปฏิเสธ');
    }
  };

  const handleSelectFoundTeacher = async (foundTeacher: any, role: 'primary' | 'assistant' | 'researcher' = 'assistant') => {
    if (!classroom) return;
    const currentTeachers = teachersList;
    if (currentTeachers.some((t) => t.teacher_id === foundTeacher.id)) {
      setNotice('ครูท่านนี้อยู่ในห้องเรียนแล้ว');
      return;
    }
    const updated = [
      ...currentTeachers,
      {
        teacher_id: foundTeacher.id,
        role,
        name: `${foundTeacher.first_name || ''} ${foundTeacher.last_name || ''}`.trim() || foundTeacher.email || 'อาจารย์',
        email: foundTeacher.email || '',
      },
    ];
    await dataService.updateClassroom(classroom.id, { teachers: updated });
    setClassroom((prev) => (prev ? { ...prev, teachers: updated } : prev));
    setNotice('เพิ่มผู้สอนเรียบร้อยแล้ว');
    setTeacherSearchQuery('');
    setTeacherSearchResults([]);
    setShowAddTeacherModal(false);
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

  const [editingStudent, setEditingStudent] = useState<User | null>(null);

  const handleStudentEdited = (studentId: string, fields: Pick<User, 'first_name' | 'last_name' | 'student_id'>) => {
    setClassroom((prev) =>
      prev
        ? {
            ...prev,
            students: (prev.students || []).map((s) => (s.id === studentId ? { ...s, ...fields } : s)),
            pending_students: (prev.pending_students || []).map((s) => (s.id === studentId ? { ...s, ...fields } : s)),
          }
        : prev
    );
    setEditingStudent(null);
    setNotice('แก้ไขข้อมูลผู้เรียนเรียบร้อย');
  };

  const handleRemoveStudent = async (studentId: string) => {
    if (!classroom) return;
    if (!confirm('ต้องการนำผู้เรียนคนนี้ออกจากห้องเรียนหรือไม่?')) return;
    try {
      await dataService.removeStudentFromClassroom(classroom.id, studentId);
      const currentStudents = classroom.students || [];
      const updated = currentStudents.filter((s) => s.id !== studentId);
      setClassroom((prev) => (prev ? { ...prev, students: updated, student_count: updated.length } : prev));
      setNotice('นำผู้เรียนออกจากห้องเรียนเรียบร้อย');
    } catch {
      setNotice('เกิดข้อผิดพลาดในการลบผู้เรียน');
    }
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
      <div className="min-h-dvh flex items-center justify-center p-6 bg-slate-50 dark:bg-slate-950">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-bold text-slate-500">กำลังเข้าสู่ห้องเรียน...</p>
        </div>
      </div>
    );
  }

  if (!classroom) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-6 text-center bg-slate-50 dark:bg-slate-950">
        <h2 className="text-lg font-black text-slate-800 dark:text-white">ไม่พบห้องเรียนที่ต้องการ</h2>
        <p className="text-xs text-slate-500 mt-1 mb-4">ห้องเรียนอาจถูกลบหรือคุณไม่มีสิทธิ์ในการเข้าถึง</p>
        <Link href="/dashboard" className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs">
          กลับสู่แดชบอร์ด
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950 -mx-4 sm:-mx-6 lg:-mx-8 -my-5 sm:-my-8">
      {/* Mobile Top App Bar with Drawer Toggle (sits under the global navbar) */}
      <div className="lg:hidden sticky top-[calc(4rem+env(safe-area-inset-top))] z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800 px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
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
        <button onClick={loadWorkspace} aria-label="รีเฟรช" className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-slate-500 shrink-0">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="max-w-[1700px] mx-auto min-h-dvh flex">
        {/* ============================================================== */}
        {/* MAIN WORKSPACE CONTENT AREA (Full Width, No inner sidebar) */}
        {/* ============================================================== */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
          {/* Header Row (title is in the mobile bar below lg; actions show on every size) */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 lg:gap-4 mb-5 sm:mb-6">
            <div className="hidden lg:flex items-center gap-3 min-w-0">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-amber-600 mb-1">
                  <span>{classroom.subject_code || 'CLASSROOM'}</span>
                  <span>•</span>
                  <span>ภาคเรียน {classroom.academic_year || 'ปัจจุบัน'}</span>
                </div>
                <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight break-words">{classroom.name}</h1>
              </div>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none -mx-1 px-1 py-0.5 [&>*]:shrink-0">
              {/* Secondary: Invite Students Modal Trigger */}
              <button
                type="button"
                onClick={() => {
                  setShowInviteModal(true);
                  setInviteTab('search');
                }}
                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5 text-amber-500" />
                <span>เชิญนักเรียน</span>
                {(classroom.pending_students?.length || 0) > 0 && (
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                )}
              </button>

              {/* Secondary: Connect LINE Bot Modal Trigger */}
              <button
                type="button"
                onClick={() => {
                  setShowLineConnectModal(true);
                  fetch(`/api/line/connections?classroomId=${classroom.id}`)
                    .then((r) => r.json())
                    .then((d) => setLineConnection(d))
                    .catch(() => {});
                }}
                className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    classroom.line_connection_status === 'connected' || classroom.line_group_id
                      ? 'bg-emerald-500'
                      : classroom.line_connection_status === 'waiting'
                      ? 'bg-amber-500 animate-pulse'
                      : 'bg-slate-400'
                  }`}
                />
                <span>เชื่อมบอท LINE</span>
              </button>

              {/* Primary: Create Assignment or Exam */}
              <Link
                href={`/assignments/new?classroomId=${classroom.id}&from=classroom`}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 shadow-sm transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>สร้างงาน / ข้อสอบ</span>
              </Link>
            </div>
          </div>


          {/* Toast Notification Notice */}
          {notice && (
            <div role="status" className="mb-5 sm:mb-6 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center justify-between gap-3 animate-in fade-in">
              <span className="min-w-0 break-words">{notice}</span>
              <button onClick={() => setNotice('')} aria-label="ปิด" className="text-amber-600 hover:text-amber-800 p-1 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Navigation Tab Bar */}
          <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2 mb-5 sm:mb-6 overflow-x-auto scrollbar-none -mx-1 px-1">
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
                  className={`px-3.5 sm:px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
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
            <div className="max-w-3xl mx-auto space-y-6">
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
                      <div className="flex flex-wrap items-center gap-1.5">
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
                  <div className="p-5 sm:p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs text-slate-400">
                    ยังไม่มีโพสต์หรือประกาศในห้องนี้ เริ่มต้นแชร์ข้อความแรกของคุณได้เลย
                  </div>
                )}
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
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setShowAddGroupModal(true)}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 cursor-pointer"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
                    <span>+ สร้างกลุ่มหมวดหมู่ใหม่</span>
                  </button>
                  <Link
                    href={`/assignments/new?classroomId=${classroom.id}&from=classroom`}
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
                                  <span>{item.is_exam ? 'ปิดรับ' : 'กำหนดส่ง'}: {formatDateTime(item.due_date, 'th')} • คะแนนเต็ม: {item.total_points || 20}</span>
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
                                    setEditAssignDueDate(item.due_date || '');
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
                                  href={`/assignments/${item.id}/grading?from=classroom&classroomId=${classroomId}`}
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
                <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
                  <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 max-w-sm w-full space-y-4 shadow-xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
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
                <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
                  <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 max-w-sm w-full space-y-4 shadow-xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
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
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-xs space-y-4">
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

              {/* Pending Approvals Notice Banner */}
              {(classroom.pending_students?.length || 0) > 0 && (
                <div className="p-4 rounded-3xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex flex-wrap items-center justify-between gap-3 shadow-xs">
                  <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-rose-500 animate-ping" />
                    <div>
                      <p className="text-xs font-black text-amber-950 dark:text-amber-100">
                        มีคำขอเข้าร่วมห้องเรียนรอการอนุมัติ ({classroom.pending_students?.length} คน)
                      </p>
                      <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                        นักเรียนลงทะเบียนผ่านลิงก์ LINE หรือระบบแล้ว รอคุณครูอนุมัติเข้าห้องเรียน
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowInviteModal(true);
                      setInviteTab('pending');
                    }}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black shadow-xs cursor-pointer"
                  >
                    ตรวจสอบและอนุมัติ (Admit)
                  </button>
                </div>
              )}

              {/* 2. Students Section (แสดงผู้เรียน พร้อมปุ่มเพิ่มและลบ) */}
              <StudentList
                classroom={classroom}
                onOpenAddStudent={() => {
                  setShowInviteModal(true);
                  setInviteTab('search');
                }}
                onRemoveStudent={handleRemoveStudent}
                onEditStudent={setEditingStudent}
              />
            </section>
          )}

          {/* ============================================================ */}
          {/* TAB 5: GRADES (คะแนน) */}
          {/* ============================================================ */}
          {tab === 'grades' && (
            <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-xs space-y-4 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
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
                <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                <table className="w-full min-w-160 text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 text-left">
                      <th className="p-3 sticky left-0 z-10 bg-white dark:bg-slate-900">ชื่อ-นามสกุล</th>
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
                        <td className="p-3 font-bold text-slate-900 dark:text-white sticky left-0 bg-white dark:bg-slate-900 whitespace-nowrap">
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
                              {sub?.total_score != null ? (
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
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      {/* ============================================================== */}
      {/* MODAL: EDIT POST */}
      {/* ============================================================== */}
      {editingPost && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 max-w-lg w-full space-y-4 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
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
      {editingStudent && classroom && (
        <EditStudentModal
          classroomId={classroom.id}
          student={editingStudent}
          onClose={() => setEditingStudent(null)}
          onSaved={handleStudentEdited}
        />
      )}

      {editingAssignment && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 max-w-md w-full space-y-4 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
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
                <label className="text-[11px] font-bold text-slate-400 block mb-1">
                  {editingAssignment.is_exam ? 'ปิดรับคำตอบ' : 'กำหนดส่ง'}
                </label>
                <DateTimeField value={editAssignDueDate} onChange={setEditAssignDueDate} presets="deadline" />
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
                    due_date: editAssignDueDate || editingAssignment.due_date,
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
      {/* ============================================================== */}
      {/* MODAL: ADD TEACHER (Search existing + Manual Fallback) */}
      {/* ============================================================== */}
      {showAddTeacherModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 max-w-md w-full space-y-4 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-amber-500" />
                <span>เพิ่มผู้สอนในห้องเรียน</span>
              </h3>
              <button onClick={() => setShowAddTeacherModal(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Role first, then pick a teacher who has an account */}
            <div>
              <label className="text-[10px] font-bold text-slate-400 block mb-1">หน้าที่ / บทบาท</label>
              <select
                value={newTeacherRole}
                onChange={(e) => setNewTeacherRole(e.target.value as any)}
                className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none bg-slate-50 dark:bg-slate-800"
              >
                <option value="primary">ครูประจำวิชา (Primary)</option>
                <option value="assistant">TA (ผู้ช่วยสอน)</option>
                <option value="researcher">วิจัย (ผู้ตรวจวิจัย / IRR Evaluator)</option>
              </select>
            </div>

            {/* Quick Search Teachers */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-slate-400 block">ค้นหาอาจารย์/ผู้สอนที่มีในระบบ</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
                <input
                  value={teacherSearchQuery}
                  onChange={(e) => handleSearchTeachers(e.target.value)}
                  placeholder="ค้นหาชื่อหรืออีเมลผู้สอน..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                />
                {isSearchingTeachers && (
                  <Loader2 className="w-3.5 h-3.5 absolute right-3 top-3 text-amber-500 animate-spin" />
                )}
              </div>

              {teacherSearchResults.length > 0 && (
                <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700/60 space-y-1.5 max-h-40 overflow-y-auto">
                  {teacherSearchResults.map((t) => (
                    <div
                      key={t.id}
                      className="p-2 rounded-lg bg-white dark:bg-slate-900 flex items-center justify-between gap-2 text-xs border border-slate-100 dark:border-slate-800"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-slate-900 dark:text-white truncate">
                          {t.first_name} {t.last_name}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">{t.email}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSelectFoundTeacher(t, newTeacherRole)}
                        className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black shadow-xs cursor-pointer"
                      >
                        + เพิ่ม
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-400">
              ผู้สอนต้องมีบัญชีในระบบก่อน (เข้าสู่ระบบครั้งแรกแล้ว) จึงจะค้นหาและตรวจงานได้
            </p>

            <button
              type="button"
              onClick={() => setShowAddTeacherModal(false)}
              className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              ปิด
            </button>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: INVITE & MANAGE STUDENTS (Liff Link, QR, Search, Pending) */}
      {/* ============================================================== */}
      {showInviteModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in"
          onClick={() => setShowInviteModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 max-w-xl w-full space-y-5 shadow-2xl max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-amber-500" />
                  <span>เชิญและเพิ่มนักเรียนเข้าห้องเรียน</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {classroom.name} • {classroom.subject_code}
                </p>
              </div>
              <button
                onClick={() => setShowInviteModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="flex items-center gap-1.5 border-b border-slate-100 dark:border-slate-800 pb-2">
              <button
                type="button"
                onClick={() => setInviteTab('search')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  inviteTab === 'search'
                    ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span>ค้นหาและเพิ่มด่วน</span>
              </button>

              <button
                type="button"
                onClick={() => setInviteTab('link')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  inviteTab === 'link'
                    ? 'bg-emerald-600 text-white font-black shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>ลิงก์เชิญ & QR Code</span>
              </button>

              <button
                type="button"
                onClick={() => setInviteTab('pending')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  inviteTab === 'pending'
                    ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>คำขอรออนุมัติ</span>
                {(classroom.pending_students?.length || 0) > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-black animate-pulse">
                    {classroom.pending_students?.length}
                  </span>
                )}
              </button>
            </div>

            {/* TAB 1: Search & Quick Add */}
            {inviteTab === 'search' && (
              <div className="space-y-4">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input
                    value={studentSearchQuery}
                    onChange={(e) => handleSearchStudents(e.target.value)}
                    placeholder="🔍 ค้นหานักเรียนในระบบ (ชื่อ, นามสกุล หรือรหัสนักเรียน)..."
                    className="w-full pl-9 pr-8 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 dark:text-white"
                  />
                  {isSearchingStudents && (
                    <Loader2 className="w-4 h-4 absolute right-3 top-3 text-amber-500 animate-spin" />
                  )}
                </div>

                {studentSearchResults.length > 0 && (
                  <div className="p-2 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-700/60 space-y-1.5 max-h-56 overflow-y-auto">
                    {studentSearchResults.map((found) => (
                      <div
                        key={found.id}
                        className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 dark:text-white truncate">
                            {found.first_name} {found.last_name}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            รหัส: {found.student_id || '-'} • {found.email || 'ไม่มีอีเมล'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectFoundStudent(found)}
                          className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs cursor-pointer shadow-xs whitespace-nowrap"
                        >
                          + เพิ่มเข้าห้อง
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Collapsible Manual Addition Form */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-[11px] font-bold text-slate-400 mb-2.5">
                    หรือ กรอกข้อมูลนักเรียนด้วยตนเอง (สำหรับนักเรียนที่ยังไม่เคยลงทะเบียน)
                  </p>
                  <div className="space-y-2.5 bg-slate-50 dark:bg-slate-850 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={newStudentFirst}
                        onChange={(e) => setNewStudentFirst(e.target.value)}
                        placeholder="ชื่อ *"
                        className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      />
                      <input
                        value={newStudentLast}
                        onChange={(e) => setNewStudentLast(e.target.value)}
                        placeholder="นามสกุล *"
                        className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={newStudentId}
                        onChange={(e) => setNewStudentId(e.target.value)}
                        placeholder="รหัสนักเรียน (เช่น 65001)"
                        className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-mono outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      />
                      <input
                        type="email"
                        value={newStudentEmail}
                        onChange={(e) => setNewStudentEmail(e.target.value)}
                        placeholder="อีเมลผู้เรียน"
                        className="w-full p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!newStudentFirst.trim()}
                      onClick={() => handleAddStudent(newStudentFirst, newStudentLast, newStudentId, newStudentEmail)}
                      className="w-full py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-black hover:opacity-90 transition-all cursor-pointer shadow-xs disabled:opacity-40"
                    >
                      + บันทึกและเพิ่มเข้าห้องเรียน
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: Invite Link & QR Code */}
            {inviteTab === 'link' && (
              <div className="space-y-4">
                {/* Classroom Invite Code */}
                {classroom.invite_code && (
                  <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 block">
                        รหัสห้องเรียน (Invite Code)
                      </span>
                      <span className="text-xl font-black tracking-widest text-amber-950 dark:text-amber-100 font-mono">
                        {classroom.invite_code}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(classroom.invite_code || '');
                        setIsCopiedCode(true);
                        setTimeout(() => setIsCopiedCode(false), 2000);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-700 text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      {isCopiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{isCopiedCode ? 'คัดลอกแล้ว' : 'คัดลอกรหัส'}</span>
                    </button>
                  </div>
                )}

                {/* QR Code and LIFF Link */}
                <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
                      getRealLiffUrl(classroom)
                    )}`}
                    alt="Classroom QR Code"
                    className="w-32 h-32 rounded-2xl bg-white p-2 shadow-sm border border-slate-200 shrink-0"
                  />
                  <div className="space-y-2 text-center sm:text-left min-w-0 flex-1">
                    <p className="text-xs font-black text-slate-900 dark:text-white">
                      สแกนด้วย LINE เพื่อเข้าร่วมห้องเรียน
                    </p>
                    <p className="text-[11px] text-slate-400 break-all font-mono">
                      {getRealLiffUrl(classroom)}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(getRealLiffUrl(classroom));
                          setIsCopiedLiff(true);
                          setTimeout(() => setIsCopiedLiff(false), 2000);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center gap-1.5 shadow-xs cursor-pointer"
                      >
                        {isCopiedLiff ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopiedLiff ? 'คัดลอกลิงก์แล้ว' : 'คัดลอกลิงก์ LINE LIFF'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const message = `เข้าร่วมห้องเรียน Pudding: ${classroom.name}\n\nกดลิงก์นี้ใน LINE: ${getRealLiffUrl(
                            classroom
                          )}\nรหัสห้องเรียน: ${classroom.invite_code || ''}`;
                          navigator.clipboard.writeText(message);
                          setNotice('คัดลอกข้อความสำหรับส่งเข้า LINE เรียบร้อยแล้ว');
                        }}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 hover:bg-slate-100 cursor-pointer shadow-xs"
                      >
                        <Share2 className="w-3.5 h-3.5 text-amber-500" />
                        <span>คัดลอกข้อความเชิญ</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Direct Web Invite URL */}
                <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <span className="text-[10px] text-slate-400 block">ลิงก์เว็บตรง (สำหรับเบราว์เซอร์ทั่วไป):</span>
                    <span className="text-slate-700 dark:text-slate-300 font-mono text-[11px] truncate block">
                      {getWebInviteUrl(classroom)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(getWebInviteUrl(classroom));
                      setNotice('คัดลอกลิงก์เว็บตรงเรียบร้อย');
                    }}
                    className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
                    title="คัดลอกลิงก์เว็บ"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* TAB 3: Pending Students */}
            {inviteTab === 'pending' && (
              <div className="space-y-3">
                {(!classroom.pending_students || classroom.pending_students.length === 0) ? (
                  <div className="py-10 text-center space-y-2">
                    <UserCheck className="w-8 h-8 text-slate-300 mx-auto" />
                    <p className="text-xs font-bold text-slate-400">ไม่มีคำขอเข้าร่วมห้องเรียนที่รอการอนุมัติ</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    <div className="flex items-center justify-between pb-1">
                      <span className="text-xs font-bold text-slate-500">
                        รอการอนุมัติ {classroom.pending_students.length} คน
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          for (const p of classroom.pending_students || []) {
                            await dataService.admitStudentToClassroom(classroom.id, p.id);
                          }
                          setNotice('อนุมัติคำขอทั้งหมดเรียบร้อยแล้ว');
                          await loadWorkspace();
                        }}
                        className="text-xs font-black text-emerald-600 hover:underline cursor-pointer"
                      >
                        อนุมัติทั้งหมด (Admit All)
                      </button>
                    </div>

                    {classroom.pending_students.map((p) => (
                      <div
                        key={p.id}
                        className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <p className="font-bold text-slate-900 dark:text-white">
                            {p.first_name} {p.last_name}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono">
                            รหัส: {p.student_id || '-'} • {p.email || 'LINE Login'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleAdmitStudent(p.id)}
                            className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xs cursor-pointer"
                          >
                            อนุมัติ
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectStudent(p.id)}
                            className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs shadow-xs cursor-pointer"
                          >
                            ปฏิเสธ
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: CONNECT LINE BOT (Dashboard Logic Mirrored) */}
      {/* ============================================================== */}
      {showLineConnectModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in"
          onClick={() => setShowLineConnectModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 max-w-md w-full space-y-5 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold">
                  <MessageCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    เชื่อมต่อ LINE Official Bot เข้ากลุ่ม
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {classroom.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowLineConnectModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Connection Status Badge */}
            <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-xs">
              <span className="text-slate-500 font-bold shrink-0">สถานะการเชื่อมต่อ:</span>
              <span
                className={`font-black px-2.5 py-1 rounded-full text-[11px] text-right ${
                  lineConnection.status === 'connected'
                    ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                    : lineConnection.status === 'waiting'
                    ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 animate-pulse'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                {lineConnection.status === 'connected'
                  ? `🟢 เชื่อมแล้ว${lineConnection.groupName ? `: ${lineConnection.groupName}` : ''}`
                  : lineConnection.status === 'waiting'
                  ? '🟡 รอเพิ่มบอทเข้ากลุ่ม'
                  : '⚪ ยังไม่ได้เชื่อมต่อ'}
              </span>
            </div>

            {lineConnection.status === 'connected' ? (
              <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-800 dark:text-emerald-200 space-y-1">
                <p className="font-bold">กลุ่มนี้พร้อมรับแจ้งเตือนงานของห้องเรียน</p>
                <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">หากนำบอทออกจากกลุ่ม ห้องเรียนนี้จะยกเลิกการเชื่อมต่อโดยอัตโนมัติ</p>
              </div>
            ) : (
              <LineGroupConnectSteps status={lineConnection.status} botFriend={teacherBot.botFriend} addFriendUrl={teacherBot.addFriendUrl} />
            )}

            {/* Actions */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2">
              {lineConnection.status !== 'connected' ? (
                <button
                  type="button"
                  disabled={isLineLoading}
                  onClick={() => handleLineConnection('create')}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {isLineLoading ? 'กำลังเตรียม...' : lineConnection.status === 'waiting' ? 'เริ่มรอใหม่ (15 นาที)' : 'เชื่อม LINE Group'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isLineLoading}
                    onClick={() => handleLineConnection('test')}
                    className="flex-1 px-3 py-2.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-300 font-bold text-xs hover:bg-emerald-100 cursor-pointer"
                  >
                    ทดสอบส่งข้อความ
                  </button>
                  <button
                    type="button"
                    disabled={isLineLoading}
                    onClick={() => handleLineConnection('disconnect')}
                    className="px-3 py-2.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 font-bold text-xs hover:bg-rose-100 cursor-pointer"
                  >
                    ยกเลิกเชื่อมต่อ
                  </button>
                </>
              )}
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
  onEditStudent,
}: {
  classroom: Classroom;
  onOpenAddStudent: () => void;
  onRemoveStudent: (id: string) => void;
  onEditStudent: (student: User) => void;
}) {
  const [query, setQuery] = useState('');
  const students = classroom.students || [];
  const filtered = students.filter(
    (s) =>
      `${s.first_name} ${s.last_name}`.toLowerCase().includes(query.toLowerCase()) ||
      (s.student_id && s.student_id.includes(query))
  );

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-xs space-y-4">
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
                onClick={() => onEditStudent(student)}
                className="p-1 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title="แก้ไขชื่อ นามสกุล และรหัสนักเรียน"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
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
  update: (sessionId: string, studentId: string, status: AttendanceStatus) => void;
  action: (sessionId: string, a: 'close' | 'extend') => void;
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
  // Collapsible session state: which session is expanded
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    session?.id || sessions.find((s) => s.status === 'open')?.id || sessions[0]?.id || null
  );
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const [isEditingTitleActive, setIsEditingTitleActive] = useState(false);
  const [rosterSearch, setRosterSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'on_time' | 'late' | 'absent' | 'excused'>('all');

  // Keep expanded session in sync with parent session
  useEffect(() => {
    if (session?.id) {
      setExpandedSessionId(session.id);
      setEditingTitle(session.title);
      setIsEditingTitleActive(false);
    }
  }, [session?.id]);

  // Open sessions sit right under the controls/overview; finished ones follow
  // in class order (class 1, class 2, ...).
  const orderedSessions = useMemo(() => {
    const byStart = (a: AttendanceSession, b: AttendanceSession) =>
      new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
    return [
      ...sessions.filter((s) => s.status === 'open').sort((a, b) => byStart(b, a)),
      ...sessions.filter((s) => s.status !== 'open').sort(byStart),
    ];
  }, [sessions]);

  const toggleSession = (sessionId: string) => {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
    } else {
      setExpandedSessionId(sessionId);
      selectSession(sessionId);
    }
  };

  // Filter students for the currently selected session
  const filteredStudents = useMemo(() => {
    const list = classroom.students || [];
    return list.filter((student) => {
      const matchQuery =
        !rosterSearch.trim() ||
        `${student.first_name} ${student.last_name}`.toLowerCase().includes(rosterSearch.toLowerCase()) ||
        (student.student_id && student.student_id.includes(rosterSearch));

      if (!matchQuery) return false;
      if (statusFilter === 'all') return true;

      const record = records.find(
        (r) =>
          (student.id && r.student_id === student.id) ||
          (student.line_uid && r.student_id === student.line_uid) ||
          (student.student_id && r.student_id === student.student_id)
      );
      const studentStatus = record?.status || 'absent';
      return studentStatus === statusFilter;
    });
  }, [classroom.students, records, rosterSearch, statusFilter]);

  return (
    <section className="max-w-4xl mx-auto space-y-6">
      {/* 1. Top Header Bar with Open-Form Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-emerald-500" />
            <span>เช็คชื่อรายคาบ</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            จัดการคาบเรียน เช็คชื่อแบบเรียลไทม์ และสลับสถานะรายคนได้ตลอดเวลา
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {session && (
            <button
              type="button"
              onClick={exportCsv}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 text-slate-700 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>ส่งออก CSV</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs inline-flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{showCreateForm ? 'ปิดแบบฟอร์ม' : 'เปิดคาบเช็คชื่อใหม่'}</span>
          </button>
        </div>
      </div>

      {/* 3. Collapsible New Session Creation Form */}
      {showCreateForm && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-emerald-300 dark:border-emerald-800 p-5 shadow-md space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-emerald-600" />
              <span>กำหนดรายละเอียดคาบเช็คชื่อใหม่</span>
            </h3>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <label className="text-[11px] font-bold text-slate-400 block mb-1">ชื่อคาบเรียน *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="เช่น คาบที่ 1 ภาษาไทยเพื่อการสื่อสาร"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] font-bold text-slate-400 block mb-1">เวลาเริ่ม (เว้นว่าง = ทันที)</label>
              <DateTimeField
                value={startsAt}
                onChange={setStartsAt}
                presets="start"
                allowEmpty
                accent="emerald"
                emptyHint="เริ่มทันทีเมื่อกดสร้างคาบ"
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

          <div className="flex justify-end gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => {
                create();
                setShowCreateForm(false);
              }}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs inline-flex items-center gap-1.5 cursor-pointer shadow-md"
            >
              <Plus className="w-4 h-4" />
              <span>เริ่มเปิดเช็คชื่อและส่งแจ้งเตือน LINE</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. Statistics Summary Bento Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          ['on_time', 'ตรงเวลา', counts['on_time'] || 0, 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/60'],
          ['late', 'มาสาย', counts['late'] || 0, 'text-amber-700 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60'],
          ['absent', 'ขาด / ยังไม่เช็ค', counts['absent'] || 0, 'text-rose-700 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/60'],
          ['excused', 'ลา', counts['excused'] || 0, 'text-blue-700 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/60'],
        ].map(([key, label, count, colorCls]) => (
          <div key={key} className={`p-4 rounded-3xl border ${colorCls} shadow-xs`}>
            <p className="text-3xl font-black">{count}</p>
            <p className="text-xs font-bold mt-1 opacity-90">{label}</p>
          </div>
        ))}
      </div>

      {/* 5. Sessions Accordion List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <span>ประวัติและคาบเรียนทั้งหมด</span>
            <span className="text-slate-400 font-normal">({sessions.length} คาบ)</span>
          </h3>
          <span className="text-[11px] text-slate-400">คลิกที่คาบเพื่อ ย่อ/ขยาย ดูรายชื่อ</span>
        </div>

        {orderedSessions.map((item) => {
          const isExpanded = expandedSessionId === item.id;
          const isOpen = item.status === 'open';

          return (
            <div
              key={item.id}
              className={`rounded-3xl border transition-all overflow-hidden bg-white dark:bg-slate-900 ${
                isOpen
                  ? 'border-emerald-400 dark:border-emerald-700 shadow-lg shadow-emerald-500/15 ring-1 ring-emerald-400/40'
                  : isExpanded
                    ? 'border-emerald-400 dark:border-emerald-700 shadow-md'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
              }`}
            >
              {/* Session Header Card (Always visible, click to toggle collapse).
                  An open session gets the live-banner treatment. */}
              <div
                onClick={() => toggleSession(item.id)}
                className={`p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none ${
                  isOpen
                    ? 'bg-linear-to-r from-emerald-500/15 via-emerald-500/5 to-teal-500/15 border-l-4 border-emerald-500'
                    : ''
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1 sm:min-w-48">
                  {isOpen ? (
                    <span className="relative flex w-3 h-3 shrink-0">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                      <span className="relative inline-flex w-3 h-3 rounded-full bg-emerald-500" />
                    </span>
                  ) : (
                    <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full shrink-0 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      ⚪ ปิดแล้ว
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {isOpen && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-black text-[10px] shadow-xs">
                          กำลังเปิดรับเช็คชื่อ
                        </span>
                      )}
                      <h4 className="text-sm font-black text-slate-900 dark:text-white">{item.title}</h4>
                    </div>
                    <p className={`text-[11px] mt-0.5 ${isOpen ? 'text-emerald-800/80 dark:text-emerald-300/80' : 'text-slate-400'}`}>
                      {isOpen
                        ? `เริ่มเมื่อ ${new Date(item.starts_at).toLocaleTimeString('th-TH')} • ตรงเวลาภายใน ${item.on_time_until_minutes} นาที • สายได้ถึง ${item.late_until_minutes} นาที`
                        : `${new Date(item.starts_at).toLocaleString('th-TH')} • ตรงเวลา ${item.on_time_until_minutes}m / สาย ${item.late_until_minutes}m`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {isOpen && (
                    <>
                      <button
                        type="button"
                        onClick={() => action(item.id, 'extend')}
                        className="px-3 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-50 cursor-pointer shadow-xs"
                      >
                        +10 นาที
                      </button>
                      <button
                        type="button"
                        onClick={() => action(item.id, 'close')}
                        className="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold hover:bg-rose-100 cursor-pointer shadow-xs"
                      >
                        ปิดรับเช็คชื่อ
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => toggleSession(item.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer ${
                      isOpen
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                        : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <span>{isExpanded ? 'ย่อกลับ' : 'ดูรายชื่อ'}</span>
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>

                  {onDeleteSession && (
                    <button
                      type="button"
                      onClick={() => onDeleteSession(item.id)}
                      className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title="ลบคาบเช็คชื่อนี้"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded Detail & Interactive Student Roster */}
              {isExpanded && (
                <div className="p-4 sm:p-5 bg-slate-50/50 dark:bg-slate-850/50 border-t border-slate-200 dark:border-slate-800 space-y-4">
                  {/* Inline Edit Header & CSV Export */}
                  <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-xs">
                    <div className="flex-1 min-w-56 flex items-center gap-2">
                      <label className="text-xs font-bold text-slate-400 whitespace-nowrap">ชื่อคาบ:</label>
                      <input
                        value={editingTitle}
                        onChange={(e) => {
                          setEditingTitle(e.target.value);
                          setIsEditingTitleActive(true);
                        }}
                        className="flex-1 p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none bg-slate-50 dark:bg-slate-800"
                      />
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
                          บันทึกชื่อ
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={exportCsv}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 flex items-center gap-1 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>CSV คาบนี้</span>
                      </button>
                    </div>
                  </div>

                  {/* Student Search & Status Filter Tabs */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex items-center gap-1 flex-wrap">
                      {(
                        [
                          ['all', 'ทั้งหมด'],
                          ['on_time', 'ตรงเวลา 🟢'],
                          ['late', 'มาสาย 🟡'],
                          ['absent', 'ขาด 🔴'],
                          ['excused', 'ลา 🔵'],
                        ] as const
                      ).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setStatusFilter(key)}
                          className={`px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            statusFilter === key
                              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black shadow-xs'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:bg-slate-100'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="relative min-w-44 flex-1 sm:max-w-xs">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                      <input
                        value={rosterSearch}
                        onChange={(e) => setRosterSearch(e.target.value)}
                        placeholder="ค้นหาชื่อหรือรหัสนักเรียน..."
                        className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none bg-white dark:bg-slate-900"
                      />
                    </div>
                  </div>

                  {/* Student Roster Table/Cards */}
                  <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                    {filteredStudents.map((student) => {
                      const record = records.find(
                        (r) =>
                          (student.id && r.student_id === student.id) ||
                          (student.line_uid && r.student_id === student.line_uid) ||
                          (student.student_id && r.student_id === student.student_id)
                      );
                      const isSessionOpen = item.status === 'open';
                      const currentStatus = record?.status || (isSessionOpen ? 'idle' : 'absent');

                      return (
                        <div
                          key={student.id}
                          className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs shadow-xs"
                        >
                          <div className="min-w-44">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 dark:text-white block">
                                {student.first_name} {student.last_name}
                              </span>
                              {currentStatus === 'idle' && (
                                <span className="text-[9px] font-black px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                  รอเช็คชื่อ (IDLE) ⚪
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono">
                              รหัส: {student.student_id || '-'}
                              {record?.checked_at && ` • เช็คเมื่อ ${new Date(record.checked_at).toLocaleTimeString('th-TH')}`}
                            </span>
                          </div>

                          {/* 1-Click Status Switcher Buttons */}
                          <div className="grid grid-cols-4 gap-1 w-full sm:w-auto">
                            {(
                              [
                                ['on_time', 'ตรงเวลา', 'bg-emerald-100 text-emerald-800 border-emerald-300'],
                                ['late', 'มาสาย', 'bg-amber-100 text-amber-800 border-amber-300'],
                                ['excused', 'ลา', 'bg-blue-100 text-blue-800 border-blue-300'],
                                ['absent', 'ขาด', 'bg-rose-100 text-rose-800 border-rose-300'],
                              ] as const
                            ).map(([stKey, stLabel, activeCls]) => {
                              const isActive = currentStatus === stKey;
                              return (
                                <button
                                  key={stKey}
                                  type="button"
                                  onClick={() => update(item.id, student.id, stKey as AttendanceStatus)}
                                  className={`px-2.5 py-2 sm:py-1 rounded-lg text-[11px] sm:text-[10px] font-bold border transition-all cursor-pointer ${
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

                    {!filteredStudents.length && (
                      <p className="text-xs text-slate-400 text-center py-6">
                        ไม่พบรายชื่อนักเรียนที่ตรงกับเงื่อนไข
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {!sessions.length && (
          <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 text-xs text-slate-400 space-y-2">
            <CalendarCheck className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="font-bold">ยังไม่มีประวัติคาบเช็คชื่อ</p>
            <p className="text-[11px]">กดปุ่ม &quot;เปิดคาบเช็คชื่อใหม่&quot; ด้านบนเพื่อเริ่มต้นคาบแรก</p>
          </div>
        )}
      </div>
    </section>
  );
}

