'use client';

import { useState } from 'react';
import { Check, Edit2, Loader2, Send, ShieldCheck, Trash2, UserCheck, Users, UserX, X } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { ModalSheet, ModalSheetBody, ModalSheetHeader } from '@/components/ModalSheet';
import { institutionLabel } from '@/lib/data/thaiInstitutions';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import type { Classroom, User } from '@/types/database';

export type StudentRosterTab = 'roster' | 'pending';

const fullName = (s: User) => `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.name || '';
/** The LINE display name, when it differs from the name the student typed. */
const lineName = (s: User) => (s.name && (s.first_name || s.last_name) && s.name.trim() !== fullName(s) ? s.name : '');

/**
 * "เพิ่มนักเรียน" for one classroom (dashboard, classroom list and classroom
 * page): its roster and the join requests waiting for approval. Students join
 * from LINE: "เชิญในไลน์" has the bot post the join invitation to the class
 * group (quota checked first; whenever the bot cannot, the teacher gets the
 * same message to share from their own LINE).
 */
export function StudentRosterModal({
  classroom,
  initialTab = 'roster',
  onClose,
  onEditStudent,
  onRemoveStudent,
  onAdmitStudent,
  onRejectStudent,
  onBulkPending,
  isOtherSchool,
}: {
  classroom: Classroom;
  initialTab?: StudentRosterTab;
  onClose: () => void;
  onEditStudent: (student: User) => void;
  onRemoveStudent: (studentId: string) => void;
  onAdmitStudent: (studentId: string) => void;
  onRejectStudent: (studentId: string) => void;
  /** Admit / decline every request (the caller confirms); hidden when not given. */
  onBulkPending?: (action: 'admit' | 'reject') => void;
  /** A school that differs from the teacher's is flagged. */
  isOtherSchool?: (institution?: string) => boolean;
}) {
  const { language } = useLanguage();
  const tr = (th: string, en: string) => (language === 'th' ? th : en);
  const [tab, setTab] = useState<StudentRosterTab>(initialTab);
  const [inviting, setInviting] = useState(false);
  const [inviteNote, setInviteNote] = useState<{ ok: boolean; text: string } | null>(null);
  const students = classroom.students || [];
  const pending = classroom.pending_students || [];

  const handleInvite = async () => {
    setInviting(true);
    setInviteNote(null);
    try {
      const line = await dataService.inviteStudentsInLine(classroom.id, classroom.name);
      setInviteNote(
        line === 'card'
          ? { ok: true, text: tr('กด “ส่งเข้ากลุ่ม” ในหน้าต่างที่เปิดขึ้น แล้วเลือกกลุ่ม LINE ของห้อง', 'Tap “Send to group” in the window that opened and pick the class LINE group') }
          : { ok: false, text: tr('บอทส่งไม่ได้ จึงเปิดให้แชร์จาก LINE ของคุณครูแทน', 'The bot could not send it, so you can share it from your own LINE') }
      );
    } catch (error) {
      setInviteNote({ ok: false, text: error instanceof Error ? error.message : tr('ส่งคำเชิญไม่สำเร็จ', 'Could not send the invitation') });
    } finally {
      setInviting(false);
    }
  };

  const school = (s: User) => {
    const other = !!s.institution?.trim() && !!isOtherSchool?.(s.institution);
    if (!s.institution?.trim()) return <span className="text-slate-400">{tr('ไม่ระบุโรงเรียน', 'No school')}</span>;
    return (
      <span className={other ? 'font-bold text-rose-600 dark:text-rose-400' : ''} title={other ? tr('โรงเรียนไม่ตรงกับโรงเรียนของคุณครู', 'School differs from yours') : undefined}>
        {other ? '⚠️ ' : ''}
        {institutionLabel(s.institution, language)}
      </span>
    );
  };

  const tabClass = (active: boolean) =>
    `flex-1 min-w-0 h-9 px-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
      active ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
    }`;

  return (
    <ModalSheet onClose={onClose} size="sm:max-w-xl">
      <ModalSheetHeader>
        <div className="min-w-0">
          <h3 className="text-base font-black text-slate-900 dark:text-white truncate">{classroom.name}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {[classroom.subject_code, classroom.academic_year].filter(Boolean).join(' • ')}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-lg shrink-0 cursor-pointer"
          aria-label={tr('ปิด', 'Close')}
        >
          <X className="w-5 h-5" />
        </button>
      </ModalSheetHeader>

      <ModalSheetBody className="space-y-4">
        <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'roster'} onClick={() => setTab('roster')} className={tabClass(tab === 'roster')}>
            <Users className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{tr('รายชื่อนักเรียน', 'Students')}</span>
            <span className="shrink-0 text-[10px] font-black text-slate-400">{students.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === 'pending'} onClick={() => setTab('pending')} className={tabClass(tab === 'pending')}>
            <UserCheck className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{tr('คำขอรออนุมัติ', 'Join requests')}</span>
            {pending.length > 0 && (
              <span className="shrink-0 min-w-4.5 h-4.5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-black inline-flex items-center justify-center">
                {pending.length}
              </span>
            )}
          </button>
        </div>

        {tab === 'roster' && (
          <div className="space-y-3">
            <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 flex flex-col sm:flex-row sm:items-center gap-3">
              <p className="flex-1 min-w-0 text-[11px] leading-relaxed text-emerald-900 dark:text-emerald-200">
                {tr(
                  'ให้บอทส่งคำเชิญพร้อมปุ่มเข้าห้องเข้ากลุ่ม LINE ของห้อง นักเรียนกดปุ่ม กรอกชื่อ แล้วรอคุณครูอนุมัติ',
                  'The bot posts an invitation with a join button to the class LINE group. Students tap it, fill in their name, and wait for your approval.'
                )}
              </p>
              <button
                type="button"
                onClick={handleInvite}
                disabled={inviting}
                className="shrink-0 h-10 px-4 rounded-xl bg-[#06c755] hover:bg-[#05b34c] disabled:opacity-60 text-white text-sm font-black inline-flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
              >
                {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {tr('เชิญในไลน์', 'Invite in LINE')}
              </button>
            </div>
            {inviteNote && (
              <p className={`text-[11px] font-bold flex items-center gap-1.5 ${inviteNote.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {inviteNote.ok && <Check className="w-3.5 h-3.5 shrink-0" />}
                {inviteNote.text}
              </p>
            )}

            {students.length === 0 ? (
              <div className="py-10 text-center space-y-1.5">
                <Users className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{tr('ยังไม่มีนักเรียนในห้องนี้', 'No students in this class yet')}</p>
                <p className="text-[11px] text-slate-400">{tr('กด “เชิญในไลน์” เพื่อส่งคำเชิญเข้ากลุ่ม', 'Tap “Invite in LINE” to send the invitation')}</p>
              </div>
            ) : (
              <ul className="rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                {students.map((s, index) => (
                  <li key={s.id} className="px-3 py-2.5 flex items-center gap-3 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <span className="w-5 shrink-0 text-right text-[11px] font-bold tabular-nums text-slate-400">{index + 1}</span>
                    <Avatar src={s.avatar_url} firstName={s.first_name} lastName={s.last_name} name={s.name} className="w-8 h-8 shrink-0 text-[10px]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {fullName(s) || tr('นักเรียน', 'Student')}
                        {lineName(s) && <span className="ml-1.5 font-semibold text-[10px] text-emerald-600 dark:text-emerald-400">LINE: {lineName(s)}</span>}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        <span className="font-mono">{tr('รหัส', 'ID')} {s.student_id || '-'}</span>
                        <span className="mx-1 text-slate-300 dark:text-slate-600">•</span>
                        {school(s)}
                      </p>
                    </div>
                    <div className="flex items-center shrink-0">
                      <button
                        type="button"
                        onClick={() => onEditStudent(s)}
                        className="p-2 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 cursor-pointer"
                        title={tr('แก้ไขชื่อ นามสกุล และรหัสนักเรียน', 'Edit student')}
                        aria-label={tr('แก้ไข', 'Edit')}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveStudent(s.id)}
                        className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                        title={tr('นำออกจากห้องเรียน', 'Remove from class')}
                        aria-label={tr('นำออก', 'Remove')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'pending' && (
          <div className="space-y-3">
            <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="leading-relaxed">
                {tr('นักเรียนที่กดเข้าห้องจาก LINE ต้องรอคุณครูอนุมัติก่อน เพื่อกันคนนอกเข้าห้อง', 'Students who join from LINE wait for your approval, so outsiders can\'t join')}
              </p>
            </div>

            {pending.length === 0 ? (
              <div className="py-10 text-center space-y-1.5">
                <UserCheck className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">{tr('ไม่มีคำขอที่รออนุมัติ', 'No pending requests')}</p>
                <p className="text-[11px] text-slate-400">{tr('คำขอใหม่จะแสดงที่นี่ทันที', 'New requests show up here right away')}</p>
              </div>
            ) : (
              <>
                {onBulkPending && pending.length > 1 && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-500">{tr(`รออนุมัติ ${pending.length} คน`, `${pending.length} waiting`)}</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onBulkPending('admit')}
                        className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        {tr('อนุมัติทั้งหมด', 'Admit all')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onBulkPending('reject')}
                        className="h-8 px-3 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-300 font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <UserX className="w-3.5 h-3.5" />
                        {tr('ปฏิเสธทั้งหมด', 'Decline all')}
                      </button>
                    </div>
                  </div>
                )}
                <ul className="rounded-2xl border border-amber-200 dark:border-amber-900/60 divide-y divide-amber-100 dark:divide-slate-800 overflow-hidden">
                  {pending.map((s) => (
                    <li key={s.id} className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2.5 bg-white dark:bg-slate-900">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Avatar src={s.avatar_url} firstName={s.first_name} lastName={s.last_name} name={s.name} className="w-9 h-9 shrink-0 ring-2 ring-amber-400 text-[10px]" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {fullName(s) || tr('นักเรียน', 'Student')}
                            {lineName(s) && <span className="ml-1.5 font-semibold text-[10px] text-emerald-600 dark:text-emerald-400">LINE: {lineName(s)}</span>}
                          </p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            <span className="font-mono">{tr('รหัส', 'ID')} {s.student_id || '-'}</span>
                            <span className="mx-1 text-slate-300 dark:text-slate-600">•</span>
                            {school(s)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 sm:ml-auto">
                        <button
                          type="button"
                          onClick={() => onAdmitStudent(s.id)}
                          className="flex-1 sm:flex-none h-8 px-3.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {tr('อนุมัติ', 'Admit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRejectStudent(s.id)}
                          className="flex-1 sm:flex-none h-8 px-3 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-600 hover:text-rose-600 dark:text-slate-300 font-bold text-xs inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                          {tr('ปฏิเสธ', 'Decline')}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </ModalSheetBody>
    </ModalSheet>
  );
}
