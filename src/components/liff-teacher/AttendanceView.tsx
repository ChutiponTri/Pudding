"use client";

import { useState } from "react";
import { QrCode, Users } from "lucide-react";
import { AttendanceQrScreen } from "@/components/AttendanceQrScreen";
import { authFetch } from "@/lib/auth/lineSession";
import { formatDateTime } from "@/lib/utils/datetime";
import { Button, Card, ErrorBox, Field, Loading, Page, Pill, errorText, inputClass, useKit, useViewData, type AttendanceData } from "./kit";

const todayTitle = () => `เช็กชื่อ ${new Date().toLocaleDateString("th-TH", { day: "numeric", month: "short" })}`;

/**
 * "เช็กชื่อ": name the period, open it, and the check-in screen comes up: the
 * changing QR and the live class list, where the teacher also sets any
 * student's status and closes the period. Nothing goes to the LINE group.
 */
export function AttendanceView() {
  const { classroom, toast } = useKit();
  const data = useViewData<AttendanceData>("attendance");
  const [title, setTitle] = useState(todayTitle);
  const [busy, setBusy] = useState(false);
  const [screen, setScreen] = useState<string | null>(null);

  const open = async () => {
    if (!title.trim()) return toast("กรุณาใส่ชื่อคาบ", "error");
    setBusy(true);
    try {
      const res = await authFetch("/api/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ classroomId: classroom.id, action: "create", title: title.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "เปิดคาบไม่สำเร็จ");
      setTitle(todayTitle());
      if (json.session?.id) setScreen(json.session.id);
      data.reload();
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
    <Page title="📋 เช็กชื่อ">
      {screen && (
        <AttendanceQrScreen
          classroomId={classroom.id}
          sessionId={screen}
          onClose={() => {
            setScreen(null);
            data.reload();
          }}
        />
      )}

      <Card className="space-y-3">
        <Field label="ชื่อคาบ *">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && open()} />
        </Field>
        <Button className="w-full" busy={busy} onClick={open}>
          <QrCode className="w-4 h-4" /> เปิดคาบและแสดง QR
        </Button>
        <p className="text-[11px] text-slate-400">สแกนภายใน 15 นาทีนับว่าตรงเวลา หลังจากนั้นนับว่าสายจนปิดคาบ • แก้สถานะได้ในรายชื่อ • ไม่ส่งข้อความเข้ากลุ่ม</p>
      </Card>

      {data.error && <ErrorBox text={data.error} />}
      {!data.data && !data.error && <Loading />}
      {data.data && sessions.length > 0 && (
        <Card className="p-0! divide-y divide-violet-100 dark:divide-slate-800">
          {sessions.slice(0, 10).map((session) => {
            const isOpen = session.status === "open";
            return (
              <button key={session.id} type="button" onClick={() => setScreen(session.id)} className="w-full px-4 py-3 flex items-center gap-3 text-left cursor-pointer">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold truncate">{session.title}</span>
                  <span className="block text-[11px] text-slate-500">{formatDateTime(session.starts_at, "th")}</span>
                </span>
                <Pill tone={isOpen ? "green" : "slate"}>{isOpen ? "เปิดอยู่" : "ปิดแล้ว"}</Pill>
                <span className="text-xs font-bold text-violet-700 dark:text-violet-300 inline-flex items-center gap-1 shrink-0">
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
