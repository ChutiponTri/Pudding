"use client";

import { useState } from "react";
import { authFetch } from "@/lib/auth/lineSession";
import { dataService } from "@/lib/supabase/dataService";
import { getAssignmentWindow } from "@/lib/utils/assignmentWindow";
import { formatDateTime } from "@/lib/utils/datetime";
import { isGraded, isHandedIn } from "@/lib/utils/gradingStatus";
import type { Assignment, Submission } from "@/types/database";
import { Button, Card, Empty, ErrorBox, Loading, Page, Pill, errorText, useKit, useLoad } from "./kit";

type WorkRow = {
  work: Assignment;
  win: ReturnType<typeof getAssignmentWindow>;
  handed: number;
  graded: number;
};

/** The classroom's work with hand-in and grading counts (newest first). */
export function useWork() {
  const { classroom } = useKit();
  return useLoad(async () => {
    const [works, roster] = await Promise.all([dataService.getAssignmentsByClassroomId(classroom.id), dataService.getClassroomRoster(classroom.id)]);
    const published = works.filter((work) => {
      const win = getAssignmentWindow(work);
      return !win.isDraft && !win.isScheduled;
    });
    const submissions: Submission[] = await dataService.getSubmissionsByAssignmentIds(published.map((w) => w.id), { includeStudents: false });
    const rows: WorkRow[] = works
      .map((work) => {
        const mine = submissions.filter((sub) => sub.assignment_id === work.id);
        return { work, win: getAssignmentWindow(work), handed: mine.filter(isHandedIn).length, graded: mine.filter(isGraded).length };
      })
      .sort((a, b) => (b.work.created_at || "").localeCompare(a.work.created_at || ""));
    return { rows, students: roster.students.length };
  }, [classroom.id]);
}

/** POST /api/assignments/override from LIFF: nothing is pushed, the reply carries the card trigger. */
async function override(assignmentId: string, action: "publish_now" | "announce_results") {
  const res = await authFetch("/api/assignments/override", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assignmentId, action, line: "card" }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "ทำรายการไม่สำเร็จ");
  return json as { line?: string; share?: { text: string } };
}

const kindIcon = (work: Assignment) => (work.is_exam ? "📝" : "📋");
const due = (row: WorkRow) => (row.win.deadline != null ? formatDateTime(new Date(row.win.deadline).toISOString(), "th") : "ไม่มีกำหนด");

