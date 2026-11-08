"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Expand, Loader2, ScanLine, X } from "lucide-react";
import { authFetch } from "@/lib/auth/lineSession";

type Student = { id: string; name: string; number: string; status: string | null; checkedAt: string | null };

type QrState = {
  open: boolean;
  session: { title: string; starts_at?: string; on_time_until_minutes?: number };
  counts: { onTime: number; late: number; students: number };
  students: Student[];
  url?: string;
  nextAt?: number;
  rotateMs?: number;
  serverNow?: number;
};

/** What the teacher sets by hand (no phone, phone problem, a mistake). */
const STATUSES: Array<{ status: string; label: string; on: string }> = [
  { status: "on_time", label: "มา", on: "bg-emerald-500 text-white" },
  { status: "late", label: "สาย", on: "bg-amber-400 text-slate-900" },
  { status: "excused", label: "ลา", on: "bg-sky-500 text-white" },
  { status: "absent", label: "ขาด", on: "bg-rose-500 text-white" },
];

type Filter = "all" | "missing" | "checked";

/**
 * The check-in screen (website and teacher LIFF): a QR code that changes
 * every few seconds, so only students in the room can check in (a photo of it
 * stops working within seconds); each LINE account checks in only itself. Next
 * to it the class list fills in live, and the teacher sets any student's
 * status by hand (no phone, phone problems). Nothing is sent to LINE.
 */
