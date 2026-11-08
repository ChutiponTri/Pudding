"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { dataService } from "@/lib/supabase/dataService";
import { DRAFT_PUBLISH_AT, LATE_WINDOW_HOURS } from "@/lib/utils/assignmentWindow";
import { daysFromNowAt, localPartsToIso, toLocalDateValue, toLocalTimeValue } from "@/lib/utils/datetime";
import { TRUE_FALSE_OPTIONS } from "@/lib/utils/trueFalse";
import type { Question, QuestionType } from "@/types/database";
import { Button, Card, Done, Field, Page, errorText, inputClass, useKit } from "./kit";

type Draft = { uid: number; type: QuestionType; text: string; options: string[]; answer: string; score: number };

let nextUid = 1;
const newQuestion = (type: QuestionType = "multiple_choice"): Draft => ({ uid: nextUid++, type, text: "", options: ["", "", "", ""], answer: "", score: 1 });

const QUESTION_TYPES: Array<[QuestionType, string]> = [
  ["multiple_choice", "ปรนัย"],
  ["true_false", "ถูก/ผิด"],
  ["short_answer", "เขียนตอบ"],
];

/**
 * "สร้าง": a minimal version of the web's new-work form. Homework: one answer
 * (file or text) with a score. Quiz: choice / true-false / written questions
 * and a time limit. Published work's card goes into the group at once.
 */
