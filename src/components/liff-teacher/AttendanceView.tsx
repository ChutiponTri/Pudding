"use client";

import { useState } from "react";
import { QrCode } from "lucide-react";
import { AttendanceQrScreen } from "@/components/AttendanceQrScreen";
import { authFetch } from "@/lib/auth/lineSession";
import { dataService } from "@/lib/supabase/dataService";
import { formatDateTime } from "@/lib/utils/datetime";
import type { User } from "@/types/database";
import { Button, Card, ErrorBox, Field, Loading, Page, Pill, errorText, inputClass, useKit, useLoad } from "./kit";

type AttendanceSession = {
  id: string;
  title: string;
  starts_at: string;
  on_time_until_minutes: number;
  late_until_minutes: number;
  status: "open" | "closed";
};
type AttendanceData = { sessions: AttendanceSession[]; records: Array<{ session_id: string; student_id: string; status: string }> };

/** What the teacher can set for a student by hand (no phone, broken phone). */
const MARKS: Array<{ status: string; label: string; tone: string }> = [
  { status: "on_time", label: "มา", tone: "bg-emerald-500 text-white" },
  { status: "late", label: "สาย", tone: "bg-amber-400 text-slate-900" },
  { status: "excused", label: "ลา", tone: "bg-sky-500 text-white" },
  { status: "absent", label: "ขาด", tone: "bg-rose-500 text-white" },
];
const studentName = (s: Partial<User>) => `${s.first_name || ""} ${s.last_name || ""}`.trim() || "นักเรียน";

