'use client';
import { useUser } from '@clerk/nextjs';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Avatar } from '@/components/Avatar';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LineGroupConnectSteps } from '@/components/LineGroupConnectSteps';
import { dataService, type ClassroomChangeEvent } from '@/lib/supabase/dataService';
import { fetchCached, readCache, TEACHER_DASHBOARD_CACHE_KEY, watchClassrooms } from '@/lib/cache/sessionCache';
import { useAcademicCalendar } from '@/lib/hooks/useAcademicCalendar';

type TeacherDashboardData = Awaited<ReturnType<typeof dataService.getTeacherDashboard>>;

/** Temporary id for an indicator added in the editor (kept outside render code). */
const draftIndicatorId = (n: number) => `ind-${Date.now()}-${n}`;
import {
  Assignment,
  Submission,
  Classroom,
  ClassroomTeacher,
  Course,
  CourseLearningIndicator,
  CourseLessonPlan,
  LearningIndicator,
  User,
} from '@/types/database';
import {
  formatAcademicPeriod,
  getAcademicYearOptions,
} from '@/lib/utils/academicYear';
import {
  Users,
  School,
  FileCheck,
  ShieldAlert,
  PlusCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Sparkles,
  Clock,
  UserPlus,
  Share2,
  Edit2,
  Trash2,
  X,
  MessageCircle,
  Mail,
  QrCode,
  Copy,
  Check,
  Send,
  ChevronDown,
  Sliders,
  ArrowUp,
  ArrowDown,
  Layers,
  Award,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  FolderKanban,
  FlaskConical,
  Search,
  GraduationCap,
  UserCheck,
  UserX,
  Building2,
  Loader2,
} from 'lucide-react';
import { notificationManager } from '@/lib/utils/notificationManager';
import { gradingCounts, isIntegrityFlagged, needsGrading } from '@/lib/utils/gradingStatus';
import { ASSIGNMENT_STATUS_CLASSES, isAssignmentDraft, isAssignmentPublished } from '@/lib/utils/assignmentWindow';
import { formatDateTime } from '@/lib/utils/datetime';
import { GradingBar } from '@/components/AssignmentProgressCard';
import { TeacherProfileFields, announceTeacherProfile, profileFormValues } from '@/components/TeacherProfileGate';
import { TEACHER_PROFILE_UPDATED_EVENT, isTeacherProfileComplete } from '@/lib/utils/teacherProfile';
import { canonicalInstitution, institutionLabel } from '@/lib/data/thaiInstitutions';
import { SemesterSelect } from '@/components/SemesterSelect';
import { filterClassroomsBySemester, semesterOptions } from '@/lib/utils/semesterFilter';
import { EditStudentModal } from '@/components/EditStudentModal';
import { ModalSheet, ModalSheetBody, ModalSheetFooter, ModalSheetHeader, MODAL_SHEET_FORM } from '@/components/ModalSheet';
import { Collapse } from '@/components/Collapse';
import { MobileText } from '@/components/MobileText';

/**
 * Checks an assessment framework before saving. Returns a message naming the
 * first problem, or null when it is valid. Used by course creation and the
 * course settings dialog so both modes follow the same rules:
 * - indicator: at least one item, every item named
 * - competency: the same, plus at least one named lesson plan, every plan
 *   mapped to at least one competency, and every competency used by a plan
 */
function getFrameworkProblem(
  mode: 'indicator' | 'competency',
  items: CourseLearningIndicator[],
  plans: CourseLessonPlan[],
  language: string
): string | null {
  const th = language === 'th';
  const itemLabel = mode === 'competency' ? (th ? 'สมรรถนะ' : 'competency') : (th ? 'ตัวชี้วัด' : 'indicator');
  if (items.length === 0) return th ? `กรุณาเพิ่ม${itemLabel}อย่างน้อย 1 รายการ` : `Add at least one ${itemLabel}`;
  const unnamedItem = items.findIndex((item) => !item.title.trim());
  if (unnamedItem !== -1) return th ? `กรุณากรอกชื่อ${itemLabel} ข้อ ${unnamedItem + 1}` : `Enter a name for ${itemLabel} ${unnamedItem + 1}`;
  if (mode !== 'competency') return null;

  if (plans.length === 0) return th ? 'กรุณาเพิ่มแผนการสอนอย่างน้อย 1 แผน' : 'Add at least one lesson plan';
  const itemIds = new Set(items.map((item) => item.id));
  for (const [index, plan] of plans.entries()) {
    if (!plan.title.trim()) return th ? `กรุณากรอกชื่อแผนการสอนที่ ${index + 1}` : `Enter a name for lesson plan ${index + 1}`;
    if (!(plan.mapped_indicator_ids || []).some((id) => itemIds.has(id))) {
      return th ? `แผนการสอนที่ ${index + 1} ยังไม่ได้ map กับสมรรถนะใด` : `Lesson plan ${index + 1} is not mapped to any competency`;
    }
  }
  const mappedIds = new Set(plans.flatMap((plan) => plan.mapped_indicator_ids || []));
  const unmapped = items.findIndex((item) => !mappedIds.has(item.id));
  if (unmapped !== -1) return th ? `สมรรถนะข้อ ${unmapped + 1} ยังไม่มีแผนการสอนที่ map ไว้` : `Competency ${unmapped + 1} is not mapped to any lesson plan`;
  return null;
}

/**
 * The teacher's workspace: courses, their classrooms and every management
 * dialog (classroom details, roster and admissions, LINE group, invites,
 * indicators, co-teachers). `dashboard` adds the welcome banner and stat
 * cards; `classrooms` is the classroom-focused page with a search box.
 */
