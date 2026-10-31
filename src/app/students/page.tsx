'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Edit2, Search, Users } from 'lucide-react';
import type { Classroom, User } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useTeacherDashboardData, type TeacherDashboardData } from '@/lib/hooks/useTeacherDashboardData';
import { useSemesterParam } from '@/lib/hooks/useSemesterParam';
import { SemesterSelect } from '@/components/SemesterSelect';
import { Avatar } from '@/components/Avatar';
import { EditStudentModal } from '@/components/EditStudentModal';
import { formatAcademicPeriod } from '@/lib/utils/academicYear';
import { classroomTitle } from '@/lib/utils/classroomLabel';
import { filterClassroomsBySemester, semesterOptions } from '@/lib/utils/semesterFilter';

type StudentFields = Pick<User, 'first_name' | 'last_name' | 'student_id' | 'institution'>;
type StudentRow = { student: User; classrooms: Classroom[] };

const fullName = (s: Partial<User>) => `${s.first_name || ''} ${s.last_name || ''}`.trim() || s.name || '-';

/**
 * Every admitted student in the teacher's classrooms of the selected term,
 * listed once even when they sit in several classrooms. Teachers can fix a
 * name, student number or school here (it applies to all their classrooms).
 */
function StudentsContent() {
  const { language } = useLanguage();
  const th = language === 'th';
  const { data, error } = useTeacherDashboardData();
  const loading = !data;
  const { semesterKey, setSemesterKey, currentPeriod } = useSemesterParam();
  const [query, setQuery] = useState('');
  const [classroomFilter, setClassroomFilter] = useState('all');
  const [editing, setEditing] = useState<StudentRow | null>(null);
  const [toast, setToast] = useState('');
  // Saved edits shown until the refetched data (which already has them) arrives.
  const [overrides, setOverrides] = useState<{ base: TeacherDashboardData | null; fields: Record<string, StudentFields> }>({
    base: null,
    fields: {},
  });

  const courses = useMemo(() => data?.courses || [], [data]);
  const classrooms = useMemo(() => data?.classrooms || [], [data]);
  const options = useMemo(() => semesterOptions(courses, classrooms, currentPeriod.yearCE), [courses, classrooms, currentPeriod.yearCE]);
  const inTerm = useMemo(
    () => filterClassroomsBySemester(classrooms, courses, semesterKey, currentPeriod.yearCE),
    [classrooms, courses, semesterKey, currentPeriod.yearCE]
  );
  // A classroom picked before switching term may not exist in the new one.
  const activeClassroomFilter = inTerm.some((c) => c.id === classroomFilter) ? classroomFilter : 'all';

  // Same count as the dashboard card: admitted students per classroom, summed.
  const seats = inTerm.reduce((sum, c) => sum + (c.students ? c.students.length : c.student_count || 0), 0);

  const rows = useMemo(() => {
    const pending = overrides.base === data ? overrides.fields : {};
    const byId = new Map<string, StudentRow>();
    for (const cls of inTerm) {
      if (activeClassroomFilter !== 'all' && cls.id !== activeClassroomFilter) continue;
      for (const raw of cls.students || []) {
        const student = pending[raw.id] ? { ...raw, ...pending[raw.id] } : raw;
        const row = byId.get(student.id);
        if (row) row.classrooms.push(cls);
        else byId.set(student.id, { student, classrooms: [cls] });
      }
    }
    return [...byId.values()].sort(
      (a, b) =>
        (a.student.student_id || '').localeCompare(b.student.student_id || '', undefined, { numeric: true }) ||
        fullName(a.student).localeCompare(fullName(b.student), 'th')
    );
  }, [inTerm, activeClassroomFilter, overrides, data]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ student }) =>
      [fullName(student), student.student_id, student.institution, student.email].some((field) => field?.toLowerCase().includes(q))
    );
  }, [rows, query]);

  const periodText =
    semesterKey === 'all'
      ? th ? 'ทุกภาคเรียน' : 'All semesters'
      : formatAcademicPeriod(Number(semesterKey.split('_')[0]), Number(semesterKey.split('_')[1]), language);

  const handleSaved = (studentId: string, fields: StudentFields) => {
    setOverrides((current) => ({
      base: data,
      fields: { ...(current.base === data ? current.fields : {}), [studentId]: fields },
    }));
    setEditing(null);
    setToast(th ? 'แก้ไขข้อมูลนักเรียนแล้ว' : 'Student updated');
    setTimeout(() => setToast(''), 3000);
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="space-y-3">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {th ? 'กลับแดชบอร์ด' : 'Back to dashboard'}
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Users className="w-6 h-6 text-emerald-500 shrink-0" />
              {th ? 'นักเรียนทั้งหมด' : 'All students'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {periodText} · {rows.length} {th ? 'คน' : 'students'}
              {activeClassroomFilter === 'all' && seats !== rows.length && !loading && (
                <> {th ? `(นับรวมทุกห้อง ${seats} ที่นั่ง)` : `(${seats} seats across classrooms)`}</>
              )}
            </p>
          </div>
          <SemesterSelect value={semesterKey} onChange={setSemesterKey} options={options} currentPeriod={currentPeriod} />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <label className="relative block flex-1 min-w-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={th ? 'ค้นหาชื่อ รหัส โรงเรียน หรืออีเมล' : 'Search name, student number, school or email'}
            className="w-full h-11 pl-9 pr-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-hidden focus:border-emerald-500"
          />
        </label>
        <select
          value={activeClassroomFilter}
          onChange={(e) => setClassroomFilter(e.target.value)}
          aria-label={th ? 'กรองตามห้องเรียน' : 'Filter by classroom'}
          className="h-11 px-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-emerald-500 cursor-pointer sm:max-w-xs"
        >
          <option value="all">{th ? `ทุกห้องเรียน (${inTerm.length})` : `All classrooms (${inTerm.length})`}</option>
          {inTerm.map((cls) => (
            <option key={cls.id} value={cls.id}>
              {classroomTitle(cls)} ({cls.students ? cls.students.length : cls.student_count || 0})
            </option>
          ))}
        </select>
      </div>

      {error && !data ? (
        <p className="text-sm text-rose-600 dark:text-rose-400 text-center py-12">
          {th ? 'โหลดข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง' : 'Could not load students. Please try again.'}
        </p>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-2xl bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="text-center py-14 px-6 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 space-y-2">
          <p className="text-sm font-bold text-slate-900 dark:text-white">
            {query ? (th ? 'ไม่พบนักเรียนที่ค้นหา' : 'No matching students') : th ? 'ยังไม่มีนักเรียนในภาคเรียนนี้' : 'No students this semester'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {th ? 'เชิญนักเรียนผ่าน LINE ได้ที่หน้าห้องเรียน' : 'Invite students through LINE from a classroom page.'}
          </p>
        </div>
      ) : (
        <ul className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
          {shown.map((row) => {
            const { student } = row;
            return (
              <li key={student.id} className="flex items-center gap-3 p-3 sm:px-4 min-w-0">
                <Avatar
                  src={student.avatar_url}
                  firstName={student.first_name}
                  lastName={student.last_name}
                  name={student.name}
                  className="w-10 h-10 text-sm"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{fullName(student)}</span>
                    <span className="font-mono text-[10px] text-slate-400">ID: {student.student_id || '-'}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {[student.institution && `🏫 ${student.institution}`, student.email].filter(Boolean).join(' • ') || ' '}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {row.classrooms.map((cls) => (
                      <Link
                        key={cls.id}
                        href={`/classrooms/${cls.id}?tab=people`}
                        className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/60 max-w-full truncate"
                      >
                        {classroomTitle(cls)}
                      </Link>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(row)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 hover:bg-amber-50 hover:text-amber-700 dark:hover:bg-amber-950/50 dark:hover:text-amber-300 cursor-pointer"
                  title={th ? 'แก้ไขชื่อ นามสกุล รหัสนักเรียน และโรงเรียน' : 'Edit student'}
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{th ? 'แก้ไข' : 'Edit'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <EditStudentModal
          // The edit applies to the student everywhere; any of their classrooms authorises it.
          classroomId={editing.classrooms[0].id}
          student={editing.student}
          teacherInstitution={data?.profile?.institution || undefined}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-70 px-4 py-2.5 rounded-2xl bg-slate-900 text-white text-xs font-bold shadow-xl inline-flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400" />
          {toast}
        </div>
      )}
    </div>
  );
}

export default function StudentsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50dvh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <StudentsContent />
    </Suspense>
  );
}
