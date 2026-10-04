"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  CheckCircle2,
  Clock,
  Mic,
  MicOff,
  Upload,
  ChevronRight,
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  Send,
  PlusCircle,
  BookOpen,
  LogOut,
  LogIn,
  AlertCircle,
  Loader2,
  Sparkles,
} from "lucide-react";
import { dataService } from "@/lib/supabase/dataService";
import { Classroom, Assignment, Question, Submission, SubmissionAnswer } from "@/types/database";

interface RealLineStudent {
  id: string; // LINE userId
  name: string; // LINE displayName
  line_uid: string;
  avatar: string;
}

export default function LiffStudentPage() {
  // LINE LIFF & Auth State
  const [liffId, setLiffId] = useState<string>("");
  const [authStatus, setAuthStatus] = useState<"loading" | "unauthenticated" | "authenticated" | "error">("loading");
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
  const [isInLineClient, setIsInLineClient] = useState(false);
  const [liffInstance, setLiffInstance] = useState<any>(null);
  const [currentStudent, setCurrentStudent] = useState<RealLineStudent | null>(null);

  // Data State
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [isLoadingData, setIsLoadingData] = useState(false);

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

  // Voice Recording State
  const [recordingQuestionId, setRecordingQuestionId] = useState<string | null>(null);
  const [audioUrlMap, setAudioUrlMap] = useState<Record<string, string>>({});
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Join Classroom Code Modal
  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [joinInviteCode, setJoinInviteCode] = useState("");
  const [joinMessage, setJoinMessage] = useState<string | null>(null);

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
          // Check if user explicitly logged out previously
          const explicitlyLoggedOut = typeof window !== "undefined" && sessionStorage.getItem("pudding_liff_logged_out") === "true";

          if (inClient) {
            // Inside LINE App: Auto-login silently
            liff.login();
            return;
          } else if (!explicitlyLoggedOut) {
            // Outside LINE App: Auto-redirect to LINE Login directly as requested
            liff.login({ redirectUri: window.location.href });
            return;
          }

          // If auto-redirect didn't fire (e.g. explicitly logged out or blocked), show Login Gate
          setAuthStatus("unauthenticated");
          return;
        }

        // Successfully Logged In: Retrieve real LINE user profile
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("pudding_liff_logged_out");
        }

        const profile = await liff.getProfile();
        const realStudent: RealLineStudent = {
          id: profile.userId,
          name: profile.displayName || "นักเรียน LINE",
          line_uid: profile.userId,
          avatar: profile.pictureUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120",
        };

        if (!isMounted) return;
        setCurrentStudent(realStudent);

        // Real sync of LINE profile into Supabase users table
        await dataService.syncLineStudentUser({
          line_uid: profile.userId,
          name: profile.displayName || "นักเรียน LINE",
          avatar: profile.pictureUrl || null,
          student_id: profile.userId.substring(0, 8),
        });

        setAuthStatus("authenticated");
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

  // 2. Load Classrooms, Assignments, and Submissions for Authenticated Student
  useEffect(() => {
    if (authStatus !== "authenticated" || !currentStudent) return;

    async function loadData() {
      if (!currentStudent) return;
      setIsLoadingData(true);
      try {
        const classes = await dataService.getClassrooms();
        setClassrooms(classes);

        // Check URL params for invite code or classId
        const params = new URLSearchParams(window.location.search);
        const codeParam = params.get("code");
        const classIdParam = params.get("classId");

        let active = classes[0] || null;
        if (classIdParam) {
          const matched = classes.find((c) => c.id === classIdParam);
          if (matched) active = matched;
        } else if (codeParam) {
          const matched = classes.find((c) => c.invite_code?.toLowerCase() === codeParam.toLowerCase());
          if (matched) active = matched;
        }

        setSelectedClassroom(active);

        // Auto-enroll if arrived via invite code or classId link
        if (active && (codeParam || classIdParam)) {
          const names = currentStudent.name.split(" ");
          await dataService.addStudentToClassroom(active.id, {
            id: currentStudent.line_uid,
            first_name: names[0] || currentStudent.name,
            last_name: names.slice(1).join(" ") || "",
            student_id: currentStudent.line_uid.substring(0, 8),
            avatar_url: currentStudent.avatar,
            line_uid: currentStudent.line_uid,
          });
          setJoinMessage(`🎉 คุณได้เข้าร่วมห้องเรียน "${active.name}" เรียบร้อยแล้ว!`);
        }

        // Load assignments
        const allAssigns = await dataService.getAssignments();
        setAssignments(allAssigns);

        // Load existing submissions for this real LINE student
        const subMap: Record<string, Submission> = {};
        for (const a of allAssigns) {
          const subs = await dataService.getSubmissions(a.id);
          const found = subs.find((s) => s.student_id === currentStudent.id || s.student_id === currentStudent.line_uid);
          if (found) subMap[a.id] = found;
        }
        setSubmissions(subMap);
      } catch (err) {
        console.error("Failed to load student data:", err);
      } finally {
        setIsLoadingData(false);
      }
    }

    loadData();
  }, [authStatus, currentStudent]);

  // When opening an assignment, fetch questions
  const handleOpenAssignment = async (a: Assignment) => {
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
            `⚠️ ตรวจพบการออกจากหน้าจอเป็นเวลา ${durationSec} วินาที (ครั้งที่ ${tabSwitchCount + 1}) — ข้อมูลนี้ถูกบันทึกและส่งให้อาจารย์ผู้สอนแล้ว`
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

  // Voice Recorder Handler
  const startRecording = async (questionId: string) => {
    if (!currentStudent) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const localUrl = URL.createObjectURL(audioBlob);
        setAudioUrlMap((prev) => ({ ...prev, [questionId]: localUrl }));

        try {
          const formData = new FormData();
          formData.append("file", audioBlob, `voice_${questionId}_${Date.now()}.webm`);
          formData.append("assignment_id", activeAssignment?.id || "general");
          formData.append("student_id", currentStudent.id);

          const res = await fetch("/api/upload", {
            method: "POST",
            body: formData,
          });
          const json = await res.json();
          if (json.url) {
            setStudentAnswers((prev) => ({
              ...prev,
              [questionId]: {
                text: prev[questionId]?.text || "บันทึกเสียงส่งงาน",
                file_url: json.url,
              },
            }));
          }
        } catch (uploadErr) {
          console.error("Audio R2 upload failed:", uploadErr);
        }
      };

      mediaRecorder.start();
      setRecordingQuestionId(questionId);
      setRecordingSeconds(0);

      timerIntervalRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      alert("กรุณาอนุญาตการใช้งานไมโครโฟนเพื่อบันทึกเสียง");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
    setRecordingQuestionId(null);
  };

  // Image / File Upload Handler
  const handleFileUpload = async (questionId: string, file: File) => {
    if (!currentStudent) return;
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("assignment_id", activeAssignment?.id || "general");
      formData.append("student_id", currentStudent.id);

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
      const answersPayload = activeQuestions.map((q) => ({
        question_id: q.id,
        answer_text: studentAnswers[q.id]?.text || "",
        file_url: studentAnswers[q.id]?.file_url,
      }));

      const sub = await dataService.submitStudentWork({
        assignment_id: activeAssignment.id,
        student_id: currentStudent.id,
        student_name: currentStudent.name,
        answers: answersPayload,
        antiCheating: {
          tab_switch_count: tabSwitchCount,
          away_time_seconds: totalAwaySeconds,
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
    const matched = classrooms.find(
      (c) => c.invite_code?.toLowerCase() === joinInviteCode.trim().toLowerCase()
    );
    if (matched) {
      const names = currentStudent.name.split(" ");
      await dataService.addStudentToClassroom(matched.id, {
        id: currentStudent.line_uid,
        first_name: names[0] || currentStudent.name,
        last_name: names.slice(1).join(" ") || "",
        student_id: currentStudent.line_uid.substring(0, 8),
        email: `${currentStudent.line_uid.substring(0, 8)}@student.pudding.ac.th`,
        line_uid: currentStudent.line_uid,
        avatar_url: currentStudent.avatar,
      });
      setSelectedClassroom(matched);
      setIsJoinModalOpen(false);
      setJoinInviteCode("");
      setJoinMessage(`🎉 เข้าร่วมห้องเรียน "${matched.name}" สำเร็จ!`);
      setTimeout(() => setJoinMessage(null), 3500);
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
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 min-h-[500px]">
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
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-5 min-h-[500px]">
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
          className="px-6 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold shadow-md hover:opacity-90 active:scale-95 transition-all"
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
      <div className="flex-1 flex flex-col justify-between p-6 bg-radial from-emerald-500/10 via-transparent to-transparent text-slate-900 dark:text-white min-h-[600px]">
        {/* Top Branding */}
        <div className="pt-8 text-center space-y-4">
          <div className="relative inline-block">
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-tr from-amber-400 to-amber-200 dark:from-amber-600 dark:to-amber-400 flex items-center justify-center text-5xl shadow-2xl ring-8 ring-emerald-500/20 mx-auto">
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
  const filteredAssignments = assignments.filter((a) => {
    if (!selectedClassroom) return true;
    return a.classroom_id === selectedClassroom.id;
  });

  const pendingAssignments = filteredAssignments.filter((a) => !submissions[a.id]);
  const completedAssignments = filteredAssignments.filter((a) => Boolean(submissions[a.id]));

  return (
    <div className="flex-1 flex flex-col pb-12 font-sans bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top LINE LIFF Status Bar */}
      <div className="bg-[#06C755] text-white px-4 py-2.5 flex items-center justify-between text-xs font-bold shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-base select-none">🍮</span>
          <span className="font-extrabold tracking-tight">พุดดิ้ง • LINE LIFF</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[11px] bg-black/20 px-2.5 py-0.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-200 animate-pulse" />
            <span className="max-w-[110px] truncate">{currentStudent.name}</span>
            <button
              onClick={handleLineLogout}
              title="ออกจากระบบ"
              className="text-[10px] text-emerald-100 hover:text-white underline ml-1 cursor-pointer flex items-center gap-0.5"
            >
              <LogOut className="w-3 h-3" />
              <span>ออก</span>
            </button>
          </div>
        </div>
      </div>

      {/* Floating Away Warning Toast */}
      {awayWarningToast && (
        <div className="fixed top-12 left-4 right-4 z-50 p-3.5 rounded-2xl bg-rose-600 text-white shadow-2xl flex items-center gap-3 animate-bounce">
          <ShieldAlert className="w-6 h-6 shrink-0" />
          <p className="text-xs font-bold leading-snug">{awayWarningToast}</p>
        </div>
      )}

      {/* Real Student Profile Bar */}
      <div className="p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img
            src={currentStudent.avatar}
            alt={currentStudent.name}
            className="w-11 h-11 rounded-2xl object-cover ring-2 ring-[#06C755] shadow-xs"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-black text-slate-900 dark:text-white line-clamp-1">
                {currentStudent.name}
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                LINE ผู้ใช้จริง
              </span>
            </div>
            <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 font-medium truncate max-w-[180px]">
              UID: {currentStudent.line_uid}
            </p>
          </div>
        </div>

        <button
          onClick={handleLineLogout}
          className="text-xs text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="ออกจากระบบ"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {/* Join Message Banner */}
      {joinMessage && (
        <div className="mx-4 mt-3 p-3 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-200 text-xs font-bold text-center border border-emerald-300 dark:border-emerald-800">
          {joinMessage}
        </div>
      )}

      {/* Classroom Selector Pills */}
      <div className="px-4 py-3 bg-slate-100 dark:bg-slate-900/60 flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-1.5 flex-1 overflow-x-auto py-0.5">
          {classrooms.map((cls) => {
            const isSelected = selectedClassroom?.id === cls.id;
            return (
              <button
                key={cls.id}
                onClick={() => setSelectedClassroom(cls)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                  isSelected
                    ? "bg-[#06C755] text-white shadow-xs"
                    : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                }`}
              >
                {cls.name}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setIsJoinModalOpen(true)}
          className="shrink-0 p-1.5 rounded-xl bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 flex items-center gap-1 text-xs font-bold px-2.5 cursor-pointer"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>ใส่รหัสเข้าห้อง</span>
        </button>
      </div>

      {/* MAIN CONTENT AREA */}
      {!activeAssignment ? (
        <div className="p-4 space-y-5">
          {isLoadingData ? (
            <div className="p-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#06C755]" />
              <span>กำลังโหลดข้อมูลงานและข้อสอบ...</span>
            </div>
          ) : (
            <>
              {/* Pending Tasks Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4 text-amber-500" />
                    <span>งานและข้อสอบที่ต้องทำ ({pendingAssignments.length})</span>
                  </h2>
                </div>

                {pendingAssignments.length === 0 ? (
                  <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-2">
                    <span className="text-3xl">🎉</span>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      ไม่มีการบ้านหรือข้อสอบค้างส่ง
                    </p>
                    <p className="text-[11px] text-slate-400">คุณส่งงานครบทุกชิ้นในห้องเรียนนี้แล้ว</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingAssignments.map((a) => (
                      <div
                        key={a.id}
                        className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-all space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                                  a.is_exam
                                    ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                                    : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                }`}
                              >
                                {a.is_exam ? "📝 ข้อสอบออนไลน์" : "📋 การบ้าน / ใบงาน"}
                              </span>
                              <span className="text-[11px] text-slate-500 font-medium">
                                {a.classroom_name || selectedClassroom?.name}
                              </span>
                            </div>
                            <h3 className="font-bold text-sm text-slate-900 dark:text-white leading-snug">
                              {a.title}
                            </h3>
                          </div>
                          <span className="text-xs font-black text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2 py-1 rounded-xl">
                            {a.total_points || 20} คะแนน
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-2.5">
                          <div className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-medium">
                            <Clock className="w-3.5 h-3.5" />
                            <span>กำหนดส่ง: {new Date(a.due_date).toLocaleDateString("th-TH")}</span>
                          </div>

                          <button
                            onClick={() => handleOpenAssignment(a)}
                            className="px-4 py-2 rounded-xl bg-[#06C755] hover:bg-[#05b34c] text-white font-bold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all cursor-pointer"
                          >
                            <span>เริ่มทำข้อสอบ</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Completed Submissions Section */}
              <div className="space-y-3 pt-2">
                <h2 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span>ส่งแล้ว & ผลคะแนน ({completedAssignments.length})</span>
                </h2>

                {completedAssignments.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic">ยังไม่มีประวัติการส่งงาน</p>
                ) : (
                  <div className="space-y-2.5">
                    {completedAssignments.map((a) => {
                      const sub = submissions[a.id];
                      const hasScore = sub && sub.total_score !== undefined && sub.total_score > 0;
                      return (
                        <div
                          key={a.id}
                          onClick={() => sub && handleOpenGradedDetail(a, sub)}
                          className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 cursor-pointer hover:border-[#06C755] transition-colors"
                        >
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-slate-900 dark:text-white">
                                {a.title}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400">
                              ส่งเมื่อ: {new Date(sub?.submitted_at || sub?.started_at || "").toLocaleDateString("th-TH")}
                            </p>
                          </div>

                          <div className="text-right">
                            {hasScore ? (
                              <div className="flex items-center gap-1.5">
                                <div>
                                  <span className="text-xs font-black text-[#06C755]">
                                    {sub?.total_score} / {a.total_points || 20}
                                  </span>
                                  <p className="text-[9px] text-emerald-500 font-bold">ตรวจแล้ว • ดูผล</p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                              </div>
                            ) : (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                ส่งแล้ว รอครูตรวจ
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        /* ACTIVE TAKING EXAM/ASSIGNMENT VIEW */
        <div className="p-4 space-y-4">
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
              className={`flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold border ${
                tabSwitchCount > 0
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
              <div className="p-4 rounded-3xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-yellow-500/10 border border-amber-200 dark:border-amber-900/50 space-y-1.5">
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
                {activeQuestions.map((q, idx) => (
                  <div
                    key={q.id}
                    className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-slate-400">
                          ข้อที่ {idx + 1} จาก {activeQuestions.length}
                        </span>
                        <p className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                          {q.question_text}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-amber-600 shrink-0">
                        ({q.max_score} คะแนน)
                      </span>
                    </div>

                    {/* Text Answer Input */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400">
                        พิมพ์คำตอบของคุณ:
                      </label>
                      <textarea
                        rows={3}
                        value={studentAnswers[q.id]?.text || ""}
                        onChange={(e) =>
                          setStudentAnswers((prev) => ({
                            ...prev,
                            [q.id]: { ...prev[q.id], text: e.target.value },
                          }))
                        }
                        placeholder="พิมพ์เนื้อหาคำตอบ หรือข้อความอธิบายที่นี่..."
                        className="w-full p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                      />
                    </div>

                    {/* Multimodal Attachments: Voice & File Upload */}
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {recordingQuestionId === q.id ? (
                          <button
                            type="button"
                            onClick={stopRecording}
                            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 animate-pulse cursor-pointer"
                          >
                            <MicOff className="w-3.5 h-3.5" />
                            <span>หยุดบันทึก ({recordingSeconds}s)</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startRecording(q.id)}
                            className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer"
                          >
                            <Mic className="w-3.5 h-3.5 text-rose-500" />
                            <span>อัดเสียงอ่าน/พูด</span>
                          </button>
                        )}

                        {audioUrlMap[q.id] && (
                          <audio src={audioUrlMap[q.id]} controls className="h-7 w-32" />
                        )}
                      </div>

                      <label className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center gap-1.5 cursor-pointer">
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

                    {studentAnswers[q.id]?.file_url && (
                      <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span className="truncate">อัปโหลดไฟล์แล้ว: {studentAnswers[q.id]?.file_url}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Submit Final Button */}
              <div className="pt-4 sticky bottom-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSubmitTask}
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-[#06C755] hover:from-emerald-700 hover:to-[#05b34c] text-white font-black text-sm shadow-xl shadow-emerald-600/30 flex items-center justify-center gap-2 transition-transform active:scale-98 disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>{isSubmitting ? "กำลังส่งข้อสอบ..." : "ส่งข้อสอบ / ยืนยันการส่งงาน"}</span>
                </button>
              </div>
            </>
          )}
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
