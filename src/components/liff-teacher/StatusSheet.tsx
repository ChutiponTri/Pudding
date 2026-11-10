"use client";

import { useState } from "react";
import { ChevronDown, Clock, Lock, Unlock, X } from "lucide-react";
import { dataService } from "@/lib/supabase/dataService";
import { getAssignmentWindow, LATE_WINDOW_HOURS, QUIZ_LATE_GRACE_MINUTES } from "@/lib/utils/assignmentWindow";
import { daysFromNowAt, lineDate, localPartsToIso, toLocalDateValue, toLocalTimeValue } from "@/lib/utils/datetime";
import type { Assignment, SubmissionOverrideStatus } from "@/types/database";
import { Button, Field, errorText, inputClass, useKit } from "./kit";

type Win = ReturnType<typeof getAssignmentWindow>;

/** Where a work stands, for the label every list shows (so closed work is still listed). */
export function workState({ win }: { win: Win }): { label: string; tone: "slate" | "violet" | "green" | "amber" | "red" } {
  if (win.isDraft) return { label: "ฉบับร่าง", tone: "slate" };
  if (win.isScheduled) return { label: "ยังไม่เผยแพร่", tone: "violet" };
  if (win.acceptsSubmissions) return { label: win.isPastDeadline ? "รับส่งช้า" : win.isExtended ? "ขยายเวลา" : "เปิดรับ", tone: win.isPastDeadline || win.isExtended ? "amber" : "green" };
  return { label: "ปิดรับแล้ว", tone: "red" };
}

const PILL: Record<ReturnType<typeof workState>["tone"], string> = {
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  red: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200",
};

/**
 * Where the work stands, as a pill. For published work the pill is a button
 * that opens the "สถานะการรับงาน" sheet (follow the deadline / close now /
 * extend), the same choices as the website. Drafts and scheduled work are
 * released from "เผยแพร่" instead, so their pill is only a label.
 */
