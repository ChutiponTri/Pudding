'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import type { TeacherApproval } from '@/lib/utils/teacherProfile';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/** Approve / reject / back-to-pending buttons for one teacher in /admin/teachers. */
export function AdminTeacherApproval({ id, name, approval }: { id: string; name: string; approval: TeacherApproval }) {
  const router = useRouter();
  const [saving, setSaving] = useState<TeacherApproval | null>(null);
  const [error, setError] = useState('');
  const { tr } = useLanguage();
  const [, startTransition] = useTransition();

  const set = async (next: TeacherApproval) => {
    if (next === 'rejected' && !window.confirm(tr(`ปฏิเสธบัญชีครู "${name}"?\nครูคนนี้จะใช้งานระบบไม่ได้ทันที (เปลี่ยนกลับได้ภายหลัง)`, `Reject the teacher account "${name}"?\nThey lose access right away (you can change this later).`))) return;
    setSaving(next);
    setError('');
    try {
      const response = await fetch('/api/admin/teachers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, approval: next }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || tr('บันทึกไม่สำเร็จ', 'Could not save'));
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('บันทึกไม่สำเร็จ', 'Could not save'));
    } finally {
      setSaving(null);
    }
  };

  const button = 'inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 whitespace-nowrap transition-colors';
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      {approval !== 'approved' && (
        <button type="button" disabled={!!saving} onClick={() => set('approved')} className={`${button} flex-1 bg-linear-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white shadow-sm shadow-emerald-500/30`}>
          {saving === 'approved' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {tr('อนุมัติ', 'Approve')}
        </button>
      )}
      {approval !== 'rejected' && (
        <button type="button" disabled={!!saving} onClick={() => set('rejected')} className={`${button} ${approval === 'approved' ? '' : 'flex-1'} bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900 hover:bg-rose-100 dark:hover:bg-rose-950/70`}>
          {saving === 'rejected' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
          {tr('ปฏิเสธ', 'Reject')}
        </button>
      )}
      {approval !== 'pending' && (
        <button type="button" disabled={!!saving} onClick={() => set('pending')} className={`${button} text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800`}>
          {saving === 'pending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          {tr('รอตรวจ', 'Back to pending')}
        </button>
      )}
      {error && <span className="w-full text-[11px] font-bold text-rose-600">{error}</span>}
    </div>
  );
}
