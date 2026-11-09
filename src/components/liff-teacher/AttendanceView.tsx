"use client";

import { useState } from "react";
import { QrCode, Users } from "lucide-react";
import { AttendanceQrScreen } from "@/components/AttendanceQrScreen";
import { authFetch } from "@/lib/auth/lineSession";
import { formatDateTime } from "@/lib/utils/datetime";
import { Button, Card, ErrorBox, Field, Page, Pill, Skeleton, errorText, inputClass, useKit, useViewData, type AttendanceData } from "./kit";

const todayTitle = () => `เช็กชื่อ ${new Date().toLocaleDateString("th-TH", { day: "numeric", month: "short" })}`;

/**
 * "เช็กชื่อ": name the period, open it, and the check-in screen comes up: the
 * changing QR and the live class list, where the teacher also sets any
 * student's status and closes the period. Nothing goes to the LINE group.
 */
export function AttendanceView() {
  const { classroom, toast, invalidate } = useKit();
  const data = useViewData<AttendanceData>("attendance");
  const [title, setTitle] = useState(todayTitle);
  /** Optional: minutes after opening when check-ins count as late ('' = 10, the default). */
  const [lateAfter, setLateAfter] = useState("");
  const [busy, setBusy] = useState(false);
  const [screen, setScreen] = useState<string | null>(null);

  const open = async () => {
    if (!title.trim()) return toast("กรุณาใส่ชื่อคาบ", "error");
    setBusy(true);
    try {
      const res = await authFetch("/api/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          classroomId: classroom.id,
          action: "create",
          title: title.trim(),
          ...(Number(lateAfter) >= 1 ? { lateAfterMinutes: Number(lateAfter) } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "เปิดคาบไม่สำเร็จ");
      setTitle(todayTitle());
      setLateAfter("");
      if (json.session?.id) setScreen(json.session.id);
      invalidate("attendance");
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const sessions = data.data?.sessions || [];
  const checkedIn = (id: string) =>
    (data.data?.records || []).filter((record) => record.session_id === id && (record.status === "on_time" || record.status === "late")).length;
  const total = data.data?.students.length ?? 0;

  return (
    <Page title="📋 เช็กชื่อ" refreshing={data.refreshing}>
      {screen && (
        <AttendanceQrScreen
          classroomId={classroom.id}
          sessionId={screen}
          onClose={() => {
            setScreen(null);
            // Check-ins and status changes happened on that screen.
            invalidate("attendance");
          }}
        />
      )}

      <Card className="space-y-3">
        <Field label="ชื่อคาบ *">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && open()} />
        </Field>
        <Field label="นับว่าสายหลังเปิดคาบ (นาที) — ไม่บังคับ">
          <input
            className={inputClass}
            type="number"
            min={1}
            max={180}
            inputMode="numeric"
            placeholder="10 (ค่าเริ่มต้น)"
            value={lateAfter}
            onChange={(e) => setLateAfter(e.target.value.replace(/[^0-9]/g, ""))}
          />
        </Field>
        <Button className="w-full" busy={busy} onClick={open}>
          <QrCode className="w-4 h-4" /> เปิดคาบและแสดง QR
        </Button>
        <p className="text-[11px] text-slate-400">
          สแกนภายใน {Number(lateAfter) >= 1 ? lateAfter : 10} นาทีนับว่าตรงเวลา หลังจากนั้นนับว่าสายจนปิดคาบ • แก้สถานะได้ในรายชื่อ • ไม่ส่งข้อความเข้ากลุ่ม
        </p>
      </Card>

      {data.error && <ErrorBox text={data.error} />}
      {!data.data && !data.error && <Skeleton rows={2} />}
      {data.data && sessions.length > 0 && (
        <Card className="p-0! divide-y divide-slate-100 dark:divide-slate-800">
          {sessions.slice(0, 10).map((session) => {
            const isOpen = session.status === "open";
            return (
              <button key={session.id} type="button" onClick={() => setScreen(session.id)} className="w-full px-4 py-3 flex items-center gap-3 text-left cursor-pointer">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold truncate">{session.title}</span>
                  <span className="block text-[11px] text-slate-500">{formatDateTime(session.starts_at, "th")}</span>
                </span>
                <Pill tone={isOpen ? "green" : "slate"}>{isOpen ? "เปิดอยู่" : "ปิดแล้ว"}</Pill>
                <span className="text-xs font-bold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1 shrink-0">
                  {isOpen ? <QrCode className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                  {checkedIn(session.id)}/{total}
                </span>
              </button>
            );
          })}
        </Card>
      )}
    </Page>
  );
}
