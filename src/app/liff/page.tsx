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
  const [registeredInstitutions, setRegisteredInstitutions] = useState<string[]>([]);
  const [classroomPosts, setClassroomPosts] = useState<ClassroomPost[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
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
      const response = await fetch(`/api/classrooms/posts?classroomId=${encodeURIComponent(classroom.id)}&lineUid=${encodeURIComponent(lineUid)}`, { cache: "no-store" });
      if (response.ok) setClassroomPosts((await response.json()).posts || []);
      const attendanceResponse = await fetch(`/api/attendance?classroomId=${encodeURIComponent(classroom.id)}&lineUid=${encodeURIComponent(lineUid)}`, { cache: "no-store" });
      if (attendanceResponse.ok) {
        const attendance = await attendanceResponse.json();
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
    if (!classList.length || !lineUid) return;
    try {
      const results = await Promise.all(
        classList.map(async (cls) => {
          try {
            const res = await fetch(`/api/attendance?classroomId=${encodeURIComponent(cls.id)}&lineUid=${encodeURIComponent(lineUid)}`, {
              cache: "no-store",
            });
            if (!res.ok) return [];
            const data = await res.json();
            const recordsMap = Object.fromEntries(
              (data.records || []).map((r: any) => [r.session_id, r.status])
            );
            // Overview is an action list: once this student has a record for
            // the session, remove it from the shortcut list. The attendance
            // tab still loads the full session history separately.
            return (data.sessions || []).filter((s: any) => s.status === "open" && !recordsMap[s.id]).map((s: any) => ({
              classroom: cls,
              session: s,
              checkedIn: Boolean(recordsMap[s.id]),
              status: recordsMap[s.id],
            }));
          } catch {
            return [];
          }
        })
      );
      setActiveAttendanceList(results.flat());
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
      const statusText = json.status === "on_time" ? "มาตรงเวลา 🟢" : "มาสาย 🟡";
      alert(`เช็คชื่อสำเร็จ! สถานะของคุณ: ${statusText}`);

      // Realtime Broadcast across browser windows
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("pudding-attendance-checked", { detail: { classroomId: targetClassroomId, status: json.status } }));
        if ("BroadcastChannel" in window) {
          const bc = new BroadcastChannel("pudding-realtime");
          bc.postMessage({ type: "attendance_checked", classroomId: targetClassroomId, status: json.status });
          bc.close();
        }
      }

      if (selectedClassroom) {
        await loadClassroomPosts(selectedClassroom, currentStudent.line_uid);
      }
      if (classrooms.length > 0) {
        loadAllActiveAttendance(classrooms, currentStudent.line_uid);
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
  const [studentAnswers, setStudentAnswers] = useState<Record<string, { text: string; file_url?: string }>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState(false);

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



  // Join Classroom Code Modal
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [joinInviteCode, setJoinInviteCode] = useState("");
  const [joinMessage, setJoinMessage] = useState<string | null>(null);
  const processedEnrollRef = useRef<string | null>(null);

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

    async function loadData() {
      if (!currentStudent) return;
      setIsLoadingData(true);
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

        // Filter ONLY classrooms that this student has actually enrolled in
        let enrolled = allClasses.filter((c) =>
          c.students?.some((s) => s.id === currentStudent.id || s.line_uid === currentStudent.line_uid) ||
          c.pending_students?.some((s) => s.id === currentStudent.id || s.line_uid === currentStudent.line_uid)
        );

        // Default to Overview (null) unless a specific class was requested via URL link
        let active: Classroom | null = null;

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
              window.history.replaceState({}, "", cleanUrl.pathname + (cleanUrl.search ? cleanUrl.search : ""));
            } catch {}
          }
        }

        // Single-beat unified data loading: filter assignments and load student submissions together
        const enrolledClassIds = new Set(enrolled.map((c) => c.id));
        const relevantAssigns = (allAssigns || []).filter((a) => a && enrolledClassIds.has(a.classroom_id));

        const submissionResults = await Promise.all(
          relevantAssigns.map(async (assignment) => {
            try {
              const subs = await dataService.getSubmissions(assignment.id);
              return { assignmentId: assignment.id, submissions: subs || [] };
            } catch {
              return { assignmentId: assignment.id, submissions: [] };
            }
          })
        );
        const subMap: Record<string, Submission> = {};
        for (const result of submissionResults) {
          const found = result.submissions.find(
            (s) =>
              s.student_id === currentStudent.id ||
              s.student_id === currentStudent.line_uid ||
              (currentStudent.student_id && s.student_id === currentStudent.student_id)
          );
          if (found) subMap[result.assignmentId] = found;
        }

        // Batch all state updates in one single beat
        setClassrooms(enrolled);
        setSelectedClassroom(active);
        setAssignments(relevantAssigns);
        setSubmissions(subMap);
        if (currentStudent.line_uid) {
          loadAllActiveAttendance(enrolled, currentStudent.line_uid);
        }
      } catch (err) {
        console.error("Failed to load student data:", err);
      } finally {
        setIsLoadingData(false);
      }
    }

    loadData();

    // Real-time synchronization: Auto-refresh when teacher admits student into classroom
    const unsub = dataService.subscribeToClassroomChanges(undefined, () => {
      loadData();
    });
    return () => unsub();
  }, [authStatus, currentStudent?.id, currentStudent?.student_id]);

  useEffect(() => {
    if (currentStudent?.line_uid) loadClassroomPosts(selectedClassroom, currentStudent.line_uid);
  }, [selectedClassroom?.id, currentStudent?.line_uid]);

  // When opening an assignment, fetch questions (Protected by admission gate)
  const handleOpenAssignment = async (a: Assignment) => {
    if (isSelectedClassroomPending) {
      alert("กรุณารอคุณครูอนุมัติเข้าห้องเรียน (Admit) ก่อนเริ่มต้นทำข้อสอบหรือการบ้าน");
      return;
    }
    setActiveAssignment(a);
    const qs = await dataService.getQuestions(a.id);
    setActiveQuestions(qs);
    setStudentAnswers({});
    setSubmissionSuccess(false);
  };

  // 3. Real-Time Anti-Cheating Listener ("ตรวจจับเวลาแอบกดออกจอ")
  useEffect(() => {
    if (!activeAssignment) return;

    setTabSwitchCount(0);
    setTotalAwaySeconds(0);
    setAuditEvents([]);
    awayStartRef.current = null;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        awayStartRef.current = Date.now();
        setTabSwitchCount((prev) => prev + 1);

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
            `⚠️ ตรวจพบการออกจากหน้าจอเป็นเวลา ${durationSec} วินาที (ครั้งที่ ${tabSwitchCount + 1}) — ระบบจะแนบรายงานให้อาจารย์เมื่อส่งคำตอบ`
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
  }, [activeAssignment, tabSwitchCount]);



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
      const json = await res.json();
      if (json.url) {
        setStudentAnswers((prev) => ({
          ...prev,
          [questionId]: {
            text: prev[questionId]?.text || `ส่งไฟล์แนบ: ${file.name}`,
            file_url: json.url,
          },
        }));
      }
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
      alert("เกิดข้อผิดพลาดในการส่งข้อสอบ กรุณาลองใหม่อีกครั้ง");
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
  const handleOpenGradedDetail = async (a: Assignment, s: Submission) => {
    const qs = await dataService.getQuestions(a.id);
    const answers = await dataService.getSubmissionAnswers(s.id);
    setViewingGradedSub({ assignment: a, submission: s, questions: qs, answers });
  };

  // ==========================================
  // VIEW: 1. Loading State
  // ==========================================
  if (authStatus === "loading") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 min-h-125">
        <div className="relative">
          <div className="w-20 h-20 rounded-3xl bg-amber-100 dark:bg-amber-950/60 flex items-center justify-center text-4xl shadow-lg ring-8 ring-amber-500/10 animate-bounce">
            🍮
          </div>
          <Loader2 className="w-6 h-6 text-[#06C755] animate-spin absolute -bottom-1 -right-1 bg-white dark:bg-slate-900 rounded-full p-0.5 shadow-md" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-black text-slate-900 dark:text-white">
            กำลังเชื่อมต่อ LINE LIFF...
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            ระบบตรวจสอบการเข้าสู่ระบบบัญชี LINE ของนักเรียน
          </p>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW: 2. Error State
  // ==========================================
  if (authStatus === "error") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-5 min-h-125">
        <div className="w-16 h-16 rounded-3xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center shadow-md">
          <AlertCircle className="w-8 h-8" />
        </div>
        <div className="space-y-2 max-w-xs">
          <h2 className="text-base font-black text-slate-900 dark:text-white">
            ไม่สามารถเชื่อมต่อ LINE LIFF
          </h2>
          <p className="text-xs text-rose-600 dark:text-rose-400 font-medium leading-relaxed">
            {authErrorMessage}
          </p>
          <p className="text-[11px] text-slate-500 leading-normal">
            กรุณาตรวจสอบว่าได้ตั้งค่า LINE LIFF ID ใน .env และระบุ Endpoint URL ใน LINE Developers Console ตรงกับหน้านี้
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="px-6 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold shadow-md hover:opacity-90 active:scale-95 transition-all cursor-pointer"
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
    return (
      <div className="flex-1 flex flex-col justify-between p-6 bg-radial from-emerald-500/10 via-transparent to-transparent text-slate-900 dark:text-white min-h-150">
        {/* Top Branding */}
        <div className="pt-8 text-center space-y-4">
            <div className="relative inline-block">
            <div className="w-24 h-24 rounded-3xl bg-linear-to-tr from-amber-400 to-amber-200 dark:from-amber-600 dark:to-amber-400 flex items-center justify-center text-5xl shadow-2xl ring-8 ring-emerald-500/20 mx-auto">
              🍮
            </div>
            <span className="absolute -bottom-2 -right-2 px-2.5 py-0.5 rounded-full bg-[#06C755] text-white text-[10px] font-black shadow-md border-2 border-white dark:border-slate-900">
              LIFF
            </span>
          </div>

          <div className="space-y-1.5">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              พุดดิ้ง (Pudding)
            </h1>
            <p className="text-xs font-bold text-[#06C755]">
              ระบบห้องเรียนและการส่งข้อสอบสำหรับนักเรียน
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed pt-1">
              กรุณาเข้าสู่ระบบด้วยบัญชี LINE ของคุณเพื่อเข้าใช้งานห้องเรียน ส่งงาน และทำข้อสอบออนไลน์
            </p>
          </div>
        </div>

        {/* Feature Highlights Card */}
        <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-md rounded-3xl p-5 border border-slate-200 dark:border-slate-700/80 shadow-lg space-y-3.5 my-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-[#06C755] flex items-center justify-center font-bold text-sm shrink-0">
              📝
            </div>
            <div className="text-left">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                ส่งการบ้านและทำข้อสอบ
              </h4>
              <p className="text-[11px] text-slate-500">
                รองรับการพิมพ์ อัดเสียง และแนบรูปภาพส่งคุณครู
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-600 flex items-center justify-center font-bold text-sm shrink-0">
              📊
            </div>
            <div className="text-left">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                ดูผลคะแนนและข้อเสนอแนะ
              </h4>
              <p className="text-[11px] text-slate-500">
                ตรวจเช็คคะแนนและคำแนะนำรายข้อได้ทันทีหลังคุณครูตรวจ
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950 text-blue-600 flex items-center justify-center font-bold text-sm shrink-0">
              🛡️
            </div>
            <div className="text-left">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                ระบบยืนยันตัวตนอัตโนมัติ
              </h4>
              <p className="text-[11px] text-slate-500">
                ผูกคะแนนกับบัญชี LINE จริง ไม่สูญหายและปลอดภัย
              </p>
            </div>
          </div>
        </div>

        {/* Forced Login Action Button */}
        <div className="space-y-3 pb-6">
          <button
            onClick={handleLineLogin}
            className="w-full py-4 rounded-2xl bg-[#06C755] hover:bg-[#05b34c] text-white font-black text-sm shadow-xl shadow-emerald-500/30 flex items-center justify-center gap-2.5 transition-all active:scale-98 cursor-pointer"
          >
            <LogIn className="w-5 h-5" />
            <span>เข้าสู่ระบบด้วย LINE (LINE Login)</span>
          </button>

          <p className="text-[10px] text-center text-slate-400 flex items-center justify-center gap-1">
            <span>🔒</span>
            <span>บังคับเข้าสู่ระบบเพื่อยืนยันตัวตนนักเรียนและบันทึกประวัติความซื่อสัตย์</span>
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
  const pendingExams = pendingAssignments.filter((a) => a.is_exam);
  const pendingHomework = pendingAssignments.filter((a) => !a.is_exam);
  const completedAssignments = filteredAssignments.filter((a) => Boolean(submissions[a.id]));

  const minutesUntil = (dueDate?: string) => {
    if (!dueDate) return 0;
    const t = new Date(dueDate).getTime();
    if (isNaN(t)) return 0;
    return Math.max(0, Math.ceil((t - Date.now()) / 60000));
  };

  const studentTimeline = [
    ...classroomPosts.map((post) => ({
      id: `post-${post.id}`,
      label: post.activity_type === 'exam' ? 'ข้อสอบใหม่' : post.activity_type === 'assignment' ? 'งานใหม่' : post.activity_type === 'attendance' ? 'เช็คชื่อ' : 'ประกาศจากครู',
      body: post.body,
      created_at: post.created_at || new Date().toISOString()
    })),
    ...filteredAssignments.map((assignment) => ({
      id: `assignment-${assignment.id}`,
      label: assignment.is_exam ? 'ข้อสอบ' : 'งาน',
      body: assignment.title,
      created_at: assignment.created_at || assignment.due_date || new Date().toISOString()
    })),
    ...courseAttendance.map((attendance) => ({
      id: `attendance-${attendance.id}`,
      label: 'คาบเช็คชื่อ',
      body: attendance.title,
      created_at: attendance.starts_at || new Date().toISOString()
    })),
  ].sort((a, b) => (new Date(b.created_at).getTime() || 0) - (new Date(a.created_at).getTime() || 0));

  return (
    <div className="flex-1 flex flex-col pb-12 font-sans bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top LINE LIFF Status Bar */}
      <div className="sticky top-0 z-40 bg-[#06C755] text-white px-4 py-2.5 pt-[max(env(safe-area-inset-top),0.625rem)] flex items-center justify-between text-xs font-bold shadow-sm">
        {/* Clickable Pudding Brand -> Links to Overview */}
        <button
          type="button"
          onClick={() => {
            setSelectedClassroom(null);
            setActiveAssignment(null);
          }}
          className="flex items-center gap-2 hover:opacity-85 transition-opacity cursor-pointer group"
          title="กลับหน้าภาพรวม (Overview)"
        >
          <span className="text-lg select-none group-hover:scale-110 transition-transform">🍮</span>
          <span className="font-black text-sm tracking-tight">พุดดิ้ง (Pudding)</span>
        </button>

        {/* Top-Right Username & Profile Badge */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="flex items-center gap-1.5 bg-black/20 hover:bg-black/25 px-2.5 py-1 rounded-full backdrop-blur-xs transition-colors">
            <img
              src={currentStudent.avatar}
              alt=""
              className="w-5 h-5 rounded-full object-cover ring-1 ring-white/60"
            />
            <span className="max-w-24 sm:max-w-32 truncate text-[11px] font-bold">
              {currentStudent.first_name || currentStudent.name}
            </span>
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
              className="text-[10px] text-emerald-100 hover:text-white underline cursor-pointer ml-0.5"
              title="แก้ไขรหัสนักเรียน / ข้อมูล"
            >
              {currentStudent.student_id ? `(${currentStudent.student_id})` : 'ใส่รหัส'}
            </button>
          </div>

          <button
            onClick={handleLineLogout}
            title="ออกจากระบบ"
            className="p-1.5 rounded-xl text-emerald-100 hover:text-white hover:bg-black/15 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Floating Away Warning Toast */}
      {awayWarningToast && (
        <div className="fixed top-16 left-4 right-4 z-50 p-3.5 rounded-2xl bg-rose-600 text-white shadow-2xl flex items-center gap-3 animate-bounce">
          <ShieldAlert className="w-6 h-6 shrink-0" />
          <p className="text-xs font-bold leading-snug">{awayWarningToast}</p>
        </div>
      )}

      {/* Join Message Banner */}
      {joinMessage && (
        <div className="mx-4 mt-3 p-3 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-200 text-xs font-bold text-center border border-emerald-300 dark:border-emerald-800">
          {joinMessage}
        </div>
      )}

      {/* Classroom Selector Pills (Hidden during exam) */}
      {!activeAssignment && (
        <div className="px-4 py-3 bg-slate-100 dark:bg-slate-900/60 flex items-center justify-between gap-2 overflow-x-auto">
          <div className="flex items-center gap-1.5 flex-1 overflow-x-auto py-0.5">
            {classrooms.length === 0 ? (
              <span className="text-xs text-slate-500 italic px-2">ยังไม่มีห้องเรียนที่เข้าร่วม</span>
            ) : (
              classrooms.map((cls) => {
                const isSelected = selectedClassroom?.id === cls.id;
                const isClassPending = cls.pending_students?.some(
                  (s) => s.id === currentStudent?.id || s.line_uid === currentStudent?.line_uid
                );
                return (
                  <button
                    key={cls.id}
                    onClick={() => setSelectedClassroom(cls)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-1.5 ${isSelected
                      ? "bg-[#06C755] text-white shadow-xs"
                      : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                      }`}
                  >
                    <span>{cls.name}</span>
                    {isClassPending && (
                      <span className="px-1.5 py-0.2 rounded-md bg-amber-400 text-slate-950 text-[10px] font-black">
                        รออนุมัติ
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          <button
            onClick={() => setIsJoinModalOpen(true)}
            className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#06C755] text-white hover:bg-[#05b34c] flex items-center gap-1 shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>เข้าร่วม</span>
          </button>
        </div>
      )}

      {/* ============================================================== */}
      {/* STUDENT PORTAL VIEWS */}
      {/* ============================================================== */}
      {!activeAssignment ? (
        !selectedClassroom ? (
          /* ============================================================ */
          /* 1. OVERVIEW PAGE (หน้าภาพรวม - ไม่มี menubar แสดงแค่ภาพรวม) */
          /* ============================================================ */
          <div className="p-4 space-y-4 pb-16">
            {/* 1. Active Check-In Shortcut Banner (1-Click Check-In from Overview) */}
            {activeAttendanceList.length > 0 && (
              <div className="space-y-2.5">
                {activeAttendanceList.map((item) => (
                  <div
                    key={item.session.id}
                    className={`p-4 rounded-3xl border transition-all flex flex-wrap items-center justify-between gap-3 shadow-sm ${
                      item.checkedIn
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800'
                        : 'bg-linear-to-r from-emerald-500/15 via-teal-500/15 to-emerald-500/10 border-emerald-400 dark:border-emerald-700 ring-2 ring-emerald-400/30 animate-pulse'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`w-2.5 h-2.5 rounded-full ${item.checkedIn ? 'bg-emerald-500' : 'bg-emerald-500 animate-ping'}`} />
                        <span className="text-[11px] font-black uppercase text-emerald-700 dark:text-emerald-300">
                          {item.checkedIn ? 'เช็คชื่อเรียบร้อยแล้ว' : '⏰ กำลังเปิดรับเช็คชื่อ (ด่วน)'}
                        </span>
                      </div>
                      <h3 className="text-sm font-black text-slate-900 dark:text-white truncate">
                        {item.session.title}
                      </h3>
                      <p className="text-[11px] text-slate-500 truncate">
                        {item.classroom.name} • เริ่ม {new Date(item.session.starts_at).toLocaleTimeString('th-TH')}
                      </p>
                    </div>

                    {item.checkedIn ? (
                      <span className="px-3.5 py-1.5 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-xs font-black">
                        เช็คชื่อแล้ว 🟢
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={isCheckingIn}
                        onClick={() => handleStudentCheckIn(item.session.id, item.classroom.id)}
                        className="px-4 py-2 rounded-xl bg-[#06C755] hover:bg-[#05b34c] text-white font-black text-xs shadow-md transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
                      >
                        <span>⚡ กดเช็คชื่อทันที</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 2. Urgent Online Exams Shortcut Section (1-Click Exam Start) */}
            {pendingExams.length > 0 && (
              <section className="bg-linear-to-br from-purple-500/10 via-purple-500/5 to-transparent rounded-3xl border border-purple-200 dark:border-purple-900/60 p-4 space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-black text-purple-900 dark:text-purple-200 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    <span>ข้อสอบออนไลน์ที่ต้องทำ ({pendingExams.length})</span>
                  </h2>
                  <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400">เริ่มทำได้เลย</span>
                </div>

                <div className="space-y-2">
                  {pendingExams.map((exam) => {
                    const examClass = classrooms.find((c) => c.id === exam.classroom_id);
                    return (
                      <div
                        key={exam.id}
                        className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-800 flex items-center justify-between gap-3 shadow-xs"
                      >
                        <div className="min-w-0">
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                            ข้อสอบ
                          </span>
                          <p className="text-xs font-black text-slate-900 dark:text-white truncate mt-1">
                            {exam.title}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate">
                            {examClass?.name || 'รายวิชา'} • คะแนนเต็ม {exam.total_points || 20}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            if (examClass) setSelectedClassroom(examClass);
                            handleOpenAssignment(exam);
                          }}
                          className="px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-black text-xs shrink-0 cursor-pointer shadow-xs transition-transform active:scale-95"
                        >
                          ทำข้อสอบ ⚡
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 3. Summary Cards */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setIsHomeworkListOpen((prev) => !prev)}
                className="text-left p-4 rounded-3xl bg-linear-to-br from-amber-500/15 to-amber-500/5 border border-amber-200/80 dark:border-amber-900/40 cursor-pointer hover:border-amber-400 transition-all"
              >
                <p className="text-xs font-bold text-amber-700 dark:text-amber-300">งานที่ต้องทำ</p>
                <p className="text-2xl font-black text-amber-600 mt-1">{pendingAssignments.length}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">คลิกเพื่อดูการบ้านค้าง</p>
              </button>
              <div className="p-4 rounded-3xl bg-linear-to-br from-emerald-500/15 to-emerald-500/5 border border-emerald-200/80 dark:border-emerald-900/40">
                <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">ส่งแล้ว</p>
                <p className="text-2xl font-black text-emerald-600 mt-1">{completedAssignments.length}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">ตรวจแล้ว / รอผล</p>
              </div>
            </div>

            {/* 4. Collapsible Pending Homework Section */}
            {pendingHomework.length > 0 && isHomeworkListOpen && (
              <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-xs">
                <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-500" />
                    <h2 className="text-xs font-black text-slate-900 dark:text-white">
                      รายการการบ้านค้างส่ง ({pendingHomework.length} ชิ้น)
                    </h2>
                  </div>
                  <button
                    onClick={() => setIsHomeworkListOpen(false)}
                    className="text-[10px] text-slate-400 font-bold hover:text-slate-600"
                  >
                    ซ่อน ▲
                  </button>
                </div>

                <div className="space-y-2">
                  {pendingHomework.map((hw) => {
                    const hwClass = classrooms.find((c) => c.id === hw.classroom_id);
                    return (
                      <div
                        key={hw.id}
                        className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {hw.title}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate">
                            {hwClass?.name || 'รายวิชา'} • กำหนดส่ง {new Date(hw.due_date).toLocaleDateString('th-TH')}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (hwClass) setSelectedClassroom(hwClass);
                            handleOpenAssignment(hw);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs shrink-0 cursor-pointer shadow-xs transition-transform active:scale-95"
                        >
                          ส่งงาน ✍️
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* My Enrolled Classrooms / Courses */}
            <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[#06C755]" />
                  <span>รายวิชาของฉัน ({classrooms.length})</span>
                </h2>
                <span className="text-[11px] font-bold text-slate-400">กดเพื่อเข้าห้องเรียน</span>
              </div>

              {classrooms.length === 0 ? (
                <div className="text-center py-8 space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-2xl flex items-center justify-center mx-auto">
                    🎒
                  </div>
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-400">ยังไม่ได้เข้าร่วมห้องเรียนใดๆ</p>
                  <button
                    onClick={() => setIsJoinModalOpen(true)}
                    className="px-4 py-2 rounded-xl bg-[#06C755] text-white text-xs font-bold cursor-pointer"
                  >
                    + ใส่รหัสเพื่อเข้าร่วมห้องเรียน
                  </button>
                </div>
              ) : (
                <div className="grid gap-3">
                  {classrooms.map((cls) => {
                    const classAssignments = assignments.filter((a) => a.classroom_id === cls.id);
                    const classPending = classAssignments.filter((a) => !submissions[a.id]);
                    return (
                      <button
                        key={cls.id}
                        onClick={() => {
                          setSelectedClassroom(cls);
                          loadClassroomPosts(cls, currentStudent.line_uid);
                          setCourseTab('timeline');
                        }}
                        className="w-full text-left p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/80 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 border border-slate-200/80 dark:border-slate-700/80 hover:border-[#06C755] transition-all cursor-pointer flex items-center justify-between gap-3 shadow-xs"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
                            {cls.subject_code || 'COURSE'} • ภาคเรียน {cls.academic_year || 'ปัจจุบัน'}
                          </p>
                          <h3 className="text-sm font-black text-slate-900 dark:text-white truncate">
                            {cls.name} {cls.course_name ? `(${cls.course_name})` : ''}
                          </h3>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {classPending.length > 0 ? (
                            <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              มีงานค้าง {classPending.length}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                              ส่งครบแล้ว
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Recent Classroom Posts Feed */}
            {classroomPosts.length > 0 && (
              <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-3 shadow-xs">
                <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-amber-500" />
                  <span>ประกาศล่าสุดจากคุณครู</span>
                </h2>
                <div className="space-y-2.5">
                  {classroomPosts.slice(0, 5).map((post) => (
                    <article key={post.id} className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 space-y-1">
                      <p className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">{post.body}</p>
                      <p className="text-[10px] text-slate-400">{new Date(post.created_at).toLocaleString('th-TH')}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          /* ============================================================ */
          /* 2. COURSE DETAIL PAGE (เมื่อกดเข้ารายวิชา - มี bottom bar) */
          /* ============================================================ */
          <div className="p-4 space-y-4 pb-28">
            {/* Top Course Navigation Bar */}
            <div className="flex items-center justify-between gap-3 bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <button
                onClick={() => setSelectedClassroom(null)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-[#06C755] cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>กลับสู่ภาพรวม</span>
              </button>
              <div className="text-right min-w-0">
                <h2 className="text-xs font-black text-slate-900 dark:text-white truncate">
                  {selectedClassroom.course_name || selectedClassroom.subject_code || 'รายวิชา'}
                </h2>
                <p className="text-[10px] text-slate-400 truncate">{selectedClassroom.name}</p>
              </div>
            </div>

            {/* TAB 2.1: TIMELINE (ประวัติการโพสต์ของครู ทั้งประกาศ งาน ข้อสอบ เช็คชื่อ) */}
            {courseTab === 'timeline' && (
              <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-xs">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                    <Megaphone className="w-4 h-4 text-amber-500" />
                    <span>ไทม์ไลน์และประวัติการโพสต์ของครู</span>
                  </h3>
                  <span className="text-[10px] font-bold text-slate-400">{studentTimeline.length} รายการ</span>
                </div>

                <div className="space-y-4">
                  {studentTimeline.map((item) => (
                    <div key={item.id} className="relative pl-6 pb-3 border-l-2 border-slate-200 dark:border-slate-800 last:border-l-0 last:pb-0">
                      <span className="absolute -left-1.5 top-1 w-3 h-3 rounded-full bg-[#06C755] ring-4 ring-emerald-100 dark:ring-emerald-950" />
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                            {item.label}
                          </span>
                          <time className="text-[10px] text-slate-400 whitespace-nowrap">
                            {new Date(item.created_at).toLocaleString('th-TH')}
                          </time>
                        </div>
                        <p className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                          {item.body}
                        </p>
                      </div>
                    </div>
                  ))}
                  {!studentTimeline.length && (
                    <p className="text-xs text-slate-400 text-center py-8">ยังไม่มีประวัติการโพสต์ในวิชานี้</p>
                  )}
                </div>
              </section>
            )}

            {/* TAB 2.2: WORK & EXAMS (งาน / ข้อสอบ จัดหมวดหมู่ตามครู + คะแนน + ฟีดแบค) */}
            {courseTab === 'work' && (
              <section className="space-y-4">
                {Object.entries(
                  pendingAssignments.concat(completedAssignments).reduce<Record<string, Assignment[]>>((groups, item) => {
                    const key = item.group_name || (item.is_exam ? 'ข้อสอบ' : 'งานทั่วไป');
                    (groups[key] ||= []).push(item);
                    return groups;
                  }, {})
                ).map(([group, items]) => (
                  <div key={group} className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-3 shadow-xs">
                    <h3 className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5 border-b border-slate-100 dark:border-slate-800 pb-2">
                      <Layers className="w-3.5 h-3.5 text-[#06C755]" />
                      <span>{group}</span>
                      <span className="text-[10px] text-slate-400 font-normal">({items.length} รายการ)</span>
                    </h3>

                    <div className="space-y-2.5">
                      {items.map((assignment) => {
                        const submission = submissions[assignment.id];
                        const isSubmitted = Boolean(submission);
                        const isGraded = submission?.total_score !== undefined;
                        const dueDateObj = new Date(assignment.due_date);
                        const isLateSubmitted = isSubmitted && submission.submitted_at
                          ? new Date(submission.submitted_at).getTime() > dueDateObj.getTime()
                          : false;
                        const isPastDue = Date.now() > dueDateObj.getTime();

                        return (
                          <div
                            key={assignment.id}
                            onClick={() => {
                              if (isSubmitted) {
                                handleOpenGradedDetail(assignment, submission);
                              } else {
                                handleOpenAssignment(assignment);
                              }
                            }}
                            className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 border border-slate-200 dark:border-slate-700 hover:border-[#06C755] transition-all cursor-pointer space-y-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="text-[10px] font-bold text-slate-400">
                                  {assignment.is_exam ? '📝 ข้อสอบ' : '📋 งาน'} • คะแนนเต็ม {assignment.total_points || 20}
                                </span>
                                <h4 className="text-xs font-bold text-slate-900 dark:text-white mt-0.5">
                                  {assignment.title}
                                </h4>
                              </div>

                              {/* Prominent Score or Pending Status Badge on Card */}
                              <div className="text-right shrink-0">
                                {isGraded ? (
                                  <div className="px-2.5 py-1 rounded-xl bg-emerald-100 text-[#06C755] dark:bg-emerald-950/80 dark:text-emerald-300 text-xs font-black">
                                    คะแนน: {submission.total_score}/{assignment.total_points || 20}
                                  </div>
                                ) : isSubmitted ? (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                    ส่งแล้ว รอตรวจ
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                    ยังไม่ส่ง
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Status & Deadline Row */}
                            <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60 text-slate-500">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                {isPastDue ? (
                                  <span className="text-rose-600 font-bold">เลยกำหนดส่ง</span>
                                ) : (
                                  <span>เหลือ {minutesUntil(assignment.due_date)} นาที</span>
                                )}
                              </span>

                              <div className="flex items-center gap-1.5">
                                {isSubmitted ? (
                                  isLateSubmitted ? (
                                    <span className="text-[10px] font-bold text-amber-600">ส่งช้า ⚠️</span>
                                  ) : (
                                    <span className="text-[10px] font-bold text-emerald-600">ส่งปกติ ✅</span>
                                  )
                                ) : null}
                                <span className="text-[10px] font-bold text-[#06C755]">
                                  {isSubmitted ? 'ดูผลและฟีดแบค →' : 'เริ่มทำ →'}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {!pendingAssignments.length && !completedAssignments.length && (
                  <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 text-xs text-slate-400">
                    ยังไม่มีงานหรือข้อสอบในวิชานี้
                  </div>
                )}
              </section>
            )}

            {/* TAB 2.3: ATTENDANCE (หน้าเช็คชื่อ + ปุ่มกดเช็คชื่อ + ประวัติที่ผ่านมา) */}
            {courseTab === 'attendance' && (
              <section className="space-y-4">
                {/* Active Check-In Session Card */}
                {(() => {
                  const openSession = courseAttendance.find((s) => s.status === 'open');
                  const currentStatus = openSession ? courseAttendanceRecords[openSession.id] : null;

                  return (
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-3 shadow-xs">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                          <CalendarCheck className="w-4 h-4 text-emerald-600" />
                          <span>การเช็คชื่อปัจจุบัน</span>
                        </h3>
                        {openSession && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 animate-pulse">
                            เปิดรับอยู่
                          </span>
                        )}
                      </div>

                      {openSession ? (
                        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 space-y-3">
                          <div>
                            <p className="text-sm font-black text-slate-900 dark:text-white">{openSession.title}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              เริ่มเวลา: {new Date(openSession.starts_at).toLocaleTimeString('th-TH')} น.
                            </p>
                          </div>

                          {currentStatus ? (
                            <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 flex items-center gap-2 text-xs font-black text-emerald-600">
                              <CheckCircle2 className="w-4 h-4" />
                              <span>คุณเช็คชื่อในคาบนี้แล้ว: {statusLabels[currentStatus as AttendanceStatus] || currentStatus}</span>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 dark:text-slate-400">
                                <span>สถานะของคุณ:</span>
                                <span className="px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 text-[10px] font-black border border-slate-300 dark:border-slate-600">
                                  รอเช็คชื่อ (IDLE) ⚪
                                </span>
                              </div>
                              <button
                                onClick={() => handleStudentCheckIn(openSession.id)}
                                disabled={isCheckingIn}
                                className="w-full py-3 rounded-2xl bg-[#06C755] hover:bg-[#05b34c] text-white font-black text-xs shadow-md transition-transform active:scale-95 cursor-pointer disabled:opacity-50"
                              >
                                {isCheckingIn ? 'กำลังเช็คชื่อ...' : 'กดเช็คชื่อตอนนี้ ⏱️'}
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800 text-center text-xs text-slate-500">
                          ขณะนี้ไม่มีคาบเช็คชื่อที่เปิดรับ
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Past Attendance History */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-3 shadow-xs">
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    ประวัติการเช็คชื่อที่ผ่านมา ({courseAttendance.length})
                  </h3>

                  <div className="space-y-2">
                    {courseAttendance.map((attendance) => {
                      const recordStatus = courseAttendanceRecords[attendance.id];
                      const isSessionOpen = attendance.status === 'open';
                      return (
                        <div
                          key={attendance.id}
                          className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <p className="font-bold text-slate-900 dark:text-white">{attendance.title}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">
                              {new Date(attendance.starts_at).toLocaleString('th-TH')}
                            </p>
                          </div>
                          <div>
                            {recordStatus === 'on_time' ? (
                              <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                ตรงเวลา 🟢
                              </span>
                            ) : recordStatus === 'late' ? (
                              <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                มาสาย 🟡
                              </span>
                            ) : recordStatus === 'excused' ? (
                              <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                                ลา 🔵
                              </span>
                            ) : recordStatus === 'absent' ? (
                              <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                ขาด 🔴
                              </span>
                            ) : isSessionOpen ? (
                              <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600">
                                รอเช็คชื่อ (IDLE) ⚪
                              </span>
                            ) : (
                              <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                ขาด 🔴
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {!courseAttendance.length && (
                      <p className="text-xs text-slate-400 text-center py-6">ยังไม่มีประวัติการเช็คชื่อ</p>
                    )}
                  </div>
                </div>
              </section>
            )}

            {/* FIXED BOTTOM NAVIGATION BAR FOR COURSE (เมื่อเข้ามาในวิชา) */}
            <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 px-6 py-2 flex items-center justify-around shadow-xl">
              <button
                onClick={() => setCourseTab('timeline')}
                className={`flex flex-col items-center gap-1 py-1 px-4 rounded-2xl text-[11px] font-bold transition-all cursor-pointer ${
                  courseTab === 'timeline'
                    ? 'text-[#06C755] font-black scale-105'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                }`}
              >
                <Megaphone className="w-5 h-5" />
                <span>ไทม์ไลน์</span>
              </button>
              <button
                onClick={() => setCourseTab('work')}
                className={`flex flex-col items-center gap-1 py-1 px-4 rounded-2xl text-[11px] font-bold transition-all cursor-pointer ${
                  courseTab === 'work'
                    ? 'text-[#06C755] font-black scale-105'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                }`}
              >
                <BookOpen className="w-5 h-5" />
                <span>งาน / ข้อสอบ</span>
              </button>
              <button
                onClick={() => setCourseTab('attendance')}
                className={`flex flex-col items-center gap-1 py-1 px-4 rounded-2xl text-[11px] font-bold transition-all cursor-pointer ${
                  courseTab === 'attendance'
                    ? 'text-[#06C755] font-black scale-105'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                }`}
              >
                <CalendarCheck className="w-5 h-5" />
                <span>เช็คชื่อ</span>
              </button>
            </div>
          </div>
        )
      ) : (

        /* ACTIVE TAKING EXAM/ASSIGNMENT VIEW */
        <div className="p-4 space-y-4 pb-32">
          {/* Top Bar with Back and Anti-Cheating Pill */}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => {
                if (confirm("ต้องการออกจากหน้าข้อสอบหรือไม่? (ข้อมูลที่ตอบไว้จะยังไม่ถูกส่ง)")) {
                  setActiveAssignment(null);
                }
              }}
              className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            {/* LIVE ANTI-CHEATING STATUS PILL */}
            <div
              className={`flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold border ${tabSwitchCount > 0
                ? "bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800"
                : "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800"
                }`}
            >
              {tabSwitchCount > 0 ? (
                <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              )}
              <span>
                ตรวจจับจอ: ออก {tabSwitchCount} ครั้ง ({totalAwaySeconds}s)
              </span>
            </div>
          </div>

          {submissionSuccess ? (
            <div className="my-auto text-center space-y-4 p-6 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-md">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-[#06C755] mx-auto flex items-center justify-center text-3xl font-black">
                ✓
              </div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">
                ส่งข้อสอบเรียบร้อยแล้ว!
              </h2>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                ระบบได้บันทึกคำตอบและรายงานความซื่อสัตย์ส่งถึงอาจารย์ผู้สอนแล้ว
              </p>
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                <p>จำนวนครั้งที่สลับหน้าจอ: <b>{tabSwitchCount} ครั้ง</b></p>
                <p>เวลารวมที่อยู่นอกจอ: <b>{totalAwaySeconds} วินาที</b></p>
              </div>
              <button
                onClick={() => setActiveAssignment(null)}
                className="w-full py-3 rounded-2xl bg-[#06C755] text-white font-bold text-xs shadow-md cursor-pointer"
              >
                กลับสู่หน้าหลัก
              </button>
            </div>
          ) : (
            <>
              {/* Exam Header Card */}
              <div className="p-4 rounded-3xl bg-linear-to-r from-amber-500/10 via-orange-500/10 to-yellow-500/10 border border-amber-200 dark:border-amber-900/50 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase text-amber-800 dark:text-amber-300">
                    {activeAssignment.is_exam ? "ข้อสอบออนไลน์" : "ใบงาน"}
                  </span>
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
                    คะแนนเต็ม: {activeAssignment.total_points || 20}
                  </span>
                </div>
                <h1 className="text-base font-black text-slate-900 dark:text-white">
                  {activeAssignment.title}
                </h1>
                {activeAssignment.description && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {activeAssignment.description}
                  </p>
                )}
              </div>

              {/* Questions List */}
              <div className="space-y-5">
                {activeQuestions.map((q, idx) => {
                  const isFileUpload = q.type === 'file_upload' || (q as any).allow_upload || (q as any).requires_file;
                  const isChoice = (q.type === 'multiple_choice' || q.type === 'true_false') && Array.isArray(q.options) && q.options.length > 0;
                  const currentAnswer = studentAnswers[q.id]?.text || "";

                  return (
                    <div
                      key={q.id}
                      className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-slate-400">
                            ข้อที่ {idx + 1} จาก {activeQuestions.length} {isFileUpload ? '• แนบไฟล์' : isChoice ? '• ปรนัย' : ''}
                          </span>
                          <p className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                            {q.question_text}
                          </p>
                        </div>
                        <span className="text-xs font-bold text-amber-600 shrink-0">
                          ({q.max_score} คะแนน)
                        </span>
                      </div>

                      {/* Choice Options for multiple_choice / true_false */}
                      {isChoice && (
                        <div className="space-y-2 pt-1">
                          <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400">
                            เลือกคำตอบ:
                          </label>
                          <div className="grid gap-2">
                            {q.options!.map((opt, optIdx) => {
                              const isSelected = currentAnswer === opt;
                              return (
                                <button
                                  type="button"
                                  key={optIdx}
                                  onClick={() =>
                                    setStudentAnswers((prev) => ({
                                      ...prev,
                                      [q.id]: { ...prev[q.id], text: opt },
                                    }))
                                  }
                                  className={`p-3 rounded-2xl text-left text-xs font-bold transition-all border flex items-center gap-2.5 cursor-pointer ${
                                    isSelected
                                      ? "bg-emerald-50 dark:bg-emerald-950/40 border-[#06C755] text-emerald-900 dark:text-emerald-200 ring-2 ring-[#06C755]/30"
                                      : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-400"
                                  }`}
                                >
                                  <span
                                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                                      isSelected
                                        ? "bg-[#06C755] text-white"
                                        : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                                    }`}
                                  >
                                    {String.fromCharCode(65 + optIdx)}
                                  </span>
                                  <span className="flex-1">{opt}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Text Answer Input (For non-choice or open questions) */}
                      {!isChoice && (
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400">
                            {isFileUpload ? "คำอธิบายประกอบไฟล์ (ถ้ามี):" : "พิมพ์คำตอบของคุณ:"}
                          </label>
                          <textarea
                            rows={isFileUpload ? 2 : 3}
                            value={currentAnswer}
                            onChange={(e) =>
                              setStudentAnswers((prev) => ({
                                ...prev,
                                [q.id]: { ...prev[q.id], text: e.target.value },
                              }))
                            }
                            placeholder={isFileUpload ? "พิมพ์คำอธิบายประกอบการแนบไฟล์..." : "พิมพ์เนื้อหาคำตอบ หรือข้อความอธิบายที่นี่..."}
                            className="w-full p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                          />
                        </div>
                      )}

                      {/* Attachments: File & Image Upload ONLY IF required or allowed for this question */}
                      {isFileUpload && (
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end">
                          <label className="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors">
                            <Upload className="w-3.5 h-3.5 text-blue-500" />
                            <span>แนบรูป / ไฟล์งาน</span>
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              onChange={(e) => {
                                if (e.target.files?.[0]) {
                                  handleFileUpload(q.id, e.target.files[0]);
                                }
                              }}
                              className="hidden"
                            />
                          </label>
                        </div>
                      )}

                      {studentAnswers[q.id]?.file_url && (
                        <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span className="truncate">อัปโหลดไฟล์แล้ว: {studentAnswers[q.id]?.file_url}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Submit Final Button */}
              <div className="pt-4 sticky bottom-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSubmitTask}
                  className="w-full py-3.5 rounded-2xl bg-linear-to-r from-emerald-600 to-[#06C755] hover:from-emerald-700 hover:to-[#05b34c] text-white font-black text-sm shadow-xl shadow-emerald-600/30 flex items-center justify-center gap-2 transition-transform active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>{isSubmitting ? "กำลังส่งข้อสอบ..." : "ส่งข้อสอบ / ยืนยันการส่งงาน"}</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* MANDATORY / EDITABLE STUDENT PROFILE ONBOARDING MODAL */}
      {isStudentIdModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4 border border-slate-200 dark:border-slate-800">
            <div className="text-center space-y-1.5">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-[#06C755] flex items-center justify-center text-xl mx-auto font-black shadow-xs">
                🎓
              </div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {isFirstTimeStudentId ? "ลงทะเบียนข้อมูลนักเรียน" : "แก้ไขข้อมูลนักเรียน"}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {isFirstTimeStudentId
                  ? "กรุณาระบุชื่อ-นามสกุลจริง รหัสนักเรียน และเลือกสถานศึกษา เพื่อยืนยันตัวตนก่อนเข้าสู่ระบบห้องเรียน"
                  : "แก้ไขข้อมูลส่วนตัวของคุณเพื่อให้ตรงกับทะเบียนโรงเรียน"}
              </p>
            </div>

            <div className="space-y-3">
              {/* First Name & Last Name */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    ชื่อจริง <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={inputFirstName}
                    onChange={(e) => setInputFirstName(e.target.value)}
                    placeholder="เช่น กัญญาณัฐ"
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-[#06C755] focus:outline-hidden font-medium"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    นามสกุล <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={inputLastName}
                    onChange={(e) => setInputLastName(e.target.value)}
                    placeholder="เช่น มีชัย"
                    className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-[#06C755] focus:outline-hidden font-medium"
                  />
                </div>
              </div>

              {/* Student ID */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    รหัสนักเรียน / รหัสนักศึกษา <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400">ขั้นต่ำ 3 หลัก (เช่น 541 หรือ 54101)</span>
                </div>
                <input
                  type="text"
                  required
                  value={inputStudentId}
                  onChange={(e) => setInputStudentId(e.target.value.trim())}
                  placeholder="เช่น 54101 หรือ 66010123"
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-[#06C755] focus:outline-hidden"
                />
              </div>

              {/* Institution Search Dropdown */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  สถานศึกษา / โรงเรียน <span className="text-rose-500">*</span>
                </label>
                <InstitutionSearchSelect
                  value={inputInstitution}
                  onChange={setInputInstitution}
                  extraInstitutions={registeredInstitutions}
                  placeholder="ค้นหาและเลือกโรงเรียน / สถาบันของคุณ..."
                />
                <p className="text-[10px] text-slate-400">
                  เลือกจากรายชื่อมาตรฐานในระบบเพื่อป้องกันชื่อโรงเรียนสะกดไม่ตรงกัน
                </p>
              </div>

              {/* Optional email */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  อีเมล <span className="font-normal text-slate-400">(ไม่บังคับ)</span>
                </label>
                <input
                  type="email"
                  value={inputEmail}
                  onChange={(e) => setInputEmail(e.target.value)}
                  placeholder="เช่น student@example.com"
                  className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-[#06C755] focus:outline-hidden"
                />
                {inputEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inputEmail.trim()) && (
                  <p className="text-[10px] text-rose-500">รูปแบบอีเมลไม่ถูกต้อง เช่น student@example.com</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              {!isFirstTimeStudentId && (
                <button
                  type="button"
                  disabled={isSavingStudentId}
                  onClick={() => setIsStudentIdModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer"
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
                className="flex-1 py-2.5 rounded-xl bg-[#06C755] hover:bg-[#05b34c] text-white text-xs font-bold shadow-md cursor-pointer disabled:opacity-50 transition-all"
              >
                {isSavingStudentId ? "กำลังบันทึก..." : "บันทึกข้อมูลนักเรียน"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* JOIN CLASSROOM MODAL */}
      {isJoinModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-black text-slate-900 dark:text-white">
              เข้าร่วมห้องเรียนด้วยรหัส
            </h3>
            <p className="text-xs text-slate-500">
              กรอกรหัสเชิญเข้าห้องเรียนที่ได้รับจากอาจารย์ (เช่น THAI-401)
            </p>
            <input
              type="text"
              value={joinInviteCode}
              onChange={(e) => setJoinInviteCode(e.target.value.toUpperCase())}
              placeholder="รหัสเชิญ เช่น THAI-401"
              className="w-full p-3 rounded-2xl border border-slate-300 dark:border-slate-700 uppercase font-mono font-bold text-center text-sm"
            />
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsJoinModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleJoinClassroom}
                className="flex-1 py-2.5 rounded-xl bg-[#06C755] text-white text-xs font-bold cursor-pointer"
              >
                เข้าร่วมห้อง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GRADED RESULT & RUBRIC DETAIL MODAL */}
      {viewingGradedSub && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="p-2 rounded-xl bg-emerald-100 text-[#06C755] text-lg">
                  🏆
                </span>
                <div>
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    ผลการประเมินและคะแนน
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {viewingGradedSub.assignment.title}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewingGradedSub(null)}
                className="text-xs font-bold p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕ ปิด
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center space-y-1">
              <span className="text-3xl font-black text-[#06C755]">
                {viewingGradedSub.submission.total_score} / {viewingGradedSub.assignment.total_points || 20}
              </span>
              <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                คิดเป็น {Math.round(((viewingGradedSub.submission.total_score || 0) / (viewingGradedSub.assignment.total_points || 20)) * 100)}%
              </p>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-600 dark:text-slate-300">
                รายละเอียดคะแนนและข้อเสนอแนะรายข้อ:
              </h4>
              {viewingGradedSub.questions.map((q, i) => {
                const ans = viewingGradedSub.answers[q.id];
                return (
                  <div
                    key={q.id}
                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span>ข้อ {i + 1}: {q.question_text}</span>
                      <span className="text-[#06C755] font-black">
                        {ans?.teacher_score ?? ans?.ai_mock_score ?? 0} / {q.max_score} คะแนน
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-[11px]">
                      <b>คำตอบของคุณ:</b> {ans?.text_answer || "(ไม่มีข้อความ)"}
                    </div>

                    {ans?.teacher_comment && (
                      <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-[11px]">
                        <b>💬 ความเห็นครูผู้สอน:</b> {ans.teacher_comment}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => setViewingGradedSub(null)}
              className="w-full py-3 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xs cursor-pointer"
            >
              ตกลง
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
