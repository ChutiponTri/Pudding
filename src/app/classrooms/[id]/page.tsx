'use client';

import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { dataService } from '@/lib/supabase/dataService';
import { cacheVersion, cachedCall, patchCache, readCache, watchClassrooms, writeCache } from '@/lib/cache/sessionCache';
import { LineGroupConnectSteps } from '@/components/LineGroupConnectSteps';
import { DateTimeField } from '@/components/DateTimeField';
import { EditStudentModal } from '@/components/EditStudentModal';
import { AssignmentStatusDialog } from '@/components/AssignmentStatusDialog';
import { AssignmentProgressCard } from '@/components/AssignmentProgressCard';
import { gradingCounts, isGraded, isStudentSubmission, needsGrading, type GradingCounts } from '@/lib/utils/gradingStatus';
import { formatDateTime } from '@/lib/utils/datetime';
import { roomLabel } from '@/lib/utils/classroomLabel';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { Assignment, Classroom, ClassroomTeacher, Course, Submission, User } from '@/types/database';
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
  GripVertical,
  Layers,
  Megaphone,
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
  UserX,
  Users,
  X,
  Loader2,
  MessageCircle,
} from 'lucide-react';


type Tab = 'overview' | 'classwork' | 'attendance' | 'people' | 'grades';
type AttendanceStatus = 'on_time' | 'late' | 'absent' | 'excused';
type AttendanceRecord = {
  id: string;
  session_id: string;
  student_id: string;
  status: AttendanceStatus;
  checked_at?: string | null;
  /** Classmate whose phone checked this student in (borrowed phone). */
  checked_in_by?: string | null;
};
type AttendanceSession = {
  id: string;
  classroom_id?: string;
  title: string;
  starts_at: string;
  on_time_until_minutes: number;
  late_until_minutes: number;
  status: 'scheduled' | 'open' | 'closed';
  closed_at?: string | null;
};
type RosterStudent = { id: string; line_uid?: string; student_id?: string };

/** A session's records keyed by student_id, so roster lookups are O(1). */
const indexRecords = (records: AttendanceRecord[]) => new Map(records.map((record) => [record.student_id, record]));

/** Roster entries may carry users.id, the LINE uid or the school number. */
const findStudentRecord = (index: Map<string, AttendanceRecord>, student: RosterStudent) =>
  index.get(student.id) ||
  (student.line_uid ? index.get(student.line_uid) : undefined) ||
  (student.student_id ? index.get(student.student_id) : undefined);