export function TeacherWorkspace({
  view = 'dashboard',
  initialSemesterKey,
  onSemesterChange,
}: {
  view?: 'dashboard' | 'classrooms';
  /** Term to start on (e.g. from `?term=`); defaults to the current one. */
  initialSemesterKey?: string;
  onSemesterChange?: (key: string) => void;
} = {}) {
  const { t, tr, language } = useLanguage();
  const { user: clerkUser } = useUser();

  const [courses, setCourses] = useState<Course[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [indicators, setIndicators] = useState<LearningIndicator[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);

  const [loading, setLoading] = useState(true);

  // Current term from the teacher's own term dates (Clerk), or the default calendar.
  const { currentPeriod: defaultPeriod } = useAcademicCalendar();
  const currentTermKey = `${defaultPeriod.semester}_${defaultPeriod.yearCE}`;

  // Selected semester filter state (format: `${semester}_${yearCE}` or 'all')
  const [selectedSemesterKey, setSelectedSemesterKey] = useState<string>(() => initialSemesterKey || currentTermKey);
  const hasChosenSemesterRef = useRef(Boolean(initialSemesterKey));
  const changeSemester = (key: string) => {
    hasChosenSemesterRef.current = true;
    setSelectedSemesterKey(key);
    onSemesterChange?.(key);
  };
  // The teacher's term dates load with Clerk (or get edited): follow the new
  // current term unless a term was picked by hand.
  useEffect(() => {
    if (!hasChosenSemesterRef.current) setSelectedSemesterKey(currentTermKey);
  }, [currentTermKey]);
  // Classrooms page: filter courses and sections by name or code.
  const [classroomQuery, setClassroomQuery] = useState('');

  // Teacher Institution & Profile state
  const [teacherProfile, setTeacherProfile] = useState<User | null>(null);
  const [isInstitutionModalOpen, setIsInstitutionModalOpen] = useState(false);
  const [teacherInstitutionInput, setTeacherInstitutionInput] = useState('');
  const [teacherFirstNameInput, setTeacherFirstNameInput] = useState('');
  const [teacherLastNameInput, setTeacherLastNameInput] = useState('');
  const [teacherLineLink, setTeacherLineLink] = useState<{
    status: 'connected' | 'missing_line' | 'conflict' | 'previous_account' | 'error' | 'loading';
    botFriend?: boolean | null;
    addFriendUrl?: string;
  }>({ status: 'loading' });

  // Classroom Modals state
  const [isClassModalOpen, setIsClassModalOpen] = useState(false);
  const [editingClassroom, setEditingClassroom] = useState<Classroom | null>(null);
  const [selectedCourseForClass, setSelectedCourseForClass] = useState<string>('');
  const [classNameInput, setClassNameInput] = useState('');
  const [subjectCodeInput, setSubjectCodeInput] = useState('');
  const [formSemester, setFormSemester] = useState<number>(defaultPeriod.semester);
  const [formYearCE, setFormYearCE] = useState<number>(defaultPeriod.yearCE);

  // Student Roster & LINE Invite Modal state
  const [managingClassroom, setManagingClassroom] = useState<Classroom | null>(null);
  const [lineConnectionClassroom, setLineConnectionClassroom] = useState<Classroom | null>(null);
  const [lineConnectionStatuses, setLineConnectionStatuses] = useState<Record<string, 'disconnected' | 'waiting' | 'connected'>>({});
  const [studentTab, setStudentTab] = useState<'roster' | 'pending' | 'line' | 'line-group' | 'email'>('roster');
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [studentSearchResults, setStudentSearchResults] = useState<User[]>([]);
  const [isSearchingStudents, setIsSearchingStudents] = useState(false);
  const [emailInviteList, setEmailInviteList] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [lineConnection, setLineConnection] = useState<{
    status: 'disconnected' | 'waiting' | 'connected';
    groupName?: string;
    expiresAt?: string;
    connectedAt?: string;
  }>({ status: 'disconnected' });
  const [isLineConnectionLoading, setIsLineConnectionLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Course-level Learning Indicators & Rubrics Settings Modal
  const [editingCourseIndicators, setEditingCourseIndicators] = useState<Course | null>(null);
  const [indicatorListDraft, setIndicatorListDraft] = useState<CourseLearningIndicator[]>([]);
  const [isIndicatorsModalOpen, setIsIndicatorsModalOpen] = useState(false);
  const [savedTeacherIndicators, setSavedTeacherIndicators] = useState<CourseLearningIndicator[]>([]);
  const [isSavedLibraryOpen, setIsSavedLibraryOpen] = useState(false);
  // 'indicator' = ตัวชี้วัด (default), 'competency' = สมรรถนะรายวิชา
  const [indicatorMode, setIndicatorMode] = useState<'indicator' | 'competency'>('indicator');
  // Lesson-plan entries for competency mode
  const [lessonPlanDraft, setLessonPlanDraft] = useState<CourseLessonPlan[]>([]);
  // Course details (code / name / description) edited in the same popup
  const [courseDetailsDraft, setCourseDetailsDraft] = useState({ code: '', name: '', description: '' });
  const [isSavingIndicators, setIsSavingIndicators] = useState(false);

  // Co-Teaching Setup Modal (TA vs Research Evaluator)
  const [editingCourseCoTeachers, setEditingCourseCoTeachers] = useState<Course | null>(null);
  const [isCoTeachersModalOpen, setIsCoTeachersModalOpen] = useState(false);
  const [coTeachersDraft, setCoTeachersDraft] = useState<ClassroomTeacher[]>([]);
  const [newCoTeacherRole, setNewCoTeacherRole] = useState<'assistant' | 'researcher'>('assistant');
  const [coTeacherInviteStep, setCoTeacherInviteStep] = useState<1 | 2>(1);
  const [isCoTeachingArchitectureOpen, setIsCoTeachingArchitectureOpen] = useState(false);
  const [teacherSearchQuery, setTeacherSearchQuery] = useState('');
  const [teacherSearchResults, setTeacherSearchResults] = useState<User[]>([]);
  const [isSearchingTeachers, setIsSearchingTeachers] = useState(false);
  const [isCopiedTeacherLink, setIsCopiedTeacherLink] = useState(false);

  // Course Creation Modal state
  const [isCourseModalOpen, setIsCourseModalOpen] = useState(false);
  const [courseCodeInput, setCourseCodeInput] = useState('');
  const [courseNameInput, setCourseNameInput] = useState('');
  const [courseDescInput, setCourseDescInput] = useState('');
  const [courseSemesterInput, setCourseSemesterInput] = useState<number>(defaultPeriod.semester);
  const [courseYearInput, setCourseYearInput] = useState<number>(defaultPeriod.yearCE);
  const [courseIndicatorsDraft, setCourseIndicatorsDraft] = useState<CourseLearningIndicator[]>([]);
  const [courseLessonPlanDraft, setCourseLessonPlanDraft] = useState<CourseLessonPlan[]>([]);
  const [courseCreationMode, setCourseCreationMode] = useState<'indicator' | 'competency'>('indicator');
  const [courseCreationStep, setCourseCreationStep] = useState<1 | 2>(1);
  const [isSavingCourse, setIsSavingCourse] = useState(false);
  const [isCourseCloneFlow, setIsCourseCloneFlow] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Classroom ids for realtime filtering, kept in a ref so the subscription
  // does not restart on every reload.
  const myClassroomIdsRef = useRef<string[]>([]);

  // Each load gets a number; only the newest one may write state, so a slow
  // earlier response never overwrites fresher data.
  const loadSeqRef = useRef(0);

  const applyDashboard = (data: TeacherDashboardData) => {
    const myClassrooms = data.classrooms;
    myClassroomIdsRef.current = myClassrooms.map((c) => c.id);
    watchClassrooms(myClassroomIdsRef.current);

    setCourses(data.courses);
    setClassrooms(myClassrooms);
    setLineConnectionStatuses(Object.fromEntries(
      myClassrooms.map((classroom) => [
        classroom.id,
        classroom.line_connection_status || (classroom.line_group_id ? 'connected' : 'disconnected'),
      ])
    ));
    setAssignments(data.assignments);
    setIndicators(data.indicators);
    setAllSubmissions(data.submissions);

    // A missing name/institution is handled app-wide by TeacherProfileGate.
    if (data.profile) setTeacherProfile(data.profile);

    // The open roster dialog shows the freshly loaded (already hydrated) classroom.
    // Functional update: realtime reloads run an older closure of this function.
    setManagingClassroom((current) => (current ? myClassrooms.find((c) => c.id === current.id) || null : current));
  };

  /** useCache: show this session's copy at once and refetch only if something may have changed. */
  const loadAllData = async ({ useCache = false }: { useCache?: boolean } = {}) => {
    const teacherId = clerkUser?.id;
    if (!teacherId) return;
    const seq = ++loadSeqRef.current;
    try {
      if (useCache) {
        const hit = readCache<TeacherDashboardData>(TEACHER_DASHBOARD_CACHE_KEY, teacherId);
        if (hit) {
          applyDashboard(hit.value);
          setLoading(false);
          if (hit.fresh) return;
        }
      }
      // One request: the server reads everything in parallel, filtered to this
      // teacher (submissions are scores only, no profiles).
      const data = await fetchCached(TEACHER_DASHBOARD_CACHE_KEY, teacherId, () => dataService.getTeacherDashboard());
      if (seq !== loadSeqRef.current) return;
      applyDashboard(data);
    } catch (err) {
      console.error(err);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  };

  const handleOpenManagingClassroom = async (cls: Classroom, tab: 'roster' | 'pending' | 'line' | 'line-group' | 'email' = 'roster') => {
    setManagingClassroom(cls);
    setStudentTab(tab);
    setLineConnection({
      status: lineConnectionStatuses[cls.id] || cls.line_connection_status || (cls.line_group_id ? 'connected' : 'disconnected'),
      groupName: cls.line_group_name,
      connectedAt: cls.line_connected_at,
    });
    try {
      const roster = await dataService.getClassroomRoster(cls.id);
      if (roster.classroom) {
        setManagingClassroom(roster.classroom);
      }
    } catch (err) {
      console.warn('Error loading fresh classroom roster in dashboard:', err);
    }
  };

  const handleOpenLineConnectionPopup = (cls: Classroom) => {
    setManagingClassroom(null);
    setLineConnectionClassroom(cls);
    const status = lineConnectionStatuses[cls.id] || cls.line_connection_status || (cls.line_group_id ? 'connected' : 'disconnected');
    setLineConnection({
      status,
      groupName: cls.line_group_name,
      expiresAt: cls.line_connection_token_expires_at,
      connectedAt: cls.line_connected_at,
    });
  };

  const handleLineConnection = async (action: 'create' | 'test' | 'disconnect') => {
    const activeClassroom = lineConnectionClassroom || managingClassroom;
    if (!activeClassroom) return;
    setIsLineConnectionLoading(true);
    try {
      const response = await fetch('/api/line/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classroomId: activeClassroom.id, action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'LINE connection failed');
      setLineConnection(result);
      setLineConnectionStatuses((current) => ({ ...current, [activeClassroom.id]: result.status }));
      showToast(action === 'disconnect' ? tr('ยกเลิกการเชื่อมต่อแล้ว บอทออกจากกลุ่มแล้ว', 'Disconnected; the bot left the group') : action === 'test' ? tr('ส่งข้อความทดสอบแล้ว', 'Test message sent') : tr('พร้อมเชื่อมต่อ: เพิ่ม Pudding Bot เข้ากลุ่ม LINE ได้เลย', 'Ready: add Pudding Bot to your LINE group'));
    } catch (error) {
      showToast(error instanceof Error ? error.message : tr('ไม่สามารถเชื่อมต่อ LINE Group ได้', 'Could not connect the LINE group'));
    } finally {
      setIsLineConnectionLoading(false);
    }
  };

  useEffect(() => {
    // Shows this session's cached copy at once on purpose, then fetches if it may be stale.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAllData({ useCache: true });
  }, [clerkUser?.id]);

  // While a classroom waits for the bot to join a group, poll its status so the
  // dialog and class card flip to "connected" as soon as the webhook links it.
  const waitingLineClassroomId = lineConnection.status === 'waiting'
    ? (lineConnectionClassroom || managingClassroom)?.id
    : undefined;
  useEffect(() => {
    if (!waitingLineClassroomId) return;
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/line/connections?classroomId=${encodeURIComponent(waitingLineClassroomId)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const result = await response.json();
        if (result.status === 'waiting') return;
        setLineConnection(result);
        setLineConnectionStatuses((current) => ({ ...current, [waitingLineClassroomId]: result.status }));
        if (result.status === 'connected') showToast(tr(`เชื่อม LINE Group${result.groupName ? ` “${result.groupName}”` : ''} เรียบร้อยแล้ว`, `LINE group${result.groupName ? ` “${result.groupName}”` : ''} connected`));
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [waitingLineClassroomId, tr]);

  // Real-time subscription for instant dashboard updates & notifications when students join
  useEffect(() => {
    const teacherId = clerkUser?.id;
    if (!teacherId) return;
    // Realtime and the fallback poll often fire together; reload once per burst.
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = dataService.subscribeToClassroomChanges(teacherId, (payload: ClassroomChangeEvent) => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(loadAllData, 600);
      if (payload?.eventType === 'LOCAL_SYNC') {
        const { student, autoAdmit, action, source } = payload.detail || {};

        // Skip background poll updates or events with no student detail
        if (source === 'poll' || !student || !student.id) {
          return;
        }

        // When a teacher admits/rejects a student, the action is already confirmed by handleAdmitStudent/handleRejectStudent
        if (action === 'admitted' || action === 'rejected') {
          return;
        }

        const studentName =
          `${student.first_name || ''} ${student.last_name || ''}`.trim() || student.name || tr('นักเรียน', 'Student');

        if (autoAdmit === false) {
          notificationManager.add({
            title: tr('คำขอเข้าห้องเรียนใหม่', 'New join request'),
            message: tr(`นักเรียน ${studentName} ได้สแกน QR ขอเข้าห้องเรียน (รอคุณครูอนุมัติ)`, `${studentName} scanned the QR code to join (awaiting your approval)`),
            type: 'admission_request',
          });
          showToast(tr(`🔔 ${studentName} ขอเข้าห้องเรียน (รออนุมัติ)`, `🔔 ${studentName} asked to join (awaiting approval)`));
        } else {
          notificationManager.add({
            title: tr('นักเรียนเข้าห้องเรียนสำเร็จ', 'Student joined'),
            message: tr(`นักเรียน ${studentName} ได้เข้าห้องเรียนแล้ว`, `${studentName} joined the classroom`),
            type: 'student_join',
          });
          showToast(tr(`🎉 ${studentName} ได้เข้าร่วมห้องเรียน`, `🎉 ${studentName} joined the classroom`));
        }
      }
    }, { classroomIds: () => myClassroomIdsRef.current });

    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      unsub();
    };
  }, [clerkUser?.id, language, tr]);

  // Dynamically collect all available semester options across current period, courses, and classrooms
  const availableSemesterOptions = useMemo(
    () => semesterOptions(courses, classrooms, defaultPeriod.yearCE),
    [defaultPeriod.yearCE, courses, classrooms]
  );

  // Filter classrooms by selected semester
  const filteredClassrooms = useMemo(
    () => filterClassroomsBySemester(classrooms, courses, selectedSemesterKey, defaultPeriod.yearCE),
    [classrooms, courses, selectedSemesterKey, defaultPeriod.yearCE]
  );

  // Filter and group courses based on selected semester
  const groupedCourses = useMemo(() => {
    if (selectedSemesterKey === 'all') {
      // In "all" mode, courses with the same course code share a single card
      const codeMap = new Map<string, Course & { sections: Classroom[]; assignments: Assignment[] }>();

      for (const course of courses) {
        const sections = classrooms.filter(
          (cls) => cls.course_id === course.id || (cls.subject_code && cls.subject_code.startsWith(course.code))
        );
        const courseAssignments = assignments.filter(
          (as) => as.course_id === course.id || sections.some((s) => s.id === as.classroom_id)
        );

        const existing = codeMap.get(course.code);
        if (!existing) {
          codeMap.set(course.code, {
            ...course,
            sections: [...sections],
            assignments: [...courseAssignments],
          });
        } else {
          // Merge sections avoiding duplicates
          const seenIds = new Set(existing.sections.map((s) => s.id));
          for (const s of sections) {
            if (!seenIds.has(s.id)) {
              existing.sections.push(s);
              seenIds.add(s.id);
            }
          }
          // Merge assignments
          const seenAsn = new Set(existing.assignments.map((a) => a.id));
          for (const a of courseAssignments) {
            if (!seenAsn.has(a.id)) {
              existing.assignments.push(a);
              seenAsn.add(a.id);
            }
          }
        }
      }

      return Array.from(codeMap.values());
    }

    // Specific semester filtered: ONLY display courses belonging to this semester and academic year!
    const [semStr, yrStr] = selectedSemesterKey.split('_');
    const sem = Number(semStr);
    const yr = Number(yrStr);

    const semesterCourses = courses.filter((c) => {
      const cSem = c.semester ?? 1;
      const cYr = c.year_ce ?? 2026;
      return cSem === sem && cYr === yr;
    });

    return semesterCourses.map((course) => {
      const sections = filteredClassrooms.filter(
        (cls) => cls.course_id === course.id || cls.subject_code?.startsWith(course.code)
      );
      const courseAssignments = assignments.filter(
        (as) => as.course_id === course.id || sections.some((s) => s.id === as.classroom_id)
      );
      return {
        ...course,
        sections,
        assignments: courseAssignments,
      };
    });
  }, [courses, classrooms, filteredClassrooms, assignments, selectedSemesterKey]);

  // Filter assignments & submissions based on filtered classrooms (for selected semester/year)
  const filteredClassroomIds = useMemo(
    () => new Set(filteredClassrooms.map((c) => c.id)),
    [filteredClassrooms]
  );

  const filteredAssignments = useMemo(() => {
    if (selectedSemesterKey === 'all') return assignments;
    return assignments.filter((a) => filteredClassroomIds.has(a.classroom_id));
  }, [assignments, filteredClassroomIds, selectedSemesterKey]);

  const filteredAssignmentIds = useMemo(
    () => new Set(filteredAssignments.map((a) => a.id)),
    [filteredAssignments]
  );

  const filteredSubmissions = useMemo(() => {
    if (selectedSemesterKey === 'all') return allSubmissions;
    return allSubmissions.filter((s) => filteredAssignmentIds.has(s.assignment_id));
  }, [allSubmissions, filteredAssignmentIds, selectedSemesterKey]);

  const totalStudents = useMemo(() => {
    return filteredClassrooms.reduce(
      (acc, c) => acc + (c.students ? c.students.length : (c.student_count || 0)),
      0
    );
  }, [filteredClassrooms]);

  const pendingAdmissionCount = useMemo(
    () => filteredClassrooms.reduce((acc, c) => acc + (c.pending_students?.length || 0), 0),
    [filteredClassrooms]
  );

  // Classrooms page search: a course matching by code/name keeps all its
  // sections; otherwise only the sections that match are shown.
  const visibleCourses = useMemo(() => {
    const q = classroomQuery.trim().toLowerCase();
    if (view !== 'classrooms' || !q) return groupedCourses;
    const has = (...fields: Array<string | null | undefined>) => fields.some((f) => f?.toLowerCase().includes(q));
    return groupedCourses
      .map((course) =>
        has(course.code, course.name) ? course : { ...course, sections: course.sections.filter((cls) => has(cls.name, cls.subject_code, cls.course_name, cls.invite_code)) }
      )
      .filter((course) => has(course.code, course.name) || course.sections.length > 0);
  }, [groupedCourses, classroomQuery, view]);

  const pendingGradingCount = useMemo(() => {
    return filteredSubmissions.filter(needsGrading).length;
  }, [filteredSubmissions]);

  // Per assignment: handed in, and how many of those still wait for a grade.
  const gradingByAssignment = useMemo(() => {
    const bySubmission = new Map<string, Submission[]>();
    for (const s of filteredSubmissions) bySubmission.set(s.assignment_id, [...(bySubmission.get(s.assignment_id) || []), s]);
    const rosterSize = new Map(classrooms.map((c) => [c.id, c.students?.length || c.student_count || 0]));
    return new Map(
      assignments.map((a) => [a.id, gradingCounts(bySubmission.get(a.id) || [], rosterSize.get(a.classroom_id) || 0, a.is_exam)])
    );
  }, [filteredSubmissions, assignments, classrooms]);
  // Course cards: the "still to grade" group starts open; the teacher can fold it per course.
  const [foldedToGradeCourses, setFoldedToGradeCourses] = useState<Record<string, boolean>>({});
  const assignmentsToGradeCount = useMemo(
    () => [...gradingByAssignment.values()].filter((g) => g.pending > 0).length,
    [gradingByAssignment]
  );

  // Leaving the screen is tracked during quizzes only.
  const suspiciousAlertCount = useMemo(() => {
    const examIds = new Set(filteredAssignments.filter((a) => a.is_exam).map((a) => a.id));
    return filteredSubmissions.filter((s) => isIntegrityFlagged(s, examIds.has(s.assignment_id))).length;
  }, [filteredSubmissions, filteredAssignments]);

  // Course Creation & Deletion Handlers
  const handleOpenCreateCourseModal = () => {
    setCourseCodeInput('');
    setCourseNameInput('');
    setCourseDescInput('');
    setCourseSemesterInput(defaultPeriod.semester);
    setCourseYearInput(defaultPeriod.yearCE);
    setCourseIndicatorsDraft([]);
    setCourseLessonPlanDraft([]);
    setCourseCreationMode('indicator');
    setCourseCreationStep(1);
    setIsCourseCloneFlow(false);
    setIsCourseModalOpen(true);
  };

  const handleCloneCourseToOtherSemester = (course: Course) => {
    setCourseCodeInput(course.code);
    setCourseNameInput(course.name);
    setCourseDescInput(course.description || '');
    // Next semester recommendation: if 1 -> 2, if 2 -> 3, if 3 -> 1 (next year)
    const nextSem = course.semester === 1 ? 2 : course.semester === 2 ? 3 : 1;
    const nextYr =
      course.semester === 3
        ? (course.year_ce || defaultPeriod.yearCE) + 1
        : course.year_ce || defaultPeriod.yearCE;
    setCourseSemesterInput(nextSem);
    setCourseYearInput(nextYr);
    setCourseIndicatorsDraft(course.indicators || []);
    setCourseLessonPlanDraft(course.lesson_plans || []);
    setCourseCreationMode(course.indicator_mode || 'indicator');
    setCourseCreationStep(1);
    setIsCourseCloneFlow(true);
    setIsCourseModalOpen(true);
  };

  const handleAddCourseFrameworkItem = () => {
    setCourseIndicatorsDraft((current) => [
      ...current,
      {
        id: `draft-${Date.now()}`,
        course_id: '',
        code: '',
        title: '',
        weight: 0,
        order_index: current.length + 1,
      },
    ]);
  };

  const handleUpdateCourseFrameworkItem = (index: number, field: 'title', value: string) => {
    setCourseIndicatorsDraft((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  };

  const handleRemoveCourseFrameworkItem = (index: number) => {
    setCourseIndicatorsDraft((current) => current
      .filter((_, itemIndex) => itemIndex !== index)
      .map((item, itemIndex) => ({ ...item, order_index: itemIndex + 1 })));
  };

  /** Validates step 1 (course details) and moves to step 2 (assessment framework). */
  const goToCourseFrameworkStep = () => {
    if (!courseCodeInput.trim() || !courseNameInput.trim()) {
      alert(language === 'th' ? 'กรุณากรอกรหัสและชื่อรายวิชา' : 'Please enter course code and name');
      return;
    }
    setCourseCreationStep(2);
  };

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    // Pressing Enter in a step-1 field submits the form: treat it as "Next".
    if (courseCreationStep === 1) {
      goToCourseFrameworkStep();
      return;
    }
    if (isSavingCourse) return;
    if (!courseCodeInput.trim() || !courseNameInput.trim()) return;

    const academicYearStr = formatAcademicPeriod(courseSemesterInput, courseYearInput, language);
    const currentTeacherId = clerkUser?.id;
    if (!currentTeacherId) return;
    const currentTeacherName = `${clerkUser?.firstName || ""} ${clerkUser?.lastName || ""}`.trim() || clerkUser?.username || "คุณครู";
    const currentTeacherEmail = clerkUser?.primaryEmailAddress?.emailAddress || undefined;
    const currentTeacherAvatar = clerkUser?.imageUrl || undefined;

    const frameworkProblem = getFrameworkProblem(courseCreationMode, courseIndicatorsDraft, courseLessonPlanDraft, language);
    if (frameworkProblem) {
      alert(frameworkProblem);
      return;
    }

    const initialIndicators: CourseLearningIndicator[] = courseIndicatorsDraft.map((ind, i) => ({
      ...ind,
      id: `ind-${Date.now()}-${i + 1}`,
      course_id: '',
      code: `ข้อ ${i + 1}`,
      order_index: i + 1,
    }));
    const indicatorIdMap = new Map(courseIndicatorsDraft.map((indicator, index) => [indicator.id, initialIndicators[index].id]));

    setIsSavingCourse(true);
    try {
    await dataService.createCourse({
      code: courseCodeInput.trim().toUpperCase(),
      name: courseNameInput.trim(),
      description: courseDescInput.trim(),
      semester: courseSemesterInput,
      year_ce: courseYearInput,
      academic_year: academicYearStr,
      primary_teacher_id: currentTeacherId,
      indicator_mode: courseCreationMode,
      teachers: [
        {
          teacher_id: currentTeacherId,
          name: `${currentTeacherName} (Primary Owner)`,
          email: currentTeacherEmail,
          avatar_url: currentTeacherAvatar,
          role: 'primary',
        },
      ],
      indicators: initialIndicators,
      lesson_plans: courseCreationMode === 'competency'
        ? courseLessonPlanDraft.map((plan, index) => ({
            ...plan,
            id: `plan-${Date.now()}-${index + 1}`,
            order_index: index + 1,
            mapped_indicator_ids: (plan.mapped_indicator_ids || [])
              .map((indicatorId) => indicatorIdMap.get(indicatorId))
              .filter((indicatorId): indicatorId is string => Boolean(indicatorId)),
          }))
        : [],
      classroom_ids: [],
    });

    showToast(language === 'th' ? `สร้างรายวิชา ${courseCodeInput.trim()} สำเร็จ` : `Course ${courseCodeInput.trim()} created`);
    setIsCourseModalOpen(false);
    setCourseIndicatorsDraft([]);
    setCourseLessonPlanDraft([]);
    setIsCourseCloneFlow(false);
    await loadAllData();
    } catch (error) {
      console.error('Create course failed:', error);
      alert(error instanceof Error ? error.message : (language === 'th' ? 'สร้างรายวิชาไม่สำเร็จ' : 'Could not create the course'));
    } finally {
      setIsSavingCourse(false);
    }
  };

  const handleDeleteCourse = async (course: Course) => {
    const confirmMsg = language === 'th'
      ? `คุณต้องการลบรายวิชา "${course.code} ${course.name}" ใช่หรือไม่?\n(ข้อมูลห้องเรียนและการบ้านที่สังกัดวิชานี้ทั้งหมดจะถูกลบด้วย)`
      : `Are you sure you want to delete course "${course.code} ${course.name}"?`;
    if (confirm(confirmMsg)) {
      await dataService.deleteCourse(course.id);
      showToast(language === 'th' ? `ลบรายวิชา ${course.code} เรียบร้อยแล้ว` : `Course ${course.code} deleted`);
      await loadAllData();
    }
  };

  // Open Create Classroom Modal
  const handleOpenCreateClassModal = (targetCourse?: Course | string) => {
    setEditingClassroom(null);
    setClassNameInput('');

    if (targetCourse) {
      // Opened from Course Card: pre-fill with that course and that course's semester
      const courseObj = typeof targetCourse === 'string'
        ? courses.find((c) => c.id === targetCourse)
        : targetCourse;
      setSelectedCourseForClass(courseObj?.id || '');
      setSubjectCodeInput(courseObj ? `${courseObj.code} ${courseObj.name}` : '');
      setFormSemester(courseObj?.semester || defaultPeriod.semester);
      setFormYearCE(courseObj?.year_ce || defaultPeriod.yearCE);
    } else {
      // Opened from top group: unselected by default, system requires teacher to choose
      setSelectedCourseForClass('');
      setSubjectCodeInput('');
      setFormSemester(defaultPeriod.semester);
      setFormYearCE(defaultPeriod.yearCE);
    }

    setIsClassModalOpen(true);
  };

  // Open Edit Classroom Modal
  const handleOpenEditClassModal = (cls: Classroom) => {
    setEditingClassroom(cls);
    setSelectedCourseForClass(cls.course_id || courses[0]?.id || '');
    setClassNameInput(cls.name);
    setSubjectCodeInput(cls.subject_code || '');
    setFormSemester(cls.semester || defaultPeriod.semester);
    setFormYearCE(cls.year_ce || defaultPeriod.yearCE);
    setIsClassModalOpen(true);
  };

  // Save Classroom (Create or Edit)
  const handleSaveClassroom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCourseForClass) {
      alert(language === 'th' ? 'กรุณาเลือกรายวิชาสำหรับห้องเรียนนี้ก่อนบันทึก' : 'Please select a course for this classroom');
      return;
    }
    if (!classNameInput.trim()) return;

    const academicYearStr = formatAcademicPeriod(formSemester, formYearCE, language);
    const parentCourse = courses.find((c) => c.id === selectedCourseForClass);

    if (editingClassroom) {
      await dataService.updateClassroom(editingClassroom.id, {
        course_id: selectedCourseForClass,
        course_name: parentCourse?.name,
        name: classNameInput.trim(),
        subject_code: subjectCodeInput.trim() || `${parentCourse?.code} ${parentCourse?.name}`,
        semester: formSemester,
        year_ce: formYearCE,
        academic_year: academicYearStr,
      });
      showToast(language === 'th' ? 'แก้ไขห้องเรียนเรียบร้อย' : 'Classroom updated');
    } else {
      const currentTeacherId = clerkUser?.id;
    if (!currentTeacherId) return;
      const currentTeacherName = `${clerkUser?.firstName || ""} ${clerkUser?.lastName || ""}`.trim() || clerkUser?.username || "คุณครู";
      await dataService.createClassroom({
        course_id: selectedCourseForClass,
        course_name: parentCourse?.name,
        teacher_id: currentTeacherId,
        teachers: parentCourse?.teachers?.length ? parentCourse.teachers : [
          {
            teacher_id: currentTeacherId,
            name: currentTeacherName,
            email: clerkUser?.primaryEmailAddress?.emailAddress || undefined,
            role: "primary",
          }
        ],
        name: classNameInput.trim(),
        subject_code: subjectCodeInput.trim() || `${parentCourse?.code} ${parentCourse?.name}`,
        semester: formSemester,
        year_ce: formYearCE,
        academic_year: academicYearStr,
      });
      showToast(language === 'th' ? 'สร้างห้องเรียนใหม่สำเร็จ' : 'New classroom created');
    }

    setIsClassModalOpen(false);
    await loadAllData();
  };

  // Delete Classroom
  const handleDeleteClassroom = async (cls: Classroom) => {
    if (confirm(t('classroom_mgmt.delete_confirm'))) {
      await dataService.deleteClassroom(cls.id);
      showToast(language === 'th' ? 'ลบห้องเรียนเรียบร้อย' : 'Classroom deleted');
      if (managingClassroom?.id === cls.id) {
        setManagingClassroom(null);
      }
      await loadAllData();
    }
  };

  const [editingStudent, setEditingStudent] = useState<User | null>(null);

  const handleStudentEdited = async (studentId: string, fields: Pick<User, 'first_name' | 'last_name' | 'student_id'>) => {
    setManagingClassroom((prev) =>
      prev ? { ...prev, students: (prev.students || []).map((s) => (s.id === studentId ? { ...s, ...fields } : s)) } : prev
    );
    setEditingStudent(null);
    showToast(language === 'th' ? 'แก้ไขข้อมูลนักเรียนแล้ว' : 'Student updated');
    await loadAllData();
  };

  const handleRemoveStudent = async (studentId: string) => {
    if (!managingClassroom) return;
    if (confirm(t('classroom_mgmt.remove_student_confirm'))) {
      await dataService.removeStudentFromClassroom(managingClassroom.id, studentId);
      showToast(language === 'th' ? 'นำนักเรียนออกจากห้องแล้ว' : 'Student removed');
      await loadAllData();
    }
  };

  // Admit student join request
  const handleAdmitStudent = async (studentId: string) => {
    if (!managingClassroom) return;
    try {
      await dataService.admitStudentToClassroom(managingClassroom.id, studentId);
      showToast(language === 'th' ? 'อนุมัตินักเรียนแล้ว' : 'Student admitted successfully');
      await loadAllData();
    } catch (err) {
      console.error(err);
      showToast(tr('เกิดข้อผิดพลาดในการอนุมัติ', 'Something went wrong while admitting'));
    }
  };

  // Reject student join request
  const handleRejectStudent = async (studentId: string) => {
    if (!managingClassroom) return;
    if (confirm(language === 'th' ? 'คุณต้องการปฏิเสธคำขอเข้าห้องเรียนนี้ใช่หรือไม่?' : 'Reject this join request?')) {
      try {
        await dataService.rejectStudentFromClassroom(managingClassroom.id, studentId);
        showToast(language === 'th' ? 'ปฏิเสธคำขอเข้าห้องเรียนแล้ว' : 'Student request rejected');
        await loadAllData();
      } catch (err) {
        console.error(err);
        showToast(tr('เกิดข้อผิดพลาดในการปฏิเสธคำขอ', 'Something went wrong while declining'));
      }
    }
  };

  // Quick search registered students from same school
  const handleSearchStudents = async (q: string) => {
    setStudentSearchQuery(q);
    if (!q.trim()) {
      setStudentSearchResults([]);
      return;
    }
    if (!teacherProfile?.institution) {
      setStudentSearchResults([]);
      return;
    }
    setIsSearchingStudents(true);
    try {
      const res = await dataService.searchStudentsByInstitution(q, teacherProfile?.institution);
      setStudentSearchResults(res);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearchingStudents(false);
    }
  };

  const handleSelectFoundStudent = async (std: User) => {
    if (!managingClassroom) return;
    const alreadyEnrolled = [...(managingClassroom.students || []), ...(managingClassroom.pending_students || [])]
      .some((student) => student.id === std.id || (student.student_id && std.student_id && student.student_id === std.student_id));
    if (alreadyEnrolled) {
      showToast(language === 'th' ? 'นักเรียนคนนี้อยู่ในห้องเรียนแล้ว' : 'This student is already in the classroom');
      return;
    }
    await dataService.addStudentToClassroom(
      managingClassroom.id,
      {
        id: std.id,
        first_name: std.first_name,
        last_name: std.last_name,
        student_id: std.student_id,
        email: std.email,
        avatar_url: std.avatar_url,
        institution: std.institution || teacherProfile?.institution,
      },
      { autoAdmit: true }
    );
    showToast(language === 'th' ? `เพิ่ม ${std.first_name} ${std.last_name} สำเร็จ` : 'Student added');
    setStudentSearchQuery('');
    setStudentSearchResults([]);
    await loadAllData();
  };

  // Teacher profile saving handler (name + institution)
  const handleOpenTeacherProfile = () => {
    const values = profileFormValues(teacherProfile, clerkUser);
    setTeacherFirstNameInput(values.firstName);
    setTeacherLastNameInput(values.lastName);
    setTeacherInstitutionInput(values.institution);
    setIsInstitutionModalOpen(true);
  };

  // The app-wide profile gate (or another tab of this page) saved the profile.
  useEffect(() => {
    const onUpdated = (event: Event) => {
      const saved = (event as CustomEvent<User>).detail;
      setTeacherProfile((prev) => ({ ...(prev || {}), ...saved }) as User);
    };
    window.addEventListener(TEACHER_PROFILE_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(TEACHER_PROFILE_UPDATED_EVENT, onUpdated);
  }, []);

  const handleSaveTeacherProfile = async () => {
    if (!clerkUser?.id) return;
    const fn = teacherFirstNameInput.trim();
    const ln = teacherLastNameInput.trim();
    const inst = canonicalInstitution(teacherInstitutionInput);
    if (!isTeacherProfileComplete({ first_name: fn, last_name: ln, institution: inst })) {
      alert(tr('กรุณากรอกชื่อ นามสกุล และสถานศึกษาให้ครบ', 'Please fill in first name, last name and institution'));
      return;
    }
    try {
      // The server saves the users row and mirrors it to Clerk (name + institution).
      const ok = await dataService.updateTeacherProfile(clerkUser.id, { first_name: fn, last_name: ln, institution: inst! });
      if (!ok) throw new Error('Profile incomplete');
      await clerkUser.reload().catch(() => undefined);
      const saved = { ...(teacherProfile || { id: clerkUser.id, role: 'teacher' }), first_name: fn, last_name: ln, institution: inst } as User;
      setTeacherProfile(saved);
      announceTeacherProfile(saved);
      showToast(language === 'th' ? 'บันทึกแล้ว' : 'Profile updated successfully');
      setIsInstitutionModalOpen(false);
    } catch (e) {
      console.error(e);
      showToast(language === 'th' ? 'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง' : 'Save failed, please try again');
    }
  };

  // Teachers sign in with LINE, so the server links their LINE account
  // automatically; this only reads (and refreshes) that status.
  const loadTeacherLineLink = async () => {
    try {
      const response = await fetch('/api/line/teacher-link', { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      // Never leave the card on "checking" when the request fails.
      setTeacherLineLink(response.ok ? result : { status: 'error' });
    } catch (error) {
      console.error('Failed to load teacher LINE link status:', error);
      setTeacherLineLink({ status: 'error' });
    }
  };

  // Checked on sign-in and when the profile window opens; while it is open, also
  // when the teacher comes back to this tab (e.g. after adding Pudding Bot in LINE).
  useEffect(() => {
    if (!clerkUser?.id) return;
    // The state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTeacherLineLink();
    if (!isInstitutionModalOpen) return;
    const onFocus = () => loadTeacherLineLink();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [clerkUser?.id, isInstitutionModalOpen]);

  const getRealLiffUrl = (cls: Classroom) => {
    const liffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID || '2011818142-BznwnWyj';
    return `https://liff.line.me/${liffId}?code=${cls.invite_code || ''}`;
  };

  const getWebInviteUrl = (cls: Classroom) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/liff?code=${cls.invite_code || ''}`;
  };

  const handleCopyLiff = (cls: Classroom) => {
    navigator.clipboard.writeText(getRealLiffUrl(cls));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Open Learning Indicators Modal
  const handleOpenIndicatorsModal = async (course: Course) => {
    setEditingCourseIndicators(course);
    setCourseDetailsDraft({ code: course.code || '', name: course.name || '', description: course.description || '' });
    setIndicatorListDraft(course.indicators || []);
    setIndicatorMode(course.indicator_mode || 'indicator');
    setLessonPlanDraft(course.lesson_plans || []);
    setIsSavedLibraryOpen(false);
    setIsIndicatorsModalOpen(true);
    const saved = await dataService.getSavedTeacherIndicators(clerkUser?.id);
    setSavedTeacherIndicators(saved);
  };

  // Indicator reordering & item management
  const handleMoveIndicator = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= indicatorListDraft.length) return;

    const copy = [...indicatorListDraft];
    const temp = copy[index];
    copy[index] = copy[targetIndex];
    copy[targetIndex] = temp;

    const reordered = copy.map((ind, i) => ({ ...ind, order_index: i + 1 }));
    setIndicatorListDraft(reordered);
  };

  const handleAddIndicatorDraft = () => {
    const nextNum = indicatorListDraft.length + 1;
    const newInd: CourseLearningIndicator = {
      id: `ind-${Date.now()}`,
      course_id: editingCourseIndicators?.id,
      code: '', // Blank by default, no mock sentence!
      title: '', // Blank by default, no mock sentence!
      weight: 0,
      order_index: nextNum,
    };
    setIndicatorListDraft([...indicatorListDraft, newInd]);
  };

  const handleAddFromSavedLibrary = (savedInd: CourseLearningIndicator) => {
    const nextNum = indicatorListDraft.length + 1;
    const newInd: CourseLearningIndicator = {
      id: draftIndicatorId(nextNum),
      course_id: editingCourseIndicators?.id,
      code: savedInd.code || '',
      title: savedInd.title,
      weight: 0,
      order_index: nextNum,
    };
    setIndicatorListDraft([...indicatorListDraft, newInd]);
    showToast(language === 'th' ? 'เพิ่มตัวชี้วัดจากคลังสำเร็จ' : 'Added indicator from library');
  };

  const handleDeleteIndicatorDraft = (index: number) => {
    setIndicatorListDraft(indicatorListDraft.filter((_, i) => i !== index));
  };

  const handleSaveIndicators = async () => {
    if (!editingCourseIndicators || isSavingIndicators) return;
    const code = courseDetailsDraft.code.trim().toUpperCase();
    const name = courseDetailsDraft.name.trim();
    if (!code || !name) {
      alert(language === 'th' ? 'กรุณากรอกรหัสและชื่อรายวิชา' : 'Please enter course code and name');
      return;
    }
    const frameworkProblem = getFrameworkProblem(indicatorMode, indicatorListDraft, lessonPlanDraft, language);
    if (frameworkProblem) {
      alert(frameworkProblem);
      return;
    }
    setIsSavingIndicators(true);
    try {
      // Details, mode, items and lesson plans are saved in one update so they cannot drift apart.
      await dataService.updateCourse(editingCourseIndicators.id, {
        // Only send a changed code/name: a rename relabels every section of the course.
        ...(code !== editingCourseIndicators.code ? { code } : {}),
        ...(name !== editingCourseIndicators.name ? { name } : {}),
        description: courseDetailsDraft.description.trim(),
        indicator_mode: indicatorMode,
        indicators: indicatorListDraft,
        // A course uses exactly one assessment framework at a time.
        lesson_plans: indicatorMode === 'competency' ? lessonPlanDraft : [],
      });
      showToast(
        language === 'th' ? 'บันทึกข้อมูลรายวิชาแล้ว' : 'Course saved successfully'
      );
      setIsIndicatorsModalOpen(false);
      await loadAllData();
    } catch (error) {
      console.error('Save course framework failed:', error);
      alert(error instanceof Error ? error.message : (language === 'th' ? 'บันทึกไม่สำเร็จ' : 'Could not save'));
    } finally {
      setIsSavingIndicators(false);
    }
  };

  // Co-Teachers Setup (TA vs Research Grader)
  const handleOpenCoTeachersModal = (course: Course) => {
    setEditingCourseCoTeachers(course);
    setCoTeachersDraft(course.teachers || []);
    setNewCoTeacherRole('assistant');
    setCoTeacherInviteStep(1);
    setIsCoTeachingArchitectureOpen(false);
    setTeacherSearchQuery('');
    setTeacherSearchResults([]);
    setIsCopiedTeacherLink(false);
    setIsCoTeachersModalOpen(true);
  };

  const handleSearchTeachers = async (q: string) => {
    setTeacherSearchQuery(q);
    if (!q.trim()) {
      setTeacherSearchResults([]);
      return;
    }
    setIsSearchingTeachers(true);
    try {
      const instFilter = newCoTeacherRole === 'assistant' ? teacherProfile?.institution : undefined;
      const res = await dataService.searchTeachers(q, instFilter);
      setTeacherSearchResults(res);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSearchingTeachers(false);
    }
  };

  const handleSelectFoundTeacher = (tchr: User) => {
    const fullName = `${tchr.first_name || ''} ${tchr.last_name || ''}`.trim() || tchr.name || tr('ครูผู้สอน', 'Teacher');
    const newTeacher: ClassroomTeacher = {
      teacher_id: tchr.id,
      name: fullName,
      email: tchr.email || undefined,
      avatar_url: tchr.avatar_url,
      role: newCoTeacherRole,
      institution: tchr.institution,
    };
    if (coTeachersDraft.some((t) => t.teacher_id === newTeacher.teacher_id)) {
      alert(language === 'th' ? 'ครูท่านนี้อยู่ในรายวิชาแล้ว' : 'Teacher is already added');
      return;
    }
    setCoTeachersDraft([...coTeachersDraft, newTeacher]);
    setTeacherSearchQuery('');
    setTeacherSearchResults([]);
  };

  const handleRemoveCoTeacher = (teacherId: string) => {
    const target = coTeachersDraft.find((t) => t.teacher_id === teacherId);
    if (target?.role === 'primary') {
      alert(language === 'th' ? 'ไม่สามารถลบครูผู้สอนหลักได้' : 'Cannot remove primary owner teacher');
      return;
    }
    setCoTeachersDraft(coTeachersDraft.filter((t) => t.teacher_id !== teacherId));
  };

  const handleSaveCoTeachers = async () => {
    if (!editingCourseCoTeachers) return;
    try {
      await dataService.updateCourse(editingCourseCoTeachers.id, {
        teachers: coTeachersDraft,
      });
      showToast(language === 'th' ? 'บันทึกครูร่วมสอนเรียบร้อย' : 'Co-teaching configuration updated');
      setIsCoTeachersModalOpen(false);
      await loadAllData();
    } catch (error) {
      console.error('Save co-teachers failed:', error);
      alert(error instanceof Error ? error.message : (language === 'th' ? 'บันทึกไม่สำเร็จ' : 'Could not save'));
    }
  };

  // Co-teacher invite link: a short signed code from the server (/teacher-invite?code=…).
  const [teacherInviteCodes, setTeacherInviteCodes] = useState<Record<string, string>>({});
  const inviteCourseId = isCoTeachersModalOpen ? editingCourseCoTeachers?.id : undefined;
  useEffect(() => {
    if (!inviteCourseId) return;
    const key = `${inviteCourseId}:${newCoTeacherRole}`;
    if (teacherInviteCodes[key]) return;
    dataService
      .getTeacherInviteCode(inviteCourseId, newCoTeacherRole)
      .then((code) => setTeacherInviteCodes((prev) => ({ ...prev, [key]: code })))
      .catch((error) => console.warn('Invite code unavailable:', error));
  }, [inviteCourseId, newCoTeacherRole, teacherInviteCodes]);
  const teacherInviteUrl = (courseId: string | undefined, role: 'assistant' | 'researcher') => {
    const code = courseId ? teacherInviteCodes[`${courseId}:${role}`] : undefined;
    if (!code) return '';
    return `${typeof window !== 'undefined' ? window.location.origin : ''}/teacher-invite?code=${code}`;
  };

  const handleCopyTeacherInviteLink = async (course: Course, role: 'assistant' | 'researcher' = 'assistant') => {
    let url = teacherInviteUrl(course.id, role);
    if (!url) {
      try {
        const code = await dataService.getTeacherInviteCode(course.id, role);
        setTeacherInviteCodes((prev) => ({ ...prev, [`${course.id}:${role}`]: code }));
        url = `${window.location.origin}/teacher-invite?code=${code}`;
      } catch (error) {
        alert(error instanceof Error ? error.message : tr('สร้างลิงก์เชิญไม่สำเร็จ', 'Could not create the invite link'));
        return;
      }
    }
    navigator.clipboard.writeText(url);
    setIsCopiedTeacherLink(true);
    setTimeout(() => setIsCopiedTeacherLink(false), 2500);
  };

  const yearOptions = getAcademicYearOptions(defaultPeriod.yearCE);

  return (
    <div className="space-y-6 sm:space-y-8 pb-20">
      {/* Toast Notice */}
      {toastMessage && (
        <div className="fixed bottom-[max(env(safe-area-inset-bottom),1rem)] inset-x-4 sm:inset-x-auto sm:right-6 sm:bottom-6 z-60 p-4 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold shadow-2xl flex items-center gap-2.5 text-sm animate-in fade-in slide-in-from-bottom-5">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {view === 'dashboard' && (
        <>
      {/* Hero Welcome Banner with High-Visibility Primary CTAs */}
      <div className="relative overflow-hidden bg-linear-to-br from-amber-400 via-orange-400 to-amber-500 rounded-3xl p-5 sm:p-8 text-slate-950 shadow-xl shadow-amber-500/15 flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 w-72 h-72 rounded-full bg-white/20 blur-3xl" />
        <div className="relative space-y-2 min-w-0 xl:max-w-xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/10 backdrop-blur-xs text-xs font-bold text-slate-900">
            <span className="text-sm">🍮</span>
            <span>Pudding Learning Intelligence</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-950 break-words">
            {t('dashboard.welcome')}, <br className="md:hidden" />{clerkUser?.fullName || clerkUser?.firstName || (loading ? tr('กำลังโหลด...', 'Loading...') : '')}
          </h1>
          <p className="text-slate-900/90 text-sm max-w-xl font-medium">
            <MobileText short={language === 'th' ? 'ภาพรวมห้องเรียนและงานที่ต้องตรวจ' : 'Your classes and grading at a glance'} full={t('dashboard.overview_subtitle')} />
          </p>
          <div className="flex items-center gap-2 pt-1 min-w-0">
            <button
              type="button"
              onClick={handleOpenTeacherProfile}
              className="inline-flex items-center gap-1.5 max-w-full px-3 py-1.5 rounded-xl bg-black/10 hover:bg-black/20 text-slate-950 font-bold text-xs backdrop-blur-xs transition-colors cursor-pointer border border-black/10"
              title={tr('คลิกเพื่อเลือกหรือแก้ไขสถานศึกษา', 'Click to choose or edit your institution')}
            >
              <Building2 className="w-3.5 h-3.5" />
              <span className="truncate">{institutionLabel(teacherProfile?.institution, language) || (language === 'th' ? '+ ระบุสถานศึกษา' : '+ Specify School')}</span>
              <Edit2 className="w-3 h-3 opacity-70 ml-0.5" />
            </button>
          </div>
        </div>

        {/* PRIMARY CTA PROMPTS: Add Course, Add Classroom & Create Assignment/Exam */}
        <div className="relative grid grid-cols-3 xl:flex xl:flex-wrap gap-2 sm:gap-3 shrink-0">
          {/* 1. Add Course CTA */}
          <button
            type="button"
            onClick={handleOpenCreateCourseModal}
            className="px-2 py-3 sm:px-3 rounded-2xl bg-white/90 hover:bg-white text-slate-950 font-bold text-xs leading-tight sm:text-sm sm:leading-normal text-center sm:text-left shadow-lg shadow-orange-900/10 hover:shadow-xl transition-all hover:-translate-y-0.5 active:scale-[0.98] flex flex-col sm:flex-row items-center gap-2 sm:gap-3 cursor-pointer ring-1 ring-white/60"
          >
            <div className="w-10 h-10 shrink-0 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black shadow-md shadow-amber-500/30 group-hover:rotate-6 transition-transform">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <span>
                {t('courses.create_course_modal_title') || tr('+ เพิ่มรายวิชาใหม่', '+ New course')}
              </span>

            </div>
          </button>

          {/* 2. Add Classroom / Section CTA */}
          <button
            type="button"
            onClick={() => handleOpenCreateClassModal()}
            className="px-2 py-3 sm:px-3 rounded-2xl bg-white/90 hover:bg-white text-slate-950 font-bold text-xs leading-tight sm:text-sm sm:leading-normal text-center sm:text-left shadow-lg shadow-orange-900/10 hover:shadow-xl transition-all hover:-translate-y-0.5 active:scale-[0.98] flex flex-col sm:flex-row items-center gap-2 sm:gap-3 cursor-pointer ring-1 ring-white/60"
          >
            <div className="w-10 h-10 shrink-0 rounded-xl bg-orange-500 text-white flex items-center justify-center font-black shadow-md shadow-orange-500/30 group-hover:rotate-6 transition-transform">
              <School className="w-5 h-5" />
            </div>
            <div>
              <span>
                {t('dashboard.quick_actions.add_classroom')}
              </span>
            </div>
          </button>

          {/* 3. Create Assignment / Exam CTA */}
          <Link
            href="/assignments/new?from=dashboard"
            className="px-2 py-3 sm:px-3 rounded-2xl bg-white/90 hover:bg-white text-slate-950 font-bold text-xs leading-tight sm:text-sm sm:leading-normal text-center sm:text-left shadow-lg shadow-orange-900/10 hover:shadow-xl transition-all hover:-translate-y-0.5 active:scale-[0.98] flex flex-col sm:flex-row items-center gap-2 sm:gap-3 cursor-pointer ring-1 ring-white/60"
          >
            <div className="w-10 h-10 shrink-0 rounded-xl bg-linear-to-tr from-amber-500 to-yellow-400 text-slate-950 flex items-center justify-center font-black shadow-md shadow-amber-500/40 group-hover:scale-110 transition-transform">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <span>
                {t('dashboard.quick_actions.create_assignment')}
              </span>
            </div>
          </Link>
        </div>
      </div>

      {/* Top Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        
        {/* Classrooms count -> every classroom of the selected term */}
        <Link
          href={`/classrooms?term=${encodeURIComponent(selectedSemesterKey)}`}
          className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-amber-400 dark:hover:border-amber-500 transition-all block group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-snug">
              {t('dashboard.stats.active_classrooms')}
            </span>
            <div className="w-9 h-9 rounded-xl shrink-0 bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <School className="w-5 h-5" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900 dark:text-white mt-3">
            {filteredClassrooms.length}
          </p>
          <span className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold mt-1 flex items-center gap-1">
            <span className="truncate">
              {selectedSemesterKey === 'all'
                ? (language === 'th' ? 'ทุกภาคเรียน' : 'All Semesters')
                : formatAcademicPeriod(Number(selectedSemesterKey.split('_')[0]), Number(selectedSemesterKey.split('_')[1]), language)}
            </span>
            <ArrowRight className="w-3 h-3 shrink-0" />
          </span>
        </Link>

        {/* Total Students -> every student of the selected term, editable */}
        <Link
          href={`/students?term=${encodeURIComponent(selectedSemesterKey)}`}
          className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-emerald-400 dark:hover:border-emerald-500 transition-all block group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-snug">
              {t('dashboard.stats.total_students')}
            </span>
            <div className="w-9 h-9 rounded-xl shrink-0 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <p className="text-3xl font-black text-slate-900 dark:text-white mt-3">
            {totalStudents}
          </p>
          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1 flex items-center gap-1">
            <span className="truncate"><MobileText short={language === 'th' ? 'ดู / แก้ไข' : 'View & edit'} full={language === 'th' ? 'ดูและแก้ไขข้อมูลนักเรียน' : 'View & edit students'} /></span>
            <ArrowRight className="w-3 h-3 shrink-0" />
          </span>
        </Link>

        {/* Pending to Grade */}
        <Link
          href="/grading"
          className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-blue-400 dark:hover:border-blue-500 transition-all block group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-snug">
              {t('dashboard.stats.pending_grading')}
            </span>
            <div className="w-9 h-9 rounded-xl shrink-0 bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <FileCheck className="w-5 h-5" />
            </div>
          </div>
          <p className={`text-3xl font-black mt-3 ${pendingGradingCount > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-900 dark:text-white'}`}>
            {pendingGradingCount}
          </p>
          {pendingGradingCount > 0 ? (
            <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold mt-1 flex items-center gap-1">
              <span className="truncate">
                {language === 'th' ? `ใน ${assignmentsToGradeCount} งาน · ไปตรวจ` : `in ${assignmentsToGradeCount} tasks · grade now`}
              </span>
              <ArrowRight className="w-3 h-3 shrink-0" />
            </span>
          ) : (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 shrink-0" />
              <span className="truncate">{language === 'th' ? 'ตรวจครบทุกงานแล้ว' : 'All work graded'}</span>
            </span>
          )}
        </Link>

        {/* Anti-Cheating Alerts */}
        <Link
          href="/grading"
          className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-rose-200 dark:border-rose-900/50 shadow-xs hover:border-rose-400 transition-all block group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
              {t('dashboard.stats.flagged_suspicious')}
            </span>
            <div className="w-9 h-9 rounded-xl shrink-0 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <ShieldAlert className="w-5 h-5 animate-pulse" />
            </div>
          </div>
          <p className="text-3xl font-black text-rose-600 dark:text-rose-400 mt-3">
            {suspiciousAlertCount}
          </p>
          <span className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold mt-1 flex items-center gap-1">
            <span className="truncate"><MobileText short={language === 'th' ? 'ดูรายงาน' : 'View report'} full={language === 'th' ? 'ตรวจดูรายงานความเสี่ยง' : 'View Risk Audit'} /></span>
            <ArrowRight className="w-3 h-3" />
          </span>
        </Link>
      </div>
        </>
      )}

      {view === 'classrooms' && (
        <div className="space-y-4">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {language === 'th' ? 'กลับแดชบอร์ด' : 'Back to dashboard'}
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                <School className="w-6 h-6 text-amber-500 shrink-0" />
                {language === 'th' ? 'ห้องเรียนที่สอน' : 'My classrooms'}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {selectedSemesterKey === 'all'
                  ? (language === 'th' ? 'ทุกภาคเรียน' : 'All semesters')
                  : formatAcademicPeriod(Number(selectedSemesterKey.split('_')[0]), Number(selectedSemesterKey.split('_')[1]), language)}
                {' · '}{filteredClassrooms.length} {language === 'th' ? 'ห้อง' : 'classrooms'}
                {' · '}{totalStudents} {language === 'th' ? 'นักเรียน' : 'students'}
                {pendingAdmissionCount > 0 && (
                  <span className="text-amber-700 dark:text-amber-300 font-bold">
                    {' · '}{language === 'th' ? `รออนุมัติ ${pendingAdmissionCount} คน` : `${pendingAdmissionCount} awaiting approval`}
                  </span>
                )}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={handleOpenCreateCourseModal}
                className="h-10 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-amber-400 text-slate-800 dark:text-slate-200 font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
              >
                <BookOpen className="w-4 h-4 text-amber-500" />
                {language === 'th' ? 'สร้างรายวิชา' : 'New course'}
              </button>
              <button
                type="button"
                onClick={() => handleOpenCreateClassModal()}
                className="h-10 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                {language === 'th' ? 'สร้างห้องเรียน' : 'New classroom'}
              </button>
            </div>
          </div>
          <label className="relative block">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={classroomQuery}
              onChange={(e) => setClassroomQuery(e.target.value)}
              placeholder={language === 'th' ? 'ค้นหาห้อง รหัส หรือชื่อวิชา' : 'Search room, subject code or course name'}
              className="w-full h-11 pl-9 pr-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
            />
          </label>
        </div>
      )}

      {/* COURSE-BASED GROUPING VIEW (Course -> Classroom/Section -> Assignment) */}
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-amber-500" />
              <span>{t('courses.title')}</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-mono text-xs font-bold">
                {courses.length} {t('common.course')}
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <MobileText short={language === 'th' ? 'ห้องเรียนและงานแยกตามรายวิชา' : 'Classrooms and work by course'} full={t('courses.subtitle')} />
            </p>
          </div>

          {/* Semester Selector */}
          <SemesterSelect
            value={selectedSemesterKey}
            onChange={changeSemester}
            options={availableSemesterOptions}
            currentPeriod={defaultPeriod}
          />
        </div>

        {/* Grouped Course Cards */}
        <div className="space-y-6">
          {visibleCourses.length === 0 && classroomQuery.trim() ? (
            <div className="text-center py-14 px-6 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 space-y-1">
              <p className="text-sm font-bold text-slate-900 dark:text-white">
                {language === 'th' ? 'ไม่พบห้องเรียนหรือรายวิชาที่ค้นหา' : 'No matching classrooms or courses'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {language === 'th' ? 'ลองคำค้นอื่น หรือเลือกภาคเรียนอื่น' : 'Try another search or semester.'}
              </p>
            </div>
          ) : visibleCourses.length === 0 ? (
            <div className="text-center py-16 px-6 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-amber-50 dark:bg-amber-950/60 text-amber-500 mx-auto flex items-center justify-center text-3xl shadow-xs">
                📚
              </div>
              <div className="space-y-1 max-w-sm mx-auto">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {language === "th" ? "ภาคเรียนนี้ยังไม่มีรายวิชา" : "No courses for this semester"}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {language === "th"
                    ? "สร้างรายวิชาใหม่ หรือคัดลอกจากภาคเรียนอื่น"
                    : "Create a new course or import from another semester to get started."}
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenCreateCourseModal}
                className="px-5 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs inline-flex items-center gap-2 shadow-sm transition-transform active:scale-95 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ {language === "th" ? "สร้างรายวิชาใหม่" : "Create Course"}</span>
              </button>
            </div>
          ) : (
            visibleCourses.map((course) => (
            <div
              key={course.id}
              className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs p-4 sm:p-6 space-y-5 sm:space-y-6 transition-all hover:border-slate-300 dark:hover:border-slate-700"
            >
              {/* Course Header */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
                {/* Icon is as tall as the code + name block, so the two read as one unit. */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-linear-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center shadow-sm shadow-amber-500/20 shrink-0">
                    <BookOpen className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex flex-col justify-center gap-0.5">
                    <span className="font-mono text-xs font-bold tracking-wide text-amber-700 dark:text-amber-400 leading-none">
                      {course.code}
                    </span>
                    <h3 className="text-lg sm:text-xl font-black leading-tight tracking-tight text-slate-900 dark:text-white break-words">
                      {course.name}
                    </h3>
                  </div>
                </div>

                {/* Course Control Actions: Rubrics, Co-Teachers, Clone to other term, Add Section & Delete Course */}
                <div className="grid grid-cols-6 gap-2 sm:flex sm:flex-wrap sm:items-center">
                  {/* Co-Teachers Avatars & Manager Button */}
                  <button
                    type="button"
                    onClick={() => handleOpenCoTeachersModal(course)}
                    className="col-span-2 min-w-0 h-10 px-2 sm:px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-[13px] font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer transition-colors"
                    title={t('courses.co_teachers')}
                  >
                    <div className="flex -space-x-1.5 overflow-hidden">
                      {course.teachers?.map((tchr, i) => (
                        <Avatar key={i} src={tchr.avatar_url} name={tchr.name} className="w-5 h-5 ring-1 ring-white dark:ring-slate-900 text-[10px]" />
                      ))}
                    </div>
                    <span className="whitespace-nowrap">{course.teachers?.length || 1}<span className="hidden sm:inline"> {language === 'th' ? 'ครูผู้สอน' : 'Teachers'}</span></span>
                  </button>

                  {/* Learning Indicators Settings - Only Course Owner */}
                  {(!course.primary_teacher_id || course.primary_teacher_id === clerkUser?.id) ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleOpenIndicatorsModal(course)}
                        className="col-span-2 min-w-0 h-10 px-2 sm:px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-[13px] font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer transition-colors"
                      >
                        <Sliders className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                        <span className="truncate sm:hidden">{language === 'th' ? 'ตัวชี้วัด' : 'Indicators'}</span>
                        <span className="hidden sm:inline">{t('dashboard.classrooms_section.course_settings_btn')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCloneCourseToOtherSemester(course)}
                        className="col-span-2 min-w-0 h-10 px-2 sm:px-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-[13px] font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5 sm:gap-2 cursor-pointer transition-colors"
                        title={language === 'th' ? 'คัดลอกวิชานี้ไปยังเทอมอื่น' : 'Add this course to another semester'}
                      >
                        <Copy className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                        <span className="truncate sm:hidden">{language === 'th' ? 'เทอมอื่น' : 'To Term'}</span>
                        <span className="hidden sm:inline">{language === 'th' ? 'เพิ่มไปเทอมอื่น' : 'Add to Term'}</span>
                      </button>
                    </>
                  ) : (
                    <span className="col-span-4 px-2.5 py-1 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold text-[11px] border border-blue-200/60 dark:border-blue-800/60 flex items-center justify-center sm:justify-start gap-1">
                      <GraduationCap className="w-3.5 h-3.5" />
                      <span>{language === 'th' ? 'ผู้ช่วยสอน (ตรวจงานได้)' : 'TA Access'}</span>
                    </span>
                  )}

                  {/* Add Classroom Section Under This Course - Only Course Owner */}
                  {(!course.primary_teacher_id || course.primary_teacher_id === clerkUser?.id) && (
                    <button
                      type="button"
                      onClick={() => handleOpenCreateClassModal(course)}
                      className="col-span-5 h-10 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-[13px] flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-xs"
                    >
                      <PlusCircle className="w-4 h-4" />
                      <span>+ {language === 'th' ? 'เพิ่มห้องเรียน' : 'Add Classroom'}</span>
                    </button>
                  )}

                  {/* Delete Course Button - Only Course Owner */}
                  {(!course.primary_teacher_id || course.primary_teacher_id === clerkUser?.id) && (
                    <button
                      type="button"
                      onClick={() => handleDeleteCourse(course)}
                      className="col-span-1 w-full sm:w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-700 hover:border-rose-200 dark:hover:border-rose-900 transition-colors cursor-pointer"
                      title={language === 'th' ? `ลบรายวิชา ${course.code}` : `Delete Course ${course.code}`}
                      aria-label={language === 'th' ? `ลบรายวิชา ${course.code}` : `Delete Course ${course.code}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Sub-sections Grid (Classrooms belonging to this Course) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <School className="w-4 h-4 text-amber-500" />
                    {language === 'th' ? 'ห้องเรียนในสังกัด' : 'Classrooms'}
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300 tabular-nums">{course.sections.length}</span>
                  </span>
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {course.assignments.length} {language === 'th' ? 'ชิ้นงาน/ข้อสอบ' : 'Tasks'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                  {course.sections.length === 0 ? (
                    <div className="col-span-full p-4 sm:p-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-xs text-slate-400">
                      {language === 'th' ? 'ยังไม่มีห้องเรียน กด "เพิ่มห้องเรียน" เพื่อเริ่ม' : 'No classroom enrolled under this course yet.'}
                    </div>
                  ) : (
                    course.sections.map((cls) => {
                      const count = cls.students ? cls.students.length : (cls.student_count || 0);

                      return (
                        <div
                          key={cls.id}
                          className="group relative p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 flex flex-col justify-between gap-4 min-w-0 hover:border-amber-400 dark:hover:border-amber-500 hover:shadow-lg hover:shadow-amber-500/10 transition-all"
                        >
                          <div className="space-y-3">
                            <div className="flex items-start justify-between gap-2">
                              <Link href={`/classrooms/${cls.id}`} className="min-w-0 flex-1 cursor-pointer">
                                <h4 className="text-lg font-black leading-snug text-slate-900 dark:text-white break-words group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                                  {cls.name}
                                </h4>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-md" title={language === 'th' ? 'รหัสเข้าห้องเรียน' : 'Invite code'}>
                                    {cls.invite_code || 'OMU'}
                                  </span>
                                  {selectedSemesterKey === 'all' && (
                                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-100/90 dark:bg-amber-950/80 text-amber-900 dark:text-amber-300">
                                      {cls.semester === 3 ? tr('ซัมเมอร์', 'Summer') : `${tr('เทอม', 'Term')} ${cls.semester || 1}`}
                                    </span>
                                  )}
                                </div>
                              </Link>
                              {/* Only Course/Classroom Owner Can Edit/Delete Section */}
                              {(!course.primary_teacher_id || course.primary_teacher_id === clerkUser?.id) ? (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditClassModal(cls)}
                                    className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                    title={t('common.edit')}
                                    aria-label={`${t('common.edit')} ${cls.name}`}
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteClassroom(cls)}
                                    className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                                    title={t('common.delete')}
                                    aria-label={`${t('common.delete')} ${cls.name}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <span className="shrink-0 text-xs font-bold px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                                  {course.teachers?.some((t) => t.teacher_id === clerkUser?.id && t.role === 'researcher')
                                    ? tr('🔬 โหมดวิจัย', '🔬 Research mode')
                                    : '👨‍🏫 TA'}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700/70 text-xs font-bold text-slate-700 dark:text-slate-200">
                                <Users className="w-3.5 h-3.5" />
                                <span className="tabular-nums">{count}</span> {t('common.student')}
                              </span>
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${lineConnectionStatuses[cls.id] === 'connected' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : lineConnectionStatuses[cls.id] === 'waiting' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'}`}>
                                <MessageCircle className="w-3.5 h-3.5" />
                                {lineConnectionStatuses[cls.id] === 'connected' ? tr('LINE เชื่อมแล้ว', 'LINE connected') : lineConnectionStatuses[cls.id] === 'waiting' ? tr('LINE รอยืนยัน', 'LINE pending') : tr('LINE ยังไม่เชื่อม', 'LINE not connected')}
                              </span>
                              {cls.pending_students && cls.pending_students.length > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenManagingClassroom(cls, 'pending');
                                  }}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500 text-white text-xs font-black animate-pulse cursor-pointer shadow-xs hover:bg-rose-600 transition-colors"
                                  title={tr('คลิกเพื่ออนุมัตินักเรียนเข้าห้องเรียน', 'Click to admit students')}
                                >
                                  <UserPlus className="w-3.5 h-3.5" />
                                  <span>{tr(`รออนุมัติ ${cls.pending_students.length} คน`, `${cls.pending_students.length} awaiting approval`)}</span>
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Link
                              href={`/classrooms/${cls.id}`}
                              className="w-full h-11 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-black flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                            >
                              <span>{t('dashboard.classrooms_section.view_class')}</span>
                              <ArrowRight className="w-4 h-4" />
                            </Link>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenManagingClassroom(cls, 'roster');
                                }}
                                className="h-10 px-2 rounded-xl text-[13px] font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:border-amber-300 flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                                title={tr('เพิ่ม / จัดการนักเรียนในห้องนี้', 'Add / manage students in this class')}
                              >
                                <UserPlus className="w-4 h-4 text-amber-500" />
                                <span className="truncate">{tr('เพิ่มนักเรียน', 'Add students')}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenLineConnectionPopup(cls)}
                                className={`h-10 px-2 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${lineConnectionStatuses[cls.id] === 'connected' ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-100 hover:bg-emerald-100 dark:bg-slate-700 dark:hover:bg-emerald-950/50 text-slate-700 dark:text-slate-200'}`}
                                title={tr('จัดการ LINE Group', 'Manage LINE group')}
                              >
                                <MessageCircle className="w-4 h-4" />
                                <span className="truncate">{lineConnectionStatuses[cls.id] === 'connected' ? 'LINE Group' : tr('เชื่อม LINE', 'Connect LINE')}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Course work the teacher still has to act on: published work not fully
                  graded (every roster student needs a score, handed in or not), then
                  drafts and scheduled work students cannot see yet. Finished work is not listed. */}
              {course.assignments.length > 0 && (() => {
                const countsOf = (asg: Assignment) => gradingByAssignment.get(asg.id) || gradingCounts([], 0, asg.is_exam);
                const unpublished = course.assignments
                  .filter((asg) => !isAssignmentPublished(asg))
                  // Scheduled first (soonest on top), then drafts.
                  .sort((a, b) => new Date(a.publish_at || 0).getTime() - new Date(b.publish_at || 0).getTime());
                const toGrade = course.assignments.filter((asg) => {
                  if (!isAssignmentPublished(asg)) return false;
                  const c = countsOf(asg);
                  return c.pending > 0 || c.notSubmitted > 0;
                });
                if (toGrade.length === 0 && unpublished.length === 0) return null;
                const pendingTotal = toGrade.reduce((sum, asg) => sum + countsOf(asg).pending, 0);
                const missingTotal = toGrade.reduce((sum, asg) => sum + countsOf(asg).notSubmitted, 0);
                const open = !foldedToGradeCourses[course.id];
                const row = (asg: Assignment) => {
                  const c = countsOf(asg);
                  const pending = c.pending > 0;
                  return (
                    <Link
                      key={asg.id}
                      href={`/assignments/${asg.id}/grading?from=dashboard`}
                      className={`group p-3 rounded-2xl bg-white dark:bg-slate-900 border flex flex-col gap-2 shadow-xs transition-colors ${
                        pending ? 'border-amber-300 dark:border-amber-800/70 hover:border-amber-500' : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                            asg.is_exam
                              ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}
                        >
                          {asg.is_exam ? t('assignment_creator.mode_exam') : t('assignment_creator.mode_assignment')}
                        </span>
                        <span className="text-[11px] text-slate-400 truncate">{asg.classroom_name}</span>
                        {c.flagged > 0 && (
                          <span className="ml-auto shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[10px] font-bold">
                            <ShieldAlert className="w-3 h-3" />
                            {c.flagged}
                          </span>
                        )}
                      </div>
                      <h5 className="font-bold text-xs text-slate-900 dark:text-white truncate">{asg.title}</h5>
                      <GradingBar graded={c.graded} pending={c.pending} notSubmitted={c.notSubmitted} />
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="min-w-0 truncate text-slate-500 dark:text-slate-400">
                          {language === 'th' ? `ส่งแล้ว ${c.handedIn}/${c.totalStudents} · ตรวจแล้ว ${c.graded}/${c.checkable}` : `${c.handedIn}/${c.totalStudents} in · ${c.graded}/${c.checkable} checked`}
                        </span>
                        <span
                          className={`shrink-0 inline-flex items-center gap-0.5 font-bold ${
                            pending ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200'
                          }`}
                        >
                          {pending
                            ? language === 'th' ? `ตรวจ ${c.pending} คน` : `Grade ${c.pending}`
                            : language === 'th' ? `ไม่ส่ง ${c.notSubmitted} คน` : `${c.notSubmitted} missing`}
                          <ArrowRight className="w-3 h-3" />
                        </span>
                      </div>
                    </Link>
                  );
                };
                const unpublishedRow = (asg: Assignment) => {
                  const draft = isAssignmentDraft(asg);
                  return (
                    <Link
                      key={asg.id}
                      href={`/assignments/${asg.id}/grading?from=dashboard`}
                      className="group p-3 rounded-2xl bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 flex flex-col gap-2 shadow-xs transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 ${ASSIGNMENT_STATUS_CLASSES[draft ? 'draft' : 'scheduled']}`}>
                          {draft ? (language === 'th' ? 'ฉบับร่าง' : 'Draft') : language === 'th' ? 'ตั้งเวลา' : 'Scheduled'}
                        </span>
                        <span className="text-[11px] text-slate-400 truncate">{asg.classroom_name}</span>
                      </div>
                      <h5 className="font-bold text-xs text-slate-900 dark:text-white truncate">{asg.title}</h5>
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="min-w-0 truncate text-slate-500 dark:text-slate-400">
                          {draft
                            ? language === 'th' ? 'นักเรียนยังไม่เห็น' : 'Hidden from students'
                            : `${language === 'th' ? 'เผยแพร่' : 'Publishes'} ${formatDateTime(asg.publish_at, language)}`}
                        </span>
                        <span className="shrink-0 inline-flex items-center gap-0.5 font-bold text-slate-500 dark:text-slate-400 group-hover:text-slate-800 dark:group-hover:text-slate-200">
                          {language === 'th' ? 'เปิดดู' : 'Open'}
                          <ArrowRight className="w-3 h-3" />
                        </span>
                      </div>
                    </Link>
                  );
                };
                const summary = [
                  pendingTotal > 0 && (language === 'th' ? `รอตรวจ ${pendingTotal} ชิ้น` : `${pendingTotal} to grade`),
                  missingTotal > 0 && (language === 'th' ? `ยังไม่มีคะแนน ${missingTotal} คน` : `${missingTotal} without a score`),
                  unpublished.length > 0 && (language === 'th' ? `ยังไม่เผยแพร่ ${unpublished.length} งาน` : `${unpublished.length} unpublished`),
                ].filter(Boolean).join(' · ');
                return (
                  <div className="pt-2">
                    <div className="rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 ring-1 ring-amber-200 dark:ring-amber-900/50 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setFoldedToGradeCourses((prev) => ({ ...prev, [course.id]: open }))}
                        aria-expanded={open}
                        className="group/tograde w-full flex items-center gap-2.5 p-3 text-left hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors cursor-pointer"
                      >
                        <span className="w-7 h-7 rounded-lg shrink-0 bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                          <Clock className="w-4 h-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-bold text-amber-800 dark:text-amber-300">
                            {toGrade.length > 0
                              ? language === 'th' ? `ยังตรวจไม่ครบ ${toGrade.length} งาน` : `${toGrade.length} tasks not fully graded`
                              : language === 'th' ? `ยังไม่เผยแพร่ ${unpublished.length} งาน` : `${unpublished.length} unpublished tasks`}
                          </span>
                          <span className="block text-[11px] text-amber-700/70 dark:text-amber-400/70 truncate">{summary}</span>
                        </span>
                        <span className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-amber-600 dark:text-amber-400 bg-white/70 dark:bg-slate-900/60 ring-1 ring-amber-200/80 dark:ring-amber-900/60 group-hover/tograde:ring-amber-400 transition-colors">
                          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
                        </span>
                      </button>
                      <Collapse open={open}>
                        <div className="px-3 pb-3 space-y-3">
                          {toGrade.length > 0 && <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">{toGrade.map(row)}</div>}
                          {unpublished.length > 0 && (
                            <div className="space-y-2">
                              {toGrade.length > 0 && (
                                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                  {language === 'th' ? `ยังไม่เผยแพร่ (${unpublished.length})` : `Not published yet (${unpublished.length})`}
                                </p>
                              )}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">{unpublished.map(unpublishedRow)}</div>
                            </div>
                          )}
                        </div>
                      </Collapse>
                    </div>
                  </div>
                );
              })()}
            </div>
            ))
          )}
        </div>
      </div>

      {/* COURSE INDICATORS & RUBRICS CONFIGURATION MODAL */}
      {isIndicatorsModalOpen && editingCourseIndicators && (
        <ModalSheet onClose={() => setIsIndicatorsModalOpen(false)} size="sm:max-w-2xl">
            <ModalSheetHeader>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                  <Sliders className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {tr('แก้ไขรายวิชา', 'Edit course')}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {editingCourseIndicators.code} - {editingCourseIndicators.name}
                    {' · '}
                    {formatAcademicPeriod(editingCourseIndicators.semester, editingCourseIndicators.year_ce, language)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsIndicatorsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer shrink-0"
                aria-label={t('common.cancel')}
              >
                <X className="w-5 h-5" />
              </button>
            </ModalSheetHeader>

            <ModalSheetBody className="space-y-6">
            {/* ─── COURSE DETAILS ─── */}
            <section className="space-y-3">
              <h4 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-amber-500" />
                {tr('ข้อมูลรายวิชา', 'Course details')}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="edit-course-code" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('courses.course_code')} *
                  </label>
                  <input
                    id="edit-course-code"
                    type="text"
                    required
                    value={courseDetailsDraft.code}
                    onChange={(e) => setCourseDetailsDraft((d) => ({ ...d, code: e.target.value }))}
                    placeholder={language === 'th' ? 'เช่น ท31103' : 'e.g. TH31103'}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 font-mono text-slate-900 dark:text-white uppercase font-bold"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="edit-course-name" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('courses.course_name')} *
                  </label>
                  <input
                    id="edit-course-name"
                    type="text"
                    required
                    value={courseDetailsDraft.name}
                    onChange={(e) => setCourseDetailsDraft((d) => ({ ...d, name: e.target.value }))}
                    placeholder={language === 'th' ? 'เช่น ภาษาไทยเพื่อการนำเสนอ' : 'e.g. Thai Presentation & Discourse'}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="edit-course-desc" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('courses.course_desc')}
                </label>
                <textarea
                  id="edit-course-desc"
                  rows={3}
                  value={courseDetailsDraft.description}
                  onChange={(e) => setCourseDetailsDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder={language === 'th' ? 'คำอธิบายรายวิชา...' : 'Curriculum overview and competencies...'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 text-slate-900 dark:text-white resize-y"
                />
              </div>
            </section>

            <h4 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5 pt-4 border-t border-slate-100 dark:border-slate-800">
              <Sliders className="w-3.5 h-3.5 text-amber-500" />
              {t('indicators_config.title')}
            </h4>

            {/* ─── MODE TOGGLE: ตัวชี้วัด vs สมรรถนะรายวิชา ─── */}
            <div className="p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 flex gap-1">
              <button
                type="button"
                onClick={() => setIndicatorMode('indicator')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  indicatorMode === 'indicator'
                    ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-sm border border-amber-200 dark:border-amber-800'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{tr('ตัวชี้วัด', 'Indicators')}</span>
              </button>
              <button
                type="button"
                onClick={() => setIndicatorMode('competency')}
                className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  indicatorMode === 'competency'
                    ? 'bg-white dark:bg-slate-900 text-violet-700 dark:text-violet-300 shadow-sm border border-violet-200 dark:border-violet-800'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                <Award className="w-3.5 h-3.5" />
                <span>{tr('สมรรถนะรายวิชา', 'Course competencies')}</span>
              </button>
            </div>

            {/* ─── INDICATOR MODE ─── */}
            {indicatorMode === 'indicator' && (
              <>
                {/* Saved Indicators Library Suggestions */}
                {savedTeacherIndicators.length > 0 && (
                  <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                        <span>{t('indicators_config.saved_library_title')} ({savedTeacherIndicators.length})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsSavedLibraryOpen(!isSavedLibraryOpen)}
                        className="text-[11px] font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                      >
                        {isSavedLibraryOpen ? tr('ซ่อนคลังตัวชี้วัด', 'Hide indicator library') : tr('แสดงคลังตัวชี้วัด', 'Show indicator library')}
                      </button>
                    </div>
                    {isSavedLibraryOpen && (
                      <div className="space-y-2 pt-1 max-h-48 overflow-y-auto pr-1">
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {t('indicators_config.saved_library_desc')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {savedTeacherIndicators.map((sInd) => (
                            <button
                              key={sInd.id}
                              type="button"
                              onClick={() => handleAddFromSavedLibrary(sInd)}
                              className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 hover:border-amber-500 text-left text-xs text-slate-800 dark:text-slate-200 transition-all hover:scale-[1.01] flex items-center gap-1.5 cursor-pointer shadow-2xs"
                            >
                              {sInd.code && (
                                <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                                  {sInd.code}
                                </span>
                              )}
                              <span className="line-clamp-1 max-w-70">{sInd.title}</span>
                              <PlusCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 ml-1" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Indicator Items List */}
                <div className="space-y-3">
                  {indicatorListDraft.length === 0 ? (
                    <div className="p-5 sm:p-8 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl text-xs text-slate-400">
                      {tr('ยังไม่มีตัวชี้วัด กดปุ่มด้านล่างเพื่อเพิ่ม', 'No indicators yet. Use the button below to add one.')}
                    </div>
                  ) : (
                    indicatorListDraft.map((ind, idx) => (
                      <div
                        key={ind.id}
                        className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="px-2.5 py-0.5 rounded-lg bg-amber-500 text-slate-950 font-black text-xs font-mono shrink-0">
                            {t('indicators_config.item_label')} {idx + 1}
                          </span>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveIndicator(idx, 'up')}
                              className="p-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-100 cursor-pointer"
                              title={t('indicators_config.move_up')}
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === indicatorListDraft.length - 1}
                              onClick={() => handleMoveIndicator(idx, 'down')}
                              className="p-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30 hover:bg-slate-100 cursor-pointer"
                              title={t('indicators_config.move_down')}
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteIndicatorDraft(idx)}
                              className="p-1 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                              title={tr('ลบตัวชี้วัดนี้', 'Delete this indicator')}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <textarea
                          rows={2}
                          value={ind.title}
                          onChange={(e) => {
                            const copy = [...indicatorListDraft];
                            copy[idx].title = e.target.value;
                            setIndicatorListDraft(copy);
                          }}
                          placeholder={t('indicators_config.title_label')}
                          className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white resize-none focus:outline-hidden focus:border-amber-500"
                        />
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleAddIndicatorDraft}
                  className="w-full py-2.5 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4 text-amber-500" />
                  <span>+ {t('indicators_config.add_indicator')} ({tr('ข้อที่', 'item')} {indicatorListDraft.length + 1})</span>
                </button>
              </>
            )}

            {/* ─── COMPETENCY MODE ─── */}
            {indicatorMode === 'competency' && (
              <>
                {/* Step 1: define competency items */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Award className="w-3.5 h-3.5 text-violet-500" />
                      {tr(`ขั้นที่ 1 — สมรรถนะรายวิชา (${indicatorListDraft.length} ข้อ)`, `Step 1 — Course competencies (${indicatorListDraft.length})`)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    {tr('สมรรถนะหลักที่แผนการสอนจะ map เข้าหา', 'The core competencies lesson plans map to')}
                  </p>

                  <div className="space-y-2">
                    {indicatorListDraft.length === 0 ? (
                      <div className="p-4 sm:p-6 text-center border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl text-xs text-slate-400">
                        {tr('ยังไม่มีสมรรถนะ กดปุ่มด้านล่างเพื่อเพิ่ม', 'No competencies yet. Use the button below to add one.')}
                      </div>
                    ) : (
                      indicatorListDraft.map((ind, idx) => (
                        <div
                          key={ind.id}
                          className="flex items-start gap-2 p-3 rounded-xl bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-900/60"
                        >
                          <span className="shrink-0 w-6 h-6 rounded-lg bg-violet-500 text-white font-black text-xs flex items-center justify-center mt-0.5">
                            {idx + 1}
                          </span>
                          <input
                            type="text"
                            value={ind.title}
                            onChange={(e) => {
                              const copy = [...indicatorListDraft];
                              copy[idx].title = e.target.value;
                              setIndicatorListDraft(copy);
                            }}
                            placeholder={tr('เช่น ผู้เรียนสามารถวิเคราะห์และสังเคราะห์ข้อมูลได้', 'e.g. Students can analyze and synthesize information')}
                            className="flex-1 min-w-0 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-800 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-violet-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleDeleteIndicatorDraft(idx)}
                            className="p-1 rounded-lg text-slate-400 hover:text-rose-500 cursor-pointer mt-0.5 shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleAddIndicatorDraft}
                    className="w-full py-2 rounded-xl border border-dashed border-violet-300 dark:border-violet-800 text-xs font-bold text-violet-700 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>+ {tr('เพิ่มสมรรถนะ', 'Add competency')} ({tr('ข้อที่', 'item')} {indicatorListDraft.length + 1})</span>
                  </button>
                </div>

                {/* Step 2: lesson plan mapping */}
                {indicatorListDraft.length > 0 && (
                  <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <BookOpen className="w-3.5 h-3.5 text-amber-500" />
                        {tr(`ขั้นที่ 2 — แผนการสอน (${lessonPlanDraft.length} แผน)`, `Step 2 — Lesson plans (${lessonPlanDraft.length})`)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      {tr('เขียนแต่ละแผน แล้วเลือกสมรรถนะที่ map (เลือกได้หลายข้อ)', 'Write each plan, then pick the competencies it maps to (multiple allowed)')}
                    </p>

                    <div className="space-y-3">
                      {lessonPlanDraft.map((plan, planIdx) => (
                        <div
                          key={plan.id}
                          className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="px-2.5 py-0.5 rounded-lg bg-amber-500 text-slate-950 font-black text-xs font-mono shrink-0">
                              {tr('แผน', 'Plan')} {planIdx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={() => setLessonPlanDraft(lessonPlanDraft.filter((_, i) => i !== planIdx))}
                              className="p-1 rounded-lg text-slate-400 hover:text-rose-500 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <input
                            type="text"
                            value={plan.title}
                            onChange={(e) => {
                              const copy = [...lessonPlanDraft];
                              copy[planIdx] = { ...copy[planIdx], title: e.target.value };
                              setLessonPlanDraft(copy);
                            }}
                            placeholder={tr('เช่น กิจกรรมที่ 1: อ่านบทความและจับประเด็น', 'e.g. Activity 1: Read an article and find the main points')}
                            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                          />

                          {/* Competency mapping checkboxes */}
                          <div className="space-y-1">
                            <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                              {tr('map ไปยังสมรรถนะ:', 'Maps to competencies:')}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {indicatorListDraft.map((ind, indIdx) => {
                                const isMapped = plan.mapped_indicator_ids.includes(ind.id);
                                return (
                                  <button
                                    key={ind.id}
                                    type="button"
                                    onClick={() => {
                                      const copy = [...lessonPlanDraft];
                                      const mapped = [...copy[planIdx].mapped_indicator_ids];
                                      if (isMapped) {
                                        // Remove first occurrence only
                                        const firstIdx = mapped.indexOf(ind.id);
                                        if (firstIdx !== -1) mapped.splice(firstIdx, 1);
                                      } else {
                                        mapped.push(ind.id);
                                      }
                                      copy[planIdx] = { ...copy[planIdx], mapped_indicator_ids: mapped };
                                      setLessonPlanDraft(copy);
                                    }}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                                      isMapped
                                        ? 'bg-violet-500 text-white border-violet-600 shadow-xs'
                                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-violet-400'
                                    }`}
                                  >
                                    {tr('สมรรถนะ', 'Competency')} {indIdx + 1}
                                    {isMapped && <span className="ml-1">✓</span>}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        const nextIdx = lessonPlanDraft.length + 1;
                        setLessonPlanDraft([
                          ...lessonPlanDraft,
                          {
                            id: `lp-${Date.now()}`,
                            title: '',
                            order_index: nextIdx,
                            mapped_indicator_ids: [],
                          },
                        ]);
                      }}
                      className="w-full py-2.5 rounded-2xl border border-dashed border-amber-300 dark:border-amber-800 text-xs font-bold text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <PlusCircle className="w-4 h-4" />
                      <span>{tr('+ เพิ่มแผนการสอน', '+ Add lesson plan')}</span>
                    </button>
                  </div>
                )}
              </>
            )}

            </ModalSheetBody>

            <ModalSheetFooter>
              <button
                type="button"
                onClick={() => setIsIndicatorsModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSaveIndicators}
                disabled={isSavingIndicators}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60"
              >
                {isSavingIndicators ? tr('กำลังบันทึก...', 'Saving...') : t('common.save')}
              </button>
            </ModalSheetFooter>
        </ModalSheet>
      )}







      {/* CO-TEACHING SETUP MODAL */}
      {isCoTeachersModalOpen && editingCourseCoTeachers && (
        <ModalSheet onClose={() => setIsCoTeachersModalOpen(false)} size="sm:max-w-2xl">
            <ModalSheetHeader>
              <div className="flex items-center gap-2 min-w-0">
                <Users className="w-5 h-5 text-amber-500 shrink-0" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white line-clamp-2">
                  {t('courses.co_teachers')} — {editingCourseCoTeachers.code} {editingCourseCoTeachers.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCoTeachersModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer shrink-0"
                aria-label={t('common.cancel')}
              >
                <X className="w-5 h-5" />
              </button>
            </ModalSheetHeader>

            <ModalSheetBody className="space-y-6">

            {/* Role Definitions & Rules Banner */}
            <div className="rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 overflow-hidden">
              <button
                type="button"
                onClick={() => setIsCoTeachingArchitectureOpen((open) => !open)}
                className="w-full p-4 flex items-center justify-between gap-3 text-left cursor-pointer"
              >
                <span className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-200">
                  <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>{tr('บทบาทครูร่วมสอน', 'Co-teacher roles')}</span>
                </span>
                <ChevronDown className={`w-4 h-4 text-amber-600 transition-transform ${isCoTeachingArchitectureOpen ? 'rotate-180' : ''}`} />
              </button>
              {isCoTeachingArchitectureOpen && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 px-4 pb-4 text-[11px] leading-relaxed">
                  <div className="p-2.5 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 text-blue-950 dark:text-blue-200">
                    <span className="font-bold block mb-1">{tr('👨‍🏫 ผู้ช่วยสอน (TA):', '👨‍🏫 Teaching assistant (TA):')}</span>
                    <span>{tr(<>ตรวจและให้คะแนนได้ แต่<strong>แก้ไขรายวิชาไม่ได้</strong> ค้นหาได้เฉพาะครูสถาบันเดียวกัน</>, <>Can grade and score, but <strong>cannot edit the course</strong>. Only teachers at your institution can be found.</>)}</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-purple-50/80 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900/50 text-purple-950 dark:text-purple-200">
                    <span className="font-bold block mb-1">{tr('🔬 ครูตรวจเพื่อวิจัย:', '🔬 Research grader:')}</span>
                    <span>{tr('ใช้ประเมิน IRR เท่านั้น นักเรียนไม่เห็น และไม่นับเป็นคะแนนจริง', 'For IRR assessment only; students never see it and it does not count toward real scores')}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800">
              <button type="button" onClick={() => setCoTeacherInviteStep(1)} className={`py-2 rounded-xl text-xs font-bold ${coTeacherInviteStep === 1 ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500'}`}>{tr('ค้นหาครูในระบบ', 'Search teachers')}</button>
              <button type="button" onClick={() => setCoTeacherInviteStep(2)} className={`py-2 rounded-xl text-xs font-bold ${coTeacherInviteStep === 2 ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500'}`}>{tr('เชิญด้วยรหัส / QR', 'Invite by code / QR')}</button>
            </div>

            {/* Existing Teachers in this Course */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                {tr(`ครูในรายวิชา (${coTeachersDraft.length} ท่าน)`, `Course teachers (${coTeachersDraft.length})`)}
              </span>
              <div className="space-y-2">
                {coTeachersDraft.map((tchr) => (
                  <div
                    key={tchr.teacher_id}
                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar src={tchr.avatar_url} name={tchr.name} className="w-9 h-9 text-[10px]" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                            {tchr.name}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                              tchr.role === 'primary'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                                : tchr.role === 'researcher'
                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-800'
                                : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                            }`}
                          >
                            {tchr.role === 'primary'
                              ? tr('👑 เจ้าของวิชา', '👑 Course owner')
                              : tchr.role === 'researcher'
                              ? tr('🔬 ตรวจเพื่อวิจัย', '🔬 Research grader')
                              : tr('👨‍🏫 ผู้ช่วยสอน', '👨‍🏫 Teaching assistant')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                          {tchr.institution && (
                            <span className="text-slate-600 dark:text-slate-300">
                              🏫 {institutionLabel(tchr.institution, language)}
                            </span>
                          )}
                          <span className="font-mono">{tchr.email}</span>
                        </div>
                      </div>
                    </div>

                    {tchr.role !== 'primary' && (
                      <button
                        type="button"
                        onClick={() => handleRemoveCoTeacher(tchr.teacher_id)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg cursor-pointer transition-colors"
                        title={tr('นำครูท่านนี้ออกจากรายวิชา', 'Remove this teacher from the course')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Add New Teacher Form & Autocomplete Search */}
            {coTeacherInviteStep === 1 && (
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 space-y-4">
              <div>
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100 block">
                  {tr('+ เพิ่มครูร่วมสอน', '+ Add co-teacher')}
                </span>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {tr('เลือกบทบาท แล้วค้นหาครู หรือส่งลิงก์เชิญ', 'Pick a role, then search for a teacher or send an invite link')}
                </p>
              </div>

              {/* Role Toggle Switcher */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setNewCoTeacherRole('assistant');
                    if (teacherSearchQuery) handleSearchTeachers(teacherSearchQuery);
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    newCoTeacherRole === 'assistant'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <GraduationCap className="w-4 h-4" />
                  <span>{tr('ครูผู้ช่วยสอน (TA)', 'Teaching assistant (TA)')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewCoTeacherRole('researcher');
                    if (teacherSearchQuery) handleSearchTeachers(teacherSearchQuery);
                  }}
                  className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    newCoTeacherRole === 'researcher'
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <FlaskConical className="w-4 h-4" />
                  <span>{tr('ครูตรวจเพื่อวิจัย', 'Research grader')}</span>
                </button>
              </div>

              {/* Role Context Notification */}
              <div className="text-[11px] px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 flex items-center gap-2">
                {newCoTeacherRole === 'assistant' ? (
                  <>
                    <Search className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                    <span>{tr('ค้นหาเฉพาะครูใน', 'Only search teachers at')} <b>{institutionLabel(teacherProfile?.institution, language) || tr('สถาบันเดียวกับคุณ', 'your institution')}</b></span>
                  </>
                ) : (
                  <>
                    <Search className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                    <span>{tr('ค้นหาครูจากทุกสถาบัน (ผู้ประเมินภายนอก)', 'Search teachers at all institutions (external evaluators)')}</span>
                  </>
                )}
              </div>

              {/* Autocomplete Search Input */}
              <div className="relative">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={teacherSearchQuery}
                    onChange={(e) => handleSearchTeachers(e.target.value)}
                    placeholder={
                      newCoTeacherRole === 'assistant'
                        ? tr('ค้นหาชื่อหรืออีเมล (สถาบันเดียวกัน)...', 'Search name or email (same institution)...')
                        : tr('ค้นหาชื่อหรืออีเมล (ทุกสถาบัน)...', 'Search name or email (all institutions)...')
                    }
                    className="w-full pl-9 pr-9 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                  />
                  {isSearchingTeachers && (
                    <Loader2 className="w-4 h-4 text-amber-500 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
                  )}
                </div>

                {/* Autocomplete Results Dropdown */}
                {teacherSearchResults.length > 0 && (
                  <div className="mt-2 p-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-lg space-y-1 max-h-48 overflow-y-auto">
                    <span className="text-[10px] font-bold text-slate-400 px-2 block">
                      {tr(`ผลการค้นหา (${teacherSearchResults.length} ท่าน)`, `Results (${teacherSearchResults.length})`)}
                    </span>
                    {teacherSearchResults.map((tchr) => (
                      <div
                        key={tchr.id}
                        className="p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/80 flex items-center justify-between gap-2 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Avatar src={tchr.avatar_url} name={tchr.name} className="w-7 h-7 text-[10px]" />
                          <div className="min-w-0">
                            <span className="font-bold text-xs text-slate-900 dark:text-white block truncate">
                              {`${tchr.first_name || ''} ${tchr.last_name || ''}`.trim() || tchr.name || tr('ครูผู้สอน', 'Teacher')}
                            </span>
                            <span className="text-[10px] text-slate-400 block truncate">
                              {tchr.institution ? `🏫 ${institutionLabel(tchr.institution, language)} • ` : ''}{tchr.email}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectFoundTeacher(tchr)}
                          className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-[11px] font-bold shrink-0 cursor-pointer"
                        >
                          {tr('+ เพิ่ม', '+ Add')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
            )}

            {/* Teacher Web & LINE Invite Link Section */}
            {editingCourseCoTeachers && coTeacherInviteStep === 2 && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-300 dark:border-amber-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                    <FlaskConical className="w-3.5 h-3.5 text-amber-600" />
                    <span>{tr('เชิญผ่านลิงก์ / LINE', 'Invite via link / LINE')}</span>
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-white/70 dark:bg-slate-900/70 border border-amber-200 dark:border-amber-900/60">
                  <button
                    type="button"
                    onClick={() => setNewCoTeacherRole('assistant')}
                    className={`py-2 rounded-xl text-xs font-bold transition-colors ${newCoTeacherRole === 'assistant' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                  >
                    {tr('👨‍🏫 ครู TA', '👨‍🏫 TA')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewCoTeacherRole('researcher')}
                    className={`py-2 rounded-xl text-xs font-bold transition-colors ${newCoTeacherRole === 'researcher' ? 'bg-purple-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                  >
                    {tr('🔬 นักวิจัย', '🔬 Researcher')}
                  </button>
                </div>

                <div className="inline-flex items-center gap-2 rounded-xl bg-white/70 dark:bg-slate-900/70 border border-amber-200 dark:border-amber-900/60 px-3 py-2 text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  {newCoTeacherRole === 'assistant' ? tr('👨‍🏫 ลิงก์สำหรับผู้ช่วยสอน (TA)', '👨‍🏫 Link for teaching assistants (TA)') : tr('🔬 ลิงก์สำหรับครูตรวจเพื่อวิจัย', '🔬 Link for research graders')}
                </div>

                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  {newCoTeacherRole === 'assistant'
                    ? tr('ผู้ช่วยสอนจะตรวจและให้คะแนนจริงได้', 'Teaching assistants can grade and give real scores')
                    : tr('ครูตรวจเพื่อวิจัยประเมินความสอดคล้อง (IRR) ได้ โดยนักเรียนไม่เห็นคะแนนหรือชื่อ', 'Research graders assess agreement (IRR); students never see their scores or names')}
                </p>

                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 font-mono text-[11px] text-slate-700 dark:text-slate-300 break-all select-all">
                  {teacherInviteUrl(editingCourseCoTeachers.id, newCoTeacherRole) || tr('กำลังสร้างลิงก์...', 'Creating link...')}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleCopyTeacherInviteLink(editingCourseCoTeachers, newCoTeacherRole)}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{isCopiedTeacherLink ? tr('คัดลอกลิงก์แล้ว!', 'Link copied!') : tr(`คัดลอกลิงก์เชิญ (${newCoTeacherRole === 'assistant' ? 'TA' : 'ผู้วิจัย'})`, `Copy invite link (${newCoTeacherRole === 'assistant' ? 'TA' : 'researcher'})`)}</span>
                  </button>

                  <a
                    href={`https://line.me/R/msg/text/?${encodeURIComponent(
                      tr(
                        `ขอเชิญคุณครูเข้าร่วมเป็น${
                          newCoTeacherRole === 'assistant'
                            ? 'ครูผู้ช่วยสอน (Teaching Assistant - TA)'
                            : 'ครูผู้ช่วยตรวจงานวิจัย (Research Evaluator)'
                        } วิชา "${editingCourseCoTeachers.code} ${editingCourseCoTeachers.name}" ที่ลิงก์: ${teacherInviteUrl(editingCourseCoTeachers.id, newCoTeacherRole)}`,
                        `You're invited to join as ${
                          newCoTeacherRole === 'assistant' ? 'a Teaching Assistant (TA)' : 'a Research Evaluator'
                        } for "${editingCourseCoTeachers.code} ${editingCourseCoTeachers.name}": ${teacherInviteUrl(editingCourseCoTeachers.id, newCoTeacherRole)}`
                      )
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    <span>{tr('แชร์คำเชิญไปยัง LINE', 'Share invite on LINE')}</span>
                  </a>

                  <a
                    href={`mailto:?subject=${encodeURIComponent(
                      tr(
                        `คำเชิญเป็น${newCoTeacherRole === 'assistant' ? 'ครูผู้ช่วยสอน' : 'ครูตรวจงานวิจัย'} วิชา ${editingCourseCoTeachers.code}`,
                        `Invitation: ${newCoTeacherRole === 'assistant' ? 'Teaching Assistant' : 'Research Evaluator'} for ${editingCourseCoTeachers.code}`
                      )
                    )}&body=${encodeURIComponent(
                      tr(
                        `เรียนคุณครู,\n\nขอเชิญเข้าร่วมเป็น${
                          newCoTeacherRole === 'assistant'
                            ? 'ครูผู้ช่วยสอน (Teaching Assistant - TA)'
                            : 'ครูผู้ช่วยตรวจงานวิจัย (Research Evaluator)'
                        } สำหรับรายวิชา "${editingCourseCoTeachers.code} ${editingCourseCoTeachers.name}"\n\nท่านสามารถกดยืนยันคำเชิญได้ที่ลิงก์นี้:\n${teacherInviteUrl(editingCourseCoTeachers.id, newCoTeacherRole)}\n\nขอบคุณครับ/ค่ะ`,
                        `Dear teacher,\n\nYou're invited to join as ${
                          newCoTeacherRole === 'assistant' ? 'a Teaching Assistant (TA)' : 'a Research Evaluator'
                        } for "${editingCourseCoTeachers.code} ${editingCourseCoTeachers.name}".\n\nAccept the invitation here:\n${teacherInviteUrl(editingCourseCoTeachers.id, newCoTeacherRole)}\n\nThank you`
                      )
                    )}`}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>{tr('ส่งอีเมลเชิญ', 'Send email invite')}</span>
                  </a>
                </div>
              </div>
            )}

            </ModalSheetBody>

            <ModalSheetFooter>
              <button
                type="button"
                onClick={() => setIsCoTeachersModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSaveCoTeachers}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold shadow-xs cursor-pointer"
              >
                {t('common.save')}
              </button>
            </ModalSheetFooter>
        </ModalSheet>
      )}

      {/* CREATE / EDIT CLASSROOM SECTION MODAL */}
      {isClassModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => setIsClassModalOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl p-5 sm:p-6 space-y-6 max-h-[calc(100dvh-2rem)] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingClassroom
                  ? t('classroom_mgmt.edit_class_modal_title')
                  : t('classroom_mgmt.create_class_modal_title')}
              </h3>
              <button
                onClick={() => setIsClassModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveClassroom} className="space-y-4">
              {/* Parent Course Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('classroom_mgmt.fields.parent_course')} *
                </label>
                <select
                  required
                  value={selectedCourseForClass}
                  onChange={(e) => {
                    const selId = e.target.value;
                    setSelectedCourseForClass(selId);
                    const selCourse = courses.find((c) => c.id === selId);
                    if (selCourse) {
                      setSubjectCodeInput(`${selCourse.code} ${selCourse.name}`);
                      setFormSemester(selCourse.semester || defaultPeriod.semester);
                      setFormYearCE(selCourse.year_ce || defaultPeriod.yearCE);
                    }
                  }}
                  className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer ${
                    !selectedCourseForClass
                      ? 'border-amber-500/80 ring-2 ring-amber-500/20'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <option value="">
                    {t('classroom_mgmt.fields.select_course_placeholder')}
                  </option>
                  {courses.map((crs) => (
                    <option key={crs.id} value={crs.id}>
                      {crs.code} - {crs.name} ({formatAcademicPeriod(crs.semester, crs.year_ce, language)})
                    </option>
                  ))}
                </select>
                {!selectedCourseForClass && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                    ⚠️ {language === 'th' ? 'กรุณาเลือกรายวิชาก่อนบันทึก' : 'Please select a course first'}
                  </p>
                )}
              </div>

              {/* Classroom Section Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('classroom_mgmt.fields.name_label')} *
                </label>
                <input
                  type="text"
                  required
                  value={classNameInput}
                  onChange={(e) => setClassNameInput(e.target.value)}
                  placeholder={t('classroom_mgmt.fields.name_placeholder')}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 font-medium text-slate-900 dark:text-white"
                />
              </div>

              {/* SELECTABLE SEMESTER AND ACADEMIC YEAR */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('classroom_mgmt.fields.semester_label')} *
                  </label>
                  <select
                    value={formSemester}
                    onChange={(e) => setFormSemester(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                  >
                    <option value={1}>{t('classroom_mgmt.fields.semester_1')}</option>
                    <option value={2}>{t('classroom_mgmt.fields.semester_2')}</option>
                    <option value={3}>{t('classroom_mgmt.fields.semester_3')}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('classroom_mgmt.fields.year_label')} *
                  </label>
                  <select
                    value={formYearCE}
                    onChange={(e) => setFormYearCE(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                  >
                    {yearOptions.map((yr) => (
                      <option key={yr} value={yr}>
                        {language === 'th' ? `พ.ศ. ${yr + 543}` : `C.E. ${yr}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setIsClassModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold shadow-xs cursor-pointer"
                >
                  {t('common.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE NEW COURSE MODAL */}
      {isCourseModalOpen && (
        <ModalSheet onClose={() => setIsCourseModalOpen(false)} size="sm:max-w-lg">
            <ModalSheetHeader>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <BookOpen className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {t('courses.create_course_modal_title') || (language === 'th' ? 'สร้างรายวิชาใหม่' : 'Create New Course')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCourseModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"
                aria-label={t('common.cancel')}
              >
                <X className="w-5 h-5" />
              </button>
            </ModalSheetHeader>

            <form onSubmit={handleSaveCourse} className={MODAL_SHEET_FORM}>
              <ModalSheetBody className="space-y-4">
              <div className="flex items-center gap-3 pb-1">
                {[1, 2].map((step) => (
                  <React.Fragment key={step}>
                    <div className={`flex items-center gap-2 text-xs font-black ${courseCreationStep === step ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center ${courseCreationStep === step ? 'bg-amber-500 text-slate-950' : 'bg-slate-200 dark:bg-slate-800'}`}>{step}</span>
                      <span>{step === 1 ? tr('ข้อมูลรายวิชา', 'Course details') : tr('กรอบการวัดผล', 'Assessment framework')}</span>
                    </div>
                    {step === 1 && <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />}
                  </React.Fragment>
                ))}
              </div>

              {/* Optional: Import/Clone from Existing Course */}
              {courses.length > 0 && !isCourseCloneFlow && (
                <div className={`${courseCreationStep === 1 ? '' : 'hidden'} p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 space-y-1.5`}>
                  <label className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                    <Copy className="w-3.5 h-3.5 text-amber-600" />
                    <span>{language === 'th' ? 'คัดลอกข้อมูลจากวิชาเดิม (ตัวเลือก)' : 'Import from existing course (Optional)'}</span>
                  </label>
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const selId = e.target.value;
                      if (!selId) {
                        setCourseCodeInput('');
                        setCourseNameInput('');
                        setCourseDescInput('');
                        setCourseSemesterInput(defaultPeriod.semester);
                        setCourseYearInput(defaultPeriod.yearCE);
                        setCourseIndicatorsDraft([]);
                        setCourseLessonPlanDraft([]);
                        setCourseCreationMode('indicator');
                        setCourseCreationStep(1);
                        return;
                      }
                      const sel = courses.find((c) => c.id === selId);
                      if (sel) {
                        setCourseCodeInput(sel.code);
                        setCourseNameInput(sel.name);
                        setCourseDescInput(sel.description || '');
                        setCourseIndicatorsDraft(sel.indicators || []);
                        setCourseLessonPlanDraft(sel.lesson_plans || []);
                        setCourseCreationMode(sel.indicator_mode || 'indicator');
                        setCourseCreationStep(1);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-hidden cursor-pointer"
                  >
                    <option value="">{language === 'th' ? '-- สร้างวิชาใหม่จากศูนย์ --' : '-- Start from scratch --'}</option>
                    {courses.map((crs) => (
                      <option key={crs.id} value={crs.id}>
                        {crs.code} - {crs.name} ({formatAcademicPeriod(crs.semester, crs.year_ce, language)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Course Code */}
              <div className={`${courseCreationStep === 1 ? '' : 'hidden'} space-y-1.5`}>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('courses.course_code')} *
                </label>
                <input
                  type="text"
                  required
                  value={courseCodeInput}
                  onChange={(e) => setCourseCodeInput(e.target.value)}
                  placeholder={language === 'th' ? 'เช่น ท31103 หรือ ท32102' : 'e.g. TH31103'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 font-mono text-slate-900 dark:text-white uppercase font-bold"
                />
              </div>

              {/* Course Name */}
              <div className={`${courseCreationStep === 1 ? '' : 'hidden'} space-y-1.5`}>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('courses.course_name')} *
                </label>
                <input
                  type="text"
                  required
                  value={courseNameInput}
                  onChange={(e) => setCourseNameInput(e.target.value)}
                  placeholder={language === 'th' ? 'เช่น ภาษาไทยเพื่อการนำเสนอ' : 'e.g. Thai Presentation & Discourse'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 text-slate-900 dark:text-white"
                />
              </div>

              {/* Course Description */}
              <div className={`${courseCreationStep === 1 ? '' : 'hidden'} space-y-1.5`}>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('courses.course_desc')}
                </label>
                <textarea
                  rows={2}
                  value={courseDescInput}
                  onChange={(e) => setCourseDescInput(e.target.value)}
                  placeholder={language === 'th' ? 'คำอธิบายรายวิชา...' : 'Curriculum overview and competencies...'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 text-slate-900 dark:text-white resize-none"
                />
              </div>

              {/* The framework is part of the same draft; nothing is persisted until the final submit. */}
              <div className={`${courseCreationStep === 2 ? '' : 'hidden'} space-y-3 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 p-4`}>
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-black text-slate-900 dark:text-white">
                      2. {tr('กรอบการวัดผล', 'Assessment framework')} <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300">{tr('ยังไม่บันทึกฐานข้อมูล', 'Not saved yet')}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    {tr('เลือก 1 กรอบต่อรายวิชา และกรอกอย่างน้อย 1 รายการ', 'Pick one framework per course and add at least one item')}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-amber-200 dark:border-amber-900/60">
                  <button
                    type="button"
                    onClick={() => setCourseCreationMode('indicator')}
                    className={`rounded-lg py-2 text-xs font-bold transition-colors ${courseCreationMode === 'indicator' ? 'bg-amber-500 text-slate-950' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                  >
                    {tr('ตัวชี้วัด', 'Indicators')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCourseCreationMode('competency')}
                    className={`rounded-lg py-2 text-xs font-bold transition-colors ${courseCreationMode === 'competency' ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}
                  >
                    {tr('สมรรถนะ', 'Competencies')}
                  </button>
                </div>

                <div className="space-y-2">
                  {courseIndicatorsDraft.map((item, index) => (
                    <div key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 items-center">
                      <span className={`px-3 py-2 rounded-xl text-xs font-black ${courseCreationMode === 'competency' ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'}`}>
                        {tr('ข้อ', 'Item')} {index + 1}
                      </span>
                      <input
                        value={item.title}
                        onChange={(event) => handleUpdateCourseFrameworkItem(index, 'title', event.target.value)}
                        placeholder={courseCreationMode === 'indicator' ? tr('ชื่อตัวชี้วัด', 'Indicator name') : tr('ชื่อสมรรถนะ', 'Competency name')}
                        className="min-w-0 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveCourseFrameworkItem(index)}
                        className="p-2 text-slate-400 hover:text-rose-500 rounded-lg"
                        aria-label={tr('ลบรายการ', 'Remove item')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleAddCourseFrameworkItem}
                    className="w-full py-2 rounded-xl border border-dashed border-amber-300 dark:border-amber-800 text-xs font-bold text-amber-700 dark:text-amber-300 hover:bg-amber-100/60 dark:hover:bg-amber-950/40"
                  >
                    + {courseCreationMode === 'indicator' ? tr('เพิ่มตัวชี้วัด', 'Add indicator') : tr('เพิ่มสมรรถนะ', 'Add competency')}
                  </button>
                </div>

                {courseCreationMode === 'competency' && (
                  <div className="space-y-3 pt-3 border-t border-amber-200 dark:border-amber-900/60">
                    <div>
                      <div className="text-xs font-black text-slate-900 dark:text-white">{tr('แผนการสอน / กิจกรรมที่ map กับสมรรถนะ', 'Lesson plans / activities mapped to competencies')}</div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{tr('ทุกสมรรถนะต้องมีแผนการสอนอย่างน้อย 1 แผนก่อนบันทึก', 'Every competency needs at least one lesson plan before saving')}</p>
                    </div>
                    {courseLessonPlanDraft.map((plan, planIndex) => (
                      <div key={plan.id} className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-black text-slate-500">{tr('แผน', 'Plan')} {planIndex + 1}</span>
                          <input
                            value={plan.title}
                            onChange={(event) => setCourseLessonPlanDraft((current) => current.map((item, index) => index === planIndex ? { ...item, title: event.target.value } : item))}
                            placeholder={tr('ชื่อแผนการสอน / กิจกรรม', 'Lesson plan / activity name')}
                            className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => setCourseLessonPlanDraft((current) => current.filter((_, index) => index !== planIndex).map((item, index) => ({ ...item, order_index: index + 1 })))}
                            className="p-2 text-slate-400 hover:text-rose-500 rounded-lg"
                            aria-label={tr('ลบแผนการสอน', 'Remove lesson plan')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {courseIndicatorsDraft.map((indicator, indicatorIndex) => {
                            const isMapped = (plan.mapped_indicator_ids || []).includes(indicator.id);
                            return (
                              <button
                                key={indicator.id}
                                type="button"
                                onClick={() => setCourseLessonPlanDraft((current) => current.map((item, index) => {
                                  if (index !== planIndex) return item;
                                  const ids = item.mapped_indicator_ids || [];
                                  return { ...item, mapped_indicator_ids: isMapped ? ids.filter((id) => id !== indicator.id) : [...ids, indicator.id] };
                                }))}
                                className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${isMapped ? 'bg-violet-600 text-white border-violet-600' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'}`}
                              >
                                {tr('สมรรถนะ', 'Competency')} {indicatorIndex + 1}{isMapped ? ' ✓' : ''}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCourseLessonPlanDraft((current) => [...current, { id: `draft-plan-${Date.now()}`, title: '', order_index: current.length + 1, mapped_indicator_ids: [] }])}
                      className="w-full py-2 rounded-xl border border-dashed border-violet-300 dark:border-violet-800 text-xs font-bold text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                    >
                      {tr('+ เพิ่มแผนการสอน', '+ Add lesson plan')}
                    </button>
                  </div>
                )}
              </div>

              {/* Semester & Year */}
              <div className={`${courseCreationStep === 1 ? '' : 'hidden'} grid grid-cols-2 gap-3 pt-1`}>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('classroom_mgmt.fields.semester_label')} *
                  </label>
                  <select
                    value={courseSemesterInput}
                    onChange={(e) => setCourseSemesterInput(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                  >
                    <option value={1}>{t('classroom_mgmt.fields.semester_1')}</option>
                    <option value={2}>{t('classroom_mgmt.fields.semester_2')}</option>
                    <option value={3}>{t('classroom_mgmt.fields.semester_3')}</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('classroom_mgmt.fields.year_label')} *
                  </label>
                  <select
                    value={courseYearInput}
                    onChange={(e) => setCourseYearInput(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                  >
                    {yearOptions.map((yr) => (
                      <option key={yr} value={yr}>
                        {language === 'th' ? `พ.ศ. ${yr + 543}` : `C.E. ${yr}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              </ModalSheetBody>

              <ModalSheetFooter>
                <button
                  type="button"
                  onClick={() => setIsCourseModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {t('common.cancel')}
                </button>
                {courseCreationStep === 2 && (
                  <button
                  key="course-back"
                  type="button"
                  onClick={() => setCourseCreationStep(1)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {tr('ย้อนกลับ', 'Back')}
                </button>
                )}
                {/* Distinct keys: without them React reuses one <button> and flips
                    its type to "submit" during the click, which submitted the form. */}
                {courseCreationStep === 1 ? (
                  <button
                  key="course-next"
                  type="button"
                  onClick={goToCourseFrameworkStep}
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black shadow-md shadow-amber-500/20 cursor-pointer transition-transform active:scale-95"
                >
                  {tr('ถัดไป: กำหนดกรอบการวัดผล', 'Next: assessment framework')}
                </button>
                ) : (
                <button
                  key="course-submit"
                  type="submit"
                  disabled={isSavingCourse}
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black shadow-md shadow-amber-500/20 cursor-pointer transition-transform active:scale-95 disabled:opacity-60"
                >
                  {isSavingCourse
                    ? (language === 'th' ? 'กำลังสร้างรายวิชา...' : 'Creating...')
                    : (language === 'th' ? 'ยืนยันสร้างวิชาและกรอบการวัดผล' : 'Create course and framework')}
                </button>
                )}
              </ModalSheetFooter>
            </form>
        </ModalSheet>
      )}

      {/* LINE GROUP CONNECTION MODAL */}
      {lineConnectionClassroom && (
        <ModalSheet onClose={() => setLineConnectionClassroom(null)} size="sm:max-w-md">
            <ModalSheetHeader>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold">
                  <MessageCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">{tr('เชื่อมต่อ LINE Group', 'Connect LINE group')}</h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{lineConnectionClassroom.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLineConnectionClassroom(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer shrink-0"
                aria-label={t('common.close')}
              >
                <X className="w-5 h-5" />
              </button>
            </ModalSheetHeader>

            <ModalSheetBody>
            <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-xs">
              <span className="text-slate-500 font-bold">{tr('สถานะการเชื่อมต่อ:', 'Connection:')}</span>
              <span
                className={`px-2.5 py-1 rounded-full text-[11px] font-black ${
                  lineConnection.status === 'connected'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                    : lineConnection.status === 'waiting'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 animate-pulse'
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                {lineConnection.status === 'connected'
                  ? tr('🟢 เชื่อมต่อแล้ว', '🟢 Connected')
                  : lineConnection.status === 'waiting'
                  ? tr('🟡 รอการยืนยันจากกลุ่ม', '🟡 Waiting for the group')
                  : tr('⚪ ยังไม่เชื่อมต่อ', '⚪ Not connected')}
              </span>
            </div>

            {lineConnection.status === 'connected' ? (
              <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 text-xs text-emerald-800 dark:text-emerald-200 space-y-1">
                <p className="font-bold">
                  {lineConnection.groupName ? tr(`เชื่อมกับกลุ่ม “${lineConnection.groupName}” แล้ว`, `Connected to “${lineConnection.groupName}”`) : tr('เชื่อมกับกลุ่ม LINE แล้ว', 'Connected to a LINE group')}
                </p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300">{tr('กลุ่มนี้จะได้รับแจ้งเตือนงาน ครู/TA พิมพ์', 'This group gets work notifications. Teachers/TAs type')} <b>พุดดิ้ง</b> {tr('เพื่อดูคำสั่ง (บอทไม่ตอบนักเรียน) เช่น', 'to see commands (the bot does not reply to students), e.g.')} <b>พุดดิ้ง เข้าห้อง</b> <b>พุดดิ้ง งาน</b> <b>พุดดิ้ง เช็คชื่อ</b></p>
                <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">{tr('หากนำบอทออกจากกลุ่ม การเชื่อมต่อจะยกเลิกเอง', 'Removing the bot from the group disconnects it automatically')}</p>
              </div>
            ) : (
              <LineGroupConnectSteps
                status={lineConnection.status}
                botFriend={teacherLineLink.botFriend}
                addFriendUrl={teacherLineLink.addFriendUrl}
              />
            )}

            </ModalSheetBody>

            <ModalSheetFooter>
              {lineConnection.status !== 'connected' && (
                <button
                  type="button"
                  onClick={() => handleLineConnection('create')}
                  disabled={isLineConnectionLoading}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-black shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {isLineConnectionLoading ? tr('กำลังเตรียม...', 'Preparing...') : lineConnection.status === 'waiting' ? tr('เริ่มรอใหม่ (15 นาที)', 'Restart wait (15 min)') : tr('เชื่อม LINE Group', 'Connect LINE group')}
                </button>
              )}
              {lineConnection.status === 'connected' && (
                <>
                  <button
                    type="button"
                    onClick={() => handleLineConnection('test')}
                    disabled={isLineConnectionLoading}
                    className="px-3.5 py-2 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-300 font-bold text-xs hover:bg-emerald-100 cursor-pointer"
                  >
                    {tr('ทดสอบส่งข้อความ', 'Send test message')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLineConnection('disconnect')}
                    disabled={isLineConnectionLoading}
                    className="px-3.5 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 font-bold text-xs hover:bg-rose-100 cursor-pointer"
                  >
                    {tr('ยกเลิกการเชื่อมต่อ', 'Disconnect')}
                  </button>
                </>
              )}
            </ModalSheetFooter>
        </ModalSheet>
      )}

      {/* STUDENT ROSTER & LINE LIFF INVITE MODAL */}
      {editingStudent && managingClassroom && (
        <EditStudentModal
          classroomId={managingClassroom.id}
          student={editingStudent}
          onClose={() => setEditingStudent(null)}
          onSaved={handleStudentEdited}
        />
      )}

      {managingClassroom && (
        <ModalSheet onClose={() => setManagingClassroom(null)} size="sm:max-w-2xl">
            <ModalSheetHeader>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                  {managingClassroom.name}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {managingClassroom.subject_code} • {managingClassroom.academic_year}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManagingClassroom(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg shrink-0"
                aria-label={t('common.close')}
              >
                <X className="w-5 h-5" />
              </button>
            </ModalSheetHeader>

            <ModalSheetBody className="space-y-6">

            {/* Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2 overflow-x-auto scrollbar-none -mx-1 px-1 [&>button]:shrink-0 [&>button]:whitespace-nowrap">
              <button
                type="button"
                onClick={() => setStudentTab('roster')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  studentTab === 'roster'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {t('classroom_mgmt.students_tab')} ({managingClassroom.students?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setStudentTab('pending')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
                  studentTab === 'pending'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>{tr('คำขอรออนุมัติ (Admit)', 'Pending requests')}</span>
                {(managingClassroom.pending_students?.length || 0) > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-black animate-pulse">
                    {managingClassroom.pending_students?.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setStudentTab('line')}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${
                  studentTab === 'line'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                <MessageCircle className="w-3.5 h-3.5" />
                <span>{t('classroom_mgmt.invite_line_title')}</span>
              </button>
            </div>

            {/* Student Roster Tab */}
            {studentTab === 'roster' && (
              <div className="space-y-4">
                {/* Search existing students from institution */}
                <div className="relative">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={studentSearchQuery}
                      onChange={(e) => handleSearchStudents(e.target.value)}
                      placeholder={language === 'th' ? '🔍 ค้นหานักเรียน (ชื่อ หรือรหัส นร.)...' : 'Search student by name or ID...'}
                      className="w-full pl-8 pr-8 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:border-amber-500 font-medium"
                    />
                    {isSearchingStudents && (
                      <Loader2 className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-amber-500 animate-spin" />
                    )}
                  </div>

                  {studentSearchResults.length > 0 && (
                    <div className="absolute z-20 left-0 right-0 mt-1 p-2 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 space-y-1 max-h-48 overflow-y-auto">
                      {studentSearchResults.map((found) => (
                        <button
                          key={found.id}
                          type="button"
                          onClick={() => {
                            handleSelectFoundStudent(found);
                            setStudentSearchQuery('');
                            setStudentSearchResults([]);
                          }}
                          className="w-full p-2 rounded-xl text-left text-xs hover:bg-amber-50 dark:hover:bg-amber-950/60 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Avatar src={found.avatar_url} firstName={found.first_name} lastName={found.last_name} className="w-6 h-6 text-[10px]" />
                            <div>
                              <span className="font-bold text-slate-900 dark:text-white block">
                                {found.first_name} {found.last_name}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                ID: {found.student_id || '-'} • 🏫 {institutionLabel(found.institution, language) || '-'}
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                            {tr('+ เลือก', '+ Select')}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Students list */}
                <div className="space-y-2">
                  {managingClassroom.students?.map((std) => (
                    <div
                      key={std.id}
                      className="p-3 rounded-xl bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5">
                        <Avatar src={std.avatar_url} firstName={std.first_name} lastName={std.last_name} className="w-7 h-7 text-[10px]" />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs text-slate-900 dark:text-white">
                                {std.first_name || std.last_name
                                  ? `${std.first_name || ''} ${std.last_name || ''}`.trim()
                                  : std.name || tr('นักเรียน', 'Student')}
                              </span>
                              {std.name && (std.first_name || std.last_name) && std.name.trim() !== `${std.first_name || ''} ${std.last_name || ''}`.trim() && (
                                <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/60 rounded border border-emerald-200/60 dark:border-emerald-800/60">
                                  LINE: {std.name}
                                </span>
                              )}
                              <span className="font-mono text-[10px] text-slate-400">
                                ID: {std.student_id || '-'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-0.5 flex-wrap">
                              {std.institution && (
                                <span className="text-slate-600 dark:text-slate-300">🏫 {institutionLabel(std.institution, language)}</span>
                              )}
                              {std.email && <span>• {std.email}</span>}
                            </div>
                          </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setEditingStudent(std)}
                          className="p-1 text-slate-400 hover:text-amber-600 rounded cursor-pointer"
                          title={language === 'th' ? 'แก้ไขชื่อ นามสกุล และรหัสนักเรียน' : 'Edit student'}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveStudent(std.id)}
                          className="p-1 text-slate-400 hover:text-rose-500 rounded cursor-pointer"
                          title="Remove student"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pending Admit Requests Tab */}
            {studentTab === 'pending' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    {tr('นักเรียนที่สแกน QR หรือใช้รหัสห้อง ต้องรอคุณครูอนุมัติก่อน เพื่อกันคนนอกเข้าห้อง', 'Students who scan the QR or use the class code wait for your approval, so outsiders can\'t join')}
                  </p>
                </div>

                {(!managingClassroom.pending_students || managingClassroom.pending_students.length === 0) ? (
                  <div className="py-12 text-center text-xs text-slate-400 space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto text-xl">
                      ✅
                    </div>
                    <p className="font-medium text-slate-600 dark:text-slate-300">
                      {tr('ไม่มีคำขอที่รออนุมัติ', 'No pending requests')}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {tr('คำขอใหม่จะแสดงที่นี่ทันที', 'New requests show up here right away')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {managingClassroom.pending_students.map((std) => (
                      <div
                        key={std.id}
                        className="p-3.5 rounded-2xl bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-900/60 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar src={std.avatar_url} firstName={std.first_name} lastName={std.last_name} className="w-10 h-10 rounded-2xl ring-2 ring-amber-400 text-[10px]" />
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs text-slate-900 dark:text-white">
                                {`${std.first_name || ''} ${std.last_name || ''}`.trim() || std.name || tr('นักเรียน', 'Student')}
                              </span>
                              {std.name && (std.first_name || std.last_name) && std.name.trim() !== `${std.first_name || ''} ${std.last_name || ''}`.trim() && (
                                <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold px-1.5 py-0.5 bg-emerald-50 dark:bg-emerald-950/60 rounded border border-emerald-200/60 dark:border-emerald-800/60">
                                  LINE: {std.name}
                                </span>
                              )}
                              {std.student_id && (
                                <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                  ID: {std.student_id}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-2 flex-wrap">
                              <span>🏫 {institutionLabel(std.institution, language) || tr('ไม่ระบุสถานศึกษา', 'No institution')}</span>
                              {std.line_uid && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                  <Check className="w-3 h-3" /> LINE Verified
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleAdmitStudent(std.id)}
                            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{tr('อนุมัติ (Admit)', 'Admit')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectStudent(std.id)}
                            className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-600 hover:text-rose-600 dark:text-slate-300 font-semibold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>{tr('ปฏิเสธ', 'Decline')}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* LINE LIFF Invite / LINE Group tabs */}
            {(studentTab === 'line' || studentTab === 'line-group') && (
              <div className={studentTab === 'line' ? '' : 'space-y-5 text-center p-3 sm:p-5'}>
                {/* LINE Group connection for assignment reminders */}
                {studentTab === 'line-group' && (
                <div className="max-w-lg mx-auto w-full text-left p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-black text-slate-900 dark:text-white">{tr('เชื่อมต่อ LINE Group', 'Connect LINE group')}</div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{tr('ใช้กลุ่มนี้ส่งแจ้งเตือนรายชื่อนักเรียนที่ยังไม่ส่งงาน', 'This group receives reminders listing students who haven\'t submitted')}</p>
                    </div>
                    <span className={`shrink-0 px-2 py-1 rounded-full text-[10px] font-black ${lineConnection.status === 'connected' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300' : lineConnection.status === 'waiting' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                      {lineConnection.status === 'connected' ? tr('เชื่อมต่อแล้ว', 'Connected') : lineConnection.status === 'waiting' ? tr('รอยืนยัน', 'Pending') : tr('ยังไม่เชื่อมต่อ', 'Not connected')}
                    </span>
                  </div>

                  {lineConnection.status === 'connected' ? (
                    <p className="text-[11px] text-emerald-800 dark:text-emerald-200 font-semibold">
                      {lineConnection.groupName ? tr(`เชื่อมกับกลุ่ม “${lineConnection.groupName}” แล้ว`, `Connected to “${lineConnection.groupName}”`) : tr('เชื่อมกับกลุ่ม LINE แล้ว', 'Connected to a LINE group')} • {tr('หากนำบอทออก การเชื่อมต่อจะยกเลิกเอง', 'Removing the bot disconnects automatically')}
                    </p>
                  ) : (
                    <LineGroupConnectSteps
                      status={lineConnection.status}
                      botFriend={teacherLineLink.botFriend}
                      addFriendUrl={teacherLineLink.addFriendUrl}
                    />
                  )}

                  <div className="flex flex-wrap gap-2">
                    {lineConnection.status !== 'connected' && (
                      <button type="button" onClick={() => handleLineConnection('create')} disabled={isLineConnectionLoading} className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black disabled:opacity-50">
                        {lineConnection.status === 'waiting' ? tr('เริ่มรอใหม่ (15 นาที)', 'Restart wait (15 min)') : tr('เชื่อม LINE Group', 'Connect LINE group')}
                      </button>
                    )}
                    {lineConnection.status === 'connected' && (
                      <>
                        <button type="button" onClick={() => handleLineConnection('test')} disabled={isLineConnectionLoading} className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black disabled:opacity-50">{tr('ทดสอบส่งข้อความ', 'Send test message')}</button>
                        <button type="button" onClick={() => handleLineConnection('disconnect')} disabled={isLineConnectionLoading} className="px-3 py-1.5 rounded-xl bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-[11px] font-bold disabled:opacity-50">{tr('ยกเลิกการเชื่อมต่อ', 'Disconnect')}</button>
                      </>
                    )}
                  </div>
                </div>
                )}

                {studentTab === 'line' && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2.5">
                    <span className="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <MessageCircle className="w-4.5 h-4.5" />
                    </span>
                    <div className="min-w-0">
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">{t('classroom_mgmt.invite_line_title')}</h4>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{t('classroom_mgmt.invite_line_desc')}</p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3 sm:gap-4">
                    {/* QR Code */}
                    <div className="shrink-0 flex flex-col items-center gap-1">
                      <div className="p-2 bg-white rounded-2xl shadow-xs border border-slate-200">
                        <img
                          src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(getRealLiffUrl(managingClassroom))}`}
                          alt="LINE LIFF QR Code"
                          className="w-32 h-32 object-contain rounded-lg"
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium text-center">
                        {language === 'th' ? 'สแกนด้วยแอป LINE เพื่อเข้าห้องทันที' : 'Scan with LINE to join instantly'}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0 w-full space-y-2">
                      {/* Invite code */}
                      {managingClassroom.invite_code && (
                        <div className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                              {language === 'th' ? 'รหัสเข้าห้องเรียน' : 'Classroom Code'}
                            </div>
                            <div className="text-lg leading-tight font-black font-mono tracking-widest text-slate-900 dark:text-white">
                              {managingClassroom.invite_code}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(managingClassroom.invite_code || '');
                              setIsCopied(true);
                              setTimeout(() => setIsCopied(false), 2000);
                            }}
                            className="shrink-0 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>{isCopied ? t('classroom_mgmt.copied') : (language === 'th' ? 'คัดลอกรหัส' : 'Copy')}</span>
                          </button>
                        </div>
                      )}

                      {/* LIFF URL (full link on hover / select) */}
                      <div
                        className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate select-all"
                        title={getRealLiffUrl(managingClassroom)}
                      >
                        {getRealLiffUrl(managingClassroom)}
                      </div>

                      {/* Actions */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyLiff(managingClassroom)}
                          className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Copy className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{isCopied ? t('classroom_mgmt.copied') : t('classroom_mgmt.copy_liff_link')}</span>
                        </button>
                        <a
                          href={`https://line.me/R/msg/text/?${encodeURIComponent(
                            `${language === 'th' ? 'เข้าร่วมห้องเรียน Pudding' : 'Join Pudding Classroom'}: ${managingClassroom.name} (${courses.find((c) => c.id === managingClassroom.course_id)?.name || managingClassroom.subject_code || ''})\n\n${tr('กดลิงก์นี้ใน LINE', 'Open this link in LINE')}: ${getRealLiffUrl(managingClassroom)}\n${tr('รหัสห้องเรียน', 'Class code')}: ${managingClassroom.invite_code || ''}`
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                        >
                          <Share2 className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{language === 'th' ? 'แชร์เข้าแชท LINE' : 'Share to LINE'}</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(getWebInviteUrl(managingClassroom));
                            setIsCopied(true);
                            setTimeout(() => setIsCopied(false), 2000);
                          }}
                          className="col-span-2 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                          <span>{language === 'th' ? 'คัดลอกลิงก์เว็บตรง' : 'Copy Web Link'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                )}
              </div>
            )}

            </ModalSheetBody>

            {/* Footer Close */}
            <ModalSheetFooter>
              <button
                type="button"
                onClick={() => setManagingClassroom(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                {t('common.close')}
              </button>
            </ModalSheetFooter>
        </ModalSheet>
      )}

      {/* TEACHER PROFILE MODAL (editing; first-time setup is TeacherProfileGate) */}
      {isInstitutionModalOpen && (
        <ModalSheet onClose={() => setIsInstitutionModalOpen(false)} size="sm:max-w-md">
            <ModalSheetHeader>
              <div className="flex items-center gap-2">
                <School className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {language === 'th' ? 'ข้อมูลคุณครู' : 'Teacher Profile'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsInstitutionModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg cursor-pointer"
                aria-label={t('common.cancel')}
              >
                <X className="w-5 h-5" />
              </button>
            </ModalSheetHeader>

            <ModalSheetBody className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {tr(
                  'ชื่อ นามสกุล และสถานศึกษาจะซิงก์กับบัญชีผู้ใช้ (Clerk) อัตโนมัติ',
                  'Your name and institution are synced to your account (Clerk) automatically.'
                )}
              </p>

              <TeacherProfileFields
                firstName={teacherFirstNameInput}
                lastName={teacherLastNameInput}
                institution={teacherInstitutionInput}
                onFirstName={setTeacherFirstNameInput}
                onLastName={setTeacherLastNameInput}
                onInstitution={setTeacherInstitutionInput}
              />

              <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/20 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black text-slate-900 dark:text-white">{tr('บัญชี LINE ของครู', 'Your LINE account')}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">{tr('เชื่อมอัตโนมัติจากการเข้าสู่ระบบด้วย LINE', 'Linked automatically when you sign in with LINE')}</p>
                  </div>
                  <span className={`shrink-0 px-2 py-1 rounded-full text-[10px] font-black ${teacherLineLink.status === 'connected' ? 'bg-emerald-200 text-emerald-800' : teacherLineLink.status === 'loading' ? 'bg-white text-slate-400' : 'bg-rose-100 text-rose-700'}`}>
                    {teacherLineLink.status === 'connected' ? tr('เชื่อมแล้ว', 'Connected') : teacherLineLink.status === 'loading' ? tr('กำลังตรวจสอบ...', 'Checking...') : tr('ยังไม่เชื่อม', 'Not connected')}
                  </span>
                </div>
                {teacherLineLink.status === 'missing_line' && (
                  <p className="text-[11px] text-rose-700 dark:text-rose-300">{tr('บัญชีนี้ไม่ได้เข้าสู่ระบบด้วย LINE กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่ด้วย LINE', 'This account did not sign in with LINE. Sign out and sign in again with LINE.')}</p>
                )}
                {teacherLineLink.status === 'previous_account' && (
                  <p className="text-[11px] text-rose-700 dark:text-rose-300">{tr('พบบัญชีครูเดิมที่ใช้อีเมลเดียวกัน (สมัครก่อนเปลี่ยนมาใช้ LINE) ข้อมูลวิชาและห้องเรียนยังอยู่ที่บัญชีเดิม กรุณาให้ผู้ดูแลระบบรวมบัญชี', 'An older teacher account uses the same email (created before LINE sign-in). Its courses and classrooms are still there; ask an admin to merge the accounts.')}</p>
                )}
                {teacherLineLink.status === 'error' && (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] text-rose-700 dark:text-rose-300">{tr('ตรวจสอบสถานะ LINE ไม่สำเร็จ', 'Could not check LINE status')}</p>
                    <button type="button" onClick={loadTeacherLineLink} className="shrink-0 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900 text-[11px] font-bold text-rose-700 dark:text-rose-300 cursor-pointer">
                      {tr('ลองใหม่', 'Retry')}
                    </button>
                  </div>
                )}
                {teacherLineLink.status === 'conflict' && (
                  <p className="text-[11px] text-rose-700 dark:text-rose-300">{tr('บัญชี LINE นี้เชื่อมกับบัญชีครูอีกบัญชีใน Pudding อยู่แล้ว กรุณาเข้าสู่ระบบด้วยบัญชีนั้น หรือติดต่อผู้ดูแลระบบ', 'This LINE account is already linked to another Pudding teacher account. Sign in with that account or contact an admin.')}</p>
                )}
                {teacherLineLink.status === 'connected' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] text-slate-600 dark:text-slate-300">
                      Pudding Bot:{' '}
                      <b>
                        {teacherLineLink.botFriend === true
                          ? tr('เป็นเพื่อนแล้ว ✅', 'Friends ✅')
                          : teacherLineLink.botFriend === false
                            ? tr('ยังไม่ได้เพิ่มเพื่อน', 'Not added as a friend')
                            : tr('ตรวจสอบสถานะไม่ได้ในขณะนี้', 'Status unavailable right now')}
                      </b>
                    </span>
                    {teacherLineLink.botFriend !== true && (
                      <div className="flex items-center gap-1.5">
                        {teacherLineLink.addFriendUrl && (
                          <a
                            href={teacherLineLink.addFriendUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 px-3 py-1.5 rounded-xl bg-[#06C755] hover:bg-[#05b34c] text-white text-[11px] font-black"
                          >
                            {tr('+ เพิ่มเพื่อน Pudding Bot', '+ Add Pudding Bot as a friend')}
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={loadTeacherLineLink}
                          className="shrink-0 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 cursor-pointer"
                        >
                          {tr('ตรวจสอบอีกครั้ง', 'Check again')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </ModalSheetBody>

            {/* Footer */}
            <ModalSheetFooter>
              <button
                type="button"
                onClick={() => setIsInstitutionModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={!teacherFirstNameInput.trim() || !teacherLastNameInput.trim() || !teacherInstitutionInput.trim()}
                onClick={handleSaveTeacherProfile}
                className="px-4 py-2 text-xs rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold shadow-xs cursor-pointer disabled:opacity-50 transition-colors active:scale-[0.98]"
              >
                {t('common.save')}
              </button>
            </ModalSheetFooter>
        </ModalSheet>
      )}
    </div>
  );
}
