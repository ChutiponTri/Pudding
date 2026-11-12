'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, PencilLine, UserMinus, Users } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { formatDateTime } from '@/lib/utils/datetime';
import { isGraded, isHandedIn, needsGrading } from '@/lib/utils/gradingStatus';
import type { Submission, User, WorkGroup, WorkGroupsView } from '@/types/database';

/**
 * งานกลุ่ม on the teacher's grading page: one card per group (who is in it,
 * whether and when it handed in, its score) instead of one row per student.
 * A card opens to show its members with their own controls. Grading a group
 * grades every member (the server copies the score).
 */

export type GroupRosterRow = { key: string; student?: Partial<User>; submission: Submission | null; rosterId?: string };
export type GroupEntry = { group: WorkGroup; members: GroupRosterRow[]; submission: Submission | null };

const fullName = (s?: { first_name?: string; last_name?: string } | null) => `${s?.first_name || ''} ${s?.last_name || ''}`.trim();

/** Matches each group to its members' roster rows and picks the submission that stands for the group. */
export function groupEntries(view: WorkGroupsView, rows: GroupRosterRow[]): { entries: GroupEntry[]; ungrouped: GroupRosterRow[] } {
  const rowOf = (id: string) => rows.find((row) => row.rosterId === id || row.student?.id === id || row.student?.line_uid === id);
  const used = new Set<string>();
  const entries = view.groups.map((group) => {
    const members = group.member_ids.flatMap((id) => {
      const row = rowOf(id);
      if (!row) return [];
      used.add(row.key);
      return [row];
    });
    const handed = members.map((m) => m.submission).filter((sub): sub is Submission => !!sub && isHandedIn(sub));
    // The member who handed in, else any member's copy (they are the same work).
    const submission = handed.find((sub) => sub.student_id === group.submitted_by) || handed[0] || null;
    return { group, members, submission };
  });
  return { entries, ungrouped: rows.filter((row) => !used.has(row.key)) };
}

