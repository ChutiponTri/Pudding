"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Expand, Loader2, ScanLine, X } from "lucide-react";
import { authFetch } from "@/lib/auth/lineSession";

type QrState = {
  open: boolean;
  session: { title: string };
  counts: { onTime: number; late: number; students: number | null };
  url?: string;
  nextAt?: number;
  rotateMs?: number;
  serverNow?: number;
};

/**
 * The teacher's check-in screen (website and teacher LIFF): a full-screen QR
 * code that changes every few seconds, so only students in the room can check
 * in (a photo of it stops working within seconds). Students scan it with the
 * phone camera or LINE; each LINE account checks in only itself. Shows how many
 * have checked in so far.
 */
export function AttendanceQrScreen({ classroomId, sessionId, onClose }: { classroomId: string; sessionId: string; onClose: () => void }) {
  const [state, setState] = useState<QrState | null>(null);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(1);
  const box = useRef<HTMLDivElement | null>(null);

  // Ask for the current code; the next request is timed to when it changes.
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
  }, [classroomId, sessionId]);

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

  const checked = state ? state.counts.onTime + state.counts.late : 0;
  const fullscreen = () => box.current?.requestFullscreen?.().catch(() => {});

  return (
    <div ref={box} className="fixed inset-0 z-80 bg-white dark:bg-slate-950 flex flex-col items-center justify-center p-4 gap-4 overflow-y-auto">
      <div className="absolute top-3 right-3 flex gap-2">
        <button type="button" onClick={fullscreen} aria-label="เต็มจอ" className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center cursor-pointer">
          <Expand className="w-5 h-5" />
        </button>
        <button type="button" onClick={onClose} aria-label="ปิด" className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center cursor-pointer">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="text-center space-y-1">
        <p className="text-xs font-bold text-violet-600 inline-flex items-center gap-1.5">
          <ScanLine className="w-4 h-4" /> สแกนเพื่อเช็กชื่อ
        </p>
        <h2 className="text-xl sm:text-3xl font-black text-violet-950 dark:text-white">{state?.session.title || "เช็กชื่อ"}</h2>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      {!state && !error && <Loader2 className="w-8 h-8 animate-spin text-violet-500" />}

      {state && !state.open && <p className="text-lg font-bold text-slate-500">คาบนี้ปิดรับแล้ว</p>}

      {state?.open && image && (
        <div className="w-full max-w-[min(80vh,520px)] space-y-2">
          <div className="rounded-3xl bg-white p-3 ring-4 ring-violet-200 shadow-xl">
            {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL, changes every few seconds */}
            <img src={image} alt="QR เช็กชื่อ" className="w-full aspect-square" />
          </div>
          <div className="h-1.5 rounded-full bg-violet-100 dark:bg-slate-800 overflow-hidden" aria-hidden>
            <div className="h-full bg-violet-500 transition-[width] duration-200 ease-linear" style={{ width: `${progress * 100}%` }} />
          </div>
          <p className="text-center text-[11px] text-slate-500">QR เปลี่ยนทุก {Math.round((state.rotateMs || 8000) / 1000)} วินาที • ภาพที่ถ่ายส่งต่อจะใช้ไม่ได้</p>
        </div>
      )}

      {state && (
        <div className="text-center">
          <p className="text-3xl sm:text-5xl font-black text-emerald-600">
            {checked}
            {state.counts.students != null && <span className="text-slate-400 text-2xl sm:text-3xl"> / {state.counts.students}</span>}
          </p>
          <p className="text-xs text-slate-500">เช็กชื่อแล้ว{state.counts.late ? ` (สาย ${state.counts.late})` : ""}</p>
        </div>
      )}
      <p className="text-xs text-slate-400 text-center max-w-sm">
        เปิดกล้องมือถือหรือแอป LINE แล้วสแกน • เช็กชื่อแทนเพื่อนไม่ได้ นักเรียนที่ไม่มีโทรศัพท์ให้คุณครูเช็กให้ในรายชื่อ
      </p>
    </div>
  );
}
