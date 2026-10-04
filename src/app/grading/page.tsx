'use client';

import React, { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
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

function GradingHubContent() {
  const { t, language } = useLanguage();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Navigation hierarchy state
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(
    searchParams.get('courseId') || null
  );
  const [selectedClassroomId, setSelectedClassroomId] = useState<string | null>(
    searchParams.get('classroomId') || null
  );
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string | null>(
    searchParams.get('assignmentId') || null
  );

  // Core Data
  const [courses, setCourses] = useState<Course[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  // Level 3 Selection Details
  const [activeAssignment, setActiveAssignment] = useState<Assignment | null>(null);
  const [activeQuestions, setActiveQuestions] = useState<Question[]>([]);
  const [activeSubmissions, setActiveSubmissions] = useState<Submission[]>([]);

  // Manual Submission Control Panel State (Level 3)
  const [overrideStatus, setOverrideStatus] = useState<SubmissionOverrideStatus>('auto');
  const [extendedDateTime, setExtendedDateTime] = useState('');
  const [showExtendPicker, setShowExtendPicker] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Filter & Search in Level 3 Roster
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'submitted' | 'pending' | 'late' | 'graded' | 'suspicious'
  >('all');

  // Modals state
  const [auditSubmission, setAuditSubmission] = useState<Submission | null>(null);
  const [auditEvents, setAuditEvents] = useState<SubmissionEvent[]>([]);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

  const [gradingSubmission, setGradingSubmission] = useState<Submission | null>(null);
  const [gradingAnswers, setGradingAnswers] = useState<Record<string, SubmissionAnswer>>({});
  const [isGradingWorkspaceOpen, setIsGradingWorkspaceOpen] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Load Initial Data
  const loadInitialData = async () => {
    setLoading(true);
    try {
      const [crs, cls, asg] = await Promise.all([
        dataService.getCourses(),
        dataService.getClassrooms(),
        dataService.getAssignments(),
      ]);
      setCourses(crs);
      setClassrooms(cls);
      setAssignments(asg);

      // Pre-fetch submissions for all assignments
      const allSubsPromises = asg.map((a) => dataService.getSubmissions(a.id));
      const subsArrays = await Promise.all(allSubsPromises);
      const flattenedSubs = subsArrays.flat();
      setAllSubmissions(flattenedSubs);
    } catch (err) {
      console.error('Error loading grading hub data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // When Level 3 assignment is selected, fetch its questions & submissions
  useEffect(() => {
    if (selectedAssignmentId) {
      const fetchAssignmentDetails = async () => {
        try {
          const { assignment: asg, questions: qs } =
            await dataService.getAssignmentById(selectedAssignmentId);
          setActiveAssignment(asg);
          setActiveQuestions(qs);
          if (asg) {
            setOverrideStatus(asg.status_override || 'auto');
            if (asg.extended_until) {
              setExtendedDateTime(asg.extended_until);
            } else {
              const inTwoDays = new Date(Date.now() + 2 * 86400000);
              setExtendedDateTime(inTwoDays.toISOString().slice(0, 16));
            }
          }

          const subs = await dataService.getSubmissions(selectedAssignmentId);
          setActiveSubmissions(subs);
        } catch (err) {
          console.error(err);
        }
      };
      fetchAssignmentDetails();
    } else {
      setActiveAssignment(null);
      setActiveQuestions([]);
      setActiveSubmissions([]);
    }
  }, [selectedAssignmentId]);

  // Selected Course
  const selectedCourse = useMemo(() => {
    return courses.find((c) => c.id === selectedCourseId) || null;
  }, [courses, selectedCourseId]);

  // Selected Classroom
  const selectedClassroom = useMemo(() => {
    return classrooms.find((c) => c.id === selectedClassroomId) || null;
  }, [classrooms, selectedClassroomId]);

  // Navigation handlers
  const handleSelectCourse = (courseId: string) => {
    setSelectedCourseId(courseId);
    setSelectedClassroomId(null);
    setSelectedAssignmentId(null);
  };

  const handleSelectSection = (classroomId: string, assignmentId: string) => {
    setSelectedClassroomId(classroomId);
    setSelectedAssignmentId(assignmentId);
  };

  const handleResetToCourses = () => {
    setSelectedCourseId(null);
    setSelectedClassroomId(null);
    setSelectedAssignmentId(null);
  };

  const handleResetToSections = () => {
    setSelectedClassroomId(null);
    setSelectedAssignmentId(null);
  };

  // Manual Submission Override Action (Level 3)
  const handleSetOverride = async (
    newStatus: SubmissionOverrideStatus,
    newExtendedUntil?: string
  ) => {
    if (!selectedAssignmentId) return;
    try {
      const updated = await dataService.updateAssignmentDeadlineOverride(
        selectedAssignmentId,
        {
          status_override: newStatus,
          extended_until:
            newExtendedUntil || (newStatus === 'extended' ? extendedDateTime : undefined),
        }
      );

      if (updated) {
        setActiveAssignment(updated);
        setOverrideStatus(newStatus);
        setAssignments((prev) =>
          prev.map((a) => (a.id === updated.id ? updated : a))
        );
      }

      if (newStatus === 'force_closed') {
        showToast(
          language === 'th'
            ? 'บังคับปิดรับงานทันทีเรียบร้อยแล้ว'
            : 'Submissions force-closed immediately'
        );
        setShowExtendPicker(false);
      } else if (newStatus === 'extended') {
        showToast(
          language === 'th'
            ? 'ขยายเวลาส่งงานเรียบร้อยแล้ว'
            : 'Deadline extended successfully'
        );
        setShowExtendPicker(false);
      } else {
        showToast(
          language === 'th'
            ? 'กลับสู่โหมดกำหนดส่งอัตโนมัติ'
            : 'Reset to automated deadline schedule'
        );
        setShowExtendPicker(false);
      }
    } catch (err) {
      console.error(err);
      alert('Error updating deadline override');
    }
  };

  // Open Integrity Audit Modal
  const handleOpenAudit = async (submission: Submission) => {
    setAuditSubmission(submission);
    try {
      const events = await dataService.getSubmissionEvents(submission.id);
      setAuditEvents(events);
      setIsAuditModalOpen(true);
    } catch (err) {
      console.error(err);
    }
  };

  // Open Grading Workspace Modal
  const handleOpenGradingWorkspace = async (submission: Submission) => {
    setGradingSubmission(submission);
    try {
      const answers = await dataService.getSubmissionAnswers(submission.id);
      setGradingAnswers(answers);
      setIsGradingWorkspaceOpen(true);
    } catch (err) {
      console.error(err);
    }
  };

  // Save Teacher Grade handler
  const handleSaveGrade = async (
    subId: string,
    qId: string,
    score: number,
    comment: string,
    teacherId: string,
    teacherName: string,
    teacherRole: TeacherRole
  ) => {
    await dataService.saveTeacherGrade(
      subId,
      qId,
      score,
      comment,
      teacherId,
      teacherName,
      teacherRole
    );

    // Refresh answers and submissions
    const updatedAnswers = await dataService.getSubmissionAnswers(subId);
    setGradingAnswers(updatedAnswers);

    if (selectedAssignmentId) {
      const refreshedSubs = await dataService.getSubmissions(selectedAssignmentId);
      setActiveSubmissions(refreshedSubs);
      const cur = refreshedSubs.find((s) => s.id === subId);
      if (cur) setGradingSubmission(cur);
    }
  };

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
        (s) => (s.status === 'submitted' || s.status === 'late') && s.total_score === undefined
      ).length;

      const suspiciousCount = courseSubmissions.filter(
        (s) => s.is_flagged_suspicious
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
        const flagged = asgSubs.filter((s) => s.is_flagged_suspicious);
        const graded = asgSubs.filter((s) => s.total_score !== undefined);
        const pending = asgSubs.filter(
          (s) => (s.status === 'submitted' || s.status === 'late') && s.total_score === undefined
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

  // Level 3 Roster Data (Filtered by status & search)
  const rosterData = useMemo(() => {
    if (!selectedClassroom || !activeAssignment) return [];
    const enrolledStudents = selectedClassroom.students || [];

    // Map each student to submission record if available
    const mapped = enrolledStudents.map((std, index) => {
      const sub = activeSubmissions.find((s) => s.student_id === std.id);
      return {
        student: std,
        orderNo: index + 1,
        submission: sub || null,
        isSubmitted: !!sub && (sub.status === 'submitted' || sub.status === 'late'),
        isLate: sub?.status === 'late',
        isPendingGrade: !!sub && sub.total_score === undefined,
        isGraded: !!sub && sub.total_score !== undefined,
        isFlagged: !!sub?.is_flagged_suspicious,
      };
    });

    return mapped.filter((item) => {
      // Search filter
      const q = searchTerm.toLowerCase().trim();
      const matchesSearch =
        !q ||
        `${item.student.first_name} ${item.student.last_name}`.toLowerCase().includes(q) ||
        (item.student.student_id && item.student.student_id.toLowerCase().includes(q)) ||
        (item.student.email && item.student.email.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      // Status filter
      if (statusFilter === 'submitted') return item.isSubmitted;
      if (statusFilter === 'pending') return !item.isSubmitted;
      if (statusFilter === 'late') return item.isLate;
      if (statusFilter === 'graded') return item.isGraded;
      if (statusFilter === 'suspicious') return item.isFlagged;

      return true;
    });
  }, [selectedClassroom, activeAssignment, activeSubmissions, searchTerm, statusFilter]);

  if (loading) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs font-bold text-slate-500">{t('common.loading')}</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/60 dark:bg-slate-950 pb-20 transition-colors">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-2xl bg-amber-500 text-slate-950 font-bold shadow-2xl flex items-center gap-2 text-xs animate-in fade-in slide-in-from-bottom-5">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* BREADCRUMB NAVIGATION BAR */}
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-wrap items-center justify-between gap-3">
          <nav className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
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
                <button
                  type="button"
                  onClick={handleResetToSections}
                  className={`hover:text-amber-600 dark:hover:text-amber-400 transition-colors cursor-pointer ${
                    !selectedClassroomId ? 'text-amber-600 dark:text-amber-400 font-black' : ''
                  }`}
                >
                  <span className="font-mono">{selectedCourse.code}</span> {selectedCourse.name}
                </button>
              </>
            )}

            {selectedClassroom && activeAssignment && (
              <>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-900 dark:text-white font-black truncate max-w-xs">
                  {selectedClassroom.name} : {activeAssignment.title}
                </span>
              </>
            )}
          </nav>

          {/* Quick Back Button when in Level 2 or Level 3 */}
          {(selectedCourseId || selectedClassroomId) && (
            <button
              type="button"
              onClick={() => {
                if (selectedClassroomId) handleResetToSections();
                else handleResetToCourses();
              }}
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
            <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-yellow-500 rounded-3xl p-6 md:p-8 text-slate-950 shadow-xl shadow-amber-500/10 flex flex-col md:flex-row md:items-center justify-between gap-6">
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
              <div className="px-5 py-4 rounded-2xl bg-white/95 text-slate-950 shadow-lg border border-amber-200 text-center min-w-[160px]">
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {courseStats.map(({ course, sectionsCount, assignmentsCount, pendingCount, suspiciousCount, submittedCount, totalEnrolled }) => (
                <div
                  key={course.id}
                  onClick={() => handleSelectCourse(course.id)}
                  className="group bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 space-y-5 hover:border-amber-400 dark:hover:border-amber-500 shadow-xs hover:shadow-xl transition-all cursor-pointer flex flex-col justify-between"
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
        {selectedCourse && !selectedClassroomId && (
          <div className="space-y-6 animate-in fade-in">
            {/* Header of selected course */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
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
                      className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 space-y-5 shadow-xs hover:border-amber-400 dark:hover:border-amber-500 hover:shadow-lg transition-all"
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
                          {item.assignment.status_override === 'force_closed' ? (
                            <span className="px-2.5 py-1 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-[11px] font-bold flex items-center gap-1">
                              <Lock className="w-3 h-3" />
                              <span>{language === 'th' ? 'ปิดรับงานแล้ว' : 'Closed'}</span>
                            </span>
                          ) : item.assignment.status_override === 'extended' ? (
                            <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[11px] font-bold flex items-center gap-1">
                              <Unlock className="w-3 h-3" />
                              <span>{language === 'th' ? 'ขยายเวลาส่ง' : 'Extended'}</span>
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>{language === 'th' ? 'เปิดรับส่งงาน' : 'Open'}</span>
                            </span>
                          )}
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

                      {/* CTA to enter Level 3 */}
                      <button
                        type="button"
                        onClick={() => handleSelectSection(item.classroom.id, item.assignment.id)}
                        className="w-full py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs flex items-center justify-center gap-2 shadow-md shadow-slate-900/10 cursor-pointer transition-all hover:scale-[1.01]"
                      >
                        <UserCheck className="w-4 h-4 text-amber-400" />
                        <span>{language === 'th' ? 'ดูรายชื่อ & จัดการส่งงานของห้องนี้' : 'Manage Submissions & Grade'}</span>
                        <ChevronRight className="w-4 h-4 text-amber-400" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* LEVEL 3: CLASSROOM SUBMISSION ROSTER & MANUAL SUBMISSION CONTROL PANEL */}
        {/* ========================================================================= */}
        {selectedCourse && selectedClassroom && activeAssignment && (
          <div className="space-y-6 animate-in fade-in">
            {/* Header info */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950 text-xs font-bold text-amber-900 dark:text-amber-300">
                  <span>👥</span>
                  <span>{language === 'th' ? 'ขั้นตอนที่ 3 : รายชื่อผู้เรียนและการควบคุมการรับส่งงาน' : 'Step 3 : Student Submission Roster & Control'}</span>
                </div>
                <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
                  {selectedClassroom.name} : {activeAssignment.title}
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5 text-amber-500" />
                  <span>
                    {language === 'th' ? 'กำหนดส่งเดิม:' : 'Due Date:'}{' '}
                    {new Date(activeAssignment.due_date).toLocaleString('th-TH')}
                  </span>
                  <span>•</span>
                  <span>
                    {language === 'th' ? 'คะแนนเต็ม:' : 'Total Points:'} {activeAssignment.total_points} {t('common.points')}
                  </span>
                </p>
              </div>

              <button
                type="button"
                onClick={handleResetToSections}
                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 cursor-pointer self-start md:self-auto"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>{language === 'th' ? 'เปลี่ยนห้องเรียน' : 'Switch Room'}</span>
              </button>
            </div>

            {/* MANUAL SUBMISSION CONTROL PANEL (THE FEATURE USER LIKED) */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm font-black text-slate-900 dark:text-white">
                      {t('submission_control.title')}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t('submission_control.subtitle')}
                    </p>
                  </div>
                </div>

                {/* Status Indicator Banner */}
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">
                    {language === 'th' ? 'สถานะปัจจุบัน:' : 'Current Status:'}
                  </span>
                  {overrideStatus === 'force_closed' && (
                    <span className="text-rose-600 dark:text-rose-400 flex items-center gap-1 font-black">
                      <Lock className="w-3.5 h-3.5" />
                      {t('submission_control.mode_force_closed')}
                    </span>
                  )}
                  {overrideStatus === 'extended' && (
                    <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1 font-black">
                      <Unlock className="w-3.5 h-3.5" />
                      {t('submission_control.mode_extended')} (
                      {activeAssignment.extended_until
                        ? new Date(activeAssignment.extended_until).toLocaleString('th-TH')
                        : ''}
                      )
                    </span>
                  )}
                  {overrideStatus === 'auto' && (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-black">
                      <Clock className="w-3.5 h-3.5" />
                      {t('submission_control.mode_auto')}
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                {/* 1. Force Close */}
                <button
                  type="button"
                  onClick={() => handleSetOverride('force_closed')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all ${
                    overrideStatus === 'force_closed'
                      ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                      : 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70 border border-rose-200 dark:border-rose-900/60'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{t('submission_control.btn_force_close')}</span>
                </button>

                {/* 2. Re-open / Extend */}
                <button
                  type="button"
                  onClick={() => setShowExtendPicker(!showExtendPicker)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all ${
                    overrideStatus === 'extended'
                      ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/30 font-black'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70 border border-amber-200 dark:border-amber-900/60'
                  }`}
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>{t('submission_control.btn_reopen')}</span>
                </button>

                {/* 3. Reset to Auto */}
                <button
                  type="button"
                  onClick={() => handleSetOverride('auto')}
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer transition-all ${
                    overrideStatus === 'auto'
                      ? 'bg-slate-900 dark:bg-slate-700 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{t('submission_control.btn_reset_auto')}</span>
                </button>
              </div>

              {/* Datetime picker for Re-open / Extend */}
              {showExtendPicker && (
                <div className="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 flex flex-wrap items-center gap-3 animate-in fade-in">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-xs font-bold text-amber-900 dark:text-amber-200">
                      {t('submission_control.extend_date_label')}:
                    </span>
                  </div>
                  <input
                    type="datetime-local"
                    value={extendedDateTime}
                    onChange={(e) => setExtendedDateTime(e.target.value)}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 text-xs font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleSetOverride('extended', extendedDateTime)}
                    className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold cursor-pointer shadow-xs"
                  >
                    {language === 'th' ? 'บันทึกการขยายเวลา' : 'Apply Extension'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowExtendPicker(false)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              )}
            </div>

            {/* FILTER & SEARCH ROSTER TOOLBAR */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              {/* Filter Tabs */}
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { key: 'all', label: language === 'th' ? 'ทั้งหมด' : 'All' },
                  { key: 'submitted', label: language === 'th' ? 'ส่งแล้ว' : 'Submitted' },
                  { key: 'pending', label: language === 'th' ? 'ยังไม่ส่ง' : 'Not Submitted' },
                  { key: 'late', label: language === 'th' ? 'ส่งล่าช้า' : 'Late' },
                  { key: 'graded', label: language === 'th' ? 'ตรวจแล้ว' : 'Graded' },
                  { key: 'suspicious', label: language === 'th' ? 'สลับจอ (Flagged)' : 'Flagged' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setStatusFilter(tab.key as any)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-all ${
                      statusFilter === tab.key
                        ? 'bg-amber-500 text-slate-950 shadow-xs font-black'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Search input */}
              <div className="relative min-w-[240px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={language === 'th' ? 'ค้นหาชื่อ หรือ รหัสนักเรียน...' : 'Search student...'}
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* STUDENT SUBMISSION ROSTER TABLE */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 font-bold">
                      <th className="py-3.5 px-4 w-12 text-center">#</th>
                      <th className="py-3.5 px-4">{language === 'th' ? 'รหัส / ชื่อ-นามสกุล' : 'Student Info'}</th>
                      <th className="py-3.5 px-4 text-center">{language === 'th' ? 'สถานะการส่ง' : 'Submission Status'}</th>
                      <th className="py-3.5 px-4 text-center">{language === 'th' ? 'เวลาที่ใช้ / ส่งเมื่อ' : 'Time & Date'}</th>
                      <th className="py-3.5 px-4 text-center">{language === 'th' ? 'การเฝ้าระวังทุจริต' : 'Integrity'}</th>
                      <th className="py-3.5 px-4 text-center">{language === 'th' ? 'คะแนนรวม' : 'Score'}</th>
                      <th className="py-3.5 px-4 text-right">{language === 'th' ? 'การดำเนินการ' : 'Action'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                    {rosterData.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-slate-400">
                          {language === 'th' ? 'ไม่พบข้อมูลนักเรียนตามเงื่อนไขที่เลือก' : 'No students found.'}
                        </td>
                      </tr>
                    ) : (
                      rosterData.map((item) => (
                        <tr
                          key={item.student.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                        >
                          <td className="py-4 px-4 text-center text-slate-400 font-mono">
                            {item.orderNo}
                          </td>

                          {/* Student Info */}
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={item.student.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'}
                                alt={item.student.first_name}
                                className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                              />
                              <div>
                                <span className="block font-bold text-slate-900 dark:text-white leading-tight">
                                  {item.student.first_name} {item.student.last_name}
                                </span>
                                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                  {item.student.student_id || '-'}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Submission Status Badge */}
                          <td className="py-4 px-4 text-center">
                            {item.isSubmitted ? (
                              item.isLate ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 text-[11px] font-bold">
                                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                                  <span>{language === 'th' ? 'ส่งแล้ว (ล่าช้า)' : 'Submitted (Late)'}</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  <span>{language === 'th' ? 'ส่งแล้ว (ตรงเวลา)' : 'Submitted'}</span>
                                </span>
                              )
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[11px] font-bold">
                                <Clock className="w-3 h-3 text-slate-400" />
                                <span>{language === 'th' ? 'ยังไม่ส่ง' : 'Not Submitted'}</span>
                              </span>
                            )}
                          </td>

                          {/* Time & Date */}
                          <td className="py-4 px-4 text-center">
                            {item.submission ? (
                              <div className="space-y-0.5">
                                <span className="block text-slate-800 dark:text-slate-200 font-semibold text-[11px]">
                                  {item.submission.submitted_at
                                    ? new Date(item.submission.submitted_at).toLocaleTimeString('th-TH', {
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      }) + ' น.'
                                    : '-'}
                                </span>
                                <span className="block text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                  {Math.floor(item.submission.time_spent_seconds / 60)} {t('common.minutes')}
                                </span>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[11px]">-</span>
                            )}
                          </td>

                          {/* Integrity Badge */}
                          <td className="py-4 px-4 text-center">
                            {item.submission ? (
                              <button
                                type="button"
                                onClick={() => handleOpenAudit(item.submission!)}
                                className="inline-block hover:scale-105 transition-transform cursor-pointer"
                                title={language === 'th' ? 'คลิกเพื่อดูรายละเอียดไทม์ไลน์' : 'Click to view audit log'}
                              >
                                <AntiCheatingBadge
                                  tabSwitchCount={item.submission.tab_switch_count}
                                  isFlagged={item.submission.is_flagged_suspicious}
                                  totalTimeAwaySeconds={item.submission.total_time_away_seconds}
                                />
                              </button>
                            ) : (
                              <span className="text-slate-400 text-[11px]">-</span>
                            )}
                          </td>

                          {/* Score */}
                          <td className="py-4 px-4 text-center font-bold">
                            {item.submission?.total_score !== undefined ? (
                              <span className="px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-mono text-xs">
                                {item.submission.total_score} / {activeAssignment.total_points}
                              </span>
                            ) : item.isSubmitted ? (
                              <span className="text-amber-600 dark:text-amber-400 text-[11px] font-semibold">
                                {language === 'th' ? 'รอตรวจ' : 'Pending'}
                              </span>
                            ) : (
                              <span className="text-slate-400 text-[11px]">-</span>
                            )}
                          </td>

                          {/* Action Button */}
                          <td className="py-4 px-4 text-right">
                            {item.isSubmitted ? (
                              <button
                                type="button"
                                onClick={() => handleOpenGradingWorkspace(item.submission!)}
                                className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 shadow-xs cursor-pointer transition-transform active:scale-95"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>
                                  {item.isGraded
                                    ? language === 'th' ? 'แก้ไขคะแนน' : 'Edit Grade'
                                    : language === 'th' ? 'ตรวจข้อสอบ' : 'Grade'}
                                </span>
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400 font-medium italic">
                                {language === 'th' ? 'รอผู้เรียนส่งงาน' : 'Awaiting student'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* INTEGRITY AUDIT TIMELINE MODAL */}
      {/* ========================================================================= */}
      <IntegrityAuditModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        submission={auditSubmission}
        events={auditEvents}
      />

      {/* ========================================================================= */}
      {/* CONTINUOUS SCROLL SINGLE-PAGE GRADING WORKSPACE MODAL */}
      {/* ========================================================================= */}
      {isGradingWorkspaceOpen && gradingSubmission && (
        <GradingWorkspace
          submission={gradingSubmission}
          questions={activeQuestions}
          initialAnswers={gradingAnswers}
          onClose={() => setIsGradingWorkspaceOpen(false)}
          onSaveGrade={handleSaveGrade}
        />
      )}
    </div>
  );
}

export default function GradingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <GradingHubContent />
    </Suspense>
  );
}
