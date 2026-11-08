"use client";

import { useEffect, useState } from "react";
import type { Liff } from "@line/liff";
import { CheckCircle2, Copy, Loader2, Send, ShieldAlert } from "lucide-react";

/** card: new work's trigger link; the bot answers it in the class group with the work card. */
type Shared = { classroom: string; text: string; card?: boolean; messages: Parameters<Liff["shareTargetPicker"]>[0] };
type Status = "loading" | "ready" | "sharing" | "done" | "error";

/**
 * /liff/share?t=<token>: a teacher sends a timeline post to a LINE group from
 * their own LINE account when the bot could not (monthly quota used up, LINE
 * error, or no linked group). Same text and button card as the bot's message,
 * via shareTargetPicker; costs the bot's quota nothing. Opened from the
 * teacher website: inside LINE on a phone, or in the browser after LINE login.
 */
export default function LiffSharePage() {
  const [liff, setLiff] = useState<Liff | null>(null);
  const [shared, setShared] = useState<Shared | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pickerAvailable, setPickerAvailable] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const liffModule = import("@line/liff");
        let id = process.env.NEXT_PUBLIC_LINE_LIFF_ID || "";
        if (!id) id = (await (await fetch("/api/liff/config")).json()).liffId || "";
        if (!id) throw new Error("ไม่พบ LINE_LIFF_ID ในระบบ");
        const sdk = (await liffModule).default;
        await sdk.init({ liffId: id });
        // The token is read after init: LIFF restores the path and query from liff.state first.
        const token = new URLSearchParams(window.location.search).get("t") || "";
        if (!sdk.isLoggedIn()) {
          sdk.login({ redirectUri: window.location.href });
          return;
        }
        const res = await fetch(`/api/line/share?t=${encodeURIComponent(token)}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "โหลดข้อความไม่สำเร็จ");
        if (!alive) return;
        setLiff(sdk);
        setShared(json as Shared);
        setPickerAvailable(sdk.isApiAvailable("shareTargetPicker"));
        setStatus("ready");
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
        setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const share = async () => {
    if (!liff || !shared) return;
    setStatus("sharing");
    setError("");
    try {
      const result = await liff.shareTargetPicker(shared.messages, { isMultiple: true });
      // undefined = the teacher closed the picker without sending.
      if (result?.status === "success") {
        setStatus("done");
        // The class timeline stops offering this post as unsent.
        const token = new URLSearchParams(window.location.search).get("t") || "";
        fetch("/api/line/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: token }) }).catch(() => {});
      } else {
        setStatus("ready");
      }
    } catch (err) {
      setError(err instanceof Error ? `แชร์ไม่สำเร็จ: ${err.message}` : "แชร์ไม่สำเร็จ");
      setStatus("ready");
    }
  };

  const copy = async () => {
    if (!shared) return;
    try {
      await navigator.clipboard.writeText(shared.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header className="pt-2 space-y-0.5">
        <h1 className="text-base font-black text-slate-900 dark:text-white">แชร์เข้ากลุ่ม LINE</h1>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">ส่งจาก LINE ของคุณครู • ไม่ใช้โควตาบอท</p>
        {shared?.card && (
          <p className="mt-2 text-[11px] p-2.5 rounded-xl bg-violet-50 dark:bg-violet-950/40 ring-1 ring-violet-200 dark:ring-violet-900 text-violet-900 dark:text-violet-200">
            เลือกกลุ่ม LINE ของห้อง “{shared.classroom}” แล้วบอทจะตอบด้วยการ์ดงานให้ทันที
          </p>
        )}
      </header>

      {status === "loading" && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> กำลังเตรียมข้อความ...
        </div>
      )}

      {status === "error" && (
        <div role="alert" className="flex items-start gap-2 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 text-sm text-rose-800 dark:text-rose-200">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {shared && status !== "loading" && status !== "error" && (
        <>
          <div className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 p-3 space-y-1.5 max-h-[45vh] overflow-y-auto">
            <p className="text-[11px] font-bold text-slate-400 truncate">{shared.classroom}</p>
            <p className="text-[13px] text-slate-800 dark:text-slate-100 whitespace-pre-wrap wrap-break-word leading-relaxed">{shared.text}</p>
          </div>

          {status === "done" ? (
            <div role="status" className="flex items-center gap-2 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 text-sm font-bold text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 className="w-5 h-5" /> {shared.card ? "แชร์แล้ว บอทกำลังโพสต์การ์ดงานในกลุ่ม" : "แชร์เข้า LINE แล้ว"}
            </div>
          ) : null}

          {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

          {!pickerAvailable && (
            <p className="text-[11px] p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 text-amber-900 dark:text-amber-200">
              แชร์แบบมีปุ่มไม่ได้บนอุปกรณ์นี้ — คัดลอกแล้ววางในกลุ่มแทน
            </p>
          )}
          <div className="flex gap-2">
            {pickerAvailable && (
              <button
                type="button"
                onClick={share}
                disabled={status === "sharing"}
                className="flex-1 h-11 rounded-xl bg-line hover:bg-line-dark text-white font-bold text-sm inline-flex items-center justify-center gap-1.5 shadow-md cursor-pointer disabled:opacity-60 active:scale-[0.98] transition-transform"
              >
                {status === "sharing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {status === "done" ? "แชร์อีกกลุ่ม" : "เลือกกลุ่มแล้วแชร์"}
              </button>
            )}
            <button
              type="button"
              onClick={copy}
              className={`${pickerAvailable ? "shrink-0 px-3" : "flex-1"} h-11 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm inline-flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] transition-transform`}
            >
              {copied ? <CheckCircle2 className="w-4 h-4 text-line" /> : <Copy className="w-4 h-4" />}
              {copied ? "คัดลอกแล้ว" : "คัดลอก"}
            </button>
          </div>
          {liff?.isInClient() && status === "done" && (
            <button type="button" onClick={() => liff.closeWindow()} className="w-full text-xs text-slate-500 underline cursor-pointer">
              ปิดหน้านี้
            </button>
          )}
        </>
      )}
    </div>
  );
}