export function CreateView() {
  const { classroom, postShare, toast, go, invalidate } = useKit();
  const [isExam, setIsExam] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const defaultDue = daysFromNowAt(7, 23, 59);
  const [dueDate, setDueDate] = useState(toLocalDateValue(defaultDue));
  const [dueTime, setDueTime] = useState(toLocalTimeValue(defaultDue));
  /** "ปิดรับส่งงาน" (optional): empty = LATE_WINDOW_HOURS after the due date. */
  const [closeDate, setCloseDate] = useState("");
  const [closeTime, setCloseTime] = useState("23:59");
  const [answerType, setAnswerType] = useState<"file_upload" | "short_answer">("file_upload");
  const [points, setPoints] = useState(10);
  const [minutes, setMinutes] = useState(30);
  const [questions, setQuestions] = useState<Draft[]>(() => [newQuestion()]);
  const [busy, setBusy] = useState<"publish" | "draft" | null>(null);
  /** sent: whether the work card reached the group (the teacher may cancel the picker). */
  const [created, setCreated] = useState<{ title: string; draft: boolean; sent: boolean } | null>(null);

  const patch = (uid: number, change: Partial<Draft>) => setQuestions((list) => list.map((q) => (q.uid === uid ? { ...q, ...change } : q)));

  const problem = (): string | null => {
    if (!title.trim()) return "กรุณาใส่ชื่องาน";
    if (!isExam) {
      if (!localPartsToIso(dueDate, dueTime)) return "กรุณาเลือกกำหนดส่ง";
      if (new Date(localPartsToIso(dueDate, dueTime)).getTime() <= Date.now()) return "กำหนดส่งต้องอยู่ในอนาคต";
      if (closeDate && new Date(localPartsToIso(closeDate, closeTime)).getTime() < new Date(localPartsToIso(dueDate, dueTime)).getTime()) {
        return "เวลาปิดรับส่งงานต้องไม่ก่อนกำหนดส่ง";
      }
      return null;
    }
    if (!(minutes > 0)) return "กรุณาใส่เวลาทำข้อสอบ";
    for (const [index, q] of questions.entries()) {
      const n = index + 1;
      if (!q.text.trim()) return `ข้อ ${n}: กรุณาใส่คำถาม`;
      if (q.type === "multiple_choice") {
        const options = q.options.map((o) => o.trim()).filter(Boolean);
        if (options.length < 2) return `ข้อ ${n}: ใส่ตัวเลือกอย่างน้อย 2 ข้อ`;
        if (!q.answer || !options.includes(q.answer)) return `ข้อ ${n}: เลือกคำตอบที่ถูกต้อง`;
      }
      if (q.type === "true_false" && !q.answer) return `ข้อ ${n}: เลือกคำตอบที่ถูกต้อง`;
    }
    return null;
  };

  const save = async (draft: boolean) => {
    const issue = problem();
    if (issue) return toast(issue, "error");
    setBusy(draft ? "draft" : "publish");
    try {
      const rows: Omit<Question, "id" | "assignment_id">[] = isExam
        ? questions.map((q) => ({
            type: q.type,
            question_text: q.text.trim(),
            options: q.type === "multiple_choice" ? q.options.map((o) => o.trim()).filter(Boolean) : q.type === "true_false" ? [...TRUE_FALSE_OPTIONS] : undefined,
            ideal_answer: q.answer,
            rubric_criteria: "",
            max_score: Number(q.score) || 1,
            is_required: true,
          }))
        : [
            {
              type: answerType,
              question_text: answerType === "file_upload" ? "แนบไฟล์งาน" : "คำตอบ",
              ideal_answer: "",
              rubric_criteria: "",
              max_score: Number(points) || 10,
              is_required: true,
            },
          ];
      const total = rows.reduce((sum, row) => sum + Number(row.max_score || 0), 0);
      const result = await dataService.createAssignment(
        {
          course_id: classroom.courseId || undefined,
          classroom_id: classroom.id,
          classroom_name: classroom.name,
          title: title.trim(),
          description: description.trim(),
          is_exam: isExam,
          // A quiz runs for its minutes from publishing; the server moves it again when a draft is published.
          due_date: isExam ? new Date(Date.now() + minutes * 60_000).toISOString() : localPartsToIso(dueDate, dueTime),
          ...(!isExam && closeDate ? { close_at: localPartsToIso(closeDate, closeTime) } : {}),
          ...(isExam ? { quiz_duration_minutes: minutes } : {}),
          ...(draft ? { publish_at: DRAFT_PUBLISH_AT } : {}),
          total_points: total,
          status_override: "auto",
        },
        rows
      );
      invalidate("work");
      // The work card goes straight into the group from the teacher's LINE.
      let sent = false;
      if (!draft && result.line === "card" && result.share?.url) {
        const posted = await postShare(result.share).catch((err) => {
          toast(errorText(err, "ส่งการ์ดไม่สำเร็จ"), "error");
          return "cancelled" as const;
        });
        sent = posted === "sent" || posted === "shared";
      }
      setCreated({ title: title.trim(), draft, sent });
    } catch (err) {
      toast(errorText(err, "สร้างงานไม่สำเร็จ"), "error");
    } finally {
      setBusy(null);
    }
  };

  if (created) {
    return (
      <Page title="✏️ สร้างงาน">
        <Done title={created.draft ? `บันทึกฉบับร่าง “${created.title}” แล้ว` : `สร้าง “${created.title}” แล้ว`}>
          <p className="text-xs text-slate-500">
            {created.draft ? "เผยแพร่ได้จากเมนู “เผยแพร่”" : created.sent ? "การ์ดงานถูกส่งเข้ากลุ่มแล้ว" : "ยังไม่ได้ส่งการ์ด ส่งได้จากเมนู “เผยแพร่” → ส่งการ์ดงานอีกครั้ง"}
          </p>
          <div className="flex gap-2 justify-center">
            <Button
              tone="soft"
              small
              onClick={() => {
                setCreated(null);
                setTitle("");
                setDescription("");
                setQuestions([newQuestion()]);
              }}
            >
              สร้างอีกงาน
            </Button>
            <Button tone="ghost" small onClick={() => go("home")}>กลับเมนู</Button>
          </div>
        </Done>
      </Page>
    );
  }

  return (
    <Page title="✏️ สร้างงาน">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-amber-100 dark:bg-slate-900">
        {[
          [false, "📋 การบ้าน"],
          [true, "📝 แบบทดสอบ"],
        ].map(([value, label]) => (
          <button
            key={String(value)}
            type="button"
            onClick={() => setIsExam(value as boolean)}
            className={`h-10 rounded-lg text-sm font-bold cursor-pointer ${isExam === value ? "bg-white dark:bg-amber-600 text-amber-800 dark:text-white shadow-sm" : "text-amber-600 dark:text-slate-400"}`}
          >
            {label as string}
          </button>
        ))}
      </div>

      <Card className="space-y-3">
        <Field label="ชื่องาน *">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isExam ? "เช่น แบบทดสอบบทที่ 1" : "เช่น การบ้าน 1"} />
        </Field>
        <Field label="รายละเอียด">
          <textarea className={`${inputClass} h-20 py-2`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {isExam ? (
          <Field label="เวลาทำ (นาที)" hint="นับจากเวลาที่เผยแพร่">
            <input className={inputClass} type="number" min={1} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 0)} />
          </Field>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="กำหนดส่ง">
                <input className={inputClass} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <Field label="เวลา">
                <input className={inputClass} type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="ปิดรับส่งงาน (ไม่บังคับ)">
                <input className={inputClass} type="date" value={closeDate} min={dueDate} onChange={(e) => setCloseDate(e.target.value)} />
              </Field>
              <Field label="เวลา">
                <input className={inputClass} type="time" value={closeTime} disabled={!closeDate} onChange={(e) => setCloseTime(e.target.value)} />
              </Field>
            </div>
            <p className="-mt-1 text-[11px] text-slate-400">
              {closeDate ? (
                <button type="button" className="underline cursor-pointer" onClick={() => setCloseDate("")}>ใช้ค่าเริ่มต้น ({LATE_WINDOW_HOURS} ชม. หลังกำหนดส่ง)</button>
              ) : (
                `ไม่ระบุ = ส่งช้าได้อีก ${LATE_WINDOW_HOURS} ชม. หลังกำหนดส่ง แล้วปิดรับเอง`
              )}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="ส่งเป็น">
                <select className={inputClass} value={answerType} onChange={(e) => setAnswerType(e.target.value as "file_upload" | "short_answer")}>
                  <option value="file_upload">ไฟล์ / รูปภาพ</option>
                  <option value="short_answer">ข้อความ</option>
                </select>
              </Field>
              <Field label="คะแนนเต็ม">
                <input className={inputClass} type="number" min={0} inputMode="numeric" value={points} onChange={(e) => setPoints(Number(e.target.value) || 0)} />
              </Field>
            </div>
          </>
        )}
      </Card>

      {isExam &&
        questions.map((q, index) => (
          <Card key={q.uid} className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-black">ข้อ {index + 1}</p>
              <div className="flex items-center gap-1">
                <select className="h-8 px-2 rounded-lg text-xs bg-amber-50 dark:bg-slate-800" value={q.type} onChange={(e) => patch(q.uid, { type: e.target.value as QuestionType, answer: "" })}>
                  {QUESTION_TYPES.map(([type, label]) => (
                    <option key={type} value={type}>{label}</option>
                  ))}
                </select>
                {questions.length > 1 && (
                  <button type="button" aria-label="ลบข้อนี้" onClick={() => setQuestions((list) => list.filter((item) => item.uid !== q.uid))} className="w-8 h-8 rounded-lg flex items-center justify-center text-rose-500 cursor-pointer">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <textarea className={`${inputClass} h-16 py-2`} placeholder="คำถาม" value={q.text} onChange={(e) => patch(q.uid, { text: e.target.value })} />
            {q.type === "multiple_choice" && (
              <div className="space-y-1.5">
                <p className="text-[11px] text-slate-500">แตะวงกลมหน้าคำตอบที่ถูกต้อง</p>
                {q.options.map((option, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`answer-${q.uid}`}
                      aria-label={`ตัวเลือก ${i + 1} ถูกต้อง`}
                      className="w-5 h-5 accent-amber-500"
                      checked={!!option.trim() && q.answer === option.trim()}
                      onChange={() => patch(q.uid, { answer: option.trim() })}
                    />
                    <input
                      className={`${inputClass} h-9!`}
                      placeholder={`ตัวเลือก ${"กขคง"[i] || i + 1}`}
                      value={option}
                      onChange={(e) => {
                        const options = [...q.options];
                        const wasAnswer = q.answer && q.answer === option.trim();
                        options[i] = e.target.value;
                        patch(q.uid, { options, ...(wasAnswer ? { answer: e.target.value.trim() } : {}) });
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
            {q.type === "true_false" && (
              <div className="grid grid-cols-2 gap-2">
                {TRUE_FALSE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => patch(q.uid, { answer: option })}
                    className={`h-10 rounded-xl text-sm font-bold cursor-pointer ${q.answer === option ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-800 dark:bg-slate-800 dark:text-slate-200"}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
            {q.type === "short_answer" && <p className="text-[11px] text-slate-500">ข้อเขียน คุณครูให้คะแนนเองในเมนู “ตรวจงาน”</p>}
            <Field label="คะแนน">
              <input className={`${inputClass} w-24!`} type="number" min={0} inputMode="numeric" value={q.score} onChange={(e) => patch(q.uid, { score: Number(e.target.value) || 0 })} />
            </Field>
          </Card>
        ))}
      {isExam && (
        <Button tone="soft" className="w-full" onClick={() => setQuestions((list) => [...list, newQuestion(list[list.length - 1]?.type)])}>
          <Plus className="w-4 h-4" /> เพิ่มข้อ
        </Button>
      )}

      <div className="flex gap-2">
        <Button tone="ghost" busy={busy === "draft"} disabled={!!busy} onClick={() => save(true)}>บันทึกร่าง</Button>
        <Button className="flex-1" busy={busy === "publish"} disabled={!!busy} onClick={() => save(false)}>เผยแพร่ + ส่งการ์ดเข้ากลุ่ม</Button>
      </div>
      <p className="text-[11px] text-slate-400">ต้องการแนบไฟล์ ตัวชี้วัด หรือตั้งเวลาเผยแพร่ ใช้หน้าสร้างงานบนเว็บ</p>
    </Page>
  );
}
