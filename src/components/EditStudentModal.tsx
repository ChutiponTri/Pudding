'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Edit2, Loader2, X } from 'lucide-react';
import type { User } from '@/types/database';
import { InstitutionSearchSelect } from '@/components/InstitutionSearchSelect';
import { dataService } from '@/lib/supabase/dataService';
import { personNameError } from '@/lib/utils/studentName';

type StudentFields = { first_name: string; last_name: string; student_id?: string; institution?: string };

const normalize = (value?: string) => (value || '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Lets a teacher fix a student's name, surname, student number and school
 * (students sometimes mistype them when joining). Saves through
 * /api/classrooms/students, which checks that the signed-in teacher teaches
 * `classroomId`.
 */
export function EditStudentModal({
  classroomId,
  student,
  teacherInstitution,
  onClose,
  onSaved,
}: {
  classroomId: string;
  student: User;
  teacherInstitution?: string;
  onClose: () => void;
  onSaved: (studentId: string, fields: StudentFields) => void;
}) {
  const [firstName, setFirstName] = useState(student.first_name || '');
  const [lastName, setLastName] = useState(student.last_name || '');
  const [studentNumber, setStudentNumber] = useState(student.student_id || '');
  const [institution, setInstitution] = useState(student.institution || '');
  const [registeredInstitutions, setRegisteredInstitutions] = useState<string[]>([]);
  const otherSchool = !!teacherInstitution && !!institution.trim() && normalize(institution) !== normalize(teacherInstitution);

  useEffect(() => {
    dataService.getRegisteredInstitutions().then(setRegisteredInstitutions).catch(() => {});
  }, []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const nameError = personNameError(firstName, lastName);
    if (nameError) {
      setError(nameError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/classrooms/students', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classroomId, studentId: student.id, firstName, lastName, studentNumber, institution }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json.error || 'บันทึกข้อมูลนักเรียนไม่สำเร็จ');
        return;
      }
      onSaved(student.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        student_id: studentNumber.trim() || undefined,
        institution: institution.trim() || undefined,
      });
    } catch {
      setError('บันทึกข้อมูลนักเรียนไม่สำเร็จ');
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

          <div>
            <label className="text-[11px] font-bold text-slate-400 block mb-1">โรงเรียน / สถานศึกษา</label>
            <InstitutionSearchSelect value={institution} onChange={setInstitution} extraInstitutions={registeredInstitutions} />
            {otherSchool && (
              <div className="mt-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-[11px] font-bold text-rose-700 dark:text-rose-300 flex items-start gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
                <span>
                  โรงเรียนนี้ต่างจากโรงเรียนของคุณครู ({teacherInstitution}){' '}
                  <button type="button" onClick={() => setInstitution(teacherInstitution || '')} className="underline cursor-pointer">
                    ใช้โรงเรียนของคุณครู
                  </button>
                </span>
              </div>
            )}
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
