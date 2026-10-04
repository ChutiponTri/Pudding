"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Smartphone,
  CheckCircle2,
  Clock,
  Mic,
  MicOff,
  Upload,
  ChevronRight,
  ArrowLeft,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Send,
  PlusCircle,
  BookOpen,
} from "lucide-react";
import { dataService } from "@/lib/supabase/dataService";
import { Classroom, Assignment, Question, Submission, SubmissionAnswer } from "@/types/database";

// Demo students for preview outside LINE browser
const DEMO_STUDENTS = [
  { id: "54101", name: "กัญญาดา สุขใจ", line_uid: "U1234567890abcdef1", avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120" },
  { id: "54102", name: "ณภัทร วงศ์ษา", line_uid: "U1234567890abcdef2", avatar: "https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=120" },
  { id: "54103", name: "วิภาวี มงคล", line_uid: "U1234567890abcdef3", avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=120" },
];

export default function LiffStudentPage() {
  // LINE LIFF State
  const [liffId, setLiffId] = useState<string>("");
  const [isLiffReady, setIsLiffReady] = useState(false);
  const [isInLineClient, setIsInLineClient] = useState(false);
  const [currentStudent, setCurrentStudent] = useState(DEMO_STUDENTS[0]);

  // Data State
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, Submission>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Active Taking State
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

  // 1. Initialize LIFF SDK
  useEffect(() => {
    async function initLiff() {
      try {
        const res = await fetch("/api/liff/config");
        const config = await res.json();
        const id = config.liffId || process.env.NEXT_PUBLIC_LINE_LIFF_ID || "";
        setLiffId(id);

        if (id) {
          const liff = (await import("@line/liff")).default;
          await liff.init({ liffId: id });
          setIsInLineClient(liff.isInClient());

          if (liff.isLoggedIn()) {
            const profile = await liff.getProfile();
            setCurrentStudent({
              id: "54101",
              name: profile.displayName,
              line_uid: profile.userId,
              avatar: profile.pictureUrl || DEMO_STUDENTS[0].avatar,
            });
          }
        }
      } catch (err) {
        console.warn("LIFF initialization fallback to simulation mode:", err);
      } finally {
        setIsLiffReady(true);
      }
    }
    initLiff();
  }, []);

  // 2. Load Classrooms and Assignments
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
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

        // Load assignments
        const allAssigns = await dataService.getAssignments();
        setAssignments(allAssigns);

        // Load existing submissions for this student
        const subMap: Record<string, Submission> = {};
        for (const a of allAssigns) {
          const subs = await dataService.getSubmissions(a.id);
          const found = subs.find((s) => s.student_id === currentStudent.id);
          if (found) subMap[a.id] = found;
        }
        setSubmissions(subMap);
      } catch (err) {
        console.error("Failed to load student data:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [currentStudent]);

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

  // Submit Assignment with Anti-Cheating Payload
  const handleSubmitTask = async () => {
    if (!activeAssignment) return;

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
    if (!joinInviteCode.trim()) return;
    const matched = classrooms.find(
      (c) => c.invite_code?.toLowerCase() === joinInviteCode.trim().toLowerCase()
    );
    if (matched) {
      await dataService.addStudentToClassroom(matched.id, {
        first_name: currentStudent.name.split(" ")[0] || currentStudent.name,
        last_name: currentStudent.name.split(" ")[1] || "",
        student_id: currentStudent.id,
        email: `${currentStudent.id}@student.pudding.ac.th`,
        line_uid: currentStudent.line_uid,
      });
      setSelectedClassroom(matched);
      setIsJoinModalOpen(false);
      setJoinInviteCode("");
      setJoinMessage("เข้าร่วมห้องเรียนสำเร็จ!");
      setTimeout(() => setJoinMessage(null), 3000);
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

  // Filter assignments for selected classroom
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
        <div className="flex items-center gap-1.5 text-[11px] bg-black/15 px-2.5 py-0.5 rounded-full">
          <span className="w-2 h-2 rounded-full bg-emerald-200 animate-pulse" />
          <span>{isInLineClient ? "เชื่อมต่อ LINE แล้ว" : "LINE Simulator"}</span>
        </div>
      </div>

      {/* Floating Away Warning Toast */}
      {awayWarningToast && (
        <div className="fixed top-12 left-4 right-4 z-50 p-3.5 rounded-2xl bg-rose-600 text-white shadow-2xl flex items-center gap-3 animate-bounce">
          <ShieldAlert className="w-6 h-6 shrink-0" />
          <p className="text-xs font-bold leading-snug">{awayWarningToast}</p>
        </div>
      )}

      {/* Student Profile & Active Classroom Bar */}
      <div className="p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img
            src={currentStudent.avatar}
            alt={currentStudent.name}
            className="w-11 h-11 rounded-2xl object-cover ring-2 ring-emerald-500/40 shadow-xs"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-black text-slate-900 dark:text-white line-clamp-1">
                {currentStudent.name}
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                ม.4
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              รหัสนักเรียน: {currentStudent.id}
            </p>
          </div>
        </div>

        {!isInLineClient && (
          <select
            value={currentStudent.id}
            onChange={(e) => {
              const matched = DEMO_STUDENTS.find((s) => s.id === e.target.value);
              if (matched) setCurrentStudent(matched);
            }}
            className="text-[11px] font-bold py-1.5 px-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
          >
            {DEMO_STUDENTS.map((s) => (
              <option key={s.id} value={s.id}>
                จำลอง: {s.name.split(" ")[0]}
              </option>
            ))}
          </select>
        )}
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
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
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
          className="shrink-0 p-1.5 rounded-xl bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 flex items-center gap-1 text-xs font-bold px-2.5"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span>ใส่รหัสเข้าห้อง</span>
        </button>
      </div>

      {/* MAIN CONTENT AREA */}
      {!activeAssignment ? (
        <div className="p-4 space-y-5">
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
                        className="px-4 py-2 rounded-xl bg-[#06C755] hover:bg-[#05b34c] text-white font-bold text-xs flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
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
                      className={`p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 cursor-pointer hover:border-emerald-400`}
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
                              <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">
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
        </div>
      ) : (
        /* EXAM / ASSIGNMENT TAKING MODE (WITH REAL-TIME ANTI-CHEATING DETECTION) */
        <div className="flex-1 flex flex-col p-4 space-y-4">
          <div className="sticky top-0 z-30 -mx-4 -mt-4 px-4 py-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shadow-xs">
            <button
              onClick={() => {
                if (confirm("ต้องการออกจากหน้าข้อสอบหรือไม่? (ข้อมูลที่ตอบไว้จะยังไม่ถูกส่ง)")) {
                  setActiveAssignment(null);
                }
              }}
              className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
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
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center text-3xl">
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
                className="w-full py-3 rounded-2xl bg-[#06C755] text-white font-bold text-xs shadow-md"
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
                            className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 animate-pulse"
                          >
                            <MicOff className="w-3.5 h-3.5" />
                            <span>หยุดบันทึก ({recordingSeconds}s)</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startRecording(q.id)}
                            className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center gap-1.5"
                          >
                            <Mic className="w-3.5 h-3.5 text-rose-500" />
                            <span>อัดเสียงอ่าน/พูด</span>
                          </button>
                        )}

                        {audioUrlMap[q.id] && (
                          <audio src={audioUrlMap[q.id]} controls className="h-7 w-32" />
                        )}
                      </div>

                      <label className="cursor-pointer px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 font-bold text-xs flex items-center gap-1.5">
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
                  className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-[#06C755] hover:from-emerald-700 hover:to-[#05b34c] text-white font-black text-sm shadow-xl shadow-emerald-600/30 flex items-center justify-center gap-2 transition-transform active:scale-98 disabled:opacity-50"
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
              กรอกรหัสเชิญเข้าห้องเรียน 6 หลักที่ได้รับจากคุณครู (เช่น THAI-401)
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
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleJoinClassroom}
                className="flex-1 py-2.5 rounded-xl bg-[#06C755] text-white text-xs font-bold"
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
                <span className="p-2 rounded-xl bg-emerald-100 text-emerald-600 text-lg">
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
                className="text-xs font-bold p-1 text-slate-400 hover:text-slate-600"
              >
                ✕ ปิด
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center space-y-1">
              <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400">
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
                      <span className="text-emerald-600 font-black">
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
              className="w-full py-3 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xs"
            >
              ตกลง
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
