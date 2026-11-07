"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Liff } from "@line/liff";
import { CheckCircle2, GraduationCap, Loader2, Lock, Plus, RefreshCw, ShieldAlert, Unlink, Users } from "lucide-react";
import { LINE_TOKEN_HEADER } from "@/lib/auth/lineSession";

type Group = { ref: string; groupName?: string; linkedClassroomId?: string };
type Room = { id: string; title: string; term: string; linked: boolean; groupName?: string; groupRef?: string; canUnlink: boolean };
type Overview = {
  teacher: { firstName: string };
  groups: Group[];
  focus?: Group | { ref: string; error: string };
  classrooms: Room[];
};
type Blocked = { message: string; code?: string };

const groupLabel = (group?: { groupName?: string }) => group?.groupName || "กลุ่ม LINE";

/**
 * /liff/connect (teachers only): pick a LINE group the bot is in and a
 * classroom, then link them, all on this page. Opened from the bot's
 * "เชื่อมห้องเรียน" button in a group (?g=<ref> preselects that group) or the
 * rich menu. The server checks the LINE account is an approved teacher and
 * that LINE lists them in the group; students see a "teachers only" screen and
 * get no data.
 */
export default function TeacherConnectPage() {
  const [liff, setLiff] = useState<Liff | null>(null);
  const [token, setToken] = useState("");
  const [focusRef, setFocusRef] = useState<string | null>(null);
  const [data, setData] = useState<Overview | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [groupRef, setGroupRef] = useState<string | null>(null);
  const [classroomId, setClassroomId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [done, setDone] = useState<{ group: string; classroom: string } | null>(null);

  const apply = useCallback((overview: Overview) => {
    setData(overview);
    // Keep the teacher's choice if it is still on the list; else the tapped group, else the only one.
    setGroupRef((current) => {
      if (current && overview.groups.some((group) => group.ref === current)) return current;
      const focus = overview.focus && !("error" in overview.focus) ? overview.focus.ref : null;
      return focus || (overview.groups.length === 1 ? overview.groups[0].ref : null);
    });
  }, []);

  const load = useCallback(
    async (accessToken: string, ref: string | null) => {
      const res = await fetch(`/api/line/liff-connect${ref ? `?g=${encodeURIComponent(ref)}` : ""}`, {
        headers: { [LINE_TOKEN_HEADER]: accessToken },
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBlocked({ message: json.error || "โหลดข้อมูลไม่สำเร็จ", code: json.code });
        return;
      }
      setBlocked(null);
      apply(json as Overview);
    },
    [apply]
  );

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
        // Read after init: LIFF restores the path and query from liff.state first.
        const ref = new URLSearchParams(window.location.search).get("g");
        const accessToken = sdk.getAccessToken() || "";
        if (!alive) return;
        setLiff(sdk);
        setToken(accessToken);
        setFocusRef(ref);
        await load(accessToken, ref);
      } catch (err) {
        if (alive) setBlocked({ message: err instanceof Error ? err.message : "เกิดข้อผิดพลาด" });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    setMessage(null);
    try {
      await load(token, focusRef);
    } finally {
      setRefreshing(false);
    }
  };

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch("/api/line/liff-connect", {
        method: "POST",
        headers: { "content-type": "application/json", [LINE_TOKEN_HEADER]: token },
        body: JSON.stringify({ ...body, focusRef }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "ทำรายการไม่สำเร็จ");
      apply(json as Overview);
      return true;
    } catch (err) {
      setMessage({ tone: "error", text: err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ" });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const openWeb = (path: string) => {
    const url = `${window.location.origin}${path}`;
    if (liff?.isInClient()) liff.openWindow({ url, external: true });
    else window.open(url, "_blank", "noopener");
  };

  const group = data?.groups.find((item) => item.ref === groupRef);
  const room = data?.classrooms.find((item) => item.id === classroomId);
  const groupOwner = group?.linkedClassroomId ? data?.classrooms.find((item) => item.id === group.linkedClassroomId) : undefined;
  const focusError = data?.focus && "error" in data.focus ? data.focus.error : null;
  const linkedRooms = useMemo(() => data?.classrooms.filter((item) => item.linked) || [], [data]);

  // What the main button does for the current choice.
  const plan: { label: string; move: boolean } | { blocked: string } | null = (() => {
    if (!group || !room) return null;
    if (room.linked && room.id !== group.linkedClassroomId) return { blocked: `“${room.title}” เชื่อมกับกลุ่ม “${room.groupName || "LINE"}” อยู่ ยกเลิกการเชื่อมเดิมก่อน` };
    if (room.id === group.linkedClassroomId) return { blocked: "ห้องนี้เชื่อมกับกลุ่มนี้อยู่แล้ว" };
    if (groupOwner) {
      return groupOwner.canUnlink
        ? { label: `ย้ายกลุ่มจาก “${groupOwner.title}” มาห้องนี้`, move: true }
        : { blocked: `กลุ่มนี้เชื่อมกับ “${groupOwner.title}” และคุณครูไม่มีสิทธิ์ย้าย` };
    }
    return { label: "เชื่อมกลุ่มกับห้องเรียนนี้", move: false };
  })();

  const connect = async () => {
    if (!group || !room || !plan || "blocked" in plan) return;
    if (plan.move && !window.confirm(`ย้ายกลุ่ม “${groupLabel(group)}” จาก “${groupOwner?.title}” มาที่ “${room.title}”?`)) return;
    const ok = await post({ action: "link", classroomId: room.id, groupRef: group.ref, move: plan.move }, "link");
    if (ok) setDone({ group: groupLabel(group), classroom: room.title });
  };

  const disconnect = async (target: Room) => {
    if (!window.confirm(`ยกเลิกการเชื่อม “${target.title}” กับกลุ่ม “${target.groupName || "LINE"}”?\nบอทจะออกจากกลุ่มและหยุดส่งแจ้งเตือน`)) return;
    const ok = await post({ action: "disconnect", classroomId: target.id }, `unlink:${target.id}`);
    if (ok) setMessage({ tone: "ok", text: `ยกเลิกการเชื่อม “${target.title}” แล้ว บอทออกจากกลุ่มแล้ว` });
  };

  return (
    <div className="min-h-dvh flex flex-col bg-amber-50/40 dark:bg-slate-950">
      <header className="px-4 sm:px-6 pt-4 pb-3 bg-amber-500 text-slate-950">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-5 h-5" />
          <h1 className="text-base font-black">เชื่อมกลุ่ม LINE กับห้องเรียน</h1>
        </div>
        <p className="text-[11px] font-bold opacity-80 mt-0.5">
          สำหรับคุณครู{data?.teacher.firstName ? ` • คุณครู${data.teacher.firstName}` : ""}
        </p>
      </header>

      <main className="flex-1 p-4 sm:p-6 space-y-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" /> กำลังตรวจสอบบัญชีครู...
          </div>
        )}

        {!loading && blocked && (
          <div className="py-8 text-center space-y-4">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center">
              {blocked.code === "not-teacher" ? <Lock className="w-7 h-7 text-slate-600 dark:text-slate-300" /> : <ShieldAlert className="w-7 h-7 text-rose-600" />}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-black text-slate-900 dark:text-white">{blocked.message}</p>
              {blocked.code === "not-teacher" && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  นักเรียนไม่ต้องทำอะไรในหน้านี้ค่ะ<br />คุณครูที่ยังไม่ได้ใช้ Pudding ให้เข้าสู่ระบบเว็บด้วย LINE บัญชีนี้ก่อน
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 max-w-xs mx-auto">
              {blocked.code === "not-teacher" && (
                <button type="button" onClick={() => window.location.replace("/liff")} className="h-11 rounded-xl bg-line hover:bg-line-dark text-white font-bold text-sm cursor-pointer">
                  ไปหน้าห้องเรียนของนักเรียน
                </button>
              )}
              {(blocked.code === "incomplete" || blocked.code === "pending" || blocked.code === "rejected") && (
                <button
                  type="button"
                  onClick={() => openWeb("/pending-approval")}
                  className="h-11 rounded-xl ring-1 ring-slate-300 dark:ring-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm cursor-pointer"
                >
                  ดูสถานะบัญชีบนเว็บ
                </button>
              )}
              {liff?.isInClient() && (
                <button type="button" onClick={() => liff.closeWindow()} className="text-xs text-slate-500 underline cursor-pointer">
                  ปิดหน้านี้
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && !blocked && data && done && (
          <div className="py-8 text-center space-y-4">
            <CheckCircle2 className="mx-auto w-14 h-14 text-line" />
            <div className="space-y-1">
              <p className="text-base font-black text-slate-900 dark:text-white">เชื่อมเรียบร้อยแล้ว</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                กลุ่ม “{done.group}” ↔ “{done.classroom}”
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">ในกลุ่ม พิมพ์ “พุดดิ้ง เข้าห้อง” เพื่อส่งลิงก์เข้าห้องเรียนให้นักเรียน</p>
            </div>
            <div className="flex flex-col gap-2 max-w-xs mx-auto">
              {liff?.isInClient() && (
                <button type="button" onClick={() => liff.closeWindow()} className="h-11 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-sm cursor-pointer">
                  กลับไปที่ LINE
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDone(null);
                  setClassroomId(null);
                }}
                className="h-11 rounded-xl ring-1 ring-slate-300 dark:ring-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm cursor-pointer"
              >
                เชื่อมกลุ่มอื่น
              </button>
            </div>
          </div>
        )}

        {!loading && !blocked && data && !done && (
          <>
            {message && (
              <p
                role={message.tone === "error" ? "alert" : "status"}
                className={`text-xs p-2.5 rounded-xl ring-1 ${
                  message.tone === "error"
                    ? "bg-rose-50 dark:bg-rose-950/40 ring-rose-200 dark:ring-rose-900 text-rose-800 dark:text-rose-200"
                    : "bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900 text-emerald-900 dark:text-emerald-200"
                }`}
              >
                {message.text}
              </p>
            )}

            {/* Step 1: group */}
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-black text-slate-700 dark:text-slate-300">1. เลือกกลุ่ม LINE</h2>
                <button type="button" onClick={refresh} disabled={refreshing} className="text-[11px] font-bold text-amber-700 dark:text-amber-400 inline-flex items-center gap-1 cursor-pointer disabled:opacity-60">
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> รีเฟรช
                </button>
              </div>
              {focusError && (
                <p role="alert" className="text-xs p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 text-rose-800 dark:text-rose-200">
                  {focusError}
                </p>
              )}
              {!data.groups.length && (
                <div className="p-3 rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
                  <p className="font-bold text-slate-800 dark:text-slate-100">ยังไม่พบกลุ่มที่มี Pudding Bot และคุณครูอยู่ด้วยกัน</p>
                  <ol className="list-decimal pl-4 space-y-0.5">
                    <li>เปิดกลุ่ม LINE ของห้องเรียน → เมนู ☰ → เชิญ → เลือก Pudding Bot</li>
                    <li>แตะ “เชื่อมห้องเรียน” ในข้อความของบอท หรือกลับมากด “รีเฟรช”</li>
                  </ol>
                </div>
              )}
              <div role="radiogroup" aria-label="กลุ่ม LINE" className="space-y-2">
                {data.groups.map((item) => {
                  const selected = item.ref === groupRef;
                  const owner = item.linkedClassroomId ? data.classrooms.find((c) => c.id === item.linkedClassroomId) : undefined;
                  return (
                    <button
                      key={item.ref}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setGroupRef(item.ref)}
                      className={`w-full flex items-center gap-3 p-3 rounded-2xl text-left cursor-pointer ring-2 transition-colors ${
                        selected ? "ring-amber-500 bg-amber-50 dark:bg-amber-950/30" : "ring-transparent bg-white dark:bg-slate-900 outline outline-1 outline-slate-200 dark:outline-slate-800"
                      }`}
                    >
                      <Users className={`w-5 h-5 shrink-0 ${selected ? "text-amber-600" : "text-slate-400"}`} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">{groupLabel(item)}</span>
                        <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {owner ? `เชื่อมกับ “${owner.title}” อยู่` : "ยังไม่ได้เชื่อม"}
                          {item.ref === focusRef ? " • กลุ่มที่เปิดมา" : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Step 2: classroom */}
            <section className="space-y-2">
              <h2 className="text-xs font-black text-slate-700 dark:text-slate-300">2. เลือกห้องเรียน</h2>
              {!data.classrooms.length && (
                <p className="text-xs text-slate-500 dark:text-slate-400 p-3 rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800">
                  ยังไม่มีห้องเรียน สร้างห้องเรียนใหม่ด้านล่างได้เลย
                </p>
              )}
              <div role="radiogroup" aria-label="ห้องเรียน" className="space-y-2">
                {data.classrooms.map((item) => {
                  const selected = item.id === classroomId;
                  const here = group && item.id === group.linkedClassroomId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setClassroomId(item.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-2xl text-left cursor-pointer ring-2 transition-colors ${
                        selected ? "ring-amber-500 bg-amber-50 dark:bg-amber-950/30" : "ring-transparent bg-white dark:bg-slate-900 outline outline-1 outline-slate-200 dark:outline-slate-800"
                      } ${item.linked && !here ? "opacity-60" : ""}`}
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">{item.title}</span>
                        <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {item.term}
                          {item.linked ? ` • ${here ? "เชื่อมกับกลุ่มนี้" : `เชื่อมกับ “${item.groupName || "กลุ่ม LINE"}”`}` : ""}
                        </span>
                      </span>
                      {item.linked && <CheckCircle2 className="w-4 h-4 shrink-0 text-line" />}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => {
                  const params = new URLSearchParams({ createClassroom: "1" });
                  if (group) {
                    params.set("lineGroup", group.ref);
                    if (group.groupName) params.set("groupName", group.groupName);
                  }
                  openWeb(`/classrooms?${params}`);
                }}
                className="w-full h-11 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-4 h-4" /> {group && !group.linkedClassroomId ? "สร้างห้องเรียนใหม่สำหรับกลุ่มนี้" : "สร้างห้องเรียนใหม่"} (เปิดเว็บ)
              </button>
            </section>

            {linkedRooms.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-black text-slate-700 dark:text-slate-300">เชื่อมแล้ว ({linkedRooms.length})</h2>
                {linkedRooms.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-3 rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800">
                    <CheckCircle2 className="w-5 h-5 shrink-0 text-line" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">{item.title}</span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">กลุ่ม “{item.groupName || "LINE"}”</span>
                    </span>
                    {item.canUnlink && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        aria-label={`ยกเลิกการเชื่อม ${item.title}`}
                        onClick={() => disconnect(item)}
                        className="shrink-0 p-2 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer disabled:opacity-60"
                      >
                        {busy === `unlink:${item.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </main>

      {!loading && !blocked && data && !done && (
        <footer className="fixed inset-x-0 bottom-0 flex justify-center pointer-events-none">
          <div className="w-full max-w-md md:max-w-2xl lg:max-w-3xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-white/95 dark:bg-slate-950/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 space-y-1.5 pointer-events-auto">
            {plan && "blocked" in plan && <p className="text-[11px] text-center text-amber-800 dark:text-amber-300">{plan.blocked}</p>}
            <button
              type="button"
              onClick={connect}
              disabled={!plan || "blocked" in plan || busy !== null}
              className="w-full h-12 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-sm inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === "link" && <Loader2 className="w-4 h-4 animate-spin" />}
              {plan && !("blocked" in plan) ? plan.label : !group ? "เลือกกลุ่ม LINE ก่อน" : !room ? "เลือกห้องเรียน" : "เชื่อมไม่ได้"}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