/** Saves rows as a UTF-8 CSV (with BOM so Excel reads Thai correctly). */
const downloadCsv = (filename: string, rows: Array<Array<string | number>>) => {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const csvDateStamp = () => new Date().toLocaleDateString('th-TH').replaceAll('/', '-');

const sameInstitution = (a?: string, b?: string) =>
  (a || '').trim().replace(/\s+/g, ' ').toLowerCase() === (b || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Submissions may reference the student by users.id, LINE uid or school number. */
const findStudentSubmission = (submissions: Submission[], assignmentId: string, student: User) =>
  submissions.find((s) => s.assignment_id === assignmentId && isStudentSubmission(s, student));

/** A record replaces any earlier one for the same student in the same session. */
const upsertRecord = (records: AttendanceRecord[], record: AttendanceRecord) => [
  ...records.filter((r) => !(r.session_id === record.session_id && r.student_id === record.student_id)),
  record,
];
type TimelineItem = {
  id: string;
  rawId?: string;
  isPost?: boolean;
  /** Set when the item stands for an assignment/quiz; deleting it deletes the assignment. */
  assignmentId?: string;
  /** Publish time still ahead: only the teacher sees this item for now. */
  scheduledAt?: string;
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
  metadata?: { assignmentId?: string; groupName?: string; publishAt?: string; sessionId?: string };
};

type ClassworkFilter = 'all' | 'pending' | 'done';
const CLASSWORK_FILTERS: Array<{ id: ClassworkFilter; label: string; active: string }> = [
  { id: 'all', label: 'ทั้งหมด', active: 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' },
  { id: 'pending', label: 'ต้องตรวจ', active: 'bg-amber-500 text-slate-950' },
  { id: 'done', label: 'ตรวจครบแล้ว', active: 'bg-emerald-600 text-white' },
];
// Same split as the grading hub and the dashboard course cards.
const classworkFilterOf = (c: GradingCounts): Exclude<ClassworkFilter, 'all'> => (c.pending > 0 ? 'pending' : 'done');

type AttendanceResult = { sessions?: AttendanceSession[]; session?: AttendanceSession | null; records?: AttendanceRecord[] };

/** Everything the workspace shows on open, cached for the session (see loadWorkspace). */
type WorkspaceSnapshot = {
  classroom: Classroom;
  assignments: Assignment[];
  posts: Post[];
  attendance: AttendanceResult;
  submissions: Submission[];
  submissionsFetchedAt: number;
};

// shortLabel keeps all five tabs on one row of the mobile bottom bar.
const tabs: Array<{ id: Tab; label: string; shortLabel: string; icon: typeof BookOpen }> = [
  { id: 'overview', label: 'ภาพรวม', shortLabel: 'ภาพรวม', icon: ClipboardList },
  { id: 'classwork', label: 'งานและเนื้อหา', shortLabel: 'งาน', icon: BookOpen },
  { id: 'attendance', label: 'เช็คชื่อ', shortLabel: 'เช็คชื่อ', icon: CalendarCheck },
  { id: 'people', label: 'ผู้สอนและผู้เรียน', shortLabel: 'สมาชิก', icon: Users },
  { id: 'grades', label: 'คะแนน', shortLabel: 'คะแนน', icon: FileText },
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
  const search = useSearchParams();
  const classroomId = params.id;

  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  // Every session's records are held client-side, so picking another session
  // is a local filter instead of a request.
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [allRecords, setAllRecords] = useState<AttendanceRecord[]>([]);
  const session = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) || null,
    [sessions, selectedSessionId]
  );
  const records = useMemo(
    () => (selectedSessionId ? allRecords.filter((r) => r.session_id === selectedSessionId) : []),
    [allRecords, selectedSessionId]
  );
  const recordIndex = useMemo(() => indexRecords(records), [records]);

  const [tab, setTab] = useState<Tab>((search.get('tab') as Tab) || 'overview');
  // +1 when moving to a tab on the right, -1 to the left; drives the slide direction.
  const [tabDirection, setTabDirection] = useState<1 | -1>(1);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [tabIndicator, setTabIndicator] = useState<{ left: number; width: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [gradesLoading, setGradesLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [teacherInstitution, setTeacherInstitution] = useState('');
  const [course, setCourse] = useState<Course | null>(null);
  const [statusAssignment, setStatusAssignment] = useState<Assignment | null>(null);

  // Notices clear themselves; the X button still closes one early.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const courseId = classroom?.course_id;
  useEffect(() => {
    if (!courseId) return;
    const load = () => dataService.getCourseById(courseId);
    (user?.id ? cachedCall(`course:${courseId}`, user.id, load) : load()).then(setCourse).catch(() => setCourse(null));
  }, [courseId, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    cachedCall('myProfile', user.id, () => dataService.getUserById(user.id))
      .then((profile) => setTeacherInstitution(profile?.institution?.trim() || ''));
  }, [user?.id]);

  // Bumped by every local attendance change; a refresh that started before
  // one is dropped so it can't overwrite the optimistic state.
  const attendanceVersionRef = useRef(0);

  // Overview Facebook-style post form state
  const [isPostExpanded, setIsPostExpanded] = useState(false);
  const [postActivityType, setPostActivityType] = useState<TimelineItem['type']>('announcement');
  const [postBody, setPostBody] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  // Edit Post Modal State
  const [editingPost, setEditingPost] = useState<Post | null>(null);
  const [editPostBody, setEditPostBody] = useState('');
  const [isUpdatingPost, setIsUpdatingPost] = useState(false);

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
  // Groups created here but still empty. A group is stored only as assignments'
  // group_name, so it is saved once work is dropped into it.
  const [customGroups, setCustomGroups] = useState<string[]>([]);
  const [draggingAssignmentId, setDraggingAssignmentId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  // Where a dragged card would land: before the card at `index` in `group` (index = length → at the end).
  const [dropTarget, setDropTarget] = useState<{ group: string; index: number } | null>(null);

  // People Tab: Add Teacher & Add Student Modals
  const [showAddTeacherModal, setShowAddTeacherModal] = useState(false);
  const [newTeacherRole, setNewTeacherRole] = useState<'primary' | 'assistant' | 'researcher'>('assistant');
  const [teacherSearchQuery, setTeacherSearchQuery] = useState('');
  const [teacherSearchResults, setTeacherSearchResults] = useState<User[]>([]);
  const [isSearchingTeachers, setIsSearchingTeachers] = useState(false);

  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  // Accept all / reject all join requests: asks in its own box before acting.
  const [bulkPendingAction, setBulkPendingAction] = useState<'admit' | 'reject' | null>(null);
  const [bulkPendingBusy, setBulkPendingBusy] = useState(false);
  const [inviteTab, setInviteTab] = useState<'search' | 'link' | 'pending'>('search');
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentSearchResults, setStudentSearchResults] = useState<User[]>([]);
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
    return `https://liff.line.me/${liffId}?code=${cls.invite_code || ''}`;
  };

  const getWebInviteUrl = (cls?: Classroom | null) => {
    if (!cls) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/liff?code=${cls.invite_code || ''}`;
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
    } catch (error) {
      setNotice((error as { message?: string } | null)?.message || 'ไม่สามารถเชื่อมต่อ LINE Group ได้');
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
  /**
   * useCache: show this session's copy of the workspace at once and refetch
   * only if something may have changed (first open; reloads after a change
   * always refetch).
   */
  const loadWorkspace = async ({ useCache = false }: { useCache?: boolean } = {}) => {
    if (!classroomId) return;
    const teacherId = user?.id;
    const cacheKey = `classroomWorkspace:${classroomId}`;
    const hit = useCache && teacherId ? readCache<WorkspaceSnapshot>(cacheKey, teacherId) : null;
    if (hit) {
      applySnapshot(hit.value);
      setLoading(false);
      if (hit.fresh) {
        // Opening the grades tab right away does not refetch these.
        submissionsFetchedAtRef.current = hit.value.submissionsFetchedAt;
        return;
      }
    } else {
      setLoading(true);
    }
    const startedAt = cacheVersion();
    try {
      // Fire all requests concurrently in parallel
      const [current, classAssignments, postsRes, attRes] = await Promise.all([
        dataService.getClassroomById(classroomId),
        dataService.getAssignmentsByClassroomId(classroomId),
        fetch(`/api/classrooms/posts?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' }),
        fetch(`/api/attendance?classroomId=${encodeURIComponent(classroomId)}&allRecords=1`, { cache: 'no-store' }),
      ]);

      setClassroom(current);
      setAssignments(classAssignments);
      if (current) watchClassrooms([current.id]);

      let nextPosts: Post[] | null = null;
      if (postsRes.ok) {
        const postsJson = await postsRes.json();
        nextPosts = postsJson.posts || [];
        setPosts(nextPosts!);
      }

      const attendance: AttendanceResult | null = attRes.ok ? await attRes.json() : null;
      if (attendance) applyAttendance(attendance);

      // Concurrently fetch submissions for all assignments to show submit counts;
      // the snapshot is cached once they are in (only when every part loaded).
      const submissionsLoaded = classAssignments.length > 0 ? refreshSubmissions(classAssignments) : Promise.resolve([]);
      if (teacherId && current && nextPosts && attendance) {
        const posts = nextPosts;
        submissionsLoaded.then((subs) => {
          if (!subs) return;
          const snapshot = {
            classroom: current,
            assignments: classAssignments,
            posts,
            attendance,
            submissions: subs,
            submissionsFetchedAt: submissionsFetchedAtRef.current,
          };
          writeCache<WorkspaceSnapshot>(cacheKey, teacherId, snapshot, startedAt);
        });
      }
    } catch (error) {
      console.error('Failed to load classroom workspace:', error);
      setNotice('โหลดข้อมูลห้องเรียนไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const applySnapshot = (snapshot: WorkspaceSnapshot) => {
    setClassroom(snapshot.classroom);
    setAssignments(snapshot.assignments);
    setPosts(snapshot.posts);
    applyAttendance(snapshot.attendance);
    setSubmissions(snapshot.submissions);
    watchClassrooms([snapshot.classroom.id]);
  };

  const applyAttendance = (result: AttendanceResult) => {
    const nextSessions = result.sessions || [];
    setSessions(nextSessions);
    setAllRecords(result.records || []);
    // Keep the teacher's selection; fall back to the newest session only when
    // nothing is selected or the selected one was deleted.
    setSelectedSessionId((current) =>
      current && nextSessions.some((s) => s.id === current) ? current : result.session?.id || nextSessions[0]?.id || null
    );
  };

  // Background sync of every session and record in one request.
  const loadAttendance = async () => {
    const version = attendanceVersionRef.current;
    try {
      const response = await fetch(`/api/attendance?classroomId=${encodeURIComponent(classroomId)}&allRecords=1`, { cache: 'no-store' });
      if (!response.ok || version !== attendanceVersionRef.current) return;
      const result = await response.json();
      if (version !== attendanceVersionRef.current) return;
      applyAttendance(result);
    } catch (e) {
      console.error(e);
    }
  };

  const patchSession = (sessionId: string, fields: Partial<AttendanceSession>) => {
    attendanceVersionRef.current++;
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, ...fields } : s)));
  };

  // Submissions are shared by the classwork and grades tabs; skip a refetch
  // when the last one is only a few seconds old.
  const submissionsFetchedAtRef = useRef(0);
  const refreshSubmissions = (list: Assignment[], maxAgeMs = 0) => {
    if (!list.length || Date.now() - submissionsFetchedAtRef.current < maxAgeMs) return Promise.resolve(undefined);
    submissionsFetchedAtRef.current = Date.now();
    return dataService.getSubmissionsByAssignmentIds(list.map((item) => item.id))
      .then((subs) => {
        setSubmissions(subs);
        return subs;
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    // Shows this session's cached copy at once on purpose, then fetches if it may be stale.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadWorkspace({ useCache: true });
  }, [user?.id, classroomId]);

  // Keep the cached copy in step with what this page shows (check-ins, status
  // switches, new submissions, edits), so coming back starts from the latest
  // data instead of the first load. Freshness is unchanged: a stale copy still refetches.
  useEffect(() => {
    if (!user?.id || !classroom || classroom.id !== classroomId) return;
    patchCache<WorkspaceSnapshot>(`classroomWorkspace:${classroomId}`, user.id, {
      classroom,
      assignments,
      posts,
      attendance: { sessions, records: allRecords, session: sessions.find((s) => s.id === selectedSessionId) || null },
      submissions,
      submissionsFetchedAt: submissionsFetchedAtRef.current,
    });
  }, [user?.id, classroomId, classroom, assignments, posts, sessions, allRecords, selectedSessionId, submissions]);

  // Fetch Grades when switching to Grades tab (unless they were just loaded)
  useEffect(() => {
    if (tab !== 'grades' || !assignments.length) return;
    if (Date.now() - submissionsFetchedAtRef.current < 10000) return;
    setGradesLoading(true);
    refreshSubmissions(assignments).finally(() => setGradesLoading(false));
  }, [tab, assignments]);

  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // Live classroom: the server broadcasts a small signal whenever a student
  // submits, joins, checks in, or the timeline changes, and the page refetches
  // just that part once. Polling runs only while the realtime socket is down.
  const assignmentsRef = useRef(assignments);
  const tabRef = useRef(tab);
  useEffect(() => {
    assignmentsRef.current = assignments;
    tabRef.current = tab;
  }, [assignments, tab]);
  useEffect(() => {
    if (!classroomId) return;
    const timers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};
    const soon = (key: string, run: () => void) => {
      clearTimeout(timers[key]);
      timers[key] = setTimeout(run, 400);
    };
    let fallback: ReturnType<typeof setInterval> | undefined;
    let live = false;

    const refreshRoster = () =>
      soon('roster', () =>
        dataService.getClassroomById(classroomId).then((current) => current && setClassroom(current)).catch(() => {})
      );
    const refreshAttendance = () => soon('attendance', () => loadAttendance());
    const refreshSubmissionsSoon = () => soon('submissions', () => refreshSubmissions(assignmentsRef.current));
    const refreshTimeline = () =>
      soon('timeline', async () => {
        try {
          const [list, postsRes] = await Promise.all([
            dataService.getAssignmentsByClassroomId(classroomId),
            fetch(`/api/classrooms/posts?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' }),
          ]);
          setAssignments(list);
          if (postsRes.ok) setPosts((await postsRes.json()).posts || []);
        } catch {}
      });

    const poll = () => {
      if (live || document.visibilityState !== 'visible') return;
      refreshRoster();
      if (sessionsRef.current.some((s) => s.status === 'open')) refreshAttendance();
      if (tabRef.current === 'grades' || tabRef.current === 'classwork') refreshSubmissions(assignmentsRef.current, 25000);
    };
    const onVisible = () => {
      // Signals sent while the tab was hidden may have been missed.
      if (document.visibilityState !== 'visible') return;
      refreshRoster();
      refreshAttendance();
      refreshSubmissions(assignmentsRef.current, 30000);
    };

    const unsubscribe = dataService.subscribeToClassroomSignals(
      [classroomId],
      (_id, signal) => {
        if (signal?.type === 'submission') refreshSubmissionsSoon();
        else if (signal?.type === 'roster') refreshRoster();
        else if (signal?.type === 'attendance') refreshAttendance();
        else refreshTimeline();
      },
      (isLive) => {
        live = isLive;
        if (isLive) {
          clearInterval(fallback);
          fallback = undefined;
        } else if (!fallback) {
          fallback = setInterval(poll, 15000);
        }
      }
    );

    // Same-browser events (e.g. a LIFF tab next to this one) refresh instantly.
    const onAttendanceChecked = () => refreshAttendance();
    window.addEventListener('pudding-submission-created', refreshSubmissionsSoon);
    window.addEventListener('pudding-attendance-checked', onAttendanceChecked);
    document.addEventListener('visibilitychange', onVisible);
    let bc: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      bc = new BroadcastChannel('pudding-realtime');
      bc.onmessage = (event) => {
        if (event.data?.type === 'attendance_checked') onAttendanceChecked();
        if (event.data?.type === 'submission_created') refreshSubmissionsSoon();
      };
    }

    return () => {
      unsubscribe();
      Object.values(timers).forEach((t) => clearTimeout(t));
      clearInterval(fallback);
      window.removeEventListener('pudding-submission-created', refreshSubmissionsSoon);
      window.removeEventListener('pudding-attendance-checked', onAttendanceChecked);
      document.removeEventListener('visibilitychange', onVisible);
      bc?.close();
    };
  }, [classroomId]);

  // Re-render when the next scheduled assignment goes live, so its badge and
  // timeline entry flip from "scheduled" without a refresh.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const now = Date.now();
    const next = assignments
      .map((a) => (a.publish_at ? new Date(a.publish_at).getTime() : NaN))
      .filter((t) => t > now)
      .sort((a, b) => a - b)[0];
    if (!next) return;
    const timer = setTimeout(() => setNowMs(Date.now()), Math.min(next - now + 500, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [assignments, nowMs]);

  // ----------------------------------------------------
  // UNIFIED TIMELINE BUILDER (Feed of Announcements, Work, Exams, Attendance)
  // ----------------------------------------------------
  const timeline = useMemo<TimelineItem[]>(() => {
    const list: TimelineItem[] = [];
    const seenAssignmentIds = new Set<string>();
    const assignmentIds = new Set(assignments.map((a) => a.id));
    const seenSessionIds = new Set<string>();
    const seenContentKeys = new Set<string>();

    // 1. Process posts first
    for (const post of posts) {
      const aId = post.metadata?.assignmentId;
      const sId = post.metadata?.sessionId;

      if (aId) {
        // The assignment was deleted: drop its leftover announcement too.
        if (!assignmentIds.has(aId)) continue;
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
        assignmentId: aId,
        scheduledAt: post.metadata?.publishAt && new Date(post.metadata.publishAt).getTime() > nowMs ? post.metadata.publishAt : undefined,
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
        assignmentId: item.id,
        scheduledAt: item.publish_at && new Date(item.publish_at).getTime() > nowMs ? item.publish_at : undefined,
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
  }, [posts, assignments, sessions, nowMs]);


  // Existing group names across assignments
  const existingGroupNames = useMemo(() => {
    const set = new Set<string>();
    assignments.forEach((a) => {
      if (a.group_name && a.group_name.trim()) set.add(a.group_name.trim());
    });
    customGroups.forEach((name) => set.add(name));
    return Array.from(set);
  }, [assignments, customGroups]);

  // Grade book columns: assignments and quizzes in the order they were given.
  const gradeColumns = useMemo(
    () =>
      [...assignments].sort(
        (a, b) => new Date(a.created_at || a.due_date).getTime() - new Date(b.created_at || b.due_date).getTime()
      ),
    [assignments]
  );

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
  const handleDeleteAssignment = async (assignmentId: string) => {
    if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบงาน/ข้อสอบนี้? (คะแนนและข้อสอบทั้งหมดจะถูกลบออก)')) return;
    try {
      await dataService.deleteAssignment(assignmentId);
      setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
      setSubmissions((prev) => prev.filter((s) => s.assignment_id !== assignmentId));
      // The server removed its timeline announcement(s) too.
      setPosts((prev) => prev.filter((p) => p.metadata?.assignmentId !== assignmentId));
      setNotice('ลบงาน/ข้อสอบเรียบร้อยแล้ว');
    } catch {
      setNotice('เกิดข้อผิดพลาดในการลบงาน/ข้อสอบ');
    }
  };

  // The class reached the topic before the scheduled time: release it now.
  const handlePublishAssignmentNow = async (assignment: Assignment) => {
    const kind = assignment.is_exam ? 'ข้อสอบ' : 'งาน';
    if (!confirm(`เผยแพร่${kind} "${assignment.title}" ตอนนี้เลยหรือไม่?\nนักเรียนจะเห็นและเริ่มทำได้ทันที และจะได้รับแจ้งเตือนใน LINE`)) return;
    try {
      const updated = await dataService.publishAssignmentNow(assignment.id);
      const nowIso = updated?.publish_at || new Date().toISOString();
      setAssignments((prev) => prev.map((a) => (a.id === assignment.id ? { ...a, ...(updated || {}), publish_at: nowIso } : a)));
      setPosts((prev) =>
        prev.map((p) =>
          p.metadata?.assignmentId === assignment.id && p.metadata?.publishAt
            ? { ...p, created_at: nowIso, metadata: { ...p.metadata, publishAt: nowIso } }
            : p
        )
      );
      setNotice(`เผยแพร่${kind} "${assignment.title}" แล้ว นักเรียนเริ่มทำได้ทันที`);
    } catch (err) {
      setNotice(err instanceof Error && err.message ? err.message : 'เผยแพร่งานไม่สำเร็จ');
    }
  };

  const handleAddGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    setCustomGroups((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setShowAddGroupModal(false);
    setNewGroupName('');
    setNotice(`เพิ่มหมวดหมู่ "${name}" แล้ว ลากงานมาวางในกลุ่มนี้เพื่อบันทึก`);
  };

  // Classwork progress per assignment (same counts as the grading hub).
  const [classworkFilter, setClassworkFilter] = useState<ClassworkFilter>('all');
  const classworkCounts = useMemo(() => {
    const bySubmission = new Map<string, Submission[]>();
    for (const s of submissions) bySubmission.set(s.assignment_id, [...(bySubmission.get(s.assignment_id) || []), s]);
    const total = classroom?.students?.length || 0;
    return new Map(assignments.map((a) => [a.id, gradingCounts(bySubmission.get(a.id) || [], total, a.is_exam)]));
  }, [assignments, submissions, classroom?.students?.length]);
  const classworkSummary = useMemo(() => {
    const all = [...classworkCounts.values()];
    return {
      pending: all.reduce((sum, c) => sum + c.pending, 0),
      graded: all.reduce((sum, c) => sum + c.graded, 0),
      handedIn: all.reduce((sum, c) => sum + c.handedIn, 0),
      done: all.filter((c) => classworkFilterOf(c) === 'done').length,
    };
  }, [classworkCounts]);
  const classworkFilterCounts = useMemo(() => {
    const counts: Record<ClassworkFilter, number> = { all: classworkCounts.size, pending: 0, done: 0 };
    classworkCounts.forEach((c) => counts[classworkFilterOf(c)]++);
    return counts;
  }, [classworkCounts]);
  const matchesClassworkFilter = (assignmentId: string) => {
    if (classworkFilter === 'all') return true;
    const c = classworkCounts.get(assignmentId);
    return !!c && classworkFilterOf(c) === classworkFilter;
  };

  const groupKeyOf = (item: Assignment) => item.group_name || (item.is_exam ? 'ข้อสอบ' : 'งานทั่วไป');
  // Dragged order first (new work without a position on top), then newest first.
  const byClassworkOrder = (a: Assignment, b: Assignment) =>
    (a.sort_order ?? -1) - (b.sort_order ?? -1) ||
    new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();

  /**
   * A card dropped into `group` at `index` (counted in that group's list as
   * shown, including the dragged card if it is already there). Reorders the
   * group and, when it came from another group, moves it; the default groups
   * (งานทั่วไป / ข้อสอบ) mean "no group name".
   */
  const handleDropAssignment = async (assignmentId: string, group: string, index: number) => {
    const item = assignments.find((a) => a.id === assignmentId);
    if (!item) return;
    const fromGroup = groupKeyOf(item);
    const list = assignments.filter((a) => groupKeyOf(a) === group).sort(byClassworkOrder);
    const from = list.findIndex((a) => a.id === assignmentId);
    let target = Math.max(0, Math.min(index, list.length));
    if (from !== -1) {
      if (target === from || target === from + 1) return; // dropped where it already is
      list.splice(from, 1);
      if (from < target) target -= 1;
    }
    list.splice(target, 0, item);

    const fallback = item.is_exam ? 'ข้อสอบ' : 'งานทั่วไป';
    const newGroupName = fromGroup === group ? undefined : group === fallback ? null : group;
    const updates = list.map((a, position) => ({
      id: a.id,
      sort_order: position,
      ...(a.id === assignmentId && newGroupName !== undefined ? { group_name: newGroupName } : {}),
    }));
    const previous = assignments;
    const byId = new Map(updates.map((u) => [u.id, u]));
    setAssignments((prev) =>
      prev.map((a) => {
        const u = byId.get(a.id);
        if (!u) return a;
        return { ...a, sort_order: u.sort_order, ...('group_name' in u ? { group_name: u.group_name || undefined } : {}) };
      })
    );
    try {
      await dataService.reorderAssignments(classroomId, updates);
      if (newGroupName !== undefined) setNotice(`ย้าย “${item.title}” ไปยังหมวดหมู่ "${group}" เรียบร้อย`);
    } catch (error) {
      setAssignments(previous);
      setNotice(error instanceof Error && error.message ? error.message : 'บันทึกลำดับงานไม่สำเร็จ');
    }
  };

  const handleUpdateAssignmentGroup = async (assignmentId: string, newGroup: string) => {
    const clean = newGroup.trim();
    try {
      // '' (not undefined, which JSON drops) so moving back to the default group really clears it.
      await dataService.updateAssignment(assignmentId, { group_name: clean });
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
        patchSession(sessionId, {
          title: newTitle,
          ...(newStatus ? { status: newStatus, closed_at: newStatus === 'closed' ? new Date().toISOString() : null } : {}),
          ...(startsAt ? { starts_at: startsAt } : {}),
          ...(onTime !== undefined ? { on_time_until_minutes: onTime } : {}),
          ...(late !== undefined ? { late_until_minutes: late } : {}),
        });
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
        attendanceVersionRef.current++;
        const remaining = sessions.filter((s) => s.id !== sessionId);
        setSessions(remaining);
        setAllRecords((prev) => prev.filter((r) => r.session_id !== sessionId));
        if (selectedSessionId === sessionId) setSelectedSessionId(remaining[0]?.id || null);
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
      // The response is the full session row, so show and select it without a refetch.
      attendanceVersionRef.current++;
      setSessions((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      setSelectedSessionId(created.id);
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
  // The status flips immediately; the server's row replaces it (or the old
  // record comes back) once the request settles.
  const updateAttendanceRecord = async (sessionId: string, studentId: string, status: AttendanceStatus) => {
    const student = classroom?.students?.find((s) => s.id === studentId);
    const sessionIndex = indexRecords(allRecords.filter((r) => r.session_id === sessionId));
    const previous = student ? findStudentRecord(sessionIndex, student) : sessionIndex.get(studentId);
    const optimistic: AttendanceRecord = {
      id: previous?.id || `pending-${sessionId}-${studentId}`,
      session_id: sessionId,
      student_id: previous?.student_id || studentId,
      status,
      checked_at: status === 'absent' ? null : new Date().toISOString(),
    };
    attendanceVersionRef.current++;
    setAllRecords((prev) => upsertRecord(prev, optimistic));
    const rollback = () => {
      attendanceVersionRef.current++;
      setAllRecords((prev) => {
        const without = prev.filter((r) => !(r.session_id === sessionId && r.student_id === optimistic.student_id));
        return previous ? [...without, previous] : without;
      });
      setNotice('บันทึกสถานะการเข้าเรียนไม่สำเร็จ กรุณาลองใหม่');
    };
    try {
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'record', classroomId, sessionId, studentId, status }),
      });
      if (!response.ok) return rollback();
      const { record } = (await response.json()) as { record: AttendanceRecord };
      attendanceVersionRef.current++;
      // The server may store the canonical users.id instead of the roster id.
      setAllRecords((prev) =>
        upsertRecord(
          prev.filter((r) => !(r.session_id === sessionId && r.student_id === optimistic.student_id)),
          record
        )
      );
    } catch {
      rollback();
    }
  };

  const sessionAction = async (sessionId: string, action: 'close' | 'extend') => {
    const target = sessions.find((s) => s.id === sessionId);
    if (!target) return;
    const fields: Partial<AttendanceSession> =
      action === 'extend'
        ? { late_until_minutes: target.late_until_minutes + 10, status: 'open', closed_at: null }
        : { status: 'closed', closed_at: new Date().toISOString() };
    patchSession(sessionId, fields);
    try {
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          classroomId,
          sessionId,
          ...(action === 'extend' ? { lateUntilMinutes: fields.late_until_minutes } : {}),
        }),
      });
      if (!response.ok) throw new Error();
    } catch {
      patchSession(sessionId, target);
      setNotice(action === 'close' ? 'ปิดรับเช็คชื่อไม่สำเร็จ' : 'ขยายเวลาไม่สำเร็จ');
    }
  };

  // Export one session's attendance as CSV
  const exportAttendance = () => {
    if (!classroom || !session) return;
    downloadCsv(`attendance-${classroom.name}-${session.title}-${csvDateStamp()}.csv`, [
      ['นักเรียน', 'รหัสนักเรียน', 'สถานะ', 'เวลาที่เช็ค'],
      ...(classroom.students || []).map((student) => {
        const record = findStudentRecord(recordIndex, student);
        return [
          `${student.first_name} ${student.last_name}`,
          student.student_id || '',
          statusLabels[record?.status || 'absent'],
          record?.checked_at ? new Date(record.checked_at).toLocaleTimeString('th-TH') : '-',
        ];
      }),
    ]);
  };

  // Export every session: one row per student, one column per session (oldest first)
  const exportAllAttendance = () => {
    if (!classroom || !sessions.length) return;
    const ordered = [...sessions].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    const indexes = ordered.map((s) => indexRecords(allRecords.filter((r) => r.session_id === s.id)));
    downloadCsv(`attendance-all-${classroom.name}-${csvDateStamp()}.csv`, [
      ['ชื่อ-นามสกุล', 'รหัสนักเรียน', ...ordered.map((s) => `${s.title} (${formatDateTime(s.starts_at, 'th')})`), ...Object.values(statusLabels)],
      ...(classroom.students || []).map((student) => {
        const statuses = indexes.map((index) => findStudentRecord(index, student)?.status || 'absent');
        const totals = (Object.keys(statusLabels) as AttendanceStatus[]).map((key) => statuses.filter((s) => s === key).length);
        return [
          `${student.first_name} ${student.last_name}`,
          student.student_id || '',
          ...statuses.map((status) => statusLabels[status]),
          ...totals,
        ];
      }),
    ]);
  };

  // Export the grade book: one row per student, one column per assignment/quiz (in the order given)
  const exportGrades = () => {
    if (!classroom) return;
    downloadCsv(`grades-${classroom.name}-${csvDateStamp()}.csv`, [
      ['ชื่อ-นามสกุล', 'รหัสนักเรียน', ...gradeColumns.map((item) => `${item.is_exam ? '[ข้อสอบ] ' : '[งาน] '}${item.title} (เต็ม ${item.total_points || 20})`), 'คะแนนรวม'],
      ...(classroom.students || []).map((student) => {
        const scores = gradeColumns.map((item) => {
          const sub = findStudentSubmission(submissions, item.id, student);
          return sub && isGraded(sub) ? sub.total_score ?? '-' : sub && needsGrading(sub) ? 'รอตรวจ' : '-';
        });
        const total = scores.reduce<number>((sum, score) => sum + (typeof score === 'number' ? score : 0), 0);
        return [`${student.first_name} ${student.last_name}`, student.student_id || '', ...scores, total];
      }),
    ]);
  };

  // ----------------------------------------------------
  // PEOPLE TAB: TEACHERS & STUDENTS MANAGEMENT
  // ----------------------------------------------------
  const teachersList: ClassroomTeacher[] = useMemo(() => {
    if (!classroom) return [];
    return classroom.teachers || [];
  }, [classroom]);

  /** True when both schools are known and differ from the teacher's. */
  const isOtherSchool = (institution?: string) =>
    !!teacherInstitution && !!institution?.trim() && !sameInstitution(institution, teacherInstitution);

  /** Teachers may still admit a student from another school, but only after confirming. */
  const confirmOtherSchool = (students: Array<Pick<User, 'first_name' | 'last_name' | 'institution'>>) => {
    const others = students.filter((student) => isOtherSchool(student.institution));
    if (!others.length) return true;
    const lines = others.map((student) => `• ${student.first_name} ${student.last_name} — ${student.institution}`).join('\n');
    return confirm(
      `⚠️ นักเรียนต่อไปนี้ระบุโรงเรียนต่างจากโรงเรียนของคุณครู (${teacherInstitution})\n\n${lines}\n\n` +
        'หากนักเรียนกรอกชื่อโรงเรียนผิด คุณครูสามารถแก้ไขได้ภายหลังที่แท็บ "ผู้สอนและผู้เรียน"\n\nยืนยันรับเข้าห้องเรียนหรือไม่?'
    );
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

  const handleSelectFoundStudent = async (std: User) => {
    if (!classroom) return;
    const alreadyEnrolled = [...(classroom.students || []), ...(classroom.pending_students || [])]
      .some((student) => student.id === std.id || (student.student_id && std.student_id && student.student_id === std.student_id));
    if (alreadyEnrolled) {
      setNotice('นักเรียนคนนี้อยู่ในห้องเรียนแล้ว');
      return;
    }
    if (!confirmOtherSchool([std])) return;
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
    const pending = (classroom.pending_students || []).find((student) => student.id === studentId);
    if (pending && !confirmOtherSchool([pending])) return;
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

  // Runs after the teacher confirms in the bulk dialog (which already lists other-school students).
  const handleBulkPending = async () => {
    if (!classroom || !bulkPendingAction) return;
    const pending = classroom.pending_students || [];
    const admit = bulkPendingAction === 'admit';
    setBulkPendingBusy(true);
    let failed = 0;
    for (const p of pending) {
      try {
        if (admit) await dataService.admitStudentToClassroom(classroom.id, p.id);
        else await dataService.rejectStudentFromClassroom(classroom.id, p.id);
      } catch (e) {
        console.error(e);
        failed += 1;
      }
    }
    const done = pending.length - failed;
    setNotice(
      failed
        ? `${admit ? 'อนุมัติ' : 'ปฏิเสธ'}แล้ว ${done} คน • ไม่สำเร็จ ${failed} คน กรุณาลองใหม่`
        : admit
        ? `อนุมัติคำขอทั้งหมดแล้ว (${done} คน)`
        : `ปฏิเสธคำขอทั้งหมดแล้ว (${done} คน)`
    );
    setBulkPendingBusy(false);
    setBulkPendingAction(null);
    await loadWorkspace();
  };

  const handleSelectFoundTeacher = async (foundTeacher: User, role: 'primary' | 'assistant' | 'researcher' = 'assistant') => {
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
    // Enrolled like any other student (with a user record), so their work and
    // check-ins match, and they merge with their LINE account when they join.
    try {
      await dataService.addStudentToClassroom(
        classroom.id,
        {
          first_name: first_name.trim(),
          last_name: last_name.trim(),
          student_id: student_id.trim() || undefined,
          email: email.trim() || undefined,
          institution: teacherInstitution || undefined,
        },
        { autoAdmit: true }
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'เพิ่มผู้เรียนไม่สำเร็จ');
      return;
    }
    await loadWorkspace();
    setNotice(`เพิ่มผู้เรียน "${first_name.trim()} ${last_name.trim()}" เรียบร้อยแล้ว`);
    setShowAddStudentModal(false);
    setNewStudentFirst('');
    setNewStudentLast('');
    setNewStudentId('');
    setNewStudentEmail('');
  };

  const [editingStudent, setEditingStudent] = useState<User | null>(null);

  const handleStudentEdited = (studentId: string, fields: Pick<User, 'first_name' | 'last_name' | 'student_id' | 'institution'>) => {
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
      const status = findStudentRecord(recordIndex, student)?.status || 'absent';
      counts[status] = (counts[status] || 0) + 1;
    });
    return counts;
  }, [classroom?.students, recordIndex]);

  // Loading skeleton
  // Slide the desktop tab highlight under the active tab; re-measure when tab widths change
  // (font swap, resize). Keyed on whether the bar exists, not on `classroom`, so background
  // refreshes don't re-measure.
  const hasClassroom = !!classroom;
  useLayoutEffect(() => {
    const bar = tabBarRef.current;
    if (!bar) return;
    const measure = () => {
      const active = bar.querySelector<HTMLElement>('[aria-current="page"]');
      // The bar is display:none below lg; keep the last position instead of collapsing to 0.
      if (!active || active.offsetWidth === 0) return;
      const next = { left: active.offsetLeft, width: active.offsetWidth };
      setTabIndicator((prev) => (prev && prev.left === next.left && prev.width === next.width ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    bar.querySelectorAll('button').forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  }, [tab, hasClassroom]);

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

  const courseCode = course?.code || classroom.subject_code || 'CLASSROOM';
  const courseName = course?.name || classroom.course_name || '';
  const room = roomLabel(classroom) || classroom.name;
  const semester = classroom.academic_year || 'ปัจจุบัน';

  const selectTab = (next: Tab) => {
    if (next === tab) return;
    const order = tabs.map((t) => t.id);
    setTabDirection(order.indexOf(next) > order.indexOf(tab) ? 1 : -1);
    setTab(next);
    // Native history keeps ?tab in sync without a router round-trip.
    window.history.replaceState(null, '', `/classrooms/${classroom.id}?tab=${next}`);
  };

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950 -mx-4 sm:-mx-6 lg:-mx-8 -my-5 sm:-my-8">
      <div className="max-w-[1700px] mx-auto min-h-dvh flex">
        {/* ============================================================== */}
        {/* MAIN WORKSPACE CONTENT AREA (Full Width, No inner sidebar) */}
        {/* ============================================================== */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-8">
          {/* Sticky header: course/classroom labels, actions and (desktop) tabs stay in view while scrolling,
              pinned just under the global navbar. */}
          <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 pt-2.5 lg:pt-6 mb-5 sm:mb-6 bg-slate-50/90 dark:bg-slate-950/90 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 lg:gap-4 pb-2.5 lg:pb-4">
            {/* Mobile title row: code, course name, room and semester sit on one line (course name truncates). */}
            <div className="lg:hidden flex items-center gap-2 min-w-0">
              <span className="shrink-0 h-7 inline-flex items-center px-2 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 font-mono text-xs font-black">
                {courseCode}
              </span>
              {courseName && (
                <span className="min-w-0 flex-1 truncate text-base font-black text-slate-900 dark:text-white">{courseName}</span>
              )}
              <h1 className={`shrink-0 h-7 inline-flex items-center px-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-black ${courseName ? '' : 'ml-auto'}`}>
                {room}
              </h1>
              <span className="shrink-0 h-7 inline-flex items-center gap-1 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300" title={`ภาคเรียน ${semester}`}>
                <CalendarCheck className="w-3.5 h-3.5 text-slate-400" />
                {semester}
              </span>
              <button onClick={() => loadWorkspace()} aria-label="รีเฟรช" className="-mr-2 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-slate-500 shrink-0">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {/* Desktop title: course code and name lead at the same size as the room, all on one line,
                so the header grows sideways rather than down. */}
            <div className="hidden lg:block flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-3 min-w-0">
                <span className="shrink-0 h-9 inline-flex items-center px-3 rounded-xl bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 font-mono text-xl font-black">
                  {courseCode}
                </span>
                {courseName && (
                  <span className="min-w-0 truncate text-2xl font-black text-slate-900 dark:text-white tracking-tight">{courseName}</span>
                )}
                <span aria-hidden className="shrink-0 w-px h-6 bg-slate-300 dark:bg-slate-700" />
                <h1 className="shrink-0 text-2xl font-black text-slate-900 dark:text-white tracking-tight">{room}</h1>
                <span className="shrink-0 h-7 inline-flex items-center gap-1 px-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-600 dark:text-slate-300">
                  <CalendarCheck className="w-3.5 h-3.5 text-slate-400" />
                  ภาคเรียน {semester}
                </span>
              </div>
              {course?.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-1 max-w-3xl">{course.description}</p>
              )}
            </div>

            {/* One compact row on mobile so the sticky header stays short. */}
            <div className="lg:shrink-0 grid grid-cols-[1.2fr_1fr_1fr] gap-1.5 sm:flex sm:items-center sm:gap-2 sm:overflow-x-auto scrollbar-none sm:-mx-1 sm:px-1 sm:py-0.5 [&>*]:shrink-0">
              {/* Secondary: Invite Students Modal Trigger */}
              <button
                type="button"
                onClick={() => {
                  setShowInviteModal(true);
                  setInviteTab('search');
                }}
                className="min-w-0 h-9 sm:h-auto px-2 sm:px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] sm:text-xs font-bold inline-flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                <span className="truncate">เชิญนักเรียน</span>
                {(classroom.pending_students?.length || 0) > 0 && (
                  <span className="w-2 h-2 shrink-0 rounded-full bg-rose-500 animate-ping" />
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
                className="min-w-0 h-9 sm:h-auto px-2 sm:px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] sm:text-xs font-bold inline-flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <span
                  className={`w-2 h-2 shrink-0 rounded-full ${
                    classroom.line_connection_status === 'connected' || classroom.line_group_id
                      ? 'bg-emerald-500'
                      : classroom.line_connection_status === 'waiting'
                      ? 'bg-amber-500 animate-pulse'
                      : 'bg-slate-400'
                  }`}
                />
                <span className="truncate">
                  <span className="hidden sm:inline">เชื่อม</span>บอท LINE
                </span>
              </button>

              {/* Primary: Create Assignment or Exam */}
              <Link
                href={`/assignments/new?classroomId=${classroom.id}&from=classroom`}
                className="min-w-0 order-first sm:order-none h-9 sm:h-auto px-2 sm:px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-[11px] sm:text-xs inline-flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5 shadow-sm transition-all"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  สร้างงาน<span className="hidden sm:inline"> / ข้อสอบ</span>
                </span>
              </Link>
            </div>
          </div>

          {/* Navigation Tab Bar (desktop; mobile uses the bottom bar below) */}
          <div ref={tabBarRef} className="hidden lg:flex relative items-center gap-1.5 pb-3">
            {tabIndicator && (
              <span
                aria-hidden
                className="absolute top-0 left-0 bottom-3 rounded-2xl bg-amber-500 shadow-xs transition-[transform,width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ transform: `translateX(${tabIndicator.left}px)`, width: tabIndicator.width }}
              />
            )}
            {tabs.map((item) => {
              const Icon = item.icon;
              const isActive = tab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => selectTab(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    isActive
                      ? `text-slate-950 font-black ${tabIndicator ? '' : 'bg-amber-500 shadow-xs'}`
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
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

          {/* Mobile bottom tab bar: all five tabs at once, icon above a short label. */}
          <nav
            aria-label="เมนูห้องเรียน"
            className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-t border-slate-200/80 dark:border-slate-800 pb-[env(safe-area-inset-bottom)]"
          >
            <div className="relative grid grid-cols-5 px-1 py-1.5">
              {/* One column-wide track slides to the active tab; the pill inside matches the icon highlight. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-1.5 left-1 w-[calc((100%-0.5rem)/5)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ transform: `translateX(${tabs.findIndex((t) => t.id === tab) * 100}%)` }}
              >
                <span className="absolute top-1 left-1/2 -translate-x-1/2 h-7 w-12 rounded-full bg-amber-100 dark:bg-amber-950/70" />
              </span>
              {tabs.map((item) => {
                const Icon = item.icon;
                const isActive = tab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => selectTab(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={item.label}
                    className={`relative min-w-0 flex flex-col items-center gap-1 py-1 rounded-2xl text-[11px] transition-colors cursor-pointer ${
                      isActive
                        ? 'text-amber-600 dark:text-amber-400 font-black'
                        : 'text-slate-500 dark:text-slate-400 font-semibold hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    <span className="px-3.5 py-1 rounded-full">
                      <Icon className={`w-5 h-5 transition-transform duration-300 ${isActive ? 'scale-110' : ''}`} />
                    </span>
                    <span className="max-w-full truncate">{item.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Tab content slides in from the side of the tab being moved to (opacity/transform only, so it stays on the GPU).
              The outer wrapper clips the offset so the page never scrolls sideways mid-slide; it bleeds
              to <main>'s edges so card shadows and focus rings near the gutter aren't clipped. */}
          <div className="overflow-x-clip -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div
            key={tab}
            className="animate-in fade-in [--tw-duration:320ms]"
            style={{ '--tw-enter-translate-x': `${tabDirection * 2.5}rem` } as CSSProperties}
          >
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
                            {item.scheduledAt && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                                ⏰ เผยแพร่ {formatDateTime(item.scheduledAt, 'th')}
                              </span>
                            )}
                          </div>
                          <time className="text-[10px] text-slate-400 block mt-0.5">
                            {new Date(item.created_at).toLocaleString('th-TH', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </time>
                        </div>
                      </div>

                      {/* Edit (posts) / Delete (posts and assignments) */}
                      {(item.isPost || item.assignmentId) && (
                        <div className="flex items-center gap-1">
                          {item.isPost && (
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
                          )}
                          <button
                            onClick={() =>
                              item.assignmentId ? handleDeleteAssignment(item.assignmentId) : handleDeletePost(item.rawId!)
                            }
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            title={item.assignmentId ? 'ลบงาน/ข้อสอบนี้ (ลบออกจากแท็บงานด้วย)' : 'ลบโพสต์'}
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

              {/* Progress summary + filter, same as the grading hub */}
              {assignments.length > 0 && (
                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <div className={`p-3 rounded-2xl ${classworkSummary.pending > 0 ? 'bg-amber-50 dark:bg-amber-950/40' : 'bg-emerald-50 dark:bg-emerald-950/40'}`}>
                      <span className={`text-[11px] font-bold block ${classworkSummary.pending > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>รอตรวจ</span>
                      <span className={`text-xl sm:text-2xl font-black ${classworkSummary.pending > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                        {classworkSummary.pending}
                        <span className="text-[11px] font-semibold ml-1">ชิ้น</span>
                      </span>
                    </div>
                    <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">ตรวจแล้ว</span>
                      <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                        {classworkSummary.graded}
                        <span className="text-[11px] font-semibold text-slate-400 ml-1">/ {classworkSummary.handedIn}</span>
                      </span>
                    </div>
                    <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">งานที่ตรวจครบ</span>
                      <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                        {classworkSummary.done}
                        <span className="text-[11px] font-semibold text-slate-400 ml-1">/ {assignments.length}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-1.5 p-1 rounded-2xl bg-slate-50 dark:bg-slate-800/60 overflow-x-auto">
                    {CLASSWORK_FILTERS.map(({ id, label, active }) => {
                      const selected = classworkFilter === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setClassworkFilter(id)}
                          className={`flex-1 min-w-max px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                            selected ? active : 'text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800'
                          }`}
                        >
                          <span>{label}</span>
                          <span className={`px-1.5 min-w-5 rounded-full text-[10px] font-black ${selected ? 'bg-black/10 dark:bg-white/20' : 'bg-white dark:bg-slate-900'}`}>
                            {classworkFilterCounts[id]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {classworkFilter !== 'all' && (
                    <p className="text-[11px] text-slate-400">กลับไปที่ “ทั้งหมด” เพื่อลากเรียงลำดับหรือย้ายกลุ่ม</p>
                  )}
                </div>
              )}

              {/* Grouped Assignments List */}
              <div className="space-y-5">
                {Object.entries(
                  assignments.reduce<Record<string, Assignment[]>>(
                    (groups, item) => {
                      const key = item.group_name || (item.is_exam ? 'ข้อสอบ' : 'งานทั่วไป');
                      (groups[key] ||= []).push(item);
                      return groups;
                    },
                    Object.fromEntries(customGroups.map((name) => [name, [] as Assignment[]]))
                  )
                )
                  .map(([group, unsorted]) => [group, [...unsorted].sort(byClassworkOrder).filter((a) => matchesClassworkFilter(a.id))] as const)
                  .filter(([, items]) => classworkFilter === 'all' || items.length > 0)
                  .map(([group, items]) => (
                  <div
                    key={group}
                    onDragOver={(e) => {
                      if (!draggingAssignmentId) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverGroup !== group) setDragOverGroup(group);
                      // Over the group but not over a card: drop at the end.
                      if (dropTarget?.group !== group || dropTarget.index !== items.length) setDropTarget({ group, index: items.length });
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setDragOverGroup((g) => (g === group ? null : g));
                        setDropTarget((t) => (t?.group === group ? null : t));
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = e.dataTransfer.getData('text/plain') || draggingAssignmentId;
                      const index = dropTarget?.group === group ? dropTarget.index : items.length;
                      setDragOverGroup(null);
                      setDropTarget(null);
                      setDraggingAssignmentId(null);
                      if (id) handleDropAssignment(id, group, index);
                    }}
                    className={`rounded-3xl p-3 sm:p-4 space-y-3 transition-all border ${
                      dragOverGroup === group
                        ? 'border-amber-400 ring-2 ring-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20'
                        : draggingAssignmentId
                        ? 'border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40'
                        : 'border-transparent bg-slate-100/60 dark:bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center gap-2 px-1">
                      <span className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-600">
                        <Layers className="w-4 h-4" />
                      </span>
                      <h3 className="font-black text-sm text-slate-900 dark:text-white">
                        {group} <span className="text-slate-400 font-normal">({items.length})</span>
                      </h3>
                      {(() => {
                        const left = items.reduce((sum, a) => sum + (classworkCounts.get(a.id)?.pending || 0), 0);
                        return left > 0 ? (
                          <span className="ml-auto px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-bold">
                            รอตรวจ {left}
                          </span>
                        ) : null;
                      })()}
                    </div>

                    {items.length === 0 && (
                      <div className="py-6 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-center text-[11px] text-slate-400">
                        ลากงานมาวางที่นี่ หรือกด “ย้ายกลุ่ม” ที่งาน
                      </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                      {items.map((item, itemIndex, all) => {
                        // Show the insertion line only where a drop would change something.
                        const draggedIndex = all.findIndex((a) => a.id === draggingAssignmentId);
                        const lineAt = (index: number) =>
                          !!draggingAssignmentId &&
                          dropTarget?.group === group &&
                          dropTarget.index === index &&
                          (draggedIndex === -1 || (index !== draggedIndex && index !== draggedIndex + 1));
                        const itemWindow = getAssignmentWindow(item);
                        const canDrag = classworkFilter === 'all';
                        return (
                          <div
                            key={item.id}
                            draggable={canDrag}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', item.id);
                              e.dataTransfer.effectAllowed = 'move';
                              setDraggingAssignmentId(item.id);
                            }}
                            onDragEnd={() => {
                              setDraggingAssignmentId(null);
                              setDragOverGroup(null);
                              setDropTarget(null);
                            }}
                            onDragOver={(e) => {
                              if (!draggingAssignmentId) return;
                              e.preventDefault();
                              e.stopPropagation();
                              e.dataTransfer.dropEffect = 'move';
                              // Top half of the card: before it; bottom half: after it.
                              const box = e.currentTarget.getBoundingClientRect();
                              const index = itemIndex + (e.clientY > box.top + box.height / 2 ? 1 : 0);
                              if (dragOverGroup !== group) setDragOverGroup(group);
                              if (dropTarget?.group !== group || dropTarget.index !== index) setDropTarget({ group, index });
                            }}
                            title={canDrag ? 'ลากเพื่อเรียงลำดับ หรือย้ายไปกลุ่มอื่น' : undefined}
                            className={`relative flex ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''} ${draggingAssignmentId === item.id ? 'opacity-40' : ''}`}
                          >
                            {/* Insertion line: where the dragged card will land */}
                            {lineAt(itemIndex) && (
                              <span aria-hidden className="pointer-events-none absolute -top-[9px] inset-x-1 h-1 rounded-full bg-amber-500 shadow-sm shadow-amber-500/40" />
                            )}
                            {itemIndex === items.length - 1 && lineAt(items.length) && (
                              <span aria-hidden className="pointer-events-none absolute -bottom-[9px] inset-x-1 h-1 rounded-full bg-amber-500 shadow-sm shadow-amber-500/40" />
                            )}
                            <AssignmentProgressCard
                              className="flex-1 min-w-0 hover:border-amber-400"
                              assignment={item}
                              counts={classworkCounts.get(item.id) || gradingCounts([], classroom.students?.length || 0, item.is_exam)}
                              gradingHref={`/assignments/${item.id}/grading?from=classroom&classroomId=${classroomId}`}
                              editHref={`/assignments/new?edit=${item.id}&classroomId=${classroomId}&from=classroom`}
                              onStatusClick={() => setStatusAssignment(item)}
                              onDelete={() => handleDeleteAssignment(item.id)}
                              onPublishNow={itemWindow.isScheduled || itemWindow.isDraft ? () => handlePublishAssignmentNow(item) : undefined}
                              leading={canDrag ? <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0 -ml-1" aria-hidden /> : undefined}
                              footer={
                                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                                  <span className="text-slate-400 flex items-center gap-1 min-w-0">
                                    <Tag className="w-3 h-3 shrink-0" />
                                    <span className="truncate">หมวดหมู่: {item.group_name || 'ไม่ได้จัดกลุ่ม'}</span>
                                  </span>
                                  <button
                                    type="button"
                                    draggable={false}
                                    onClick={() => {
                                      setEditingAssignmentGroup(item);
                                      setTargetGroupForAssignment(item.group_name || '');
                                    }}
                                    className="text-amber-600 font-bold hover:underline cursor-pointer shrink-0"
                                  >
                                    ย้ายกลุ่ม
                                  </button>
                                </div>
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

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
              recordIndex={recordIndex}
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
              exportAllCsv={exportAllAttendance}
              selectSession={setSelectedSessionId}
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
                isOtherSchool={isOtherSchool}
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
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-bold">{assignments.length} งาน/ข้อสอบ</span>
                  <button
                    type="button"
                    onClick={exportGrades}
                    disabled={!assignments.length || !(classroom.students || []).length}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-600" />
                    <span>ส่งออก CSV</span>
                  </button>
                </div>
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
                      {gradeColumns.map((item) => (
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
                        {gradeColumns.map((item) => {
                          const sub = findStudentSubmission(submissions, item.id, student);
                          return (
                            <td key={item.id} className="p-3 text-center font-bold">
                              {sub && isGraded(sub) ? (
                                <span className="text-emerald-600 dark:text-emerald-400 font-black text-sm">
                                  {sub.total_score}
                                </span>
                              ) : sub && needsGrading(sub) ? (
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
          </div>
          </div>
        </main>
      </div>

      {/* Group modals live outside the animated tab panel: its transform would
          otherwise confine these fixed overlays to the panel instead of the page. */}
      {/* Modal: Create Category Group */}
      {showAddGroupModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in"
          onClick={(e) => e.target === e.currentTarget && setShowAddGroupModal(false)}
        >
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 max-w-sm w-full space-y-4 shadow-xl max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <div>
              <h3 className="font-black text-sm text-slate-900 dark:text-white">เพิ่มหมวดหมู่ใหม่</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">สร้างแล้วลากงานมาวางในกลุ่มใหม่ได้ทันที</p>
            </div>
            <input
              autoFocus
              value={newGroupName}
              onKeyDown={(e) => e.key === 'Enter' && handleAddGroup()}
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
                onClick={handleAddGroup}
                disabled={!newGroupName.trim()}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-black cursor-pointer disabled:opacity-50"
              >
                บันทึกกลุ่ม
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Move Assignment to Group */}
      {editingAssignmentGroup && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in"
          onClick={(e) => e.target === e.currentTarget && setEditingAssignmentGroup(null)}
        >
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
      {/* MODAL: ASSIGNMENT STATUS */}
      {/* ============================================================== */}
      {statusAssignment && (
        <AssignmentStatusDialog
          assignment={statusAssignment}
          onClose={() => setStatusAssignment(null)}
          onSaved={(updated) => {
            setAssignments((prev) => prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
            setStatusAssignment(null);
            const kind = updated.is_exam ? 'ข้อสอบ' : 'งาน';
            setNotice(
              updated.status_override === 'force_closed'
                ? `🔒 ปิดรับ${kind} “${updated.title}” แล้ว`
                : updated.status_override === 'extended'
                ? `⏳ ขยายเวลาส่ง${kind} “${updated.title}” ถึง ${formatDateTime(updated.extended_until, 'th')} แล้ว`
                : `${kind} “${updated.title}” กลับไปรับงานตามกำหนดส่งแล้ว`
            );
          }}
        />
      )}

      {editingStudent && classroom && (
        <EditStudentModal
          classroomId={classroom.id}
          student={editingStudent}
          teacherInstitution={teacherInstitution}
          onClose={() => setEditingStudent(null)}
          onSaved={handleStudentEdited}
        />
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
                onChange={(e) => setNewTeacherRole(e.target.value as typeof newTeacherRole)}
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
                    placeholder="🔍 ค้นหานักเรียนในโรงเรียนของคุณ (ชื่อ, นามสกุล หรือรหัสนักเรียน)..."
                    className="w-full pl-9 pr-8 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium outline-none focus:ring-2 focus:ring-amber-500 text-slate-900 dark:text-white"
                  />
                  {isSearchingStudents && (
                    <Loader2 className="w-4 h-4 absolute right-3 top-3 text-amber-500 animate-spin" />
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 -mt-2">
                  {teacherInstitution
                    ? `ค้นหาได้เฉพาะนักเรียนของ ${teacherInstitution} — นักเรียนที่ลงทะเบียนชื่อโรงเรียนไม่ตรง ให้เข้าร่วมผ่านลิงก์เชิญ แล้วแก้ชื่อโรงเรียนภายหลัง`
                    : 'กรุณาระบุโรงเรียนของคุณครูที่แดชบอร์ดก่อน จึงจะค้นหานักเรียนได้'}
                </p>

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
                          <InstitutionTag institution={found.institution} otherSchool={isOtherSchool(found.institution)} />
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
                  <div className="space-y-2">
                    {/* Bulk actions stay above the scrolling list; buttons go full-width on narrow screens */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                      <span className="text-xs font-bold text-slate-500">
                        รอการอนุมัติ {classroom.pending_students.length} คน
                      </span>
                      <div className="flex items-center gap-1.5 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={() => setBulkPendingAction('admit')}
                          className="flex-1 sm:flex-none justify-center px-2.5 py-2 sm:py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] inline-flex items-center gap-1 shadow-xs cursor-pointer whitespace-nowrap"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          อนุมัติทั้งหมด
                        </button>
                        <button
                          type="button"
                          onClick={() => setBulkPendingAction('reject')}
                          className="flex-1 sm:flex-none justify-center px-2.5 py-2 sm:py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300 font-bold text-[11px] inline-flex items-center gap-1 shadow-xs cursor-pointer whitespace-nowrap"
                        >
                          <UserX className="w-3.5 h-3.5" />
                          ปฏิเสธทั้งหมด
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2 max-h-72 overflow-y-auto">
                    {classroom.pending_students.map((p) => (
                      <div
                        key={p.id}
                        className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 dark:text-white break-words">
                            {p.first_name} {p.last_name}
                          </p>
                          <p className="text-[10px] text-slate-400 font-mono break-all">
                            รหัส: {p.student_id || '-'} • {p.email || 'LINE Login'}
                          </p>
                          <InstitutionTag institution={p.institution} otherSchool={isOtherSchool(p.institution)} />
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
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: CONFIRM ACCEPT ALL / REJECT ALL JOIN REQUESTS */}
      {bulkPendingAction && classroom && (() => {
        const pending = classroom.pending_students || [];
        const admit = bulkPendingAction === 'admit';
        const otherSchool = admit ? pending.filter((p) => isOtherSchool(p.institution)) : [];
        return (
          <div
            className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
            onClick={() => !bulkPendingBusy && setBulkPendingAction(null)}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="bulk-pending-title"
              className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <span className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${admit ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400' : 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400'}`}>
                  {admit ? <UserCheck className="w-5 h-5" /> : <UserX className="w-5 h-5" />}
                </span>
                <div className="min-w-0">
                  <h3 id="bulk-pending-title" className="text-sm font-black text-slate-900 dark:text-white">
                    {admit ? `อนุมัตินักเรียนทั้งหมด ${pending.length} คน?` : `ปฏิเสธคำขอทั้งหมด ${pending.length} คน?`}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    {admit
                      ? 'นักเรียนทุกคนในรายการจะเข้าห้องเรียนนี้ เห็นงาน และส่งงานได้ทันที'
                      : 'คำขอทั้งหมดจะถูกลบออก นักเรียนต้องส่งคำขอเข้าร่วมใหม่หากต้องการเข้าห้องเรียน'}
                  </p>
                </div>
              </div>

              <ul className="max-h-40 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {pending.map((p) => (
                  <li key={p.id} className="px-3 py-2 flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-800 dark:text-slate-200 truncate">{p.first_name} {p.last_name}</span>
                    <span className="text-[10px] text-slate-400 font-mono shrink-0">{p.student_id || '-'}</span>
                  </li>
                ))}
              </ul>

              {otherSchool.length > 0 && (
                <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed space-y-1">
                  <p className="font-black flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {otherSchool.length} คนระบุโรงเรียนต่างจากของคุณครู ({teacherInstitution})
                  </p>
                  <p>{otherSchool.map((p) => `${p.first_name} ${p.last_name} — ${p.institution}`).join(', ')}</p>
                  <p>หากนักเรียนกรอกชื่อโรงเรียนผิด แก้ไขได้ภายหลังที่แท็บ &quot;ผู้สอนและผู้เรียน&quot;</p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setBulkPendingAction(null)}
                  disabled={bulkPendingBusy}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleBulkPending}
                  disabled={bulkPendingBusy}
                  autoFocus
                  className={`px-4 py-2 rounded-xl text-xs font-black text-white inline-flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-60 ${admit ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}
                >
                  {bulkPendingBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {admit ? `ยืนยันอนุมัติ ${pending.length} คน` : `ยืนยันปฏิเสธ ${pending.length} คน`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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

function InstitutionTag({ institution, otherSchool }: { institution?: string; otherSchool: boolean }) {
  if (!institution?.trim()) {
    return <p className="text-[10px] text-slate-400 mt-0.5 truncate">🏫 ไม่ระบุโรงเรียน</p>;
  }
  return (
    <p
      className={`text-[10px] mt-0.5 truncate ${otherSchool ? 'font-bold text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}
      title={otherSchool ? 'โรงเรียนไม่ตรงกับโรงเรียนของคุณครู' : institution}
    >
      {otherSchool ? '⚠️' : '🏫'} {institution}
      {otherSchool && <span className="ml-1 px-1.5 py-px rounded-full bg-rose-100 dark:bg-rose-950 text-[9px]">ต่างโรงเรียน</span>}
    </p>
  );
}

function StudentList({
  classroom,
  onOpenAddStudent,
  onRemoveStudent,
  onEditStudent,
  isOtherSchool,
}: {
  classroom: Classroom;
  onOpenAddStudent: () => void;
  onRemoveStudent: (id: string) => void;
  onEditStudent: (student: User) => void;
  isOtherSchool: (institution?: string) => boolean;
}) {
  const [query, setQuery] = useState('');
  const students = classroom.students || [];
  const otherSchoolCount = students.filter((s) => isOtherSchool(s.institution)).length;
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

      {otherSchoolCount > 0 && (
        <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-[11px] font-bold text-rose-800 dark:text-rose-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>มีนักเรียน {otherSchoolCount} คนที่ระบุโรงเรียนต่างจากโรงเรียนของคุณครู หากกรอกผิด กดปุ่มแก้ไข (ดินสอ) เพื่อปรับชื่อโรงเรียนให้ถูกต้อง</span>
        </div>
      )}

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
              <InstitutionTag institution={student.institution} otherSchool={isOtherSchool(student.institution)} />
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
                title="แก้ไขชื่อ นามสกุล รหัสนักเรียน และโรงเรียน"
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
  recordIndex,
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
  exportAllCsv,
  selectSession,
  onUpdateSession,
  onDeleteSession,
  isUpdatingSession,
}: {
  classroom: Classroom;
  sessions: AttendanceSession[];
  session: AttendanceSession | null;
  recordIndex: Map<string, AttendanceRecord>;
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
  exportAllCsv: () => void;
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

  // Keep expanded session in sync with parent session (adjusted during render
  // when the parent's session changes, instead of in an effect).
  const [syncedSessionId, setSyncedSessionId] = useState<string | undefined>(undefined);
  if (session?.id !== syncedSessionId) {
    setSyncedSessionId(session?.id);
    if (session?.id) {
      setExpandedSessionId(session.id);
      setEditingTitle(session.title);
      setIsEditingTitleActive(false);
    }
  }

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

      const studentStatus = findStudentRecord(recordIndex, student)?.status || 'absent';
      return studentStatus === statusFilter;
    });
  }, [classroom.students, recordIndex, rosterSearch, statusFilter]);

  /** Name of the classmate whose phone did a borrowed-phone check-in (they are on the same roster). */
  const senderName = (senderId: string) => {
    const sender = (classroom.students || []).find((s) => s.id === senderId || s.line_uid === senderId);
    return sender ? `${sender.first_name} ${sender.last_name}`.trim() : 'เพื่อน';
  };

  return (
    <section className="max-w-4xl mx-auto space-y-6">
      {/* 1. Top Header Bar with Open-Form Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-amber-500" />
            <span>เช็คชื่อรายคาบ</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            จัดการคาบเรียน เช็คชื่อแบบเรียลไทม์ และสลับสถานะรายคนได้ตลอดเวลา
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {sessions.length > 0 && (
            <button
              type="button"
              onClick={exportAllCsv}
              title="ส่งออกการเช็คชื่อทุกคาบ (แถว = นักเรียน, คอลัมน์ = คาบเรียน)"
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>ส่งออก CSV ทุกคาบ</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{showCreateForm ? 'ปิดแบบฟอร์ม' : 'เปิดคาบเช็คชื่อใหม่'}</span>
          </button>
        </div>
      </div>

      {/* 3. Collapsible New Session Creation Form */}
      {showCreateForm && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-amber-300 dark:border-amber-800/70 p-5 shadow-md space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-amber-500" />
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
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-500"
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
              className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 cursor-pointer shadow-md shadow-amber-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>เริ่มเปิดเช็คชื่อและส่งแจ้งเตือน LINE</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. Statistics Summary Bento Cards */}
      <div className="bg-white dark:bg-slate-900 p-3 sm:p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {[
          ['on_time', 'ตรงเวลา', counts['on_time'] || 0, 'bg-emerald-500', 'text-emerald-600 dark:text-emerald-400'],
          ['late', 'มาสาย', counts['late'] || 0, 'bg-amber-400', 'text-amber-600 dark:text-amber-400'],
          ['absent', 'ขาด / ยังไม่เช็ค', counts['absent'] || 0, 'bg-rose-500', 'text-rose-600 dark:text-rose-400'],
          ['excused', 'ลา', counts['excused'] || 0, 'bg-sky-500', 'text-sky-600 dark:text-sky-400'],
        ].map(([key, label, count, dotCls, numberCls]) => (
          <div key={key} className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${dotCls}`} />
              {label}
            </span>
            <p className={`text-2xl font-black mt-0.5 ${Number(count) > 0 ? numberCls : 'text-slate-400'}`}>{count}</p>
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
                  ? 'border-amber-300 dark:border-amber-800/70 shadow-md shadow-amber-500/10'
                  : isExpanded
                    ? 'border-slate-300 dark:border-slate-700 shadow-md'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
              }`}
            >
              {/* Session Header Card (Always visible, click to toggle collapse).
                  An open session gets the live-banner treatment. */}
              <div
                onClick={() => toggleSession(item.id)}
                className={`p-4 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none ${
                  isOpen
                    ? 'bg-amber-50/70 dark:bg-amber-950/20 border-l-4 border-amber-500'
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
                        <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-black text-[10px] shadow-xs">
                          กำลังเปิดรับเช็คชื่อ
                        </span>
                      )}
                      <h4 className="text-sm font-black text-slate-900 dark:text-white">{item.title}</h4>
                    </div>
                    <p className={`text-[11px] mt-0.5 ${isOpen ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400'}`}>
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
                        className="px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-300 text-xs font-bold hover:bg-amber-50 dark:hover:bg-amber-950/40 cursor-pointer shadow-xs"
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
                        ? 'bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-900 shadow-xs'
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
                          ['on_time', 'ตรงเวลา'],
                          ['late', 'มาสาย'],
                          ['absent', 'ขาด'],
                          ['excused', 'ลา'],
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
                      const record = findStudentRecord(recordIndex, student);
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
                              {record?.checked_in_by && (
                                <span className="font-sans font-bold text-sky-600 dark:text-sky-400" title="นักเรียนเช็คชื่อด้วยโทรศัพท์ของเพื่อนร่วมห้อง">
                                  {` • 📱 เช็คชื่อจากเครื่องของ ${senderName(record.checked_in_by)}`}
                                </span>
                              )}
                            </span>
                          </div>

                          {/* 1-Click Status Switcher Buttons */}
                          <div className="grid grid-cols-4 gap-1 w-full sm:w-auto">
                            {(
                              [
                                ['on_time', 'ตรงเวลา', 'bg-emerald-100 text-emerald-800 border-emerald-300'],
                                ['late', 'มาสาย', 'bg-amber-100 text-amber-800 border-amber-300'],
                                ['excused', 'ลา', 'bg-sky-100 text-sky-800 border-sky-300'],
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

