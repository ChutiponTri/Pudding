"use client";

import { useEffect, useState } from "react";
import { ChevronRight, ExternalLink } from "lucide-react";
import { AntiCheatingBadge } from "@/components/AntiCheatingBadge";
import { IntegrityAuditModal } from "@/components/IntegrityAuditModal";
import { dataService } from "@/lib/supabase/dataService";
import { isGraded, isHandedIn } from "@/lib/utils/gradingStatus";
import { isSuspiciousActivity } from "@/lib/utils/integrity";
import type { Assignment, Question, Submission, SubmissionAnswer, SubmissionEvent } from "@/types/database";
import { fetchOnce, isFresh, readCache, staleCache } from "./cache";
import { Button, Card, Empty, ErrorBox, Field, Page, Pill, Skeleton, errorText, inputClass, useCached, useKit } from "./kit";
import { WorkStatus } from "./StatusSheet";
import { useWork } from "./WorkViews";

const studentName = (sub: Submission) => `${sub.student?.first_name || ""} ${sub.student?.last_name || ""}`.trim() || "นักเรียน";

/** Anything recorded during the quiz (the badge shows "เฝ้าระวัง" / "น่าสงสัย"). */
const hasActivity = (sub: Submission) =>
  !!sub.is_flagged_suspicious || (sub.quiz_exit_count || 0) > 0 || (sub.tab_switch_count || 0) > 0 || (sub.total_time_away_seconds || 0) > 0;

/** Cache keys of this screen. Answers and behaviour logs stay in memory only (":mem:"). */
const keys = (scope: string) => ({
  subs: (workId: string) => `${scope}:subs:${workId}`,
  questions: (workId: string) => `${scope}:mem:questions:${workId}`,
  answers: (subId: string) => `${scope}:mem:answers:${subId}`,
  events: (subId: string) => `${scope}:mem:events:${subId}`,
});

/** "ตรวจงาน": pick a work, a student, then score each answer (a minimal version of the web's grading page). */
export function GradeView() {
  const work = useWork();
  const [picked, setPicked] = useState<Assignment | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  // The latest copy of the picked work (its status may change on this screen).
  const current = picked ? work.rows.find((row) => row.work.id === picked.id)?.work || picked : null;
  if (current && submission) return <GradeSubmission work={current} submission={submission} onDone={() => setSubmission(null)} />;
  if (current) return <SubmissionList work={current} onBack={() => setPicked(null)} onPick={setSubmission} />;
  return <WorkList work={work} onPick={setPicked} />;
}

function WorkList({ work: data, onPick }: { work: ReturnType<typeof useWork>; onPick: (work: Assignment) => void }) {
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
              <div key={row.work.id} className="px-4 py-3 flex items-center gap-2">
                <button type="button" onClick={() => onPick(row.work)} className="flex-1 min-w-0 text-left cursor-pointer">
                  <span className="block text-sm font-bold truncate">{row.work.is_exam ? "📝" : "📋"} {row.work.title}</span>
                  <span className="block text-[11px] text-slate-500">ส่งแล้ว {row.handed}/{row.total} คน</span>
                </button>
                <WorkStatus work={row.work} />
                <button type="button" onClick={() => onPick(row.work)} aria-label={`ตรวจ ${row.work.title}`} className="flex items-center gap-1 shrink-0 cursor-pointer">
                  <Pill tone={left > 0 ? "amber" : "green"}>{left > 0 ? `รอตรวจ ${left}` : "ตรวจครบ"}</Pill>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </button>
              </div>
            );
          })}
        </Card>
      )}
    </Page>
  );
}

/**
 * The behaviour log popup (same as the website's). It opens at once with the
 * counts already on the hand-in; the event list loads behind it (a skeleton
 * meanwhile) and stays cached, so opening it again is instant.
 */
function useAudit() {
  const { cacheScope } = useKit();
  const [target, setTarget] = useState<Submission | null>(null);
  const events = useCached<SubmissionEvent[]>(target ? keys(cacheScope).events(target.id) : null, () => dataService.getSubmissionEvents(target!.id));
  const modal = target ? (
    <IntegrityAuditModal isOpen submission={target} events={events.data || []} loading={!events.data && !events.error} onClose={() => setTarget(null)} />
  ) : null;
  return { open: setTarget, modal };
}

function Integrity({ sub, onOpen }: { sub: Submission; onOpen: (sub: Submission) => void }) {
  return (
    <AntiCheatingBadge
      isFlagged={!!sub.is_flagged_suspicious}
      tabSwitchCount={sub.tab_switch_count || 0}
      totalTimeAwaySeconds={sub.total_time_away_seconds || 0}
      quizExitCount={sub.quiz_exit_count}
      autoForfeited={sub.auto_forfeited}
      onClick={() => onOpen(sub)}
      showDetails={false}
    />
  );
}

