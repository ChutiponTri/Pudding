'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Search, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { dataService } from '@/lib/supabase/dataService';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { institutionLabel } from '@/lib/data/thaiInstitutions';
import { teacherRoleBadgeClass, teacherRoleLabel } from '@/lib/utils/teacherRole';
import type { ClassroomTeacher, User } from '@/types/database';

export type CoTeacherRole = 'assistant' | 'researcher';

/**
 * One compact block for adding co-teachers: a role dropdown (teacher /
 * researcher), a name/email search, and a LINE invite that the teacher sends
 * from their own LINE account (/liff/share, shareTargetPicker; no bot quota).
 * Teachers are searched at the teacher's institution, researchers anywhere.
 * Optionally lists the current teachers with a remove button.
 */
export function CoTeacherPanel({
  courseId,
  institution,
  onAdd,
  teachers,
  onRemove,
  hideList,
}: {
  /** The course the LINE invite joins; without one the LINE button is hidden. */
  courseId?: string | null;
  /** The signed-in teacher's institution: "teacher" search is limited to it. */
  institution?: string | null;
  onAdd: (teacher: User, role: CoTeacherRole) => void;
  teachers?: ClassroomTeacher[];
  onRemove?: (teacherId: string) => void;
  /** Still marks search results already added, but does not list the teachers (the page shows them). */
  hideList?: boolean;
}) {
  const { tr, language } = useLanguage();
  const [role, setRole] = useState<CoTeacherRole>('assistant');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [shares, setShares] = useState<Record<string, { code: string; shareUrl: string | null }>>({});
  const [sharing, setSharing] = useState(false);
  const searchSeq = useRef(0);

  const search = async (q: string, forRole = role) => {
    setQuery(q);
    const seq = ++searchSeq.current;
    if (!q.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const found = await dataService.searchTeachers(q, forRole === 'assistant' ? institution || undefined : undefined);
    if (seq !== searchSeq.current) return;
    setResults(found);
    setSearching(false);
  };

  // Fetch the invite ahead of the tap, so the LINE page opens without a popup blocker.
  const shareKey = courseId ? `${courseId}:${role}` : '';
  useEffect(() => {
    if (!courseId || shares[shareKey]) return;
    dataService
      .getTeacherInviteShare(courseId, role)
      .then((share) => setShares((prev) => ({ ...prev, [shareKey]: share })))
      .catch((error) => console.warn('Teacher invite unavailable:', error));
  }, [courseId, role, shareKey, shares]);

  const inviteText = (code: string) =>
    tr(
      `เชิญร่วมสอนเป็น ${role === 'assistant' ? 'TA (ผู้ช่วยสอน)' : 'ผู้ตรวจเพื่อวิจัย (IRR)'} ตอบรับคำเชิญที่: ${window.location.origin}/teacher-invite?code=${code}`,
      `You're invited to co-teach as ${role === 'assistant' ? 'a TA (teaching assistant)' : 'a research grader (IRR)'}. Accept here: ${window.location.origin}/teacher-invite?code=${code}`
    );

  const shareOnLine = async () => {
    if (!courseId) return;
    // Opened before any await, so browsers treat it as the tap's own window.
    const win = window.open('', '_blank');
    setSharing(true);
    try {
      const share = shares[shareKey] || (await dataService.getTeacherInviteShare(courseId, role));
      setShares((prev) => ({ ...prev, [shareKey]: share }));
      const url = share.shareUrl || `https://line.me/R/msg/text/?${encodeURIComponent(inviteText(share.code))}`;
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (error) {
      win?.close();
      alert(error instanceof Error ? error.message : tr('สร้างคำเชิญไม่สำเร็จ', 'Could not create the invite'));
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
        <select
          value={role}
          onChange={(e) => {
            const next = e.target.value as CoTeacherRole;
            setRole(next);
            if (query) search(query, next);
          }}
          aria-label={tr('บทบาท', 'Role')}
          className="h-8 shrink-0 px-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-slate-100 outline-none focus:border-amber-500 cursor-pointer"
        >
          <option value="assistant">{teacherRoleLabel('assistant', tr)}</option>
          <option value="researcher">{teacherRoleLabel('researcher', tr)}</option>
        </select>
        <div className="relative flex-1 min-w-40">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => search(e.target.value)}
            placeholder={
              role === 'assistant'
                ? tr('ค้นหาชื่อ/อีเมล (สถาบันเดียวกัน)', 'Name or email (your institution)')
                : tr('ค้นหาชื่อ/อีเมล (ทุกสถาบัน)', 'Name or email (any institution)')
            }
            className="w-full h-8 pl-8 pr-7 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white outline-none focus:border-amber-500"
          />
          {searching && <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin absolute right-2.5 top-1/2 -translate-y-1/2" />}
        </div>
        {courseId && (
          <button
            type="button"
            onClick={shareOnLine}
            disabled={sharing}
            title={tr('เลือกเพื่อนหรือกลุ่มใน LINE แล้วส่งคำเชิญจาก LINE ของคุณ', 'Pick LINE friends or groups and send the invite from your own LINE')}
            className="h-8 shrink-0 px-2.5 rounded-lg bg-line hover:bg-line-dark text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
          >
            {sharing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
            <span>{tr('เชิญทาง LINE', 'Invite on LINE')}</span>
          </button>
        )}
      </div>

      {query.trim() && !searching && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800 max-h-44 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-2.5 py-2 text-[11px] text-slate-400">
              {tr('ไม่พบครู — ครูต้องเคยเข้าสู่ระบบแล้ว หรือส่งคำเชิญทาง LINE', 'No teacher found. They must have signed in once, or invite them on LINE')}
            </p>
          ) : (
            results.map((found) => {
              const added = teachers?.some((t) => t.teacher_id === found.id);
              return (
                <div key={found.id} className="px-2 py-1.5 flex items-center gap-2">
                  <Avatar src={found.avatar_url} name={found.name} className="w-6 h-6 text-[9px]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                      {`${found.first_name || ''} ${found.last_name || ''}`.trim() || found.name || tr('ครูผู้สอน', 'Teacher')}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {found.institution ? `${institutionLabel(found.institution, language)} • ` : ''}
                      {found.email}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={added}
                    onClick={() => {
                      onAdd(found, role);
                      setQuery('');
                      setResults([]);
                    }}
                    className="h-6 px-2 rounded-md bg-amber-500 hover:bg-amber-600 text-slate-950 text-[11px] font-bold shrink-0 cursor-pointer disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-800 disabled:cursor-default"
                  >
                    {added ? tr('อยู่แล้ว', 'Added') : tr('+ เพิ่ม', '+ Add')}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {teachers && !hideList && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
          {teachers.map((teacher) => {
            return (
              <div key={teacher.teacher_id} className="px-2 py-1.5 flex items-center gap-2">
                <Avatar src={teacher.avatar_url} name={teacher.name} className="w-6 h-6 text-[9px]" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{teacher.name || teacher.email || teacher.teacher_id}</p>
                  {teacher.email && <p className="text-[10px] text-slate-400 truncate">{teacher.email}</p>}
                </div>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border shrink-0 ${teacherRoleBadgeClass(teacher.role)}`}>{teacherRoleLabel(teacher.role, tr)}</span>
                {onRemove && teacher.role !== 'primary' ? (
                  <button
                    type="button"
                    onClick={() => onRemove(teacher.teacher_id)}
                    className="p-1 text-slate-400 hover:text-rose-500 rounded cursor-pointer shrink-0"
                    title={tr('นำออก', 'Remove')}
                    aria-label={tr('นำออก', 'Remove')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  onRemove && <span className="w-5.5 shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
