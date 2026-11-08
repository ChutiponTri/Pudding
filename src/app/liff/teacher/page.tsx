"use client";

import { useCallback, useEffect, useState } from "react";
import type { Liff } from "@line/liff";
import { Link2, Lock } from "lucide-react";
import { authFetch, setLineAccessToken, setLiffTeacherMode } from "@/lib/auth/lineSession";
import { KitProvider, Loading, type TeacherContext, type TeacherView } from "@/components/liff-teacher/kit";
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
        const res = await authFetch(`/api/line/liff-teacher?g=${encodeURIComponent(ref)}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) setBlocked({ message: json.error || "โหลดข้อมูลไม่สำเร็จ", code: json.code, connectUrl: json.connectUrl });
        else setContext(json as TeacherContext);
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
    <KitProvider value={{ ...context, liff, groupRef, go }}>
      <View />
    </KitProvider>
  );
}
