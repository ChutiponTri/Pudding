'use client';

import { usePageTitle } from '@/lib/hooks/usePageTitle';
import { isRetake, rosterSizeFor } from '@/lib/utils/retake';
import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { CreateWorkMenu } from '@/components/CreateWorkMenu';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { dataService } from '@/lib/supabase/dataService';
import { cacheVersion, cachedCall, patchCache, readCache, watchClassrooms, writeCache } from '@/lib/cache/sessionCache';
import { quietly } from '@/lib/net/fetchActivity';
import { indicatorStyle, useSlidingIndicator } from '@/lib/hooks/useSlidingIndicator';
import { lineMessagesLeftNote, testQuotaNote, type LineTestQuotaInfo } from '@/lib/utils/lineTestQuotaNote';
import { ActionToast, networkErrorMessage, readActionResult, useActionToast } from '@/components/ActionToast';
import { LineGroupConnectSteps } from '@/components/LineGroupConnectSteps';
import { dropLineGroup, prefetchLineGroups, useLineGroupChoices } from '@/lib/line/lineGroupChoices';
import { EditStudentModal } from '@/components/EditStudentModal';
import { StudentRosterModal, type StudentRosterTab } from '@/components/StudentRosterModal';
import { Avatar } from '@/components/Avatar';
import { teacherRoleBadgeClass, teacherRoleLabel } from '@/lib/utils/teacherRole';
import { CoTeacherPanel, type CoTeacherRole } from '@/components/teacher/CoTeacherPanel';
import { AssignmentStatusDialog } from '@/components/AssignmentStatusDialog';
import { ClassworkRow } from '@/components/works/ClassworkRow';
import { shiftFor, useCrossListDrag } from '@/lib/hooks/useCrossListDrag';
import { applySavedOrder, readLocalOrder, useDragReorder, writeLocalOrder } from '@/lib/hooks/useDragReorder';

import { CategoryDetailSheet, categoryLook, RenameCategoryDialog } from '@/components/works/CategoryTools';
import { ActionMenu, type ActionMenuItem } from '@/components/works/ActionMenu';
import { BulkStatusDialog } from '@/components/works/StatusBits';
import { WORK_COLORS, WORK_COLOR_CLASSES, type WorkColor } from '@/lib/hooks/useWorkPrefs';
import { Check as CheckMark, Clock as ClockIcon, Eye as EyeIcon, Palette, PencilLine as PencilIcon, QrCode, X as XIcon } from 'lucide-react';
import { AttendanceQrScreen } from '@/components/AttendanceQrScreen';
import type { WorkClass } from '@/lib/utils/workGroups';

/** Category card colours, kept per classroom in this browser. */
const colorsKey = (classroomId: string) => `pudding:classwork-colors:${classroomId}`;
function readCategoryColors(classroomId: string): Record<string, WorkColor> {
  try {
    const value = JSON.parse(window.localStorage.getItem(colorsKey(classroomId)) || '{}');
    return Object.fromEntries(Object.entries(value).filter(([, v]) => (WORK_COLORS as readonly string[]).includes(v as string))) as Record<string, WorkColor>;
  } catch {
    return {};
  }
}
function writeCategoryColors(classroomId: string, colors: Record<string, WorkColor>) {
  try {
    window.localStorage.setItem(colorsKey(classroomId), JSON.stringify(colors));
  } catch {
    // Kept for this visit only.
  }
}
import { AssignmentGroupHeader, teacherGroupChips } from '@/components/AssignmentGroupHeader';
import { useCollapsedGroups } from '@/lib/hooks/useCollapsedGroups';
import { gradingCounts, isGraded, isHandedIn, isStudentSubmission, needsGrading, type GradingCounts } from '@/lib/utils/gradingStatus';
import { formatDateTime } from '@/lib/utils/datetime';
import { roomLabel } from '@/lib/utils/classroomLabel';
import { getAssignmentWindow, isAssignmentPublished } from '@/lib/utils/assignmentWindow';
import { useScheduleNow } from '@/lib/hooks/useScheduleNow';
import { Assignment, Classroom, ClassroomTeacher, Course, Submission, User } from '@/types/database';
import { MobileText } from '@/components/MobileText';
import { ModalSheet, ModalSheetBody, ModalSheetFooter, ModalSheetHeader } from '@/components/ModalSheet';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { reportLineUnsent, type PostLineShare } from '@/lib/utils/lineShare';
import { institutionLabel, sameInstitution } from '@/lib/data/thaiInstitutions';
import {
  ArrowLeft,
  AlertCircle,
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  Edit2,
  ExternalLink,
  FileText,
  Filter,
  FolderPlus,
  GripVertical,
  Megaphone,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Share2,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  X,
  Loader2,
  MessageCircle,
} from 'lucide-react';
import { PageSkeleton } from '@/components/LoadingState';


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
  /** The bot could not send this post to LINE: the teacher can share it by hand. */
  lineShare?: PostLineShare;
};
type Post = {
  id: string;
  body: string;
  created_at: string;
  activity_type?: TimelineItem['type'];
  metadata?: { assignmentId?: string; groupName?: string; publishAt?: string; sessionId?: string };
  /** Teachers only: the bot could not send it to LINE (see withLineShare). */
  line_share?: PostLineShare;
};

/** A UI label in both languages, for module-level constants (pick with `[language]`). */
type Bilingual = { th: string; en: string };

