"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Liff } from "@line/liff";
import { CheckCircle2, ChevronLeft, Loader2, ShieldAlert } from "lucide-react";
import { authFetch } from "@/lib/auth/lineSession";

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
export type Share = { text: string; url: string | null };

/** How a card reached the group. */
export type PostResult = "sent" | "shared" | "copied" | "cancelled";

type LineMessages = Parameters<Liff["sendMessages"]>[0];

type Kit = TeacherContext & {
  liff: Liff;
  /** The group ref the menu was opened with. */
  groupRef: string;
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
  /** The page's data: from the first load when it came with it, else one request. */
  fetchData: (kind: DataKind) => Promise<unknown>;
  /** Whether "send to group" goes straight into this group (opened from it, and LINE allows sending). */
  autoSend: boolean;
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
  initialData,
  children,
}: {
  value: Omit<Kit, "postMessages" | "postShare" | "postKind" | "toast" | "fetchData" | "autoSend">;
  /** Data that came with the first load, used once by its page. */
  initialData?: { kind: DataKind; data: unknown } | null;
  children: ReactNode;
}) {
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const toast = useCallback((text: string, tone: "ok" | "error" = "ok") => setMessage({ text, tone }), []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);

  const { liff, groupRef } = value;
  const prefetched = useRef(initialData || null);
  const fetchData = useCallback(
    async (kind: DataKind) => {
      if (prefetched.current?.kind === kind) {
        const { data } = prefetched.current;
        prefetched.current = null;
        return data;
      }
      const json = await readJson(await authFetch(`/api/line/liff-teacher?g=${encodeURIComponent(groupRef)}&view=${kind}`, { cache: "no-store" }), "โหลดข้อมูลไม่สำเร็จ");
      return json.data;
    },
    [groupRef]
  );
  // Opened from a chat, and the LIFF app may send messages there: cards go straight in.
  const [autoSend, setAutoSend] = useState(() => {
    const type = liff.getContext()?.type;
    return type === "group" || type === "room" || type === "utou";
  });
  useEffect(() => {
    if (!autoSend) return;
    liff.permission
      ?.query("chat_message.write")
      .then((status) => {
        if (status.state === "unavailable") setAutoSend(false);
      })
      .catch(() => {});
  }, [liff, autoSend]);
  const postMessages = useCallback(
    async (messages: LineMessages, text = ""): Promise<PostResult> => {
      const type = liff.getContext()?.type;
      // Opened from the class group: straight into it.
      if (type === "group" || type === "room" || type === "utou") {
        try {
          await liff.sendMessages(messages);
          toast("ส่งเข้ากลุ่มแล้ว");
          return "sent";
        } catch (error) {
          console.warn("liff.sendMessages failed, falling back to the share picker:", error);
        }
      }
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
    [liff, toast]
  );

  const postShare = useCallback(
    async (share: Share | null | undefined): Promise<PostResult> => {
      const token = share?.url ? new URL(share.url).searchParams.get("t") : null;
      if (!token) throw new Error("ไม่มีข้อความให้ส่ง");
      const json = await readJson(await authFetch(`/api/line/share?t=${encodeURIComponent(token)}`, { cache: "no-store" }), "โหลดการ์ดไม่สำเร็จ");
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
    <KitContext.Provider value={{ ...value, postMessages, postShare, postKind, toast, fetchData, autoSend }}>
      {children}
      {message && (
        <div className="fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-50 flex justify-center px-4 pointer-events-none">
          <div
            role="status"
            className={`max-w-md w-full px-4 py-3 rounded-2xl text-sm font-bold shadow-lg ${message.tone === "ok" ? "bg-violet-700 text-white" : "bg-rose-600 text-white"}`}
          >
            {message.text}
          </div>
        </div>
      )}
    </KitContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// UI pieces (light purple theme)
// ---------------------------------------------------------------------------

export function Page({ title, subtitle, children, back = true }: { title: string; subtitle?: string; children: ReactNode; back?: boolean }) {
  const { go, classroom } = useKit();
  return (
    <div className="p-4 space-y-4 pb-[calc(5rem+env(safe-area-inset-bottom))]">
      <header className="flex items-center gap-2">
        {back && (
          <button type="button" onClick={() => go("home")} aria-label="กลับเมนู" className="w-9 h-9 -ml-1 rounded-xl flex items-center justify-center text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-950 cursor-pointer">
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-lg font-black text-violet-950 dark:text-white truncate">{title}</h1>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{subtitle || classroom.title}</p>
        </div>
      </header>
      {children}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-violet-100 dark:ring-slate-800 p-4 ${className}`}>{children}</div>;
}

type ButtonTone = "primary" | "soft" | "green" | "red" | "ghost";
const TONES: Record<ButtonTone, string> = {
  primary: "bg-violet-600 hover:bg-violet-700 text-white",
  soft: "bg-violet-100 hover:bg-violet-200 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
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
  "w-full h-11 px-3 rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 focus:ring-2 focus:ring-violet-500 outline-none text-sm text-slate-900 dark:text-white";

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
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="w-4 h-4 animate-spin" /> {text}
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
      <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
      <p className="font-black text-violet-950 dark:text-white">{title}</p>
      {children}
    </Card>
  );
}

/** Small pill (counts, states). */
export function Pill({ children, tone = "violet" }: { children: ReactNode; tone?: "violet" | "amber" | "green" | "red" | "slate" }) {
  const tones = {
    violet: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    red: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
    slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${tones[tone]}`}>{children}</span>;
}

/** Runs an async load and keeps its data, error and a reload function. */
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

/** A page's data (see DataKind), with reload. */
export function useViewData<T>(kind: DataKind) {
  const { fetchData } = useKit();
  return useLoad(() => fetchData(kind) as Promise<T>, [kind]);
}

export const errorText = (err: unknown, fallback = "ทำรายการไม่สำเร็จ") => (err instanceof Error ? err.message : fallback);
