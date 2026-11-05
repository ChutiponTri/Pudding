'use client';

import React from 'react';
import { CheckCircle2, ChevronDown, Clock, EyeOff, Layers, UserX } from 'lucide-react';
import type { Assignment } from '@/types/database';
import type { GradingCounts } from '@/lib/utils/gradingStatus';
import { isAssignmentPublished } from '@/lib/utils/assignmentWindow';

export type GroupChipTone = 'amber' | 'rose' | 'slate' | 'emerald' | 'sky';
/** `short` replaces `label` on phones (the full label stays as the tooltip). */
export type GroupChip = { tone: GroupChipTone; label: string; short?: string; icon?: React.ReactNode };

const CHIP_CLASSES: Record<GroupChipTone, string> = {
  amber: 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300',
  rose: 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300',
  slate: 'bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  emerald: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300',
  sky: 'bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300',
};

/**
 * Stable key for an assignment's category: its group name, or the default
 * group (exam / general) it falls into. Independent of the UI language, so
 * a remembered fold survives switching languages.
 */
export const assignmentGroupKey = (a: Pick<Assignment, 'group_name' | 'is_exam'>) =>
  a.group_name?.trim() || (a.is_exam ? '__exam' : '__general');

export const assignmentGroupLabel = (key: string, th: boolean) =>
  key === '__exam' ? (th ? 'ข้อสอบ' : 'Exam') : key === '__general' ? (th ? 'งานทั่วไป' : 'General') : key;

/** What is still open across a category's work, for the teacher. */
export function teacherGroupChips(
  items: Array<{ assignment: Pick<Assignment, 'publish_at'>; counts: GradingCounts }>,
  th: boolean
): GroupChip[] {
  let pending = 0;
  let graded = 0;
  let checkable = 0;
  let missing = 0;
  let missingTasks = 0;
  let unpublished = 0;
  for (const { assignment, counts } of items) {
    if (!isAssignmentPublished(assignment)) {
      unpublished++;
      continue;
    }
    pending += counts.pending;
    graded += counts.graded;
    checkable += counts.checkable;
    if (counts.notSubmitted > 0) {
      missing += counts.notSubmitted;
      missingTasks++;
    }
  }
  const chips: GroupChip[] = [];
  if (pending > 0) {
    chips.push({
      tone: 'amber',
      icon: <Clock className="w-3 h-3" />,
      label: th ? `ครูกำลังตรวจ ${graded}/${checkable} · รอตรวจ ${pending}` : `Grading ${graded}/${checkable} · ${pending} to grade`,
      short: th ? `ตรวจ ${graded}/${checkable} · รอ ${pending}` : `${graded}/${checkable} · ${pending} to grade`,
    });
  }
  if (missing > 0) {
    chips.push({
      tone: 'rose',
      icon: <UserX className="w-3 h-3" />,
      label: th ? `นักเรียนยังส่งไม่ครบ ${missing} คน (${missingTasks} งาน)` : `Not all handed in: ${missing} missing (${missingTasks} tasks)`,
      short: th ? `ค้างส่ง ${missing} · ${missingTasks} งาน` : `${missing} missing · ${missingTasks}`,
    });
  }
  if (unpublished > 0) {
    chips.push({
      tone: 'slate',
      icon: <EyeOff className="w-3 h-3" />,
      label: th ? `ยังไม่เผยแพร่ ${unpublished}` : `${unpublished} unpublished`,
    });
  }
  if (chips.length === 0 && items.length > 0) {
    chips.push({
      tone: 'emerald',
      icon: <CheckCircle2 className="w-3 h-3" />,
      label: th ? 'ส่งครบ ตรวจครบแล้ว' : 'All in and graded',
    });
  }
  return chips;
}

/**
 * The clickable title row of a collapsible assignment category: name, count,
 * status chips (always shown, so a folded category still says what is left)
 * and a chevron.
 */
export function AssignmentGroupHeader({
  title,
  count,
  open,
  onToggle,
  chips = [],
  icon,
  className = '',
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  chips?: GroupChip[];
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      draggable={false}
      onClick={onToggle}
      aria-expanded={open}
      className={`group/grouphead w-full flex flex-wrap items-center gap-x-2 gap-y-1.5 px-1 py-1 text-left rounded-xl cursor-pointer ${className}`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-600 shrink-0">
          {icon ?? <Layers className="w-4 h-4" />}
        </span>
        <span className="font-black text-sm text-slate-900 dark:text-white truncate">
          {title} <span className="text-slate-400 font-normal">({count})</span>
        </span>
      </span>
      <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
        {chips.map((chip) => (
          <span
            key={chip.label}
            title={chip.short ? chip.label : undefined}
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${CHIP_CLASSES[chip.tone]}`}
          >
            {chip.icon}
            {chip.short ? (
              <>
                <span className="sm:hidden">{chip.short}</span>
                <span className="hidden sm:inline">{chip.label}</span>
              </>
            ) : (
              chip.label
            )}
          </span>
        ))}
        <span className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-slate-500 dark:text-slate-400 bg-white/80 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 group-hover/grouphead:ring-amber-400 group-hover/grouphead:text-amber-600 transition-colors">
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
        </span>
      </span>
    </button>
  );
}