type ClassworkFilter = 'all' | 'pending' | 'done';
// `pill` paints the sliding highlight behind the selected filter, `text` its label.
const CLASSWORK_FILTERS: Array<{ id: ClassworkFilter; label: Bilingual; pill: string; text: string }> = [
  { id: 'all', label: { th: 'ทั้งหมด', en: 'All' }, pill: 'bg-slate-900 dark:bg-white', text: 'text-white dark:text-slate-900' },
  { id: 'pending', label: { th: 'ต้องตรวจ', en: 'To grade' }, pill: 'bg-amber-500', text: 'text-slate-950' },
  { id: 'done', label: { th: 'ตรวจครบแล้ว', en: 'Fully graded' }, pill: 'bg-emerald-600', text: 'text-white' },
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
const tabs: Array<{ id: Tab; label: Bilingual; shortLabel: Bilingual; icon: typeof BookOpen }> = [
  { id: 'overview', label: { th: 'ภาพรวม', en: 'Overview' }, shortLabel: { th: 'ภาพรวม', en: 'Overview' }, icon: ClipboardList },
  { id: 'classwork', label: { th: 'งานและเนื้อหา', en: 'Classwork' }, shortLabel: { th: 'งาน', en: 'Work' }, icon: BookOpen },
  { id: 'attendance', label: { th: 'เช็กชื่อ', en: 'Attendance' }, shortLabel: { th: 'เช็กชื่อ', en: 'Attend' }, icon: CalendarCheck },
  { id: 'people', label: { th: 'ผู้สอนและผู้เรียน', en: 'People' }, shortLabel: { th: 'สมาชิก', en: 'People' }, icon: Users },
  { id: 'grades', label: { th: 'คะแนน', en: 'Grades' }, shortLabel: { th: 'คะแนน', en: 'Grades' }, icon: FileText },
];

const statusLabels: Record<AttendanceStatus, Bilingual> = {
  on_time: { th: 'มาตรงเวลา', en: 'On time' },
  late: { th: 'มาสาย', en: 'Late' },
  absent: { th: 'ขาด', en: 'Absent' },
  excused: { th: 'ลา', en: 'Excused' },
};

export default function ClassroomWorkspacePage() {
  const { tr, language } = useLanguage();
  const { user } = useUser();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const classroomId = params.id;

  const [classroom, setClassroom] = useState<Classroom | null>(null);
  usePageTitle(classroom?.name);
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
  const [attendanceTitle, setAttendanceTitle] = useState(tr('เช็กชื่อประจำคาบ', 'Period attendance'));
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
  // The row being dragged: where it came from and how far the others slide aside for it.
  const [classworkDragInfo, setClassworkDragInfo] = useState<{ id: string; source: { group: string; index: number }; size: number } | null>(null);
  const foldOpenTimer = useRef<{ group: string; timer: number } | null>(null);

  // People Tab: Add Teacher & Add Student Modals
  const [showAddTeacherModal, setShowAddTeacherModal] = useState(false);

  const [showInviteModal, setShowInviteModal] = useState(false);
  // Accept all / reject all join requests: asks in its own box before acting.
  const [bulkPendingAction, setBulkPendingAction] = useState<'admit' | 'reject' | null>(null);
  const [bulkPendingBusy, setBulkPendingBusy] = useState(false);
  const [inviteTab, setInviteTab] = useState<StudentRosterTab>('roster');

  // LINE Group Connection Modal state
  const [showLineConnectModal, setShowLineConnectModal] = useState(false);
  const [lineConnection, setLineConnection] = useState<{
    status: 'disconnected' | 'waiting' | 'connected';
    groupName?: string;
    expiresAt?: string;
    connectedAt?: string;
  }>({ status: 'disconnected' });
  const [isLineLoading, setIsLineLoading] = useState(false);
  const [linkingGroupRef, setLinkingGroupRef] = useState<string | null>(null);
  // LINE dialog results show as a toast: the page notice sits behind the open dialog.
  const { toast, showToast, hideToast } = useActionToast();
  // Groups the bot is in with this teacher: shared, remembered list (see lineGroupChoices).
  const lineGroups = useLineGroupChoices(showLineConnectModal);
  const [teacherBot, setTeacherBot] = useState<{ botFriend?: boolean | null; addFriendUrl?: string }>({});

  // Teacher's bot friendship (for the "add Pudding Bot" hint) when the dialog opens.
  useEffect(() => {
    if (!showLineConnectModal) return;
    fetch('/api/line/teacher-link', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => result && setTeacherBot({ botFriend: result.botFriend, addFriendUrl: result.addFriendUrl }))
      .catch(() => {});
  }, [showLineConnectModal]);

  const applyLineStatus = (result: { status: 'disconnected' | 'waiting' | 'connected'; groupName?: string }) => {
    setClassroom((prev) => (prev ? {
      ...prev,
      line_connection_status: result.status,
      line_group_name: result.groupName,
      line_group_id: result.status === 'connected' ? prev.line_group_id || 'linked' : undefined,
    } : null));
  };

  // Not linked yet: warm the group list in the background so the dialog opens with it.
  const lineUnlinked = Boolean(classroom && !classroom.line_group_id);
  useEffect(() => {
    if (lineUnlinked) prefetchLineGroups();
  }, [lineUnlinked]);

  // While the dialog is open and not linked, notice a link made from LINE (the teacher's LIFF page).
  useEffect(() => {
    if (!showLineConnectModal || lineConnection.status === 'connected' || !classroomId) return;
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/line/connections?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const result = await response.json();
        if (result.status !== 'connected') return;
        setLineConnection(result);
        applyLineStatus(result);
        showToast(tr(`เชื่อม LINE Group${result.groupName ? ` “${result.groupName}”` : ''} เรียบร้อยแล้ว`, `LINE group${result.groupName ? ` “${result.groupName}”` : ''} connected`));
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLineConnectModal, lineConnection.status, classroomId, tr]);

  const handleLineConnection = async (action: 'test' | 'disconnect' | 'link-group', groupRef?: string) => {
    if (!classroom) return;
    setIsLineLoading(true);
    if (action === 'link-group') setLinkingGroupRef(groupRef || null);
    try {
      const response = await fetch('/api/line/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomId: classroom.id, action, groupRef }),
      });
      const result = await readActionResult(response, tr);
      const data = result.data as { status?: 'connected' | 'disconnected'; groupName?: string; connectedAt?: string; testQuota?: LineTestQuotaInfo; lineMessagesLeft?: number };
      // The server may have found the link broken (bot removed from the group) and undone it.
      if (data.status) {
        setLineConnection((current) => ({ ...current, ...data, status: data.status! }));
        setClassroom((prev) => (prev ? {
          ...prev,
          line_connection_status: data.status,
          ...(data.status === 'disconnected' ? { line_group_id: undefined, line_group_name: undefined } : {}),
          ...(data.status === 'connected' ? { line_group_id: prev.line_group_id || 'linked', line_group_name: data.groupName || prev.line_group_name } : {}),
        } : null));
      }
      if (!result.ok) {
        showToast(result.message, result.tone);
        return;
      }
      if (action === 'link-group' && groupRef) dropLineGroup(groupRef);
      // A toast (not the page notice), so it shows above the open dialog.
      showToast(
        action === 'disconnect'
          ? tr('ยกเลิกการเชื่อมต่อแล้ว บอทออกจากกลุ่มแล้ว', 'Disconnected; the bot left the group')
          : action === 'test'
          ? tr(`ส่งข้อความทดสอบเข้ากลุ่ม${data.groupName ? ` “${data.groupName}”` : ''} แล้ว`, `Test message sent${data.groupName ? ` to “${data.groupName}”` : ''}`) + testQuotaNote(data.testQuota, tr) + lineMessagesLeftNote(data.lineMessagesLeft, tr)
          : tr(`เชื่อม LINE Group${data.groupName ? ` “${data.groupName}”` : ''} เรียบร้อยแล้ว`, `LINE group${data.groupName ? ` “${data.groupName}”` : ''} connected`)
      );
    } catch {
      showToast(networkErrorMessage(tr), 'error');
    } finally {
      setIsLineLoading(false);
      setLinkingGroupRef(null);
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
        submissionsVersionRef.current = cacheVersion();
        return;
      }
    } else {
      setLoading(true);
    }
    const startedAt = cacheVersion();
    try {
      // Fire all requests concurrently in parallel. With the cached copy already
      // on screen this is a silent refresh (no loading signal).
      const background = !!hit;
      const fetchAll = () =>
        Promise.all([
          dataService.getClassroomById(classroomId),
          dataService.getAssignmentsByClassroomId(classroomId),
          fetch(`/api/classrooms/posts?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' }),
          fetch(`/api/attendance?classroomId=${encodeURIComponent(classroomId)}&allRecords=1`, { cache: 'no-store' }),
        ]);
      const [current, classAssignments, postsRes, attRes] = await (background ? quietly(fetchAll) : fetchAll());

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
      const submissionsLoaded =
        classAssignments.length > 0
          ? background
            ? quietly(() => refreshSubmissions(classAssignments))
            : refreshSubmissions(classAssignments)
          : Promise.resolve([]);
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
      setNotice(tr('โหลดข้อมูลห้องเรียนไม่สำเร็จ', 'Could not load the classroom'));
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
  // when the last one is only a few seconds old. The cache version at fetch
  // time tells whether anything (a grade saved here or in another tab, a
  // server signal) may have changed scores since.
  const submissionsFetchedAtRef = useRef(0);
  const submissionsVersionRef = useRef(-1);
  const refreshSubmissions = (list: Assignment[], maxAgeMs = 0) => {
    if (!list.length || Date.now() - submissionsFetchedAtRef.current < maxAgeMs) return Promise.resolve(undefined);
    submissionsFetchedAtRef.current = Date.now();
    submissionsVersionRef.current = cacheVersion();
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

  // Grades tab: the scores already held (from the session cache or the last
  // fetch) show at once. They are refetched in the background only when a score
  // may have changed since (any write or classroom signal bumps the cache
  // version) or they are a few minutes old; the spinner is only for a first load.
  const hasSubmissions = submissions.length > 0;
  useEffect(() => {
    if (tab !== 'grades' || !assignments.length) return;
    const unchanged = submissionsVersionRef.current === cacheVersion();
    if (unchanged && Date.now() - submissionsFetchedAtRef.current < 5 * 60 * 1000) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- spinner only until the first scores arrive
    if (!hasSubmissions) setGradesLoading(true);
    refreshSubmissions(assignments).finally(() => setGradesLoading(false));
  }, [tab, assignments, hasSubmissions]);

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

  // Re-render when the next scheduled assignment goes live (or a deadline passes), so its
  // badge and timeline entry flip from "scheduled" / "open" without a refresh.
  const nowMs = useScheduleNow(assignments);

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

      let title = tr('ประกาศ', 'Announcement');
      let badgeLabel = tr('ประกาศ', 'Announcement');
      let badgeColor = 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300';

      if (post.activity_type === 'assignment') {
        title = tr('มอบหมายงานใหม่', 'New assignment');
        badgeLabel = tr('งาน', 'Assignment');
        badgeColor = 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300';
      } else if (post.activity_type === 'exam' && (post.metadata as { retake?: boolean } | undefined)?.retake) {
        title = tr('สร้างข้อสอบซ่อม', 'New retake');
        badgeLabel = tr('สอบซ่อม', 'Retake');
        badgeColor = 'bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300';
      } else if (post.activity_type === 'exam') {
        title = tr('สร้างข้อสอบใหม่', 'New exam');
        badgeLabel = tr('ข้อสอบ', 'Exam');
        badgeColor = 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300';
      } else if (post.activity_type === 'attendance') {
        title = tr('เปิดคาบเช็กชื่อ', 'Attendance opened');
        badgeLabel = tr('เช็กชื่อ', 'Attendance');
        badgeColor = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300';
      }

      // Check content key to avoid duplicate identical messages
      const normalizedBody = post.body.replace(/^(ข้อสอบใหม่:|งานใหม่:|เปิดคาบเช็กชื่อ:)\s*/, '').trim().toLowerCase();
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
        lineShare: post.line_share,
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
        title: item.is_exam ? tr('ข้อสอบในระบบ', 'Exam') : tr('งานที่มอบหมาย', 'Assignment'),
        body: `${item.title} (${item.is_exam ? tr('ปิดรับ', 'Closes') : tr('กำหนดส่ง', 'Due')}: ${formatDateTime(item.due_date, language)})`,
        type: item.is_exam ? ('exam' as const) : ('assignment' as const),
        badgeLabel: item.is_exam ? tr('ข้อสอบ', 'Exam') : tr('งาน', 'Assignment'),
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
        title: tr('เปิดคาบเช็กชื่อ', 'Attendance opened'),
        body: `${item.title} (${tr('สถานะ', 'Status')}: ${item.status === 'open' ? tr('เปิดรับอยู่', 'open') : tr('ปิดแล้ว', 'closed')})`,
        type: 'attendance' as const,
        badgeLabel: tr('เช็กชื่อ', 'Attendance'),
        badgeColor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
        created_at: item.starts_at,
      });
    }

    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [posts, assignments, sessions, nowMs, tr, language]);


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
      // A retake has no column: its scores are in the original quiz's column.
      assignments
        .filter((a) => !isRetake(a))
        .sort((a, b) => new Date(a.created_at || a.due_date).getTime() - new Date(b.created_at || b.due_date).getTime()),
    [assignments]
  );

  /** "<done>" plus what happened in LINE, for the notice banner. */
  const lineNotice = (line: unknown, done: string) =>
    line === 'quota'
      ? `${done} ${tr('แต่ส่งเข้ากลุ่ม LINE ไม่ได้: โควตาข้อความ LINE ของเดือนนี้หมดแล้ว (ส่งเข้ากลุ่มนับ 1 ข้อความต่อสมาชิก 1 คน)', 'but not sent to LINE: this month’s LINE message quota is used up (a group message counts once per member)')}`
      : line === 'failed'
      ? `${done} ${tr('แต่ส่งเข้ากลุ่ม LINE ไม่สำเร็จ', 'but sending to the LINE group failed')}`
      : line === 'no_group'
      ? `${done} ${tr('(ห้องนี้ยังไม่ได้เชื่อมกลุ่ม LINE)', '(this class is not linked to a LINE group yet)')}`
      : `${done} ${tr('และแจ้งเข้ากลุ่ม LINE แล้ว', 'and sent to the LINE group')}`;

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
        setNotice(tr('บันทึกโพสต์ไม่สำเร็จ ลองใหม่อีกครั้ง', 'Could not save the post, please try again'));
        return;
      }
      const result = await response.json().catch(() => ({}));
      setPostBody('');
      setIsPostExpanded(false);
      setNotice(lineNotice(result.line, tr('โพสต์แล้ว', 'Posted')));
      // The bot could not send it: offer to share it from the teacher's own LINE.
      reportLineUnsent(result.line, result.share);
      await loadWorkspace();
    } catch {
      setNotice(tr('เกิดข้อผิดพลาดในการโพสต์', 'Something went wrong while posting'));
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
        setNotice(tr('แก้ไขโพสต์เรียบร้อยแล้ว', 'Post updated'));
        setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, body: newBody.trim() } : p)));
        setEditingPost(null);
      } else {
        setNotice(tr('แก้ไขโพสต์ไม่สำเร็จ', 'Could not update the post'));
      }
    } catch {
      setNotice(tr('เกิดข้อผิดพลาดในการแก้ไขโพสต์', 'Something went wrong while updating the post'));
    } finally {
      setIsUpdatingPost(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    if (!confirm(tr('ลบโพสต์นี้?', 'Delete this post?'))) return;
    try {
      const res = await fetch(`/api/classrooms/posts?id=${encodeURIComponent(postId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setNotice(tr('ลบโพสต์เรียบร้อยแล้ว', 'Post deleted'));
        setPosts((prev) => prev.filter((p) => p.id !== postId));
      } else {
        setNotice(tr('ลบโพสต์ไม่สำเร็จ', 'Could not delete the post'));
      }
    } catch {
      setNotice(tr('เกิดข้อผิดพลาดในการลบโพสต์', 'Something went wrong while deleting the post'));
    }
  };

  // ----------------------------------------------------
  // CRUD HANDLERS: ASSIGNMENTS / EXAMS
  // ----------------------------------------------------
  const handleDeleteAssignment = async (assignmentId: string) => {
    if (!confirm(tr('ลบงาน/ข้อสอบนี้? คำตอบและคะแนนทั้งหมดจะถูกลบด้วย', 'Delete this assignment/exam? All answers and scores will be deleted too.'))) return;
    try {
      await dataService.deleteAssignment(assignmentId);
      setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
      setSubmissions((prev) => prev.filter((s) => s.assignment_id !== assignmentId));
      // The server removed its timeline announcement(s) too.
      setPosts((prev) => prev.filter((p) => p.metadata?.assignmentId !== assignmentId));
      setNotice(tr('ลบงาน/ข้อสอบแล้ว', 'Assignment/exam deleted'));
    } catch {
      setNotice(tr('เกิดข้อผิดพลาดในการลบงาน/ข้อสอบ', 'Something went wrong while deleting'));
    }
  };

  // The class reached the topic before the scheduled time: release it now.
  /** What the bot did, for the notice; when it could not, the share popup is already open. */
  const botNotice = (line: string, sent: string) =>
    line === 'card'
      ? tr('กด “ส่งเข้ากลุ่ม” ในหน้าต่างที่เปิดขึ้น แล้วเลือกกลุ่ม LINE ของห้อง', 'Tap “Send to group” in the window that opened and pick the class LINE group')
      : line === 'sent'
      ? sent
      : line === 'no_group'
      ? tr('ห้องนี้ยังไม่เชื่อมกลุ่ม LINE — แชร์เองได้จากหน้าต่างที่เปิดขึ้น', 'No linked LINE group — share it from the window that opened')
      : line === 'quota'
      ? tr('โควตา LINE เดือนนี้ไม่พอ — แชร์เองได้จากหน้าต่างที่เปิดขึ้น', 'Not enough LINE quota this month — share it from the window that opened')
      : tr('บอทส่งไม่ได้ตอนนี้ — แชร์เองได้จากหน้าต่างที่เปิดขึ้น', 'The bot could not send it — share it from the window that opened');

  /** "ทวงงาน": the bot names who has not handed in; the share popup opens whenever it cannot send. */
  const handleRemindAssignment = async (assignment: Assignment) => {
    try {
      const line = await dataService.remindAssignment(assignment.id, assignment.title);
      setNotice(line === 'none' ? tr('นักเรียนส่งงานนี้ครบแล้ว', 'Everyone has handed this in') : botNotice(line, tr('ทวงงานในกลุ่ม LINE แล้ว', 'Reminder sent to the LINE group')));
    } catch (err) {
      setNotice(err instanceof Error && err.message ? err.message : tr('ทวงงานไม่สำเร็จ', 'Could not send the reminder'));
    }
  };

  /**
   * "ประกาศคะแนน": work still taking hand-ins is closed first (results only show
   * once it is closed), after the teacher confirms; then the bot posts to the
   * group, or the share popup opens whenever it cannot.
   */
  const handleAnnounceResults = async (assignment: Assignment) => {
    try {
      const result = await dataService.announceResults(assignment.id, assignment.title);
      if (result.assignment) setAssignments((prev) => prev.map((a) => (a.id === assignment.id ? { ...a, ...result.assignment } : a)));
      const sent = botNotice(result.line, tr('ประกาศคะแนนในกลุ่ม LINE แล้ว', 'Scores announced in the LINE group'));
      setNotice(result.closed ? `${tr('ปิดรับงานแล้ว', 'Closed')} • ${sent}` : sent);
    } catch (err) {
      setNotice(err instanceof Error && err.message ? err.message : tr('ประกาศคะแนนไม่สำเร็จ', 'Could not announce the scores'));
    }
  };

  const handleReannounceAssignment = async (assignment: Assignment) => {
    try {
      const line = await dataService.reannounceAssignment(assignment.id, assignment.title);
      setNotice(botNotice(line, tr('ส่งเข้า LINE แล้ว', 'Posted to LINE')));
    } catch (err) {
      setNotice(err instanceof Error && err.message ? err.message : tr('ส่งไม่สำเร็จ', 'Could not post'));
    }
  };


  /** A timeline post sent to the LINE group again by the bot (share popup when it cannot). */
  const handleResendPost = async (postId: string, title?: string) => {
    try {
      const line = await dataService.resendPost(postId, title);
      setNotice(botNotice(line, tr('ส่งเข้า LINE อีกครั้งแล้ว', 'Sent to LINE again')));
      if (line === 'sent') await loadWorkspace();
    } catch (err) {
      setNotice(err instanceof Error && err.message ? err.message : tr('ส่งไม่สำเร็จ', 'Could not send'));
    }
  };

  const handlePublishAssignmentNow = async (assignment: Assignment) => {
    const kind = assignment.is_exam ? tr('ข้อสอบ', 'exam') : tr('งาน', 'assignment');
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
      setNotice(tr(`เผยแพร่${kind} "${assignment.title}" แล้ว นักเรียนเริ่มทำได้ทันที`, `Published the ${kind} "${assignment.title}". Students can start now.`));
    } catch (err) {
      setNotice(err instanceof Error && err.message ? err.message : tr('เผยแพร่งานไม่สำเร็จ', 'Could not publish'));
    }
  };

  const handleAddGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    setCustomGroups((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setShowAddGroupModal(false);
    setNewGroupName('');
    setNotice(tr(`เพิ่มหมวดหมู่ "${name}" แล้ว ลากงานมาวางในกลุ่มนี้เพื่อบันทึก`, `Added group "${name}". Drag work into it to save.`));
  };

  // Classwork progress per assignment (same counts as the grading hub).
  const [classworkFilter, setClassworkFilter] = useState<ClassworkFilter>('all');
  // Same slide as switching tabs: the highlight glides and the list enters from that side.
  const [classworkFilterDirection, setClassworkFilterDirection] = useState<1 | -1>(1);
  const [trackClassworkFilterBar, classworkFilterIndicator] = useSlidingIndicator(classworkFilter);
  const selectClassworkFilter = (next: ClassworkFilter) => {
    if (next === classworkFilter) return;
    const order = CLASSWORK_FILTERS.map((f) => f.id);
    setClassworkFilterDirection(order.indexOf(next) > order.indexOf(classworkFilter) ? 1 : -1);
    setClassworkFilter(next);
  };
  const classworkCounts = useMemo(() => {
    const bySubmission = new Map<string, Submission[]>();
    for (const s of submissions) bySubmission.set(s.assignment_id, [...(bySubmission.get(s.assignment_id) || []), s]);
    const total = classroom?.students?.length || 0;
    return new Map(assignments.map((a) => [a.id, gradingCounts(bySubmission.get(a.id) || [], rosterSizeFor(a, total), a.is_exam)]));
  }, [assignments, submissions, classroom?.students?.length]);
  const classworkSummary = useMemo(() => {
    const all = [...classworkCounts.values()];
    return {
      pending: all.reduce((sum, c) => sum + c.pending, 0),
      graded: all.reduce((sum, c) => sum + c.graded, 0),
      checkable: all.reduce((sum, c) => sum + c.checkable, 0),
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

  // Collapsed categories, remembered per classroom. Default groups use a language-independent key.
  const { isOpen: isClassworkGroupOpen, toggle: toggleClassworkGroup } = useCollapsedGroups(`classwork:${classroomId}`);
  const unpublishedGroupLabel = tr('ยังไม่เผยแพร่', 'Not published');
  const classworkFoldKey = (group: string) =>
    group === tr('ข้อสอบ', 'Exam') ? '__exam' : group === tr('งานทั่วไป', 'General') ? '__general' : group === unpublishedGroupLabel ? '__unpublished' : group;
  const groupKeyOf = (item: Assignment) => item.group_name || (item.is_exam ? tr('ข้อสอบ', 'Exam') : tr('งานทั่วไป', 'General'));
  // Dragged order first (new work without a position on top), then newest first.
  const byClassworkOrder = (a: Assignment, b: Assignment) =>
    (a.sort_order ?? -1) - (b.sort_order ?? -1) ||
    new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();

  // Categories with their work (filtered), in the order the teacher dragged
  // them into (kept per classroom in this browser); new ones go last.
  // Drafts and scheduled work wait in "ยังไม่เผยแพร่" (first by default) and
  // join their own category once published.
  const unpublishedWork = assignments.filter((a) => !isAssignmentPublished(a, nowMs));
  const classworkGroups = [
    ...(unpublishedWork.length ? [[unpublishedGroupLabel, unpublishedWork] as [string, Assignment[]]] : []),
    ...Object.entries(
      assignments
        .filter((a) => isAssignmentPublished(a, nowMs))
        .reduce<Record<string, Assignment[]>>(
          (groups, item) => {
            (groups[groupKeyOf(item)] ||= []).push(item);
            return groups;
          },
          Object.fromEntries(customGroups.map((name) => [name, [] as Assignment[]]))
        )
    ),
  ]
    .map(([group, unsorted]) => [group, [...unsorted].sort(byClassworkOrder).filter((a) => matchesClassworkFilter(a.id))] as const)
    .filter(([group, items]) => (classworkFilter === 'all' && classworkFoldKey(group) !== '__unpublished') || items.length > 0);
  const groupOrderScope = `classwork-groups:${classroomId}`;
  // Tagged with its classroom: moving to another classroom keeps this page mounted.
  const [groupOrderState, setGroupOrderState] = useState<{ scope: string; keys: string[] }>(() => ({
    scope: groupOrderScope,
    keys: typeof window === 'undefined' ? [] : readLocalOrder(groupOrderScope),
  }));
  if (groupOrderState.scope !== groupOrderScope) setGroupOrderState({ scope: groupOrderScope, keys: readLocalOrder(groupOrderScope) });
  const savedGroupOrder = groupOrderState.scope === groupOrderScope ? groupOrderState.keys : [];
  const sortedClassworkGroups = applySavedOrder(
    classworkGroups,
    ([group]) => classworkFoldKey(group),
    savedGroupOrder,
    // Not dragged yet: "ยังไม่เผยแพร่" goes first, a new category last.
    ([group]) => classworkFoldKey(group) === '__unpublished'
  );
  const {
    bindList: bindGroupList,
    bindItem: bindGroupItem,
    order: groupOrder,
    dragKey: groupDragKey,
    itemStyle: groupItemStyle,
    handleProps: groupHandleProps,
  } = useDragReorder(
    // "ยังไม่เผยแพร่" is pinned on top (shown above the list, never dragged), so only the
    // real categories take part. Its saved place (from before it was pinned) no longer matters.
    sortedClassworkGroups.map(([group]) => classworkFoldKey(group)).filter((key) => key !== '__unpublished'),
    (keys) => {
      const next = [...keys, ...savedGroupOrder.filter((k) => !keys.includes(k))];
      setGroupOrderState({ scope: groupOrderScope, keys: next });
      writeLocalOrder(groupOrderScope, next);
    }
  );
  const pinnedClassworkGroups = sortedClassworkGroups.filter(([group]) => classworkFoldKey(group) === '__unpublished');
  const draggableClassworkGroups = groupOrder
    .map((key) => sortedClassworkGroups.find(([group]) => classworkFoldKey(group) === key))
    .filter((entry): entry is (typeof sortedClassworkGroups)[number] => !!entry);
  /** Unpublished work always first, then the categories in the teacher's order. */
  const orderedClassworkGroups = [...pinnedClassworkGroups, ...draggableClassworkGroups];

  // Category ⋯ menu: details, rename (all its work), colour, status of all its work.
  const [categoryColorState, setCategoryColorState] = useState<{ scope: string; colors: Record<string, WorkColor> }>(() => ({
    scope: classroomId,
    colors: typeof window === 'undefined' ? {} : readCategoryColors(classroomId),
  }));
  if (categoryColorState.scope !== classroomId) setCategoryColorState({ scope: classroomId, colors: readCategoryColors(classroomId) });
  const categoryColors = categoryColorState.scope === classroomId ? categoryColorState.colors : {};
  const setCategoryColor = (foldKey: string, color: WorkColor | null) => {
    const next = { ...categoryColors };
    if (color) next[foldKey] = color;
    else delete next[foldKey];
    setCategoryColorState({ scope: classroomId, colors: next });
    writeCategoryColors(classroomId, next);
  };
  const [categoryDetail, setCategoryDetail] = useState<string | null>(null);
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [categoryStatus, setCategoryStatus] = useState<string | null>(null);
  /** Every work of a category (not only what the filter shows). */
  const categoryItems = (group: string) =>
    classworkFoldKey(group) === '__unpublished' ? unpublishedWork : assignments.filter((a) => isAssignmentPublished(a, nowMs) && groupKeyOf(a) === group);
  const countsFor = (a: Assignment) => classworkCounts.get(a.id) || gradingCounts([], rosterSizeFor(a, classroom?.students?.length || 0), a.is_exam);
  const workClassesOf = (group: string): WorkClass[] =>
    classroom
      ? categoryItems(group).map((a) => ({ assignment: a, classroom, counts: countsFor(a), window: getAssignmentWindow(a), published: isAssignmentPublished(a) }))
      : [];
  const renameCategory = async (group: string, name: string) => {
    // Drafts that will join this category move too.
    const all = assignments.filter((a) => groupKeyOf(a) === group);
    if (all.length) {
      await dataService.reorderAssignments(
        classroomId,
        all.map((a, index) => ({ id: a.id, sort_order: a.sort_order ?? index, group_name: name }))
      );
      const ids = new Set(all.map((a) => a.id));
      setAssignments((prev) => prev.map((a) => (ids.has(a.id) ? { ...a, group_name: name } : a)));
    }
    setCustomGroups((prev) => prev.map((g) => (g === group ? name : g)));
    const oldKey = classworkFoldKey(group);
    if (categoryColors[oldKey]) {
      const moved: Record<string, WorkColor> = {};
      for (const [k, v] of Object.entries(categoryColors)) moved[k === oldKey ? name : k] = v;
      setCategoryColorState({ scope: classroomId, colors: moved });
      writeCategoryColors(classroomId, moved);
    }
    const nextOrder = savedGroupOrder.map((k) => (k === oldKey ? name : k));
    setGroupOrderState({ scope: groupOrderScope, keys: nextOrder });
    writeLocalOrder(groupOrderScope, nextOrder);
    setNotice(tr(`เปลี่ยนชื่อหมวดเป็น “${name}” แล้ว`, `Category renamed to “${name}”`));
  };
  const categoryMenu = (group: string, foldKey: string): ActionMenuItem[] => {
    const color = categoryColors[foldKey];
    const items = categoryItems(group);
    return [
      { key: 'detail', label: tr('ดูรายละเอียด', 'See details'), icon: <EyeIcon className="w-4 h-4" />, onSelect: () => setCategoryDetail(group) },
      foldKey !== '__unpublished' && {
        key: 'rename',
        label: tr('แก้ไขหมวดหมู่', 'Edit category'),
        hint: items.length ? tr(`${items.length} งาน`, `${items.length}`) : undefined,
        icon: <PencilIcon className="w-4 h-4" />,
        onSelect: () => setRenamingCategory(group),
      },
      items.length > 0 && {
        key: 'status',
        label: foldKey === '__unpublished' ? tr('เผยแพร่ / เปลี่ยนสถานะ', 'Publish / change status') : tr('เปลี่ยนสถานะทุกงาน', 'Change status (all)'),
        hint: tr(`${items.length} งาน`, `${items.length}`),
        icon: <ClockIcon className="w-4 h-4" />,
        onSelect: () => setCategoryStatus(group),
      },
      {
        key: 'color',
        label: tr('สีการ์ด', 'Card colour'),
        icon: color ? <span className={`w-3 h-3 rounded-full ${WORK_COLOR_CLASSES[color].swatch}`} /> : <Palette className="w-4 h-4" />,
        panel: {
          title: tr('สีการ์ด', 'Card colour'),
          render: (close: () => void) => (
            <div className="grid grid-cols-4 gap-1.5 p-1.5">
              <button
                type="button"
                onClick={() => {
                  setCategoryColor(foldKey, null);
                  close();
                }}
                aria-label={tr('สีปกติ', 'Default')}
                className={`h-10 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 flex items-center justify-center text-slate-400 cursor-pointer hover:ring-slate-400 ${!color ? 'ring-2 ring-slate-900 dark:ring-white' : ''}`}
              >
                <XIcon className="w-4 h-4" />
              </button>
              {WORK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setCategoryColor(foldKey, c);
                    close();
                  }}
                  aria-label={tr(WORK_COLOR_CLASSES[c].label[0], WORK_COLOR_CLASSES[c].label[1])}
                  className={`h-10 rounded-xl flex items-center justify-center cursor-pointer ${WORK_COLOR_CLASSES[c].swatch} ${color === c ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white dark:ring-offset-slate-900' : 'hover:brightness-95'}`}
                >
                  {color === c && <CheckMark className="w-4 h-4 text-white" />}
                </button>
              ))}
            </div>
          ),
        },
      },
    ].filter(Boolean) as ActionMenuItem[];
  };

  /**
   * A card dropped into `group` at `index` (counted in that group's list as
   * shown, including the dragged card if it is already there). Reorders the
   * group and, when it came from another group, moves it; the default groups
   * (งานทั่วไป / ข้อสอบ) mean "no group name".
   */
  /**
   * Drops a row into `group`, before the shown row `beforeId` (null: after the last shown
   * row). By row, not by position: the stored list of a category also holds its
   * unpublished work (shown in its own section), so positions on screen and in the
   * list differ.
   */
  const handleDropAssignment = async (assignmentId: string, group: string, beforeId: string | null, lastShownId: string | null) => {
    const item = assignments.find((a) => a.id === assignmentId);
    if (!item) return;
    const fromGroup = groupKeyOf(item);
    const full = assignments.filter((a) => groupKeyOf(a) === group).sort(byClassworkOrder);
    const list = full.filter((a) => a.id !== assignmentId);
    let target = list.length;
    if (beforeId && beforeId !== assignmentId) {
      const at = list.findIndex((a) => a.id === beforeId);
      if (at !== -1) target = at;
    } else if (lastShownId && lastShownId !== assignmentId) {
      const at = list.findIndex((a) => a.id === lastShownId);
      if (at !== -1) target = at + 1;
    }
    list.splice(target, 0, item);
    // Dropped where it already is.
    if (fromGroup === group && list.every((a, i) => a.id === full[i]?.id)) return;

    const fallback = item.is_exam ? tr('ข้อสอบ', 'Exam') : tr('งานทั่วไป', 'General');
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
      if (newGroupName !== undefined) setNotice(tr(`ย้าย “${item.title}” ไปยังหมวดหมู่ "${group}" เรียบร้อย`, `Moved “${item.title}” to "${group}"`));
    } catch (error) {
      setAssignments(previous);
      setNotice(error instanceof Error && error.message ? error.message : tr('บันทึกลำดับงานไม่สำเร็จ', 'Could not save the order'));
    }
  };
  // Classwork: drag a row from anywhere on it (mouse: move a little; finger:
  // press and hold), into a position in any category.
  const classworkDrag = useCrossListDrag({
    onStart: (id, source, size) => {
      setDraggingAssignmentId(id);
      setClassworkDragInfo({ id, source, size });
    },
    onOver: (target) => {
      setDropTarget(target);
      setDragOverGroup(target?.group ?? null);
      // Held over a folded category for a moment: open it, so the row can go anywhere in it.
      const pending = foldOpenTimer.current;
      if (pending && pending.group !== target?.group) {
        window.clearTimeout(pending.timer);
        foldOpenTimer.current = null;
      }
      if (target && !foldOpenTimer.current && !isClassworkGroupOpen(classworkFoldKey(target.group))) {
        const group = target.group;
        foldOpenTimer.current = {
          group,
          timer: window.setTimeout(() => {
            foldOpenTimer.current = null;
            if (!isClassworkGroupOpen(classworkFoldKey(group))) toggleClassworkGroup(classworkFoldKey(group));
          }, 650),
        };
      }
    },
    onDrop: (id, target) => {
      const shown = orderedClassworkGroups.find(([group]) => group === target.group)?.[1] || [];
      void handleDropAssignment(id, target.group, shown[target.index]?.id ?? null, shown[shown.length - 1]?.id ?? null);
    },
    onEnd: () => {
      if (foldOpenTimer.current) window.clearTimeout(foldOpenTimer.current.timer);
      foldOpenTimer.current = null;
      setDraggingAssignmentId(null);
      setClassworkDragInfo(null);
      setDragOverGroup(null);
      setDropTarget(null);
    },
  });


  const handleUpdateAssignmentGroup = async (assignmentId: string, newGroup: string) => {
    const clean = newGroup.trim();
    try {
      // '' (not undefined, which JSON drops) so moving back to the default group really clears it.
      await dataService.updateAssignment(assignmentId, { group_name: clean });
      setAssignments((prev) =>
        prev.map((a) => (a.id === assignmentId ? { ...a, group_name: clean || undefined } : a))
      );
      setEditingAssignmentGroup(null);
      setNotice(tr(`ย้ายงานไปยังหมวดหมู่ "${clean || tr('งานทั่วไป', 'General')}" เรียบร้อย`, `Moved to "${clean || 'General'}"`));
    } catch {
      setNotice(tr('อัปเดตกลุ่มงานไม่สำเร็จ', 'Could not update the group'));
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
        const { records = [] } = (await res.json().catch(() => ({}))) as { records?: AttendanceRecord[] };
        if (records.length) {
          attendanceVersionRef.current++;
          setAllRecords((prev) => records.reduce(upsertRecord, prev));
        }
        setNotice(tr('อัปเดตคาบเช็กชื่อแล้ว', 'Attendance period updated'));
        patchSession(sessionId, {
          title: newTitle,
          ...(newStatus ? { status: newStatus, closed_at: newStatus === 'closed' ? new Date().toISOString() : null } : {}),
          ...(startsAt ? { starts_at: startsAt } : {}),
          ...(onTime !== undefined ? { on_time_until_minutes: onTime } : {}),
          ...(late !== undefined ? { late_until_minutes: late } : {}),
        });
        setEditingSession(null);
        // Reopening clears the automatic absences on the server; pick that up.
        if (newStatus === 'open') loadAttendance();
      } else {
        setNotice(tr('อัปเดตคาบเช็กชื่อไม่สำเร็จ', 'Could not update the period'));
      }
    } catch {
      setNotice(tr('เกิดข้อผิดพลาดในการอัปเดตคาบเช็กชื่อ', 'Something went wrong while updating the period'));
    } finally {
      setIsUpdatingSession(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm(tr('ลบคาบเช็กชื่อนี้และบันทึกทั้งหมด?', 'Delete this period and all its records?'))) return;
    try {
      const res = await fetch(
        `/api/attendance?sessionId=${encodeURIComponent(sessionId)}&classroomId=${encodeURIComponent(classroomId)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        setNotice(tr('ลบคาบเช็กชื่อแล้ว', 'Period deleted'));
        attendanceVersionRef.current++;
        const remaining = sessions.filter((s) => s.id !== sessionId);
        setSessions(remaining);
        setAllRecords((prev) => prev.filter((r) => r.session_id !== sessionId));
        if (selectedSessionId === sessionId) setSelectedSessionId(remaining[0]?.id || null);
      } else {
        setNotice(tr('ลบคาบเช็กชื่อไม่สำเร็จ', 'Could not delete the period'));
      }
    } catch {
      setNotice(tr('เกิดข้อผิดพลาดในการลบคาบเช็กชื่อ', 'Something went wrong while deleting the period'));
    }
  };

  /** Opens a check-in period; returns its id so the panel can show its QR. */
  const createAttendance = async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Only the name: the server sets the timing (on time for 15 minutes, then late until closed).
        body: JSON.stringify({ classroomId, title: attendanceTitle }),
      });
      if (!response.ok) {
        setNotice(tr('สร้างคาบเช็กชื่อไม่สำเร็จ', 'Could not create the period'));
        return null;
      }
      const { session: created } = (await response.json()) as { session: AttendanceSession };
      // Check-in is by the QR on this screen only (nothing goes to LINE): the panel shows it next.
      setNotice(tr('เปิดคาบเช็กชื่อแล้ว — ให้นักเรียนสแกน QR บนหน้าจอ', 'Attendance opened — students scan the QR on screen'));
      // The response is the full session row, so show and select it without a refetch.
      attendanceVersionRef.current++;
      setSessions((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
      setSelectedSessionId(created.id);
      fetch(`/api/classrooms/posts?classroomId=${encodeURIComponent(classroomId)}`, { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => json && setPosts(json.posts || []))
        .catch(() => {});
      return created.id;
    } catch {
      setNotice(tr('เกิดข้อผิดพลาดในการเปิดคาบเช็กชื่อ', 'Something went wrong while opening attendance'));
      return null;
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
      setNotice(tr('บันทึกการเข้าเรียนไม่สำเร็จ ลองใหม่', 'Could not save attendance, try again'));
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
    // Closing marks everyone who never checked in absent (the server does the same).
    const sessionIndex = indexRecords(allRecords.filter((r) => r.session_id === sessionId));
    const pendingAbsent: AttendanceRecord[] =
      action === 'close'
        ? (classroom?.students || [])
            .filter((student) => !findStudentRecord(sessionIndex, student))
            .map((student) => ({ id: `pending-${sessionId}-${student.id}`, session_id: sessionId, student_id: student.id, status: 'absent', checked_at: null }))
        : [];
    const withoutPending = (prev: AttendanceRecord[]) => prev.filter((r) => !pendingAbsent.includes(r));
    if (pendingAbsent.length) setAllRecords((prev) => [...prev, ...pendingAbsent]);
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
      if (pendingAbsent.length) {
        const { records = [] } = (await response.json()) as { records?: AttendanceRecord[] };
        attendanceVersionRef.current++;
        // The server may store the canonical users.id instead of the roster id.
        setAllRecords((prev) => records.reduce(upsertRecord, withoutPending(prev)));
      }
    } catch {
      patchSession(sessionId, target);
      if (pendingAbsent.length) setAllRecords(withoutPending);
      setNotice(action === 'close' ? tr('ปิดรับเช็กชื่อไม่สำเร็จ', 'Could not close attendance') : tr('ขยายเวลาไม่สำเร็จ', 'Could not extend the time'));
    }
  };

  // Export every session: one row per student, one column per session (oldest first)
  const exportAllAttendance = () => {
    if (!classroom || !sessions.length) return;
    const ordered = [...sessions].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    const indexes = ordered.map((s) => indexRecords(allRecords.filter((r) => r.session_id === s.id)));
    downloadCsv(`attendance-all-${classroom.name}-${csvDateStamp()}.csv`, [
      [tr('ชื่อ-นามสกุล', 'Full name'), tr('รหัสนักเรียน', 'Student ID'), ...ordered.map((s) => `${s.title} (${formatDateTime(s.starts_at, language)})`), ...Object.values(statusLabels).map((label) => label[language])],
      ...(classroom.students || []).map((student) => {
        const statuses = indexes.map((index) => findStudentRecord(index, student)?.status || 'absent');
        const totals = (Object.keys(statusLabels) as AttendanceStatus[]).map((key) => statuses.filter((s) => s === key).length);
        return [
          `${student.first_name} ${student.last_name}`,
          student.student_id || '',
          ...statuses.map((status) => statusLabels[status][language]),
          ...totals,
        ];
      }),
    ]);
  };

  // Export the grade book: one row per student, one column per assignment/quiz (in the order given)
  const exportGrades = () => {
    if (!classroom) return;
    downloadCsv(`grades-${classroom.name}-${csvDateStamp()}.csv`, [
      [tr('ชื่อ-นามสกุล', 'Full name'), tr('รหัสนักเรียน', 'Student ID'), ...gradeColumns.map((item) => `${item.is_exam ? tr('[ข้อสอบ] ', '[Exam] ') : tr('[งาน] ', '[Work] ')}${item.title} (${tr('เต็ม', 'out of')} ${item.total_points || 20})`), tr('คะแนนรวม', 'Total')],
      ...(classroom.students || []).map((student) => {
        const scores = gradeColumns.map((item) => {
          const sub = findStudentSubmission(submissions, item.id, student);
          return sub && isGraded(sub) ? sub.total_score ?? '-' : sub && needsGrading(sub) ? tr('รอตรวจ', 'To grade') : '-';
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
    const lines = others.map((student) => `• ${student.first_name} ${student.last_name} — ${institutionLabel(student.institution, language)}`).join('\n');
    const teacherSchool = institutionLabel(teacherInstitution, language);
    return confirm(
      tr(
        `⚠️ นักเรียนต่อไปนี้ระบุโรงเรียนต่างจากโรงเรียนของคุณครู (${teacherSchool})\n\n${lines}\n\n` +
          'หากนักเรียนกรอกชื่อโรงเรียนผิด คุณครูสามารถแก้ไขได้ภายหลังที่แท็บ "ผู้สอนและผู้เรียน"\n\nยืนยันรับเข้าห้องเรียนหรือไม่?',
        `⚠️ These students listed a different school from yours (${teacherSchool})\n\n${lines}\n\n` +
          'If a student typed the school wrong, you can fix it later in the "People" tab.\n\nAdmit them to the classroom?'
      )
    );
  };

  const handleRemoveTeacher = async (teacherId: string) => {
    if (!classroom) return;
    if (teachersList.length <= 1) {
      alert(tr('ลบไม่ได้ ห้องเรียนต้องมีครูผู้สอนอย่างน้อย 1 ท่าน', 'Cannot remove: a classroom needs at least one teacher'));
      return;
    }
    const message = classroom.course_id
      ? tr('นำครูท่านนี้ออกจากรายวิชา? (ออกจากทุกห้องของวิชานี้)', 'Remove this teacher from the course? (every class of it)')
      : tr('ต้องการนำครูผู้สอนท่านนี้ออกจากห้องเรียนหรือไม่?', 'Remove this teacher from the classroom?');
    if (!confirm(message)) return;
    try {
      const updated = await dataService.removeClassroomTeacher(classroom.id, teacherId);
      setClassroom((prev) => (prev ? { ...prev, teachers: updated } : prev));
      setNotice(tr('นำครูผู้สอนออกแล้ว', 'Teacher removed'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : tr('นำครูออกไม่สำเร็จ', 'Could not remove the teacher'));
    }
  };

  const handleAdmitStudent = async (studentId: string) => {
    if (!classroom) return;
    const pending = (classroom.pending_students || []).find((student) => student.id === studentId);
    if (pending && !confirmOtherSchool([pending])) return;
    try {
      await dataService.admitStudentToClassroom(classroom.id, studentId);
      setNotice(tr('อนุมัตินักเรียนแล้ว', 'Student admitted'));
      await loadWorkspace();
    } catch (e) {
      console.error(e);
      setNotice(tr('เกิดข้อผิดพลาดในการอนุมัติ', 'Something went wrong while admitting'));
    }
  };

  const handleRejectStudent = async (studentId: string) => {
    if (!classroom) return;
    if (!confirm(tr('ต้องการปฏิเสธคำขอนี้หรือไม่?', 'Decline this request?'))) return;
    try {
      await dataService.rejectStudentFromClassroom(classroom.id, studentId);
      setNotice(tr('ปฏิเสธคำขอแล้ว', 'Request declined'));
      await loadWorkspace();
    } catch (e) {
      console.error(e);
      setNotice(tr('เกิดข้อผิดพลาดในการปฏิเสธ', 'Something went wrong while declining'));
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
        ? tr(`${admit ? tr('อนุมัติ', 'Admit') : tr('ปฏิเสธ', 'Decline')}แล้ว ${done} คน • ไม่สำเร็จ ${failed} คน กรุณาลองใหม่`, `${admit ? 'Admitted' : 'Declined'} ${done} • ${failed} failed, please try again`)
        : admit
        ? tr(`อนุมัติคำขอทั้งหมดแล้ว (${done} คน)`, `Admitted all requests (${done})`)
        : tr(`ปฏิเสธคำขอทั้งหมดแล้ว (${done} คน)`, `Declined all requests (${done})`)
    );
    setBulkPendingBusy(false);
    setBulkPendingAction(null);
    await loadWorkspace();
  };

  const handleSelectFoundTeacher = async (foundTeacher: User, role: CoTeacherRole) => {
    if (!classroom) return;
    if (teachersList.some((t) => t.teacher_id === foundTeacher.id)) {
      setNotice(tr('ครูท่านนี้อยู่ในห้องเรียนแล้ว', 'This teacher is already in the classroom'));
      return;
    }
    try {
      // Saved on the course, so the dashboard and the other classes of it show the teacher too.
      const updated = await dataService.addClassroomTeacher(classroom.id, foundTeacher.id, role);
      setClassroom((prev) => (prev ? { ...prev, teachers: updated } : prev));
      setNotice(tr('เพิ่มผู้สอนแล้ว', 'Teacher added'));
      setShowAddTeacherModal(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : tr('เพิ่มผู้สอนไม่สำเร็จ', 'Could not add the teacher'));
    }
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
    setNotice(tr('แก้ไขข้อมูลนักเรียนแล้ว', 'Student updated'));
  };

  const handleRemoveStudent = async (studentId: string) => {
    if (!classroom) return;
    if (!confirm(tr('นำนักเรียนคนนี้ออกจากห้องเรียน?', 'Remove this student from the classroom?'))) return;
    try {
      await dataService.removeStudentFromClassroom(classroom.id, studentId);
      const currentStudents = classroom.students || [];
      const updated = currentStudents.filter((s) => s.id !== studentId);
      setClassroom((prev) => (prev ? { ...prev, students: updated, student_count: updated.length } : prev));
      setNotice(tr('นำนักเรียนออกแล้ว', 'Student removed'));
    } catch {
      setNotice(tr('ลบนักเรียนไม่สำเร็จ', 'Could not remove the student'));
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
    // The classroom page's own layout as placeholders, not a blank screen with a spinner.
    return <PageSkeleton variant="classroom" label={tr('กำลังเข้าสู่ห้องเรียน...', 'Opening classroom...')} />;
  }

  if (!classroom) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-6 text-center bg-slate-50 dark:bg-slate-950">
        <h2 className="text-lg font-black text-slate-800 dark:text-white">{tr('ไม่พบห้องเรียนที่ต้องการ', 'Classroom not found')}</h2>
        <p className="text-xs text-slate-500 mt-1 mb-4">{tr('ห้องเรียนอาจถูกลบ หรือคุณไม่มีสิทธิ์เข้าถึง', 'It may have been deleted, or you do not have access')}</p>
        <Link href="/dashboard" className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs">
          {tr('กลับสู่แดชบอร์ด', 'Back to dashboard')}
        </Link>
      </div>
    );
  }

  const courseCode = course?.code || classroom.subject_code || 'CLASSROOM';
  const courseName = course?.name || classroom.course_name || '';
  const room = roomLabel(classroom) || classroom.name;
  const semester = classroom.academic_year || tr('ปัจจุบัน', 'Current');

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
        <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-8">
          {/* Sticky header: course/classroom labels, actions and (desktop) tabs stay in view while scrolling,
              pinned just under the global navbar. */}
          <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 pt-2.5 md:pt-5 lg:pt-6 mb-5 sm:mb-6 bg-slate-50/90 dark:bg-slate-950/90 backdrop-blur-xl border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 md:gap-4 pb-2.5 md:pb-4">
            {/* Mobile title row: code, course name, room and semester sit on one line (course name truncates). */}
            <div className="md:hidden flex items-center gap-2 min-w-0">
              <span className="shrink-0 h-7 inline-flex items-center px-2 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 font-mono text-xs font-black">
                {courseCode}
              </span>
              {courseName && (
                <span className="min-w-0 flex-1 truncate text-base font-black text-slate-900 dark:text-white">{courseName}</span>
              )}
              <h1 className={`shrink-0 h-7 inline-flex items-center px-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-black ${courseName ? '' : 'ml-auto'}`}>
                {room}
              </h1>
              <span className="shrink-0 h-7 inline-flex items-center gap-1 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300" title={`${tr('ภาคเรียน', 'Semester')} ${semester}`}>
                <CalendarCheck className="w-3.5 h-3.5 text-slate-400" />
                {semester}
              </span>
              <button onClick={() => loadWorkspace()} aria-label={tr('รีเฟรช', 'Refresh')} className="-mr-2 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-slate-500 shrink-0">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {/* Desktop title: course code and name lead at the same size as the room, all on one line,
                so the header grows sideways rather than down. */}
            <div className="hidden md:block flex-1 min-w-0 space-y-1">
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
                  {tr('ภาคเรียน', 'Semester')} {semester}
                </span>
              </div>
              {course?.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed line-clamp-1 max-w-3xl">{course.description}</p>
              )}
            </div>

            {/* One compact row on mobile so the sticky header stays short. */}
            <div className="md:shrink-0 grid grid-cols-[1fr_1fr_1.2fr] gap-1.5 sm:flex sm:items-center sm:gap-2 sm:overflow-x-auto scrollbar-none sm:-mx-1 sm:px-1 sm:py-0.5 *:shrink-0">
              {/* Secondary: Invite Students Modal Trigger */}
              <button
                type="button"
                onClick={() => {
                  setShowInviteModal(true);
                  setInviteTab('roster');
                }}
                className="min-w-0 h-9 sm:h-auto px-2 sm:px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] sm:text-xs font-bold inline-flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5 shadow-xs transition-all cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                <span className="truncate">{tr('เชิญนักเรียน', 'Invite students')}</span>
                {(classroom.pending_students?.length || 0) > 0 && (
                  <span className="w-2 h-2 shrink-0 rounded-full bg-rose-500 animate-ping" />
                )}
              </button>

              {/* Secondary: Connect LINE Bot Modal Trigger */}
              <button
                type="button"
                onClick={() => {
                  setShowLineConnectModal(true);
                  fetch(`/api/line/connections?classroomId=${encodeURIComponent(classroom.id)}`, { cache: 'no-store' })
                    .then((response) => (response.ok ? response.json() : null))
                    .then((result) => result && setLineConnection(result))
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
                  {tr(<><span className="hidden sm:inline">เชื่อม</span>บอท LINE</>, <><span className="hidden sm:inline">Connect </span>LINE bot</>)}
                </span>
              </button>

              {/* Primary: Create Assignment or Exam */}
              <CreateWorkMenu
                classroomId={classroom.id}
                from="classroom"
                className="min-w-0 h-9 sm:h-auto px-2 sm:px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-[11px] sm:text-xs inline-flex items-center justify-center sm:justify-start gap-1 sm:gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  {tr(<>สร้างงาน<span className="hidden sm:inline"> / ข้อสอบ</span></>, <>New<span className="hidden sm:inline"> assignment / exam</span></>)}
                </span>
              </CreateWorkMenu>
            </div>
          </div>

          {/* Navigation Tab Bar (desktop; mobile uses the bottom bar below) */}
          <div ref={tabBarRef} className="hidden md:flex relative items-center gap-1.5 pb-3 overflow-x-auto scrollbar-none">
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
                  <span>{item.label[language]}</span>
                </button>
              );
            })}
          </div>
          </div>

          {/* Toast Notification Notice */}
          {notice && (
            <div role="status" className="mb-5 sm:mb-6 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center justify-between gap-3 animate-in fade-in">
              <span className="min-w-0 wrap-break-word">{notice}</span>
              <button onClick={() => setNotice('')} aria-label={tr('ปิด', 'Close')} className="text-amber-600 hover:text-amber-800 p-1 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Mobile bottom tab bar: all five tabs at once, icon above a short label. */}
          <nav
            aria-label={tr('เมนูห้องเรียน', 'Classroom menu')}
            // The solid ::after under the bar fills any sliver between it and the screen's edge
        // (fractional pixel ratios, browser toolbars sliding away), so the page never shows through.
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-t border-slate-200/80 dark:border-slate-800 pb-[env(safe-area-inset-bottom)] after:content-[''] after:absolute after:inset-x-0 after:top-full after:h-24 after:bg-white dark:after:bg-slate-900"
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
                    aria-label={item.label[language]}
                    className={`relative min-w-0 flex flex-col items-center gap-1 py-1 rounded-2xl text-[11px] transition-colors cursor-pointer ${
                      isActive
                        ? 'text-amber-600 dark:text-amber-400 font-black'
                        : 'text-slate-500 dark:text-slate-400 font-semibold hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    <span className="px-3.5 py-1 rounded-full">
                      <Icon className={`w-5 h-5 transition-transform duration-300 ${isActive ? 'scale-110' : ''}`} />
                    </span>
                    <span className="max-w-full truncate">{item.shortLabel[language]}</span>
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
                        {user?.fullName || user?.firstName || tr('ครูผู้สอน', 'Teacher')}
                      </p>
                      <span className="text-[10px] text-slate-400"><MobileText short={tr('ประกาศถึงนักเรียน', 'Announce to students')} full={tr('แชร์ประกาศ ข้อมูล หรือแจ้งเตือนเข้ากลุ่ม LINE', 'Share announcements, info or reminders to the LINE group')} /></span>
                    </div>
                  </div>

                  <textarea
                    rows={isPostExpanded ? 4 : 2}
                    value={postBody}
                    onFocus={() => setIsPostExpanded(true)}
                    onChange={(e) => setPostBody(e.target.value)}
                    placeholder={tr('ประกาศถึงนักเรียน (ส่งเข้ากลุ่ม LINE อัตโนมัติ)...', 'Announce to students (sent to the LINE group automatically)...')}
                    className="w-full p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500 transition-all resize-none"
                  />

                  {isPostExpanded && (
                    // Phones: the four types as one even row, then Cancel / Post as one full-width row.
                    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div className="grid grid-cols-4 gap-1.5 sm:flex sm:flex-wrap sm:items-center">
                        <span className="hidden sm:inline text-[11px] font-bold text-slate-400 mr-1">{tr('ประเภท:', 'Type:')}</span>
                        {(
                          [
                            ['announcement', tr('📢 ประกาศ', '📢 Announcement')],
                            ['assignment', tr('📋 งาน', '📋 Assignment')],
                            ['exam', tr('📝 ข้อสอบ', '📝 Exam')],
                            ['attendance', tr('⏰ เช็กชื่อ', '⏰ Attendance')],
                          ] as const
                        ).map(([type, label]) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => setPostActivityType(type)}
                            className={`h-8 sm:h-7 px-1 sm:px-2.5 rounded-lg text-[11px] sm:text-[10px] font-bold whitespace-nowrap inline-flex items-center justify-center transition-all cursor-pointer ${
                              postActivityType === type
                                ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-[1fr_2fr] gap-2 sm:flex sm:items-center">
                        <button
                          type="button"
                          onClick={() => {
                            setIsPostExpanded(false);
                            setPostBody('');
                          }}
                          className="h-9 sm:h-8 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-500 hover:text-slate-800 inline-flex items-center justify-center cursor-pointer"
                        >
                          {tr('ยกเลิก', 'Cancel')}
                        </button>
                        <button
                          type="button"
                          disabled={isPosting || !postBody.trim()}
                          onClick={createPost}
                          className="h-9 sm:h-8 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-xs font-black flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-all"
                        >
                          {isPosting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          <span>{tr('โพสต์ประกาศ', 'Post')}</span>
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
                                ⏰ {tr('เผยแพร่', 'Publishes')} {formatDateTime(item.scheduledAt, language)}
                              </span>
                            )}
                          </div>
                          <time className="text-[10px] text-slate-400 block mt-0.5">
                            {new Date(item.created_at).toLocaleString(tr('th-TH', 'en-US'), {
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
                            title={tr('แก้ไขโพสต์', 'Edit post')}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          )}
                          <button
                            onClick={() =>
                              item.assignmentId ? handleDeleteAssignment(item.assignmentId) : handleDeletePost(item.rawId!)
                            }
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            title={item.assignmentId ? tr('ลบงาน/ข้อสอบนี้ (ลบออกจากแท็บงานด้วย)', 'Delete this assignment/exam (also removes it from Classwork)') : tr('ลบโพสต์', 'Delete post')}
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

                    {/* The bot could not send it to LINE: share it from the teacher's own LINE */}
                    {item.lineShare && (
                      <div className={`flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border ${item.lineShare.reason === 'card' ? 'bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-900/60' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/60'}`}>
                        <span className={`text-[11px] font-bold ${item.lineShare.reason === 'card' ? 'text-violet-800 dark:text-violet-300' : 'text-amber-800 dark:text-amber-300'}`}>
                          {item.lineShare.reason === 'card'
                            ? tr('ยังไม่ได้โพสต์การ์ดงานเข้ากลุ่ม LINE', 'Work card not posted to LINE yet')
                            : item.lineShare.reason === 'quota'
                            ? tr('ยังไม่ได้ส่งเข้า LINE (โควตาหมด)', 'Not sent to LINE (quota used up)')
                            : item.lineShare.reason === 'no_group'
                            ? tr('ยังไม่ได้ส่งเข้า LINE (ไม่ได้เชื่อมกลุ่ม)', 'Not sent to LINE (no linked group)')
                            : tr('ยังไม่ได้ส่งเข้า LINE', 'Not sent to LINE')}
                        </span>
                        <button
                          type="button"
                          onClick={() => reportLineUnsent(item.lineShare!.reason, item.lineShare)}
                          className="px-3 py-1.5 rounded-lg bg-[#06c755] hover:bg-[#05b34c] text-white font-black text-[11px] inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          {item.lineShare.reason === 'card' ? tr('โพสต์เข้ากลุ่ม', 'Post to group') : tr('แชร์ไป LINE เอง', 'Share to LINE yourself')}
                        </button>
                      </div>
                    )}

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
                          <span>{tr('เปิดตรวจคะแนน', 'Open grading')}</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </span>
                      </Link>
                    )}

                    {/* Post Footer: what LINE got, and "send again" (the bot checks the quota first; share popup when it cannot) */}
                    {(() => {
                      const work = item.assignmentId ? assignments.find((a) => a.id === item.assignmentId) : undefined;
                      // A work: its link again with the current deadline, while it still takes work. Other posts: the same post again.
                      const canResend = !item.scheduledAt && (work ? getAssignmentWindow(work).acceptsSubmissions && !getAssignmentWindow(work).isDraft : item.isPost);
                      return (
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                          <span className="min-w-0 truncate">
                            {item.scheduledAt
                              ? tr('⏰ ส่งเข้า LINE เมื่อถึงเวลาเผยแพร่', '⏰ Sent to LINE when it is published')
                              : item.lineShare
                              ? item.lineShare.reason === 'card'
                                ? tr('📌 รอโพสต์การ์ดงานเข้ากลุ่ม', '📌 Work card waiting to be posted')
                                : tr('⚠️ ยังไม่ได้ส่งเข้า LINE', '⚠️ Not in LINE yet')
                              : item.isPost
                              ? tr('📢 ส่งเข้ากลุ่ม LINE แล้ว', '📢 Sent to the LINE group')
                              : ''}
                          </span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            {canResend && (
                              <button
                                type="button"
                                onClick={() => (work ? handleReannounceAssignment(work) : handleResendPost(item.rawId!, item.title))}
                                title={tr('ให้บอทส่งเข้ากลุ่ม LINE อีกครั้ง (ถ้าโควตาไม่พอ จะเปิดให้แชร์เอง)', 'Ask the bot to send it to the LINE group again (share it yourself if the quota is short)')}
                                className="h-6 px-2 rounded-lg bg-[#06c755]/10 hover:bg-[#06c755]/20 text-[#06a347] dark:text-[#3ddc84] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <Share2 className="w-3 h-3" />
                                {tr('ส่งซ้ำ LINE', 'Resend')}
                              </button>
                            )}
                            <span>{item.badgeLabel}</span>
                          </span>
                        </div>
                      );
                    })()}
                  </article>
                ))}

                {!timeline.length && (
                  <div className="p-5 sm:p-8 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs text-slate-400">
                    {tr('ยังไม่มีโพสต์ เริ่มประกาศข้อความแรกได้เลย', 'No posts yet. Write your first announcement.')}
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
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs">
                <div className="max-sm:w-full max-sm:text-center">
                  <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">{tr('งานและเนื้อหา', 'Classwork')}</h2>
                  <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                    <MobileText short={tr('จัดกลุ่มงานได้เอง นักเรียนเห็นกลุ่มเดียวกัน', 'Group work your way; students see the same groups')} full={tr('จัดกลุ่มงานตามหมวดหมู่ได้เอง นักเรียนจะเห็นหมวดหมู่เดียวกันในหน้าของตนเอง', 'Organize work into your own groups. Students see the same groups on their page.')} />
                  </p>
                </div>
                <div className="max-sm:w-full max-sm:grid max-sm:grid-cols-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setShowAddGroupModal(true)}
                    className="max-sm:h-9 px-3.5 py-2 max-sm:py-0 max-sm:px-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="truncate"><MobileText short={tr('หมวดหมู่ใหม่', 'New group')} full={tr('+ สร้างกลุ่มหมวดหมู่ใหม่', '+ New group')} /></span>
                  </button>
                  <CreateWorkMenu
                    classroomId={classroom.id}
                    from="classroom"
                    className="max-sm:h-9 px-4 py-2 max-sm:py-0 max-sm:px-2 rounded-xl border border-amber-500 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-sm transition-all"
                  >
                    <Plus className="w-4 h-4 shrink-0" />
                    <span className="truncate"><MobileText short={tr('สร้างงาน / ข้อสอบ', 'New work')} full={tr('สร้างงาน / ข้อสอบ', 'New assignment / exam')} /></span>
                  </CreateWorkMenu>
                </div>
              </div>

              {/* Progress summary + filter, same as the grading hub */}
              {assignments.length > 0 && (
                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <div className={`p-3 rounded-2xl ${classworkSummary.pending > 0 ? 'bg-amber-50 dark:bg-amber-950/40' : 'bg-emerald-50 dark:bg-emerald-950/40'}`}>
                      <span className={`text-[11px] font-bold block ${classworkSummary.pending > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{tr('รอตรวจ', 'To grade')}</span>
                      <span className={`text-xl sm:text-2xl font-black ${classworkSummary.pending > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                        {classworkSummary.pending}
                        <span className="text-[11px] font-semibold ml-1">{tr('ชิ้น', 'items')}</span>
                      </span>
                    </div>
                    <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">{tr('ตรวจแล้ว', 'Graded')}</span>
                      <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                        {classworkSummary.graded}
                        <span className="text-[11px] font-semibold text-slate-400 ml-1">/ {classworkSummary.checkable}</span>
                      </span>
                    </div>
                    <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                      <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">{tr('งานที่ตรวจครบ', 'Fully graded')}</span>
                      <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                        {classworkSummary.done}
                        <span className="text-[11px] font-semibold text-slate-400 ml-1">/ {assignments.length}</span>
                      </span>
                    </div>
                  </div>

                  <div ref={trackClassworkFilterBar} className="relative flex gap-1.5 p-1 rounded-2xl bg-slate-50 dark:bg-slate-800/60 overflow-x-auto">
                    {classworkFilterIndicator && (
                      <span
                        aria-hidden
                        className={`absolute top-0 left-0 rounded-xl shadow-xs transition-[transform,width,height,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                          CLASSWORK_FILTERS.find((f) => f.id === classworkFilter)?.pill
                        }`}
                        style={indicatorStyle(classworkFilterIndicator)}
                      />
                    )}
                    {CLASSWORK_FILTERS.map(({ id, label, pill, text }) => {
                      const selected = classworkFilter === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          data-active={selected}
                          aria-pressed={selected}
                          onClick={() => selectClassworkFilter(id)}
                          className={`relative flex-1 min-w-max px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors duration-300 cursor-pointer ${
                            selected
                              ? `${text} ${classworkFilterIndicator ? '' : pill}`
                              : 'text-slate-600 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-800'
                          }`}
                        >
                          <span>{label[language]}</span>
                          <span className={`px-1.5 min-w-5 rounded-full text-[10px] font-black ${selected ? 'bg-black/10 dark:bg-white/20' : 'bg-white dark:bg-slate-900'}`}>
                            {classworkFilterCounts[id]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {classworkFilter !== 'all' && (
                    <p className="text-[11px] text-slate-400 animate-in fade-in slide-in-from-top-1">{tr('กลับไปที่ “ทั้งหมด” เพื่อลากเรียงลำดับหรือย้ายกลุ่ม', 'Switch back to “All” to drag, reorder or move groups')}</p>
                  )}
                </div>
              )}

              {/* Grouped Assignments List (re-keyed per filter so it slides in like a tab change) */}
              <div
                key={classworkFilter}
                className="space-y-5 animate-in fade-in [--tw-duration:320ms]"
                style={{ '--tw-enter-translate-x': `${classworkFilterDirection * 2.5}rem` } as CSSProperties}
              >
                {/* Unpublished work is pinned on top, outside the drag list (never dragged or
                    reordered, still folds); the categories below keep their own drag order. */}
                {[
                  { id: 'pinned', groups: pinnedClassworkGroups, draggable: false },
                  { id: 'categories', groups: draggableClassworkGroups, draggable: true },
                ]
                  .filter((list) => list.draggable || list.groups.length > 0)
                  .map((list) => (
                <div key={list.id} ref={list.draggable ? bindGroupList : undefined} className="relative space-y-5">
                {list.groups.map(([group, items]) => {
                  const foldKey = classworkFoldKey(group);
                  const accent = categoryLook(categoryColors[foldKey]);
                  // Not a real category: nothing can be dropped in, and its cards stay put.
                  const isUnpublishedGroup = foldKey === '__unpublished';
                  return (
                  <div
                    key={group}
                    ref={list.draggable ? bindGroupItem(foldKey) : undefined}
                    style={list.draggable ? groupItemStyle(foldKey) : undefined}
                    // A drop target: the drag hook works out the place from its rows (data-xl-item).
                    {...(isUnpublishedGroup ? {} : { 'data-xl-list': group })}
                    // Each category is its own card: clear border and a grey header (or the teacher's colour).
                    className={`relative overflow-hidden rounded-3xl border-2 transition-[border-color,box-shadow,background-color] ${
                      dragOverGroup === group
                        ? 'border-amber-400 ring-2 ring-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20'
                        : draggingAssignmentId
                        ? 'border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40'
                        : `${accent.border} bg-white dark:bg-slate-900`
                    } ${groupDragKey === foldKey ? 'shadow-2xl shadow-slate-900/15' : 'shadow-xs'}`}
                  >
                    {accent.bar && <span aria-hidden className={`absolute left-0 inset-y-0 w-1.5 ${accent.bar}`} />}
                    <div className={`flex items-center gap-1 pl-3 pr-2 sm:pl-4 sm:pr-3 py-2 ${accent.head}`}>
                      {list.draggable && classworkFilter === 'all' && draggableClassworkGroups.length > 1 && (
                        <button
                          type="button"
                          draggable={false}
                          aria-label={tr(`ลากเพื่อจัดลำดับหมวด ${group}`, `Drag to reorder ${group}`)}
                          title={tr('ลากเพื่อจัดลำดับหมวด', 'Drag to reorder')}
                          {...groupHandleProps(foldKey)}
                          className="w-7 h-9 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-white/70 dark:hover:bg-slate-800 touch-none select-none cursor-grab active:cursor-grabbing"
                        >
                          <GripVertical className="w-4 h-4" />
                        </button>
                      )}
                      <div className="min-w-0 flex-1">
                    <AssignmentGroupHeader
                      title={group}
                      count={items.length}
                      open={isClassworkGroupOpen(classworkFoldKey(group))}
                      onToggle={() => toggleClassworkGroup(classworkFoldKey(group))}
                      chips={teacherGroupChips(
                        items.map((a) => ({ assignment: a, counts: classworkCounts.get(a.id) || gradingCounts([], rosterSizeFor(a, classroom.students?.length || 0), a.is_exam) })),
                        language === 'th'
                      )}
                    />

                      </div>
                      <ActionMenu size="sm" label={tr(`ตัวเลือกของหมวด ${group}`, `Options for ${group}`)} items={categoryMenu(group, foldKey)} />
                    </div>
                    <Collapse open={isClassworkGroupOpen(classworkFoldKey(group))}>
                    <div className="space-y-3 p-3 sm:p-4 pt-3">
                    {items.length === 0 && (
                      <div className="py-6 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 text-center text-[11px] text-slate-400">
                        {tr('ลากงานมาวางที่นี่ หรือกด “ย้ายกลุ่ม” ที่งาน', 'Drag work here, or use “Move group” on an item')}
                      </div>
                    )}

                    <div
                      className="@container space-y-2"
                      // Another category's row headed here: room for it at the end, as the rows slide down.
                      style={
                        classworkDragInfo && dropTarget?.group === group && classworkDragInfo.source.group !== group
                          ? { paddingBottom: classworkDragInfo.size, transition: 'padding 220ms cubic-bezier(0.2,0.8,0.2,1)' }
                          : classworkDragInfo
                          ? { transition: 'padding 220ms cubic-bezier(0.2,0.8,0.2,1)' }
                          : undefined
                      }
                    >
                      {items.map((item, itemIndex) => {
                        const itemWindow = getAssignmentWindow(item);
                        const canDrag = classworkFilter === 'all' && !isUnpublishedGroup;
                        const isDragged = classworkDragInfo?.id === item.id;
                        // While a row is dragged the others slide aside to open a gap where it will land.
                        const shift = shiftFor(classworkDragInfo, dropTarget, group, itemIndex, isDragged);
                        return (
                          <div
                            key={item.id}
                            {...(isUnpublishedGroup ? {} : { 'data-xl-item': item.id, 'data-xl-index': itemIndex, 'data-xl-shift': shift })}
                            {...(canDrag ? classworkDrag.pressProps(item.id) : {})}
                            style={
                              classworkDragInfo
                                ? { transform: shift ? `translate3d(0, ${shift}px, 0)` : undefined, transition: 'transform 220ms cubic-bezier(0.2,0.8,0.2,1)' }
                                : undefined
                            }
                            onClickCapture={(e) => {
                              // The release after a drag must not open the title link.
                              if (classworkDrag.recentlyDropped()) {
                                e.preventDefault();
                                e.stopPropagation();
                              }
                            }}
                            onClick={(e) => {
                              // A tap anywhere on the row (not its buttons, links or menu) opens grading.
                              if (classworkDrag.recentlyDropped()) return;
                              if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label, [role="menu"]')) return;
                              if (window.getSelection()?.toString()) return;
                              router.push(`/assignments/${item.id}/grading?from=classroom&classroomId=${classroomId}`);
                            }}
                            title={canDrag ? tr('กดเพื่อตรวจงาน • ลากเพื่อเรียงลำดับหรือย้ายกลุ่ม', 'Tap to grade • drag to reorder or move group') : tr('กดเพื่อตรวจงาน', 'Tap to grade')}
                            className={`relative flex cursor-pointer select-none [-webkit-touch-callout:none] ${
                              // The dragged row's place: an empty dashed slot (its copy follows the pointer).
                              isDragged ? 'rounded-2xl outline-2 outline-dashed outline-amber-400 bg-amber-50/60 dark:bg-amber-950/20' : ''
                            }`}
                          >
                            <ClassworkRow
                              className={`flex-1 min-w-0 hover:border-amber-400 ${isDragged ? 'opacity-0' : ''}`}
                              now={nowMs}
                              tag={isUnpublishedGroup ? groupKeyOf(item) : undefined}
                              assignment={item}
                              counts={classworkCounts.get(item.id) || gradingCounts([], rosterSizeFor(item, classroom.students?.length || 0), item.is_exam)}
                              gradingHref={`/assignments/${item.id}/grading?from=classroom&classroomId=${classroomId}`}
                              editHref={`/assignments/new?edit=${item.id}&classroomId=${classroomId}&from=classroom`}
                              copyHref={`/assignments/new?copy=${item.id}&classroomId=${classroomId}&from=classroom`}
                              onStatusClick={() => setStatusAssignment(item)}
                              onDelete={() => handleDeleteAssignment(item.id)}
                              onPublishNow={itemWindow.isScheduled || itemWindow.isDraft ? () => handlePublishAssignmentNow(item) : undefined}
                              onRemind={() => handleRemindAssignment(item)}
                              onAnnounceResults={() => handleAnnounceResults(item)}
                              onReannounce={() => handleReannounceAssignment(item)}
                              onMoveGroup={() => {
                                setEditingAssignmentGroup(item);
                                setTargetGroupForAssignment(item.group_name || '');
                              }}
                              leading={canDrag ? <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0 -ml-1" aria-hidden /> : undefined}
                            />
                          </div>
                        );
                      })}
                    </div>
                    </div>
                    </Collapse>
                  </div>
                  );
                })}
                </div>
                  ))}
              </div>

            </section>
          )}

          {/* ============================================================ */}
          {/* TAB 3: ATTENDANCE (เช็กชื่อ) */}
          {/* ============================================================ */}
          {tab === 'attendance' && (
            <AttendancePanel
              classroom={classroom}
              sessions={sessions}
              session={session}
              records={allRecords}
              counts={attendanceCounts}
              title={attendanceTitle}
              setTitle={setAttendanceTitle}
              create={createAttendance}
              update={updateAttendanceRecord}
              action={sessionAction}
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
                    <span>{tr('รายชื่อผู้สอน', 'Teachers')} ({teachersList.length})</span>
                  </h2>
                  <button
                    onClick={() => setShowAddTeacherModal(true)}
                    className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-xs transition-all"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{tr('+ เพิ่มผู้สอน', '+ Add teacher')}</span>
                  </button>
                </div>

                <div className="space-y-2.5">
                  {teachersList.map((teacher) => {
                    const roleLabel = teacherRoleLabel(teacher.role, tr);
                    const roleBadgeClass = teacherRoleBadgeClass(teacher.role);

                    return (
                      <div
                        key={teacher.teacher_id}
                        className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-between gap-3 border border-slate-100 dark:border-slate-700/60"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar src={teacher.avatar_url} name={teacher.name} className="w-10 h-10 text-sm" />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {teacher.name || teacher.teacher_id}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate mt-0.5">
                              {teacher.email || tr('ไม่มีอีเมล', 'No email')}
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
                            title={tr('ลบผู้สอนออกจากห้องเรียน', 'Remove teacher from classroom')}
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
                        {tr(`มีคำขอเข้าห้องเรียนรออนุมัติ (${classroom.pending_students?.length} คน)`, `${classroom.pending_students?.length} join requests awaiting approval`)}
                      </p>
                      <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                        {tr('นักเรียนลงทะเบียนแล้ว รอคุณครูอนุมัติ', 'Students registered and are waiting for your approval')}
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
                    {tr('ตรวจสอบและอนุมัติ', 'Review and approve')}
                  </button>
                </div>
              )}

              {/* 2. Students Section (แสดงผู้เรียน พร้อมปุ่มเพิ่มและลบ) */}
              <StudentList
                classroom={classroom}
                onOpenAddStudent={() => {
                  setShowInviteModal(true);
                  setInviteTab('roster');
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
                  <h2 className="font-black text-slate-900 dark:text-white">{tr('ตารางคะแนนรวมทั้งห้อง', 'Class grade book')}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    <MobileText short={tr('คะแนนและงานรอตรวจของทุกคน', 'Everyone\'s scores and pending grading')} full={tr('คะแนนงาน ข้อสอบ และสถานะรอตรวจของนักเรียนทุกคน', 'Assignment and exam scores, plus grading status, for every student')} />
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-bold">{assignments.length} {tr('งาน/ข้อสอบ', 'assignments/exams')}</span>
                  <button
                    type="button"
                    onClick={exportGrades}
                    disabled={!assignments.length || !(classroom.students || []).length}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{tr('ส่งออก CSV', 'Export CSV')}</span>
                  </button>
                </div>
              </div>

              {gradesLoading ? (
                <div className="py-12 text-center text-sm text-slate-400">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-500" />
                  {tr('กำลังโหลดคะแนน...', 'Loading grades...')}
                </div>
              ) : (
                // Columns keep their natural width; the table scrolls sideways (name stays pinned) instead of squeezing.
                <div className="overflow-x-auto overscroll-x-contain [scrollbar-width:thin] -mx-4 sm:mx-0 px-4 sm:px-0 pb-1">
                <table className="w-max min-w-full text-xs border-separate border-spacing-0">
                  <thead>
                    <tr className="text-slate-400 text-left [&>th]:border-b [&>th]:border-slate-200 dark:[&>th]:border-slate-800">
                      <th className="p-3 sticky left-0 z-10 bg-white dark:bg-slate-900 whitespace-nowrap shadow-[1px_0_0_0] shadow-slate-200 dark:shadow-slate-800">{tr('ชื่อ-นามสกุล', 'Full name')}</th>
                      <th className="p-3 whitespace-nowrap">{tr('รหัสนักเรียน', 'Student ID')}</th>
                      {gradeColumns.map((item) => (
                        <th key={item.id} className="p-3 text-center min-w-24 align-bottom" title={item.title}>
                          <span className="block truncate w-28 mx-auto font-bold text-slate-700 dark:text-slate-300">
                            {item.title}
                          </span>
                          <span className="text-[10px] text-slate-400 font-normal whitespace-nowrap">
                            ({tr('เต็ม', 'out of')} {item.total_points || 20})
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(classroom.students || []).map((student) => (
                      <tr key={student.id} className="group [&>td]:border-b [&>td]:border-slate-100 dark:[&>td]:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850">
                        <td className="p-3 font-bold text-slate-900 dark:text-white sticky left-0 z-1 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-850 whitespace-nowrap shadow-[1px_0_0_0] shadow-slate-200 dark:shadow-slate-800">
                          {student.first_name} {student.last_name}
                        </td>
                        <td className="p-3 text-slate-500 font-mono whitespace-nowrap">{student.student_id || '-'}</td>
                        {gradeColumns.map((item) => {
                          const sub = findStudentSubmission(submissions, item.id, student);
                          return (
                            <td key={item.id} className="p-3 text-center font-bold">
                              {sub && isGraded(sub) && !isHandedIn(sub) ? (
                                <span className="text-rose-600 dark:text-rose-400 font-black text-sm" title={tr('ไม่ส่งงาน', 'No submission')}>
                                  {sub.total_score}
                                  <span className="block text-[9px] font-bold opacity-80">{tr('ไม่ส่ง', 'none')}</span>
                                </span>
                              ) : sub && isGraded(sub) ? (
                                <span className="text-emerald-600 dark:text-emerald-400 font-black text-sm">
                                  {sub.total_score}
                                </span>
                              ) : sub && needsGrading(sub) ? (
                                <span className="text-amber-500 text-[10px] bg-amber-50 dark:bg-amber-950 px-2 py-0.5 rounded-full font-bold">
                                  {tr('รอตรวจ', 'To grade')}
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
              <h3 className="font-black text-sm text-slate-900 dark:text-white">{tr('เพิ่มหมวดหมู่ใหม่', 'New group')}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">{tr('สร้างแล้วลากงานมาวางในกลุ่มใหม่ได้ทันที', 'Once created, drag work into it right away')}</p>
            </div>
            <input
              autoFocus
              value={newGroupName}
              onKeyDown={(e) => e.key === 'Enter' && handleAddGroup()}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder={tr('เช่น บทที่ 1, สอบกลางภาค...', 'e.g. Chapter 1, Midterm...')}
              className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-400"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddGroupModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
              >
                {tr('ยกเลิก', 'Cancel')}
              </button>
              <button
                onClick={handleAddGroup}
                disabled={!newGroupName.trim()}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-black cursor-pointer disabled:opacity-50"
              >
                {tr('บันทึกกลุ่ม', 'Save group')}
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
            <h3 className="font-black text-sm text-slate-900 dark:text-white">{tr('ย้ายหมวดหมู่ของงาน', 'Move to group')}</h3>
            <p className="text-xs text-slate-500 font-bold truncate">{editingAssignmentGroup.title}</p>
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400">{tr('เลือกกลุ่มที่มีอยู่ หรือพิมพ์กลุ่มใหม่', 'Pick an existing group or type a new one')}</label>
              <input
                value={targetGroupForAssignment}
                onChange={(e) => setTargetGroupForAssignment(e.target.value)}
                placeholder={tr('ชื่อหมวดหมู่...', 'Group name...')}
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
                {tr('ยกเลิก', 'Cancel')}
              </button>
              <button
                onClick={() => handleUpdateAssignmentGroup(editingAssignmentGroup.id, targetGroupForAssignment)}
                className="flex-1 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-black cursor-pointer"
              >
                {tr('บันทึกการย้าย', 'Move')}
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
                <span>{tr('แก้ไขข้อความโพสต์', 'Edit post')}</span>
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
                {tr('ยกเลิก', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={isUpdatingPost || !editPostBody.trim()}
                onClick={() => handleUpdatePost(editingPost.id, editPostBody)}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black shadow-xs cursor-pointer"
              >
                {isUpdatingPost ? tr('กำลังบันทึก...', 'Saving...') : tr('บันทึกการแก้ไข', 'Save changes')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: ASSIGNMENT STATUS */}
      {/* ============================================================== */}
      {categoryDetail !== null && (
        <CategoryDetailSheet
          title={categoryDetail}
          items={categoryItems(categoryDetail).map((a) => ({ assignment: a, counts: countsFor(a) }))}
          onClose={() => setCategoryDetail(null)}
        />
      )}
      {renamingCategory !== null && (
        <RenameCategoryDialog
          current={renamingCategory}
          count={assignments.filter((a) => groupKeyOf(a) === renamingCategory).length}
          onClose={() => setRenamingCategory(null)}
          onSave={(name) => renameCategory(renamingCategory, name)}
        />
      )}
      {categoryStatus !== null && (
        <BulkStatusDialog
          title={categoryStatus}
          scope={tr(`${categoryItems(categoryStatus).length} งาน`, `${categoryItems(categoryStatus).length} items`)}
          items={workClassesOf(categoryStatus)}
          onClose={() => setCategoryStatus(null)}
          onDone={(changes, message) => {
            const byId = new Map(changes.map((c) => [c.id, c.change]));
            setAssignments((prev) => prev.map((a) => (byId.has(a.id) ? { ...a, ...byId.get(a.id) } : a)));
            setNotice(message);
          }}
        />
      )}
      {statusAssignment && (
        <AssignmentStatusDialog
          assignment={statusAssignment}
          onClose={() => setStatusAssignment(null)}
          onSaved={(updated, action) => {
            setAssignments((prev) => prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
            setStatusAssignment(null);
            const kind = updated.is_exam ? tr('ข้อสอบ', 'exam') : tr('งาน', 'assignment');
            setNotice(
              action === 'published'
                ? tr(`🚀 เผยแพร่${kind} “${updated.title}” แล้ว`, `🚀 Published the ${kind} “${updated.title}”`)
                : updated.status_override === 'force_closed'
                ? tr(`🔒 ปิดรับ${kind} “${updated.title}” แล้ว`, `🔒 Closed the ${kind} “${updated.title}”`)
                : updated.status_override === 'extended'
                ? tr(`⏳ ขยายเวลาส่ง${kind} “${updated.title}” ถึง ${formatDateTime(updated.extended_until, language)} แล้ว`, `⏳ Extended the ${kind} “${updated.title}” until ${formatDateTime(updated.extended_until, 'en')}`)
                : tr(`${kind} “${updated.title}” กลับไปรับงานตามกำหนดส่งแล้ว`, `The ${kind} “${updated.title}” is back on its normal due date`)
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

      {/* MODAL: ADD TEACHER (same compact panel as the dashboard's co-teacher popup) */}
      {showAddTeacherModal && (
        <ModalSheet onClose={() => setShowAddTeacherModal(false)} size="sm:max-w-2xl">
          <ModalSheetHeader>
            <div className="flex items-center gap-2 min-w-0">
              <UserPlus className="w-5 h-5 text-amber-500 shrink-0" />
              <h3 className="text-base font-bold text-slate-900 dark:text-white line-clamp-2">{tr('เพิ่มผู้สอน', 'Add teacher')}</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowAddTeacherModal(false)}
              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer shrink-0"
              aria-label={tr('ปิด', 'Close')}
            >
              <X className="w-5 h-5" />
            </button>
          </ModalSheetHeader>
          <ModalSheetBody>
            <CoTeacherPanel courseId={classroom.course_id} institution={teacherInstitution} onAdd={handleSelectFoundTeacher} teachers={teachersList} hideList />
          </ModalSheetBody>
        </ModalSheet>
      )}

      {/* MODAL: STUDENTS & JOIN REQUESTS (invite in LINE) */}
      {showInviteModal && (
        <StudentRosterModal
          classroom={classroom}
          initialTab={inviteTab}
          onClose={() => setShowInviteModal(false)}
          onEditStudent={setEditingStudent}
          onRemoveStudent={handleRemoveStudent}
          onAdmitStudent={handleAdmitStudent}
          onRejectStudent={handleRejectStudent}
          onBulkPending={setBulkPendingAction}
          isOtherSchool={isOtherSchool}
        />
      )}

      {/* MODAL: CONFIRM ACCEPT ALL / REJECT ALL JOIN REQUESTS */}
      {bulkPendingAction && classroom && (() => {
        const pending = classroom.pending_students || [];
        const admit = bulkPendingAction === 'admit';
        const otherSchool = admit ? pending.filter((p) => isOtherSchool(p.institution)) : [];
        return (
          <div
            className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in"
            onClick={() => !bulkPendingBusy && setBulkPendingAction(null)}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="bulk-pending-title"
              className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <span className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${admit ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400' : 'bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400'}`}>
                  {admit ? <UserCheck className="w-5 h-5" /> : <UserX className="w-5 h-5" />}
                </span>
                <div className="min-w-0">
                  <h3 id="bulk-pending-title" className="text-sm font-black text-slate-900 dark:text-white">
                    {admit ? tr(`อนุมัตินักเรียนทั้งหมด ${pending.length} คน?`, `Admit all ${pending.length} students?`) : tr(`ปฏิเสธคำขอทั้งหมด ${pending.length} คน?`, `Decline all ${pending.length} requests?`)}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    {admit
                      ? tr('นักเรียนทุกคนในรายการจะเข้าห้อง และส่งงานได้ทันที', 'Everyone in the list joins and can submit work right away')
                      : tr('คำขอทั้งหมดจะถูกลบ นักเรียนต้องขอเข้าใหม่', 'All requests will be removed; students must request again')}
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
                    {tr(`${otherSchool.length} คนระบุโรงเรียนต่างจากของคุณครู (${institutionLabel(teacherInstitution, language)})`, `${otherSchool.length} listed a different school from yours (${institutionLabel(teacherInstitution, language)})`)}
                  </p>
                  <p>{otherSchool.map((p) => `${p.first_name} ${p.last_name} — ${institutionLabel(p.institution, language)}`).join(', ')}</p>
                  <p>{tr('หากนักเรียนกรอกชื่อโรงเรียนผิด แก้ไขได้ภายหลังที่แท็บ "ผู้สอนและผู้เรียน"', 'If a student typed the school wrong, you can fix it later in the "People" tab')}</p>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setBulkPendingAction(null)}
                  disabled={bulkPendingBusy}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                >
                  {tr('ยกเลิก', 'Cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleBulkPending}
                  disabled={bulkPendingBusy}
                  autoFocus
                  className={`px-4 py-2 rounded-xl text-xs font-black text-white inline-flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-60 ${admit ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}`}
                >
                  {bulkPendingBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {admit ? tr(`ยืนยันอนุมัติ ${pending.length} คน`, `Admit ${pending.length}`) : tr(`ยืนยันปฏิเสธ ${pending.length} คน`, `Decline ${pending.length}`)}
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
        <ModalSheet onClose={() => setShowLineConnectModal(false)} size="sm:max-w-md">
            <ModalSheetHeader>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold">
                  <MessageCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {tr('เชื่อมบอท LINE เข้ากลุ่ม', 'Connect the LINE bot to a group')}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {classroom.name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowLineConnectModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl cursor-pointer shrink-0"
                aria-label={tr('ปิด', 'Close')}
              >
                <X className="w-4 h-4" />
              </button>
            </ModalSheetHeader>

            <ModalSheetBody>
            {/* Connection Status Badge */}
            <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-xs">
              <span className="text-slate-500 font-bold shrink-0">{tr('สถานะการเชื่อมต่อ:', 'Connection:')}</span>
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
                  ? `🟢 ${tr('เชื่อมแล้ว', 'Connected')}${lineConnection.groupName ? `: ${lineConnection.groupName}` : ''}`
                  : lineConnection.status === 'waiting'
                  ? tr('🟡 รอเพิ่มบอทเข้ากลุ่ม', '🟡 Waiting for the bot to be added')
                  : tr('⚪ ยังไม่ได้เชื่อมต่อ', '⚪ Not connected')}
              </span>
            </div>

            {lineConnection.status === 'connected' ? (
              <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-800 dark:text-emerald-200 space-y-1">
                <p className="font-bold">{tr('กลุ่มนี้พร้อมรับแจ้งเตือนงานของห้องเรียน', 'This group will receive classroom notifications')}</p>
                <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">{tr('หากนำบอทออกจากกลุ่ม การเชื่อมต่อจะยกเลิกเอง', 'Removing the bot from the group disconnects it automatically')}</p>
              </div>
            ) : (
              <LineGroupConnectSteps
                botFriend={teacherBot.botFriend}
                addFriendUrl={teacherBot.addFriendUrl}
                groups={lineGroups.groups}
                lineLinked={lineGroups.lineLinked}
                onLinkGroup={(ref) => handleLineConnection('link-group', ref)}
                linkingRef={linkingGroupRef}
                onRefresh={lineGroups.refresh}
                refreshing={lineGroups.refreshing}
              />
            )}

            </ModalSheetBody>

            {/* Actions */}
            <ModalSheetFooter className="justify-start">
              {lineConnection.status !== 'connected' ? (
                <button
                  type="button"
                  onClick={() => setShowLineConnectModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs cursor-pointer"
                >
                  {tr('ปิด', 'Close')}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isLineLoading}
                    onClick={() => handleLineConnection('test')}
                    className="flex-1 px-3 py-2.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-300 font-bold text-xs hover:bg-emerald-100 cursor-pointer"
                  >
                    {tr('ทดสอบส่งข้อความ', 'Send test message')}
                  </button>
                  <button
                    type="button"
                    disabled={isLineLoading}
                    onClick={() => handleLineConnection('disconnect')}
                    className="px-3 py-2.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 font-bold text-xs hover:bg-rose-100 cursor-pointer"
                  >
                    {tr('ยกเลิกเชื่อมต่อ', 'Disconnect')}
                  </button>
                </>
              )}
            </ModalSheetFooter>
        </ModalSheet>
      )}
      <ActionToast toast={toast} onClose={hideToast} />
    </div>
  );
}

function InstitutionTag({ institution, otherSchool }: { institution?: string; otherSchool: boolean }) {
  const { tr, language } = useLanguage();
  if (!institution?.trim()) {
    return <p className="text-[10px] text-slate-400 mt-0.5 truncate">{tr('🏫 ไม่ระบุโรงเรียน', '🏫 No school')}</p>;
  }
  return (
    <p
      className={`text-[10px] mt-0.5 truncate ${otherSchool ? 'font-bold text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}
      title={otherSchool ? tr('โรงเรียนไม่ตรงกับโรงเรียนของคุณครู', 'School differs from yours') : institutionLabel(institution, language)}
    >
      {otherSchool ? '⚠️' : '🏫'} {institutionLabel(institution, language)}
      {otherSchool && <span className="ml-1 px-1.5 py-px rounded-full bg-rose-100 dark:bg-rose-950 text-[9px]">{tr('ต่างโรงเรียน', 'Other school')}</span>}
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
  const { tr } = useLanguage();
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
          <span>{tr('รายชื่อผู้เรียน', 'Students')} ({students.length})</span>
        </h2>
        <button
          onClick={onOpenAddStudent}
          className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-xs transition-all"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>{tr('+ เพิ่มผู้เรียน', '+ Add student')}</span>
        </button>
      </div>

      {otherSchoolCount > 0 && (
        <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-[11px] font-bold text-rose-800 dark:text-rose-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
          <span>{tr(`นักเรียน ${otherSchoolCount} คนระบุโรงเรียนต่างจากคุณครู หากกรอกผิด กดไอคอนดินสอเพื่อแก้`, `${otherSchoolCount} students listed a different school from yours. If it's a typo, tap the pencil to fix it`)}</span>
        </div>
      )}

      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr('ค้นหาชื่อหรือรหัสนักเรียน...', 'Search by name or student ID...')}
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
              <p className="text-[10px] text-slate-400 font-mono mt-0.5">{student.student_id || tr('ไม่มีรหัส', 'No ID')}</p>
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
                title={tr('แก้ไขชื่อ นามสกุล รหัสนักเรียน และโรงเรียน', 'Edit name, student ID and school')}
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onRemoveStudent(student.id)}
                className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title={tr('ลบผู้เรียนออกจากห้องเรียน', 'Remove student from classroom')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        {!filtered.length && <p className="col-span-full text-xs text-slate-400 text-center py-6">{tr('ไม่พบรายชื่อผู้เรียน', 'No students found')}</p>}
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
  create,
  update,
  action,
  exportAllCsv,
  selectSession,
  onUpdateSession,
  onDeleteSession,
  isUpdatingSession,
}: {
  classroom: Classroom;
  sessions: AttendanceSession[];
  session: AttendanceSession | null;
  /** Every session's records; each roster indexes its own session. */
  records: AttendanceRecord[];
  counts: Record<string, number>;
  title: string;
  setTitle: (v: string) => void;
  /** Opens a period; resolves to its id (null when it failed). */
  create: () => Promise<string | null>;
  update: (sessionId: string, studentId: string, status: AttendanceStatus) => void;
  action: (sessionId: string, a: 'close' | 'extend') => void;
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
  /** "ส่งซ้ำใน LINE" for an open period: the bot, or the share popup when it cannot. */
  isUpdatingSession?: boolean;
}) {
  /** The open period whose check-in QR fills the screen. */
  const [qrSessionId, setQrSessionId] = useState<string | null>(null);
  const { tr } = useLanguage();
  // Collapsible session state: which session is expanded
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(
    session?.id || sessions.find((s) => s.status === 'open')?.id || sessions[0]?.id || null
  );
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editing, setEditing] = useState<AttendanceSession | null>(null);

  // Keep expanded session in sync with parent session (adjusted during render
  // when the parent's session changes, instead of in an effect).
  const [syncedSessionId, setSyncedSessionId] = useState<string | undefined>(undefined);
  if (session?.id !== syncedSessionId) {
    setSyncedSessionId(session?.id);
    if (session?.id) setExpandedSessionId(session.id);
  }

  // Per-session indexes, so a roster that is still animating closed keeps
  // showing its own session's statuses after another session is selected.
  const indexBySession = useMemo(() => {
    const groups = new Map<string, AttendanceRecord[]>();
    for (const record of records) groups.set(record.session_id, [...(groups.get(record.session_id) || []), record]);
    return new Map([...groups].map(([id, list]) => [id, indexRecords(list)]));
  }, [records]);


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

  /** Name of the classmate whose phone did a borrowed-phone check-in (they are on the same roster). */
  const senderName = (senderId: string) => {
    const sender = (classroom.students || []).find((s) => s.id === senderId || s.line_uid === senderId);
    return sender ? `${sender.first_name} ${sender.last_name}`.trim() : tr('เพื่อน', 'a classmate');
  };

  return (
    <section className="max-w-4xl mx-auto space-y-6">
      {/* 1. Top Header Bar with Open-Form Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarCheck className="w-5 h-5 text-amber-500" />
            <span>{tr('เช็กชื่อรายคาบ', 'Attendance by period')}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            <MobileText short={tr('เปิดคาบและเช็กชื่อแบบเรียลไทม์', 'Open periods and take attendance live')} full={tr('เปิดคาบเรียน เช็กชื่อแบบเรียลไทม์ และแก้สถานะรายคนได้ตลอด', 'Open a period, take attendance in real time, and adjust any student at any time')} />
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {sessions.length > 0 && (
            <button
              type="button"
              onClick={exportAllCsv}
              title={tr('ส่งออกการเช็กชื่อทุกคาบ (แถว = นักเรียน, คอลัมน์ = คาบเรียน)', 'Export every period (rows = students, columns = periods)')}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>{tr('ส่งออก CSV ทุกคาบ', 'Export all periods (CSV)')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowCreateForm((prev) => !prev)}
            className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{showCreateForm ? tr('ปิดแบบฟอร์ม', 'Close form') : tr('เปิดคาบเช็กชื่อใหม่', 'New attendance period')}</span>
          </button>
        </div>
      </div>

      {/* 3. Collapsible New Session Creation Form */}
      {showCreateForm && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-amber-300 dark:border-amber-800/70 p-5 shadow-md space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-amber-500" />
              <span>{tr('คาบเช็กชื่อใหม่', 'New attendance period')}</span>
            </h3>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1">
            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1">{tr('ชื่อคาบเรียน *', 'Period name *')}</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none focus:ring-2 focus:ring-amber-500"
                placeholder={tr('เช่น คาบที่ 1 ภาษาไทยเพื่อการสื่อสาร', 'e.g. Period 1, Thai for Communication')}
              />
            </div>
            <p className="text-[11px] text-slate-400">
              {tr('สแกนภายใน 15 นาทีนับว่าตรงเวลา หลังจากนั้นนับว่าสาย จนกว่าจะปิดคาบ • คุณครูแก้สถานะได้ทุกเมื่อ', 'Scans within 15 minutes are on time, later ones late, until you close it • you can change any status')}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold"
            >
              {tr('ยกเลิก', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={async () => {
                setShowCreateForm(false);
                // Straight to the check-in QR for the class.
                const id = await create();
                if (id) setQrSessionId(id);
              }}
              className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 cursor-pointer shadow-md shadow-amber-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>{tr('เปิดเช็กชื่อและแสดง QR', 'Open attendance & show QR')}</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. Statistics Summary Bento Cards (phones: one row of four, number over a short label) */}
      <div className="bg-white dark:bg-slate-900 p-1.5 sm:p-4 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs grid grid-cols-4 gap-1 sm:gap-3">
        {[
          ['on_time', tr('ตรงเวลา', 'On time'), tr('ตรงเวลา', 'On time'), counts['on_time'] || 0, 'bg-emerald-500', 'text-emerald-600 dark:text-emerald-400'],
          ['late', tr('มาสาย', 'Late'), tr('สาย', 'Late'), counts['late'] || 0, 'bg-amber-400', 'text-amber-600 dark:text-amber-400'],
          ['absent', tr('ขาด / ยังไม่เช็ก', 'Absent / unchecked'), tr('ขาด', 'Absent'), counts['absent'] || 0, 'bg-rose-500', 'text-rose-600 dark:text-rose-400'],
          ['excused', tr('ลา', 'Excused'), tr('ลา', 'Excused'), counts['excused'] || 0, 'bg-sky-500', 'text-sky-600 dark:text-sky-400'],
        ].map(([key, label, shortLabel, count, dotCls, numberCls]) => (
          <div key={key} className="min-w-0 px-1 py-1.5 sm:p-3 rounded-xl sm:rounded-2xl bg-slate-50 dark:bg-slate-800/60 flex flex-col-reverse items-center sm:flex-col sm:items-start" title={String(label)}>
            <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1 sm:gap-1.5 max-w-full">
              <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0 ${dotCls}`} />
              <span className="truncate sm:hidden">{shortLabel}</span>
              <span className="hidden sm:inline">{label}</span>
            </span>
            <p className={`text-lg sm:text-2xl font-black leading-tight sm:mt-0.5 tabular-nums ${Number(count) > 0 ? numberCls : 'text-slate-400'}`}>{count}</p>
          </div>
        ))}
      </div>

      {qrSessionId && <AttendanceQrScreen classroomId={classroom.id} sessionId={qrSessionId} onClose={() => setQrSessionId(null)} />}

      {/* 5. Sessions Accordion List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <span>{tr('คาบเรียนทั้งหมด', 'All periods')}</span>
            <span className="text-slate-400 font-normal">({sessions.length} {tr('คาบ', 'periods')})</span>
          </h3>
          <span className="text-[11px] text-slate-400">{tr('แตะคาบเพื่อดูรายชื่อ', 'Tap a period to see the roster')}</span>
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
                <div className="flex items-start sm:items-center gap-3 min-w-0 w-full sm:w-auto flex-1 sm:min-w-48">
                  {isOpen ? (
                    <span className="relative flex w-3 h-3 shrink-0 mt-1 sm:mt-0">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                      <span className="relative inline-flex w-3 h-3 rounded-full bg-emerald-500" />
                    </span>
                  ) : (
                    <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full shrink-0 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      {tr('⚪ ปิดแล้ว', '⚪ Closed')}
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {isOpen && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-black text-[10px] shadow-xs">
                          {tr('กำลังเปิดรับเช็กชื่อ', 'Taking attendance')}
                        </span>
                      )}
                      <h4 className="text-sm font-black text-slate-900 dark:text-white">{item.title}</h4>
                      {onUpdateSession && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(item);
                          }}
                          className="-ml-1 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          title={tr('แก้ไขคาบเช็กชื่อ', 'Edit period')}
                          aria-label={tr('แก้ไขคาบเช็กชื่อ', 'Edit period')}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {/* Phones: the time window drops to its own line under the timestamp. */}
                    <p className={`text-[11px] mt-0.5 ${isOpen ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400'}`}>
                      <span>
                        {isOpen
                          ? `${tr('เริ่มเมื่อ', 'Started')} ${new Date(item.starts_at).toLocaleTimeString(tr('th-TH', 'en-US'))}`
                          : new Date(item.starts_at).toLocaleString(tr('th-TH', 'en-US'))}
                      </span>
                      <span className="hidden sm:inline"> • </span>
                      <span className="block sm:inline">
                        {isOpen
                          ? tr(
                              `ตรงเวลาภายใน ${item.on_time_until_minutes} นาที • หลังจากนั้นนับว่าสายจนปิดคาบ`,
                              `on time within ${item.on_time_until_minutes} min • late after that until closed`
                            )
                          : `${tr('ตรงเวลา', 'on time')} ${item.on_time_until_minutes}m / ${tr('สาย', 'late')} ${item.late_until_minutes}m`}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Phones: actions take their own full-width row so they never squeeze the title. */}
                <div className="flex items-center gap-2 w-full sm:w-auto" onClick={(e) => e.stopPropagation()}>
                  {isOpen && (
                    <>
                      <button
                        type="button"
                        onClick={() => setQrSessionId(item.id)}
                        title={tr('แสดง QR ให้นักเรียนสแกนเช็กชื่อ (เปลี่ยนทุกไม่กี่วินาที)', 'Show the check-in QR for students to scan (changes every few seconds)')}
                        className="flex-1 sm:flex-none whitespace-nowrap px-3 py-2 sm:py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black inline-flex items-center justify-center gap-1 cursor-pointer shadow-xs"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        {tr('แสดง QR เช็กชื่อ', 'Show check-in QR')}
                      </button>
                      <button
                        type="button"
                        onClick={() => action(item.id, 'close')}
                        className="flex-1 sm:flex-none whitespace-nowrap px-3 py-2 sm:py-1.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold hover:bg-rose-100 cursor-pointer shadow-xs"
                      >
                        {tr('ปิดรับเช็กชื่อ', 'Close attendance')}
                      </button>
                    </>
                  )}


                  <button
                    type="button"
                    onClick={() => toggleSession(item.id)}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? tr('ย่อกลับ', 'Collapse') : tr('ดูรายชื่อ', 'View roster')}
                    title={isExpanded ? tr('ย่อกลับ', 'Collapse') : tr('ดูรายชื่อ', 'View roster')}
                    className={`shrink-0 sm:flex-none whitespace-nowrap w-9 h-9 sm:w-auto sm:h-auto px-0 sm:px-3 sm:py-1.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1 cursor-pointer ${
                      isOpen
                        ? 'bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-200 text-white dark:text-slate-900 shadow-xs'
                        : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <span className="hidden sm:inline">{isExpanded ? tr('ย่อกลับ', 'Collapse') : tr('ดูรายชื่อ', 'View roster')}</span>
                    <ChevronDown className={`w-4 h-4 sm:w-3.5 sm:h-3.5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {onDeleteSession && (
                    <button
                      type="button"
                      onClick={() => onDeleteSession(item.id)}
                      className="shrink-0 w-9 h-9 sm:w-auto sm:h-auto flex items-center justify-center sm:p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title={tr('ลบคาบเช็กชื่อนี้', 'Delete this period')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded Detail & Interactive Student Roster */}
              <Collapse open={isExpanded}>
                <div className="p-4 sm:p-5 bg-slate-50/50 dark:bg-slate-850/50 border-t border-slate-200 dark:border-slate-800">
                  <SessionRoster
                    session={item}
                    students={classroom.students || []}
                    index={indexBySession.get(item.id) || EMPTY_RECORD_INDEX}
                    update={update}
                    senderName={senderName}
                  />
                </div>
              </Collapse>
            </div>
          );
        })}

        {!sessions.length && (
          <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 text-xs text-slate-400 space-y-2">
            <CalendarCheck className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="font-bold">{tr('ยังไม่มีประวัติคาบเช็กชื่อ', 'No attendance periods yet')}</p>
            <p className="text-[11px]">{tr('กด "เปิดคาบเช็กชื่อใหม่" ด้านบนเพื่อเริ่ม', 'Tap "New attendance period" above to start')}</p>
          </div>
        )}
      </div>

      {/* Settings sheet, portaled out of the animated tab panel: its transform
          would otherwise confine this fixed overlay to the panel. */}
      {editing &&
        onUpdateSession &&
        createPortal(
          <SessionSettingsSheet
            key={editing.id}
            session={editing}
            busy={!!isUpdatingSession}
            onClose={() => setEditing(null)}
            onSave={(fields) => {
              onUpdateSession(editing.id, fields.title, fields.status, fields.startsAt, fields.onTime, fields.late);
              setEditing(null);
            }}
          />,
          document.body
        )}
    </section>
  );
}

const EMPTY_RECORD_INDEX = new Map<string, AttendanceRecord>();

type SessionSettings = { title: string; status?: 'open' | 'closed'; startsAt?: string; onTime: number; late: number };

/**
 * Edit a period in one place: name, start time, the on-time / late windows,
 * quick extensions and whether it still accepts check-ins. A bottom sheet on
 * phones, a centered dialog from sm up.
 */
function SessionSettingsSheet({
  session,
  busy,
  onClose,
  onSave,
}: {
  session: AttendanceSession;
  busy: boolean;
  onClose: () => void;
  onSave: (fields: SessionSettings) => void;
}) {
  const { tr } = useLanguage();
  const [title, setTitle] = useState(session.title);
  const [accepting, setAccepting] = useState(session.status === 'open');

  const wasOpen = session.status === 'open';
  const statusChanged = accepting !== wasOpen;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      status: statusChanged ? (accepting ? 'open' : 'closed') : undefined,
      // Only the name and open / closed are set by hand; the timing is the system's.
      startsAt: undefined,
      onTime: session.on_time_until_minutes,
      late: session.late_until_minutes,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 w-full sm:max-w-md shadow-xl max-h-[92dvh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-black text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <Pencil className="w-4 h-4 text-amber-500" />
            <span>{tr('แก้ไขคาบเช็กชื่อ', 'Edit period')}</span>
          </h3>
          <button type="button" onClick={onClose} aria-label={tr('ปิด', 'Close')} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div className="space-y-1">
            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">{tr('ชื่อคาบ', 'Period name')}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder={tr('เช่น คาบที่ 1 ภาษาไทยเพื่อการสื่อสาร', 'e.g. Period 1, Thai for Communication')}
              className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">{tr('การรับเช็กชื่อ', 'Check-ins')}</span>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800">
              {[
                [true, tr('🟢 เปิดรับ', '🟢 Open')],
                [false, tr('⚪ ปิดรับ', '⚪ Closed')],
              ].map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  aria-pressed={accepting === value}
                  onClick={() => setAccepting(value as boolean)}
                  className={`py-2 rounded-xl text-xs font-black transition-colors cursor-pointer ${
                    accepting === value ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {statusChanged && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300 animate-in fade-in slide-in-from-top-1">
                {accepting
                  ? tr('เปิดรับอีกครั้ง: นักเรียนที่ถูกตั้งเป็น "ขาด" อัตโนมัติจะกลับเป็นยังไม่เช็ก และเช็กชื่อได้', 'Reopening: students marked absent automatically go back to unchecked and can check in')
                  : tr('ปิดรับ: นักเรียนที่ยังไม่เช็กชื่อจะถูกตั้งเป็น "ขาด"', 'Closing: students who have not checked in are marked absent')}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-slate-100 dark:border-slate-800">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer">
            {tr('ยกเลิก', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!title.trim() || busy}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black cursor-pointer disabled:opacity-50"
          >
            {tr('บันทึก', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Height-animated disclosure. Children stay mounted while closing so the
 * content slides shut instead of vanishing, then unmount once it has.
 */
function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  return (
    <div
      inert={!open}
      onTransitionEnd={(e) => e.target === e.currentTarget && !open && setMounted(false)}
      className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      }`}
    >
      <div className="min-h-0 overflow-hidden">{mounted && children}</div>
    </div>
  );
}

/** A student without a record in the session has not checked in: shown apart from an explicit "absent". */
type RosterStatus = AttendanceStatus | 'idle';
type RosterFilter = 'all' | RosterStatus;

const ROSTER_FILTERS: { id: RosterFilter; label: Bilingual; dot: string; pill: string; text: string }[] = [
  { id: 'all', label: { th: 'ทั้งหมด', en: 'All' }, dot: '', pill: 'bg-slate-900 dark:bg-white', text: 'text-white dark:text-slate-900' },
  { id: 'on_time', label: { th: 'ตรงเวลา', en: 'On time' }, dot: 'bg-emerald-500', pill: 'bg-emerald-500', text: 'text-white' },
  { id: 'late', label: { th: 'มาสาย', en: 'Late' }, dot: 'bg-amber-400', pill: 'bg-amber-400', text: 'text-slate-950' },
  { id: 'excused', label: { th: 'ลา', en: 'Excused' }, dot: 'bg-sky-500', pill: 'bg-sky-500', text: 'text-white' },
  { id: 'absent', label: { th: 'ขาด', en: 'Absent' }, dot: 'bg-rose-500', pill: 'bg-rose-500', text: 'text-white' },
  { id: 'idle', label: { th: 'ยังไม่เช็ก', en: 'Unchecked' }, dot: 'bg-slate-300 dark:bg-slate-600', pill: 'bg-slate-500', text: 'text-white' },
];

const STATUS_CHOICES = [
  ['on_time', { th: 'ตรงเวลา', en: 'On time' }, 'bg-emerald-100 text-emerald-800 border-emerald-300'],
  ['late', { th: 'มาสาย', en: 'Late' }, 'bg-amber-100 text-amber-800 border-amber-300'],
  ['excused', { th: 'ลา', en: 'Excused' }, 'bg-sky-100 text-sky-800 border-sky-300'],
  ['absent', { th: 'ขาด', en: 'Absent' }, 'bg-rose-100 text-rose-800 border-rose-300'],
] as const;

const statusSelectCls: Record<RosterStatus, string> = {
  on_time: 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  late: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  excused: 'bg-sky-50 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800',
  absent: 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
  idle: 'bg-slate-50 text-slate-500 border-dashed border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-600',
};

/** One session's roster: status filter, search, and a status control per student. */
function SessionRoster({
  session,
  students,
  index,
  update,
  senderName,
}: {
  session: AttendanceSession;
  students: User[];
  index: Map<string, AttendanceRecord>;
  update: (sessionId: string, studentId: string, status: AttendanceStatus) => void;
  senderName: (senderId: string) => string;
}) {
  const { tr, language } = useLanguage();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [trackFilterBar, filterIndicator] = useSlidingIndicator(filter);

  const statusOf = (student: User): RosterStatus => findStudentRecord(index, student)?.status || 'idle';

  const filterCounts = useMemo(() => {
    const result: Record<RosterFilter, number> = { all: students.length, on_time: 0, late: 0, excused: 0, absent: 0, idle: 0 };
    for (const student of students) result[findStudentRecord(index, student)?.status || 'idle']++;
    return result;
  }, [students, index]);

  const query = search.trim().toLowerCase();
  const visible = students.filter((student) => {
    const matchQuery =
      !query ||
      `${student.first_name} ${student.last_name}`.toLowerCase().includes(query) ||
      (student.student_id && student.student_id.includes(query));
    return matchQuery && (filter === 'all' || statusOf(student) === filter);
  });

  const activeFilter = ROSTER_FILTERS.find((f) => f.id === filter)!;
  const isSessionOpen = session.status === 'open';

  return (
    <div className="space-y-3">
      {/* Status filter (sliding highlight) & search */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5" />
            <span>{tr('แสดงนักเรียนตามสถานะ', 'Show students by status')}</span>
          </span>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr('ค้นหาชื่อหรือรหัสนักเรียน...', 'Search by name or student ID...')}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none bg-white dark:bg-slate-900"
            />
          </div>
        </div>

        <div
          ref={trackFilterBar}
          className="relative flex gap-1 p-1 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-x-auto"
        >
          {filterIndicator && (
            <span
              aria-hidden
              className={`absolute top-0 left-0 rounded-xl shadow-xs transition-[transform,width,height,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${activeFilter.pill}`}
              style={indicatorStyle(filterIndicator)}
            />
          )}
          {ROSTER_FILTERS.map(({ id, label, dot, pill, text }) => {
            const selected = filter === id;
            return (
              <button
                key={id}
                type="button"
                data-active={selected}
                aria-pressed={selected}
                onClick={() => setFilter(id)}
                className={`relative flex-1 min-w-max px-3 py-1.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors duration-300 cursor-pointer ${
                  selected
                    ? `${text} ${filterIndicator ? '' : pill}`
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {dot && <span className={`w-2 h-2 rounded-full ${selected ? 'bg-current opacity-70' : dot}`} />}
                <span>{label[language]}</span>
                <span className={`px-1.5 min-w-5 rounded-full text-[10px] font-black ${selected ? 'bg-black/10 dark:bg-white/20' : 'bg-slate-100 dark:bg-slate-800'}`}>
                  {filterCounts[id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Student Roster (re-keyed per filter so it fades in like a tab change) */}
      <div key={filter} className="space-y-1.5 max-h-96 overflow-y-auto pr-1 animate-in fade-in slide-in-from-top-1 [--tw-duration:320ms]">
        {visible.map((student) => {
          const record = findStudentRecord(index, student);
          const currentStatus = statusOf(student);

          return (
            <div
              key={student.id}
              className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex sm:flex-wrap items-center justify-between gap-2 text-xs shadow-xs"
            >
              <div className="min-w-0 flex-1 sm:min-w-44">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] sm:text-xs font-bold text-slate-900 dark:text-white truncate">
                    {student.first_name} {student.last_name}
                  </span>
                  {currentStatus === 'idle' && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-600 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-500" />
                      {isSessionOpen ? tr('รอเช็กชื่อ', 'Waiting') : tr('ไม่ได้เช็กชื่อ', 'Not checked')}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 font-mono">
                  {tr('รหัส', 'ID')}: {student.student_id || '-'}
                  {record?.checked_at && ` • ${tr('เช็กเมื่อ', 'checked at')} ${new Date(record.checked_at).toLocaleTimeString(tr('th-TH', 'en-US'))}`}
                  {record?.checked_in_by && (
                    <span className="font-sans font-bold text-sky-600 dark:text-sky-400" title={tr('นักเรียนเช็กชื่อด้วยโทรศัพท์ของเพื่อนร่วมห้อง', 'Checked in using a classmate\'s phone')}>
                      {tr(` • 📱 เช็กชื่อจากเครื่องของ ${senderName(record.checked_in_by)}`, ` • 📱 checked in on ${senderName(record.checked_in_by)}'s phone`)}
                    </span>
                  )}
                </span>
              </div>

              {/* Mobile: compact status dropdown. Phones force <select> to 16px (no iOS
                  zoom), so the real select is invisible on top of a small label. */}
              <div className={`relative shrink-0 sm:hidden w-24 h-8 rounded-lg border flex items-center pl-2.5 pr-6 text-[11px] font-bold focus-within:ring-2 focus-within:ring-amber-400 ${statusSelectCls[currentStatus]}`}>
                <span aria-hidden className="truncate">
                  {currentStatus === 'idle'
                    ? (isSessionOpen ? tr('รอเช็ก', 'Waiting') : tr('ไม่ได้เช็ก', 'Unchecked'))
                    : STATUS_CHOICES.find(([k]) => k === currentStatus)?.[1][language]}
                </span>
                <select
                  value={currentStatus}
                  onChange={(e) => update(session.id, student.id, e.target.value as AttendanceStatus)}
                  aria-label={`${tr('สถานะของ', 'Status of')} ${student.first_name} ${student.last_name}`}
                  className="absolute inset-0 w-full h-full opacity-0 appearance-none cursor-pointer"
                >
                  {currentStatus === 'idle' && (
                    <option value="idle" disabled>
                      {isSessionOpen ? tr('รอเช็ก', 'Waiting') : tr('ไม่ได้เช็ก', 'Unchecked')}
                    </option>
                  )}
                  {STATUS_CHOICES.map(([stKey, stLabel]) => (
                    <option key={stKey} value={stKey}>
                      {stLabel[language]}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
              </div>

              {/* Desktop: 1-click status switcher buttons */}
              <div className="hidden sm:grid grid-cols-4 gap-1">
                {STATUS_CHOICES.map(([stKey, stLabel, activeCls]) => {
                  const isActive = currentStatus === stKey;
                  return (
                    <button
                      key={stKey}
                      type="button"
                      onClick={() => update(session.id, student.id, stKey)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                        isActive
                          ? `${activeCls} font-black shadow-xs ring-1 ring-current`
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 hover:border-slate-400'
                      }`}
                    >
                      {stLabel[language]}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {!visible.length && (
          <p className="text-xs text-slate-400 text-center py-6">
            {query ? tr('ไม่พบนักเรียนที่ค้นหา', 'No matching students') : tr(`ไม่มีนักเรียนในสถานะ “${activeFilter.label.th}”`, `No students marked “${activeFilter.label.en}”`)}
          </p>
        )}
      </div>
    </div>
  );
}

