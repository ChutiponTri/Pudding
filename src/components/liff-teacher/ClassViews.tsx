"use client";

import { useState } from "react";
import { Check, ExternalLink, UserCheck, Users, X } from "lucide-react";
import { dataService } from "@/lib/supabase/dataService";
import { Button, Card, Empty, ErrorBox, Page, Pill, Skeleton, errorText, useKit, useViewData, type RosterData, type RosterStudent, type TeacherView } from "./kit";
import { StatePill, useWork } from "./WorkViews";

const studentName = (s: Partial<RosterStudent>) => `${s.first_name || ""} ${s.last_name || ""}`.trim() || "ไม่ระบุชื่อ";

/** The same buttons as the group menu card. */
const MENU: Array<{ section?: string; items: Array<{ view: TeacherView; label: string; primary?: boolean; wide?: boolean }> }> = [
  {
    items: [
      { view: "attendance", label: "📋 เช็กชื่อ", primary: true },
      { view: "invite", label: "👥 เชิญนักเรียน", primary: true },
      { view: "classroom", label: "🏫 จัดการห้องเรียน", primary: true, wide: true },
      { view: "status", label: "📊 เช็กสถานะ", primary: true, wide: true },
    ],
  },
  {
    section: "⭐ งาน",
    items: [
      { view: "create", label: "✏️ สร้าง" },
      { view: "publish", label: "📢 เผยแพร่" },
      { view: "grade", label: "✅ ตรวจงาน" },
      { view: "results", label: "📈 ประกาศผล" },
      { view: "remind", label: "🔔 ทวงงาน", wide: true },
    ],
  },
  {
    section: "⭐ อื่น ๆ",
    items: [
      { view: "help", label: "📖 คำสั่งพิเศษ", wide: true },
      { view: "guide", label: "📣 แนะนำนักเรียน / วิธีส่งงาน", wide: true },
    ],
  },
];

/**
 * One-tap sends for the work still taking hand-ins: its card again, or the
 * reminder picture (the bot answers with who has not handed in). Straight
 * into the group when the menu was opened from it.
 */
function QuickSend() {
  const { postKind, toast } = useKit();
  const work = useWork();
  const [busy, setBusy] = useState<string | null>(null);
  const open = work.rows.filter((row) => row.win.acceptsSubmissions).slice(0, 5);
  if (!work.data || !open.length) return null;
  const send = async (key: string, task: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await task();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="space-y-2.5">
      <p className="text-sm font-black">⚡ ส่งเข้ากลุ่มด่วน</p>
      {open.map((row) => (
        <div key={row.work.id} className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold truncate">{row.work.is_exam ? "📝" : "📋"} {row.work.title}</p>
            <p className="text-[11px] text-slate-500">ส่ง {row.handed}/{row.total}{row.missing ? ` · ยังไม่ส่ง ${row.missing}` : " · ครบแล้ว"}</p>
          </div>
          <Button small tone="soft" busy={busy === `card-${row.work.id}`} onClick={() => send(`card-${row.work.id}`, () => postKind("work", { assignmentId: row.work.id }))}>
            การ์ดงาน
          </Button>
          {row.missing > 0 && (
            <Button small busy={busy === `remind-${row.work.id}`} onClick={() => send(`remind-${row.work.id}`, () => postKind("remind", { assignmentId: row.work.id }))}>
              🔔 ทวง
            </Button>
          )}
        </div>
      ))}
    </Card>
  );
}

