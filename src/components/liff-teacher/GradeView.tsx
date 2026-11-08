"use client";

import { useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { dataService } from "@/lib/supabase/dataService";
import { isGraded, isHandedIn } from "@/lib/utils/gradingStatus";
import type { Assignment, Question, Submission, SubmissionAnswer } from "@/types/database";
import { Button, Card, Empty, ErrorBox, Field, Page, Pill, Skeleton, errorText, inputClass, useKit, useLoad } from "./kit";
import { useWork } from "./WorkViews";

const studentName = (sub: Submission) => `${sub.student?.first_name || ""} ${sub.student?.last_name || ""}`.trim() || "นักเรียน";

/** "ตรวจงาน": pick a work, a student, then score each answer (a minimal version of the web's grading page). */
export function GradeView() {
  const [work, setWork] = useState<Assignment | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  if (work && submission) return <GradeSubmission work={work} submission={submission} onDone={() => setSubmission(null)} />;
  if (work) return <SubmissionList work={work} onBack={() => setWork(null)} onPick={setSubmission} />;
  return <WorkList onPick={setWork} />;
}

function WorkList({ onPick }: { onPick: (work: Assignment) => void }) {
  const data = useWork();
  if (data.error) return <Page title="✅ ตรวจงาน"><ErrorBox text={data.error} /></Page>;
  if (!data.data) return <Page title="✅ ตรวจงาน"><Skeleton /></Page>;
  // Waiting to be graded first.
  const rows = data.rows.filter((row) => row.handed > 0).sort((a, b) => Number(b.toGrade > 0) - Number(a.toGrade > 0));
  return (
    <Page title="✅ ตรวจงาน" refreshing={data.refreshing}>
      {rows.length === 0 && <Empty text={data.rows.length ? "ยังไม่มีนักเรียนส่งงาน" : "ยังไม่มีงานในห้องนี้"} />}
      {rows.length > 0 && (
        <Card className="p-0! divide-y divide-amber-100 dark:divide-slate-800">
          {rows.map((row) => {
            const left = row.toGrade;
            return (
              <button key={row.work.id} type="button" onClick={() => onPick(row.work)} className="w-full px-4 py-3 flex items-center gap-2 text-left cursor-pointer">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold truncate">{row.work.is_exam ? "📝" : "📋"} {row.work.title}</span>
                  <span className="block text-[11px] text-slate-500">ส่งแล้ว {row.handed}/{row.total} คน</span>
                </span>
                <Pill tone={left > 0 ? "amber" : "green"}>{left > 0 ? `รอตรวจ ${left}` : "ตรวจครบ"}</Pill>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            );
          })}
        </Card>
      )}
    </Page>
  );
}

function SubmissionList({ work, onBack, onPick }: { work: Assignment; onBack: () => void; onPick: (sub: Submission) => void }) {
  const data = useLoad(async () => (await dataService.getSubmissions(work.id)).filter(isHandedIn), [work.id]);
  const rows = [...(data.data || [])].sort((a, b) => Number(isGraded(a)) - Number(isGraded(b)) || studentName(a).localeCompare(studentName(b), "th"));
  return (
    <Page title={work.title} subtitle="เลือกนักเรียนเพื่อตรวจ">
      <Button tone="ghost" small onClick={onBack}>← งานทั้งหมด</Button>
      {data.error && <ErrorBox text={data.error} />}
      {!data.data && !data.error && <Skeleton rows={4} />}
      {data.data && rows.length === 0 && <Empty text="ยังไม่มีใครส่ง" />}
      {rows.length > 0 && (
        <Card className="p-0! divide-y divide-amber-100 dark:divide-slate-800">
          {rows.map((sub) => (
            <button key={sub.id} type="button" onClick={() => onPick(sub)} className="w-full px-4 py-3 flex items-center gap-2 text-left cursor-pointer">
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold truncate">{studentName(sub)}</span>
                <span className="block text-[11px] text-slate-500">{sub.status === "late" ? "ส่งช้า" : "ส่งแล้ว"}</span>
              </span>
              {isGraded(sub) ? <Pill tone="green">{sub.total_score}/{sub.max_total_score ?? "-"}</Pill> : <Pill tone="amber">รอตรวจ</Pill>}
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
          ))}
        </Card>
      )}
    </Page>
  );
}

function GradeSubmission({ work, submission, onDone }: { work: Assignment; submission: Submission; onDone: () => void }) {
  const { teacher, liff, toast, invalidate } = useKit();
  const data = useLoad(
    async () => {
      const [questions, answers] = await Promise.all([dataService.getQuestions(work.id), dataService.getSubmissionAnswers(submission.id)]);
      return { questions, answers };
    },
    [work.id, submission.id]
  );
  const [scores, setScores] = useState<Record<string, { score: string; comment: string }>>({});
  const [busy, setBusy] = useState(false);

  const value = (q: Question, answer?: SubmissionAnswer) =>
    scores[q.id] || { score: answer?.teacher_score != null ? String(answer.teacher_score) : "", comment: answer?.teacher_comment || "" };

  const save = async () => {
    if (!data.data) return;
    const grades: Array<{ questionId: string; score: number; comment: string }> = [];
    for (const q of data.data.questions) {
      const current = value(q, data.data.answers[q.id]);
      if (current.score === "") continue;
      const score = Number(current.score);
      if (Number.isNaN(score) || score < 0 || score > Number(q.max_score)) return toast(`คะแนนต้องอยู่ระหว่าง 0 ถึง ${q.max_score}`, "error");
      grades.push({ questionId: q.id, score, comment: current.comment.trim() });
    }
    if (!grades.length) return toast("ยังไม่ได้ใส่คะแนน", "error");
    setBusy(true);
    try {
      await dataService.saveTeacherGrades(submission.id, grades, teacher.name);
      // "รอตรวจ" counts and the results page change.
      invalidate("work");
      toast("บันทึกคะแนนแล้ว");
      onDone();
    } catch (err) {
      toast(errorText(err, "บันทึกคะแนนไม่สำเร็จ"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title={studentName(submission)} subtitle={work.title}>
      <Button tone="ghost" small onClick={onDone}>← รายชื่อ</Button>
      {data.error && <ErrorBox text={data.error} />}
      {!data.data && !data.error && <Skeleton rows={2} />}
      {data.data &&
        data.data.questions.map((q, index) => {
          const answer = data.data!.answers[q.id];
          const current = value(q, answer);
          return (
            <Card key={q.id} className="space-y-2">
              <p className="text-xs font-bold text-amber-600">ข้อ {index + 1} · เต็ม {q.max_score}</p>
              <p className="text-sm font-bold whitespace-pre-wrap">{q.question_text}</p>
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-slate-800 text-sm whitespace-pre-wrap wrap-break-word">
                {answer?.text_answer || (!answer?.file_url && <span className="text-slate-400">ไม่ได้ตอบ</span>)}
                {answer?.file_url && (
                  <button type="button" onClick={() => liff.openWindow({ url: answer.file_url!, external: true })} className="mt-1 inline-flex items-center gap-1 text-amber-700 dark:text-amber-300 font-bold underline cursor-pointer">
                    <ExternalLink className="w-3.5 h-3.5" /> เปิดไฟล์ที่ส่ง
                  </button>
                )}
              </div>
              {(q.type === "multiple_choice" || q.type === "true_false") && q.ideal_answer && <p className="text-[11px] text-slate-500">เฉลย: {q.ideal_answer}</p>}
              <div className="grid grid-cols-[6rem_1fr] gap-2">
                <Field label="คะแนน">
                  <input
                    className={inputClass}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={q.max_score}
                    value={current.score}
                    onChange={(e) => setScores((all) => ({ ...all, [q.id]: { ...current, score: e.target.value } }))}
                  />
                </Field>
                <Field label="ความเห็น">
                  <input className={inputClass} value={current.comment} onChange={(e) => setScores((all) => ({ ...all, [q.id]: { ...current, comment: e.target.value } }))} />
                </Field>
              </div>
            </Card>
          );
        })}
      {data.data && <Button className="w-full" busy={busy} onClick={save}>บันทึกคะแนน</Button>}
    </Page>
  );
}