export function GroupRoster({
  view,
  entries,
  ungrouped,
  th,
  canGrade,
  canManage,
  maxScore,
  onOpen,
  onRemoveMember,
  memberActions,
}: {
  view: WorkGroupsView;
  entries: GroupEntry[];
  ungrouped: GroupRosterRow[];
  th: boolean;
  canGrade: boolean;
  /** Teacher (not researcher): may take a student out of a group. */
  canManage: boolean;
  maxScore: number;
  onOpen: (sub: Submission) => void;
  /** handedIn: the group already handed in (the student's copy of the work is removed too). */
  onRemoveMember: (studentId: string, name: string, handedIn: boolean) => Promise<void>;
  /** The page's own per-student controls (allow edit / hand in, no submission). */
  memberActions?: (row: GroupRosterRow) => React.ReactNode;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<string | null>(null);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const nameOf = (id?: string | null) => {
    const s = view.students.find((st) => st.id === id);
    return fullName(s) || (th ? 'นักเรียน' : 'Student');
  };

  const memberRow = (row: GroupRosterRow, group?: WorkGroup) => {
    const groupId = group?.id;
    const sub = row.submission;
    const name = fullName(row.student) || (th ? 'ไม่พบข้อมูลนักเรียน' : 'Unknown student');
    const studentId = row.rosterId || row.student?.id;
    return (
      <li key={row.key} className="flex items-center gap-2.5 px-3 sm:px-4 py-2.5">
        <Avatar zoom src={row.student?.avatar_url} firstName={row.student?.first_name} lastName={row.student?.last_name} className="w-8 h-8 text-[10px] shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-slate-900 dark:text-white truncate">{name}</p>
          <p className="text-[10px] text-slate-400 font-mono truncate">
            {row.student?.student_id ? `${th ? 'รหัส' : 'ID'} ${row.student.student_id}` : th ? 'ไม่มีรหัสนักเรียน' : 'No student ID'}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-bold ${
            sub && isHandedIn(sub)
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : sub && isGraded(sub)
              ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          {sub && isHandedIn(sub) ? (th ? 'ส่งแล้ว' : 'Handed in') : sub && isGraded(sub) ? (th ? 'ไม่ส่งงาน' : 'No submission') : th ? 'ยังไม่ส่ง' : 'Not submitted'}
        </span>
        {memberActions && <span className="shrink-0 flex items-center gap-1.5">{memberActions(row)}</span>}
        {groupId && canManage && studentId && (
          <button
            type="button"
            title={th ? 'นำออกจากกลุ่ม' : 'Remove from group'}
            aria-label={th ? `นำ ${name} ออกจากกลุ่ม` : `Remove ${name} from the group`}
            disabled={removing === studentId}
            onClick={async () => {
              setRemoving(studentId);
              try {
                await onRemoveMember(studentId, name, !!group?.submitted_at);
              } finally {
                setRemoving(null);
              }
            }}
            className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer disabled:opacity-50"
          >
            {removing === studentId ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserMinus className="w-4 h-4" />}
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="p-2.5 sm:p-4 space-y-2.5">
      {entries.length === 0 && (
        <p className="py-6 text-center text-xs text-slate-400">{th ? 'ยังไม่มีกลุ่ม — นักเรียนจะเลือกกลุ่มเองก่อนส่งงาน' : 'No groups yet — students form their groups before handing in'}</p>
      )}
      {entries.map(({ group, members, submission: sub }) => {
        const expanded = open.has(group.id);
        const graded = !!sub && isGraded(sub);
        const toGrade = !!sub && needsGrading(sub);
        return (
          <section
            key={group.id}
            className={`rounded-2xl border overflow-hidden transition-colors ${
              toGrade ? 'border-amber-300 dark:border-amber-800' : 'border-slate-200 dark:border-slate-800'
            } bg-white dark:bg-slate-900`}
          >
            <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3">
              <button
                type="button"
                onClick={() => toggle(group.id)}
                aria-expanded={expanded}
                className="min-w-0 flex-1 flex items-center gap-2.5 sm:gap-3 text-left cursor-pointer"
              >
                <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                <span className="flex -space-x-2 shrink-0">
                  {members.slice(0, 4).map((m) => (
                    <Avatar
                      key={m.key}
                      src={m.student?.avatar_url}
                      firstName={m.student?.first_name}
                      lastName={m.student?.last_name}
                      className="w-8 h-8 text-[10px] ring-2 ring-white dark:ring-slate-900"
                    />
                  ))}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-black text-slate-900 dark:text-white">
                    <span className="truncate">{group.name}</span>
                    <span className="shrink-0 text-[11px] font-semibold text-slate-400 tabular-nums">
                      {members.length}/{view.groupSize} {th ? 'คน' : ''}
                    </span>
                  </span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {sub
                      ? `${th ? 'ส่งโดย' : 'By'} ${nameOf(group.submitted_by || sub.student_id)}${sub.submitted_at ? ` · ${formatDateTime(sub.submitted_at, th ? 'th' : 'en')}` : ''}${sub.status === 'late' ? (th ? ' · ส่งช้า' : ' · late') : ''}`
                      : members.map((m) => m.student?.first_name).filter(Boolean).join(', ')}
                  </span>
                </span>
              </button>
              {sub ? (
                graded ? (
                  <span className="shrink-0 inline-flex items-baseline gap-0.5 px-2 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-black">
                    <span className="text-[13px] tabular-nums">{sub.total_score}</span>
                    <span className="text-[10px] font-semibold opacity-70">/{sub.max_total_score || maxScore}</span>
                  </span>
                ) : (
                  <span className="shrink-0 max-sm:hidden h-7 inline-flex items-center px-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-[11px] font-bold">
                    {th ? 'รอตรวจ' : 'To grade'}
                  </span>
                )
              ) : (
                <span className="shrink-0 h-6 inline-flex items-center px-2 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  {th ? 'ยังไม่ส่ง' : 'Not submitted'}
                </span>
              )}
              {sub && (
                <button
                  type="button"
                  disabled={!canGrade}
                  onClick={() => onOpen(sub)}
                  className={`shrink-0 h-8 px-2.5 sm:px-3 rounded-xl text-[11px] sm:text-xs font-bold flex items-center gap-1 cursor-pointer active:scale-[0.97] transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                    graded
                      ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 ring-2 ring-amber-400 dark:ring-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                      : 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-xs'
                  }`}
                >
                  {graded && <PencilLine className="w-3.5 h-3.5" />}
                  <span>{graded ? (th ? 'แก้คะแนน' : 'Edit') : th ? 'ตรวจ' : 'Grade'}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {expanded && (
              <ul className="border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 bg-slate-50/50 dark:bg-slate-950/30 animate-in fade-in">
                {members.map((row) => memberRow(row, group))}
              </ul>
            )}
          </section>
        );
      })}

      {ungrouped.length > 0 && (
        <section className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 overflow-hidden">
          <button
            type="button"
            onClick={() => toggle('__none')}
            aria-expanded={open.has('__none')}
            className="w-full flex items-center gap-2.5 px-3 sm:px-4 py-3 text-left cursor-pointer"
          >
            <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open.has('__none') ? '' : '-rotate-90'}`} />
            <Users className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{th ? 'ยังไม่มีกลุ่ม' : 'Not in a group'}</span>
            <span className="text-[11px] font-semibold text-slate-400 tabular-nums">{ungrouped.length} {th ? 'คน' : ''}</span>
          </button>
          {open.has('__none') && (
            <ul className="border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">{ungrouped.map((row) => memberRow(row))}</ul>
          )}
        </section>
      )}
    </div>
  );
}
