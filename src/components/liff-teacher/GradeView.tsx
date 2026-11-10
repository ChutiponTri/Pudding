"use client";

import { isSurvey } from "@/lib/utils/survey";
import { SurveyResults } from "@/components/SurveyResults";

import { useEffect, useState } from "react";
import { ChevronRight, ExternalLink, PencilLine, RotateCcw, Send } from "lucide-react";
import { AntiCheatingBadge } from "@/components/AntiCheatingBadge";
import { ReopenTimeDialog, reopenTimeSuggestion } from "@/components/ReopenTimeDialog";
import { getAssignmentWindow } from "@/lib/utils/assignmentWindow";
import { rosterFor } from "@/lib/utils/retake";
import { IntegrityAuditModal } from "@/components/IntegrityAuditModal";
import { dataService } from "@/lib/supabase/dataService";
import { isGraded, isHandedIn, isReopenActive } from "@/lib/utils/gradingStatus";
import { isSuspiciousActivity } from "@/lib/utils/integrity";
import type { Assignment, Question, Submission, SubmissionAnswer, SubmissionEvent } from "@/types/database";
import { fetchOnce, isFresh, readCache, staleCache } from "./cache";
import { Button, Card, Empty, ErrorBox, Field, Page, Pill, Skeleton, errorText, inputClass, useCached, useKit, useViewData, type RosterData, type RosterStudent } from "./kit";
import { WorkStatus } from "./StatusSheet";
import { useWork } from "./WorkViews";

const studentName = (sub: Submission) => `${sub.student?.first_name || ""} ${sub.student?.last_name || ""}`.trim() || "นักเรียน";

/** Anything recorded during the quiz (the badge shows "เฝ้าระวัง" / "น่าสงสัย"). */
const hasActivity = (sub: Submission) =>
  !!sub.is_flagged_suspicious || (sub.quiz_exit_count || 0) > 0 || (sub.tab_switch_count || 0) > 0 || (sub.total_time_away_seconds || 0) > 0;

/**
 * Personal adjustments for one student, as on the website's grading page:
 * "ให้แก้ไขงาน" (handed-in homework), "ให้สอบใหม่" (a handed-in quiz, blank
 * sheet), "ให้ส่งงาน" (nothing handed in). Close to or after the deadline the
 * teacher picks how long; otherwise it is granted at once.
 */
type AdjustKind = "edit" | "handin" | "retry";
type AdjustTarget = { key: string; name: string; sub: Submission | null; rosterId?: string };

