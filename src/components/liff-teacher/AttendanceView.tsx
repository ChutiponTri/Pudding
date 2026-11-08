"use client";

import { useState } from "react";
import { QrCode } from "lucide-react";
import { AttendanceQrScreen } from "@/components/AttendanceQrScreen";
import { authFetch } from "@/lib/auth/lineSession";
import { formatDateTime } from "@/lib/utils/datetime";
import { Button, Card, ErrorBox, Field, Loading, Page, Pill, errorText, inputClass, useKit, useViewData, type AttendanceData, type RosterStudent } from "./kit";

type Session = AttendanceData["sessions"][number];

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

/** What the teacher can set for a student by hand (no phone, broken phone). */
const MARKS: Array<{ status: string; label: string; tone: string }> = [
  { status: "on_time", label: "มา", tone: "bg-emerald-500 text-white" },
  { status: "late", label: "สาย", tone: "bg-amber-400 text-slate-900" },
  { status: "excused", label: "ลา", tone: "bg-sky-500 text-white" },
  { status: "absent", label: "ขาด", tone: "bg-rose-500 text-white" },
];
const studentName = (s: RosterStudent) => `${s.first_name || ""} ${s.last_name || ""}`.trim() || "นักเรียน";
const todayTitle = () => `เช็กชื่อ ${new Date().toLocaleDateString("th-TH", { day: "numeric", month: "short" })}`;
const clock = (startsAt: string, minutes: number) =>
  new Date(new Date(startsAt).getTime() + minutes * 60_000).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

/**
 * "เช็กชื่อ": open a check-in period and show its QR straight away. Nothing
 * goes to the LINE group: students check in only by scanning the QR on the
 * teacher's screen (each checks in only themself); students without a phone
 * are marked here by hand.
 */
export function AttendanceView() {
  const { classroom, toast } = useKit();
  const data = useViewData<AttendanceData>("attendance");
  const [title, setTitle] = useState(todayTitle);
  const [onTime, setOnTime] = useState(10);
  const [late, setLate] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);
  const [qrSession, setQrSession] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);

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
      setTitle(todayTitle());
      // Straight to the QR for the class to scan.
      if (json.session?.id) setQrSession(json.session.id);
      data.reload();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const close = async (session: Session) => {
    if (!confirm(`ปิดคาบ “${session.title}”?\nนักเรียนที่ยังไม่เช็กชื่อจะถูกบันทึกว่าขาด`)) return;
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

  const mark = async (session: Session, student: RosterStudent, status: string) => {
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

  const sessions = data.data?.sessions || [];
  const openSessions = sessions.filter((session) => session.status === "open");
  const recordsOf = (id: string) => (data.data?.records || []).filter((record) => record.session_id === id);

  return (
    <Page title="📋 เช็กชื่อ">
      {qrSession && (
        <AttendanceQrScreen
          classroomId={classroom.id}
          sessionId={qrSession}
          onClose={() => {
            setQrSession(null);
            data.reload();
          }}
        />
      )}

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
        <Button className="w-full" busy={busy === "create"} onClick={open}>
          <QrCode className="w-4 h-4" /> เปิดคาบและแสดง QR
        </Button>
        <p className="text-[11px] text-slate-400">นักเรียนสแกน QR บนหน้าจอเพื่อเช็กชื่อ • ไม่มีการส่งข้อความเข้ากลุ่ม</p>
      </Card>

      {data.error && <ErrorBox text={data.error} />}
      {!data.data && !data.error && <Loading />}
      {data.data && (
        <Card className="space-y-3">
          <p className="text-sm font-black">คาบที่เปิดอยู่ ({openSessions.length})</p>
          {openSessions.length === 0 && <p className="text-xs text-slate-400">ไม่มีคาบที่เปิดอยู่</p>}
          {openSessions.map((session) => {
            const rows = recordsOf(session.id);
            const checked = rows.filter((r) => r.status === "on_time" || r.status === "late").length;
            const lateCount = rows.filter((r) => r.status === "late").length;
            return (
              <div key={session.id} className="space-y-2 pb-3 border-b last:border-0 last:pb-0 border-violet-100 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold truncate">{session.title}</p>
                  <Pill tone="green">เช็กแล้ว {checked}/{data.data!.students.length}</Pill>
                </div>
                <p className="text-[11px] text-slate-500">
                  ตรงเวลาถึง {clock(session.starts_at, session.on_time_until_minutes)} น. · สายถึง {clock(session.starts_at, session.late_until_minutes)} น.
                  {lateCount ? ` · มาสาย ${lateCount}` : ""}
                </p>
                <Button className="w-full" onClick={() => setQrSession(session.id)}>
                  <QrCode className="w-4 h-4" /> แสดง QR ให้นักเรียนสแกน
                </Button>
                <div className="flex flex-wrap gap-2">
                  <Button small tone="soft" onClick={() => setMarking(marking === session.id ? null : session.id)}>
                    {marking === session.id ? "ซ่อนรายชื่อ" : "เช็กให้นักเรียน (ไม่มีโทรศัพท์)"}
                  </Button>
                  <Button small tone="ghost" busy={busy === `close-${session.id}`} onClick={() => close(session)}>ปิดคาบ</Button>
                </div>
                {marking === session.id && (
                  <div className="space-y-1.5 pt-1">
                    {data.data!.students.length === 0 && <p className="text-xs text-slate-400">ยังไม่มีนักเรียนในห้อง</p>}
                    {data.data!.students.map((student) => {
                      const current = rows.find((r) => r.student_id === student.id || r.student_id === student.line_uid)?.status;
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