export function HomeView() {
  const { go, teacher, classroom, fromGroup, permission, askPermission, liff } = useKit();
  /** Where LINE says this page was opened (group/room = the class chat); shown to tell why sending asks for a group. */
  const openedIn = (() => {
    try {
      return liff.getContext()?.type || "none";
    } catch {
      return "none";
    }
  })();
  return (
    <Page title={`สวัสดีค่ะ คุณครู${teacher.firstName}`} back={false}>
      <Card className="bg-amber-50! dark:bg-amber-950/40! space-y-0.5">
        <p className="text-[11px] font-bold text-amber-500">ห้องเรียนของกลุ่มนี้</p>
        <p className="font-black text-slate-900 dark:text-white">{classroom.title}</p>
        {classroom.groupName && <p className="text-[11px] text-slate-500">กลุ่ม LINE: {classroom.groupName}</p>}
        {!fromGroup ? (
          <p className="text-[11px] font-bold pt-1 text-slate-500">ℹ️ เปิดจากนอกกลุ่ม: เมื่อส่ง จะให้เลือกกลุ่มเอง (เปิดจากการ์ดเมนูในกลุ่มเพื่อส่งเข้ากลุ่มทันที) <span className="font-normal text-slate-400">[{openedIn}]</span></p>
        ) : permission === "unavailable" ? (
          <p className="text-[11px] font-bold pt-1 text-amber-700">⚠️ LINE ยังไม่เปิดสิทธิ์ส่งข้อความให้แอปนี้ (chat_message.write) ตอนนี้ต้องเลือกกลุ่มเอง</p>
        ) : permission === "prompt" ? (
          <div className="pt-1 flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold text-amber-700">ขออนุญาตครั้งเดียว เพื่อส่งการ์ดเข้ากลุ่มนี้ทันที</p>
            <Button small onClick={askPermission}>อนุญาต</Button>
          </div>
        ) : (
          <p className="text-[11px] font-bold pt-1 text-emerald-600">✅ การ์ดส่งเข้ากลุ่มนี้ทันที ไม่ต้องเลือกกลุ่ม</p>
        )}
      </Card>
      <QuickSend />
      {MENU.map((block, index) => (
        <div key={index} className="space-y-2">
          {block.section && <p className="inline-block px-3 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold">{block.section}</p>}
          <div className="grid grid-cols-2 gap-2">
            {block.items.map((item) => (
              <button
                key={item.view}
                type="button"
                onClick={() => go(item.view)}
                className={`${item.wide ? "col-span-2" : ""} h-12 rounded-xl text-sm font-bold cursor-pointer active:scale-[0.98] transition-transform ${
                  item.primary ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Page>
  );
}

export function InviteView() {
  const { classroom, postKind, go, toast } = useKit();
  const [busy, setBusy] = useState(false);
  const roster = useViewData<RosterData>("roster");
  const send = async () => {
    setBusy(true);
    try {
      await postKind("invite");
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page title="👥 เชิญนักเรียน">
      <Card className="text-center space-y-2">
        <p className="text-xs text-slate-500">รหัสเข้าห้อง</p>
        <p className="text-4xl font-black tracking-widest text-amber-700 dark:text-amber-300">{classroom.inviteCode || "-"}</p>
        <p className="text-xs text-slate-500">นักเรียนกดปุ่มในการ์ด กรอกชื่อ แล้วรอคุณครูอนุมัติ</p>
      </Card>
      <Button onClick={send} busy={busy} className="w-full">📨 ส่งการ์ดเชิญเข้ากลุ่ม</Button>
      {(roster.data?.pending.length || 0) > 0 && (
        <Card className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-amber-700">รออนุมัติ {roster.data!.pending.length} คน</span>
          <Button small tone="soft" onClick={() => go("classroom")}>ไปอนุมัติ</Button>
        </Card>
      )}
    </Page>
  );
}

export function GuideView() {
  const { postKind, toast } = useKit();
  const [busy, setBusy] = useState(false);
  return (
    <Page title="📣 แนะนำนักเรียน">
      <Card className="space-y-2 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
        <p className="font-bold text-amber-900 dark:text-amber-200">ส่งการ์ดต้อนรับเข้ากลุ่ม พร้อมวิธีใช้:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>กดปุ่มในการ์ด กรอกชื่อเพื่อขอเข้าห้องเรียน แล้วรอคุณครูอนุมัติ</li>
          <li>เมื่อมีงาน คุณครูจะส่งการ์ดงานในกลุ่ม กด “ส่งงาน” หรือ “ทำแบบทดสอบ”</li>
          <li>ดูงานที่ค้างและคะแนนได้จากปุ่ม “ดูงานของคุณ”</li>
        </ol>
      </Card>
      <Button
        busy={busy}
        className="w-full"
        onClick={async () => {
          setBusy(true);
          try {
            await postKind("guide");
          } catch (err) {
            toast(errorText(err), "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        📣 ส่งการ์ดแนะนำเข้ากลุ่ม
      </Button>
    </Page>
  );
}

const COMMANDS: Array<[string, string]> = [
  ["พุดดิ้ง เช็กชื่อ", "ลิงก์เช็กชื่อคาบที่เปิดอยู่"],
  ["พุดดิ้ง งาน", "สรุปงาน/ข้อสอบที่ยังเปิดรับ และเวลาที่เหลือ"],
  ["พุดดิ้ง ส่งงาน", "ลิงก์ส่งของแต่ละงาน"],
  ["พุดดิ้ง เข้าห้อง", "รหัสและลิงก์เข้าห้องเรียน"],
  ["พุดดิ้ง หน้าหลัก", "เปิดห้องเรียนใน Pudding"],
  ["พุดดิ้ง สถานะ", "สถานะการเชื่อมต่อของกลุ่ม"],
  ["พุดดิ้ง เชื่อม", "เชื่อม/ย้าย/ยกเลิกการเชื่อมกลุ่มนี้"],
];

export function HelpView() {
  return (
    <Page title="📖 คำสั่งพิเศษ">
      <p className="text-xs text-slate-500">พิมพ์ในกลุ่ม LINE (เฉพาะคุณครูและ TA บอทจะตอบ ข้อความจากนักเรียนบอทไม่ตอบ) พิมพ์ “pudding” แทน “พุดดิ้ง” ก็ได้</p>
      <Card className="divide-y divide-amber-100 dark:divide-slate-800 p-0!">
        {COMMANDS.map(([command, what]) => (
          <div key={command} className="px-4 py-3">
            <p className="text-sm font-black text-amber-800 dark:text-amber-200">{command}</p>
            <p className="text-xs text-slate-500">{what}</p>
          </div>
        ))}
      </Card>
      <p className="text-[11px] text-slate-400">💡 กดค้างที่การ์ดเมนูในกลุ่ม แล้วเลือก “ประกาศ” เพื่อปักหมุดเมนูไว้บนสุด</p>
    </Page>
  );
}

/** "จัดการห้องเรียน": approve join requests and see the roster. */
export function ClassroomView() {
  const { classroom, liff, toast, invalidate } = useKit();
  const roster = useViewData<RosterData>("roster");
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (student: RosterStudent, admit: boolean) => {
    setBusy(student.id);
    try {
      if (admit) await dataService.admitStudentToClassroom(classroom.id, student.id);
      else await dataService.rejectStudentFromClassroom(classroom.id, student.id);
      // Moved on screen right away; the server's list follows.
      roster.mutate((current) => ({
        pending: current.pending.filter((item) => item.id !== student.id),
        students: admit ? [...current.students, student] : current.students,
      }));
      toast(admit ? `อนุมัติ ${studentName(student)} แล้ว` : `ปฏิเสธ ${studentName(student)} แล้ว`);
      invalidate("roster", "work", "attendance");
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };
  const openWeb = () => liff.openWindow({ url: `${window.location.origin}/classrooms/${classroom.id}`, external: true });
  return (
    <Page title="🏫 จัดการห้องเรียน" refreshing={roster.refreshing}>
      {roster.error && <ErrorBox text={roster.error} />}
      {!roster.data && !roster.error && <Skeleton rows={4} />}
      {roster.data && (
        <>
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-amber-600" />
              <p className="text-sm font-black text-slate-800 dark:text-white">รออนุมัติ ({roster.data.pending.length})</p>
            </div>
            {roster.data.pending.length === 0 && <p className="text-xs text-slate-400">ไม่มีคำขอเข้าห้อง</p>}
            {roster.data.pending.map((student) => (
              <div key={student.id} className="liff-rise flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{studentName(student)}</p>
                  {student.student_id && <p className="text-[11px] text-slate-400">รหัส {student.student_id}</p>}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button small tone="green" busy={busy === student.id} onClick={() => act(student, true)}>
                    <Check className="w-3.5 h-3.5" /> อนุมัติ
                  </Button>
                  <Button small tone="ghost" disabled={busy === student.id} onClick={() => act(student, false)}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </Card>
          <Card className="space-y-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-600" />
              <p className="text-sm font-black text-slate-800 dark:text-white">นักเรียนในห้อง ({roster.data.students.length})</p>
            </div>
            {roster.data.students.length === 0 && <Empty text="ยังไม่มีนักเรียน" />}
            <ul className="text-sm divide-y divide-slate-100 dark:divide-slate-800">
              {roster.data.students.map((student, index) => (
                <li key={student.id} className="py-1.5 flex gap-2">
                  <span className="w-6 text-right text-slate-400 text-xs pt-0.5">{index + 1}.</span>
                  <span className="truncate">
                    {student.student_id ? <span className="text-slate-400">[{student.student_id.slice(-3)}] </span> : null}
                    {studentName(student)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Button tone="ghost" className="w-full" onClick={openWeb}>
            <ExternalLink className="w-4 h-4" /> เปิดหน้าเต็มบนเว็บ
          </Button>
        </>
      )}
    </Page>
  );
}

/** "เช็กสถานะ": the class at a glance (one request; numbers from the server against the real roster). */
export function StatusView() {
  const work = useWork();
  if (work.error) return <Page title="📊 เช็กสถานะ"><ErrorBox text={work.error} /></Page>;
  if (!work.data) return <Page title="📊 เช็กสถานะ"><Skeleton rows={4} /></Page>;
  const open = work.rows.filter((row) => row.win.acceptsSubmissions);
  const waiting = work.rows.filter((row) => row.win.isDraft || row.win.isScheduled).length;
  const toGrade = work.rows.reduce((sum, row) => sum + row.toGrade, 0);
  return (
    <Page title="📊 เช็กสถานะ" refreshing={work.refreshing}>
      <div className="grid grid-cols-2 gap-2 liff-stagger">
        {[
          ["นักเรียน", work.data.students],
          ["รออนุมัติ", work.data.pending],
          ["งานที่เปิดรับ", open.length],
          ["รอตรวจ", toGrade],
        ].map(([label, value]) => (
          <Card key={label as string} className="text-center py-3!">
            <p className="text-2xl font-black text-amber-700 dark:text-amber-300">{value}</p>
            <p className="text-[11px] text-slate-500">{label}</p>
          </Card>
        ))}
      </div>
      {waiting > 0 && <p className="text-xs text-slate-500">ฉบับร่าง / ตั้งเวลาไว้ {waiting} งาน</p>}
      <Card className="space-y-3">
        <p className="text-sm font-black">งานทั้งหมด ({work.rows.length})</p>
        {work.rows.length === 0 && <p className="text-xs text-slate-400">ยังไม่มีงานในห้องนี้ • สร้างได้จากเมนู “สร้าง”</p>}
        {work.rows.map((row) => {
          const percent = row.total ? Math.round((row.handed / row.total) * 100) : 0;
          return (
            <div key={row.work.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold truncate">{row.work.is_exam ? "📝" : "📋"} {row.work.title}</p>
                <span className="flex gap-1 shrink-0">
                  <StatePill row={row} />
                  <Pill tone={row.missing ? "amber" : "green"}>ส่ง {row.handed}/{row.total}</Pill>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-amber-100 dark:bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-amber-500 transition-[width] duration-700 ease-out" style={{ width: `${Math.min(100, percent)}%` }} />
              </div>
            </div>
          );
        })}
      </Card>
    </Page>
  );
}
