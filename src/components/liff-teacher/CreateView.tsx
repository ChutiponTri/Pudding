"use client";

import { useMemo, useState } from "react";
import { Check, Layers, Plus, Trash2, X } from "lucide-react";
import { StudentPickLink, StudentPickerSheet } from "@/components/StudentPickerSheet";
import { dataService } from "@/lib/supabase/dataService";
import { DRAFT_PUBLISH_AT, LATE_WINDOW_HOURS } from "@/lib/utils/assignmentWindow";
import { daysFromNowAt, localPartsToIso, toLocalDateValue, toLocalTimeValue } from "@/lib/utils/datetime";
import { TRUE_FALSE_OPTIONS } from "@/lib/utils/trueFalse";
import type { Question, QuestionType } from "@/types/database";
import { Button, Card, Done, Field, Page, dateInputClass, errorText, inputClass, useKit, useViewData, type RosterData, type WorkData } from "./kit";

type Draft = { uid: number; type: QuestionType; text: string; options: string[]; answer: string; score: number };

let nextUid = 1;
/** A file answer is usually the whole homework (10 points); other questions start at 1, as on the website. */
const defaultScore = (type: QuestionType) => (type === "file_upload" ? 10 : 1);
const newQuestion = (type: QuestionType = "multiple_choice"): Draft => ({ uid: nextUid++, type, text: "", options: ["", "", "", ""], answer: "", score: defaultScore(type) });
/** A choice question keeps at least this many options (4 to start with). */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;
const OPTION_LETTERS = "กขคงจฉชซ";

