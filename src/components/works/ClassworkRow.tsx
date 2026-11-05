'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BellRing, Clock, Copy, Edit2, EyeOff, MessageCircle, Rocket, ShieldAlert, Tag, Trash2 } from 'lucide-react';
import type { Assignment } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import type { GradingCounts } from '@/lib/utils/gradingStatus';
import { isRetake } from '@/lib/utils/retake';
import { ActionMenu, type ActionMenuItem } from '@/components/works/ActionMenu';
import { MetricCells, Pill, RemindButton, WorkRowLayout } from '@/components/works/WorkBits';
import { acceptStatus, StatusButton } from '@/components/works/StatusBits';

/**
 * One assignment of a classroom's classwork list on a single line: kind and
 * title, acceptance status (tap to change), handed in / checked / progress,
 * "ตรวจงาน", and ⋯ for edit, copy, move group and delete. Put it inside an
 * `@container` so it folds to two lines when the list is narrow.
 */
export function ClassworkRow({
  assignment,
  counts,
  gradingHref,
  editHref,
  copyHref,
  onStatusClick,
  onDelete,
  onPublishNow,
  onMoveGroup,
  onRemind,
  onReannounce,
  leading,
  now,
  tag,
  className = '',
}: {
  assignment: Assignment;
  counts: GradingCounts;
  gradingHref: string;
  editHref?: string;
  copyHref?: string;
  onStatusClick?: () => void;
  onDelete?: () => void;
  onPublishNow?: () => void;
  onMoveGroup?: () => void;
  /** "ทวงงาน": the bot names who has not handed in (share popup when it cannot). */
  onRemind?: () => void;
  /** Post the work's link to the LINE group again. */
  onReannounce?: () => void;
  /** E.g. a drag handle. */
  leading?: ReactNode;
  now: number;
  /** Small label after the title, e.g. the category a draft will join. */
  tag?: string;
  className?: string;
}) {
  const { tr, language } = useLanguage();
  const th = language === 'th';
  const router = useRouter();
  const win = getAssignmentWindow(assignment, now);
  const hidden = win.isDraft || win.isScheduled;
  const status = acceptStatus({ assignment, window: win, counts }, th, language, now);
  const retake = isRetake(assignment);

  const menu: ActionMenuItem[] = [
    onStatusClick && { key: 'status', label: tr('เปลี่ยนสถานะการรับงาน', 'Change status'), icon: <Clock className="w-4 h-4" />, onSelect: onStatusClick },
    hidden && onPublishNow && { key: 'publish', label: tr('เผยแพร่ตอนนี้', 'Publish now'), icon: <Rocket className="w-4 h-4" />, onSelect: onPublishNow },
    !hidden && onRemind && {
      key: 'remind',
      label: tr('ทวงงาน', 'Remind'),
      hint: counts.notSubmitted > 0 ? tr(`ยังไม่ส่ง ${counts.notSubmitted}`, `${counts.notSubmitted} missing`) : undefined,
      icon: <BellRing className="w-4 h-4" />,
      disabled: !win.acceptsSubmissions || counts.notSubmitted === 0,
      onSelect: onRemind,
    },
    !hidden && onReannounce && {
      key: 'line',
      label: tr('ประกาศซ้ำใน LINE', 'Post to LINE again'),
      icon: <MessageCircle className="w-4 h-4" />,
      disabled: !win.acceptsSubmissions,
      onSelect: onReannounce,
    },
    editHref && { key: 'edit', label: tr('แก้ไข', 'Edit'), icon: <Edit2 className="w-4 h-4" />, onSelect: () => router.push(editHref) },
    copyHref && { key: 'copy', label: tr('คัดลอกไปห้องอื่น', 'Copy to classes'), icon: <Copy className="w-4 h-4" />, onSelect: () => router.push(copyHref) },
    onMoveGroup && {
      key: 'group',
      label: tr('ย้ายหมวดหมู่', 'Move to group'),
      hint: assignment.group_name || tr('ไม่ได้จัดกลุ่ม', 'Ungrouped'),
      icon: <Tag className="w-4 h-4" />,
      onSelect: onMoveGroup,
    },
    onDelete && { key: 'delete', label: tr('ลบ', 'Delete'), icon: <Trash2 className="w-4 h-4" />, danger: true, onSelect: onDelete },
  ].filter(Boolean) as ActionMenuItem[];

  return (
    <div
      className={`rounded-2xl border px-3 py-2 transition-colors ${
        hidden ? 'bg-slate-50 dark:bg-slate-900/60 border-dashed border-slate-300 dark:border-slate-700' : counts.pending > 0 ? 'bg-white dark:bg-slate-900 border-amber-300 dark:border-amber-800/70' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
      } ${className}`}
    >
      <WorkRowLayout
        lead={
          <span className="w-full min-w-0 flex items-center gap-1.5">
            {leading}
            <Pill
              tone={retake ? 'amber' : assignment.is_exam ? 'sky' : 'emerald'}
              className="shrink-0"
            >
              {retake ? tr(`สอบซ่อม · ${assignment.retake_student_ids?.length || 0}`, `Retake · ${assignment.retake_student_ids?.length || 0}`) : assignment.is_exam ? tr('ข้อสอบ', 'Quiz') : tr('การบ้าน', 'Homework')}
            </Pill>
            <Link
              href={gradingHref}
              draggable={false}
              title={assignment.title}
              className="min-w-0 truncate text-sm font-black text-slate-900 dark:text-white hover:text-amber-700 dark:hover:text-amber-400 transition-colors"
            >
              {assignment.title}
            </Link>
            {tag && (
              <span className="shrink-0 max-w-32 truncate px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-500 dark:text-slate-400" title={tag}>
                {tag}
              </span>
            )}
            {counts.flagged > 0 && (
              <Pill tone="rose" className="shrink-0">
                <ShieldAlert className="w-3 h-3" />
                {counts.flagged}
              </Pill>
            )}
          </span>
        }
        status={<StatusButton status={status} onClick={onStatusClick} />}
        metrics={
          hidden ? (
            <span className="text-[11px] font-semibold text-slate-400 inline-flex items-center gap-1">
              <EyeOff className="w-3.5 h-3.5" />
              {tr('นักเรียนยังไม่เห็น', 'Hidden from students')}
            </span>
          ) : (
            <MetricCells totals={counts} />
          )
        }
        action={
          hidden && onPublishNow ? (
            <button
              type="button"
              draggable={false}
              onClick={onPublishNow}
              className="h-9 px-3 rounded-xl text-xs font-black inline-flex items-center gap-1.5 whitespace-nowrap bg-sky-100 hover:bg-sky-200 dark:bg-sky-950/60 dark:hover:bg-sky-900/60 text-sky-800 dark:text-sky-200 cursor-pointer transition-colors"
            >
              <Rocket className="w-3.5 h-3.5" />
              {tr('เผยแพร่', 'Publish')}
            </button>
          ) : (
            <>
            {onRemind && <RemindButton missing={counts.notSubmitted} closed={!win.acceptsSubmissions} onClick={onRemind} />}
            <Link
              href={gradingHref}
              draggable={false}
              className={`h-9 px-3 rounded-xl text-xs font-black inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                counts.pending > 0
                  ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-sm shadow-amber-500/20'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
              }`}
            >
              {tr('ตรวจงาน', 'Grade')}
              {counts.pending > 0 && <span className="min-w-5 px-1 rounded-full bg-slate-950/15 text-[11px] tabular-nums text-center">{counts.pending}</span>}
            </Link>
            </>
          )
        }
        menu={menu.length > 0 ? <ActionMenu size="sm" label={tr(`ตัวเลือกของ ${assignment.title}`, `Options for ${assignment.title}`)} items={menu} /> : undefined}
      />
    </div>
  );
}
