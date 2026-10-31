'use client';

import { useState } from 'react';
import { Check, Clock, Loader2, Lock, Rocket, Unlock, X } from 'lucide-react';
import type { Assignment, SubmissionOverrideStatus } from '@/types/database';
import { DateTimeField } from '@/components/DateTimeField';
import { ModalSheet, ModalSheetBody, ModalSheetFooter, ModalSheetHeader } from '@/components/ModalSheet';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { daysFromNowAt, formatDateTime } from '@/lib/utils/datetime';
import { ASSIGNMENT_STATUS_CLASSES, draftExpiresAt, getAssignmentStatus, getAssignmentWindow, LATE_WINDOW_HOURS, QUIZ_LATE_GRACE_MINUTES } from '@/lib/utils/assignmentWindow';

/**
 * Lets a teacher change whether an assignment accepts work, from the classroom
 * classwork list: follow the deadline, close now, or extend the deadline.
 * Same override the grading page's control panel writes. Scheduled work can
 * also be released right away from here.
 */
export function AssignmentStatusDialog({
  assignment,
  onClose,
  onSaved,
}: {
  assignment: Assignment;
  onClose: () => void;
  /** `action` says whether the work was published now or its submission status changed. */
  onSaved: (updated: Assignment, action: 'published' | 'status') => void;
}) {
  const { tr, language } = useLanguage();
  const current = assignment.status_override || 'auto';
  const [mode, setMode] = useState<SubmissionOverrideStatus>(current);
  const [extendedUntil, setExtendedUntil] = useState(
    current === 'extended' && assignment.extended_until ? assignment.extended_until : daysFromNowAt(1, 23, 59)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [publishing, setPublishing] = useState(false);
  const assignmentWindow = getAssignmentWindow(assignment);
  const status = getAssignmentStatus(assignmentWindow, assignment.is_exam);
  const dueLabel = formatDateTime(assignment.due_date, language);

  const options: Array<{ id: SubmissionOverrideStatus; icon: typeof Clock; title: string; detail: string; tone: string }> = [
    {
      id: 'auto',
      icon: Clock,
      title: tr('ตามกำหนดส่ง (อัตโนมัติ)', 'Follow the due date (automatic)'),
      detail: assignment.is_exam
        ? tr(
            `เปิดรับคำตอบถึง ${dueLabel} แล้วปิดรับ (คำตอบที่มาถึงภายใน ${QUIZ_LATE_GRACE_MINUTES} นาทีบันทึกว่าส่งช้า — นักเรียนไม่เห็นข้อนี้)`,
            `Open until ${dueLabel}, then closes (answers arriving within ${QUIZ_LATE_GRACE_MINUTES} min are marked late — students don't see this)`
          )
        : tr(
            `เปิดรับงานถึง ${dueLabel} หลังจากนั้นรับงานส่งช้าอีก ${LATE_WINDOW_HOURS} ชม. แล้วปิดรับเอง`,
            `Open until ${dueLabel}, then accepts late work for ${LATE_WINDOW_HOURS} more hours before closing`
          ),
      tone: 'emerald',
    },
    {
      id: 'force_closed',
      icon: Lock,
      title: tr('ปิดรับงานทันที', 'Close now'),
      detail: tr('นักเรียนส่งหรือแก้ไขงานไม่ได้จนกว่าจะเปิดอีกครั้ง', 'Students cannot submit or edit until you reopen it'),
      tone: 'rose',
    },
    {
      id: 'extended',
      icon: Unlock,
      title: tr('ขยายเวลาส่ง', 'Extend deadline'),
      detail: assignment.is_exam ? tr('เปิดรับคำตอบถึงเวลาใหม่ที่เลือก', 'Accept answers until the new time you pick') : tr(
            `ย้ายกำหนดส่งไปเวลาใหม่ที่เลือก (รับงานส่งช้าต่ออีก ${LATE_WINDOW_HOURS} ชม.) — ใช้เปิดรับงานที่ปิดไปแล้วอีกครั้งได้`,
            `Move the due date to the new time (late work accepted for ${LATE_WINDOW_HOURS} more hours) — also reopens closed work`
          ),
      tone: 'amber',
    },
  ];

  const selectedClasses: Record<string, string> = {
    emerald: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-500/40',
    rose: 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-500/40',
    amber: 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-500/40',
  };
  const iconClasses: Record<string, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    rose: 'text-rose-600 dark:text-rose-400',
    amber: 'text-amber-600 dark:text-amber-400',
  };

  const publishNow = async () => {
    const kind = assignment.is_exam ? tr('ข้อสอบ', 'exam') : tr('งาน', 'assignment');
    if (!confirm(tr(`เผยแพร่${kind} "${assignment.title}" ตอนนี้เลยหรือไม่?\nนักเรียนจะเห็นและเริ่มทำได้ทันที และจะได้รับแจ้งเตือนใน LINE`, `Publish the ${kind} "${assignment.title}" now?\nStudents will see it, can start right away, and get a LINE notification.`))) return;
    setPublishing(true);
    setError('');
    try {
      const updated = await dataService.publishAssignmentNow(assignment.id);
      onSaved(updated || { ...assignment, publish_at: new Date().toISOString() }, 'published');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error && err.message ? err.message : tr('เผยแพร่งานไม่สำเร็จ', 'Could not publish'));
    } finally {
      setPublishing(false);
    }
  };

  const save = async () => {
    if (mode === 'extended' && new Date(extendedUntil).getTime() <= Date.now()) {
      setError(tr('เลือกเวลาในอนาคต', 'Pick a time in the future'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await dataService.updateAssignmentDeadlineOverride(assignment.id, {
        status_override: mode,
        extended_until: mode === 'extended' ? extendedUntil : undefined,
      });
      onSaved(updated || { ...assignment, status_override: mode, extended_until: mode === 'extended' ? extendedUntil : assignment.extended_until }, 'status');
    } catch (err) {
      console.error(err);
      setError(tr('บันทึกสถานะการรับงานไม่สำเร็จ', 'Could not save the submission status'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalSheet onClose={onClose} size="sm:max-w-md" zIndex="z-60" labelledBy="assignment-status-title">
        <ModalSheetHeader className="items-start!">
          <div className="min-w-0">
            <h3 id="assignment-status-title" className="text-sm font-black text-slate-900 dark:text-white">
              {tr('สถานะการรับงาน', 'Submission status')}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{assignment.title}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[11px] font-black px-2.5 py-1 rounded-full border ${ASSIGNMENT_STATUS_CLASSES[status.tone]}`}>
              {status.label}
            </span>
            <button type="button" onClick={onClose} aria-label={tr('ปิด', 'Close')} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </ModalSheetHeader>

        <ModalSheetBody className="space-y-4">

        {(assignmentWindow.isScheduled || assignmentWindow.isDraft) && assignment.publish_at && (
          <div className="p-3.5 rounded-2xl border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/40 space-y-2.5">
            <p className="text-[11px] leading-relaxed text-sky-800 dark:text-sky-300">
              {assignmentWindow.isDraft ? (
                <>
                  <span className="font-black">{tr('ฉบับร่าง', 'Draft')}</span> — {tr('นักเรียนยังไม่เห็นงานนี้ กดเผยแพร่เมื่อพร้อม', 'students cannot see this yet. Publish when ready.')}
                  {draftExpiresAt(assignment) &&
                    tr(
                      <> (ลบอัตโนมัติ {formatDateTime(draftExpiresAt(assignment), 'th')} หากยังไม่เผยแพร่)</>,
                      <> (deleted automatically on {formatDateTime(draftExpiresAt(assignment), 'en')} if still unpublished)</>
                    )}
                </>
              ) : (
                <>
                  {tr('ตั้งเวลาเผยแพร่ไว้', 'Scheduled to publish')} <span className="font-black">{formatDateTime(assignment.publish_at, language)}</span> —{' '}
                  {tr('สอนถึงหัวข้อนี้เร็วกว่ากำหนด? เปิดให้นักเรียนทำได้ทันที', 'reached this topic early? Open it to students now.')}
                </>
              )}
            </p>
            <button
              type="button"
              onClick={publishNow}
              disabled={publishing || saving}
              className="w-full px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-black text-xs inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
            >
              {publishing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
              <span>{tr('เผยแพร่ตอนนี้เลย', 'Publish now')}</span>
            </button>
          </div>
        )}

        <div className="space-y-2" role="radiogroup">
          {options.map((option) => {
            const Icon = option.icon;
            const selected = mode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setMode(option.id)}
                className={`w-full text-left p-3.5 rounded-2xl border flex items-start gap-3 transition-all cursor-pointer ${
                  selected ? selectedClasses[option.tone] : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconClasses[option.tone]}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-black text-slate-900 dark:text-white">{option.title}</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">{option.detail}</span>
                </span>
                {selected && <Check className={`w-4 h-4 shrink-0 ${iconClasses[option.tone]}`} />}
              </button>
            );
          })}
        </div>

        {mode === 'extended' && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">{tr('ขยายเวลาถึง', 'Extend until')}</label>
            <DateTimeField value={extendedUntil} onChange={setExtendedUntil} presets="deadline" />
          </div>
        )}

        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
        </ModalSheetBody>

        <ModalSheetFooter>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold cursor-pointer"
          >
            {tr('ยกเลิก', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{tr('บันทึก', 'Save')}</span>
          </button>
        </ModalSheetFooter>
    </ModalSheet>
  );
}
