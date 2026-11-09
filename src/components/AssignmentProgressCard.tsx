'use client';

import { isRetakeOf } from '@/lib/utils/retake';
import React, { useId, useState } from 'react';
import Link from 'next/link';
import { Calendar, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, Clock, Copy, Edit2, FilePen, Lock, Rocket, ShieldAlert, Trash2, Unlock } from 'lucide-react';
import { Collapse } from '@/components/Collapse';
import type { Assignment } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { AttachmentList } from '@/components/AssignmentAttachments';
import { assignmentAttachments } from '@/lib/utils/referenceWork';
import { ASSIGNMENT_STATUS_CLASSES, draftExpiresAt, getAssignmentStatus, getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { formatDateTime } from '@/lib/utils/datetime';
import type { GradingCounts } from '@/lib/utils/gradingStatus';
import type { AssignmentStatusTone } from '@/lib/utils/assignmentWindow';

/** Colour stripe across the top of the card, so the status reads at a glance. */
const STATUS_STRIPE: Record<AssignmentStatusTone, string> = {
  draft: 'bg-[repeating-linear-gradient(135deg,#cbd5e1_0_8px,transparent_8px_16px)] dark:bg-[repeating-linear-gradient(135deg,#475569_0_8px,transparent_8px_16px)]',
  scheduled: 'bg-sky-500',
  open: 'bg-emerald-500',
  late: 'bg-amber-500',
  closed: 'bg-rose-500',
};

/** Dot inside the status badge; it pulses while the work is taking submissions. */
const STATUS_DOT: Record<AssignmentStatusTone, string> = {
  draft: 'bg-slate-400',
  scheduled: 'bg-sky-500',
  open: 'bg-emerald-500',
  late: 'bg-amber-500',
  closed: 'bg-rose-500',
};

/** Graded / waiting for the teacher / not handed in, as one bar. */
export function GradingBar({ graded, pending, notSubmitted }: { graded: number; pending: number; notSubmitted: number }) {
  const total = graded + pending + notSubmitted || 1;
  return (
    <div className="flex w-full h-2 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(graded / total) * 100}%` }} />
      <div className="h-full bg-amber-400 transition-all" style={{ width: `${(pending / total) * 100}%` }} />
    </div>
  );
}

/**
 * One assignment with its submission and grading progress, shared by the
 * grading hub and the classroom classwork tab. Compact by default (status,
 * title, due date, progress and the grade button); "Details" unfolds the
 * counts, attachments and editing actions, which show only when their
 * handlers are given.
 */
export function AssignmentProgressCard({
  assignment,
  counts,
  gradingHref,
  classroomName,
  editHref,
  copyHref,
  onStatusClick,
  onDelete,
  onPublishNow,
  leading,
  footer,
  className = '',
}: {
  assignment: Assignment;
  counts: GradingCounts;
  gradingHref: string;
  /** Shown as a chip when the list mixes classrooms. */
  classroomName?: string;
  editHref?: string;
  /** Opens the editor with this work filled in, to create it in other classrooms. */
  copyHref?: string;
  /** Makes the status badge a button that opens the "accept work" settings. */
  onStatusClick?: () => void;
  onDelete?: () => void;
  /** Release scheduled work / a draft right away. */
  onPublishNow?: () => void;
  /** E.g. a drag handle, before the chips. */
  leading?: React.ReactNode;
  /** E.g. the classwork group switcher, under the main button. */
  footer?: React.ReactNode;
  className?: string;
}) {
  const { language } = useLanguage();
  const th = language === 'th';
  const { totalStudents, handedIn, graded, scoredMissing, pending, checkable, notSubmitted, flagged } = counts;
  const win = getAssignmentWindow(assignment);
  const status = getAssignmentStatus(win, assignment.is_exam, language);
  const StatusIcon =
    status.tone === 'closed' ? Lock : status.tone === 'late' ? Unlock : status.tone === 'draft' ? FilePen : status.tone === 'scheduled' ? CalendarClock : Clock;
  const deadline = win.deadline != null ? formatDateTime(new Date(win.deadline).toISOString(), language) : null;
  const done = pending === 0 && graded > 0;
  const attachments = assignmentAttachments(assignment);

  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  const statusBadgeClass = `ml-auto px-2.5 py-1 rounded-full border text-xs font-black inline-flex items-center gap-1.5 ${ASSIGNMENT_STATUS_CLASSES[status.tone]}`;
  const statusContent = (
    <>
      <span className="relative flex w-2 h-2">
        {status.tone === 'open' && <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-75 animate-ping" />}
        <span className={`relative w-2 h-2 rounded-full ${STATUS_DOT[status.tone]}`} />
      </span>
      <StatusIcon className="w-3.5 h-3.5" />
      {status.label}
    </>
  );
  const actionClass = 'inline-flex items-center gap-1.5 px-2.5 h-9 sm:h-8 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 transition-colors';

  return (
    <div
      className={`relative overflow-hidden rounded-3xl border p-3.5 pt-4 sm:p-4 sm:pt-5 flex flex-col gap-3 shadow-xs transition-colors ${
        status.tone === 'draft' ? 'bg-slate-50 dark:bg-slate-900/60' : 'bg-white dark:bg-slate-900'
      } ${
        pending > 0 ? 'border-amber-300 dark:border-amber-800/70' : status.tone === 'draft' ? 'border-dashed border-slate-300 dark:border-slate-700' : 'border-slate-200 dark:border-slate-800'
      } ${className}`}
    >
      <div aria-hidden className={`absolute inset-x-0 top-0 h-1.5 ${STATUS_STRIPE[status.tone]}`} />

      {/* Always shown: where it belongs, what it is, whether it takes work, and how grading stands */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {leading}
          {classroomName && (
            <span className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-[11px] max-w-40 truncate">
              {classroomName}
            </span>
          )}
          <span
            className={`px-2 py-0.5 rounded-lg text-[11px] font-bold ${
              isRetakeOf(assignment)
                ? 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300'
                : assignment.is_exam
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
            }`}
          >
            {isRetakeOf(assignment)
              ? th ? 'สอบซ่อม' : 'Retake'
              : assignment.is_exam ? (th ? 'ข้อสอบ' : 'Quiz') : th ? 'การบ้าน/ใบงาน' : 'Assignment'}
          </span>
          {onStatusClick ? (
            <button
              type="button"
              draggable={false}
              onClick={onStatusClick}
              className={`${statusBadgeClass} cursor-pointer hover:brightness-95 dark:hover:brightness-125 transition`}
              title={`${status.note ? `${status.note} • ` : ''}${th ? 'กดเพื่อเปลี่ยนสถานะการรับงาน' : 'Change whether it accepts work'}`}
            >
              {statusContent}
              <ChevronDown className="w-3 h-3" />
            </button>
          ) : (
            <span className={statusBadgeClass} title={status.note || undefined}>
              {statusContent}
            </span>
          )}
        </div>

        <h3 className={`text-sm sm:text-base font-black text-slate-900 dark:text-white leading-snug wrap-break-word ${expanded ? 'line-clamp-3' : 'line-clamp-1'}`}>
          {assignment.title}
        </h3>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          {deadline && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {assignment.is_exam ? (th ? 'ปิดรับ' : 'Closes') : th ? 'ส่ง' : 'Due'} {deadline}
            </span>
          )}
          <span>· {th ? 'ส่งแล้ว' : 'In'} {handedIn}/{totalStudents}</span>
          {pending > 0 ? (
            <span className="px-1.5 py-px rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold">
              {th ? `รอตรวจ ${pending}` : `${pending} to grade`}
            </span>
          ) : done ? (
            <span className="inline-flex items-center gap-0.5 font-bold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-3 h-3" />
              {th ? 'ตรวจครบ' : 'All graded'}
            </span>
          ) : null}
          {flagged > 0 && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold">
              <ShieldAlert className="w-3 h-3" />
              {flagged}
            </span>
          )}
          {onPublishNow && (
            <button
              type="button"
              draggable={false}
              onClick={onPublishNow}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 hover:bg-amber-600 text-slate-950 text-[10px] font-black cursor-pointer transition-colors"
              title={th ? 'สอนถึงหัวข้อนี้แล้ว — เปิดให้นักเรียนทำได้ทันที' : 'Release it to students now'}
            >
              <Rocket className="w-3 h-3" />
              {th ? 'เผยแพร่ตอนนี้' : 'Publish now'}
            </button>
          )}
        </div>

        {!win.isDraft && !win.isScheduled && <GradingBar graded={graded} pending={pending} notSubmitted={notSubmitted} />}
      </div>

      {/* Details: folded by default to keep long lists short */}
      <Collapse open={expanded}>
        <div id={detailsId} className="space-y-3 pt-1">
          {(win.isScheduled || win.isDraft) && (
            <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
              {win.isDraft
                ? `${th ? 'ฉบับร่าง' : 'Draft'}${draftExpiresAt(assignment) ? ` • ${th ? 'ลบอัตโนมัติ' : 'auto-deletes'} ${formatDateTime(draftExpiresAt(assignment), language)}` : ''}`
                : assignment.publish_at
                ? `${th ? 'เผยแพร่' : 'Publishes'}: ${formatDateTime(assignment.publish_at, language)}`
                : ''}
            </p>
          )}

          {/* Teacher's attachments (links, Drive, images, PDFs) */}
          <AttachmentList attachments={attachments} size="sm" />

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">{th ? 'ส่งแล้ว' : 'Handed in'}</span>
              <span className="text-sm font-black text-slate-900 dark:text-white">
                {handedIn}
                <span className="text-[10px] font-semibold text-slate-400">/{totalStudents}</span>
              </span>
            </div>
            <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">{th ? 'ยังไม่ส่ง' : 'Missing'}</span>
              <span className={`text-sm font-black ${notSubmitted > 0 ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>{notSubmitted}</span>
            </div>
            <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">{th ? 'ตรวจแล้ว' : 'Graded'}</span>
              <span className={`text-sm font-black ${done ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
                {graded}
                <span className="text-[10px] font-semibold text-slate-400">/{checkable}</span>
              </span>
            </div>
          </div>
          {scoredMissing > 0 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {th ? `บันทึกว่าไม่ส่งงาน (0 คะแนน) ${scoredMissing} คน` : `${scoredMissing} marked as no submission (0)`}
            </p>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{th ? 'ตรวจแล้ว' : 'Graded'}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />{th ? 'รอตรวจ' : 'To grade'}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700" />{th ? 'ยังไม่ส่ง' : 'Missing'}</span>
          </div>

          {(editHref || copyHref || onDelete) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {editHref && (
                <Link href={editHref} draggable={false} className={`${actionClass} hover:text-amber-700 hover:border-amber-400`}>
                  <Edit2 className="w-3.5 h-3.5" />
                  {th ? 'แก้ไข' : 'Edit'}
                </Link>
              )}
              {copyHref && (
                <Link href={copyHref} draggable={false} className={`${actionClass} hover:text-sky-700 hover:border-sky-400`}>
                  <Copy className="w-3.5 h-3.5" />
                  {th ? 'คัดลอกไปห้องอื่น' : 'Copy to classrooms'}
                </Link>
              )}
              {onDelete && (
                <button type="button" draggable={false} onClick={onDelete} className={`${actionClass} ml-auto hover:text-rose-700 hover:border-rose-300 cursor-pointer`}>
                  <Trash2 className="w-3.5 h-3.5" />
                  {th ? 'ลบ' : 'Delete'}
                </button>
              )}
            </div>
          )}
          {footer}
        </div>
      </Collapse>

      <div className="flex items-center gap-2">
        <Link
          href={gradingHref}
          draggable={false}
          className={`flex-1 min-w-0 h-10 rounded-2xl font-black text-xs flex items-center justify-center gap-1.5 transition-colors ${
            pending > 0
              ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md shadow-amber-500/20'
              : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200'
          }`}
        >
          <span className="truncate">
            {pending > 0 ? (th ? `ตรวจงาน (${pending} คน)` : `Grade (${pending})`) : th ? 'ตรวจงาน' : 'Grade'}
          </span>
          <ChevronRight className="w-4 h-4 shrink-0" />
        </Link>
        <button
          type="button"
          draggable={false}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={expanded ? (th ? 'ย่อรายละเอียด' : 'Hide details') : th ? 'ดูรายละเอียด' : 'Show details'}
          title={expanded ? (th ? 'ย่อรายละเอียด' : 'Hide details') : th ? 'ดูรายละเอียด แก้ไข คัดลอก' : 'Details, edit, copy'}
          className="shrink-0 h-10 px-3 rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 text-slate-500 dark:text-slate-400 hover:text-amber-700 dark:hover:text-amber-300 hover:ring-amber-400 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer transition-colors"
        >
          <span className="hidden sm:inline">{expanded ? (th ? 'ย่อ' : 'Less') : th ? 'รายละเอียด' : 'Details'}</span>
          <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  );
}
