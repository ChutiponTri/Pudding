"use client";

import { useCallback, useEffect, useState } from "react";
import type { Liff } from "@line/liff";
import { CheckCircle2, ChevronDown, Link2, Loader2, Plus, ShieldAlert, Unlink, Users, X } from "lucide-react";
import { LINE_TOKEN_HEADER } from "@/lib/auth/lineSession";

type Candidate = { groupId: string; groupName?: string };
type Room = {
  id: string;
  title: string;
  term: string;
  status: "disconnected" | "waiting" | "connected";
  groupName?: string;
  expiresAt?: string;
  canUnlink: boolean;
};
type Overview = { teacher: { firstName: string }; candidates: Candidate[]; classrooms: Room[] };

const timeFormat = new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" });

/**
 * /liff/connect: a teacher links classrooms to LINE groups without leaving
 * LINE (the rich menu's "เชื่อมกลุ่ม" link). Pick a classroom, then either a
 * group the bot is already in (linked at once) or "another group": invite the
 * bot there within 24 hours and confirm in the group. The server checks the
 * LINE account is an approved teacher; nothing here is trusted.
 */
export default function LiffConnectPage() {
  const [liff, setLiff] = useState<Liff | null>(null);
  const [token, setToken] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
        if (!sdk.isLoggedIn()) {
          sdk.login({ redirectUri: window.location.href });
          return;
        }
        const accessToken = sdk.getAccessToken() || "";
        const res = await fetch("/api/line/liff-connect", { headers: { [LINE_TOKEN_HEADER]: accessToken }, cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        setLiff(sdk);
        setToken(accessToken);
        if (!res.ok) {
          setError({ message: json.error || "โหลดข้อมูลไม่สำเร็จ", code: json.code });
          setStatus("error");
          return;
        }
        setData(json as Overview);
        setStatus("ready");
      } catch (err) {
        if (!alive) return;
        setError({ message: err instanceof Error ? err.message : "เกิดข้อผิดพลาด" });
        setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const act = useCallback(
    async (body: { action: string; classroomId: string; groupId?: string }, done: string) => {
      setBusy(`${body.action}:${body.classroomId}:${body.groupId || ""}`);
      setNotice("");
      try {
        const res = await fetch("/api/line/liff-connect", {
          method: "POST",
          headers: { "content-type": "application/json", [LINE_TOKEN_HEADER]: token },
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "ทำรายการไม่สำเร็จ");
        setData(json as Overview);
        setNotice(done);
        if (body.action !== "arm") setOpenId(null);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
      } finally {
        setBusy(null);
      }
    },
    [token]
  );

  const openWeb = (path: string) => {
    const url = `${window.location.origin}${path}`;
    if (liff?.isInClient()) liff.openWindow({ url, external: true });
    else window.open(url, "_blank", "noopener");
  };

  const free = data?.classrooms.filter((room) => room.status !== "connected") || [];
  const linked = data?.classrooms.filter((room) => room.status === "connected") || [];

  return (
    <div className="p-4 sm:p-6 space-y-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header className="pt-2 space-y-0.5">
        <h1 className="text-base font-black text-slate-900 dark:text-white">เชื่อมกลุ่ม LINE</h1>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {data?.teacher.firstName ? `คุณครู${data.teacher.firstName} • ` : ""}1 กลุ่ม LINE ต่อ 1 ห้องเรียน
        </p>
      </header>

      {status === "loading" && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> กำลังโหลดห้องเรียน...
        </div>
      )}

      {status === "error" && error && (
        <div className="space-y-3">
          <div role="alert" className="flex items-start gap-2 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 text-sm text-rose-800 dark:text-rose-200">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <span>{error.message}</span>
          </div>
          {(error.code === "not-teacher" || error.code === "incomplete" || error.code === "pending" || error.code === "rejected") && (
            <button
              type="button"
              onClick={() => openWeb(error.code === "not-teacher" ? "/sign-in" : "/pending-approval")}
              className="w-full h-11 rounded-xl bg-line hover:bg-line-dark text-white font-bold text-sm cursor-pointer"
            >
              {error.code === "not-teacher" ? "เข้าสู่ระบบเว็บ Pudding ด้วย LINE" : "ดูสถานะบัญชีบนเว็บ"}
            </button>
          )}
        </div>
      )}

      {data && status === "ready" && (
        <>
          {notice && (
            <p role="status" className="text-xs p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-900 text-emerald-900 dark:text-emerald-200">
              {notice}
            </p>
          )}

          <section className="space-y-2">
            <h2 className="text-xs font-black text-slate-500 dark:text-slate-400">ยังไม่ได้เชื่อมกลุ่ม ({free.length})</h2>
            {!free.length && (
              <p className="text-xs text-slate-500 dark:text-slate-400 p-3 rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800">
                ทุกห้องเรียนเชื่อมกลุ่มแล้ว หรือยังไม่มีห้องเรียน
              </p>
            )}
            {free.map((room) => {
              const open = openId === room.id;
              return (
                <div key={room.id} className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : room.id)}
                    aria-expanded={open}
                    className="w-full flex items-center gap-3 p-3 text-left cursor-pointer"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">{room.title}</span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                        {room.term}
                        {room.status === "waiting" && room.expiresAt ? ` • รอเชิญบอทถึง ${timeFormat.format(new Date(room.expiresAt))}` : ""}
                      </span>
                    </span>
                    {room.status === "waiting" && (
                      <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">รอบอท</span>
                    )}
                    <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>

                  {open && (
                    <div className="px-3 pb-3 space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                      {data.candidates.length > 0 && (
                        <>
                          <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">กลุ่มที่มี Pudding Bot อยู่แล้ว แตะเพื่อเชื่อมทันที</p>
                          {data.candidates.map((group) => (
                            <button
                              key={group.groupId}
                              type="button"
                              disabled={busy !== null}
                              onClick={() => act({ action: "link-group", classroomId: room.id, groupId: group.groupId }, `เชื่อม “${room.title}” กับกลุ่ม “${group.groupName || "LINE"}” แล้ว ✅`)}
                              className="w-full h-11 px-3 rounded-xl bg-line hover:bg-line-dark text-white font-bold text-sm inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
                            >
                              {busy === `link-group:${room.id}:${group.groupId}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                              <span className="truncate">{group.groupName || "กลุ่ม LINE"}</span>
                            </button>
                          ))}
                        </>
                      )}

                      {room.status === "waiting" ? (
                        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 text-xs text-amber-900 dark:text-amber-200 space-y-2">
                          <p className="font-bold">ขั้นต่อไปในกลุ่ม LINE ของห้องนี้</p>
                          <ol className="list-decimal pl-4 space-y-0.5">
                            <li>เปิดกลุ่ม → เมนู ☰ → เชิญ → เลือก Pudding Bot</li>
                            <li>บอทจะถาม “เชื่อมกลุ่มนี้กับ {room.title}?” แตะ <b>เชื่อมกลุ่ม</b></li>
                          </ol>
                          <p className="text-[11px] opacity-80">ถ้าบอทอยู่ในกลุ่มแล้ว แค่พิมพ์ข้อความใดก็ได้ในกลุ่ม</p>
                          <div className="flex gap-2 pt-1">
                            {liff?.isInClient() && (
                              <button type="button" onClick={() => liff.closeWindow()} className="flex-1 h-9 rounded-lg bg-amber-500 text-slate-950 font-black cursor-pointer">
                                ไปที่กลุ่ม LINE
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() => act({ action: "cancel", classroomId: room.id }, `ยกเลิกการรอของ “${room.title}” แล้ว`)}
                              className="px-3 h-9 rounded-lg ring-1 ring-amber-300 dark:ring-amber-800 font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                            >
                              <X className="w-3.5 h-3.5" /> ยกเลิก
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => act({ action: "arm", classroomId: room.id }, `พร้อมแล้ว: เชิญ Pudding Bot เข้ากลุ่มของ “${room.title}” ภายใน 24 ชม.`)}
                          className={`w-full h-11 px-3 rounded-xl font-bold text-sm inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 ${
                            data.candidates.length
                              ? "ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200"
                              : "bg-line hover:bg-line-dark text-white"
                          }`}
                        >
                          {busy === `arm:${room.id}:` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                          {data.candidates.length ? "กลุ่มอื่น (เชิญบอทภายหลัง)" : "เชื่อมกลุ่ม LINE"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <button
            type="button"
            onClick={() => openWeb("/classrooms?createClassroom=1")}
            className="w-full h-11 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> สร้างห้องเรียนใหม่ (เปิดเว็บ)
          </button>

          {linked.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-black text-slate-500 dark:text-slate-400">เชื่อมแล้ว ({linked.length})</h2>
              {linked.map((room) => (
                <div key={room.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800">
                  <CheckCircle2 className="w-5 h-5 shrink-0 text-line" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">{room.title}</span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {room.groupName ? `กลุ่ม “${room.groupName}”` : "กลุ่ม LINE"}
                      {room.term ? ` • ${room.term}` : ""}
                    </span>
                  </span>
                  {room.canUnlink && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      aria-label={`ยกเลิกการเชื่อม ${room.title}`}
                      onClick={() => {
                        if (!window.confirm(`ยกเลิกการเชื่อม “${room.title}”? บอทจะออกจากกลุ่มและหยุดส่งแจ้งเตือน`)) return;
                        void act({ action: "disconnect", classroomId: room.id }, `ยกเลิกการเชื่อม “${room.title}” แล้ว บอทออกจากกลุ่มแล้ว`);
                      }}
                      className="shrink-0 p-2 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer disabled:opacity-60"
                    >
                      {busy === `disconnect:${room.id}:` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}

          <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
            เริ่มจากกลุ่มก็ได้: เชิญ Pudding Bot เข้ากลุ่ม แล้วแตะ “เชื่อมห้องเรียน”
          </p>
        </>
      )}
    </div>
  );
}
