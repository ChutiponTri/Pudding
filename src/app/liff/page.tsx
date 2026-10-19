"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  CheckCircle2,
  Clock,
  Upload,
  ChevronRight,
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  Send,
  PlusCircle,
  Plus,
  BookOpen,
  LogOut,
  LogIn,
  AlertCircle,
  Loader2,
  Sparkles,
  Edit2,
  School,
  Megaphone,
  CalendarDays,
  CalendarCheck,
  Layers,
} from "lucide-react";
import { dataService } from "@/lib/supabase/dataService";
import { Classroom, Assignment, Question, Submission, SubmissionAnswer } from "@/types/database";
import { InstitutionSearchSelect } from "@/components/InstitutionSearchSelect";
import { getDefaultAcademicPeriod } from "@/lib/utils/academicYear";
import { getAssignmentWindow } from "@/lib/utils/assignmentWindow";
import { TRUE_FALSE_OPTIONS } from "@/lib/utils/trueFalse";

interface RealLineStudent {
  id: string; // LINE userId
  name: string; // LINE displayName
  first_name?: string;
  last_name?: string;
  line_uid: string;
  avatar: string;
  student_id?: string;
  institution?: string;
  email?: string;
}

interface ClassroomPost {
  id: string;
  body: string;
  created_at: string;
  activity_type?: "announcement" | "assignment" | "exam" | "attendance";
  metadata?: { assignmentId?: string; groupName?: string };
}
type AttendanceStatus = "on_time" | "late" | "absent" | "excused" | "idle";
const statusLabels: Record<string, string> = {
  on_time: "มาตรงเวลา 🟢",
  late: "มาสาย 🟡",
  absent: "ขาด 🔴",
  excused: "ลา 🔵",
  idle: "รอเช็คชื่อ (IDLE) ⚪",
};

// ---------------------------------------------------------------------------
// Presentation helpers (styling only; no data logic)
// ---------------------------------------------------------------------------

/** Width of the LIFF column. Fixed bars use it so they line up with the page on iPad/desktop. */
const FRAME = "max-w-md md:max-w-2xl lg:max-w-3xl";
const CARD = "rounded-3xl bg-white dark:bg-slate-900 ring-1 ring-slate-200/70 dark:ring-slate-800 shadow-sm shadow-slate-900/[0.03]";
const INPUT = "w-full h-12 px-3.5 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-50 dark:bg-slate-800/70 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:ring-2 focus:ring-line focus:bg-white dark:focus:bg-slate-900 outline-none transition-all";

type Tone = "emerald" | "amber" | "rose" | "sky" | "violet" | "slate";
const TONE_CLASSES: Record<Tone, string> = {
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  rose: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  slate: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};
const ATTENDANCE_TONE: Record<string, Tone> = { on_time: "emerald", late: "amber", absent: "rose", excused: "sky", idle: "slate" };
const ATTENDANCE_SHORT: Record<string, string> = { on_time: "ตรงเวลา", late: "มาสาย", absent: "ขาด", excused: "ลา", idle: "รอเช็คชื่อ" };
const TIMELINE_DOT: Record<string, string> = {
  announcement: "bg-amber-400 ring-amber-100 dark:ring-amber-950",
  assignment: "bg-line ring-emerald-100 dark:ring-emerald-950",
  exam: "bg-violet-500 ring-violet-100 dark:ring-violet-950",
  attendance: "bg-sky-500 ring-sky-100 dark:ring-sky-950",
};

