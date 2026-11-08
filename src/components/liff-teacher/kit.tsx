"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Liff } from "@line/liff";
import { CheckCircle2, ChevronLeft, ExternalLink, Loader2, LogOut, Moon, ShieldAlert, Sun } from "lucide-react";
import { authFetch, setLineAccessToken } from "@/lib/auth/lineSession";
import { useTheme } from "@/lib/theme/ThemeContext";
import { Avatar } from "@/components/Avatar";
import { clearCache, fetchOnce, isFresh, isLoading, readCache, staleCache, subscribeCache, writeCache } from "./cache";

/** Pages of the teacher LIFF app (/liff/teacher?view=…), one per group menu button. */
export type TeacherView =
  | "home"
  | "attendance"
  | "invite"
  | "classroom"
  | "status"
  | "create"
  | "publish"
  | "grade"
  | "results"
  | "remind"
  | "help"
  | "guide";

export type TeacherContext = {
  teacher: { id: string; firstName: string; name: string; isOwner: boolean };
  classroom: { id: string; name: string; title: string; subject: string; inviteCode: string | null; courseId: string | null; groupName: string | null };
};

export type CardKind = "work" | "invite" | "guide" | "remind" | "open" | "results";

/** The data a page shows, loaded with the classroom in one request (see /api/line/liff-teacher). */
export type DataKind = "work" | "roster" | "attendance";
export const dataKindFor = (view: TeacherView): DataKind | null =>
  view === "home" || view === "status" || view === "publish" || view === "results" || view === "remind" || view === "grade"
    ? "work"
    : view === "classroom" || view === "invite"
    ? "roster"
    : view === "attendance"
    ? "attendance"
    : null;

export type RosterStudent = { id: string; first_name: string; last_name: string; student_id?: string; line_uid?: string };
export type RosterData = { students: RosterStudent[]; pending: RosterStudent[] };
export type WorkData = {
  students: number;
  pending: number;
  works: Array<{ work: import("@/types/database").Assignment; total: number; handed: number; graded: number; toGrade: number; missing: number }>;
};
export type AttendanceData = {
  sessions: Array<{ id: string; title: string; starts_at: string; on_time_until_minutes: number; late_until_minutes: number; status: "open" | "closed" }>;
  records: Array<{ session_id: string; student_id: string; status: string }>;
  students: RosterStudent[];
};

/** What the server gives for a share: the share page URL carries its token. */
export type Share = { text: string; url: string | null; messages?: unknown[] };

/** How a card reached the group. */
export type PostResult = "sent" | "shared" | "copied" | "cancelled";

type LineMessages = Parameters<Liff["sendMessages"]>[0];

type Kit = TeacherContext & {
  liff: Liff;
  /** The group ref the menu was opened with. */
  groupRef: string;
  /** Cache keys of this LINE account and group start with it (see ./cache). */
  cacheScope: string;
  go: (view: TeacherView) => void;
  /**
   * Sends messages (a finished card, or the reminder picture the bot answers)
   * straight into the group this page was opened from, as the teacher
   * (liff.sendMessages): no group to pick, no message quota. Falls back to
   * the share picker, then to copying `text`.
   */
  postMessages: (messages: LineMessages, text?: string) => Promise<PostResult>;
  /** What an action's share (new work, check-in, results…) sends, sent the same way. */
  postShare: (share: Share | null | undefined) => Promise<PostResult>;
  /** The card for an existing item (work card again, invite, reminder picture…), sent the same way. */
  postKind: (kind: CardKind, item?: { assignmentId?: string; sessionId?: string }) => Promise<PostResult>;
  toast: (text: string, tone?: "ok" | "error") => void;
  /** The page's data from the server (one request at a time per kind; the answer is cached). */
  fetchData: (kind: DataKind) => Promise<unknown>;
  /** The request itself, without the cache (useCached wraps it). */
  loadData: (kind: DataKind) => Promise<unknown>;
  /** Cache key of a kind of data. */
  keyOf: (kind: DataKind) => string;
  /** After a change: those pages' data is refreshed (now if open, else when opened). */
  invalidate: (...kinds: DataKind[]) => void;
  /** Loads data in the background (a page the teacher will likely open next), unless fresh. */
  prefetch: (...kinds: DataKind[]) => void;
  /** Whether "send to group" goes straight into this group (opened from it, and LINE allows sending). */
  autoSend: boolean;
  /** Opened from the class group's menu (not the 1:1 chat or a browser). */
  fromGroup: boolean;
  /** LINE's permission to send into the chat: "prompt" needs the teacher's OK once (askPermission). */
  permission: "granted" | "prompt" | "unavailable" | "unknown";
  askPermission: () => Promise<void>;
};

