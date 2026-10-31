'use client';

import { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BookOpen, Clock, MessageCircle, School, Search, Users } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useTeacherDashboardData } from '@/lib/hooks/useTeacherDashboardData';
import { useSemesterParam } from '@/lib/hooks/useSemesterParam';
import { SemesterSelect } from '@/components/SemesterSelect';
import { formatAcademicPeriod } from '@/lib/utils/academicYear';
import { roomLabel, subjectTitle } from '@/lib/utils/classroomLabel';
import { filterClassroomsBySemester, semesterOptions } from '@/lib/utils/semesterFilter';

/** Every classroom the teacher teaches (owner or co-teacher), filtered by term like the dashboard. */
function ClassroomsContent() {
  const { language } = useLanguage();
  const th = language === 'th';
  const { data, loading, error, teacherId } = useTeacherDashboardData();
  const { semesterKey, setSemesterKey, currentPeriod } = useSemesterParam();
  const [query, setQuery] = useState('');

  const courses = useMemo(() => data?.courses || [], [data]);
  const classrooms = useMemo(() => data?.classrooms || [], [data]);
  const options = useMemo(() => semesterOptions(courses, classrooms, currentPeriod.yearCE), [courses, classrooms, currentPeriod.yearCE]);
  const inTerm = useMemo(
    () => filterClassroomsBySemester(classrooms, courses, semesterKey, currentPeriod.yearCE),
    [classrooms, courses, semesterKey, currentPeriod.yearCE]
  );

  const assignmentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of data?.assignments || []) counts.set(a.classroom_id, (counts.get(a.classroom_id) || 0) + 1);
    return counts;
  }, [data]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inTerm;
    return inTerm.filter((cls) =>
      [cls.name, cls.course_name, cls.subject_code].some((field) => field?.toLowerCase().includes(q))
    );
  }, [inTerm, query]);

  const totalStudents = inTerm.reduce((sum, c) => sum + (c.students ? c.students.length : c.student_count || 0), 0);
  const periodText =
    semesterKey === 'all'
      ? th ? 'ทุกภาคเรียนและปีการศึกษา' : 'All semesters'
      : formatAcademicPeriod(Number(semesterKey.split('_')[0]), Number(semesterKey.split('_')[1]), language);

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="space-y-3">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {th ? 'กลับแดชบอร์ด' : 'Back to dashboard'}
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <School className="w-6 h-6 text-amber-500 shrink-0" />
              {th ? 'ห้องเรียนที่สอน' : 'My classrooms'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {periodText} · {inTerm.length} {th ? 'ห้อง' : 'classrooms'} · {totalStudents} {th ? 'นักเรียน' : 'students'}
            </p>
          </div>
          <SemesterSelect value={semesterKey} onChange={setSemesterKey} options={options} currentPeriod={currentPeriod} />
        </div>
      </div>

      <label className="relative block">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={th ? 'ค้นหาชื่อห้อง รหัสวิชา หรือชื่อวิชา' : 'Search room, subject code or name'}
          className="w-full h-11 pl-9 pr-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
        />
      </label>

      {loading && !data ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-40 rounded-3xl bg-slate-100 dark:bg-slate-800/60 animate-pulse" />
          ))}
        </div>
      ) : error && !data ? (
        <p className="text-sm text-rose-600 dark:text-rose-400 text-center py-12">
          {th ? 'โหลดข้อมูลห้องเรียนไม่สำเร็จ กรุณาลองใหม่' : 'Could not load classrooms. Please try again.'}
        </p>
      ) : shown.length === 0 ? (
        <div className="text-center py-14 px-6 bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 space-y-2">
          <p className="text-sm font-bold text-slate-900 dark:text-white">
            {query ? (th ? 'ไม่พบห้องเรียนที่ค้นหา' : 'No matching classrooms') : th ? 'ยังไม่มีห้องเรียนในภาคเรียนนี้' : 'No classrooms this semester'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {th ? 'ลองเลือกภาคเรียนอื่น หรือสร้างห้องเรียนจากแดชบอร์ด' : 'Try another semester, or create a classroom from the dashboard.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {shown.map((cls) => {
            const course = courses.find((c) => c.id === cls.course_id);
            const semester = cls.semester ?? course?.semester;
            const yearCE = cls.year_ce ?? course?.year_ce;
            const students = cls.students ? cls.students.length : cls.student_count || 0;
            const pending = cls.pending_students?.length || 0;
            const lineConnected = (cls.line_connection_status || (cls.line_group_id ? 'connected' : 'disconnected')) === 'connected';
            const coTeaching = !!teacherId && cls.teacher_id !== teacherId;
            return (
              <Link
                key={cls.id}
                href={`/classrooms/${cls.id}`}
                className="group bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-amber-400 dark:hover:border-amber-500 transition-all flex flex-col gap-3 min-w-0"
              >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400 truncate">{subjectTitle(cls)}</p>
                    <h2 className="text-base font-black text-slate-900 dark:text-white truncate">{roomLabel(cls) || cls.name}</h2>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-amber-500 group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                </div>

                <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                  {semester && yearCE ? (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      {formatAcademicPeriod(semester, yearCE, language)}
                    </span>
                  ) : null}
                  {coTeaching && (
                    <span className="px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300">
                      {th ? 'ผู้สอนร่วม' : 'Co-teacher'}
                    </span>
                  )}
                  <span
                    className={`px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                      lineConnected
                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <MessageCircle className="w-3 h-3" />
                    {lineConnected ? (th ? 'เชื่อม LINE แล้ว' : 'LINE linked') : th ? 'ยังไม่เชื่อม LINE' : 'LINE not linked'}
                  </span>
                </div>

                <div className="mt-auto flex items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-emerald-500" />
                    <b>{students}</b> {th ? 'คน' : 'students'}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-blue-500" />
                    <b>{assignmentCounts.get(cls.id) || 0}</b> {th ? 'งาน' : 'tasks'}
                  </span>
                  {pending > 0 && (
                    <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300 font-bold">
                      <Clock className="w-3.5 h-3.5" />
                      {th ? `รออนุมัติ ${pending}` : `${pending} pending`}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ClassroomsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50dvh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ClassroomsContent />
    </Suspense>
  );
}
