'use client';

import React from 'react';
import Link from 'next/link';
import { Calendar, CheckCircle2, ChevronDown, ChevronRight, Clock, Edit2, Inbox, Lock, Rocket, ShieldAlert, Trash2, Unlock } from 'lucide-react';
import type { Assignment } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { ReferenceWorkLink } from '@/components/ReferenceWorkLink';
import { ASSIGNMENT_STATUS_CLASSES, draftExpiresAt, getAssignmentStatus, getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { formatDateTime } from '@/lib/utils/datetime';
import type { GradingCounts } from '@/lib/utils/gradingStatus';

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
 * grading hub and the classroom classwork tab. Editing actions show only when
 * their handlers are given.
 */
export function AssignmentProgressCard({
  assignment,
  counts,
  gradingHref,
  classroomName,
  editHref,
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
  const StatusIcon = status.tone === 'closed' ? Lock : status.tone === 'late' ? Unlock : Clock;
  const deadline = win.deadline != null ? formatDateTime(new Date(win.deadline).toISOString(), language) : null;
  const done = pending === 0 && graded > 0;
  const hasReference = !!(assignment.sample_work_url || assignment.sample_work_title);

  const statusBadgeClass = `ml-auto px-2 py-0.5 rounded-full border text-[11px] font-bold inline-flex items-center gap-1 ${ASSIGNMENT_STATUS_CLASSES[status.tone]}`;
  const statusContent = (
    <>
      <StatusIcon className="w-3 h-3" />
      {status.label}
    </>
  );

  return (
    <div
      className={`bg-white dark:bg-slate-900 rounded-3xl border p-4 sm:p-5 flex flex-col gap-4 shadow-xs transition-colors ${
        pending > 0 ? 'border-amber-300 dark:border-amber-800/70' : status.tone === 'draft' ? 'border-dashed border-slate-300 dark:border-slate-700' : 'border-slate-200 dark:border-slate-800'
      } ${className}`}
    >
      {/* Where it belongs, what it is, and whether it still takes work */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {leading}
          {classroomName && (
            <span className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-[11px]">
              {classroomName}
            </span>
          )}
          <span
            className={`px-2 py-0.5 rounded-lg text-[11px] font-bold ${
              assignment.is_exam
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
            }`}
          >
            {assignment.is_exam ? (th ? 'ข้อสอบ' : 'Quiz') : th ? 'การบ้าน/ใบงาน' : 'Assignment'}
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

        <div className="flex items-start gap-2">
          <h3 className="flex-1 min-w-0 text-base font-black text-slate-900 dark:text-white leading-snug line-clamp-2 break-words">{assignment.title}</h3>
          {(editHref || onDelete) && (
            <div className="flex items-center gap-1 shrink-0">
              {editHref && (
                <Link
                  href={editHref}
                  draggable={false}
                  className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-amber-600 hover:border-amber-400 transition-colors"
                  title={th ? 'แก้ไขงาน/ข้อสอบ (ทุกส่วน)' : 'Edit'}
                  aria-label={th ? 'แก้ไขงาน/ข้อสอบ' : 'Edit'}
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </Link>
              )}
              {onDelete && (
                <button
                  type="button"
                  draggable={false}
                  onClick={onDelete}
                  className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-600 hover:border-rose-300 transition-colors cursor-pointer"
                  title={th ? 'ลบงาน/ข้อสอบ' : 'Delete'}
                  aria-label={th ? 'ลบงาน/ข้อสอบ' : 'Delete'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          {deadline && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {assignment.is_exam ? (th ? 'ปิดรับ' : 'Closes') : th ? 'กำหนดส่ง' : 'Due'} {deadline}
            </span>
          )}
          <span>· {th ? 'เต็ม' : 'Max'} {assignment.total_points || 20} {th ? 'คะแนน' : 'pts'}</span>
        </div>

        {(win.isScheduled || win.isDraft) && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {win.isDraft ? (
              <span className="font-bold text-slate-600 dark:text-slate-300">
                {th ? 'ฉบับร่าง' : 'Draft'}
                {draftExpiresAt(assignment) ? ` • ${th ? 'ลบอัตโนมัติ' : 'auto-deletes'} ${formatDateTime(draftExpiresAt(assignment), language)}` : ''}
              </span>
            ) : (
              assignment.publish_at && (
                <span className="font-bold text-sky-700 dark:text-sky-400">
                  {th ? 'เผยแพร่' : 'Publishes'}: {formatDateTime(assignment.publish_at, language)}
                </span>
              )
            )}
            {onPublishNow && (
              <button
                type="button"
                draggable={false}
                onClick={onPublishNow}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-600 hover:bg-sky-700 text-white text-[10px] font-black cursor-pointer transition-colors"
                title={th ? 'สอนถึงหัวข้อนี้แล้ว — เปิดให้นักเรียนทำได้ทันที' : 'Release it to students now'}
              >
                <Rocket className="w-3 h-3" />
                {th ? 'เผยแพร่ตอนนี้' : 'Publish now'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Teacher's reference work (link or uploaded file) */}
      {hasReference && <ReferenceWorkLink assignment={assignment} preview />}

      {/* Grading state, in words */}
      <div
        className={`px-3 py-2.5 rounded-2xl flex items-center gap-2 text-xs font-bold ${
          pending > 0
            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
            : done
            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
            : 'bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400'
        }`}
      >
        {pending > 0 ? <Clock className="w-4 h-4 shrink-0" /> : done ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <Inbox className="w-4 h-4 shrink-0" />}
        <span className="min-w-0">
          {pending > 0
            ? th ? `รอตรวจ ${pending} คน` : `${pending} waiting to be graded`
            : done
            ? scoredMissing > 0
              ? th ? `ตรวจครบแล้ว · ให้คะแนนคนไม่ส่ง ${scoredMissing} คน` : `All checked · ${scoredMissing} missing scored`
              : th ? 'ตรวจครบทุกคนที่ส่งแล้ว' : 'Every submission is graded'
            : th ? 'ยังไม่มีนักเรียนส่งงาน' : 'No one has handed in yet'}
        </span>
        {flagged > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[10px]">
            <ShieldAlert className="w-3 h-3" />
            {th ? `สลับจอ ${flagged}` : `${flagged} flagged`}
          </span>
        )}
      </div>

      {/* Who handed in and who has been graded */}
      <div className="space-y-2">
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
        <GradingBar graded={graded} pending={pending} notSubmitted={notSubmitted} />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{th ? 'ตรวจแล้ว' : 'Graded'}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />{th ? 'รอตรวจ' : 'To grade'}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700" />{th ? 'ยังไม่ส่ง' : 'Missing'}</span>
        </div>
      </div>

      <div className="mt-auto space-y-2">
        <Link
          href={gradingHref}
          draggable={false}
          className={`w-full py-3 rounded-2xl font-black text-xs flex items-center justify-center gap-2 transition-colors ${
            pending > 0
              ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md shadow-amber-500/20'
              : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200'
          }`}
        >
          <span>
            {pending > 0
              ? th ? `ตรวจงาน (${pending} คน)` : `Grade (${pending})`
              : th ? 'ดูรายชื่อ & คะแนน' : 'View roster & scores'}
          </span>
          <ChevronRight className="w-4 h-4" />
        </Link>
        {footer}
      </div>
    </div>
  );
}