/** "เหลือ 2 วัน 3 ชม." style countdown for a deadline timestamp. */
function formatTimeLeft(deadline: number | null): string {
  if (!deadline) return "ไม่มีกำหนดส่ง";
  const minutes = Math.ceil((deadline - Date.now()) / 60000);
  if (minutes <= 0) return "เลยกำหนดส่ง";
  if (minutes < 60) return `เหลือ ${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `เหลือ ${hours} ชม. ${minutes % 60} นาที`;
  const days = Math.floor(hours / 24);
  return days < 14 ? `เหลือ ${days} วัน ${hours % 24} ชม.` : `ส่งภายใน ${new Date(deadline).toLocaleDateString("th-TH", { dateStyle: "medium" })}`;
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap px-2.5 py-1 rounded-full text-[11px] font-bold ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

function SectionTitle({ icon, title, count, action }: { icon: React.ReactNode; title: string; count?: number; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 min-w-0">
        {icon}
        <span className="truncate">{title}</span>
        {count !== undefined && <span className="text-xs font-semibold text-slate-400 tabular-nums">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="py-10 px-6 text-center space-y-2">
      <div className="text-3xl">{icon}</div>
      <p className="text-sm text-slate-500">{text}</p>
    </div>
  );
}

const SHORTCUT_TONES = {
  violet: { badge: "violet", button: "bg-violet-600 hover:bg-violet-700 text-white" },
  amber: { badge: "amber", button: "bg-amber-500 hover:bg-amber-400 text-amber-950" },
  rose: { badge: "rose", button: "bg-rose-600 hover:bg-rose-700 text-white" },
} as const;

function WorkShortcut({ tone, badge, title, meta, action, onClick }: {
  tone: keyof typeof SHORTCUT_TONES; badge: string; title: string; meta: string; action: string; onClick: () => void;
}) {
  return (
    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 ring-1 ring-slate-200/70 dark:ring-slate-700/60 flex items-center justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <Pill tone={SHORTCUT_TONES[tone].badge}>{badge}</Pill>
        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{title}</p>
        <p className="text-xs text-slate-500 truncate">{meta}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        className={`h-10 px-4 rounded-xl font-bold text-sm shrink-0 cursor-pointer shadow-sm transition-transform active:scale-95 ${SHORTCUT_TONES[tone].button}`}
      >
        {action}
      </button>
    </div>
  );
}

/** Bottom sheet on phones, centered dialog from sm up. */
function Sheet({ children, onClose, size = "md" }: { children: React.ReactNode; onClose?: () => void; size?: "sm" | "md" }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4 animate-in fade-in"
      onClick={(e) => {
        if (onClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${size === "sm" ? "sm:max-w-sm" : "sm:max-w-md"} max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 p-5 sm:p-6 pb-[max(env(safe-area-inset-bottom),1.25rem)] shadow-2xl space-y-5 animate-in slide-in-from-bottom-5`}
      >
        <div className="sm:hidden mx-auto -mt-1 mb-1 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
        {children}
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          {label} {required && <span className="text-rose-500">*</span>}
        </span>
        {hint && <span className="text-[11px] text-slate-400 text-right">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export default function LiffStudentPage() {
  // LINE LIFF & Auth State
  const [liffId, setLiffId] = useState<string>("");
  const [authStatus, setAuthStatus] = useState<"loading" | "unauthenticated" | "authenticated" | "error">("loading");
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
  const [isInLineClient, setIsInLineClient] = useState(false);
  const [liffInstance, setLiffInstance] = useState<any>(null);
  const [currentStudent, setCurrentStudent] = useState<RealLineStudent | null>(null);

  // Student Profile First-time Prompt & Edit State
  const [isStudentIdModalOpen, setIsStudentIdModalOpen] = useState(false);
  const [isFirstTimeStudentId, setIsFirstTimeStudentId] = useState(false);
  const [inputFirstName, setInputFirstName] = useState("");
  const [inputLastName, setInputLastName] = useState("");
  const [inputStudentId, setInputStudentId] = useState("");
  const [inputInstitution, setInputInstitution] = useState("");
  const [inputEmail, setInputEmail] = useState("");
  const [isSavingStudentId, setIsSavingStudentId] = useState(false);

  // Data State
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  // Submissions whose every answer has a teacher score (grading finished).
  const [gradedSubmissionIds, setGradedSubmissionIds] = useState<Set<string>>(new Set());
  // Results the student has already opened: submission id -> score they saw.
  // Kept per device; a re-grade with a new score is announced again.
  const [seenScores, setSeenScores] = useState<Record<string, number>>({});
  const [registeredInstitutions, setRegisteredInstitutions] = useState<string[]>([]);
  const [classroomPosts, setClassroomPosts] = useState<ClassroomPost[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  // Background refreshes read these refs so they never reset what the student
  // is currently looking at.
  const selectedClassroomIdRef = useRef<string | null>(null);
  const enrolledClassroomIdsRef = useRef<Set<string>>(new Set());
  const currentAcademicPeriod = useMemo(() => getDefaultAcademicPeriod(), []);
  const [studentPortalTab, setStudentPortalTab] = useState<"overview" | "courses" | "course">("overview");
  const [courseTab, setCourseTab] = useState<"timeline" | "work" | "attendance">("timeline");
  const [courseAttendance, setCourseAttendance] = useState<{ id: string; title: string; starts_at: string; status: string }[]>([]);
  const [courseAttendanceRecords, setCourseAttendanceRecords] = useState<Record<string, string>>({});
  const [selectedTermKey, setSelectedTermKey] = useState("current");

  const loadClassroomPosts = async (classroom: Classroom | null, lineUid: string) => {
    if (!classroom) {
      setClassroomPosts([]);
      setCourseAttendance([]);
      setCourseAttendanceRecords({});
      return;
    }
    try {
      const [response, attendanceResponse] = await Promise.all([
        fetch(`/api/classrooms/posts?classroomId=${encodeURIComponent(classroom.id)}&lineUid=${encodeURIComponent(lineUid)}`, { cache: "no-store" }),
        fetch(`/api/attendance?classroomId=${encodeURIComponent(classroom.id)}&lineUid=${encodeURIComponent(lineUid)}`, { cache: "no-store" }),
      ]);
      const [posts, attendance] = await Promise.all([
        response.ok ? response.json() : Promise.resolve({ posts: [] }),
        attendanceResponse.ok ? attendanceResponse.json() : Promise.resolve(null),
      ]);
      setClassroomPosts(posts.posts || []);
      if (attendance) {
        setCourseAttendance(attendance.sessions || []);
        setCourseAttendanceRecords(Object.fromEntries((attendance.records || []).map((record: { session_id: string; status: string }) => [record.session_id, record.status])));
      }
    } catch (error) {
      console.warn("Failed to load classroom posts:", error);
    }
  };

  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [activeAttendanceList, setActiveAttendanceList] = useState<
    Array<{
      classroom: Classroom;
      session: { id: string; title: string; starts_at: string; on_time_until_minutes?: number; late_until_minutes?: number };
      checkedIn: boolean;
      status?: string;
    }>
  >([]);
  const [isHomeworkListOpen, setIsHomeworkListOpen] = useState(true);

  // Load active open attendance sessions across all classrooms for Overview shortcuts
  const loadAllActiveAttendance = async (classList: Classroom[], lineUid: string) => {
    if (!classList.length || !lineUid) {
      setActiveAttendanceList([]);
      return;
    }
    try {
      // One request for every classroom instead of one request per classroom.
      const res = await fetch(
        `/api/attendance?classroomIds=${encodeURIComponent(classList.map((cls) => cls.id).join(","))}&lineUid=${encodeURIComponent(lineUid)}`,
        { cache: "no-store" }
      );
      if (!res.ok) return;
      const { byClassroom = {} } = await res.json();
      const results = classList.flatMap((cls) => {
        const data = byClassroom[cls.id] || { sessions: [], records: [] };
        const recordsMap = Object.fromEntries(
          (data.records || []).map((r: any) => [r.session_id, r.status])
        );
        // Overview is an action list: once this student has a record for
        // the session, remove it from the shortcut list. The attendance
        // tab still loads the full session history separately.
        return (data.sessions || []).filter((s: any) => s.status === "open" && !recordsMap[s.id]).map((s: any) => ({
          classroom: cls,
          session: s,
          checkedIn: false,
          status: undefined,
        }));
      });
      setActiveAttendanceList(results);
    } catch (err) {
      console.warn("Failed to load active attendance sessions:", err);
    }
  };

  const handleStudentCheckIn = async (sessionId?: string, customClassroomId?: string) => {
    const targetClassroomId = customClassroomId || selectedClassroom?.id;
    if (!targetClassroomId || !currentStudent) return;
    setIsCheckingIn(true);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "check_in",
          classroomId: targetClassroomId,
          sessionId: sessionId || undefined,
          lineUid: currentStudent.line_uid,
          studentId: currentStudent.student_id || currentStudent.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || "เช็คชื่อไม่สำเร็จ");
        return;
      }
      const statusText = statusLabels[json.status] || json.status;
      alert(json.alreadyCheckedIn ? `คุณเช็คชื่อคาบนี้ไปแล้ว สถานะ: ${statusText}` : `เช็คชื่อสำเร็จ! สถานะของคุณ: ${statusText}`);

      // Update the UI from the response right away instead of re-fetching
      // attendance for every classroom.
      const checkedSessionId = json.session?.id || sessionId;
      if (checkedSessionId) {
        setActiveAttendanceList((prev) => prev.filter((item) => item.session.id !== checkedSessionId));
        if (selectedClassroom?.id === targetClassroomId) {
          setCourseAttendanceRecords((prev) => ({ ...prev, [checkedSessionId]: json.status }));
        }
      }

      // Realtime Broadcast across browser windows
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("pudding-attendance-checked", { detail: { classroomId: targetClassroomId, status: json.status } }));
        if ("BroadcastChannel" in window) {
          const bc = new BroadcastChannel("pudding-realtime");
          bc.postMessage({ type: "attendance_checked", classroomId: targetClassroomId, status: json.status });
          bc.close();
        }
      }

    } catch {
      alert("เกิดข้อผิดพลาดในการเช็คชื่อ");
    } finally {
      setIsCheckingIn(false);
    }
  };

  // Classroom Admission Security: Check if student is pending approval in selected classroom
  const isSelectedClassroomPending = useMemo(() => {
    if (!selectedClassroom || !currentStudent) return false;
    const isEnrolled = selectedClassroom.students?.some(
      (s) => s.id === currentStudent.id || s.line_uid === currentStudent.line_uid
    );
    const isPending = selectedClassroom.pending_students?.some(
      (s) => s.id === currentStudent.id || s.line_uid === currentStudent.line_uid
    );
    return Boolean(isPending && !isEnrolled);
  }, [selectedClassroom, currentStudent]);

  // Active Assignment/Exam State
  const [activeAssignment, setActiveAssignment] = useState<Assignment | null>(null);
  const [activeQuestions, setActiveQuestions] = useState<Question[]>([]);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);
  const [studentAnswers, setStudentAnswers] = useState<Record<string, { text: string; file_url?: string }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState(false);
  const [uploadingQuestionId, setUploadingQuestionId] = useState<string | null>(null);

  // Anti-Cheating Tracking State ("ตรวจจับเวลาแอบกดออกจอ")
  const [tabSwitchCount, setTabSwitchCount] = useState<number>(0);
  const [totalAwaySeconds, setTotalAwaySeconds] = useState<number>(0);
  const [awayWarningToast, setAwayWarningToast] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<
    Array<{
      event_type: "tab_hidden" | "window_blur" | "tab_visible" | "window_focus";
      timestamp: string;
      duration_seconds: number;
      details?: string;
    }>
  >([]);
  const awayStartRef = useRef<number | null>(null);
  const tabSwitchCountRef = useRef(0);



  // Join Classroom Code Modal
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [joinInviteCode, setJoinInviteCode] = useState("");
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const processedEnrollRef = useRef<string | null>(null);
  // Deep link from a LINE message (?assignmentId=…, ?view=attendance), applied
  // once the student's classrooms, work and submissions have loaded.
  const pendingDeepLinkRef = useRef<{ assignmentId?: string; view?: "timeline" | "work" | "attendance" } | null>(null);

  // Graded Detail Modal
  const [viewingGradedSub, setViewingGradedSub] = useState<{
    assignment: Assignment;
    submission: Submission;
    questions: Question[];
    answers: Record<string, SubmissionAnswer>;
  } | null>(null);

  // 1. Initialize LIFF SDK & Enforce Authentication
  useEffect(() => {
    let isMounted = true;

    async function initLiff() {
      setAuthStatus("loading");
      setAuthErrorMessage(null);

      try {
        const res = await fetch("/api/liff/config");
        const config = await res.json();
        const id = config.liffId || process.env.NEXT_PUBLIC_LINE_LIFF_ID || "";

        if (!isMounted) return;
        setLiffId(id);

        if (!id) {
          throw new Error("ไม่พบ LINE_LIFF_ID ในระบบ กรุณาตรวจสอบการตั้งค่า .env");
        }

        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId: id });

        if (!isMounted) return;
        setLiffInstance(liff);

        const inClient = liff.isInClient();
        setIsInLineClient(inClient);

        // Check if user is logged in
        if (!liff.isLoggedIn()) {
          const explicitlyLoggedOut = typeof window !== "undefined" && sessionStorage.getItem("pudding_liff_logged_out") === "true";

          if (inClient) {
            liff.login();
            return;
          } else if (!explicitlyLoggedOut) {
            liff.login({ redirectUri: window.location.href });
            return;
          }

          setAuthStatus("unauthenticated");
          return;
        }

        // Successfully Logged In: Retrieve real LINE user profile
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("pudding_liff_logged_out");
        }

        const profile = await liff.getProfile();

        // Real sync of LINE profile into Supabase users table
        const syncedUser = await dataService.syncLineStudentUser({
          line_uid: profile.userId,
          name: profile.displayName || "นักเรียน LINE",
          avatar: profile.pictureUrl || null,
        });

        const activeStudentId = syncedUser.student_id;
        const realStudent: RealLineStudent = {
          id: syncedUser.id,
          name: profile.displayName || "นักเรียน LINE",
          first_name: syncedUser.first_name,
          last_name: syncedUser.last_name,
          line_uid: profile.userId,
          avatar: profile.pictureUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120",
          student_id: activeStudentId,
          institution: syncedUser.institution,
          email: syncedUser.email,
        };

        if (!isMounted) return;
        setCurrentStudent(realStudent);
        setAuthStatus("authenticated");

        // Check if onboarding profile is needed (missing real name, valid student id >= 3 chars, or institution)
        const needsProfileSetup =
          !activeStudentId ||
          activeStudentId.length < 3 ||
          !syncedUser.first_name ||
          syncedUser.first_name === "นักเรียน" ||
          !syncedUser.last_name ||
          !syncedUser.institution;

        if (needsProfileSetup) {
          setInputFirstName(syncedUser.first_name && syncedUser.first_name !== "นักเรียน" ? syncedUser.first_name : "");
          setInputLastName(syncedUser.last_name || "");
          setInputStudentId(activeStudentId && !activeStudentId.startsWith("U") ? activeStudentId : "");
          setInputInstitution(syncedUser.institution || "");
          setInputEmail(syncedUser.email || "");
          setIsFirstTimeStudentId(true);
          setIsStudentIdModalOpen(true);
        }
      } catch (err: any) {
        console.error("LIFF initialization error:", err);
        if (isMounted) {
          setAuthErrorMessage(err?.message || "ไม่สามารถเชื่อมต่อ LINE LIFF ได้");
          setAuthStatus("error");
        }
      }
    }

    initLiff();

    return () => {
      isMounted = false;
    };
  }, []);

  // Trigger LINE Login
  const handleLineLogin = () => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("pudding_liff_logged_out");
    }
    if (liffInstance) {
      liffInstance.login({ redirectUri: window.location.href });
    } else {
      window.location.reload();
    }
  };

  // Logout from LINE LIFF
  const handleLineLogout = () => {
    if (confirm("ต้องการออกจากระบบ LINE LIFF หรือไม่?")) {
      if (typeof window !== "undefined") {
        sessionStorage.setItem("pudding_liff_logged_out", "true");
      }
      if (liffInstance && liffInstance.isLoggedIn()) {
        liffInstance.logout();
      }
      setCurrentStudent(null);
      setAuthStatus("unauthenticated");
    }
  };

  // Save Student Profile (First-time or Edited)
  const handleSaveStudentId = async () => {
    const fn = inputFirstName.trim();
    const ln = inputLastName.trim();
    const sid = inputStudentId.trim();
    const inst = inputInstitution.trim();
    const email = inputEmail.trim();

    if (!fn || !ln || sid.length < 3 || !inst || !currentStudent) {
      alert("กรุณาระบุข้อมูลให้ครบถ้วน: ชื่อจริง นามสกุล รหัสนักเรียน (ขั้นต่ำ 3 หลัก) และเลือกสถานศึกษา");
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert("กรุณาระบุอีเมลให้ถูกต้อง หรือเว้นว่างไว้ได้");
      return;
    }

    setIsSavingStudentId(true);
    try {
      const ok = await dataService.updateStudentProfile(currentStudent.id, {
        first_name: fn,
        last_name: ln,
        student_id: sid,
        institution: inst,
        email: email || null,
      });

      if (ok) {
        setCurrentStudent((prev) =>
          prev
            ? {
                ...prev,
                first_name: fn,
                last_name: ln,
                student_id: sid,
                institution: inst,
                email: email || undefined,
              }
            : null
        );
        setIsStudentIdModalOpen(false);
        setIsFirstTimeStudentId(false);
        setJoinMessage("✅ บันทึกข้อมูลนักเรียนเรียบร้อยแล้ว");
        setTimeout(() => setJoinMessage(null), 3000);
      } else {
        alert("ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง");
      }
    } catch (err) {
      console.error("Failed to save student profile:", err);
      alert("เกิดข้อผิดพลาดในการบันทึกข้อมูลนักเรียน");
    } finally {
      setIsSavingStudentId(false);
    }
  };

  // 2. Load Classrooms, Assignments, and Submissions for Authenticated Student
  useEffect(() => {
    if (authStatus !== "authenticated" || !currentStudent) return;

    let loadSeq = 0;
    async function loadData(isInitial: boolean) {
      if (!currentStudent) return;
      const seq = ++loadSeq;
      if (isInitial) setIsLoadingData(true);
      try {
        const [allClasses, institutions, allAssigns] = await Promise.all([
          dataService.getClassrooms(),
          dataService.getRegisteredInstitutions(),
          dataService.getAssignments(),
        ]);
        setRegisteredInstitutions(institutions);

        // Check URL params for invite code or classId
        const params = new URLSearchParams(window.location.search);
        const codeParam = params.get("code");
        const classIdParam = params.get("classId");
        if (isInitial) {
          const assignmentParam = params.get("assignmentId") || undefined;
          const viewParam = params.get("view");
          const view = viewParam === "attendance" || viewParam === "work" || viewParam === "timeline" ? viewParam : undefined;
          if (assignmentParam || view) pendingDeepLinkRef.current = { assignmentId: assignmentParam, view };
        }

        // Filter ONLY classrooms that this student has actually enrolled in
        let enrolled = allClasses.filter((c) =>
          c.students?.some((s) => s.id === currentStudent.id || s.line_uid === currentStudent.line_uid) ||
          c.pending_students?.some((s) => s.id === currentStudent.id || s.line_uid === currentStudent.line_uid)
        );

        // Default to Overview (null) unless a specific class was requested via URL
        // link. Background refreshes keep the classroom the student has open.
        let active: Classroom | null = isInitial
          ? null
          : enrolled.find((c) => c.id === selectedClassroomIdRef.current) || null;

        // Auto-enroll if arrived via invite code or classId link (deduplicated)
        if (codeParam || classIdParam) {
          const enrollKey = `${currentStudent.line_uid || currentStudent.id}_${codeParam || classIdParam}`;
          if (processedEnrollRef.current !== enrollKey) {
            processedEnrollRef.current = enrollKey;

            const matched = allClasses.find(
              (c) =>
                (classIdParam && c.id === classIdParam) ||
                (codeParam && c.invite_code?.toLowerCase() === codeParam.toLowerCase())
            );
            if (matched) {
              const firstName = currentStudent.first_name || currentStudent.name.split(" ")[0] || "นักเรียน";
              const lastName = currentStudent.last_name || currentStudent.name.split(" ").slice(1).join(" ") || "";
              const isAlreadyActive = matched.students?.some(
                (s) => s.id === currentStudent.id || s.line_uid === currentStudent.line_uid
              );
              const isAlreadyPending = matched.pending_students?.some(
                (s) => s.id === currentStudent.id || s.line_uid === currentStudent.line_uid
              );

              if (isAlreadyActive) {
                setJoinMessage(`🎉 คุณอยู่ในห้องเรียน "${matched.name}" เรียบร้อยแล้ว!`);
              } else if (isAlreadyPending) {
                setJoinMessage(`🎉 ส่งคำขอเข้าร่วมห้องเรียน "${matched.name}" เรียบร้อยแล้ว (รอคุณครูอนุมัติ Admit)`);
              } else {
                await dataService.addStudentToClassroom(
                  matched.id,
                  {
                    id: currentStudent.line_uid,
                    first_name: firstName,
                    last_name: lastName,
                    student_id: currentStudent.student_id,
                    institution: currentStudent.institution,
                    email: currentStudent.email,
                    avatar_url: currentStudent.avatar,
                    line_uid: currentStudent.line_uid,
                  },
                  { autoAdmit: false }
                );
                setJoinMessage(`🎉 ส่งคำขอเข้าร่วมห้องเรียน "${matched.name}" เรียบร้อยแล้ว (รอคุณครูอนุมัติ Admit)`);
              }

              active = matched;
              if (!enrolled.some((c) => c.id === matched.id)) {
                enrolled = [matched, ...enrolled];
              }
            }

            // Clean up URL parameters so subsequent sync events or reloads don't loop
            try {
              const cleanUrl = new URL(window.location.href);
              cleanUrl.searchParams.delete("code");
              cleanUrl.searchParams.delete("classId");
              cleanUrl.searchParams.delete("assignmentId");
              cleanUrl.searchParams.delete("view");
              window.history.replaceState({}, "", cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : ""));
            } catch {}
          }
        }

        // Single-beat unified data loading: filter assignments and load student submissions together
        const enrolledClassIds = new Set(enrolled.map((c) => c.id));
        const relevantAssigns = (allAssigns || []).filter((a) => a && enrolledClassIds.has(a.classroom_id));

        // Fetch all submission statuses in one request. The old per-assignment
        // loop caused N API calls (and another direct DB call per assignment).
        const allSubmissions = await dataService.getSubmissionsByAssignmentIds(
          relevantAssigns.map((assignment) => assignment.id)
        );
        const subMap: Record<string, Submission> = {};
        for (const submission of allSubmissions) {
          const found =
            submission.student_id === currentStudent.id ||
            submission.student_id === currentStudent.line_uid ||
            (currentStudent.student_id && submission.student_id === currentStudent.student_id);
          if (found && !subMap[submission.assignment_id]) {
            subMap[submission.assignment_id] = submission;
          }
        }

        // A newer refresh already started; drop this stale result.
        // Grading is finished only when every answer has a teacher score; a
        // running total alone may be partial (objective items auto-scored).
        const studentSubmissions = Object.values(subMap);
        const answerRows = await dataService.getAnswersForSubmissions(studentSubmissions.map((submission) => submission.id));
        const answersBySubmission = new Map<string, SubmissionAnswer[]>();
        for (const row of answerRows) {
          const list = answersBySubmission.get(row.submission_id) || [];
          list.push(row);
          answersBySubmission.set(row.submission_id, list);
        }
        const graded = new Set(
          studentSubmissions
            .filter((submission) => {
              const rows = answersBySubmission.get(submission.id) || [];
              return submission.total_score != null && rows.length > 0 && rows.every((row) => row.teacher_score != null);
            })
            .map((submission) => submission.id)
        );

        if (seq !== loadSeq) return;

        // Batch all state updates in one single beat
        enrolledClassroomIdsRef.current = new Set(enrolled.map((c) => c.id));
        setClassrooms(enrolled);
        setSelectedClassroom(active);
        setAssignments(relevantAssigns);
        setSubmissions(subMap);
        setGradedSubmissionIds(graded);
        if (currentStudent.line_uid) {
          loadAllActiveAttendance(enrolled, currentStudent.line_uid);
        }
      } catch (err) {
        console.error("Failed to load student data:", err);
      } finally {
        if (isInitial && seq === loadSeq) setIsLoadingData(false);
      }
    }

    loadData(true);

    // Real-time synchronization: auto-refresh when the teacher admits the student.
    // Realtime and polling often fire together, so coalesce bursts into one
    // reload and ignore changes to classrooms this student is not part of.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = dataService.subscribeToClassroomChanges(
      undefined,
      (event: any) => {
        const changedClassroomId = event?.detail?.classroomId || event?.payload?.new?.id || event?.payload?.new?.classroom_id;
        const changedStudent = event?.detail?.student;
        const isAboutMe = changedStudent && (changedStudent.id === currentStudent.id || changedStudent.line_uid === currentStudent.line_uid);
        if (changedClassroomId && !isAboutMe && !enrolledClassroomIdsRef.current.has(changedClassroomId)) return;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => loadData(false), 800);
      },
      { pollIntervalMs: 10000 }
    );
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsub();
    };
  }, [authStatus, currentStudent?.id, currentStudent?.student_id]);

  useEffect(() => {
    selectedClassroomIdRef.current = selectedClassroom?.id || null;
    if (currentStudent?.line_uid) loadClassroomPosts(selectedClassroom, currentStudent.line_uid);
  }, [selectedClassroom?.id, currentStudent?.line_uid]);

  // When opening an assignment, fetch questions (Protected by admission gate)
  const handleOpenAssignment = async (a: Assignment) => {
    // Check the assignment's own classroom: shortcuts on the overview open
    // work before selectedClassroom has updated.
    const assignmentClassroom = classrooms.find((c) => c.id === a.classroom_id);
    const isPendingHere = Boolean(
      assignmentClassroom &&
      currentStudent &&
      assignmentClassroom.pending_students?.some((s) => s.id === currentStudent.id || s.line_uid === currentStudent.line_uid) &&
      !assignmentClassroom.students?.some((s) => s.id === currentStudent.id || s.line_uid === currentStudent.line_uid)
    );
    if (isPendingHere || isSelectedClassroomPending) {
      alert("กรุณารอคุณครูอนุมัติเข้าห้องเรียน (Admit) ก่อนเริ่มต้นทำข้อสอบหรือการบ้าน");
      return;
    }
    const openWindow = getAssignmentWindow(a);
    if (!openWindow.acceptsSubmissions) {
      alert(openWindow.isQuizClosed ? "หมดเวลาทำข้อสอบนี้แล้ว" : "คุณครูปิดรับงานนี้แล้ว ไม่สามารถส่งได้");
      return;
    }
    setStudentAnswers({});
    setSubmissionSuccess(false);
    setActiveQuestions([]);
    setActiveAssignment(a);
    setIsLoadingQuestions(true);
    try {
      // One data-service call loads the assignment and its questions together.
      const { questions } = await dataService.getAssignmentById(a.id);
      setActiveQuestions(questions);
    } catch (error) {
      console.error("Failed to load assignment questions:", error);
      setActiveAssignment(null);
      alert("ไม่สามารถโหลดข้อสอบได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsLoadingQuestions(false);
    }
  };

  // 3. Real-Time Anti-Cheating Listener ("ตรวจจับเวลาแอบกดออกจอ")
  useEffect(() => {
    if (!activeAssignment) return;

    setTabSwitchCount(0);
    tabSwitchCountRef.current = 0;
    setTotalAwaySeconds(0);
    setAuditEvents([]);
    awayStartRef.current = null;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        awayStartRef.current = Date.now();
        setTabSwitchCount((prev) => {
          tabSwitchCountRef.current = prev + 1;
          return prev + 1;
        });

        const newEvent = {
          event_type: "tab_hidden" as const,
          timestamp: new Date().toISOString(),
          duration_seconds: 0,
          details: "นักเรียนสลับหน้าจอ หรือออกจากแอป LINE",
        };
        setAuditEvents((prev) => [...prev, newEvent]);
      } else {
        if (awayStartRef.current) {
          const durationSec = Math.max(1, Math.round((Date.now() - awayStartRef.current) / 1000));
          setTotalAwaySeconds((prev) => prev + durationSec);

          setAuditEvents((prev) => {
            const copy = [...prev];
            if (copy.length > 0) {
              copy[copy.length - 1].duration_seconds = durationSec;
            }
            return copy;
          });

          setAwayWarningToast(
            `⚠️ ตรวจพบการออกจากหน้าจอเป็นเวลา ${durationSec} วินาที (ครั้งที่ ${tabSwitchCountRef.current}) — ระบบจะแนบรายงานให้อาจารย์เมื่อส่งคำตอบ`
          );
          setTimeout(() => setAwayWarningToast(null), 5000);
          awayStartRef.current = null;
        }
      }
    };

    const handleBlur = () => {
      if (!awayStartRef.current) {
        awayStartRef.current = Date.now();
        setAuditEvents((prev) => [
          ...prev,
          {
            event_type: "window_blur" as const,
            timestamp: new Date().toISOString(),
            duration_seconds: 0,
            details: "หน้าต่างเสียการโฟกัส (Window blur)",
          },
        ]);
      }
    };

    const handleFocus = () => {
      if (awayStartRef.current && !document.hidden) {
        const durationSec = Math.max(1, Math.round((Date.now() - awayStartRef.current) / 1000));
        setTotalAwaySeconds((prev) => prev + durationSec);
        awayStartRef.current = null;
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, [activeAssignment]);



  // Image / File Upload Handler
  const handleFileUpload = async (questionId: string, file: File) => {
    if (!currentStudent) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("assignment_id", activeAssignment?.id || "general");
      formData.append("student_id", currentStudent.student_id || currentStudent.id);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) {
        alert(json.error || "อัปโหลดไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        return;
      }
      setStudentAnswers((prev) => ({
        ...prev,
        [questionId]: {
          text: prev[questionId]?.text || `ส่งไฟล์แนบ: ${file.name}`,
          file_url: json.url,
        },
      }));
    } catch (err) {
      alert("เกิดข้อผิดพลาดในการอัปโหลดไฟล์");
    }
  };

  // Submit Assignment with Real LINE Student Identity & Anti-Cheating Audit
  const handleSubmitTask = async () => {
    if (!activeAssignment || !currentStudent) return;

    setIsSubmitting(true);
    try {
      const currentAwaySeconds = awayStartRef.current
        ? Math.max(1, Math.round((Date.now() - awayStartRef.current) / 1000))
        : 0;
      const answersPayload = activeQuestions.map((q) => ({
        question_id: q.id,
        answer_text: studentAnswers[q.id]?.text || "",
        file_url: studentAnswers[q.id]?.file_url,
      }));

      const sub = await dataService.submitStudentWork({
        assignment_id: activeAssignment.id,
        student_id: currentStudent.student_id || currentStudent.id,
        student_name: currentStudent.name,
        student_first_name: currentStudent.first_name,
        student_last_name: currentStudent.last_name,
        student_avatar: currentStudent.avatar,
        line_uid: currentStudent.line_uid,
        answers: answersPayload,
        antiCheating: {
          tab_switch_count: tabSwitchCount,
          away_time_seconds: totalAwaySeconds + currentAwaySeconds,
          events: auditEvents,
        },
      });

      setSubmissions((prev) => ({ ...prev, [activeAssignment.id]: sub }));
      setSubmissionSuccess(true);
    } catch (err) {
      console.error("Submission failed:", err);
      alert(err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการส่งข้อสอบ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Join Classroom via Invite Code
  const handleJoinClassroom = async () => {
    if (!joinInviteCode.trim() || !currentStudent) return;
    const allClasses = await dataService.getClassrooms();
    const matched = allClasses.find(
      (c) => c.invite_code?.toLowerCase() === joinInviteCode.trim().toLowerCase()
    );
    if (matched) {
      const firstName = currentStudent.first_name || currentStudent.name.split(" ")[0] || "นักเรียน";
      const lastName = currentStudent.last_name || currentStudent.name.split(" ").slice(1).join(" ") || "";
      const isAlreadyActive = matched.students?.some(
        (s) => s.id === currentStudent.id || s.line_uid === currentStudent.line_uid
      );
      const isAlreadyPending = matched.pending_students?.some(
        (s) => s.id === currentStudent.id || s.line_uid === currentStudent.line_uid
      );

      if (isAlreadyPending) {
        setIsJoinModalOpen(false);
        setJoinInviteCode("");
        setJoinMessage(`🎉 ส่งคำขอเข้าร่วมห้องเรียน "${matched.name}" เรียบร้อยแล้ว (รอคุณครูอนุมัติ Admit)`);
        setTimeout(() => setJoinMessage(null), 3500);
        return;
      }

      await dataService.addStudentToClassroom(
        matched.id,
        {
          id: currentStudent.line_uid,
          first_name: firstName,
          last_name: lastName,
          student_id: currentStudent.student_id,
          institution: currentStudent.institution,
          email: currentStudent.email,
          line_uid: currentStudent.line_uid,
          avatar_url: currentStudent.avatar,
        },
        { autoAdmit: isAlreadyActive }
      );

      setClassrooms((prev) => (prev.some((c) => c.id === matched.id) ? prev : [matched, ...prev]));
      setSelectedClassroom(matched);
      setIsJoinModalOpen(false);
      setJoinInviteCode("");
      if (isAlreadyActive) {
        setJoinMessage(`🎉 คุณอยู่ในห้องเรียน "${matched.name}" เรียบร้อยแล้ว!`);
      } else {
        setJoinMessage(`🎉 ส่งคำขอเข้าร่วมห้องเรียน "${matched.name}" เรียบร้อยแล้ว (รอคุณครูอนุมัติ Admit)`);
      }
      setTimeout(() => setJoinMessage(null), 3500);

      // Refresh assignments for this new classroom
      const allAssigns = await dataService.getAssignments();
      const relevant = allAssigns.filter((a) => a.classroom_id === matched.id);
      setAssignments((prev) => [...prev.filter((a) => a.classroom_id !== matched.id), ...relevant]);
    } else {
      setJoinMessage("ไม่พบห้องเรียนจากรหัสที่ระบุ กรุณาตรวจสอบรหัสอีกครั้ง");
    }
  };

  // View Graded Detail Modal
  const seenScoresKey = currentStudent ? `pudding_seen_scores_${currentStudent.line_uid}` : null;
  useEffect(() => {
    if (!seenScoresKey) return;
    try {
      setSeenScores(JSON.parse(localStorage.getItem(seenScoresKey) || "{}"));
    } catch {
      setSeenScores({});
    }
  }, [seenScoresKey]);

  const handleOpenGradedDetail = async (a: Assignment, s: Submission) => {
    const [qs, answers] = await Promise.all([
      dataService.getQuestions(a.id),
      dataService.getSubmissionAnswers(s.id),
    ]);
    setViewingGradedSub({ assignment: a, submission: s, questions: qs, answers });
    // Once a graded result is opened, it no longer needs announcing on the overview.
    if (gradedSubmissionIds.has(s.id) && s.total_score != null) {
      setSeenScores((prev) => {
        const next = { ...prev, [s.id]: Number(s.total_score) };
        try {
          if (seenScoresKey) localStorage.setItem(seenScoresKey, JSON.stringify(next));
        } catch {}
        return next;
      });
    }
  };

  // Apply a LINE deep link once the first load has finished.
  useEffect(() => {
    const link = pendingDeepLinkRef.current;
    if (!link || isLoadingData || !currentStudent) return;
    pendingDeepLinkRef.current = null;
    if (link.assignmentId) {
      const assignment = assignments.find((item) => item.id === link.assignmentId);
      if (!assignment) return;
      const assignmentClassroom = classrooms.find((c) => c.id === assignment.classroom_id);
      if (assignmentClassroom) setSelectedClassroom(assignmentClassroom);
      setCourseTab("work");
      const submission = submissions[assignment.id];
      if (submission) handleOpenGradedDetail(assignment, submission);
      else handleOpenAssignment(assignment);
    } else if (link.view) {
      setCourseTab(link.view);
    }
  }, [isLoadingData, assignments, classrooms, submissions]);

  // ==========================================
  // VIEW: 1. Loading State
  // ==========================================
  if (authStatus === "loading") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-5 min-h-dvh">
        <div className="relative">
          <div className="w-20 h-20 rounded-[1.75rem] bg-linear-to-br from-amber-300 to-amber-500 flex items-center justify-center text-4xl shadow-xl shadow-amber-500/25">
            🍮
          </div>
          <Loader2 className="w-7 h-7 text-line animate-spin absolute -bottom-1.5 -right-1.5 bg-white dark:bg-slate-900 rounded-full p-1 shadow-md" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">กำลังเชื่อมต่อ LINE...</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">ระบบกำลังตรวจสอบบัญชี LINE ของคุณ</p>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW: 2. Error State
  // ==========================================
  if (authStatus === "error") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-5 min-h-dvh">
        <div className="w-16 h-16 rounded-3xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center">
          <AlertCircle className="w-8 h-8" />
        </div>
        <div className="space-y-2 max-w-sm">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">ไม่สามารถเชื่อมต่อ LINE ได้</h2>
          <p className="text-sm text-rose-600 dark:text-rose-400 font-medium leading-relaxed">{authErrorMessage}</p>
          <p className="text-xs text-slate-500 leading-relaxed">
            กรุณาตรวจสอบว่าได้ตั้งค่า LINE LIFF ID ใน .env และระบุ Endpoint URL ใน LINE Developers Console ตรงกับหน้านี้
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="h-12 px-8 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-bold shadow-md hover:opacity-90 active:scale-[0.98] transition-all cursor-pointer"
        >
          ลองใหม่อีกครั้ง
        </button>
      </div>
    );
  }

  // ==========================================
  // VIEW: 3. Unauthenticated State (Forced Login Screen)
  // ==========================================
  if (authStatus === "unauthenticated" || !currentStudent) {
    const features = [
      { icon: "📝", tint: "bg-emerald-100 dark:bg-emerald-950", title: "ส่งการบ้านและทำข้อสอบ", body: "พิมพ์คำตอบ หรือแนบรูปภาพ/ไฟล์ส่งคุณครูได้ทันที" },
      { icon: "📊", tint: "bg-amber-100 dark:bg-amber-950", title: "ดูผลคะแนนและข้อเสนอแนะ", body: "ดูคะแนนและคำแนะนำรายข้อหลังคุณครูตรวจ" },
      { icon: "🛡️", tint: "bg-sky-100 dark:bg-sky-950", title: "ยืนยันตัวตนอัตโนมัติ", body: "ผูกคะแนนกับบัญชี LINE จริง ไม่สูญหายและปลอดภัย" },
    ];
    return (
      <div className="flex-1 flex flex-col justify-between gap-8 px-6 pt-[max(env(safe-area-inset-top),2.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)] min-h-dvh bg-radial-[at_50%_0%] from-emerald-500/15 via-transparent to-transparent">
        <div className="text-center space-y-5 pt-6">
          <div className="relative inline-block">
            <div className="w-24 h-24 rounded-[2rem] bg-linear-to-br from-amber-300 to-amber-500 flex items-center justify-center text-5xl shadow-2xl shadow-amber-500/30 mx-auto">
              🍮
            </div>
            <span className="absolute -bottom-2 -right-2 px-2.5 py-0.5 rounded-full bg-line text-white text-[11px] font-bold shadow-md ring-2 ring-white dark:ring-slate-950">
              LINE
            </span>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">พุดดิ้ง</h1>
            <p className="text-sm font-semibold text-line">ห้องเรียนออนไลน์สำหรับนักเรียน</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
              เข้าสู่ระบบด้วยบัญชี LINE เพื่อเข้าห้องเรียน ส่งงาน และทำข้อสอบออนไลน์
            </p>
          </div>
        </div>

        <ul className={`${CARD} p-2 divide-y divide-slate-100 dark:divide-slate-800 max-w-md w-full mx-auto`}>
          {features.map((feature) => (
            <li key={feature.title} className="flex items-center gap-3.5 p-3">
              <span className={`w-10 h-10 rounded-2xl ${feature.tint} flex items-center justify-center text-lg shrink-0`}>
                {feature.icon}
              </span>
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{feature.title}</h4>
                <p className="text-xs text-slate-500 leading-relaxed">{feature.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="space-y-3 max-w-md w-full mx-auto">
          <button
            onClick={handleLineLogin}
            className="w-full h-14 rounded-2xl bg-line hover:bg-line-dark text-white font-bold text-base shadow-lg shadow-emerald-500/30 flex items-center justify-center gap-2.5 transition-all active:scale-[0.98] cursor-pointer"
          >
            <LogIn className="w-5 h-5" />
            <span>เข้าสู่ระบบด้วย LINE</span>
          </button>
          <p className="text-xs text-center text-slate-400 leading-relaxed">
            🔒 ต้องเข้าสู่ระบบเพื่อยืนยันตัวตนนักเรียนและบันทึกประวัติความซื่อสัตย์
          </p>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW: 4. Authenticated Student Portal
  // ==========================================
  const courseGroups = classrooms.reduce((groups, classroom) => {
    const key = `${classroom.course_id || classroom.subject_code || classroom.name}-${classroom.semester || ''}-${classroom.year_ce || classroom.academic_year || ''}`;
    const current = groups.get(key) || { label: classroom.course_name || classroom.subject_code || classroom.name, term: classroom.semester && classroom.year_ce ? `ภาคเรียน ${classroom.semester}/${classroom.year_ce + 543}` : classroom.academic_year, classrooms: [] as Classroom[] };
    current.classrooms.push(classroom);
    groups.set(key, current);
    return groups;
  }, new Map<string, { label: string; term?: string; classrooms: Classroom[] }>());

  const termOptions = Array.from(new Map(classrooms.map((classroom) => {
    const key = classroom.semester && classroom.year_ce ? `${classroom.semester}_${classroom.year_ce}` : `academic_${classroom.academic_year}`;
    return [key, classroom.semester && classroom.year_ce ? `ภาคเรียน ${classroom.semester}/${classroom.year_ce + 543}` : classroom.academic_year];
  })).entries());
  const currentTermKey = `${currentAcademicPeriod.semester}_${currentAcademicPeriod.yearCE}`;
  const selectedTermClassrooms = selectedTermKey === "all"
    ? classrooms
    : classrooms.filter((classroom) => {
      const key = classroom.semester && classroom.year_ce ? `${classroom.semester}_${classroom.year_ce}` : `academic_${classroom.academic_year}`;
      return key === (selectedTermKey === "current" ? currentTermKey : selectedTermKey);
    });
  const visibleClassrooms = selectedTermClassrooms.length > 0 ? selectedTermClassrooms : classrooms;
  const visibleClassroomIds = new Set(
    selectedClassroom ? [selectedClassroom.id] : visibleClassrooms.map((classroom) => classroom.id)
  );

  const filteredAssignments = (assignments || []).filter((a) => {
    return a && a.classroom_id && visibleClassroomIds.has(a.classroom_id);
  });

  const pendingAssignments = filteredAssignments
    .filter((a) => !submissions[a.id])
    .sort((a, b) => Number(b.is_exam) - Number(a.is_exam) || (new Date(a.due_date || '').getTime() || 0) - (new Date(b.due_date || '').getTime() || 0));
  // Shortcut lists only show work the teacher still accepts (same rule as the
  // teacher portal's "ปิดรับงานแล้ว" override).
  const openPendingAssignments = pendingAssignments.filter((a) => getAssignmentWindow(a).acceptsSubmissions);
  const pendingExams = openPendingAssignments.filter((a) => a.is_exam);
  const pendingHomework = openPendingAssignments.filter((a) => !a.is_exam);
  const completedAssignments = filteredAssignments.filter((a) => Boolean(submissions[a.id]));
  // Fully graded results the student has not opened yet (or that were re-graded).
  const newResults = completedAssignments.filter((a) => {
    const submission = submissions[a.id];
    return gradedSubmissionIds.has(submission.id) && seenScores[submission.id] !== Number(submission.total_score);
  });

  const studentTimeline = [
    ...classroomPosts.map((post) => ({
      id: `post-${post.id}`,
      kind: post.activity_type || 'announcement',
      label: post.activity_type === 'exam' ? 'ข้อสอบใหม่' : post.activity_type === 'assignment' ? 'งานใหม่' : post.activity_type === 'attendance' ? 'เช็คชื่อ' : 'ประกาศจากครู',
      body: post.body,
      created_at: post.created_at || new Date().toISOString()
    })),
    ...filteredAssignments.map((assignment) => ({
      id: `assignment-${assignment.id}`,
      kind: assignment.is_exam ? 'exam' : 'assignment',
      label: assignment.is_exam ? 'ข้อสอบ' : 'งาน',
      body: assignment.title,
      created_at: assignment.created_at || assignment.due_date || new Date().toISOString()
    })),
    ...courseAttendance.map((attendance) => ({
      id: `attendance-${attendance.id}`,
      kind: 'attendance',
      label: 'คาบเช็คชื่อ',
      body: attendance.title,
      created_at: attendance.starts_at || new Date().toISOString()
    })),
  ].sort((a, b) => (new Date(b.created_at).getTime() || 0) - (new Date(a.created_at).getTime() || 0));

  const answeredCount = activeQuestions.filter((q) => (studentAnswers[q.id]?.text || "").trim() || studentAnswers[q.id]?.file_url).length;
  const isPendingIn = (cls: Classroom) =>
    Boolean(cls.pending_students?.some((s) => s.id === currentStudent.id || s.line_uid === currentStudent.line_uid));

  return (
    <div className="flex-1 flex flex-col font-sans bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-line text-white shadow-sm shadow-emerald-900/10 pt-[env(safe-area-inset-top)]">
        <div className="h-14 px-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setSelectedClassroom(null);
              setActiveAssignment(null);
            }}
            className="flex items-center gap-2 min-w-0 cursor-pointer rounded-xl -ml-1 px-1 py-1 hover:bg-white/10 transition-colors"
            title="กลับหน้าภาพรวม"
          >
            <span className="text-xl select-none">🍮</span>
            <span className="font-bold text-base tracking-tight">พุดดิ้ง</span>
          </button>

          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => {
                setInputFirstName(currentStudent.first_name || "");
                setInputLastName(currentStudent.last_name || "");
                setInputStudentId(currentStudent.student_id || "");
                setInputInstitution(currentStudent.institution || "");
                setInputEmail(currentStudent.email || "");
                setIsFirstTimeStudentId(false);
                setIsStudentIdModalOpen(true);
              }}
              className="flex items-center gap-2 min-w-0 bg-black/15 hover:bg-black/25 pl-1 pr-3 py-1 rounded-full transition-colors cursor-pointer"
              title="แก้ไขข้อมูลนักเรียน"
            >
              <img src={currentStudent.avatar} alt="" className="w-7 h-7 rounded-full object-cover ring-2 ring-white/50 shrink-0" />
              <span className="min-w-0 text-left leading-tight">
                <span className="block max-w-28 sm:max-w-44 truncate text-xs font-bold">
                  {currentStudent.first_name || currentStudent.name}
                </span>
                <span className="block text-[10px] text-emerald-50/90 font-medium truncate">
                  {currentStudent.student_id ? `รหัส ${currentStudent.student_id}` : 'แตะเพื่อใส่รหัส'}
                </span>
              </span>
              <Edit2 className="w-3 h-3 text-emerald-50/80 shrink-0" />
            </button>
            <button
              onClick={handleLineLogout}
              title="ออกจากระบบ"
              aria-label="ออกจากระบบ"
              className="w-10 h-10 flex items-center justify-center rounded-full text-emerald-50 hover:text-white hover:bg-black/15 transition-colors cursor-pointer shrink-0"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Classroom chips (hidden during an exam) */}
        {!activeAssignment && (
          <div className="px-4 pb-3 flex items-center gap-2">
            <div className="flex items-center gap-2 flex-1 overflow-x-auto scrollbar-none -mx-1 px-1">
              <button
                onClick={() => setSelectedClassroom(null)}
                className={`h-9 px-3.5 rounded-full text-xs font-bold whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                  !selectedClassroom ? "bg-white text-emerald-700 shadow-sm" : "bg-white/15 text-white hover:bg-white/25"
                }`}
              >
                ภาพรวม
              </button>
              {classrooms.map((cls) => {
                const isSelected = selectedClassroom?.id === cls.id;
                return (
                  <button
                    key={cls.id}
                    onClick={() => setSelectedClassroom(cls)}
                    className={`h-9 px-3.5 rounded-full text-xs font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                      isSelected ? "bg-white text-emerald-700 shadow-sm" : "bg-white/15 text-white hover:bg-white/25"
                    }`}
                  >
                    <span>{cls.name}</span>
                    {isPendingIn(cls) && (
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-300 text-amber-950 text-[10px] font-bold">รออนุมัติ</span>
                    )}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setIsJoinModalOpen(true)}
              className="h-9 shrink-0 pl-2.5 pr-3.5 rounded-full text-xs font-bold bg-white text-emerald-700 hover:bg-emerald-50 flex items-center gap-1 shadow-sm cursor-pointer active:scale-95 transition-transform"
            >
              <Plus className="w-4 h-4" />
              <span>เข้าร่วม</span>
            </button>
          </div>
        )}
      </header>

      {/* Floating away-from-screen warning */}
      {awayWarningToast && (
        <div className={`fixed top-[calc(4rem+env(safe-area-inset-top))] inset-x-0 z-50 mx-auto w-full ${FRAME} px-4 pointer-events-none`}>
          <div className="p-3.5 rounded-2xl bg-rose-600 text-white shadow-2xl shadow-rose-900/30 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
            <ShieldAlert className="w-6 h-6 shrink-0" />
            <p className="text-sm font-semibold leading-snug">{awayWarningToast}</p>
          </div>
        </div>
      )}

      {/* Join / profile message banner */}
      {joinMessage && (
        <div className="mx-4 mt-4 p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 text-sm font-semibold text-center ring-1 ring-emerald-200 dark:ring-emerald-800 animate-in fade-in">
          {joinMessage}
        </div>
      )}

      {/* ============================================================== */}
      {/* STUDENT PORTAL VIEWS */}
      {/* ============================================================== */}
      {!activeAssignment ? (
        !selectedClassroom ? (
          /* ============================================================ */
          /* 1. OVERVIEW */
          /* ============================================================ */
          <div className="p-4 sm:p-6 space-y-5 pb-[max(env(safe-area-inset-bottom),2.5rem)]">
            {/* Greeting + summary */}
            <section className="space-y-3">
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">สวัสดี 👋</p>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white truncate">
                  {currentStudent.first_name || currentStudent.name}
                </h1>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setIsHomeworkListOpen((prev) => !prev)}
                  className="text-left p-4 rounded-3xl bg-linear-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-orange-500/20 cursor-pointer active:scale-[0.98] transition-transform"
                >
                  <p className="text-xs font-semibold text-amber-50">งานที่ต้องทำ</p>
                  <p className="text-3xl font-black mt-1 tabular-nums">{isLoadingData ? '–' : openPendingAssignments.length}</p>
                  <p className="text-[11px] text-amber-50/90 mt-0.5">{isHomeworkListOpen ? 'แตะเพื่อซ่อนรายการ' : 'แตะเพื่อดูรายการ'}</p>
                </button>
                <div className="p-4 rounded-3xl bg-linear-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-600/20">
                  <p className="text-xs font-semibold text-emerald-50">ส่งแล้ว</p>
                  <p className="text-3xl font-black mt-1 tabular-nums">{isLoadingData ? '–' : completedAssignments.length}</p>
                  <p className="text-[11px] text-emerald-50/90 mt-0.5">ตรวจแล้ว / รอผล</p>
                </div>
              </div>
            </section>

            {isLoadingData && classrooms.length === 0 && (
              <div className="space-y-3" aria-busy="true" aria-live="polite">
                <div className="h-24 rounded-3xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
                <div className="h-40 rounded-3xl bg-slate-200/70 dark:bg-slate-800/70 animate-pulse" />
              </div>
            )}

            {/* New results: shown until the student opens each one */}
            {newResults.length > 0 && (
              <section className="space-y-2.5">
                <SectionTitle icon={<Sparkles className="w-4 h-4 text-emerald-600" />} title="ประกาศคะแนนใหม่" count={newResults.length} />
                <div className="grid gap-2.5 md:grid-cols-2">
                  {newResults.map((assignment) => {
                    const submission = submissions[assignment.id];
                    const resultClass = classrooms.find((c) => c.id === assignment.classroom_id);
                    const total = assignment.total_points || submission.max_total_score || 20;
                    return (
                      <button
                        key={assignment.id}
                        type="button"
                        onClick={() => handleOpenGradedDetail(assignment, submission)}
                        className="w-full text-left p-4 rounded-3xl bg-linear-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-600/20 flex items-center justify-between gap-3 cursor-pointer active:scale-[0.99] transition-transform"
                      >
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-emerald-50/90">🎉 คุณครูตรวจแล้ว • {resultClass?.name || "รายวิชา"}</p>
                          <p className="text-sm font-bold truncate">{assignment.title}</p>
                          <p className="text-[11px] text-emerald-50/90 mt-0.5">แตะเพื่อดูคะแนนและความเห็นรายข้อ</p>
                        </div>
                        <span className="shrink-0 px-3 py-1.5 rounded-2xl bg-white/20 font-black tabular-nums">
                          <span className="text-xl">{submission.total_score}</span>
                          <span className="text-xs font-bold">/{total}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Open attendance sessions (1-tap check-in) */}
            {activeAttendanceList.length > 0 && (
              <section className="space-y-2.5">
                {activeAttendanceList.map((item) => (
                  <div
                    key={item.session.id}
                    className="p-4 rounded-3xl bg-white dark:bg-slate-900 ring-2 ring-line/60 shadow-lg shadow-emerald-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex items-start gap-3">
                      <span className="relative mt-1 flex w-3 h-3 shrink-0">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-line opacity-60 animate-ping" />
                        <span className="relative inline-flex w-3 h-3 rounded-full bg-line" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">เปิดรับเช็คชื่ออยู่ตอนนี้</p>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">{item.session.title}</h3>
                        <p className="text-xs text-slate-500 truncate">
                          {item.classroom.name} • เริ่ม {new Date(item.session.starts_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isCheckingIn}
                      onClick={() => handleStudentCheckIn(item.session.id, item.classroom.id)}
                      className="h-12 px-5 rounded-2xl bg-line hover:bg-line-dark text-white font-bold text-sm shadow-md shadow-emerald-500/25 transition-all cursor-pointer flex items-center justify-center gap-2 shrink-0 active:scale-[0.98] disabled:opacity-60"
                    >
                      {isCheckingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
                      <span>{isCheckingIn ? 'กำลังเช็คชื่อ...' : 'เช็คชื่อเลย'}</span>
                    </button>
                  </div>
                ))}
              </section>
            )}

            {/* Pending exams */}
            {pendingExams.length > 0 && (
              <section className={`${CARD} p-4 sm:p-5 space-y-3`}>
                <SectionTitle icon={<Sparkles className="w-4 h-4 text-violet-600" />} title="ข้อสอบที่ต้องทำ" count={pendingExams.length} />
                <div className="grid gap-2.5 md:grid-cols-2">
                  {pendingExams.map((exam) => {
                    const examClass = classrooms.find((c) => c.id === exam.classroom_id);
                    return (
                      <WorkShortcut
                        key={exam.id}
                        tone="violet"
                        badge="ข้อสอบ"
                        title={exam.title}
                        meta={`${examClass?.name || 'รายวิชา'} • ${formatTimeLeft(getAssignmentWindow(exam).deadline)}`}
                        action="เริ่มทำ"
                        onClick={() => {
                          if (examClass) setSelectedClassroom(examClass);
                          handleOpenAssignment(exam);
                        }}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* Pending homework */}
            {pendingHomework.length > 0 && isHomeworkListOpen && (
              <section className={`${CARD} p-4 sm:p-5 space-y-3`}>
                <SectionTitle
                  icon={<Layers className="w-4 h-4 text-amber-500" />}
                  title="การบ้านค้างส่ง"
                  count={pendingHomework.length}
                  action={
                    <button onClick={() => setIsHomeworkListOpen(false)} className="text-xs text-slate-400 font-semibold hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer px-2 py-1">
                      ซ่อน
                    </button>
                  }
                />
                <div className="grid gap-2.5 md:grid-cols-2">
                  {pendingHomework.map((hw) => {
                    const hwClass = classrooms.find((c) => c.id === hw.classroom_id);
                    const hwWindow = getAssignmentWindow(hw);
                    return (
                      <WorkShortcut
                        key={hw.id}
                        tone={hwWindow.isPastDeadline ? "rose" : "amber"}
                        badge={hwWindow.isPastDeadline ? "เลยกำหนด" : "การบ้าน"}
                        title={hw.title}
                        meta={`${hwClass?.name || 'รายวิชา'} • ${formatTimeLeft(hwWindow.deadline)}`}
                        action="ส่งงาน"
                        onClick={() => {
                          if (hwClass) setSelectedClassroom(hwClass);
                          handleOpenAssignment(hw);
                        }}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* My classrooms */}
            <section className="space-y-3">
              <SectionTitle icon={<BookOpen className="w-4 h-4 text-line" />} title="รายวิชาของฉัน" count={classrooms.length} />
              {classrooms.length === 0 && !isLoadingData ? (
                <div className={`${CARD} text-center py-10 px-6 space-y-3`}>
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 text-3xl flex items-center justify-center mx-auto">🎒</div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">ยังไม่ได้เข้าร่วมห้องเรียน</p>
                    <p className="text-xs text-slate-500">ขอรหัสเข้าห้องเรียนจากคุณครู แล้วกดปุ่มด้านล่าง</p>
                  </div>
                  <button
                    onClick={() => setIsJoinModalOpen(true)}
                    className="h-11 px-5 rounded-2xl bg-line hover:bg-line-dark text-white text-sm font-bold cursor-pointer inline-flex items-center gap-1.5 active:scale-[0.98] transition-transform"
                  >
                    <Plus className="w-4 h-4" />
                    ใส่รหัสเข้าห้องเรียน
                  </button>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {classrooms.map((cls) => {
                    const classPending = assignments.filter(
                      (a) => a.classroom_id === cls.id && !submissions[a.id] && getAssignmentWindow(a).acceptsSubmissions
                    );
                    const pendingApproval = isPendingIn(cls);
                    return (
                      <button
                        key={cls.id}
                        onClick={() => {
                          setSelectedClassroom(cls);
                          setCourseTab('timeline');
                        }}
                        className={`${CARD} w-full text-left p-4 hover:ring-2 hover:ring-line/50 transition-all cursor-pointer flex items-center gap-3.5 active:scale-[0.99]`}
                      >
                        <span className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-line flex items-center justify-center shrink-0">
                          <School className="w-6 h-6" />
                        </span>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-[11px] font-semibold text-slate-400 truncate">
                            {cls.subject_code || 'รายวิชา'} • {cls.academic_year || 'ภาคเรียนปัจจุบัน'}
                          </p>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                            {cls.course_name || cls.name}
                          </h3>
                          <p className="text-xs text-slate-500 truncate">{cls.name}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {pendingApproval ? (
                            <Pill tone="amber">รออนุมัติ</Pill>
                          ) : classPending.length > 0 ? (
                            <Pill tone="amber">ค้าง {classPending.length}</Pill>
                          ) : (
                            <Pill tone="emerald">ครบแล้ว</Pill>
                          )}
                          <ChevronRight className="w-4 h-4 text-slate-300" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : (
          /* ============================================================ */
          /* 2. COURSE DETAIL (bottom tab bar) */
          /* ============================================================ */
          <div className="p-4 sm:p-6 space-y-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
            <div className={`${CARD} p-4 flex items-center gap-3`}>
              <button
                onClick={() => setSelectedClassroom(null)}
                aria-label="กลับสู่ภาพรวม"
                className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 cursor-pointer shrink-0 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
                  {selectedClassroom.course_name || selectedClassroom.subject_code || 'รายวิชา'}
                </h2>
                <p className="text-xs text-slate-500 truncate">
                  {selectedClassroom.name}
                  {selectedClassroom.subject_code ? ` • ${selectedClassroom.subject_code}` : ''}
                </p>
              </div>
              {isSelectedClassroomPending && <Pill tone="amber">รออนุมัติ</Pill>}
            </div>

            {isSelectedClassroomPending && (
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
                <Clock className="w-4 h-4 mt-0.5 shrink-0" />
                <span>รอคุณครูอนุมัติเข้าห้องเรียน เมื่ออนุมัติแล้วจะทำงานและข้อสอบได้ทันที</span>
              </div>
            )}

            {/* TAB: TIMELINE */}
            {courseTab === 'timeline' && (
              <section className={`${CARD} p-4 sm:p-5 space-y-4`}>
                <SectionTitle icon={<Megaphone className="w-4 h-4 text-amber-500" />} title="ไทม์ไลน์ของวิชา" count={studentTimeline.length} />
                {studentTimeline.length > 0 ? (
                  <ol className="relative space-y-1">
                    {studentTimeline.map((item, idx) => (
                      <li key={item.id} className="relative pl-7 pb-4 last:pb-0">
                        {idx < studentTimeline.length - 1 && (
                          <span className="absolute left-[7px] top-5 bottom-0 w-px bg-slate-200 dark:bg-slate-800" />
                        )}
                        <span className={`absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full ring-4 ${TIMELINE_DOT[item.kind] || TIMELINE_DOT.announcement}`} />
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{item.label}</span>
                            <time className="text-[11px] text-slate-400 whitespace-nowrap">
                              {new Date(item.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                            </time>
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed break-words">{item.body}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <EmptyState icon="📭" text="ยังไม่มีความเคลื่อนไหวในวิชานี้" />
                )}
              </section>
            )}

            {/* TAB: WORK & EXAMS */}
            {courseTab === 'work' && (
              <section className="space-y-4">
                {Object.entries(
                  pendingAssignments.concat(completedAssignments).reduce<Record<string, Assignment[]>>((groups, item) => {
                    const key = item.group_name || (item.is_exam ? 'ข้อสอบ' : 'งานทั่วไป');
                    (groups[key] ||= []).push(item);
                    return groups;
                  }, {})
                ).map(([group, items]) => (
                  <div key={group} className={`${CARD} p-4 sm:p-5 space-y-3`}>
                    <SectionTitle icon={<Layers className="w-4 h-4 text-line" />} title={group} count={items.length} />
                    <div className="grid gap-2.5 md:grid-cols-2">
                      {items.map((assignment) => {
                        const submission = submissions[assignment.id];
                        const isSubmitted = Boolean(submission);
                        const isGraded = Boolean(submission && gradedSubmissionIds.has(submission.id));
                        const window_ = getAssignmentWindow(assignment);
                        // Quizzes only accept answers on time (plus a short grace), so trust their status.
                        const isLateSubmitted = isSubmitted && (
                          submission.status === 'late' ||
                          (!assignment.is_exam && Boolean(submission.submitted_at && window_.deadline && new Date(submission.submitted_at).getTime() > window_.deadline))
                        );
                        const isClosed = !isSubmitted && !window_.acceptsSubmissions;

                        return (
                          <button
                            type="button"
                            key={assignment.id}
                            onClick={() => {
                              if (isSubmitted) {
                                handleOpenGradedDetail(assignment, submission);
                              } else {
                                handleOpenAssignment(assignment);
                              }
                            }}
                            className={`w-full text-left p-4 rounded-2xl ring-1 transition-all cursor-pointer space-y-3 active:scale-[0.99] ${
                              isClosed
                                ? 'bg-slate-50 dark:bg-slate-800/40 ring-slate-200 dark:ring-slate-800 opacity-75'
                                : 'bg-slate-50/80 dark:bg-slate-800/60 ring-slate-200/80 dark:ring-slate-700/70 hover:ring-2 hover:ring-line/60'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <span className="text-[11px] font-semibold text-slate-400">
                                  {assignment.is_exam ? '📝 ข้อสอบ' : '📋 งาน'} • เต็ม {assignment.total_points || 20} คะแนน
                                </span>
                                <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 line-clamp-2">{assignment.title}</h4>
                              </div>
                              <div className="shrink-0">
                                {isGraded ? (
                                  <span className="inline-flex items-baseline gap-0.5 px-2.5 py-1 rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 font-black">
                                    <span className="text-base tabular-nums">{submission.total_score}</span>
                                    <span className="text-[11px] font-bold">/{assignment.total_points || 20}</span>
                                  </span>
                                ) : isSubmitted ? (
                                  <Pill tone="sky">รอตรวจ</Pill>
                                ) : isClosed ? (
                                  <Pill tone="slate">ปิดรับแล้ว</Pill>
                                ) : (
                                  <Pill tone="amber">ยังไม่ส่ง</Pill>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2 text-xs pt-2.5 border-t border-slate-200/70 dark:border-slate-700/60">
                              <span className="flex items-center gap-1.5 min-w-0 text-slate-500">
                                <Clock className="w-3.5 h-3.5 shrink-0" />
                                {isSubmitted ? (
                                  isLateSubmitted ? (
                                    <span className="font-semibold text-amber-600">ส่งช้า</span>
                                  ) : (
                                    <span className="font-semibold text-emerald-600">ส่งตรงเวลา</span>
                                  )
                                ) : isClosed ? (
                                  <span className="font-semibold text-slate-500">{window_.isQuizClosed ? 'หมดเวลาทำข้อสอบ' : 'คุณครูปิดรับงานแล้ว'}</span>
                                ) : window_.isPastDeadline ? (
                                  <span className="font-semibold text-rose-600">เลยกำหนด (ยังส่งได้)</span>
                                ) : (
                                  <span className="truncate">
                                    {window_.isExtended ? 'ขยายเวลา • ' : ''}{formatTimeLeft(window_.deadline)}
                                  </span>
                                )}
                              </span>
                              {!isClosed && (
                                <span className="font-bold text-line shrink-0 flex items-center gap-0.5">
                                  {isSubmitted ? 'ดูผล' : 'เริ่มทำ'}
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {!pendingAssignments.length && !completedAssignments.length && (
                  <div className={CARD}>
                    <EmptyState icon="🗂️" text="ยังไม่มีงานหรือข้อสอบในวิชานี้" />
                  </div>
                )}
              </section>
            )}

            {/* TAB: ATTENDANCE */}
            {courseTab === 'attendance' && (
              <section className="space-y-4">
                {(() => {
                  const openSession = courseAttendance.find((s) => s.status === 'open');
                  const currentStatus = openSession ? courseAttendanceRecords[openSession.id] : null;

                  return (
                    <div className={`${CARD} p-4 sm:p-5 space-y-3`}>
                      <SectionTitle
                        icon={<CalendarCheck className="w-4 h-4 text-emerald-600" />}
                        title="การเช็คชื่อปัจจุบัน"
                        action={openSession ? <Pill tone="emerald">เปิดรับอยู่</Pill> : undefined}
                      />

                      {openSession ? (
                        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-200 dark:ring-emerald-900 space-y-3">
                          <div>
                            <p className="text-base font-bold text-slate-900 dark:text-white">{openSession.title}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              เริ่มเวลา {new Date(openSession.starts_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                            </p>
                          </div>

                          {currentStatus ? (
                            <div className="p-3 rounded-xl bg-white dark:bg-slate-900 ring-1 ring-emerald-200 dark:ring-emerald-800 flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                              <CheckCircle2 className="w-5 h-5 shrink-0" />
                              <span>เช็คชื่อแล้ว: {statusLabels[currentStatus as AttendanceStatus] || currentStatus}</span>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleStudentCheckIn(openSession.id)}
                              disabled={isCheckingIn}
                              className="w-full h-12 rounded-2xl bg-line hover:bg-line-dark text-white font-bold text-sm shadow-md shadow-emerald-500/25 transition-all active:scale-[0.98] cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
                            >
                              {isCheckingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
                              {isCheckingIn ? 'กำลังเช็คชื่อ...' : 'กดเช็คชื่อตอนนี้'}
                            </button>
                          )}
                        </div>
                      ) : (
                        <EmptyState icon="🕒" text="ขณะนี้ไม่มีคาบเช็คชื่อที่เปิดรับ" />
                      )}
                    </div>
                  );
                })()}

                <div className={`${CARD} p-4 sm:p-5 space-y-3`}>
                  <SectionTitle icon={<CalendarDays className="w-4 h-4 text-slate-500" />} title="ประวัติการเช็คชื่อ" count={courseAttendance.length} />
                  {courseAttendance.length > 0 ? (
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {courseAttendance.map((attendance) => {
                        const recordStatus = courseAttendanceRecords[attendance.id];
                        // No record on a closed session counts as absent, as on the teacher roster.
                        const shownStatus = recordStatus || (attendance.status === 'open' ? 'idle' : 'absent');
                        return (
                          <li key={attendance.id} className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{attendance.title}</p>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {new Date(attendance.starts_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}
                              </p>
                            </div>
                            <Pill tone={ATTENDANCE_TONE[shownStatus] || 'slate'}>{ATTENDANCE_SHORT[shownStatus] || shownStatus}</Pill>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <EmptyState icon="📅" text="ยังไม่มีประวัติการเช็คชื่อ" />
                  )}
                </div>
              </section>
            )}

            {/* Bottom tab bar */}
            <nav className={`fixed bottom-0 inset-x-0 z-40 mx-auto w-full ${FRAME} bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-t border-slate-200/80 dark:border-slate-800 pb-[env(safe-area-inset-bottom)]`}>
              <div className="grid grid-cols-3 px-2 py-1.5">
                {([
                  { key: 'timeline', label: 'ไทม์ไลน์', icon: Megaphone },
                  { key: 'work', label: 'งาน / ข้อสอบ', icon: BookOpen },
                  { key: 'attendance', label: 'เช็คชื่อ', icon: CalendarCheck },
                ] as const).map(({ key, label, icon: Icon }) => {
                  const isActive = courseTab === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setCourseTab(key)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex flex-col items-center gap-1 py-1.5 rounded-2xl text-[11px] font-semibold transition-colors cursor-pointer ${
                        isActive ? 'text-line' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                      }`}
                    >
                      <span className={`px-4 py-1 rounded-full transition-colors ${isActive ? 'bg-emerald-50 dark:bg-emerald-950/60' : ''}`}>
                        <Icon className="w-5 h-5" />
                      </span>
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </nav>
          </div>
        )
      ) : (

        /* ACTIVE TAKING EXAM/ASSIGNMENT VIEW */
        <div className="p-4 sm:p-6 space-y-4 pb-[calc(7rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => {
                if (submissionSuccess || confirm("ต้องการออกจากหน้าข้อสอบหรือไม่? (ข้อมูลที่ตอบไว้จะยังไม่ถูกส่ง)")) {
                  setActiveAssignment(null);
                }
              }}
              aria-label="ออกจากหน้าทำงาน"
              className="w-10 h-10 rounded-full bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            {/* Live anti-cheating status */}
            <div
              className={`flex items-center gap-2 h-9 px-3.5 rounded-full text-xs font-semibold ring-1 ${tabSwitchCount > 0
                ? "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900"
                : "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900"
                }`}
            >
              {tabSwitchCount > 0 ? <ShieldAlert className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
              <span>ออกจากจอ {tabSwitchCount} ครั้ง ({totalAwaySeconds} วิ)</span>
            </div>
          </div>

          {isLoadingQuestions ? (
            <div className="space-y-4" aria-live="polite" aria-busy="true">
              <div className="h-28 rounded-3xl bg-slate-200/70 dark:bg-slate-800 animate-pulse" />
              <div className="h-40 rounded-3xl bg-slate-200/70 dark:bg-slate-800 animate-pulse" />
              <div className="h-40 rounded-3xl bg-slate-200/70 dark:bg-slate-800 animate-pulse" />
              <p className="text-center text-sm text-slate-500">กำลังเตรียมข้อสอบ...</p>
            </div>
          ) : submissionSuccess ? (
            <div className={`${CARD} text-center space-y-5 p-6 sm:p-8 mt-6 animate-in fade-in zoom-in-95`}>
              <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-950 text-line mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">ส่งงานเรียบร้อยแล้ว!</h2>
                <p className="text-sm text-slate-500 max-w-xs mx-auto">
                  ระบบบันทึกคำตอบและรายงานความซื่อสัตย์ส่งถึงคุณครูแล้ว
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-left">
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800">
                  <dt className="text-xs text-slate-500">สลับหน้าจอ</dt>
                  <dd className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{tabSwitchCount} ครั้ง</dd>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800">
                  <dt className="text-xs text-slate-500">เวลานอกจอ</dt>
                  <dd className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{totalAwaySeconds} วิ</dd>
                </div>
              </dl>
              <button
                onClick={() => setActiveAssignment(null)}
                className="w-full h-12 rounded-2xl bg-line hover:bg-line-dark text-white font-bold text-sm shadow-md cursor-pointer active:scale-[0.98] transition-transform"
              >
                กลับสู่หน้าหลัก
              </button>
            </div>
          ) : (
            <>
              {/* Exam header */}
              <div className="p-5 rounded-3xl bg-linear-to-br from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/30 ring-1 ring-amber-200/80 dark:ring-amber-900/60 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Pill tone={activeAssignment.is_exam ? "violet" : "amber"}>{activeAssignment.is_exam ? "ข้อสอบออนไลน์" : "ใบงาน"}</Pill>
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    เต็ม {activeAssignment.total_points || 20} คะแนน • {formatTimeLeft(getAssignmentWindow(activeAssignment).deadline)}
                  </span>
                </div>
                <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white leading-snug">{activeAssignment.title}</h1>
                {activeAssignment.description && (
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-wrap">{activeAssignment.description}</p>
                )}
                {activeQuestions.length > 0 && (
                  <div className="pt-1 space-y-1.5">
                    <div className="flex justify-between text-xs font-semibold text-slate-500">
                      <span>ตอบแล้ว</span>
                      <span className="tabular-nums">{answeredCount}/{activeQuestions.length} ข้อ</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/80 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-line transition-[width] duration-300"
                        style={{ width: `${(answeredCount / activeQuestions.length) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {activeQuestions.length === 0 && (
                <div className={CARD}>
                  <EmptyState icon="📄" text="งานนี้ไม่มีคำถาม กดส่งเพื่อยืนยันการส่งงานได้เลย" />
                </div>
              )}

              {/* Questions */}
              <div className="space-y-4">
                {activeQuestions.map((q, idx) => {
                  const isFileUpload = q.type === 'file_upload' || (q as any).allow_upload || (q as any).requires_file;
                  // True/false questions created before options were saved have none; give them the standard pair.
                  const choiceOptions = Array.isArray(q.options) && q.options.length > 0
                    ? q.options
                    : q.type === 'true_false' ? [...TRUE_FALSE_OPTIONS] : [];
                  const isChoice = (q.type === 'multiple_choice' || q.type === 'true_false') && choiceOptions.length > 0;
                  const currentAnswer = studentAnswers[q.id]?.text || "";
                  const isAnswered = Boolean(currentAnswer.trim() || studentAnswers[q.id]?.file_url);

                  return (
                    <div key={q.id} className={`${CARD} p-4 sm:p-5 space-y-4`}>
                      <div className="flex items-start gap-3">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors ${
                          isAnswered ? 'bg-line text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                        }`}>
                          {isAnswered ? <CheckCircle2 className="w-4 h-4" /> : idx + 1}
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <span className="text-[11px] font-semibold text-slate-400">
                            ข้อ {idx + 1}/{activeQuestions.length} • {q.max_score} คะแนน{isFileUpload ? ' • แนบไฟล์' : isChoice ? ' • ปรนัย' : ''}
                          </span>
                          <p className="text-base font-semibold text-slate-900 dark:text-white leading-relaxed whitespace-pre-wrap break-words">{q.question_text}</p>
                        </div>
                      </div>

                      {isChoice && (
                        <div className="grid gap-2" role="radiogroup">
                          {choiceOptions.map((opt, optIdx) => {
                            const isSelected = currentAnswer === opt;
                            return (
                              <button
                                type="button"
                                role="radio"
                                aria-checked={isSelected}
                                key={optIdx}
                                onClick={() =>
                                  setStudentAnswers((prev) => ({
                                    ...prev,
                                    [q.id]: { ...prev[q.id], text: opt },
                                  }))
                                }
                                className={`min-h-12 p-3 rounded-2xl text-left text-sm font-medium transition-all ring-1 flex items-center gap-3 cursor-pointer active:scale-[0.99] ${
                                  isSelected
                                    ? "bg-emerald-50 dark:bg-emerald-950/40 ring-2 ring-line text-emerald-900 dark:text-emerald-100"
                                    : "bg-slate-50 dark:bg-slate-800/70 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200 hover:ring-slate-300 dark:hover:ring-slate-600"
                                }`}
                              >
                                <span
                                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                                    isSelected ? "bg-line text-white" : "bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-600"
                                  }`}
                                >
                                  {String.fromCharCode(65 + optIdx)}
                                </span>
                                <span className="flex-1 break-words">{opt}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {!isChoice && (
                        <div className="space-y-1.5">
                          <label htmlFor={`answer-${q.id}`} className="text-xs font-semibold text-slate-500">
                            {isFileUpload ? "คำอธิบายประกอบไฟล์ (ถ้ามี)" : "คำตอบของคุณ"}
                          </label>
                          <textarea
                            id={`answer-${q.id}`}
                            rows={isFileUpload ? 2 : 4}
                            value={currentAnswer}
                            onChange={(e) =>
                              setStudentAnswers((prev) => ({
                                ...prev,
                                [q.id]: { ...prev[q.id], text: e.target.value },
                              }))
                            }
                            placeholder={isFileUpload ? "พิมพ์คำอธิบายประกอบการแนบไฟล์..." : "พิมพ์คำตอบที่นี่..."}
                            className="w-full p-3.5 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-50 dark:bg-slate-800/70 text-sm leading-relaxed focus:ring-2 focus:ring-line focus:bg-white dark:focus:bg-slate-900 outline-none transition-all resize-y"
                          />
                        </div>
                      )}

                      {isFileUpload && (
                        <label className={`flex items-center justify-center gap-2 min-h-12 px-4 rounded-2xl border-2 border-dashed text-sm font-semibold cursor-pointer transition-colors ${
                          studentAnswers[q.id]?.file_url
                            ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                            : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-line hover:text-line'
                        }`}>
                          {uploadingQuestionId === q.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : studentAnswers[q.id]?.file_url ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : (
                            <Upload className="w-4 h-4" />
                          )}
                          <span>
                            {uploadingQuestionId === q.id
                              ? 'กำลังอัปโหลด...'
                              : studentAnswers[q.id]?.file_url
                                ? 'อัปโหลดแล้ว • แตะเพื่อเปลี่ยนไฟล์'
                                : 'แนบรูป / ไฟล์งาน'}
                          </span>
                          <input
                            type="file"
                            accept="image/*,application/pdf"
                            disabled={uploadingQuestionId === q.id}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                setUploadingQuestionId(q.id);
                                handleFileUpload(q.id, file).finally(() => setUploadingQuestionId(null));
                              }
                            }}
                            className="sr-only"
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Submit bar */}
              <div className={`fixed bottom-0 inset-x-0 z-40 mx-auto w-full ${FRAME} px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] bg-linear-to-t from-slate-50 via-slate-50/95 to-slate-50/0 dark:from-slate-950 dark:via-slate-950/95 dark:to-slate-950/0`}>
                <button
                  type="button"
                  disabled={isSubmitting || uploadingQuestionId !== null}
                  onClick={handleSubmitTask}
                  className="w-full h-14 rounded-2xl bg-line hover:bg-line-dark text-white font-bold text-base shadow-xl shadow-emerald-600/25 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  <span>{isSubmitting ? "กำลังส่ง..." : activeQuestions.length > 0 ? `ส่งคำตอบ (${answeredCount}/${activeQuestions.length})` : "ยืนยันการส่งงาน"}</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* STUDENT PROFILE MODAL (mandatory first time, editable later) */}
      {isStudentIdModalOpen && (
        <Sheet>
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-2xl flex items-center justify-center mx-auto">🎓</div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              {isFirstTimeStudentId ? "ลงทะเบียนข้อมูลนักเรียน" : "แก้ไขข้อมูลนักเรียน"}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              {isFirstTimeStudentId
                ? "กรอกชื่อ-นามสกุลจริง รหัสนักเรียน และสถานศึกษา เพื่อยืนยันตัวตนก่อนเข้าห้องเรียน"
                : "แก้ไขข้อมูลให้ตรงกับทะเบียนโรงเรียน"}
            </p>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3">
              <Field label="ชื่อจริง" required>
                <input
                  type="text"
                  required
                  autoComplete="given-name"
                  value={inputFirstName}
                  onChange={(e) => setInputFirstName(e.target.value)}
                  placeholder="เช่น กัญญาณัฐ"
                  className={INPUT}
                />
              </Field>
              <Field label="นามสกุล" required>
                <input
                  type="text"
                  required
                  autoComplete="family-name"
                  value={inputLastName}
                  onChange={(e) => setInputLastName(e.target.value)}
                  placeholder="เช่น มีชัย"
                  className={INPUT}
                />
              </Field>
            </div>

            <Field label="รหัสนักเรียน / รหัสนักศึกษา" required hint="อย่างน้อย 3 หลัก">
              <input
                type="text"
                inputMode="numeric"
                required
                value={inputStudentId}
                onChange={(e) => setInputStudentId(e.target.value.trim())}
                placeholder="เช่น 54101 หรือ 66010123"
                className={`${INPUT} font-mono font-semibold tracking-wide`}
              />
            </Field>

            <Field label="สถานศึกษา / โรงเรียน" required hint="เลือกจากรายชื่อในระบบเพื่อป้องกันชื่อสะกดไม่ตรงกัน">
              <InstitutionSearchSelect
                value={inputInstitution}
                onChange={setInputInstitution}
                extraInstitutions={registeredInstitutions}
                placeholder="ค้นหาและเลือกโรงเรียนของคุณ..."
              />
            </Field>

            <Field label="อีเมล (ไม่บังคับ)">
              <input
                type="email"
                autoComplete="email"
                value={inputEmail}
                onChange={(e) => setInputEmail(e.target.value)}
                placeholder="เช่น student@example.com"
                className={INPUT}
              />
              {inputEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inputEmail.trim()) && (
                <p className="text-xs text-rose-500">รูปแบบอีเมลไม่ถูกต้อง เช่น student@example.com</p>
              )}
            </Field>
          </div>

          <div className="flex items-center gap-2 pt-1">
            {!isFirstTimeStudentId && (
              <button
                type="button"
                disabled={isSavingStudentId}
                onClick={() => setIsStudentIdModalOpen(false)}
                className="flex-1 h-12 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                ยกเลิก
              </button>
            )}
            <button
              type="button"
              disabled={
                isSavingStudentId ||
                !inputFirstName.trim() ||
                !inputLastName.trim() ||
                inputStudentId.trim().length < 3 ||
                !inputInstitution.trim() ||
                (!!inputEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inputEmail.trim()))
              }
              onClick={handleSaveStudentId}
              className="flex-1 h-12 rounded-2xl bg-line hover:bg-line-dark text-white text-sm font-bold shadow-md cursor-pointer disabled:opacity-50 transition-all active:scale-[0.98]"
            >
              {isSavingStudentId ? "กำลังบันทึก..." : "บันทึกข้อมูล"}
            </button>
          </div>
        </Sheet>
      )}

      {/* JOIN CLASSROOM MODAL */}
      {isJoinModalOpen && (
        <Sheet onClose={() => setIsJoinModalOpen(false)} size="sm">
          <div className="space-y-1.5">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">เข้าร่วมห้องเรียน</h3>
            <p className="text-sm text-slate-500">กรอกรหัสเชิญที่ได้รับจากคุณครู (เช่น THAI-401)</p>
          </div>
          <input
            type="text"
            autoFocus
            autoCapitalize="characters"
            value={joinInviteCode}
            onChange={(e) => setJoinInviteCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleJoinClassroom();
            }}
            placeholder="THAI-401"
            className={`${INPUT} h-14 uppercase font-mono font-bold text-center text-lg tracking-widest`}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsJoinModalOpen(false)}
              className="flex-1 h-12 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={!joinInviteCode.trim()}
              onClick={handleJoinClassroom}
              className="flex-1 h-12 rounded-2xl bg-line hover:bg-line-dark text-white text-sm font-bold cursor-pointer disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              เข้าร่วม
            </button>
          </div>
        </Sheet>
      )}

      {/* GRADED RESULT DETAIL MODAL */}
      {viewingGradedSub && (
        <Sheet onClose={() => setViewingGradedSub(null)}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-11 h-11 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-xl flex items-center justify-center shrink-0">🏆</span>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">ผลการประเมิน</h3>
                <p className="text-xs text-slate-500 truncate">{viewingGradedSub.assignment.title}</p>
              </div>
            </div>
            <button
              onClick={() => setViewingGradedSub(null)}
              aria-label="ปิด"
              className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white flex items-center justify-center cursor-pointer shrink-0"
            >
              ✕
            </button>
          </div>

          {gradedSubmissionIds.has(viewingGradedSub.submission.id) && viewingGradedSub.submission.total_score != null ? (
            <div className="p-5 rounded-2xl bg-linear-to-br from-emerald-500 to-teal-600 text-white text-center space-y-1">
              <p className="text-4xl font-black tabular-nums">
                {viewingGradedSub.submission.total_score}
                <span className="text-xl font-bold text-emerald-100"> / {viewingGradedSub.assignment.total_points || 20}</span>
              </p>
              <p className="text-sm font-semibold text-emerald-50">
                คิดเป็น {Math.round(((viewingGradedSub.submission.total_score || 0) / (viewingGradedSub.assignment.total_points || 20)) * 100)}%
              </p>
            </div>
          ) : (
            <div className="p-5 rounded-2xl bg-sky-50 dark:bg-sky-950/40 ring-1 ring-sky-200 dark:ring-sky-900 text-center space-y-1">
              <p className="text-base font-bold text-sky-800 dark:text-sky-200">ส่งงานแล้ว • รอคุณครูตรวจ</p>
              <p className="text-xs text-sky-700/80 dark:text-sky-300/80">
                ส่งเมื่อ {viewingGradedSub.submission.submitted_at ? new Date(viewingGradedSub.submission.submitted_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-'}
              </p>
            </div>
          )}

          <div className="space-y-3">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">คะแนนและข้อเสนอแนะรายข้อ</h4>
            {viewingGradedSub.questions.map((q, i) => {
              const ans = viewingGradedSub.answers[q.id];
              // Students only see the teacher's official score, never the AI draft.
              const score = ans?.teacher_score;
              return (
                <div key={q.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 ring-1 ring-slate-200/80 dark:ring-slate-700/70 space-y-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 min-w-0 break-words">
                      <span className="text-slate-400">ข้อ {i + 1}.</span> {q.question_text}
                    </p>
                    {score != null ? (
                      <span className="text-sm font-bold text-line shrink-0 tabular-nums">
                        {score}/{q.max_score}
                      </span>
                    ) : (
                      <span className="shrink-0"><Pill tone="sky">รอตรวจ</Pill></span>
                    )}
                  </div>
                  <div className="p-3 rounded-xl bg-white dark:bg-slate-900 text-sm text-slate-700 dark:text-slate-300 break-words">
                    <span className="text-xs font-semibold text-slate-400 block mb-0.5">คำตอบของคุณ</span>
                    {ans?.text_answer || "(ไม่มีข้อความ)"}
                    {ans?.file_url && (
                      <a href={ans.file_url} target="_blank" rel="noreferrer" className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-line hover:underline">
                        <Upload className="w-3 h-3" /> ดูไฟล์ที่แนบ
                      </a>
                    )}
                  </div>
                  {ans?.teacher_comment && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-sm">
                      <span className="text-xs font-bold block mb-0.5">💬 ความเห็นคุณครู</span>
                      {ans.teacher_comment}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={() => setViewingGradedSub(null)}
            className="w-full h-12 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-sm cursor-pointer active:scale-[0.98] transition-transform"
          >
            ตกลง
          </button>
        </Sheet>
      )}
    </div>
  );
}
