"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, LogOut, Search, UserPlus, Users, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { dataService } from "@/lib/supabase/dataService";
import type { WorkGroup, WorkGroupStudent, WorkGroupsView } from "@/types/database";

/**
 * งานกลุ่ม on the student's LIFF page: pick a group before working on the
 * homework (join one with room, or start one with chosen classmates), and the
 * banner above the work showing the group. Classmates already in a group
 * cannot be picked again; the server checks it once more when saving.
 */

const CARD = "rounded-3xl bg-white dark:bg-slate-900 ring-1 ring-slate-200/70 dark:ring-slate-800 shadow-sm";
const nameOf = (s?: WorkGroupStudent) => (s ? `${s.first_name || ""} ${s.last_name || ""}`.trim() || "นักเรียน" : "นักเรียน");
const errorText = (err: unknown) => (err instanceof Error && err.message ? err.message : "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");

function Members({ group, view, compact = false, meLabel = "ฉัน" }: { group: WorkGroup; view: WorkGroupsView; compact?: boolean; meLabel?: string }) {
  const byId = new Map(view.students.map((s) => [s.id, s]));
  return (
    <div className="flex flex-wrap gap-1.5">
      {group.member_ids.map((id) => {
        const s = byId.get(id);
        return (
          <span
            key={id}
            className={`inline-flex items-center gap-1.5 pl-0.5 pr-2.5 h-7 rounded-full text-xs font-semibold ${
              id === view.me ? "bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-200" : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
            }`}
          >
            <Avatar src={s?.avatar_url} firstName={s?.first_name} lastName={s?.last_name} className="w-6 h-6 text-[9px]" />
            <span className={compact ? "max-w-20 truncate" : "max-w-32 truncate"}>{id === view.me ? meLabel : s?.first_name || nameOf(s)}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Classmates to add: everyone not in a group yet; those in a group are shown greyed with their group. */
function ClassmateSheet({
  view,
  room,
  title,
  confirmLabel,
  withName = false,
  onConfirm,
  onClose,
}: {
  view: WorkGroupsView;
  /** How many more may be picked. */
  room: number;
  title: string;
  confirmLabel: (count: number) => string;
  withName?: boolean;
  onConfirm: (ids: string[], name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const groupOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of view.groups) for (const id of g.member_ids) map.set(id, g.name);
    return map;
  }, [view.groups]);
  const q = query.trim().toLowerCase();
  const classmates = view.students
    .filter((s) => s.id !== view.me)
    .filter((s) => !q || nameOf(s).toLowerCase().includes(q))
    // Free classmates first, then by name.
    .sort((a, b) => Number(groupOf.has(a.id)) - Number(groupOf.has(b.id)) || nameOf(a).localeCompare(nameOf(b), "th"));
  const full = picked.length >= room;

  const toggle = (id: string) => setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : full ? list : [...list, id]));
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(picked, name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-70 flex items-end sm:items-center justify-center bg-black/50 animate-in fade-in" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[88dvh] flex flex-col bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-xl animate-in slide-in-from-bottom-6 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="px-4 pt-4 pb-3 space-y-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
            <button type="button" onClick={onClose} disabled={busy} aria-label="ปิด" className="w-9 h-9 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
          {withName && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="ชื่อกลุ่ม (ไม่ใส่ก็ได้)"
              className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 text-sm text-slate-900 dark:text-white focus:outline-hidden focus:ring-violet-400"
            />
          )}
          <label className="relative block">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาชื่อเพื่อน"
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-slate-50 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 text-sm text-slate-900 dark:text-white focus:outline-hidden focus:ring-violet-400"
            />
          </label>
          <p className={`text-xs font-semibold ${full ? "text-amber-600 dark:text-amber-400" : "text-slate-500"}`}>
            {room > 0 ? `เลือกแล้ว ${picked.length}/${room} คน` : "กลุ่มเต็มแล้ว"}
          </p>
        </div>
        <ul className="flex-1 overflow-y-auto px-2 py-2">
          {classmates.length === 0 && <li className="py-8 text-center text-sm text-slate-400">ไม่พบเพื่อน</li>}
          {classmates.map((s) => {
            const taken = groupOf.get(s.id);
            const on = picked.includes(s.id);
            const disabled = !!taken || (!on && full);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={on}
                  onClick={() => toggle(s.id)}
                  className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-2xl text-left transition-colors ${
                    on ? "bg-violet-50 dark:bg-violet-950/50" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                  } ${disabled ? "opacity-45 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <Avatar src={s.avatar_url} firstName={s.first_name} lastName={s.last_name} className="w-9 h-9 text-[11px] shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 dark:text-white truncate">{nameOf(s)}</span>
                    {taken && <span className="block text-[11px] text-slate-500">อยู่ {taken} แล้ว</span>}
                  </span>
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                      on ? "bg-brand text-white" : "ring-2 ring-slate-200 dark:ring-slate-700"
                    }`}
                  >
                    {on && <Check className="w-4 h-4" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="p-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={confirm}
            disabled={busy || (!withName && picked.length === 0)}
            className="w-full h-12 rounded-2xl bg-brand hover:bg-brand-dark text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel(picked.length)}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shown instead of the work until the student is in a group. */
export function WorkGroupPicker({
  assignmentId,
  view,
  onChange,
  proxy,
}: {
  assignmentId: string;
  view: WorkGroupsView;
  /** Borrowed phone: picking for this classmate. */
  proxy?: { number: string; name: string };
  /** The new groups after joining / creating (the work opens once myGroupId is set). */
  onChange: (view: WorkGroupsView) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);

  const join = async (group: WorkGroup) => {
    setJoining(group.id);
    try {
      onChange(await dataService.joinWorkGroup(assignmentId, group.id, proxy?.number));
    } catch (err) {
      alert(errorText(err));
      // Someone may have filled it or handed in meanwhile: show the groups as they are now.
      dataService.getWorkGroups(assignmentId, proxy?.number).then(onChange, () => {});
    } finally {
      setJoining(null);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in">
      <div className="p-5 rounded-3xl bg-linear-to-br from-violet-50 to-sky-50 dark:from-violet-950/40 dark:to-sky-950/30 ring-1 ring-violet-200/80 dark:ring-violet-900/60 space-y-1.5">
        <p className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
          <Users className="w-5 h-5 text-brand" /> งานกลุ่ม · {proxy ? `เลือกกลุ่มให้ ${proxy.name}` : "เลือกกลุ่มก่อน"}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300">กลุ่มละไม่เกิน {view.groupSize} คน • ส่ง 1 คน นับให้ทุกคนในกลุ่ม</p>
      </div>

      <button
        type="button"
        onClick={() => setCreating(true)}
        className="w-full h-14 rounded-2xl bg-brand hover:bg-brand-dark text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md cursor-pointer active:scale-[0.98] transition-transform"
      >
        <UserPlus className="w-5 h-5" /> สร้างกลุ่มใหม่ + เลือกเพื่อน
      </button>

      {view.groups.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-bold text-slate-500">หรือเข้าร่วมกลุ่มที่มีอยู่ ({view.groups.length})</h2>
          {view.groups.map((group) => {
            const isFull = group.member_ids.length >= view.groupSize;
            const done = !!group.submitted_at;
            return (
              <div key={group.id} className={`${CARD} p-4 space-y-3`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 text-sm font-bold text-slate-900 dark:text-white truncate">{group.name}</p>
                  <span className={`shrink-0 text-xs font-bold tabular-nums ${isFull ? "text-slate-400" : "text-brand"}`}>
                    {group.member_ids.length}/{view.groupSize} คน
                  </span>
                </div>
                <Members group={group} view={view} compact meLabel={proxy?.name} />
                <button
                  type="button"
                  disabled={isFull || done || !!joining}
                  onClick={() => join(group)}
                  className="w-full h-10 rounded-xl ring-1 ring-violet-300 dark:ring-violet-800 text-brand dark:text-violet-300 font-bold text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-violet-50 dark:hover:bg-violet-950/40"
                >
                  {joining === group.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  {done ? "ส่งงานแล้ว" : isFull ? "กลุ่มเต็ม" : "เข้าร่วมกลุ่มนี้"}
                </button>
              </div>
            );
          })}
        </section>
      )}

      {creating && (
        <ClassmateSheet
          view={view}
          room={view.groupSize - 1}
          title="สร้างกลุ่มใหม่"
          withName
          confirmLabel={(count) => {
            const who = proxy ? proxy.name : "ฉัน";
            return count ? `สร้างกลุ่ม (${count + 1} คน รวม${who})` : `สร้างกลุ่ม (${who}คนเดียวก่อน)`;
          }}
          onClose={() => setCreating(false)}
          onConfirm={async (ids, name) => {
            try {
              onChange(await dataService.createWorkGroup(assignmentId, ids, name, proxy?.number));
              setCreating(false);
            } catch (err) {
              alert(errorText(err));
              dataService.getWorkGroups(assignmentId, proxy?.number).then(onChange, () => {});
            }
          }}
        />
      )}
    </div>
  );
}

/** Above the work: the student's group, with "add classmates" and "leave" until it hands in. */
export function WorkGroupBanner({
  assignmentId,
  view,
  onChange,
  locked = false,
  proxy,
}: {
  assignmentId: string;
  view: WorkGroupsView;
  /** Borrowed phone: the classmate's group. */
  proxy?: { number: string; name: string };
  onChange: (view: WorkGroupsView) => void;
  /** Read-only (handed in, closed, or done from a borrowed phone). */
  locked?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const group = view.groups.find((g) => g.id === view.myGroupId);
  if (!group) return null;
  const room = view.groupSize - group.member_ids.length;
  const open = !locked && !group.submitted_at;

  const leave = async () => {
    if (!confirm(proxy ? `นำ ${proxy.name} ออกจาก “${group.name}”?` : `ออกจาก “${group.name}”?`)) return;
    setLeaving(true);
    try {
      onChange(await dataService.leaveWorkGroup(assignmentId, undefined, proxy?.number));
    } catch (err) {
      alert(errorText(err));
    } finally {
      setLeaving(false);
    }
  };

  return (
    <div className="p-4 rounded-3xl bg-sky-50 dark:bg-sky-950/40 ring-1 ring-sky-200 dark:ring-sky-900 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex items-center gap-1.5 text-sm font-bold text-sky-900 dark:text-sky-100">
          <Users className="w-4 h-4 shrink-0" />
          <span className="truncate">{group.name}</span>
          <span className="shrink-0 text-xs font-semibold opacity-70 tabular-nums">· {group.member_ids.length}/{view.groupSize}</span>
        </p>
        {open && (
          <span className="flex items-center gap-1 shrink-0">
            {room > 0 && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="h-8 px-2.5 rounded-xl bg-white dark:bg-slate-900 text-xs font-bold text-sky-800 dark:text-sky-200 ring-1 ring-sky-200 dark:ring-sky-800 flex items-center gap-1 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" /> เพิ่ม
              </button>
            )}
            <button
              type="button"
              onClick={leave}
              disabled={leaving}
              aria-label="ออกจากกลุ่ม"
              className="h-8 w-8 rounded-xl text-sky-700 dark:text-sky-300 hover:bg-white/70 dark:hover:bg-slate-900/60 flex items-center justify-center cursor-pointer disabled:opacity-50"
            >
              {leaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            </button>
          </span>
        )}
      </div>
      <Members group={group} view={view} meLabel={proxy?.name} />
      <p className="text-xs text-sky-800/80 dark:text-sky-200/80">
        {group.submitted_at ? "กลุ่มนี้ส่งงานแล้ว — นับให้ทุกคนในกลุ่ม" : "ส่ง 1 คน นับว่าส่งให้ทุกคนในกลุ่ม"}
      </p>
      {adding && (
        <ClassmateSheet
          view={view}
          room={room}
          title={`เพิ่มเพื่อนเข้า ${group.name}`}
          confirmLabel={(count) => `เพิ่ม ${count} คน`}
          onClose={() => setAdding(false)}
          onConfirm={async (ids) => {
            try {
              onChange(await dataService.addWorkGroupMembers(assignmentId, group.id, ids, proxy?.number));
              setAdding(false);
            } catch (err) {
              alert(errorText(err));
              dataService.getWorkGroups(assignmentId, proxy?.number).then(onChange, () => {});
            }
          }}
        />
      )}
    </div>
  );
}

/** Names of the group's members, for "sent for everyone" messages. */
export function groupMemberNames(view: WorkGroupsView | null | undefined, meLabel = "ฉัน"): string[] {
  const group = view?.groups.find((g) => g.id === view.myGroupId);
  if (!view || !group) return [];
  const byId = new Map(view.students.map((s) => [s.id, s]));
  return group.member_ids.map((id) => (id === view.me ? meLabel : byId.get(id)?.first_name || nameOf(byId.get(id))));
}