async function attendanceRequest(body: Record<string, unknown>) {
  const res = await authFetch("/api/attendance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "ทำรายการไม่สำเร็จ");
  return json;
}

const todayTitle = () => `เช็กชื่อ ${new Date().toLocaleDateString("th-TH", { day: "numeric", month: "short" })}`;
const clock = (startsAt: string, minutes: number) =>
  new Date(new Date(startsAt).getTime() + minutes * 60_000).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

/**
 * "เช็กชื่อ": open a check-in period (its card goes into the group), show its
 * QR for students to scan (each checks in only themself), mark students
 * without a phone by hand, resend the card or close the period.
 */
export function AttendanceView() {
  const { classroom, postShare, postKind, toast } = useKit();
  const data = useLoad(async () => {
    const res = await authFetch(`/api/attendance?classroomId=${encodeURIComponent(classroom.id)}&allRecords=1`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "โหลดคาบเช็กชื่อไม่สำเร็จ");
    return json as AttendanceData;
  }, [classroom.id]);
  const [title, setTitle] = useState(todayTitle);
  const [onTime, setOnTime] = useState(10);
  const [late, setLate] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [qrSession, setQrSession] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);
  const roster = useLoad(() => dataService.getClassroomRoster(classroom.id), [classroom.id]);

  const mark = async (session: AttendanceSession, student: User, status: string) => {
    setBusy(`mark-${student.id}`);
    try {
      await attendanceRequest({ classroomId: classroom.id, action: "record", sessionId: session.id, studentId: student.id, status });
      data.reload();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const open = async () => {
    setBusy("create");
    try {
      const json = await attendanceRequest({
        classroomId: classroom.id,
        action: "create",
        title: title.trim() || todayTitle(),
        onTimeUntilMinutes: onTime,
        lateUntilMinutes: Math.max(onTime, late),
      });
      if (json.line === "card" && json.share?.url) await postShare(json.share);
      else toast("เปิดคาบเช็กชื่อแล้ว");
      setTitle(todayTitle());
      data.reload();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const close = async (session: AttendanceSession) => {
    if (!confirm(`ปิดคาบ “${session.title}”?`)) return;
    setBusy(`close-${session.id}`);
    try {
      await attendanceRequest({ classroomId: classroom.id, action: "close", sessionId: session.id });
      toast("ปิดคาบแล้ว");
      data.reload();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const resend = async (session: AttendanceSession) => {
    setBusy(`send-${session.id}`);
    try {
      await postKind("attendance", { sessionId: session.id });
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const sessions = data.data?.sessions || [];
  const openSessions = sessions.filter((session) => session.status === "open");
  const counts = (id: string) => {
    const rows = (data.data?.records || []).filter((record) => record.session_id === id);
    const late = rows.filter((r) => r.status === "late").length;
    return { checked: rows.filter((r) => r.status === "on_time").length + late, late };
  };

  return (
    <Page title="📋 เช็กชื่อ">
      {qrSession && <AttendanceQrScreen classroomId={classroom.id} sessionId={qrSession} onClose={() => { setQrSession(null); data.reload(); }} />}
      <Card className="space-y-3">
        <p className="text-sm font-black">เปิดคาบเช็กชื่อใหม่</p>
        <Field label="ชื่อคาบ">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="ตรงเวลาภายใน (นาที)">
            <input className={inputClass} type="number" min={0} inputMode="numeric" value={onTime} onChange={(e) => setOnTime(Number(e.target.value) || 0)} />
          </Field>
          <Field label="สายได้ถึง (นาที)">
            <input className={inputClass} type="number" min={0} inputMode="numeric" value={late} onChange={(e) => setLate(Number(e.target.value) || 0)} />
          </Field>
        </div>
        <Button tone="green" className="w-full" busy={busy === "create"} onClick={open}>⏰ เปิดคาบและส่งการ์ดเข้ากลุ่ม</Button>
      </Card>

      {data.error && <ErrorBox text={data.error} />}
      {!data.data && !data.error && <Loading />}
      {data.data && (
        <Card className="space-y-3">
          <p className="text-sm font-black">คาบที่เปิดอยู่ ({openSessions.length})</p>
          {openSessions.length === 0 && <p className="text-xs text-slate-400">ไม่มีคาบที่เปิดอยู่</p>}
          {openSessions.map((session) => {
            const c = counts(session.id);
            return (
              <div key={session.id} className="space-y-2 pb-3 border-b last:border-0 last:pb-0 border-violet-100 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold truncate">{session.title}</p>
                  <Pill tone="green">เช็กแล้ว {c.checked}</Pill>
                </div>
                <p className="text-[11px] text-slate-500">
                  ตรงเวลาถึง {clock(session.starts_at, session.on_time_until_minutes)} น. · สายถึง {clock(session.starts_at, session.late_until_minutes)} น.
                  {c.late ? ` · มาสาย ${c.late}` : ""}
                </p>
                <Button className="w-full" onClick={() => setQrSession(session.id)}>
                  <QrCode className="w-4 h-4" /> แสดง QR ให้นักเรียนสแกน
                </Button>
                <div className="flex flex-wrap gap-2">
                  <Button small tone="soft" onClick={() => setMarking(marking === session.id ? null : session.id)}>
                    {marking === session.id ? "ซ่อนรายชื่อ" : "เช็กให้นักเรียน (ไม่มีโทรศัพท์)"}
                  </Button>
                  <Button small tone="soft" busy={busy === `send-${session.id}`} onClick={() => resend(session)}>ส่งการ์ดอีกครั้ง</Button>
                  <Button small tone="ghost" busy={busy === `close-${session.id}`} onClick={() => close(session)}>ปิดคาบ</Button>
                </div>
                {marking === session.id && (
                  <div className="space-y-1.5 pt-1">
                    {!roster.data && <p className="text-xs text-slate-400">กำลังโหลดรายชื่อ...</p>}
                    {roster.data?.students.map((student) => {
                      const current = (data.data?.records || []).find((r) => r.session_id === session.id && (r.student_id === student.id || r.student_id === student.line_uid))?.status;
                      return (
                        <div key={student.id} className="flex items-center gap-2">
                          <span className="flex-1 min-w-0 text-xs truncate">
                            {student.student_id ? `[${student.student_id.slice(-3)}] ` : ""}
                            {studentName(student)}
                          </span>
                          {MARKS.map((option) => (
                            <button
                              key={option.status}
                              type="button"
                              disabled={busy === `mark-${student.id}`}
                              onClick={() => mark(session, student, option.status)}
                              className={`h-7 px-2 rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-50 ${current === option.status ? option.tone : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {sessions.length > openSessions.length && (
            <p className="text-[11px] text-slate-400">
              ล่าสุดที่ปิดแล้ว: {sessions.filter((s) => s.status !== "open").slice(0, 3).map((s) => `${s.title} (${formatDateTime(s.starts_at, "th")})`).join(", ")}
            </p>
          )}
        </Card>
      )}
    </Page>
  );
}
