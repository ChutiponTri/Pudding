"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
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

export type CardKind = "work" | "attendance" | "invite" | "guide" | "remind";

/** How a card trigger reached the group. */
export type PostResult = "sent" | "shared" | "copied" | "cancelled";

type Kit = TeacherContext & {
  liff: Liff;
  /** The group ref the menu was opened with. */
  groupRef: string;
  go: (view: TeacherView) => void;
  /**
   * Posts a card trigger into the group this page was opened from
   * (liff.sendMessages, as the teacher); the bot answers it with the card.
   * Falls back to the share picker, then to copying.
   */
  postCard: (trigger: string) => Promise<PostResult>;
  /** A trigger for an existing item (resend a work card, invite, …), then posted. */
  postKind: (kind: CardKind, item?: { assignmentId?: string; sessionId?: string }) => Promise<PostResult>;
  toast: (text: string, tone?: "ok" | "error") => void;
};

const KitContext = createContext<Kit | null>(null);

export function useKit(): Kit {
  const kit = useContext(KitContext);
  if (!kit) throw new Error("useKit outside the teacher LIFF");
  return kit;
}

export function KitProvider({ value, children }: { value: Omit<Kit, "postCard" | "postKind" | "toast">; children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const toast = useCallback((text: string, tone: "ok" | "error" = "ok") => setMessage({ text, tone }), []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [message]);

  const { liff, groupRef } = value;
  const postCard = useCallback(
    async (trigger: string): Promise<PostResult> => {
      const messages = [{ type: "text" as const, text: trigger }];
      const type = liff.getContext()?.type;
      // Opened from the class group: the trigger goes straight into it.
      if (type === "group" || type === "room" || type === "utou") {
        try {
          await liff.sendMessages(messages);
          toast("ส่งเข้ากลุ่มแล้ว บอทกำลังโพสต์การ์ด");
          return "sent";
        } catch (error) {
          console.warn("liff.sendMessages failed, falling back to the share picker:", error);
        }
      }
      if (liff.isApiAvailable("shareTargetPicker")) {
        const result = await liff.shareTargetPicker(messages, { isMultiple: false }).catch(() => null);
        if (result?.status === "success") {
          toast("แชร์แล้ว บอทกำลังโพสต์การ์ดในกลุ่ม");
          return "shared";
        }
        return "cancelled";
      }
      await navigator.clipboard?.writeText(trigger).catch(() => {});
      toast("คัดลอกข้อความแล้ว วางในกลุ่ม LINE ของห้อง บอทจะตอบด้วยการ์ด");
      return "copied";
    },
    [liff, toast]
  );

  const postKind = useCallback(
    async (kind: CardKind, item: { assignmentId?: string; sessionId?: string } = {}) => {
      const res = await authFetch("/api/line/liff-teacher", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ g: groupRef, kind, ...item }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "สร้างการ์ดไม่สำเร็จ");
      return postCard(json.trigger as string);
    },
    [groupRef, postCard]
  );

  return (
    <KitContext.Provider value={{ ...value, postCard, postKind, toast }}>
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

export const errorText = (err: unknown, fallback = "ทำรายการไม่สำเร็จ") => (err instanceof Error ? err.message : fallback);
