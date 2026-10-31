'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import type { TeacherApproval } from '@/lib/utils/teacherProfile';

/** Approve / reject / back-to-pending buttons for one teacher in /admin/teachers. */
export function AdminTeacherApproval({ id, name, approval }: { id: string; name: string; approval: TeacherApproval }) {
  const router = useRouter();
  const [saving, setSaving] = useState<TeacherApproval | null>(null);
  const [error, setError] = useState('');
  const [, startTransition] = useTransition();

  const set = async (next: TeacherApproval) => {
    if (next === 'rejected' && !window.confirm(`ปฏิเสธบัญชีครู "${name}"?\nครูคนนี้จะใช้งานระบบไม่ได้ทันที (เปลี่ยนกลับได้ภายหลัง)`)) return;
    setSaving(next);
    setError('');
    try {
      const response = await fetch('/api/admin/teachers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, approval: next }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'บันทึกไม่สำเร็จ');
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(null);
    }
  };

  const button = 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-50 whitespace-nowrap';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {approval !== 'approved' && (
        <button type="button" disabled={!!saving} onClick={() => set('approved')} className={`${button} bg-emerald-600 hover:bg-emerald-500 text-white`}>
          {saving === 'approved' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          อนุมัติ
        </button>
      )}
      {approval !== 'rejected' && (
        <button type="button" disabled={!!saving} onClick={() => set('rejected')} className={`${button} bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900 hover:bg-rose-100`}>
          {saving === 'rejected' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
          ปฏิเสธ
        </button>
      )}
      {approval !== 'pending' && (
        <button type="button" disabled={!!saving} onClick={() => set('pending')} className={`${button} text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800`}>
          {saving === 'pending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          รอตรวจ
        </button>
      )}
      {error && <span className="text-[11px] font-bold text-rose-600">{error}</span>}
    </div>
  );
}