function SubmissionList({ work, onBack, onPick }: { work: Assignment; onBack: () => void; onPick: (sub: Submission) => void }) {
  const { cacheScope } = useKit();
  const k = keys(cacheScope);
  const data = useCached<Submission[]>(k.subs(work.id), async () => (await dataService.getSubmissions(work.id)).filter(isHandedIn));
  const audit = useAudit();
  // Quizzes track leaving the screen (as on the website): only they show the integrity chip.
  const tracksAway = !!work.is_exam;
  const rows = [...(data.data || [])].sort((a, b) => Number(isGraded(a)) - Number(isGraded(b)) || studentName(a).localeCompare(studentName(b), "th"));
  const flagged = rows.filter((sub) => sub.is_flagged_suspicious || (sub.quiz_exit_count || 0) > 0 || isSuspiciousActivity(sub.tab_switch_count || 0, sub.total_time_away_seconds || 0)).length;

  // The logs a teacher will likely open (anything recorded) load quietly, so the popup has them already.
  const subIds = rows.filter((sub) => tracksAway && hasActivity(sub)).map((sub) => sub.id).slice(0, 12).join(",");
  useEffect(() => {
    if (!subIds) return;
    const timer = setTimeout(() => {
      for (const id of subIds.split(",")) {
        if (!isFresh(readCache(k.events(id)))) fetchOnce(k.events(id), () => dataService.getSubmissionEvents(id)).catch(() => {});
      }
    }, 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subIds]);

  return (
    <>
    <Page title={work.title} subtitle="เลือกนักเรียนเพื่อตรวจ" refreshing={data.refreshing}>
      <div className="flex items-center justify-between gap-2">
        <Button tone="ghost" small onClick={onBack}>← งานทั้งหมด</Button>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          สถานะ <WorkStatus work={work} />
        </span>
      </div>
      {tracksAway && data.data && rows.length > 0 && (
        <p className={`text-[11px] font-bold ${flagged ? "text-rose-600" : "text-slate-500"}`}>
          {flagged ? `⚠️ น่าสงสัย ${flagged} คน • แตะป้ายเพื่อดูไทม์ไลน์พฤติกรรม` : "🛡️ แตะป้ายพฤติกรรมเพื่อดูไทม์ไลน์ระหว่างทำข้อสอบ"}
        </p>
      )}
      {data.error && <ErrorBox text={data.error} />}
      {!data.data && !data.error && <Skeleton rows={4} />}
      {data.data && rows.length === 0 && <Empty text="ยังไม่มีใครส่ง" />}
      {rows.length > 0 && (
        <Card className="p-0! divide-y divide-amber-100 dark:divide-slate-800">
          {rows.map((sub) => (
            <div key={sub.id} className="px-4 py-3 flex items-center gap-2">
              <button type="button" onClick={() => onPick(sub)} className="flex-1 min-w-0 text-left cursor-pointer">
                <span className="block text-sm font-bold truncate">{studentName(sub)}</span>
                <span className="block text-[11px] text-slate-500">{sub.auto_forfeited ? "ระบบส่งกระดาษเปล่า" : sub.status === "late" ? "ส่งช้า" : "ส่งแล้ว"}</span>
              </button>
              {tracksAway && <Integrity sub={sub} onOpen={audit.open} />}
              <button type="button" onClick={() => onPick(sub)} aria-label={`ตรวจงานของ ${studentName(sub)}`} className="flex items-center gap-1 shrink-0 cursor-pointer">
                {isGraded(sub) ? <Pill tone="green">{sub.total_score}/{sub.max_total_score ?? "-"}</Pill> : <Pill tone="amber">รอตรวจ</Pill>}
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            </div>
          ))}
        </Card>
      )}
    </Page>
    {/* Outside the page: its cards' rise animation must not move the popup. */}
    {audit.modal}
    </>
  );
}

function GradeSubmission({ work, submission, onDone }: { work: Assignment; submission: Submission; onDone: () => void }) {
  const { teacher, liff, toast, invalidate, cacheScope } = useKit();
  const k = keys(cacheScope);
  // The questions are the same for every student of this work: loaded once.
  const questions = useCached<Question[]>(k.questions(work.id), () => dataService.getQuestions(work.id));
  const answers = useCached<Record<string, SubmissionAnswer>>(k.answers(submission.id), () => dataService.getSubmissionAnswers(submission.id));
  const audit = useAudit();
  const data = questions.data && answers.data ? { questions: questions.data, answers: answers.data } : null;
  const loadError = questions.error || answers.error;
  const [scores, setScores] = useState<Record<string, { score: string; comment: string }>>({});
  const [busy, setBusy] = useState(false);

  const value = (q: Question, answer?: SubmissionAnswer) =>
    scores[q.id] || { score: answer?.teacher_score != null ? String(answer.teacher_score) : "", comment: answer?.teacher_comment || "" };

  const save = async () => {
    if (!data) return;
    const grades: Array<{ questionId: string; score: number; comment: string }> = [];
    for (const q of data.questions) {
      const current = value(q, data.answers[q.id]);
      if (current.score === "") continue;
      const score = Number(current.score);
      if (Number.isNaN(score) || score < 0 || score > Number(q.max_score)) return toast(`คะแนนต้องอยู่ระหว่าง 0 ถึง ${q.max_score}`, "error");
      grades.push({ questionId: q.id, score, comment: current.comment.trim() });
    }
    if (!grades.length) return toast("ยังไม่ได้ใส่คะแนน", "error");
    setBusy(true);
    try {
      await dataService.saveTeacherGrades(submission.id, grades, teacher.name);
      // "รอตรวจ" counts, this student's row and saved scores, and the results page change.
      invalidate("work");
      staleCache([k.subs(work.id), k.answers(submission.id)]);
      toast("บันทึกคะแนนแล้ว");
      onDone();
    } catch (err) {
      toast(errorText(err, "บันทึกคะแนนไม่สำเร็จ"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Page title={studentName(submission)} subtitle={work.title} refreshing={questions.refreshing || answers.refreshing}>
      <div className="flex items-center justify-between gap-2">
        <Button tone="ghost" small onClick={onDone}>← รายชื่อ</Button>
        {work.is_exam && <Integrity sub={submission} onOpen={audit.open} />}
      </div>
      {loadError && <ErrorBox text={loadError} />}
      {!data && !loadError && <Skeleton rows={2} />}
      {data &&
        data.questions.map((q, index) => {
          const answer = data.answers[q.id];
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
      {data && <Button className="w-full" busy={busy} onClick={save}>บันทึกคะแนน</Button>}
    </Page>
    {/* Outside the page: its cards' rise animation must not move the popup. */}
    {audit.modal}
    </>
  );
}
