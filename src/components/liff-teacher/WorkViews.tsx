"use client";

import { announceNote } from '@/lib/utils/announceNote';
import { useMemo, useState } from "react";
import { authFetch } from "@/lib/auth/lineSession";
import { getAssignmentWindow } from "@/lib/utils/assignmentWindow";
import { lineDate } from "@/lib/utils/datetime";
import type { Assignment } from "@/types/database";
import { Button, Card, Empty, ErrorBox, Page, Pill, Skeleton, errorText, useKit, useViewData, type Share, type WorkData } from "./kit";
import { WorkStatus, workState } from "./StatusSheet";

export { workState };

export type WorkRow = WorkData["works"][number] & { win: ReturnType<typeof getAssignmentWindow> };

/**
 * The classroom's work, newest first, with its numbers worked out by the
 * server against the real roster (a retake counts only its students): handed
 * in, graded, waiting to be graded, not handed in. One request.
 */
export function useWork() {
  const data = useViewData<WorkData>("work");
  const rows = useMemo(() => (data.data?.works || []).map((row) => ({ ...row, win: getAssignmentWindow(row.work) })), [data.data]);
  return { ...data, rows, students: data.data?.students ?? 0 };
}

/** POST /api/assignments/override: nothing is pushed; the answer's share is the card the page sends into the group. */
async function override(assignmentId: string, action: "publish_now" | "announce_results") {
  const res = await authFetch("/api/assignments/override", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assignmentId, action }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "ทำรายการไม่สำเร็จ");
  return json as { line?: string; share?: Share; zeroed?: number; ungraded?: number };
}

const kindIcon = (work: Assignment) => (work.is_exam ? "📝" : "📋");

/** The work's acceptance status: a pill that opens the status sheet (published work). */
export function StatePill({ row }: { row: WorkRow }) {
  return <WorkStatus work={row.work} />;
}
const due = (row: WorkRow) => (row.win.deadline != null ? lineDate(row.win.deadline) : "ไม่มีกำหนด");