function WorkLine({ row, children, right }: { row: WorkRow; children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="space-y-2 pb-3 border-b last:border-0 last:pb-0 border-violet-100 dark:border-slate-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold truncate">{kindIcon(row.work)} {row.work.title}</p>
          <p className="text-[11px] text-slate-500">{row.work.is_exam ? "ปิดรับคำตอบ" : "กำหนดส่ง"}: {due(row)}</p>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function useBusy() {
  const { toast } = useKit();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, task: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await task();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** "เผยแพร่": release drafts / scheduled work now, or post an open work's card again. */
export function PublishView() {
  const { postCard, postKind, go } = useKit();
  const data = useWork();
  const { busy, run } = useBusy();
  if (data.error) return <Page title="📢 เผยแพร่"><ErrorBox text={data.error} /></Page>;
  if (!data.data) return <Page title="📢 เผยแพร่"><Loading /></Page>;
  const waiting = data.data.rows.filter((row) => row.win.isDraft || row.win.isScheduled);
  const open = data.data.rows.filter((row) => row.win.acceptsSubmissions);
  const publish = (row: WorkRow) =>
    run(row.work.id, async () => {
      const result = await override(row.work.id, "publish_now");
      if (result.share?.text) await postCard(result.share.text);
      data.reload();
    });
  return (
    <Page title="📢 เผยแพร่">
      <Card className="space-y-3">
        <p className="text-sm font-black">ฉบับร่าง / ตั้งเวลาไว้ ({waiting.length})</p>
        {waiting.length === 0 && <p className="text-xs text-slate-400">ไม่มีงานที่รอเผยแพร่</p>}
        {waiting.map((row) => (
          <WorkLine key={row.work.id} row={row} right={<Pill tone="slate">{row.win.isDraft ? "ฉบับร่าง" : "ตั้งเวลา"}</Pill>}>
            <Button small busy={busy === row.work.id} onClick={() => publish(row)}>เผยแพร่ตอนนี้ + ส่งการ์ด</Button>
          </WorkLine>
        ))}
      </Card>
      <Card className="space-y-3">
        <p className="text-sm font-black">เปิดรับอยู่ ({open.length})</p>
        {open.length === 0 && <p className="text-xs text-slate-400">ไม่มีงานที่เปิดรับอยู่</p>}
        {open.map((row) => (
          <WorkLine key={row.work.id} row={row} right={<Pill tone="green">ส่ง {row.handed}/{data.data!.students}</Pill>}>
            <Button small tone="soft" busy={busy === row.work.id} onClick={() => run(row.work.id, () => postKind("work", { assignmentId: row.work.id }))}>
              ส่งการ์ดงานอีกครั้ง
            </Button>
          </WorkLine>
        ))}
      </Card>
      <Button tone="ghost" className="w-full" onClick={() => go("create")}>✏️ สร้างงานใหม่</Button>
    </Page>
  );
}

/** "ประกาศผล": close the work (if still open) and post the results card. */
export function ResultsView() {
  const { postCard, go } = useKit();
  const data = useWork();
  const { busy, run } = useBusy();
  if (data.error) return <Page title="📈 ประกาศผล"><ErrorBox text={data.error} /></Page>;
  if (!data.data) return <Page title="📈 ประกาศผล"><Loading /></Page>;
  const rows = data.data.rows.filter((row) => !row.win.isDraft && !row.win.isScheduled && row.handed > 0);
  const announce = (row: WorkRow) => {
    if (!row.graded) return;
    if (row.win.acceptsSubmissions && !confirm(`ประกาศคะแนน “${row.work.title}”?\nงานนี้จะถูกปิดรับก่อนประกาศ`)) return;
    void run(row.work.id, async () => {
      const result = await override(row.work.id, "announce_results");
      if (result.share?.text) await postCard(result.share.text);
      data.reload();
    });
  };
  return (
    <Page title="📈 ประกาศผล">
      {rows.length === 0 && <Empty text="ยังไม่มีงานที่นักเรียนส่ง" />}
      {rows.length > 0 && (
        <Card className="space-y-3">
          {rows.map((row) => (
            <WorkLine key={row.work.id} row={row} right={<Pill tone={row.graded >= row.handed ? "green" : "amber"}>ตรวจ {row.graded}/{row.handed}</Pill>}>
              <div className="flex gap-2">
                <Button small tone="green" disabled={!row.graded} busy={busy === row.work.id} onClick={() => announce(row)}>📣 ประกาศคะแนน</Button>
                {row.graded < row.handed && <Button small tone="ghost" onClick={() => go("grade")}>ไปตรวจงาน</Button>}
              </div>
            </WorkLine>
          ))}
        </Card>
      )}
      <p className="text-[11px] text-slate-400">ประกาศได้เมื่อตรวจเสร็จอย่างน้อย 1 คน • นักเรียนเห็นคะแนนเมื่องานปิดรับแล้ว</p>
    </Page>
  );
}

/** "ทวงงาน": the bot posts who has not handed in (names worked out when the card is made). */
export function RemindView() {
  const { postKind } = useKit();
  const data = useWork();
  const { busy, run } = useBusy();
  if (data.error) return <Page title="🔔 ทวงงาน"><ErrorBox text={data.error} /></Page>;
  if (!data.data) return <Page title="🔔 ทวงงาน"><Loading /></Page>;
  const { students } = data.data;
  const rows = data.data.rows.filter((row) => row.win.acceptsSubmissions);
  return (
    <Page title="🔔 ทวงงาน">
      {rows.length === 0 && <Empty text="ไม่มีงานที่เปิดรับอยู่" />}
      {rows.length > 0 && (
        <Card className="space-y-3">
          {rows.map((row) => {
            const missing = Math.max(0, students - row.handed);
            return (
              <WorkLine key={row.work.id} row={row} right={<Pill tone={missing ? "red" : "green"}>{missing ? `ยังไม่ส่ง ${missing}` : "ส่งครบ"}</Pill>}>
                <Button small disabled={!missing} busy={busy === row.work.id} onClick={() => run(row.work.id, () => postKind("remind", { assignmentId: row.work.id }))}>
                  🔔 ทวงในกลุ่ม
                </Button>
              </WorkLine>
            );
          })}
        </Card>
      )}
      <p className="text-[11px] text-slate-400">บอทจะโพสต์การ์ดรายชื่อคนที่ยังไม่ส่งในกลุ่ม (ไม่ใช้โควตาข้อความ)</p>
    </Page>
  );
}