export function WorkStatus({ work }: { work: Assignment }) {
  const [open, setOpen] = useState(false);
  const win = getAssignmentWindow(work);
  const state = workState({ win });
  const published = !win.isDraft && !win.isScheduled;
  if (!published) {
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${PILL[state.tone]}`}>{state.label}</span>;
  }
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={`สถานะการรับงาน: ${state.label} (แตะเพื่อเปลี่ยน)`}
        className={`inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded-full text-[11px] font-bold shrink-0 cursor-pointer ring-1 ring-black/5 dark:ring-white/10 transition-colors duration-300 ${PILL[state.tone]}`}
      >
        {state.label}
        <ChevronDown className="w-3 h-3 opacity-70" />
      </button>
      {open && <StatusSheet work={work} onClose={() => setOpen(false)} />}
    </>
  );
}

const OPTIONS: Array<{ id: SubmissionOverrideStatus; icon: typeof Clock; title: string; tone: string }> = [
  { id: "auto", icon: Clock, title: "ตามกำหนดส่ง (อัตโนมัติ)", tone: "emerald" },
  { id: "force_closed", icon: Lock, title: "ปิดรับงานทันที", tone: "rose" },
  { id: "extended", icon: Unlock, title: "ขยายเวลาส่ง", tone: "amber" },
];
const PICKED: Record<string, string> = {
  emerald: "ring-2 ring-emerald-500 bg-emerald-50 dark:bg-emerald-950/40",
  rose: "ring-2 ring-rose-500 bg-rose-50 dark:bg-rose-950/40",
  amber: "ring-2 ring-amber-500 bg-amber-50 dark:bg-amber-950/40",
};
const ICON: Record<string, string> = { emerald: "text-emerald-600", rose: "text-rose-600", amber: "text-amber-600" };

function StatusSheet({ work, onClose }: { work: Assignment; onClose: () => void }) {
  const { toast, invalidate } = useKit();
  const current = work.status_override || "auto";
  const [mode, setMode] = useState<SubmissionOverrideStatus>(current);
  const start = current === "extended" && work.extended_until ? work.extended_until : daysFromNowAt(1, 23, 59);
  const [date, setDate] = useState(toLocalDateValue(start));
  const [time, setTime] = useState(toLocalTimeValue(start));
  const [busy, setBusy] = useState(false);

  const detail = (id: SubmissionOverrideStatus) => {
    const due = lineDate(work.due_date);
    if (id === "auto") {
      return work.is_exam ? `เปิดถึง ${due} (ส่งภายใน ${QUIZ_LATE_GRACE_MINUTES} นาทีหลังหมดเวลา = ส่งช้า)` : `เปิดถึง ${due} แล้วรับส่งช้าอีก ${LATE_WINDOW_HOURS} ชม.`;
    }
    if (id === "force_closed") return work.is_exam ? "นักเรียนส่งคำตอบไม่ได้จนกว่าจะเปิดอีกครั้ง" : "ส่ง/แก้ไม่ได้จนกว่าจะเปิดใหม่ (ยกเลิกสิทธิ์รายคนด้วย)";
    return work.is_exam ? "เปิดรับคำตอบถึงเวลาใหม่ที่เลือก" : `ย้ายกำหนดส่ง (+ส่งช้า ${LATE_WINDOW_HOURS} ชม.) • งานที่ส่งแล้วยังแก้ไม่ได้`;
  };

  const save = async () => {
    const until = mode === "extended" ? localPartsToIso(date, time) : undefined;
    if (mode === "extended" && (!until || new Date(until).getTime() <= Date.now())) return toast("เลือกเวลาในอนาคต", "error");
    setBusy(true);
    try {
      await dataService.updateAssignmentDeadlineOverride(work.id, { status_override: mode, extended_until: until });
      invalidate("work");
      toast(mode === "force_closed" ? "ปิดรับงานแล้ว" : mode === "extended" ? `ขยายเวลาถึง ${lineDate(until!)} แล้ว` : "กลับไปใช้กำหนดส่งแล้ว");
      onClose();
    } catch (err) {
      toast(errorText(err, "บันทึกสถานะการรับงานไม่สำเร็จ"), "error");
    } finally {
      setBusy(false);
    }
  };

  // The overlay classes match the app's bottom-sheet animation (globals.css).
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-end justify-center" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="work-status-title">
      <div
        className="w-full max-w-md rounded-t-3xl bg-white dark:bg-slate-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-3 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p id="work-status-title" className="text-base font-black text-slate-900 dark:text-white">สถานะการรับงาน</p>
            <p className="text-xs text-slate-500 truncate">{work.is_exam ? "📝" : "📋"} {work.title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="w-9 h-9 -mr-1 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-2">
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            const picked = mode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setMode(option.id)}
                aria-pressed={picked}
                className={`w-full p-3 rounded-2xl text-left flex items-start gap-2.5 cursor-pointer transition-all duration-200 ${picked ? PICKED[option.tone] : "ring-1 ring-slate-200 dark:ring-slate-700"}`}
              >
                <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${ICON[option.tone]}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-900 dark:text-white">
                    {option.title}
                    {current === option.id && <span className="ml-1.5 text-[10px] font-bold text-slate-400">(ตอนนี้)</span>}
                  </span>
                  <span className="block text-[11px] text-slate-500 leading-relaxed">{detail(option.id)}</span>
                </span>
              </button>
            );
          })}
        </div>
        {mode === "extended" && (
          <div className="grid grid-cols-2 gap-2 animate-in fade-in slide-in-from-top-1">
            <Field label="ขยายถึงวันที่">
              <input className={inputClass} type="date" value={date} min={toLocalDateValue(new Date().toISOString())} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="เวลา">
              <input className={inputClass} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
        )}
        <Button className="w-full" busy={busy} disabled={mode === current && mode !== "extended"} onClick={save}>
          บันทึกสถานะ
        </Button>
      </div>
    </div>
  );
}
