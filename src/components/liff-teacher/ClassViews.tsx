"use client";

import { useState } from "react";
import { Check, ExternalLink, UserCheck, Users, X } from "lucide-react";
import { dataService } from "@/lib/supabase/dataService";
import { getAssignmentWindow } from "@/lib/utils/assignmentWindow";
import { isHandedIn, needsGrading } from "@/lib/utils/gradingStatus";
import type { User } from "@/types/database";
import { Button, Card, Empty, ErrorBox, Loading, Page, Pill, errorText, useKit, useLoad, type TeacherView } from "./kit";

const studentName = (s: Partial<User> & { name?: string }) => `${s.first_name || ""} ${s.last_name || ""}`.trim() || s.name || "ไม่ระบุชื่อ";

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

export function HomeView() {
  const { go, teacher, classroom } = useKit();
  return (
    <Page title={`สวัสดีค่ะ คุณครู${teacher.firstName}`} back={false}>
      <Card className="bg-violet-50! dark:bg-violet-950/40! space-y-0.5">
        <p className="text-[11px] font-bold text-violet-500">ห้องเรียนของกลุ่มนี้</p>
        <p className="font-black text-violet-950 dark:text-white">{classroom.title}</p>
        {classroom.groupName && <p className="text-[11px] text-slate-500">กลุ่ม LINE: {classroom.groupName}</p>}
      </Card>
      {MENU.map((block, index) => (
        <div key={index} className="space-y-2">
          {block.section && <p className="inline-block px-3 py-0.5 rounded-full bg-violet-600 text-white text-xs font-bold">{block.section}</p>}
          <div className="grid grid-cols-2 gap-2">
            {block.items.map((item) => (
              <button
                key={item.view}
                type="button"
                onClick={() => go(item.view)}
                className={`${item.wide ? "col-span-2" : ""} h-12 rounded-xl text-sm font-bold cursor-pointer active:scale-[0.98] transition-transform ${
                  item.primary ? "bg-violet-600 text-white" : "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
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
  const roster = useLoad(() => dataService.getClassroomRoster(classroom.id), [classroom.id]);
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
        <p className="text-4xl font-black tracking-widest text-violet-700 dark:text-violet-300">{classroom.inviteCode || "-"}</p>
        <p className="text-xs text-slate-500">นักเรียนกดปุ่มในการ์ด กรอกชื่อ แล้วรอคุณครูอนุมัติ</p>
      </Card>
      <Button onClick={send} busy={busy} className="w-full">📨 ส่งการ์ดเชิญเข้ากลุ่ม</Button>
      {(roster.data?.pending_students.length || 0) > 0 && (
        <Card className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-amber-700">รออนุมัติ {roster.data!.pending_students.length} คน</span>
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
        <p className="font-bold text-violet-900 dark:text-violet-200">บอทจะโพสต์การ์ดต้อนรับในกลุ่ม พร้อมวิธีใช้:</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>กดปุ่มในการ์ด กรอกชื่อเพื่อขอเข้าห้องเรียน แล้วรอคุณครูอนุมัติ</li>
          <li>เมื่อมีงาน บอทจะโพสต์การ์ดงานในกลุ่ม กด “ส่งงาน” หรือ “ทำแบบทดสอบ”</li>
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
      <Card className="divide-y divide-violet-100 dark:divide-slate-800 p-0!">
        {COMMANDS.map(([command, what]) => (
          <div key={command} className="px-4 py-3">
            <p className="text-sm font-black text-violet-800 dark:text-violet-200">{command}</p>
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
  const { classroom, liff, toast } = useKit();
  const roster = useLoad(() => dataService.getClassroomRoster(classroom.id), [classroom.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (student: User, admit: boolean) => {
    setBusy(student.id);
    try {
      if (admit) await dataService.admitStudentToClassroom(classroom.id, student.id);
      else await dataService.rejectStudentFromClassroom(classroom.id, student.id);
      toast(admit ? `อนุมัติ ${studentName(student)} แล้ว` : `ปฏิเสธ ${studentName(student)} แล้ว`);
      roster.reload();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };
  const openWeb = () => liff.openWindow({ url: `${window.location.origin}/classrooms/${classroom.id}`, external: true });
  return (
    <Page title="🏫 จัดการห้องเรียน">
      {roster.error && <ErrorBox text={roster.error} />}
      {!roster.data && !roster.error && <Loading />}
      {roster.data && (
        <>
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-amber-600" />
              <p className="text-sm font-black text-slate-800 dark:text-white">รออนุมัติ ({roster.data.pending_students.length})</p>
            </div>
            {roster.data.pending_students.length === 0 && <p className="text-xs text-slate-400">ไม่มีคำขอเข้าห้อง</p>}
            {roster.data.pending_students.map((student) => (
              <div key={student.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{studentName(student)}</p>
                  {student.student_id && <p className="text-[11px] text-slate-400">เลขที่/รหัส {student.student_id}</p>}
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
              <Users className="w-4 h-4 text-violet-600" />
              <p className="text-sm font-black text-slate-800 dark:text-white">นักเรียนในห้อง ({roster.data.students.length})</p>
            </div>
            {roster.data.students.length === 0 && <Empty text="ยังไม่มีนักเรียน" />}
            <ul className="text-sm divide-y divide-slate-100 dark:divide-slate-800">
              {roster.data.students.map((student, index) => (
                <li key={student.id} className="py-1.5 flex gap-2">
                  <span className="w-6 text-right text-slate-400 text-xs pt-0.5">{index + 1}.</span>
                  <span className="truncate">{studentName(student)}</span>
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

/** "เช็กสถานะ": the class at a glance. */
export function StatusView() {
  const { classroom } = useKit();
  const status = useLoad(async () => {
    const [roster, works] = await Promise.all([dataService.getClassroomRoster(classroom.id), dataService.getAssignmentsByClassroomId(classroom.id)]);
    const published = works.filter((work) => {
      const win = getAssignmentWindow(work);
      return !win.isDraft && !win.isScheduled;
    });
    const submissions = await dataService.getSubmissionsByAssignmentIds(published.map((work) => work.id), { includeStudents: false });
    return { roster, works, published, submissions };
  }, [classroom.id]);

  if (status.error) return <Page title="📊 เช็กสถานะ"><ErrorBox text={status.error} /></Page>;
  if (!status.data) return <Page title="📊 เช็กสถานะ"><Loading /></Page>;
  const { roster, works, published, submissions } = status.data;
  const students = roster.students.length;
  const open = published.filter((work) => getAssignmentWindow(work).acceptsSubmissions);
  const drafts = works.length - published.length;
  const toGrade = submissions.filter(needsGrading).length;
  return (
    <Page title="📊 เช็กสถานะ">
      <div className="grid grid-cols-2 gap-2">
        {[
          ["นักเรียน", students],
          ["รออนุมัติ", roster.pending_students.length],
          ["งานที่เปิดรับ", open.length],
          ["รอตรวจ", toGrade],
        ].map(([label, value]) => (
          <Card key={label as string} className="text-center py-3!">
            <p className="text-2xl font-black text-violet-700 dark:text-violet-300">{value}</p>
            <p className="text-[11px] text-slate-500">{label}</p>
          </Card>
        ))}
      </div>
      {drafts > 0 && <p className="text-xs text-slate-500">ฉบับร่าง / ตั้งเวลาไว้ {drafts} งาน</p>}
      <Card className="space-y-3">
        <p className="text-sm font-black">งานที่เปิดรับ</p>
        {open.length === 0 && <p className="text-xs text-slate-400">ไม่มีงานที่เปิดรับอยู่</p>}
        {open.map((work) => {
          const rows = submissions.filter((sub) => sub.assignment_id === work.id);
          const handed = rows.filter(isHandedIn).length;
          const percent = students ? Math.round((handed / students) * 100) : 0;
          return (
            <div key={work.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold truncate">{work.is_exam ? "📝" : "📋"} {work.title}</p>
                <Pill tone={handed >= students ? "green" : "amber"}>ส่ง {handed}/{students}</Pill>
              </div>
              <div className="h-1.5 rounded-full bg-violet-100 dark:bg-slate-800 overflow-hidden">
                <div className="h-full bg-violet-500" style={{ width: `${Math.min(100, percent)}%` }} />
              </div>
            </div>
          );
        })}
      </Card>
    </Page>
  );
}
