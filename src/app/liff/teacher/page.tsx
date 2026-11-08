"use client";

import { useCallback, useEffect, useState } from "react";
import type { Liff } from "@line/liff";
import { Link2, Lock } from "lucide-react";
import { authFetch, setLineAccessToken, setLiffTeacherMode } from "@/lib/auth/lineSession";
import { dataKindFor, KitProvider, Loading, type DataKind, type TeacherContext, type TeacherView } from "@/components/liff-teacher/kit";
import { ClassroomView, GuideView, HelpView, HomeView, InviteView, StatusView } from "@/components/liff-teacher/ClassViews";
import { AttendanceView } from "@/components/liff-teacher/AttendanceView";
import { PublishView, RemindView, ResultsView } from "@/components/liff-teacher/WorkViews";
import { CreateView } from "@/components/liff-teacher/CreateView";
import { GradeView } from "@/components/liff-teacher/GradeView";

const VIEWS: Record<TeacherView, () => React.ReactElement> = {
  home: HomeView,
  attendance: AttendanceView,
  invite: InviteView,
  classroom: ClassroomView,
  status: StatusView,
  create: CreateView,
  publish: PublishView,
  grade: GradeView,
  results: ResultsView,
  remind: RemindView,
  help: HelpView,
  guide: GuideView,
};
const isView = (value: string | null): value is TeacherView => !!value && value in VIEWS;

type Blocked = { message: string; code?: string; connectUrl?: string };

/** The LIFF app id inside a LINE context token (a JWT in the first page load's #hash). */
function liffIdInHash(): string | null {
  try {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("context_token");
    const part = token?.split(".")[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.liffId === "string" ? json.liffId : null;
  } catch {
    return null;
  }
}

/**
 * Which LIFF app opened this page: the teacher menu's own app (new menu cards),
 * or the student app (menu cards posted before it existed, which come here
 * through /liff). liff.init must get that app's id, or it fails with
 * "Invalid LIFF ID". The SDK keeps each app's session as LIFF_STORE:<id>:….
 */
function openingLiffId(mainId: string, teacherId: string): string {
  if (!teacherId || teacherId === mainId) return mainId;
  const fromHash = liffIdInHash();
  if (fromHash === teacherId || fromHash === mainId) return fromHash;
  const has = (id: string) => {
    try {
      return sessionStorage.getItem(`LIFF_STORE:${id}:context`) !== null || localStorage.getItem(`LIFF_STORE:${id}:context`) !== null;
    } catch {
      return false;
    }
  };
  if (has(teacherId)) return teacherId;
  if (has(mainId)) return mainId;
  return teacherId;
}

/**
 * /liff/teacher?g=<group ref>&view=<page>: the teacher menu of a class LINE
 * group, opened from the bot's menu card. Same data and rules as the teacher
 * website (its APIs, called as the LINE-verified teacher), in a smaller UI.
 * Cards go back into the group the page was opened from (liff.sendMessages
 * posts a trigger, the bot answers with the card), so there is no group to
 * pick and no message quota used.
 */
export default function TeacherLiffPage() {
  const [liff, setLiff] = useState<Liff | null>(null);
  const [groupRef, setGroupRef] = useState("");
  const [context, setContext] = useState<TeacherContext | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [view, setView] = useState<TeacherView>("home");
  /** The first page's data, which came with the classroom (one request to open the page). */
  const [initialData, setInitialData] = useState<{ kind: DataKind; data: unknown } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const liffModule = import("@line/liff");
        let mainId = process.env.NEXT_PUBLIC_LINE_LIFF_ID || "";
        let teacherId = process.env.NEXT_PUBLIC_LINE_TEACHER_LIFF_ID || "";
        if (!mainId) {
          const config = await (await fetch("/api/liff/config")).json();
          mainId = config.liffId || "";
          teacherId ||= config.teacherLiffId || "";
        }
        const id = openingLiffId(mainId, teacherId);
        if (!id) throw new Error("ไม่พบ LINE_LIFF_ID ในระบบ");
        const sdk = (await liffModule).default;
        await sdk.init({ liffId: id });
        if (!sdk.isLoggedIn()) {
          sdk.login({ redirectUri: window.location.href });
          return;
        }
        // Read after init: LIFF restores the path and query from liff.state first.
        const params = new URLSearchParams(window.location.search);
        const ref = params.get("g") || "";
        const startView = params.get("view");
        setLineAccessToken(sdk.getAccessToken());
        setLiffTeacherMode(true);
        if (!alive) return;
        setLiff(sdk);
        setGroupRef(ref);
        if (isView(startView)) setView(startView);
        if (!ref) {
          setBlocked({ message: "เปิดหน้านี้จากการ์ดเมนูครูในกลุ่ม LINE ของห้องเรียน", code: "no-group" });
          return;
        }
        const kind = dataKindFor(isView(startView) ? startView : "home");
        const res = await authFetch(`/api/line/liff-teacher?g=${encodeURIComponent(ref)}${kind ? `&view=${kind}` : ""}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) {
          setBlocked({ message: json.error || "โหลดข้อมูลไม่สำเร็จ", code: json.code, connectUrl: json.connectUrl });
          return;
        }
        if (kind && json.data) setInitialData({ kind, data: json.data });
        setContext(json as TeacherContext);
      } catch (err) {
        if (alive) setBlocked({ message: err instanceof Error ? err.message : "เกิดข้อผิดพลาด" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Each page is a history entry, so LINE's back gesture returns to the menu.
  useEffect(() => {
    const onPop = () => {
      const next = new URLSearchParams(window.location.search).get("view");
      setView(isView(next) ? next : "home");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((next: TeacherView) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.pushState(null, "", url);
    setView(next);
    window.scrollTo(0, 0);
  }, []);

  if (blocked) {
    return (
      <div className="p-6 pt-16 text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-violet-100 dark:bg-violet-950 text-violet-700 flex items-center justify-center">
          {blocked.code === "not-linked" ? <Link2 className="w-6 h-6" /> : <Lock className="w-6 h-6" />}
        </div>
        <p className="font-black text-violet-950 dark:text-white">{blocked.code === "not-teacher" ? "สำหรับคุณครูเท่านั้น" : "ยังใช้งานเมนูนี้ไม่ได้"}</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">{blocked.message}</p>
        {blocked.connectUrl && (
          <a href={blocked.connectUrl} className="inline-flex h-11 px-5 rounded-xl bg-emerald-500 text-white font-bold text-sm items-center gap-1.5">
            ⚙️ เชื่อมห้องเรียนกับกลุ่มนี้
          </a>
        )}
        {liff?.isInClient() && (
          <button type="button" onClick={() => liff.closeWindow()} className="block mx-auto text-xs text-slate-500 underline cursor-pointer">
            ปิดหน้านี้
          </button>
        )}
      </div>
    );
  }
  if (!liff || !context) return <Loading text="กำลังเปิดเมนูครู..." />;

  const View = VIEWS[view];
  return (
    <KitProvider value={{ ...context, liff, groupRef, go }} initialData={initialData}>
      <View />
    </KitProvider>
  );
}