export function AttendanceQrScreen({
  classroomId,
  sessionId,
  onClose,
}: {
  classroomId: string;
  sessionId: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<QrState | null>(null);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(1);
  const [filter, setFilter] = useState<Filter>("all");
  /** Statuses the teacher just set, shown until the server's list includes them. */
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const [version, setVersion] = useState(0);

  // Ask for the current code and list; the next request is timed to when the code changes.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await authFetch(`/api/attendance/qr?classroomId=${encodeURIComponent(classroomId)}&sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as QrState & { error?: string };
        if (!alive) return;
        if (!res.ok) throw new Error(json.error || "โหลด QR ไม่สำเร็จ");
        setState(json);
        setError("");
        // The server's list now carries what the teacher set.
        setOverrides((prev) => {
          const next = { ...prev };
          for (const student of json.students || []) if (next[student.id] === student.status) delete next[student.id];
          return next;
        });
        if (json.url) setImage(await QRCode.toDataURL(json.url, { margin: 1, width: 720, errorCorrectionLevel: "M" }));
        if (!json.open) return;
        // Server time decides the slot; wait until just after the next one starts.
        const wait = json.nextAt && json.serverNow ? Math.max(1000, json.nextAt - json.serverNow + 150) : 8000;
        timer = setTimeout(load, wait);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "โหลด QR ไม่สำเร็จ");
        timer = setTimeout(load, 3000);
      }
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [classroomId, sessionId, version]);

  // Countdown bar to the next code.
  useEffect(() => {
    if (!state?.open || !state.nextAt || !state.serverNow || !state.rotateMs) return;
    const offset = Date.now() - state.serverNow;
    const tick = setInterval(() => {
      const left = state.nextAt! - (Date.now() - offset);
      setProgress(Math.max(0, Math.min(1, left / state.rotateMs!)));
    }, 200);
    return () => clearInterval(tick);
  }, [state]);

  const post = async (body: Record<string, unknown>) => {
    const res = await authFetch("/api/attendance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ classroomId, sessionId, ...body }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "บันทึกไม่สำเร็จ");
    return json;
  };

  const setStatus = async (student: Student, status: string) => {
    setSaving(student.id);
    setOverrides((prev) => ({ ...prev, [student.id]: status }));
    try {
      await post({ action: "record", studentId: student.id, status });
    } catch (err) {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[student.id];
        return next;
      });
      alert(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(null);
    }
  };

  const closeSession = async () => {
    if (!confirm("ปิดคาบนี้? นักเรียนที่ยังไม่เช็กชื่อจะถูกบันทึกว่าขาด")) return;
    setClosing(true);
    try {
      await post({ action: "close" });
      setVersion((v) => v + 1);
    } catch (err) {
      alert(err instanceof Error ? err.message : "ปิดคาบไม่สำเร็จ");
    } finally {
      setClosing(false);
    }
  };

  const students = (state?.students || []).map((student) => ({ ...student, status: overrides[student.id] ?? student.status }));
  const present = students.filter((s) => s.status === "on_time" || s.status === "late").length;
  const late = students.filter((s) => s.status === "late").length;
  const shown = students.filter((s) => (filter === "missing" ? !s.status : filter === "checked" ? !!s.status : true));
  const fullscreen = () => box.current?.requestFullscreen?.().catch(() => {});

  return (
    <div ref={box} className="fixed inset-0 z-80 bg-white dark:bg-slate-950 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white/95 dark:bg-slate-950/95 backdrop-blur px-4 py-3 flex items-center gap-3 border-b border-violet-100 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-violet-600 inline-flex items-center gap-1">
            <ScanLine className="w-3.5 h-3.5" /> เช็กชื่อ
          </p>
          <h2 className="text-base sm:text-xl font-black text-violet-950 dark:text-white truncate">{state?.session.title || "เช็กชื่อ"}</h2>
          {state?.open && state.session.starts_at && state.session.on_time_until_minutes != null && (
            <p className="text-[11px] text-slate-500">
              ตรงเวลาถึง{" "}
              {new Date(new Date(state.session.starts_at).getTime() + state.session.on_time_until_minutes * 60_000).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}{" "}
              น. • หลังจากนั้นนับว่าสาย
            </p>
          )}
        </div>
        <p className="text-right shrink-0">
          <span className="text-2xl sm:text-3xl font-black text-emerald-600">{present}</span>
          <span className="text-slate-400 font-bold"> / {students.length}</span>
          <span className="block text-[10px] text-slate-500">เช็กชื่อแล้ว{late ? ` (สาย ${late})` : ""}</span>
        </p>
        <button type="button" onClick={fullscreen} aria-label="เต็มจอ" className="hidden sm:flex w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 items-center justify-center cursor-pointer">
          <Expand className="w-5 h-5" />
        </button>
        <button type="button" onClick={onClose} aria-label="ปิด" className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center cursor-pointer">
          <X className="w-5 h-5" />
        </button>
      </div>

      {error && <p className="px-4 pt-3 text-sm text-rose-600">{error}</p>}
      {!state && !error && (
        <div className="py-20 flex justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
        </div>
      )}

      {state && (
        <div className="p-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start max-w-6xl mx-auto">
          {/* The QR: stays in view on wide screens while the list scrolls. */}
          <div className="lg:sticky lg:top-24 space-y-3">
            {state.open && image ? (
              <>
                <div className="mx-auto w-full max-w-[min(70vh,520px)] rounded-3xl bg-white p-3 ring-4 ring-violet-200 shadow-xl">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL, changes every few seconds */}
                  <img src={image} alt="QR เช็กชื่อ" className="w-full aspect-square" />
                </div>
                <div className="mx-auto max-w-[min(70vh,520px)] h-1.5 rounded-full bg-violet-100 dark:bg-slate-800 overflow-hidden" aria-hidden>
                  <div className="h-full bg-violet-500 transition-[width] duration-200 ease-linear" style={{ width: `${progress * 100}%` }} />
                </div>
                <p className="text-center text-xs text-slate-500">
                  สแกนด้วยกล้องมือถือหรือแอป LINE • QR เปลี่ยนทุก {Math.round((state.rotateMs || 8000) / 1000)} วินาที • เช็กชื่อแทนเพื่อนไม่ได้
                </p>
                <button
                  type="button"
                  onClick={closeSession}
                  disabled={closing}
                  className="mx-auto flex h-10 px-4 rounded-xl bg-rose-50 text-rose-700 ring-1 ring-rose-200 text-sm font-bold items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {closing && <Loader2 className="w-4 h-4 animate-spin" />} ปิดคาบเช็กชื่อ
                </button>
              </>
            ) : !state.open ? (
              <p className="text-center text-lg font-bold text-slate-500 py-10">คาบนี้ปิดรับแล้ว • แก้สถานะในรายชื่อได้</p>
            ) : (
              <div className="py-20 flex justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
              </div>
            )}
          </div>

          {/* The class list, live; the teacher changes any status here. */}
          <div className="space-y-2">
            <div className="flex gap-1 p-1 rounded-xl bg-violet-50 dark:bg-slate-900">
              {(
                [
                  ["all", `ทั้งหมด ${students.length}`],
                  ["missing", `ยังไม่เช็ก ${students.filter((s) => !s.status).length}`],
                  ["checked", `เช็กแล้ว ${students.filter((s) => !!s.status).length}`],
                ] as Array<[Filter, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`flex-1 h-9 rounded-lg text-xs font-bold cursor-pointer ${filter === value ? "bg-white dark:bg-violet-700 text-violet-800 dark:text-white shadow-sm" : "text-violet-600 dark:text-slate-400"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {students.length === 0 && <p className="text-center text-sm text-slate-400 py-8">ยังไม่มีนักเรียนในห้องนี้</p>}
            <ul className="divide-y divide-violet-100 dark:divide-slate-800 rounded-2xl ring-1 ring-violet-100 dark:ring-slate-800 overflow-hidden">
              {shown.map((student) => (
                <li key={student.id} className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-900">
                  <span className="w-9 shrink-0 text-xs font-bold text-slate-400 tabular-nums">{student.number ? `[${student.number}]` : ""}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{student.name}</span>
                    {student.checkedAt && (
                      <span className="block text-[10px] text-slate-400">
                        {new Date(student.checkedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.
                      </span>
                    )}
                  </span>
                  <span className="flex gap-1 shrink-0">
                    {STATUSES.map((option) => (
                      <button
                        key={option.status}
                        type="button"
                        disabled={saving === student.id}
                        onClick={() => setStatus(student, option.status)}
                        className={`h-8 min-w-9 px-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-60 ${
                          student.status === option.status ? option.on : "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
