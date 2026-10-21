'use client';

import { useState } from 'react';
import { Check, Clock, Loader2, Lock, Unlock, X } from 'lucide-react';
import type { Assignment, SubmissionOverrideStatus } from '@/types/database';
import { DateTimeField } from '@/components/DateTimeField';
import { dataService } from '@/lib/supabase/dataService';
import { daysFromNowAt, formatDateTime } from '@/lib/utils/datetime';
import { ASSIGNMENT_STATUS_CLASSES, getAssignmentStatus, getAssignmentWindow } from '@/lib/utils/assignmentWindow';

/**
 * Lets a teacher change whether an assignment accepts work, from the classroom
 * classwork list: follow the deadline, close now, or extend the deadline.
 * Same override the grading page's control panel writes.
 */
export function AssignmentStatusDialog({
  assignment,
  onClose,
  onSaved,
}: {
  assignment: Assignment;
  onClose: () => void;
  onSaved: (updated: Assignment) => void;
}) {
  const current = assignment.status_override || 'auto';
  const [mode, setMode] = useState<SubmissionOverrideStatus>(current);
  const [extendedUntil, setExtendedUntil] = useState(
    current === 'extended' && assignment.extended_until ? assignment.extended_until : daysFromNowAt(1, 23, 59)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const status = getAssignmentStatus(getAssignmentWindow(assignment), assignment.is_exam);
  const dueLabel = formatDateTime(assignment.due_date, 'th');

  const options: Array<{ id: SubmissionOverrideStatus; icon: typeof Clock; title: string; detail: string; tone: string }> = [
    {
      id: 'auto',
      icon: Clock,
      title: 'ตามกำหนดส่ง (อัตโนมัติ)',
      detail: assignment.is_exam
        ? `เปิดรับคำตอบถึง ${dueLabel} แล้วปิดรับทันที`
        : `เปิดรับงานถึง ${dueLabel} หลังจากนั้นรับงานส่งช้า`,
      tone: 'emerald',
    },
    {
      id: 'force_closed',
      icon: Lock,
      title: 'ปิดรับงานทันที',
      detail: 'นักเรียนส่งหรือแก้ไขงานไม่ได้จนกว่าจะเปิดอีกครั้ง',
      tone: 'rose',
    },
    {
      id: 'extended',
      icon: Unlock,
      title: 'ขยายเวลาส่ง',
      detail: assignment.is_exam ? 'เปิดรับคำตอบถึงเวลาใหม่ที่เลือก' : 'ย้ายกำหนดส่งไปเวลาใหม่ที่เลือก',
      tone: 'amber',
    },
  ];

  const selectedClasses: Record<string, string> = {
    emerald: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-500/40',
    rose: 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-500/40',
    amber: 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-500/40',
  };
  const iconClasses: Record<string, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    rose: 'text-rose-600 dark:text-rose-400',
    amber: 'text-amber-600 dark:text-amber-400',
  };

  const save = async () => {
    if (mode === 'extended' && new Date(extendedUntil).getTime() <= Date.now()) {
      setError('กรุณาเลือกเวลาขยายที่อยู่ในอนาคต');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const updated = await dataService.updateAssignmentDeadlineOverride(assignment.id, {
        status_override: mode,
        extended_until: mode === 'extended' ? extendedUntil : undefined,
      });
      onSaved(updated || { ...assignment, status_override: mode, extended_until: mode === 'extended' ? extendedUntil : assignment.extended_until });
    } catch (err) {
      console.error(err);
      setError('บันทึกสถานะการรับงานไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assignment-status-title"
        className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 max-w-md w-full space-y-4 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="assignment-status-title" className="text-sm font-black text-slate-900 dark:text-white">
              สถานะการรับงาน
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{assignment.title}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[11px] font-black px-2.5 py-1 rounded-full border ${ASSIGNMENT_STATUS_CLASSES[status.tone]}`}>
              {status.label}
            </span>
            <button type="button" onClick={onClose} aria-label="ปิด" className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="space-y-2" role="radiogroup">
          {options.map((option) => {
            const Icon = option.icon;
            const selected = mode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setMode(option.id)}
                className={`w-full text-left p-3.5 rounded-2xl border flex items-start gap-3 transition-all cursor-pointer ${
                  selected ? selectedClasses[option.tone] : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconClasses[option.tone]}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-black text-slate-900 dark:text-white">{option.title}</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">{option.detail}</span>
                </span>
                {selected && <Check className={`w-4 h-4 shrink-0 ${iconClasses[option.tone]}`} />}
              </button>
            );
          })}
        </div>

        {mode === 'extended' && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">ขยายเวลาถึง</label>
            <DateTimeField value={extendedUntil} onChange={setExtendedUntil} presets="deadline" />
          </div>
        )}

        {error && <p className="text-xs font-bold text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold cursor-pointer"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>บันทึก</span>
          </button>
        </div>
      </div>
    </div>
  );
}