function WorkLine({ row, children, right }: { row: WorkRow; children?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="space-y-2 pb-3 border-b last:border-0 last:pb-0 border-amber-100 dark:border-slate-800">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-bold truncate">{kindIcon(row.work)} {row.work.title}</p>
          <WorkStatus work={row.work} />
          <p className="text-[11px] text-slate-500">
            {row.work.is_exam ? "ปิดรับคำตอบ" : "กำหนดส่ง"} {due(row)}
            {!row.work.is_exam && row.win.lateUntil != null && row.win.lateUntil !== row.win.deadline ? ` · ปิดรับส่งงาน ${lineDate(row.win.lateUntil)}` : ""}
          </p>
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
  const { postShare, postKind, go, invalidate } = useKit();
  const data = useWork();
  const { busy, run } = useBusy();
  if (data.error) return <Page title="📢 เผยแพร่"><ErrorBox text={data.error} /></Page>;
  if (!data.data) return <Page title="📢 เผยแพร่"><Skeleton /></Page>;
  // Straight into the group when opened from it (no group to pick).
  const waiting = data.rows.filter((row) => row.win.isDraft || row.win.isScheduled);
  const open = data.rows.filter((row) => row.win.acceptsSubmissions);
  const closed = data.rows.filter((row) => !row.win.isDraft && !row.win.isScheduled && !row.win.acceptsSubmissions);
  const publish = (row: WorkRow) =>
    run(row.work.id, async () => {
      const result = await override(row.work.id, "publish_now");
      // Published now, whether or not the card goes out: every page shows it.
      invalidate("work");
      if (result.share?.url) await postShare(result.share);
    });
  return (
    <Page title="📢 เผยแพร่" refreshing={data.refreshing}>
      <Card className="space-y-3">
        <p className="text-sm font-black">ฉบับร่าง / ตั้งเวลาไว้ ({waiting.length})</p>
        {waiting.length === 0 && <p className="text-xs text-slate-400">ไม่มีงานที่รอเผยแพร่</p>}
        {waiting.map((row) => (
          <WorkLine key={row.work.id} row={row}>
            <Button small busy={busy === row.work.id} onClick={() => publish(row)}>เผยแพร่ตอนนี้ + ส่งการ์ด</Button>
          </WorkLine>
        ))}
      </Card>
      <Card className="space-y-3">
        <p className="text-sm font-black">เปิดรับอยู่ ({open.length})</p>
        {open.length === 0 && <p className="text-xs text-slate-400">ไม่มีงานที่เปิดรับอยู่</p>}
        {open.map((row) => (
          <WorkLine key={row.work.id} row={row} right={<Pill tone="green">ส่ง {row.handed}/{row.total}</Pill>}>
            <Button small tone="soft" busy={busy === row.work.id} onClick={() => run(row.work.id, () => postKind("work", { assignmentId: row.work.id }))}>
              ส่งการ์ดงานอีกครั้ง
            </Button>
          </WorkLine>
        ))}
      </Card>
      {closed.length > 0 && (
        <Card className="space-y-3">
          <p className="text-sm font-black">ปิดรับแล้ว ({closed.length})</p>
          {closed.map((row) => (
            <WorkLine key={row.work.id} row={row} right={<Pill tone="red">ส่ง {row.handed}/{row.total}</Pill>} />
          ))}
          <p className="text-[11px] text-slate-400">แตะ “ปิดรับแล้ว” เพื่อเปิดรับอีกครั้งหรือขยายเวลา • ตรวจและประกาศผลได้จากเมนู</p>
        </Card>
      )}
      <Button tone="ghost" className="w-full" onClick={() => go("create")}>✏️ สร้างงานใหม่</Button>
    </Page>
  );
}

/** "ประกาศผล": close the work (if still open) and post the results card. */
export function ResultsView() {
  const { postShare, go, invalidate, toast } = useKit();
  const data = useWork();
  const { busy, run } = useBusy();
  if (data.error) return <Page title="📈 ประกาศผล"><ErrorBox text={data.error} /></Page>;
  if (!data.data) return <Page title="📈 ประกาศผล"><Skeleton /></Page>;
  // Every published work: announcing needs at least one graded hand-in.
  const rows = data.rows.filter((row) => !row.win.isDraft && !row.win.isScheduled);
  const announce = (row: WorkRow) => {
    if (!row.graded) return;
    void run(row.work.id, async () => {
      const result = await override(row.work.id, "announce_results");
      // Closed (if it was open) whether or not the card goes out.
      invalidate("work");
      const note = announceNote(result);
      if (note) toast(note);
      if (result.share?.url) await postShare(result.share);
    });
  };
  return (
    <Page title="📈 ประกาศผล" refreshing={data.refreshing}>
      {rows.length === 0 && <Empty text="ยังไม่มีงานที่เผยแพร่" />}
      {rows.length > 0 && (
        <Card className="space-y-3">
          {rows.map((row) => (
            <WorkLine
              key={row.work.id}
              row={row}
              right={<Pill tone={!row.handed ? "slate" : row.graded >= row.handed ? "green" : "amber"}>{row.handed ? `ตรวจ ${row.graded}/${row.handed}` : "ยังไม่มีคนส่ง"}</Pill>}
            >
              <div className="flex gap-2">
                <Button small tone="green" disabled={!row.graded} busy={busy === row.work.id} onClick={() => announce(row)}>📣 ประกาศคะแนน</Button>
                {row.graded < row.handed && <Button small tone="ghost" onClick={() => go("grade")}>ไปตรวจงาน</Button>}
              </div>
            </WorkLine>
          ))}
        </Card>
      )}
      <p className="text-[11px] text-slate-400">ประกาศได้เมื่อตรวจเสร็จอย่างน้อย 1 คน • งานที่ยังเปิดรับจะถูกปิดรับก่อนประกาศ • นักเรียนที่ไม่ส่งจะได้ 0 คะแนนอัตโนมัติ เพื่อให้ทุกคนเห็นคะแนน</p>
    </Page>
  );
}

/** "ทวงงาน": the bot posts who has not handed in (names worked out when the card is made). */
export function RemindView() {
  const { postKind } = useKit();
  const data = useWork();
  const { busy, run } = useBusy();
  if (data.error) return <Page title="🔔 ทวงงาน"><ErrorBox text={data.error} /></Page>;
  if (!data.data) return <Page title="🔔 ทวงงาน"><Skeleton /></Page>;
  const rows = data.rows.filter((row) => row.win.acceptsSubmissions);
  // Closed work can be reopened (or extended) here before reminding.
  const closed = data.rows.filter((row) => !row.win.isDraft && !row.win.isScheduled && !row.win.acceptsSubmissions && row.missing > 0);
  return (
    <Page title="🔔 ทวงงาน" refreshing={data.refreshing}>
      {rows.length === 0 && (
        <Empty text={data.rows.length ? `ไม่มีงานที่เปิดรับอยู่ (งานทั้งหมด ${data.rows.length} งานปิดรับแล้วหรือยังไม่เผยแพร่)` : "ยังไม่มีงานในห้องนี้"} />
      )}
      {rows.length > 0 && (
        <Card className="space-y-3">
          {rows.map((row) => {
            const { missing } = row;
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
      {closed.length > 0 && (
        <Card className="space-y-3">
          <p className="text-sm font-black">ปิดรับแล้ว แต่ยังมีคนไม่ส่ง ({closed.length})</p>
          {closed.map((row) => (
            <WorkLine key={row.work.id} row={row} right={<Pill tone="red">ยังไม่ส่ง {row.missing}</Pill>} />
          ))}
          <p className="text-[11px] text-slate-400">แตะ “ปิดรับแล้ว” เพื่อเปิดรับหรือขยายเวลา แล้วจึงทวงได้</p>
        </Card>
      )}
      <p className="text-[11px] text-slate-400">ส่งภาพ “พุดดิ้งมาทวงแล้ว!” เข้ากลุ่ม แล้วบอทจะตอบด้วยการ์ดรายชื่อและแท็กคนที่ยังไม่ส่ง (ไม่ใช้โควตาข้อความ)</p>
    </Page>
  );
}