const KitContext = createContext<Kit | null>(null);

export function useKit(): Kit {
  const kit = useContext(KitContext);
  if (!kit) throw new Error("useKit outside the teacher LIFF");
  return kit;
}

async function readJson(res: Response, fallback: string) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || fallback);
  return json;
}

export function KitProvider({
  value,
  children,
}: {
  value: Omit<Kit, "postMessages" | "postShare" | "postKind" | "toast" | "fetchData" | "loadData" | "keyOf" | "invalidate" | "prefetch" | "autoSend" | "fromGroup" | "permission" | "askPermission">;
  children: ReactNode;
}) {
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error"; id: number } | null>(null);
  // A new id each time: the same text again still animates in.
  const toast = useCallback((text: string, tone: "ok" | "error" = "ok") => setMessage({ text, tone, id: Date.now() }), []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);

  const { liff, groupRef, cacheScope } = value;
  const keyOf = useCallback((kind: DataKind) => `${cacheScope}:${kind}`, [cacheScope]);
  const loadData = useCallback(
    async (kind: DataKind) => {
      const res = await authFetch(`/api/line/liff-teacher?g=${encodeURIComponent(groupRef)}&view=${kind}`, { cache: "no-store" });
      return (await readJson(res, "โหลดข้อมูลไม่สำเร็จ")).data;
    },
    [groupRef]
  );
  const fetchData = useCallback((kind: DataKind) => fetchOnce(keyOf(kind), () => loadData(kind)), [keyOf, loadData]);
  const invalidate = useCallback((...kinds: DataKind[]) => staleCache(kinds.map(keyOf)), [keyOf]);
  const prefetch = useCallback(
    (...kinds: DataKind[]) => {
      for (const kind of kinds) if (!isFresh(readCache(keyOf(kind)))) fetchData(kind).catch(() => {});
    },
    [fetchData, keyOf]
  );
  // Once the first page is up, the other pages' data loads quietly, so tapping a menu button shows it at once.
  useEffect(() => {
    const timer = setTimeout(() => prefetch("work", "roster", "attendance"), 900);
    return () => clearTimeout(timer);
  }, [prefetch]);
  /**
   * Opened from the class group (the menu card's buttons): cards go straight
   * into it with liff.sendMessages, no group to pick. Opened anywhere else (the
   * 1:1 chat with the bot, a browser), the teacher picks the group as before:
   * sending "straight in" there would land in the wrong chat.
   */
  const [fromGroup] = useState(() => ["group", "room"].includes(liff.getContext()?.type || ""));
  /** Whether LINE lets this LIFF app send into the chat (its chat_message.write permission). */
  const [permission, setPermission] = useState<"granted" | "prompt" | "unavailable" | "unknown">("unknown");
  useEffect(() => {
    if (!fromGroup) return;
    liff.permission
      ?.query("chat_message.write")
      .then((status) => setPermission(status.state))
      .catch(() => setPermission("unknown"));
  }, [liff, fromGroup]);
  const autoSend = fromGroup && permission !== "unavailable";
  /** Shows LINE's consent screen for sending messages (needed once when it is "prompt"). */
  const askPermission = useCallback(async () => {
    try {
      await liff.permission.requestAll();
      const status = await liff.permission.query("chat_message.write");
      setPermission(status.state);
    } catch (error) {
      console.warn("LINE permission request failed:", error);
    }
  }, [liff]);

  const postMessages = useCallback(
    async (messages: LineMessages, text = ""): Promise<PostResult> => {
      if (fromGroup && permission !== "unavailable") {
        try {
          if (permission === "prompt") await askPermission();
          await liff.sendMessages(messages);
          toast("ส่งเข้ากลุ่มแล้ว");
          return "sent";
        } catch (error) {
          console.warn("liff.sendMessages failed, falling back to the share picker:", error);
          toast("ส่งเข้ากลุ่มอัตโนมัติไม่สำเร็จ เลือกกลุ่มเองได้เลย", "error");
        }
      }
      // Anywhere else (or LINE refused): the teacher picks the group.
      if (liff.isApiAvailable("shareTargetPicker")) {
        const result = await liff.shareTargetPicker(messages, { isMultiple: true }).catch(() => null);
        if (result?.status === "success") {
          toast("แชร์เข้ากลุ่มแล้ว");
          return "shared";
        }
        return "cancelled";
      }
      if (text) await navigator.clipboard?.writeText(text).catch(() => {});
      toast(text ? "คัดลอกข้อความแล้ว วางในกลุ่ม LINE ของห้องได้เลย" : "ส่งเข้ากลุ่มไม่ได้บนอุปกรณ์นี้", text ? "ok" : "error");
      return "copied";
    },
    [liff, toast, fromGroup, permission, askPermission]
  );

  const postShare = useCallback(
    async (share: Share | null | undefined): Promise<PostResult> => {
      const token = share?.url ? new URL(share.url).searchParams.get("t") : null;
      if (!token) throw new Error("ไม่มีข้อความให้ส่ง");
      // The server usually sends the card with its answer; otherwise it is loaded by the token.
      const json = share?.messages?.length
        ? { messages: share.messages, text: share.text }
        : await readJson(await authFetch(`/api/line/share?t=${encodeURIComponent(token)}`, { cache: "no-store" }), "โหลดการ์ดไม่สำเร็จ");
      const result = await postMessages(json.messages as LineMessages, json.text as string);
      // Like /liff/share: the timeline stops offering it as unsent.
      if (result === "sent" || result === "shared") {
        authFetch("/api/line/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: token }) }).catch(() => {});
      }
      return result;
    },
    [postMessages]
  );

  const postKind = useCallback(
    async (kind: CardKind, item: { assignmentId?: string; sessionId?: string } = {}) => {
      const json = await readJson(
        await authFetch("/api/line/liff-teacher", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ g: groupRef, kind, ...item }),
        }),
        "สร้างการ์ดไม่สำเร็จ"
      );
      return postMessages(json.messages as LineMessages);
    },
    [groupRef, postMessages]
  );

  return (
    <KitContext.Provider
      value={{ ...value, postMessages, postShare, postKind, toast, fetchData, loadData, keyOf, invalidate, prefetch, autoSend, fromGroup, permission, askPermission }}
    >
      {children}
      {message && (
        <div className="fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 pointer-events-none">
          <div
            key={message.id}
            role="status"
            className={`animate-in fade-in slide-in-from-bottom-5 [--tw-duration:320ms] max-w-md w-full px-4 py-3 rounded-2xl text-sm font-bold shadow-lg shadow-slate-900/15 flex items-center gap-2 ${
              message.tone === "ok" ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-rose-600 text-white"
            }`}
          >
            {message.tone === "ok" ? <CheckCircle2 className="liff-pop w-4 h-4 shrink-0 text-amber-400 dark:text-amber-500" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
            <span>{message.text}</span>
          </div>
        </div>
      )}
    </KitContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// UI pieces (amber theme, as on the teacher website)
// ---------------------------------------------------------------------------

/** The page header's right side, as in the student LIFF: light / dark mode, and the teacher's profile menu. */
function HeaderActions() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? "เปลี่ยนเป็นโหมดสว่าง" : "เปลี่ยนเป็นโหมดมืด"}
        title={theme === "dark" ? "โหมดสว่าง" : "โหมดมืด"}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-950/60 dark:hover:bg-amber-900/60 dark:text-amber-200 transition-colors cursor-pointer"
      >
        {theme === "dark" ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
      </button>
      <ProfileMenu />
    </div>
  );
}

