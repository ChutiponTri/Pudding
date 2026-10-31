'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { fetchCached, readCache, TEACHER_DASHBOARD_CACHE_KEY, watchClassrooms } from '@/lib/cache/sessionCache';
import {
  Assignment,
  Classroom,
  Course,
  Question,
  Submission,
  SubmissionAnswer,
  SubmissionEvent,
  SubmissionOverrideStatus,
  TeacherRole,
} from '@/types/database';
import { AntiCheatingBadge } from '@/components/AntiCheatingBadge';
import { IntegrityAuditModal } from '@/components/IntegrityAuditModal';
import { GradingWorkspace } from '@/components/GradingWorkspace';
import {
  BookOpen,
  School,
  FileCheck,
  ChevronRight,
  ArrowLeft,
  Search,
  Filter,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  FileText,
  Lock,
  Unlock,
  RotateCcw,
  Check,
  Calendar,
  Layers,
  Sparkles,
  ExternalLink,
  Users,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { ASSIGNMENT_STATUS_CLASSES, getAssignmentStatus, getAssignmentWindow } from '@/lib/utils/assignmentWindow';


function GradingHubContent() {
  const { t, language } = useLanguage();
  const { user: clerkUser } = useUser();
  const searchParams = useSearchParams();
  const router = useRouter();

  // This page only picks the work to grade (course -> section/assignment).
  // Grading itself lives on /assignments/[id]/grading.
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(
    searchParams.get('courseId') || null
  );

  // Core Data
  const [courses, setCourses] = useState<Course[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  // Old links pointed at ?assignmentId=…; send them to the grading page.
  const legacyAssignmentId = searchParams.get('assignmentId');
  useEffect(() => {
    if (!legacyAssignmentId) return;
    const courseId = searchParams.get('courseId');
    router.replace(
      `/assignments/${legacyAssignmentId}/grading?from=grading${courseId ? `&courseId=${encodeURIComponent(courseId)}` : ''}`
    );
  }, [legacyAssignmentId, router, searchParams]);

  // Load Initial Data
  const loadInitialData = async (teacherId: string) => {
    const apply = (data: Awaited<ReturnType<typeof dataService.getTeacherDashboard>>) => {
      setCourses(data.courses);
      setClassrooms(data.classrooms);
      setAssignments(data.assignments);
      setAllSubmissions(data.submissions);
      watchClassrooms(data.classrooms.map((c) => c.id));
    };
    // Same data as the dashboard: this session's copy shows at once and is
    // refetched only if something may have changed since.
    const hit = readCache<Parameters<typeof apply>[0]>(TEACHER_DASHBOARD_CACHE_KEY, teacherId);
    if (hit) {
      apply(hit.value);
      setLoading(false);
      if (hit.fresh) return;
    } else {
      setLoading(true);
    }
    try {
      // Only this teacher's courses, sections, work and submission counts, in one request.
      apply(await fetchCached(TEACHER_DASHBOARD_CACHE_KEY, teacherId, () => dataService.getTeacherDashboard()));
    } catch (err) {
      console.error('Error loading grading hub data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (clerkUser?.id) loadInitialData(clerkUser.id);
  }, [clerkUser?.id]);

  // Selected Course
  const selectedCourse = useMemo(() => {
    return courses.find((c) => c.id === selectedCourseId) || null;
  }, [courses, selectedCourseId]);

  // Keep the selected course in the URL so "back" from the grading page returns here.
  const selectCourse = (courseId: string | null) => {
    setSelectedCourseId(courseId);
    router.replace(courseId ? `/grading?courseId=${encodeURIComponent(courseId)}` : '/grading', { scroll: false });
  };
  const handleSelectCourse = (courseId: string) => selectCourse(courseId);
  const handleResetToCourses = () => selectCourse(null);

  // Calculate stats for Level 1 (Courses Overview)
  const courseStats = useMemo(() => {
    return courses.map((course) => {
      const courseClassrooms = classrooms.filter(
        (cls) => cls.course_id === course.id || cls.subject_code?.startsWith(course.code)
      );
      const courseAssignments = assignments.filter(
        (asg) =>
          asg.course_id === course.id ||
          courseClassrooms.some((c) => c.id === asg.classroom_id)
      );

      const courseSubmissions = allSubmissions.filter((sub) =>
        courseAssignments.some((a) => a.id === sub.assignment_id)
      );

      const pendingCount = courseSubmissions.filter(
        (s) => (s.status === 'submitted' || s.status === 'late') && s.total_score == null
      ).length;

      // Leaving the screen is tracked during quizzes only.
      const suspiciousCount = courseSubmissions.filter(
        (s) => s.is_flagged_suspicious && courseAssignments.some((a) => a.id === s.assignment_id && a.is_exam)
      ).length;

      const submittedCount = courseSubmissions.filter(
        (s) => s.status === 'submitted' || s.status === 'late'
      ).length;

      return {
        course,
        sectionsCount: courseClassrooms.length,
        assignmentsCount: courseAssignments.length,
        pendingCount,
        suspiciousCount,
        submittedCount,
        totalEnrolled: courseClassrooms.reduce(
          (sum, c) => sum + (c.students?.length || c.student_count || 0),
          0
        ),
      };
    });
  }, [courses, classrooms, assignments, allSubmissions]);

  // Calculate sections and tasks for Level 2 (Selected Course)
  const sectionItems = useMemo(() => {
    if (!selectedCourse) return [];
    const courseSections = classrooms.filter(
      (cls) =>
        cls.course_id === selectedCourse.id ||
        cls.subject_code?.startsWith(selectedCourse.code)
    );

    const items: Array<{
      classroom: Classroom;
      assignment: Assignment;
      totalStudents: number;
      submittedCount: number;
      pendingCount: number;
      notSubmittedCount: number;
      lateCount: number;
      flaggedCount: number;
      gradedCount: number;
    }> = [];

    for (const cls of courseSections) {
      const clsAssignments = assignments.filter((a) => a.classroom_id === cls.id);
      const studentsList = cls.students || [];

      for (const asg of clsAssignments) {
        const asgSubs = allSubmissions.filter((s) => s.assignment_id === asg.id);
        const submitted = asgSubs.filter((s) => s.status === 'submitted' || s.status === 'late');
        const late = asgSubs.filter((s) => s.status === 'late');
        const flagged = asg.is_exam ? asgSubs.filter((s) => s.is_flagged_suspicious) : [];
        const graded = asgSubs.filter((s) => s.total_score != null);
        const pending = asgSubs.filter(
          (s) => (s.status === 'submitted' || s.status === 'late') && s.total_score == null
        );
        const notSubmittedCount = Math.max(0, studentsList.length - submitted.length);

        items.push({
          classroom: cls,
          assignment: asg,
          totalStudents: studentsList.length,
          submittedCount: submitted.length,
          pendingCount: pending.length,
          notSubmittedCount,
          lateCount: late.length,
          flaggedCount: flagged.length,
          gradedCount: graded.length,
        });
      }
    }

    return items;
  }, [selectedCourse, classrooms, assignments, allSubmissions]);

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-bold text-slate-500">{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50/60 dark:bg-slate-950 pb-20 transition-colors">
      {/* Main Container */}
      <div className="max-w-7xl mx-auto space-y-5 sm:space-y-6">
        {/* BREADCRUMB NAVIGATION BAR */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
          <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-slate-500 dark:text-slate-400 min-w-0">
            <button
              type="button"
              onClick={handleResetToCourses}
              className={`hover:text-amber-600 dark:hover:text-amber-400 transition-colors cursor-pointer flex items-center gap-1.5 ${
                !selectedCourseId ? 'text-amber-600 dark:text-amber-400 font-black' : ''
              }`}
            >
              <FileCheck className="w-4 h-4" />
              <span>{language === 'th' ? 'ตรวจข้อสอบ & วิเคราะห์' : 'Grading & Integrity'}</span>
            </button>

            {selectedCourse && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-amber-600 dark:text-amber-400 font-black">
                  <span className="font-mono">{selectedCourse.code}</span> {selectedCourse.name}
                </span>
              </>
            )}
          </nav>

          {/* Quick Back Button when a course is open */}
          {selectedCourseId && (
            <button
              type="button"
              onClick={handleResetToCourses}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{language === 'th' ? 'ย้อนกลับ' : 'Back'}</span>
            </button>
          )}
        </div>

        {/* ========================================================================= */}
        {/* LEVEL 1: SHOW COURSES THAT HAVE WORK TO GRADE (เข้าไปปุ๊บ แสดงว่ามีวิชาอะไรบ้าง) */}
        {/* ========================================================================= */}
        {!selectedCourseId && (
          <div className="space-y-6 animate-in fade-in">
            {/* Header info */}
            <div className="bg-linear-to-br from-amber-400 via-orange-400 to-amber-500 rounded-3xl p-5 sm:p-6 md:p-8 text-slate-950 shadow-xl shadow-amber-500/15 flex flex-col md:flex-row md:items-center justify-between gap-5 sm:gap-6">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/10 backdrop-blur-xs text-xs font-bold text-slate-900">
                  <span>📝</span>
                  <span>{language === 'th' ? 'ขั้นตอนที่ 1 : เลือกรหัสวิชาที่ต้องการตรวจ' : 'Step 1 : Select Course'}</span>
                </div>
                <h1 className="text-2xl md:text-3xl font-black tracking-tight">
                  {language === 'th' ? 'ระบบตรวจข้อสอบและการบ้านอัจฉริยะ' : 'Grading & Integrity Assessment Hub'}
                </h1>
                <p className="text-slate-900/90 text-xs md:text-sm font-medium max-w-2xl">
                  {language === 'th'
                    ? 'เลือกรายวิชาด้านล่างเพื่อตรวจสอบห้องเรียนที่ได้รับมอบหมาย ดูรายชื่อผู้เรียนที่ส่งงานแล้วหรือยังไม่ส่ง พร้อมตรวจให้คะแนนแบบเจาะลึก'
                    : 'Select a course below to review assigned sections, view student submission statuses, and perform continuous grading.'}
                </p>
              </div>

              {/* Total pending review indicator */}
              <div className="px-5 py-4 rounded-2xl bg-white/95 text-slate-950 shadow-lg ring-1 ring-white/60 text-center md:min-w-40 shrink-0">
                <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
                  {language === 'th' ? 'งานรอตรวจทั้งหมด' : 'Total Pending'}
                </span>
                <span className="text-3xl font-black text-amber-600 block mt-0.5">
                  {courseStats.reduce((sum, c) => sum + c.pendingCount, 0)}
                </span>
                <span className="text-[10px] text-slate-500 font-semibold block mt-0.5">
                  {language === 'th' ? 'คำตอบที่ยังไม่ได้ให้คะแนน' : 'Unassessed Answers'}
                </span>
              </div>
            </div>

            {/* Courses Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
              {courseStats.map(({ course, sectionsCount, assignmentsCount, pendingCount, suspiciousCount, submittedCount, totalEnrolled }) => (
                <div
                  key={course.id}
                  onClick={() => handleSelectCourse(course.id)}
                  className="group bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 space-y-5 hover:border-amber-400 dark:hover:border-amber-500 shadow-xs hover:shadow-xl transition-all cursor-pointer flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-3 py-1 rounded-xl bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-300 font-mono text-xs font-black border border-amber-200 dark:border-amber-900">
                        {course.code}
                      </span>
                      {pendingCount > 0 ? (
                        <span className="px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-[11px] font-bold flex items-center gap-1 animate-pulse">
                          <Clock className="w-3 h-3" />
                          <span>{pendingCount} {language === 'th' ? 'รอตรวจ' : 'Pending'}</span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{language === 'th' ? 'ตรวจครบแล้ว' : 'All Graded'}</span>
                        </span>
                      )}
                    </div>

                    <div>
                      <h3 className="text-base font-black text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                        {course.name}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                        {course.description || '-'}
                      </p>
                    </div>

                    {/* Progress / Stat metrics */}
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                      <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold block">
                          {language === 'th' ? 'ห้องเรียนในสังกัด' : 'Assigned Sections'}
                        </span>
                        <span className="text-sm font-black text-slate-900 dark:text-white mt-0.5 block">
                          {sectionsCount} {language === 'th' ? 'ห้อง' : 'Rooms'}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold block">
                          {language === 'th' ? 'การบ้าน / ข้อสอบ' : 'Tasks / Exams'}
                        </span>
                        <span className="text-sm font-black text-slate-900 dark:text-white mt-0.5 block">
                          {assignmentsCount} {language === 'th' ? 'รายการ' : 'Tasks'}
                        </span>
                      </div>
                    </div>

                    {/* Suspicious Alerts indicator if any */}
                    {suspiciousCount > 0 && (
                      <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs font-bold flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-rose-600 animate-pulse shrink-0" />
                        <span className="text-[11px]">
                          {language === 'th'
                            ? `พบพฤติกรรมสลับหน้าจอ ${suspiciousCount} รายการ`
                            : `${suspiciousCount} integrity flags detected`}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Action button */}
                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      {submittedCount} / {totalEnrolled} {language === 'th' ? 'ส่งแล้ว' : 'Submitted'}
                    </span>
                    <button
                      type="button"
                      className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition-all group-hover:scale-105 cursor-pointer"
                    >
                      <span>{language === 'th' ? 'เลือกตรวจวิชานี้' : 'View Sections'}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* LEVEL 2: SHOW SECTIONS & TASKS IN SELECTED COURSE (พอกดเข้าไป 1 ครั้ง ก็จะเห็นว่ามีห้องไหนบ้าง) */}
        {/* ========================================================================= */}
        {selectedCourse && (
          <div className="space-y-6 animate-in fade-in">
            {/* Header of selected course */}
            <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950 text-xs font-bold text-amber-900 dark:text-amber-300">
                  <span>🏢</span>
                  <span>{language === 'th' ? 'ขั้นตอนที่ 2 : เลือกห้องเรียนและชิ้นงานที่มอบหมาย' : 'Step 2 : Choose Section & Assignment'}</span>
                </div>
                <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="font-mono text-amber-600 dark:text-amber-400">
                    [{selectedCourse.code}]
                  </span>
                  <span>{selectedCourse.name}</span>
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedCourse.description}
                </p>
              </div>

              <button
                type="button"
                onClick={handleResetToCourses}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer self-start md:self-auto"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{language === 'th' ? 'เปลี่ยนรายวิชา' : 'Switch Course'}</span>
              </button>
            </div>

            {/* List of assigned sections and their tasks */}
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 px-1">
                <span>{language === 'th' ? 'ห้องเรียนและรายการข้อสอบ/การบ้านที่มอบหมาย' : 'Assigned Classrooms & Tasks'} ({sectionItems.length})</span>
                <span>{language === 'th' ? 'คลิกที่ห้องเรียนเพื่อเปิดรายชื่อผู้ส่งงาน' : 'Select a classroom to view roster'}</span>
              </div>

              {sectionItems.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 p-12 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 text-center space-y-3">
                  <BookOpen className="w-10 h-10 text-slate-400 mx-auto" />
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {language === 'th' ? 'ยังไม่มีชิ้นงานหรือข้อสอบในรายวิชานี้' : 'No tasks assigned in this course yet.'}
                  </p>
                  <Link
                    href="/creation"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs shadow-xs"
                  >
                    <span>+ {t('dashboard.quick_actions.create_assignment')}</span>
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {sectionItems.map((item) => (
                    <div
                      key={`${item.classroom.id}-${item.assignment.id}`}
                      className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 space-y-5 shadow-xs hover:border-amber-400 dark:hover:border-amber-500 hover:shadow-lg transition-all"
                    >
                      {/* Section & Assignment Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs">
                              {item.classroom.name}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider ${
                                item.assignment.is_exam
                                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300'
                                  : 'bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300'
                              }`}
                            >
                              {item.assignment.is_exam
                                ? language === 'th' ? 'ข้อสอบออนไลน์' : 'Exam'
                                : language === 'th' ? 'การบ้าน/ใบงาน' : 'Assignment'}
                            </span>
                          </div>
                          <h3 className="text-base font-black text-slate-900 dark:text-white pt-1">
                            {item.assignment.title}
                          </h3>
                        </div>

                        {/* Submission status override badge */}
                        <div className="text-right shrink-0">
                          {(() => {
                            const status = getAssignmentStatus(getAssignmentWindow(item.assignment), item.assignment.is_exam, language);
                            const Icon = status.tone === 'closed' ? Lock : status.tone === 'late' ? Unlock : Clock;
                            return (
                              <span
                                className={`px-2.5 py-1 rounded-full border text-[11px] font-bold flex items-center gap-1 ${ASSIGNMENT_STATUS_CLASSES[status.tone]}`}
                                title={status.note || undefined}
                              >
                                <Icon className="w-3 h-3" />
                                <span>{status.label}</span>
                              </span>
                            );
                          })()}
                        </div>
                      </div>

                      {/* Roster counts breakdown */}
                      <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-center">
                        <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40">
                          <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold block">
                            {language === 'th' ? 'ส่งแล้ว' : 'Submitted'}
                          </span>
                          <span className="text-base font-black text-emerald-700 dark:text-emerald-300">
                            {item.submittedCount}
                          </span>
                        </div>
                        <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800/80">
                          <span className="text-[10px] text-slate-600 dark:text-slate-400 font-bold block">
                            {language === 'th' ? 'ยังไม่ส่ง' : 'Pending'}
                          </span>
                          <span className="text-base font-black text-slate-800 dark:text-slate-200">
                            {item.notSubmittedCount}
                          </span>
                        </div>
                        <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/40">
                          <span className="text-[10px] text-blue-700 dark:text-blue-300 font-bold block">
                            {language === 'th' ? 'รอตรวจ' : 'To Grade'}
                          </span>
                          <span className="text-base font-black text-blue-700 dark:text-blue-300">
                            {item.pendingCount}
                          </span>
                        </div>
                        <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40">
                          <span className="text-[10px] text-rose-700 dark:text-rose-300 font-bold block">
                            {language === 'th' ? 'สลับจอ' : 'Flagged'}
                          </span>
                          <span className="text-base font-black text-rose-700 dark:text-rose-300">
                            {item.flaggedCount}
                          </span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] font-bold text-slate-500 dark:text-slate-400">
                          <span>{language === 'th' ? 'ความคืบหน้าการส่งงาน' : 'Submission Rate'}</span>
                          <span>
                            {Math.round((item.submittedCount / (item.totalStudents || 1)) * 100)}% ({item.submittedCount}/{item.totalStudents} คน)
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, Math.round((item.submittedCount / (item.totalStudents || 1)) * 100))}%`,
                            }}
                          />
                        </div>
                      </div>

                      {/* Open the assignment's grading page */}
                      <Link
                        href={`/assignments/${item.assignment.id}/grading?from=grading&courseId=${encodeURIComponent(selectedCourse.id)}`}
                        className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md shadow-slate-900/10 cursor-pointer transition-all hover:scale-[1.01]"
                      >
                        <UserCheck className="w-4 h-4 text-amber-400" />
                        <span>{language === 'th' ? 'ดูรายชื่อ & ตรวจงานของห้องนี้' : 'Manage Submissions & Grade'}</span>
                        <ChevronRight className="w-4 h-4 text-amber-400" />
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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