function useAdjust(work: Assignment, onDone?: (kind: AdjustKind) => void) {
  const { toast, invalidate, cacheScope } = useKit();
  const k = keys(cacheScope);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<(AdjustTarget & { kind: AdjustKind; minutes: number }) | null>(null);

  const save = async (target: AdjustTarget, kind: AdjustKind, minutes: number | null) => {
    const until = minutes ? new Date(Date.now() + minutes * 60000).toISOString() : null;
    setBusy(target.key);
    try {
      if (kind === "retry" && target.sub && until) await dataService.resetQuizSubmission(target.sub.id, until);
      else if (target.sub) await dataService.setSubmissionReopened(target.sub.id, true, until);
      else if (target.rosterId) await dataService.allowStudentHandIn(work.id, target.rosterId, until);
      setDialog(null);
      staleCache([k.subs(work.id), ...(target.sub ? [k.answers(target.sub.id)] : [])]);
      invalidate("work");
      onDone?.(kind);
      toast(kind === "retry" ? `เปิดให้ ${target.name} สอบใหม่แล้ว` : kind === "edit" ? `เปิดให้ ${target.name} แก้ไขงานแล้ว` : `เปิดให้ ${target.name} ส่งงานแล้ว`);
    } catch (err) {
      toast(errorText(err, "บันทึกไม่สำเร็จ"), "error");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (sub: Submission, name: string) => {
    if (!confirm(`ยกเลิกสิทธิ์ที่เปิดให้ ${name}?`)) return;
    setBusy(sub.id);
    try {
      await dataService.setSubmissionReopened(sub.id, false);
      staleCache([k.subs(work.id)]);
      toast("ยกเลิกสิทธิ์แล้ว");
    } catch (err) {
      toast(errorText(err, "บันทึกไม่สำเร็จ"), "error");
    } finally {
      setBusy(null);
    }
  };

  const request = (target: AdjustTarget, kind: AdjustKind) => {
    if (kind === "retry") {
      setDialog({ ...target, kind, minutes: Math.max(10, Number(work.quiz_duration_minutes) || 30) });
      return;
    }
    const suggestion = reopenTimeSuggestion(getAssignmentWindow(work));
    if (!suggestion.needsTime) void save(target, kind, null);
    else setDialog({ ...target, kind, minutes: suggestion.minutes });
  };

  const modal = dialog ? (
    <ReopenTimeDialog
      studentName={dialog.name}
      kind={dialog.kind}
      deadline={getAssignmentWindow(work).deadline}
      defaultMinutes={dialog.minutes}
      busy={busy === dialog.key}
      onConfirm={(minutes) => void save(dialog, dialog.kind, minutes)}
      onClose={() => setDialog(null)}
    />
  ) : null;
  return { busy, request, revoke, modal };
}

/** The adjust button (or the running permission with an undo) for one student. */
function AdjustControl({ adjust, target, kind }: { adjust: ReturnType<typeof useAdjust>; target: AdjustTarget; kind: AdjustKind }) {
  const sub = target.sub;
  if (kind !== "retry" && sub && isReopenActive(sub)) {
    return (
      <span className="inline-flex items-center gap-1 h-8 pl-2.5 pr-1 rounded-lg bg-orange-50 dark:bg-orange-950/40 ring-1 ring-orange-200 dark:ring-orange-900 text-[11px] font-bold text-orange-800 dark:text-orange-200">
        {kind === "edit" ? "เปิดให้แก้ไข" : "เปิดให้ส่ง"}
        <button type="button" onClick={() => adjust.revoke(sub, target.name)} disabled={adjust.busy === sub.id} className="h-6 px-2 rounded-md bg-white/90 dark:bg-slate-900/70 text-[10px] text-slate-600 dark:text-slate-300 cursor-pointer disabled:opacity-50">
          ยกเลิก
        </button>
      </span>
    );
  }
  const Icon = kind === "retry" ? RotateCcw : kind === "edit" ? PencilLine : Send;
  return (
    <Button small tone="soft" busy={adjust.busy === target.key} onClick={() => adjust.request(target, kind)}>
      {adjust.busy !== target.key && <Icon className="w-3.5 h-3.5" />}
      {kind === "retry" ? "ให้สอบใหม่" : kind === "edit" ? "ให้แก้ไขงาน" : "ให้ส่งงาน"}
    </Button>
  );
}

const rosterName = (s: RosterStudent) => `${s.first_name || ""} ${s.last_name || ""}`.trim() || "นักเรียน";

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
  // A survey has nothing to grade: its summary instead.
  if (current && isSurvey(current)) {
    return (
      <Page title={current.title} subtitle="สรุปคำตอบ">
        <Button tone="ghost" small onClick={() => setPicked(null)}>← งานทั้งหมด</Button>
        <SurveyResults assignmentId={current.id} lang="th" totalStudents={work.rows.find((row) => row.work.id === current.id)?.total} />
      </Page>
    );
  }
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
        <Card className="p-0! divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((row) => {
            const left = row.toGrade;
            return (
              <div key={row.work.id} className="px-4 py-3 flex items-center gap-2">
                <button type="button" onClick={() => onPick(row.work)} className="flex-1 min-w-0 text-left cursor-pointer">
                  <span className="block text-sm font-bold truncate">{row.work.is_exam ? "📝" : isSurvey(row.work) ? "📊" : "📋"} {row.work.title}</span>
                  <span className="block text-[11px] text-slate-500">ส่งแล้ว {row.handed}/{row.total} คน</span>
                </button>
                <WorkStatus work={row.work} />
                <button type="button" onClick={() => onPick(row.work)} aria-label={`ตรวจ ${row.work.title}`} className="flex items-center gap-1 shrink-0 cursor-pointer">
                  {isSurvey(row.work) ? <Pill tone="violet">ดูสรุป</Pill> : <Pill tone={left > 0 ? "amber" : "green"}>{left > 0 ? `รอตรวจ ${left}` : "ตรวจครบ"}</Pill>}
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
  // Every row (also "allowed to hand in" ones without work yet); the list shows the handed-in ones.
  const data = useCached<Submission[]>(k.subs(work.id), () => dataService.getSubmissions(work.id));
  const roster = useViewData<RosterData>("roster");
  const audit = useAudit();
  const adjust = useAdjust(work);
  // Quizzes track leaving the screen (as on the website): only they show the integrity chip.
  const tracksAway = !!work.is_exam;
  const rows = [...(data.data || [])].filter(isHandedIn).sort((a, b) => Number(isGraded(a)) - Number(isGraded(b)) || studentName(a).localeCompare(studentName(b), "th"));
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
        <Card className="p-0! divide-y divide-slate-100 dark:divide-slate-800">
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
      {data.data && roster.data && (() => {
        // Roster students with nothing handed in: the teacher may let one hand in (late, or after it closed).
        const byStudent = new Map((data.data || []).map((sub) => [sub.student_id, sub]));
        const missing = rosterFor(work, roster.data.students)
          .map((student) => ({ student, sub: byStudent.get(student.id) || (student.line_uid ? byStudent.get(student.line_uid) : undefined) || null }))
          .filter(({ sub }) => !sub || !isHandedIn(sub));
        const win = getAssignmentWindow(work);
        // Like the website: offered once the student may soon be unable to hand in by themselves (a running permission always shows).
        const canOffer = !win.isDraft && !win.isScheduled && reopenTimeSuggestion(win).needsTime;
        const shown = missing.filter(({ sub }) => canOffer || isReopenActive(sub));
        if (!shown.length) return null;
        return (
          <>
            <p className="px-1 text-[11px] font-bold text-slate-500">ยังไม่ส่ง ({missing.length})</p>
            <Card className="p-0! divide-y divide-slate-100 dark:divide-slate-800">
              {shown.map(({ student, sub }) => (
                <div key={student.id} className="px-4 py-2.5 flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-sm truncate">{rosterName(student)}</span>
                  <AdjustControl adjust={adjust} target={{ key: sub?.id || student.id, name: rosterName(student), sub, rosterId: student.id }} kind="handin" />
                </div>
              ))}
            </Card>
          </>
        );
      })()}
    </Page>
    {/* Outside the page: its cards' rise animation must not move the popup. */}
    {audit.modal}
    {adjust.modal}
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
  // A quiz sheet taken again is blank: back to the list.
  const adjust = useAdjust(work, (kind) => kind === "retry" && onDone());
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
        <span className="flex items-center gap-1.5">
          {work.is_exam && <Integrity sub={submission} onOpen={audit.open} />}
          {/* A score copied from a retake is retaken there, not here. */}
          {!(work.is_exam && submission.retake_submission_id) && (
            <AdjustControl adjust={adjust} target={{ key: submission.id, name: studentName(submission), sub: submission }} kind={work.is_exam ? "retry" : "edit"} />
          )}
        </span>
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
                    onKeyDown={(e) => {
                      if (e.key === "-" || e.key === "e" || e.key === "E") e.preventDefault();
                    }}
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
    {adjust.modal}
    </>
  );
}
