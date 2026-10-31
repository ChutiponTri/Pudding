'use client';

import React, { useMemo, useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useTeacherDashboardData } from '@/lib/hooks/useTeacherDashboardData';
import { Assignment, Classroom, Course } from '@/types/database';
import { dataService } from '@/lib/supabase/dataService';
import { AssignmentProgressCard, GradingBar } from '@/components/AssignmentProgressCard';
import { AssignmentStatusDialog } from '@/components/AssignmentStatusDialog';
import { BookOpen, FileCheck, ChevronRight, ArrowLeft, ShieldAlert, Clock, CheckCircle2, Check, School } from 'lucide-react';
import { getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { formatDateTime } from '@/lib/utils/datetime';
import { gradingCounts, type GradingCounts } from '@/lib/utils/gradingStatus';


type TaskItem = GradingCounts & { classroom: Classroom; assignment: Assignment };

type LocalEdits = { updated: Record<string, Assignment>; deleted: string[] };
const NO_EDITS: LocalEdits = { updated: {}, deleted: [] };

const belongsToCourse = (course: Course, cls: Classroom) => cls.course_id === course.id || !!cls.subject_code?.startsWith(course.code);

function GradingHubContent() {
  const { t, language } = useLanguage();
  const th = language === 'th';
  const searchParams = useSearchParams();
  const router = useRouter();
  // Same session-cached data as the dashboard; refetches while open whenever something changes (a grade is saved, a student hands in…).
  const { data, loading } = useTeacherDashboardData();

  // Editing from the task cards. Saves invalidate the session cache, so the
  // list above refetches on its own; local edits only cover the wait.
  const [statusAssignment, setStatusAssignment] = useState<Assignment | null>(null);
  const [localEdits, setLocalEdits] = useState<LocalEdits & { base: typeof data }>({ base: null, ...NO_EDITS });
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  // This page only picks the work to grade (course -> section/assignment).
  // Grading itself lives on /assignments/[id]/grading.
  const selectedCourseId = searchParams.get('courseId');
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
  // Edits made before the refetch arrives; a new copy of the data replaces them.
  const edits = localEdits.base === data ? localEdits : NO_EDITS;
  const assignments = useMemo(
    () => (data?.assignments || []).filter((a) => !edits.deleted.includes(a.id)).map((a) => edits.updated[a.id] || a),
    [data, edits]
  );
  const patchAssignment = (updated: Assignment | null, deletedId?: string) =>
    setLocalEdits((prev) => {
      const current = prev.base === data ? prev : NO_EDITS;
      return {
        base: data,
        updated: updated ? { ...current.updated, [updated.id]: { ...(current.updated[updated.id] || {}), ...updated } } : current.updated,
        deleted: deletedId ? [...current.deleted, deletedId] : current.deleted,
      };
    });

  const handleDeleteAssignment = async (assignment: Assignment) => {
    if (!confirm(th ? 'ลบงาน/ข้อสอบนี้? คำตอบและคะแนนทั้งหมดจะถูกลบด้วย' : 'Delete this task? All its answers and scores are removed.')) return;
    try {
      await dataService.deleteAssignment(assignment.id);
      patchAssignment(null, assignment.id);
      showToast(th ? 'ลบงาน/ข้อสอบแล้ว' : 'Deleted');
    } catch {
      showToast(th ? 'ลบงาน/ข้อสอบไม่สำเร็จ' : 'Could not delete');
    }
  };

  const handlePublishNow = async (assignment: Assignment) => {
    const kind = assignment.is_exam ? (th ? 'ข้อสอบ' : 'quiz') : th ? 'งาน' : 'assignment';
    if (!confirm(th
      ? `เผยแพร่${kind} "${assignment.title}" ตอนนี้เลยหรือไม่?\nนักเรียนจะเห็นและเริ่มทำได้ทันที และจะได้รับแจ้งเตือนใน LINE`
      : `Publish "${assignment.title}" now? Students can start right away and get a LINE notification.`)) return;
    try {
      const updated = await dataService.publishAssignmentNow(assignment.id);
      patchAssignment({ ...assignment, ...(updated || {}), publish_at: updated?.publish_at || new Date().toISOString() });
      showToast(th ? `เผยแพร่${kind}แล้ว นักเรียนเริ่มทำได้ทันที` : 'Published; students can start now');
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : th ? 'เผยแพร่งานไม่สำเร็จ' : 'Could not publish');
    }
  };
  const submissions = useMemo(() => data?.submissions || [], [data]);

  // Keep the view in the URL so "back" from the grading page returns to it.
  const setView = (next: { courseId?: string | null; classroomId?: string | null }) => {
    const params = new URLSearchParams();
    const courseId = next.courseId !== undefined ? next.courseId : selectedCourseId;
    if (courseId) {
      params.set('courseId', courseId);
      const cls = next.classroomId !== undefined ? next.classroomId : classroomFilter;
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
      // Leaving the screen is tracked during quizzes only, so only quizzes count flags.
      items.push({ classroom: cls, assignment: asg, ...gradingCounts(subs, cls.students?.length || cls.student_count || 0, asg.is_exam) });
    }
    return items;
  }, [assignments, classrooms, submissions]);

  // Level 1: one card per course, the ones with work left to grade first.
  const courseStats = useMemo(() => {
    return courses
      .map((course) => {
        const tasks = allTasks.filter((item) => item.assignment.course_id === course.id || belongsToCourse(course, item.classroom));
        const checkable = tasks.reduce((sum, i) => sum + i.checkable, 0);
        const graded = tasks.reduce((sum, i) => sum + i.graded, 0);
        return {
          course,
          sectionsCount: classrooms.filter((cls) => belongsToCourse(course, cls)).length,
          tasksCount: tasks.length,
          tasksToGrade: tasks.filter((i) => i.pending > 0).length,
          pending: tasks.reduce((sum, i) => sum + i.pending, 0),
          flagged: tasks.reduce((sum, i) => sum + i.flagged, 0),
          checkable,
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
  // Same split as the dashboard course cards: work left to grade, then everything else.
  const toGradeTasks = visibleTasks.filter((i) => i.pending > 0);
  const gradedTasks = visibleTasks.filter((i) => i.pending === 0);
  const currentHref = `/grading${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  const coursePending = courseTasks.reduce((sum, i) => sum + i.pending, 0);
  const courseCheckable = courseTasks.reduce((sum, i) => sum + i.checkable, 0);
  const courseGraded = courseTasks.reduce((sum, i) => sum + i.graded, 0);

  if (loading && !data) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-bold text-slate-500">{t('common.loading')}</span>
      </div>
    );
  }

  const renderTask = (item: TaskItem) => {
    const { classroom, assignment, ...counts } = item;
    const win = getAssignmentWindow(assignment);
    return (
      <AssignmentProgressCard
        key={`${classroom.id}-${assignment.id}`}
        assignment={assignment}
        counts={counts}
        classroomName={classroom.name}
        gradingHref={`/assignments/${assignment.id}/grading?from=grading&courseId=${encodeURIComponent(selectedCourse?.id || '')}`}
        editHref={`/assignments/new?edit=${assignment.id}&classroomId=${classroom.id}&from=grading&returnTo=${encodeURIComponent(currentHref)}`}
        onStatusClick={() => setStatusAssignment(assignment)}
        onDelete={() => handleDeleteAssignment(assignment)}
        onPublishNow={win.isScheduled || win.isDraft ? () => handlePublishNow(assignment) : undefined}
      />
    );
  };

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
          <span>{th ? 'ตรวจงาน' : 'Grading'}</span>
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
                <span>{th ? 'ขั้นที่ 1: เลือกรายวิชา' : 'Step 1: Select course'}</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight">
                {th ? 'ตรวจงานและข้อสอบ' : 'Grading Hub'}
              </h1>
              <p className="text-slate-900/90 text-xs md:text-sm font-medium max-w-2xl">
                {th
                  ? 'วิชาที่ยังตรวจไม่ครบจะแสดงก่อน พร้อมจำนวนงานที่เหลือ'
                  : 'Courses with work left to grade come first.'}
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
              {courseStats.map(({ course, sectionsCount, tasksCount, tasksToGrade, pending, flagged, checkable, graded }) => {
                const done = pending === 0;
                return (
                  <button
                    type="button"
                    key={course.id}
                    onClick={() => setView({ courseId: course.id, classroomId: null })}
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
                          {checkable > 0
                            ? th ? `ตรวจแล้วทั้งหมด ${graded} ชิ้น` : `All ${graded} checked`
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
                      {checkable > 0 && (
                        <div className="mt-2 space-y-1">
                          <GradingBar graded={graded} pending={pending} notSubmitted={0} />
                          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                            {th ? `ตรวจแล้ว ${graded}/${checkable} ชิ้น` : `${graded}/${checkable} checked`}
                          </p>
                        </div>
                      )}
                    </div>

                    {flagged > 0 && (
                      <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-[11px] font-bold flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>{th ? `สลับหน้าจอ ${flagged} รายการ` : `${flagged} integrity flags`}</span>
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
                  <span className="text-[11px] font-semibold text-slate-400 ml-1">/ {courseCheckable}</span>
                </span>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 block">{th ? 'งานที่ตรวจครบ' : 'Tasks done'}</span>
                <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
                  {courseTasks.filter((i) => i.pending === 0).length}
                  <span className="text-[11px] font-semibold text-slate-400 ml-1">/ {courseTasks.length}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Classroom filter */}
          <div className="space-y-3">
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
                {th ? 'ยังไม่มีงานในรายวิชานี้' : 'No tasks assigned in this course yet.'}
              </p>
              <Link
                href="/creation"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs shadow-xs"
              >
                <span>+ {t('dashboard.quick_actions.create_assignment')}</span>
              </Link>
            </div>
          ) : (
            <div className="space-y-6">
              {/* ต้องตรวจ */}
              <section className="space-y-3">
                <h2 className="px-1 flex items-center gap-2 text-sm font-black text-amber-700 dark:text-amber-400">
                  <Clock className="w-4 h-4" />
                  <span>{th ? 'ต้องตรวจ' : 'To grade'}</span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[11px]">{toGradeTasks.length}</span>
                </h2>
                {toGradeTasks.length === 0 ? (
                  <div className="p-6 rounded-3xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 text-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                    <p className="mt-2 text-sm font-bold text-emerald-700 dark:text-emerald-300">{th ? 'ตรวจครบทุกงานแล้ว 🎉' : 'Nothing left to grade 🎉'}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">{toGradeTasks.map(renderTask)}</div>
                )}
              </section>

              {/* ตรวจครบแล้ว */}
              {gradedTasks.length > 0 && (
                <section className="space-y-3">
                  <h2 className="px-1 flex items-center gap-2 text-sm font-black text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{th ? 'ตรวจครบแล้ว' : 'Graded'}</span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-[11px]">{gradedTasks.length}</span>
                  </h2>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">{gradedTasks.map(renderTask)}</div>
                </section>
              )}
            </div>
          )}
        </div>
      )}

      {statusAssignment && (
        <AssignmentStatusDialog
          assignment={statusAssignment}
          onClose={() => setStatusAssignment(null)}
          onSaved={(updated, action) => {
            patchAssignment(updated);
            setStatusAssignment(null);
            const kind = updated.is_exam ? (th ? 'ข้อสอบ' : 'quiz') : th ? 'งาน' : 'assignment';
            showToast(
              action === 'published'
                ? th ? `🚀 เผยแพร่${kind} “${updated.title}” แล้ว` : `🚀 Published “${updated.title}”`
                : updated.status_override === 'force_closed'
                ? th ? `🔒 ปิดรับ${kind} “${updated.title}” แล้ว` : `🔒 Closed “${updated.title}”`
                : updated.status_override === 'extended'
                ? th ? `⏳ ขยายเวลาส่ง${kind} “${updated.title}” ถึง ${formatDateTime(updated.extended_until, language)} แล้ว` : `⏳ Extended “${updated.title}”`
                : th ? `${kind} “${updated.title}” กลับไปรับงานตามกำหนดส่งแล้ว` : `“${updated.title}” is back on its deadline`
            );
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-[max(env(safe-area-inset-bottom),1rem)] inset-x-4 sm:inset-x-auto sm:right-6 sm:bottom-6 z-60 p-4 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold shadow-2xl flex items-center gap-2.5 text-sm animate-in fade-in slide-in-from-bottom-5">
          <Check className="w-4 h-4" />
          <span>{toast}</span>
        </div>
      )}
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