/** The LINE photo of whoever signed in (from the ID token: no request). */
function linePicture(liff: Liff): string | undefined {
  try {
    return liff.getDecodedIDToken()?.picture || undefined;
  } catch {
    return undefined;
  }
}

/** Avatar button and its menu: who is signed in, the class, the teacher website, sign out. */
function ProfileMenu() {
  const { liff, teacher, classroom, cacheScope } = useKit();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [picture] = useState(() => linePicture(liff));

  // Close on an outside tap or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const name = teacher.name || teacher.firstName || "คุณครู";
  const openWebsite = () => {
    setOpen(false);
    // The full teacher website (profile, grading, reports) in the phone's browser.
    liff.openWindow({ url: `${window.location.origin}/dashboard`, external: true });
  };
  const signOut = () => {
    setOpen(false);
    if (!confirm("ออกจากระบบ?")) return;
    // The next person on this phone must not see this class's data.
    clearCache(cacheScope);
    if (liff.isLoggedIn()) liff.logout();
    setLineAccessToken(null);
    if (liff.isInClient()) liff.closeWindow();
    else window.location.reload();
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="โปรไฟล์ของฉัน"
        title={name}
        className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-amber-100 dark:hover:bg-amber-950/50 transition-colors cursor-pointer"
      >
        <Avatar src={picture} name={name} className="w-8 h-8 text-[11px] ring-2 ring-amber-300 dark:ring-amber-700" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xl shadow-slate-900/15 ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden animate-in fade-in slide-in-from-top-1"
        >
          <div className="p-4 flex items-center gap-3 bg-amber-50/80 dark:bg-amber-950/30 border-b border-slate-100 dark:border-slate-800">
            <Avatar src={picture} name={name} className="w-11 h-11 text-sm shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold truncate">{name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{teacher.isOwner ? "ครูประจำวิชา" : "ผู้สอนร่วม"}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">🏫 {classroom.title}</p>
              {classroom.groupName && <p className="text-xs text-slate-500 dark:text-slate-400 truncate">💬 {classroom.groupName}</p>}
            </div>
          </div>
          <div className="p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={openWebsite}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <ExternalLink className="w-4.5 h-4.5 text-amber-600" />
              <span>แก้ไขโปรไฟล์บนเว็บไซต์คุณครู</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
            >
              <LogOut className="w-4.5 h-4.5" />
              <span>ออกจากระบบ</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Page({
  title,
  subtitle,
  children,
  back = true,
  refreshing = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  back?: boolean;
  /** Cached data is on screen while the fresh copy loads: a thin bar at the top says so. */
  refreshing?: boolean;
}) {
  const { go, classroom } = useKit();
  return (
    <>
      <div aria-hidden className={`fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden pointer-events-none transition-opacity duration-300 ${refreshing ? "opacity-100" : "opacity-0"}`}>
        <div className="h-full w-full bg-amber-500 animate-fetch-bar" />
      </div>
      <div className="liff-stagger p-4 space-y-4 pb-[calc(5rem+env(safe-area-inset-bottom))]">
      <header className="flex items-center gap-2">
        {back && (
          <button type="button" onClick={() => go("home")} aria-label="กลับเมนู" className="w-9 h-9 -ml-1 rounded-xl flex items-center justify-center text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/50 cursor-pointer">
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-black text-slate-900 dark:text-white truncate">{title}</h1>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{subtitle || classroom.title}</p>
        </div>
        <HeaderActions />
      </header>
      {children}
      </div>
    </>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-amber-100 dark:ring-slate-800 p-4 ${className}`}>{children}</div>;
}

type ButtonTone = "primary" | "soft" | "green" | "red" | "ghost";
const TONES: Record<ButtonTone, string> = {
  primary: "bg-amber-500 hover:bg-amber-600 text-white",
  soft: "bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  green: "bg-emerald-500 hover:bg-emerald-600 text-white",
  red: "bg-rose-500 hover:bg-rose-600 text-white",
  ghost: "ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200",
};

export function Button({
  children,
  onClick,
  tone = "primary",
  busy = false,
  disabled = false,
  small = false,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: ButtonTone;
  busy?: boolean;
  disabled?: boolean;
  small?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className={`${small ? "h-8 px-3 text-xs rounded-lg" : "h-11 px-4 text-sm rounded-xl"} font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-[0.98] transition-transform ${TONES[tone]} ${className}`}
    >
      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

export const inputClass =
  "w-full h-11 px-3 rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 focus:ring-2 focus:ring-amber-500 outline-none text-sm text-slate-900 dark:text-white";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export function Loading({ text = "กำลังโหลด..." }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 animate-fade">
      <Loader2 className="w-4 h-4 animate-spin text-amber-500" /> {text}
    </div>
  );
}

/** Placeholder rows while a page's data loads for the first time. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-label="กำลังโหลด" className="space-y-2.5 animate-fade">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-amber-100 dark:ring-slate-800 p-4 space-y-2">
          <div className="h-3 w-2/3 rounded-full bg-slate-200/80 dark:bg-slate-800 animate-pulse" />
          <div className="h-2.5 w-1/3 rounded-full bg-slate-100 dark:bg-slate-800/70 animate-pulse [animation-delay:150ms]" />
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({ text }: { text: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 text-sm text-rose-800 dark:text-rose-200">
      <ShieldAlert className="w-5 h-5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="text-center text-sm text-slate-400 py-8">{text}</p>;
}

export function Done({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="text-center space-y-3 py-6">
      <span className="liff-pop">
        <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500" />
      </span>
      <p className="font-black text-slate-900 dark:text-white">{title}</p>
      {children}
    </Card>
  );
}

/** Small pill (counts, states). */
export function Pill({ children, tone = "amber" }: { children: ReactNode; tone?: "violet" | "amber" | "green" | "red" | "slate" }) {
  const tones = {
    violet: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    red: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold transition-colors duration-300 ${tones[tone]}`}>{children}</span>;
}

/** Runs an async load and keeps its data, error and a reload function (the old data stays on screen while it reloads). */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    load()
      .then((value) => {
        if (!alive) return;
        setData(value);
        setError("");
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);
  return { data, error, reload: () => setVersion((v) => v + 1) };
}

/**
 * Any cached load, stale-while-revalidate (see ./cache): what the cache has
 * shows at once and is refreshed in the background when older than STALE_MS
 * (or marked stale). `refreshing` is true while that runs; `mutate` changes
 * the cached copy right away (an optimistic update). `key` null = not yet.
 */
export function useCached<T>(key: string | null, load: () => Promise<T>) {
  const subscribe = useCallback((notify: () => void) => (key ? subscribeCache(key, notify) : () => {}), [key]);
  // The same entry object until it changes, so React re-renders only on a new copy.
  const entry = useSyncExternalStore(subscribe, () => (key ? readCache(key) : null), () => null);
  const loading = useSyncExternalStore(subscribe, () => (key ? isLoading(key) : false), () => false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const revalidate = useCallback(() => {
    if (!key) return;
    fetchOnce(key, () => loadRef.current())
      .then(() => alive.current && setError(""))
      .catch((err) => alive.current && setError(err instanceof Error ? err.message : "โหลดข้อมูลไม่สำเร็จ"));
  }, [key]);

  // Missing, old, or marked stale: fetch it. A new copy is fresh, so this does not loop.
  const stale = !isFresh(entry);
  useEffect(() => {
    if (stale) revalidate();
  }, [stale, entry, revalidate]);

  const mutate = useCallback(
    (change: (current: T) => T) => {
      const current = key ? readCache(key) : null;
      if (key && current) writeCache(key, change(current.data as T), current.at);
    },
    [key]
  );
  const data = (entry?.data as T | undefined) ?? null;
  // An error only matters when there is nothing to show.
  return { data, error: data ? "" : error, refreshing: loading && !!data, reload: revalidate, mutate };
}

/** A page's data (see DataKind), through the cache (useCached). */
export function useViewData<T>(kind: DataKind) {
  const { loadData, keyOf } = useKit();
  return useCached<T>(keyOf(kind), () => loadData(kind) as Promise<T>);
}

export const errorText = (err: unknown, fallback = "ทำรายการไม่สำเร็จ") => (err instanceof Error ? err.message : fallback);