const TYPE_LABEL: Record<QuestionType, string> = { file_upload: "แนบไฟล์ / รูป", short_answer: "ข้อความ", multiple_choice: "ปรนัย", true_false: "ถูก/ผิด" };
const TYPE_ICON: Record<QuestionType, string> = { file_upload: "📎", short_answer: "✍️", multiple_choice: "🔘", true_false: "⭕" };
/** Homework takes every kind; a quiz no files (it counts every time the student leaves the screen, as on the website). */
const TYPES_FOR = (isExam: boolean): QuestionType[] => (isExam ? ["multiple_choice", "true_false", "short_answer"] : ["file_upload", "short_answer", "multiple_choice", "true_false"]);
/** Homework questions may leave the text empty for these (a sensible prompt is used). */
const DEFAULT_TEXT: Partial<Record<QuestionType, string>> = { file_upload: "แนบไฟล์งาน", short_answer: "คำตอบ" };

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
  /** Category ("" = the default one: งานทั่วไป / ข้อสอบ). */
  const [groupName, setGroupName] = useState("");
  /** Quiz: roster ids unticked in the picker (empty = everyone takes it). */
  const [excluded, setExcluded] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const work = useViewData<WorkData>("work");
  const roster = useViewData<RosterData>("roster");
  const students = roster.data?.students || [];
  // Categories this class already uses, offered as one-tap choices.
  const categories = useMemo(
    () => [...new Set((work.data?.works || []).map((row) => row.work.group_name?.trim()).filter((name): name is string => !!name))].sort((a, b) => a.localeCompare(b, "th")),
    [work.data]
  );
  // Only ids still on the roster count (a student may have left).
  const excludedNow = excluded.filter((id) => students.some((s) => s.id === id));
  const defaultDue = daysFromNowAt(7, 23, 59);
  const [dueDate, setDueDate] = useState(toLocalDateValue(defaultDue));
  const [dueTime, setDueTime] = useState(toLocalTimeValue(defaultDue));
  /** "ปิดรับส่งงาน" (optional): empty = LATE_WINDOW_HOURS after the due date. */
  const [closeDate, setCloseDate] = useState("");
  const [closeTime, setCloseTime] = useState("23:59");
  const [minutes, setMinutes] = useState(30);
  // Each kind keeps its own questions, so switching the tab back and forth loses nothing.
  const [homeworkQuestions, setHomeworkQuestions] = useState<Draft[]>(() => [newQuestion("file_upload")]);
  const [quizQuestions, setQuizQuestions] = useState<Draft[]>(() => [newQuestion("multiple_choice")]);
  const questions = isExam ? quizQuestions : homeworkQuestions;
  const setQuestions = isExam ? setQuizQuestions : setHomeworkQuestions;
  const [busy, setBusy] = useState<"publish" | "draft" | null>(null);
  /** sent: whether the work card reached the group (the teacher may cancel the picker). */
  const [created, setCreated] = useState<{ title: string; draft: boolean; sent: boolean } | null>(null);

  const patch = (uid: number, change: Partial<Draft>) => setQuestions((list) => list.map((q) => (q.uid === uid ? { ...q, ...change } : q)));
  const changeType = (q: Draft, type: QuestionType) =>
    // A score still at the old kind's default follows the new kind's.
    patch(q.uid, { type, answer: "", ...(q.score === defaultScore(q.type) ? { score: defaultScore(type) } : {}) });

  const problem = (): string | null => {
    if (!title.trim()) return "กรุณาใส่ชื่องาน";
    if (!isExam) {
      if (!localPartsToIso(dueDate, dueTime)) return "กรุณาเลือกกำหนดส่ง";
      if (new Date(localPartsToIso(dueDate, dueTime)).getTime() <= Date.now()) return "กำหนดส่งต้องอยู่ในอนาคต";
      if (closeDate && new Date(localPartsToIso(closeDate, closeTime)).getTime() < new Date(localPartsToIso(dueDate, dueTime)).getTime()) {
        return "เวลาปิดรับส่งงานต้องไม่ก่อนกำหนดส่ง";
      }
    }
    if (isExam && !(minutes > 0)) return "กรุณาใส่เวลาทำข้อสอบ";
    if (!questions.length) return "เพิ่มคำถามอย่างน้อย 1 ข้อ";
    if (isExam && students.length && excludedNow.length >= students.length) return "เลือกนักเรียนที่ทำแบบทดสอบอย่างน้อย 1 คน";
    for (const [index, q] of questions.entries()) {
      const n = index + 1;
      if (isExam && q.type === "file_upload") return `ข้อ ${n}: แบบทดสอบใช้คำถามแบบแนบไฟล์ไม่ได้`;
      if (!q.text.trim() && (isExam || !DEFAULT_TEXT[q.type])) return `ข้อ ${n}: กรุณาใส่คำถาม`;
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
      const rows: Omit<Question, "id" | "assignment_id">[] = questions.map((q) => ({
        type: q.type,
        question_text: q.text.trim() || DEFAULT_TEXT[q.type] || "",
        options: q.type === "multiple_choice" ? q.options.map((o) => o.trim()).filter(Boolean) : q.type === "true_false" ? [...TRUE_FALSE_OPTIONS] : undefined,
        ideal_answer: q.type === "multiple_choice" || q.type === "true_false" ? q.answer : "",
        rubric_criteria: "",
        max_score: Number(q.score) || defaultScore(q.type),
        is_required: true,
      }));
      const total = rows.reduce((sum, row) => sum + Number(row.max_score || 0), 0);
      const result = await dataService.createAssignment(
        {
          course_id: classroom.courseId || undefined,
          classroom_id: classroom.id,
          classroom_name: classroom.name,
          title: title.trim(),
          description: description.trim(),
          ...(groupName.trim() ? { group_name: groupName.trim() } : {}),
          is_exam: isExam,
          // Some students unticked: only the rest see and take the quiz.
          ...(isExam && excludedNow.length ? { retake_student_ids: students.filter((s) => !excludedNow.includes(s.id)).map((s) => s.id) } : {}),
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
                setExcluded([]);
                setHomeworkQuestions([newQuestion("file_upload")]);
                setQuizQuestions([newQuestion("multiple_choice")]);
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
      <div role="tablist" aria-label="ประเภทงาน" className="relative grid grid-cols-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
        {/* The white pill slides under the picked tab. */}
        <span
          aria-hidden
          className={`absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-amber-500 shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isExam ? "translate-x-full" : "translate-x-0"}`}
        />
        {[
          [false, "📋 การบ้าน"],
          [true, "📝 แบบทดสอบ"],
        ].map(([value, label]) => (
          <button
            key={String(value)}
            type="button"
            role="tab"
            aria-selected={isExam === value}
            data-no-press
            onClick={() => setIsExam(value as boolean)}
            className={`relative z-10 h-10 rounded-lg text-sm font-bold cursor-pointer transition-colors duration-300 ${isExam === value ? "text-slate-950" : "text-slate-500 dark:text-slate-400"}`}
          >
            {label as string}
          </button>
        ))}
      </div>

      {/* The form slides in from the side of the tab just picked (homework left, quiz right).
          Wrapped once more: the page's card-rise animation applies to its direct children only. */}
      <div>
      <div
        key={isExam ? "quiz" : "homework"}
        className={`space-y-4 animate-in fade-in [--tw-duration:360ms] ${isExam ? "[--tw-enter-translate-x:2rem]" : "[--tw-enter-translate-x:-2rem]"}`}
      >

      <Card className="space-y-3">
        <Field label="ชื่องาน *">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={isExam ? "เช่น แบบทดสอบบทที่ 1" : "เช่น การบ้าน 1"} />
        </Field>
        <div className="space-y-1.5">
          <Field label="หมวดหมู่">
            <input className={inputClass} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={categories.length ? "เลือกด้านล่าง หรือพิมพ์ชื่อใหม่" : isExam ? "ไม่ระบุ = ข้อสอบ" : "ไม่ระบุ = งานทั่วไป"} />
          </Field>
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {categories.map((name) => {
                const on = groupName.trim() === name;
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setGroupName(on ? "" : name)}
                    className={`h-7 px-2.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                      on ? "bg-amber-500 text-slate-950" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {on ? <Check className="w-3 h-3" /> : <Layers className="w-3 h-3" />}
                    {name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <Field label="รายละเอียด">
          <textarea className={`${inputClass} h-20 py-2`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {isExam ? (
          <>
            <Field label="เวลาทำ (นาที)" hint="นับจากเวลาที่เผยแพร่">
              <input className={inputClass} type="number" min={1} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 0)} />
            </Field>
            {students.length > 0 && <StudentPickLink total={students.length} excludedCount={excludedNow.length} onClick={() => setPicking(true)} />}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="กำหนดส่ง">
                <input className={`${inputClass} ${dateInputClass}`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
              <Field label="เวลา">
                <input className={`${inputClass} ${dateInputClass}`} type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="ปิดรับส่งงาน (ไม่บังคับ)">
                <input className={`${inputClass} ${dateInputClass}`} type="date" value={closeDate} min={dueDate} onChange={(e) => setCloseDate(e.target.value)} />
              </Field>
              <Field label="เวลา">
                <input className={`${inputClass} ${dateInputClass}`} type="time" value={closeTime} disabled={!closeDate} onChange={(e) => setCloseTime(e.target.value)} />
              </Field>
            </div>
            <p className="-mt-1 text-[11px] text-slate-400">
              {closeDate ? (
                <button type="button" className="underline cursor-pointer" onClick={() => setCloseDate("")}>ใช้ค่าเริ่มต้น ({LATE_WINDOW_HOURS} ชม. หลังกำหนดส่ง)</button>
              ) : (
                `ไม่ระบุ = ส่งช้าได้อีก ${LATE_WINDOW_HOURS} ชม. หลังกำหนดส่ง แล้วปิดรับเอง`
              )}
            </p>
          </>
        )}
      </Card>

      {questions.map((q, index) => (
          <Card key={q.uid} className="liff-rise space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-black">ข้อ {index + 1}</p>
              <div className="flex items-center gap-1">
                <select className="h-8 px-2 rounded-lg text-xs bg-amber-50 dark:bg-slate-800" value={q.type} onChange={(e) => changeType(q, e.target.value as QuestionType)}>
                  {TYPES_FOR(isExam).map((type) => (
                    <option key={type} value={type}>{TYPE_ICON[type]} {TYPE_LABEL[type]}</option>
                  ))}
                </select>
                {questions.length > 1 && (
                  <button type="button" aria-label="ลบข้อนี้" onClick={() => setQuestions((list) => list.filter((item) => item.uid !== q.uid))} className="w-8 h-8 rounded-lg flex items-center justify-center text-rose-500 cursor-pointer">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <textarea
              className={`${inputClass} h-16 py-2`}
              placeholder={!isExam && DEFAULT_TEXT[q.type] ? `คำสั่ง (ไม่บังคับ เว้นว่าง = “${DEFAULT_TEXT[q.type]}”)` : "คำถาม"}
              value={q.text}
              onChange={(e) => patch(q.uid, { text: e.target.value })}
            />
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
                      placeholder={`ตัวเลือก ${OPTION_LETTERS[i] || i + 1}`}
                      value={option}
                      onChange={(e) => {
                        const options = [...q.options];
                        const wasAnswer = q.answer && q.answer === option.trim();
                        options[i] = e.target.value;
                        patch(q.uid, { options, ...(wasAnswer ? { answer: e.target.value.trim() } : {}) });
                      }}
                    />
                    {q.options.length > MIN_OPTIONS && (
                      <button
                        type="button"
                        aria-label={`ลบตัวเลือก ${OPTION_LETTERS[i] || i + 1}`}
                        onClick={() => {
                          const wasAnswer = !!q.answer && q.answer === option.trim();
                          patch(q.uid, { options: q.options.filter((_, j) => j !== i), ...(wasAnswer ? { answer: "" } : {}) });
                        }}
                        className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-500 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                {q.options.length < MAX_OPTIONS && (
                  <button type="button" onClick={() => patch(q.uid, { options: [...q.options, ""] })} className="ml-7 h-8 px-2 rounded-lg text-xs font-bold text-slate-500 hover:text-amber-600 inline-flex items-center gap-1 cursor-pointer">
                    <Plus className="w-3.5 h-3.5" /> เพิ่มตัวเลือก
                  </button>
                )}
              </div>
            )}
            {q.type === "true_false" && (
              <div className="grid grid-cols-2 gap-2">
                {TRUE_FALSE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => patch(q.uid, { answer: option })}
                    className={`h-10 rounded-xl text-sm font-bold cursor-pointer ${q.answer === option ? "bg-amber-500 text-slate-950" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
            {q.type === "short_answer" && <p className="text-[11px] text-slate-500">ข้อเขียน คุณครูให้คะแนนเองในเมนู “ตรวจงาน”</p>}
            {q.type === "file_upload" && <p className="text-[11px] text-slate-500">นักเรียนถ่ายรูปหรือแนบไฟล์ คุณครูให้คะแนนเองในเมนู “ตรวจงาน”</p>}
            <Field label="คะแนน">
              <input className={`${inputClass} w-24!`} type="number" min={0} inputMode="numeric" value={q.score} onChange={(e) => patch(q.uid, { score: Number(e.target.value) || 0 })} />
            </Field>
          </Card>
        ))}
      <div className="space-y-1.5">
        <p className="text-[11px] font-bold text-slate-500 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> เพิ่มคำถาม</p>
        <div className={`grid gap-2 ${isExam ? "grid-cols-3" : "grid-cols-4"}`}>
          {TYPES_FOR(isExam).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setQuestions((list) => [...list, newQuestion(type)])}
              className="h-14 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-bold flex flex-col items-center justify-center gap-0.5 cursor-pointer"
            >
              <span className="text-base leading-none">{TYPE_ICON[type]}</span>
              {TYPE_LABEL[type]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-400">
          {isExam ? "แบบทดสอบไม่มีคำถามแบบแนบไฟล์ เพราะระบบนับทุกครั้งที่นักเรียนออกจากหน้าจอ" : `รวม ${questions.length} ข้อ · คะแนนเต็ม ${questions.reduce((sum, q) => sum + (Number(q.score) || 0), 0)}`}
        </p>
      </div>
      </div>
      </div>

      <div className="flex gap-2">
        <Button tone="ghost" busy={busy === "draft"} disabled={!!busy} onClick={() => save(true)}>บันทึกร่าง</Button>
        <Button className="flex-1" busy={busy === "publish"} disabled={!!busy} onClick={() => save(false)}>เผยแพร่ + ส่งการ์ดเข้ากลุ่ม</Button>
      </div>
      <p className="text-[11px] text-slate-400">ต้องการแนบไฟล์ ตัวชี้วัด หรือตั้งเวลาเผยแพร่ ใช้หน้าสร้างงานบนเว็บ</p>
      {picking && <StudentPickerSheet students={students} excluded={excludedNow} onChange={setExcluded} onClose={() => setPicking(false)} />}
    </Page>
  );
}
