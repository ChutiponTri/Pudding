'use client';

import { useState } from 'react';
import { Edit2, Loader2, X } from 'lucide-react';
import type { User } from '@/types/database';

type StudentFields = { first_name: string; last_name: string; student_id?: string };

/**
 * Lets a teacher fix a student's name, surname and student number (students
 * sometimes mistype them when joining). Saves through /api/classrooms/students,
 * which checks that the signed-in teacher teaches `classroomId`.
 */
export function EditStudentModal({
  classroomId,
  student,
  onClose,
  onSaved,
}: {
  classroomId: string;
  student: User;
  onClose: () => void;
  onSaved: (studentId: string, fields: StudentFields) => void;
}) {
  const [firstName, setFirstName] = useState(student.first_name || '');
  const [lastName, setLastName] = useState(student.last_name || '');
  const [studentNumber, setStudentNumber] = useState(student.student_id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError('กรุณากรอกชื่อและนามสกุล');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/classrooms/students', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classroomId, studentId: student.id, firstName, lastName, studentNumber }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json.error || 'บันทึกข้อมูลผู้เรียนไม่สำเร็จ');
        return;
      }
      onSaved(student.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        student_id: studentNumber.trim() || undefined,
      });
    } catch {
      setError('เกิดข้อผิดพลาดในการบันทึกข้อมูลผู้เรียน');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500';

  return (
    <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 max-w-md w-full space-y-4 shadow-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-amber-500" />
            <span>แก้ไขข้อมูลผู้เรียน</span>
          </h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1">ชื่อ *</label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} autoFocus />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-400 block mb-1">นามสกุล *</label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-400 block mb-1">รหัสนักเรียน</label>
            <input
              value={studentNumber}
              onChange={(e) => setStudentNumber(e.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="เช่น 12345"
            />
          </div>

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
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-60"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>บันทึก</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
