'use client';

import React, { useMemo, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useTeacherDashboardData } from '@/lib/hooks/useTeacherDashboardData';
import { Assignment, Classroom, Course } from '@/types/database';
import {
  BookOpen,
  FileCheck,
  ChevronRight,
  ArrowLeft,
  ShieldAlert,
  Clock,
  CheckCircle2,
  Lock,
  Unlock,
  Calendar,
  Inbox,
  ListChecks,
  School,
} from 'lucide-react';
import { ASSIGNMENT_STATUS_CLASSES, getAssignmentStatus, getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { formatDateTime } from '@/lib/utils/datetime';
import { isGraded, isHandedIn, needsGrading } from '@/lib/utils/gradingStatus';

type TaskTab = 'pending' | 'done' | 'waiting';

type TaskItem = {
  classroom: Classroom;
  assignment: Assignment;
  totalStudents: number;
  handedIn: number;
  graded: number;
  pending: number;
  notSubmitted: number;
  flagged: number;
};

const belongsToCourse = (course: Course, cls: Classroom) => cls.course_id === course.id || !!cls.subject_code?.startsWith(course.code);

/** Graded / waiting for the teacher / not handed in, as one bar. */
function GradingBar({ graded, pending, notSubmitted }: { graded: number; pending: number; notSubmitted: number }) {
  const total = graded + pending + notSubmitted || 1;
  return (
    <div className="flex w-full h-2 rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(graded / total) * 100}%` }} />
      <div className="h-full bg-amber-400 transition-all" style={{ width: `${(pending / total) * 100}%` }} />
    </div>
  );
}

function GradingHubContent() {
  const { t, language } = useLanguage();
  const th = language === 'th';
  const searchParams = useSearchParams();
  const router = useRouter();
  // Same session-cached data as the dashboard; refetches while open whenever something changes (a grade is saved, a student hands in…).
  const { data, loading } = useTeacherDashboardData();

  // This page only picks the work to grade (course -> section/assignment).
  // Grading itself lives on /assignments/[id]/grading.
  const selectedCourseId = searchParams.get('courseId');
  const tabParam = searchParams.get('tab') as TaskTab | null;
  const classroomFilter = searchParams.get('classroomId');

  // Old links pointed at ?assignmentId=…; send them to the grading page.
  const legacyAssignmentId = searchParams.get('assignmentId');
  useEffect(() => {
    if (!legacyAssignmentId) return;
    router.replace(
      `/assignments/${legacyAssignmentId}/grading?from=grading${selectedCourseId ? `&courseId=${encodeURIComponent(selectedCourseId)}` : ''}`
    );
  }, [legacyAssignmentId, router, selectedCourseId]);

  const courses = useMemo(() => data?.courses || [], [data]);
  const classrooms = useMemo(() => data?.classrooms || [], [data]);
  const assignments = useMemo(() => data?.assignments || [], [data]);
  const submissions = useMemo(() => data?.submissions || [], [data]);

  // Keep the view in the URL so "back" from the grading page returns to it.
  const setView = (next: { courseId?: string | null; tab?: TaskTab | null; classroomId?: string | null }) => {
    const params = new URLSearchParams();
    const courseId = next.courseId !== undefined ? next.courseId : selectedCourseId;
    if (courseId) {
      params.set('courseId', courseId);
      const tab = next.tab !== undefined ? next.tab : tabParam;
      const cls = next.classroomId !== undefined ? next.classroomId : classroomFilter;
      if (tab) params.set('tab', tab);
      if (cls) params.set('classroomId', cls);
    }
    const query = params.toString();
    router.replace(query ? `/grading?${query}` : '/grading', { scroll: false });
  };
  const handleResetToCourses = () => setView({ courseId: null });

  const selectedCourse = useMemo(() => courses.find((c) => c.id === selectedCourseId) || null, [courses, selectedCourseId]);

  // Every assignment with its counts, per classroom.
  const allTasks = useMemo(() => {
    const subsByAssignment = new Map<string, typeof submissions>();
    for (const s of submissions) subsByAssignment.set(s.assignment_id, [...(subsByAssignment.get(s.assignment_id) || []), s]);
    const byClassroom = new Map(classrooms.map((c) => [c.id, c]));
    const items: TaskItem[] = [];
    for (const asg of assignments) {
      const cls = byClassroom.get(asg.classroom_id);
      if (!cls) continue;
      const subs = subsByAssignment.get(asg.id) || [];
      const handedIn = subs.filter(isHandedIn).length;
      const totalStudents = cls.students?.length || cls.student_count || 0;
      items.push({
        classroom: cls,
        assignment: asg,
        totalStudents,
        handedIn,
        graded: subs.filter((s) => isHandedIn(s) && isGraded(s)).length,
        pending: subs.filter(needsGrading).length,
        notSubmitted: Math.max(0, totalStudents - handedIn),
        // Leaving the screen is tracked during quizzes only.
        flagged: asg.is_exam ? subs.filter((s) => s.is_flagged_suspicious).length : 0,
      });
    }
    return items;
  }, [assignments, classrooms, submissions]);

  // Level 1: one card per course, the ones with work left to grade first.
  const courseStats = useMemo(() => {
    return courses
      .map((course) => {
        const tasks = allTasks.filter((item) => item.assignment.course_id === course.id || belongsToCourse(course, item.classroom));
        const handedIn = tasks.reduce((sum, i) => sum + i.handedIn, 0);
        const graded = tasks.reduce((sum, i) => sum + i.graded, 0);
        return {
          course,
          sectionsCount: classrooms.filter((cls) => belongsToCourse(course, cls)).length,
          tasksCount: tasks.length,
          tasksToGrade: tasks.filter((i) => i.pending > 0).length,
          pending: tasks.reduce((sum, i) => sum + i.pending, 0),
          flagged: tasks.reduce((sum, i) => sum + i.flagged, 0),
          handedIn,
          graded,
        };
      })
      .sort((a, b) => Number(b.pending > 0) - Number(a.pending > 0));
  }, [courses, classrooms, allTasks]);

  const totalPending = courseStats.reduce((sum, c) => sum + c.pending, 0);
  const coursesToGrade = courseStats.filter((c) => c.pending > 0).length;

  // Level 2: the selected course's work, split by what still needs the teacher.
  const courseTasks = useMemo(() => {
    if (!selectedCourse) return [];
    return allTasks
      .filter((item) => item.assignment.course_id === selectedCourse.id || belongsToCourse(selectedCourse, item.classroom))
      .sort((a, b) => {
        const da = getAssignmentWindow(a.assignment).deadline ?? 0;
        const db = getAssignmentWindow(b.assignment).deadline ?? 0;
        return db - da;
      });
  }, [selectedCourse, allTasks]);

  const courseSections = useMemo(() => {
    const seen = new Map<string, Classroom>();
    courseTasks.forEach((item) => seen.set(item.classroom.id, item.classroom));
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'th'));
  }, [courseTasks]);

  const visibleTasks = classroomFilter ? courseTasks.filter((item) => item.classroom.id === classroomFilter) : courseTasks;
  const groups: Record<TaskTab, TaskItem[]> = {
    pending: visibleTasks.filter((i) => i.pending > 0),
    done: visibleTasks.filter((i) => i.pending === 0 && i.handedIn > 0),
    waiting: visibleTasks.filter((i) => i.handedIn === 0),
  };
  const activeTab: TaskTab = tabParam && groups[tabParam] ? tabParam : groups.pending.length > 0 || !groups.done.length ? 'pending' : 'done';
  const coursePending = courseTasks.reduce((sum, i) => sum + i.pending, 0);
  const courseHandedIn = courseTasks.reduce((sum, i) => sum + i.handedIn, 0);
  const courseGraded = courseTasks.reduce((sum, i) => sum + i.graded, 0);

  if (loading && !data) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-bold text-slate-500">{t('common.loading')}</span>
      </div>
    );
  }

  const tabs: Array<{ id: TaskTab; label: string; icon: React.ElementType; active: string; badge: string }> = [
    {
      id: 'pending',
      label: th ? 'ต้องตรวจ' : 'To grade',
      icon: Clock,
      active: 'bg-amber-500 text-slate-950',
      badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    },
    {
      id: 'done',
      label: th ? 'ตรวจครบแล้ว' : 'Graded',
      icon: CheckCircle2,
      active: 'bg-emerald-600 text-white',
      badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    },
    {
      id: 'waiting',
      label: th ? 'ยังไม่มีผู้ส่ง' : 'No submissions',
      icon: Inbox,
      active: 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900',
      badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    },
  ];

  return (
    <div className="pb-20 space-y-5 sm:space-y-6">
      {/* BREADCRUMB */}
      <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-slate-500 dark:text-slate-400 min-w-0">
        <button
          type="button"
          onClick={handleResetToCourses}
          className={`hover:text-amber-600 dark:hover:text-amber-400 transition-colors cursor-pointer flex items-center gap-1.5 ${
            !selectedCourse ? 'text-amber-600 dark:text-amber-400 font-black' : ''
          }`}
        >
          <FileCheck className="w-4 h-4" />
          <span>{th ? 'ตรวจข้อสอบ & วิเคราะห์' : 'Grading & Integrity'}</span>
        </button>
        {selectedCourse && (
          <>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-900 dark:text-white font-black truncate">
              <span className="font-mono">{selectedCourse.code}</span> {selectedCourse.name}
            </span>
          </>
        )}
      </nav>

      {/* ========================================================================= */}
      {/* LEVEL 1: COURSES                                                          */}
      {/* ========================================================================= */}
      {!selectedCourse && (
        <div className="space-y-5 sm:space-y-6 animate-in fade-in">
          <div className="bg-linear-to-br from-amber-400 via-orange-400 to-amber-500 rounded-3xl p-5 sm:p-6 md:p-8 text-slate-950 shadow-xl shadow-amber-500/15 flex flex-col md:flex-row md:items-center justify-between gap-5 sm:gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/10 backdrop-blur-xs text-xs font-bold text-slate-900">
                <span>📝</span>
                <span>{th ? 'ขั้นตอนที่ 1 : เลือกรหัสวิชาที่ต้องการตรวจ' : 'Step 1 : Select Course'}</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">
                {th ? 'ระบบตรวจข้อสอบและการบ้านอัจฉริยะ' : 'Grading & Integrity Assessment Hub'}
              </h1>
              <p className="text-slate-900/90 text-xs md:text-sm font-medium max-w-2xl">
                {th
                  ? 'เลือกรายวิชาด้านล่าง วิชาที่ยังตรวจไม่ครบจะแสดงก่อน พร้อมจำนวนงานที่เหลือ'
                  : 'Pick a course below. Courses with work left to grade come first, with what is left.'}
              </p>
            </div>

            <div className="px-5 py-4 rounded-2xl bg-white/95 text-slate-950 shadow-lg ring-1 ring-white/60 text-center md:min-w-44 shrink-0">
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                {th ? 'งานรอตรวจทั้งหมด' : 'Total to grade'}
              </span>
              <span className={`text-3xl font-black block mt-0.5 ${totalPending > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {totalPending}
              </span>
              <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">
                {totalPending > 0
                  ? th ? `ชิ้นงาน ใน ${coursesToGrade} วิชา` : `submissions in ${coursesToGrade} courses`
                  : th ? 'ตรวจครบทุกวิชาแล้ว 🎉' : 'Everything is graded 🎉'}
              </span>
            </div>
          </div>

          {courseStats.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 p-12 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 text-center space-y-3">
              <BookOpen className="w-10 h-10 text-slate-400 mx-auto" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{th ? 'ยังไม่มีรายวิชา' : 'No courses yet.'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
              {courseStats.map(({ course, sectionsCount, tasksCount, tasksToGrade, pending, flagged, handedIn, graded }) => {
                const done = pending === 0;
                return (
                  <button
                    type="button"
                    key={course.id}
                    onClick={() => setView({ courseId: course.id, tab: null, classroomId: null })}
                    className={`group text-left bg-white dark:bg-slate-900 rounded-3xl border p-4 sm:p-5 flex flex-col gap-4 shadow-xs hover:shadow-lg transition-all cursor-pointer ${
                      done
                        ? 'border-slate-200 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-emerald-600'
                        : 'border-amber-300 dark:border-amber-800/70 hover:border-amber-500'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-3 py-1 rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-300 font-mono text-xs font-black border border-amber-200 dark:border-amber-900">
                        {course.code}
                      </span>
                      {done ? (
                        <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{th ? 'ตรวจครบแล้ว' : 'All graded'}</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[11px] font-bold flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{th ? 'ยังตรวจไม่ครบ' : 'Not finished'}</span>
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <h3 className="text-base font-black text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors line-clamp-2">
                        {course.name}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {sectionsCount} {th ? 'ห้อง' : 'sections'} · {tasksCount} {th ? 'งาน/ข้อสอบ' : 'tasks'}
                      </p>
                    </div>

                    {/* What is left, in words and as a bar */}
                    <div className={`p-3 rounded-2xl ${done ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-amber-50 dark:bg-amber-950/30'}`}>
                      {done ? (
                        <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                          {handedIn > 0
                            ? th ? `ตรวจแล้วทั้งหมด ${graded} ชิ้น` : `All ${graded} submissions graded`
                            : th ? 'ยังไม่มีนักเรียนส่งงาน' : 'No submissions yet'}
                        </p>
                      ) : (
                        <p className="text-xs font-bold text-amber-800 dark:text-amber-300">
                          {th ? (
                            <>เหลือตรวจ <span className="text-lg font-black">{pending}</span> ชิ้น ใน {tasksToGrade} งาน</>
                          ) : (
                            <><span className="text-lg font-black">{pending}</span> left to grade in {tasksToGrade} tasks</>
                          )}
                        </p>
                      )}
                      {handedIn > 0 && (
                        <div className="mt-2 space-y-1">
                          <GradingBar graded={graded} pending={pending} notSubmitted={0} />
                          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                            {th ? `ตรวจแล้ว ${graded}/${handedIn} ชิ้นที่ส่งมา` : `${graded}/${handedIn} handed-in graded`}
                          </p>
                        </div>
                      )}
                    </div>

                    {flagged > 0 && (
                      <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-[11px] font-bold flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>{th ? `พบพฤติกรรมสลับหน้าจอ ${flagged} รายการ` : `${flagged} integrity flags`}</span>
                      </div>
                    )}

                    <span
                      className={`mt-auto w-full py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-colors ${
                        done
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 group-hover:bg-slate-200 dark:group-hover:bg-slate-700'
                          : 'bg-amber-500 group-hover:bg-amber-600 text-slate-950 shadow-md shadow-amber-500/20'
                      }`}
                    >
                      <span>{done ? (th ? 'ดูงานในวิชานี้' : 'View tasks') : th ? 'ไปตรวจงาน' : 'Start grading'}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* LEVEL 2: TASKS IN THE SELECTED COURSE                                     */}
      {/* ========================================================================= */}
      {selectedCourse && (
        <div className="space-y-4 sm:space-y-5 animate-in fade-in">
          {/* Course header + summary */}
          <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <span className="inline-flex px-3 py-1 rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-300 font-mono text-xs font-black border border-amber-200 dark:border-amber-900">
                  {selectedCourse.code}
                </span>
                <h1 className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white">{selectedCourse.name}</h1>
              </div>
              <button
                type="button"
                onClick={handleResetToCourses}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">{th ? 'เปลี่ยนรายวิชา' : 'Switch course'}</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <div className={`p-3 rounded-2xl ${coursePending > 0 ? 'bg-amber-50 dark:bg-amber-950/40' : 'bg-emerald-50 dark:bg-emerald-950/40'}`}>
                <span className={`text-[11px] font-bold block ${coursePending > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                  {th ? 'รอตรวจ' : 'To grade'}
                </span>
                <span className={`text-xl sm:text-2xl font-black ${coursePending > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                  {coursePending}
                  <span className="text-[11px] font-semibold ml-1">{th ? 'ชิ้น' : ''}</span>
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">{th ? 'ตรวจแล้ว' : 'Graded'}</span>
                <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                  {courseGraded}
                  <span className="text-[11px] font-semibold text-slate-400 ml-1">/ {courseHandedIn}</span>
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">{th ? 'งานที่ตรวจครบ' : 'Tasks done'}</span>
                <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                  {courseTasks.filter((i) => i.pending === 0 && i.handedIn > 0).length}
                  <span className="text-[11px] font-semibold text-slate-400 ml-1">/ {courseTasks.length}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Tabs + classroom filter */}
          <div className="space-y-3">
            <div className="flex gap-1.5 p-1 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs overflow-x-auto">
              {tabs.map(({ id, label, icon: Icon, active, badge }) => {
                const selected = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setView({ tab: id })}
                    className={`flex-1 min-w-max px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      selected ? active : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                    <span className={`px-1.5 min-w-5 rounded-full text-[10px] font-black ${selected ? 'bg-black/10 dark:bg-white/20' : badge}`}>
                      {groups[id].length}
                    </span>
                  </button>
                );
              })}
            </div>

            {courseSections.length > 1 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <School className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                {[null, ...courseSections].map((cls) => {
                  const selected = (cls?.id || null) === (classroomFilter || null);
                  return (
                    <button
                      key={cls?.id || 'all'}
                      type="button"
                      onClick={() => setView({ classroomId: cls?.id || null })}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
                        selected
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-slate-300'
                      }`}
                    >
                      {cls ? cls.name : th ? 'ทุกห้อง' : 'All sections'}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Task list */}
          {courseTasks.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 p-12 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 text-center space-y-3">
              <BookOpen className="w-10 h-10 text-slate-400 mx-auto" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                {th ? 'ยังไม่มีชิ้นงานหรือข้อสอบในรายวิชานี้' : 'No tasks assigned in this course yet.'}
              </p>
              <Link
                href="/creation"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs shadow-xs"
              >
                <span>+ {t('dashboard.quick_actions.create_assignment')}</span>
              </Link>
            </div>
          ) : groups[activeTab].length === 0 ? (
            <div className="bg-white dark:bg-slate-900 p-10 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 text-center space-y-2">
              {activeTab === 'pending' ? (
                <>
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{th ? 'ตรวจครบทุกงานแล้ว 🎉' : 'Nothing left to grade 🎉'}</p>
                </>
              ) : (
                <>
                  <ListChecks className="w-10 h-10 text-slate-400 mx-auto" />
                  <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{t('common.no_data')}</p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
              {groups[activeTab].map((item) => (
                <TaskCard key={`${item.classroom.id}-${item.assignment.id}`} item={item} courseId={selectedCourse.id} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskCard({ item, courseId }: { item: TaskItem; courseId: string }) {
  const { language } = useLanguage();
  const th = language === 'th';
  const { assignment, classroom, totalStudents, handedIn, graded, pending, notSubmitted, flagged } = item;
  const win = getAssignmentWindow(assignment);
  const status = getAssignmentStatus(win, assignment.is_exam, language);
  const StatusIcon = status.tone === 'closed' ? Lock : status.tone === 'late' ? Unlock : Clock;
  const deadline = win.deadline != null ? formatDateTime(new Date(win.deadline).toISOString(), language) : null;
  const done = pending === 0 && handedIn > 0;

  return (
    <div
      className={`bg-white dark:bg-slate-900 rounded-3xl border p-4 sm:p-5 flex flex-col gap-4 shadow-xs transition-colors ${
        pending > 0 ? 'border-amber-300 dark:border-amber-800/70' : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      {/* Where it belongs, what it is, and whether it still takes work */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-[11px]">
            {classroom.name}
          </span>
          <span
            className={`px-2 py-0.5 rounded-lg text-[11px] font-bold ${
              assignment.is_exam
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
            }`}
          >
            {assignment.is_exam ? (th ? 'ข้อสอบ' : 'Quiz') : th ? 'การบ้าน/ใบงาน' : 'Assignment'}
          </span>
          <span
            className={`ml-auto px-2 py-0.5 rounded-full border text-[11px] font-bold inline-flex items-center gap-1 ${ASSIGNMENT_STATUS_CLASSES[status.tone]}`}
            title={status.note || undefined}
          >
            <StatusIcon className="w-3 h-3" />
            {status.label}
          </span>
        </div>
        <h3 className="text-base font-black text-slate-900 dark:text-white leading-snug line-clamp-2">{assignment.title}</h3>
        {deadline && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {assignment.is_exam ? (th ? 'ปิดรับ' : 'Closes') : th ? 'กำหนดส่ง' : 'Due'} {deadline}
          </p>
        )}
      </div>

      {/* Grading state, in words */}
      <div
        className={`px-3 py-2.5 rounded-2xl flex items-center gap-2 text-xs font-bold ${
          pending > 0
            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
            : done
            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
            : 'bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400'
        }`}
      >
        {pending > 0 ? <Clock className="w-4 h-4 shrink-0" /> : done ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <Inbox className="w-4 h-4 shrink-0" />}
        <span>
          {pending > 0
            ? th ? `รอตรวจ ${pending} คน` : `${pending} waiting to be graded`
            : done
            ? th ? 'ตรวจครบทุกคนที่ส่งแล้ว' : 'Every submission is graded'
            : th ? 'ยังไม่มีนักเรียนส่งงาน' : 'No one has handed in yet'}
        </span>
        {flagged > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 text-[10px]">
            <ShieldAlert className="w-3 h-3" />
            {th ? `สลับจอ ${flagged}` : `${flagged} flagged`}
          </span>
        )}
      </div>

      {/* Who handed in and who has been graded */}
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">{th ? 'ส่งแล้ว' : 'Handed in'}</span>
            <span className="text-sm font-black text-slate-900 dark:text-white">
              {handedIn}
              <span className="text-[10px] font-semibold text-slate-400">/{totalStudents}</span>
            </span>
          </div>
          <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">{th ? 'ยังไม่ส่ง' : 'Missing'}</span>
            <span className={`text-sm font-black ${notSubmitted > 0 ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}>{notSubmitted}</span>
          </div>
          <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60">
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block">{th ? 'ตรวจแล้ว' : 'Graded'}</span>
            <span className={`text-sm font-black ${done ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
              {graded}
              <span className="text-[10px] font-semibold text-slate-400">/{handedIn}</span>
            </span>
          </div>
        </div>
        <GradingBar graded={graded} pending={pending} notSubmitted={notSubmitted} />
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />{th ? 'ตรวจแล้ว' : 'Graded'}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />{th ? 'รอตรวจ' : 'To grade'}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-200 dark:bg-slate-700" />{th ? 'ยังไม่ส่ง' : 'Missing'}</span>
        </div>
      </div>

      <Link
        href={`/assignments/${assignment.id}/grading?from=grading&courseId=${encodeURIComponent(courseId)}`}
        className={`mt-auto w-full py-3 rounded-2xl font-black text-xs flex items-center justify-center gap-2 transition-colors ${
          pending > 0
            ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md shadow-amber-500/20'
            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200'
        }`}
      >
        <span>
          {pending > 0
            ? th ? `ตรวจงาน (${pending} คน)` : `Grade (${pending})`
            : th ? 'ดูรายชื่อ & คะแนน' : 'View roster & scores'}
        </span>
        <ChevronRight className="w-4 h-4" />
      </Link>
    </div>
  );
}

export default function GradingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <GradingHubContent />
    </Suspense>
  );
}
