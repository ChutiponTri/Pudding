'use client';

import React, { useState, useEffect, use, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import {
  Assignment,
  Classroom,
  ClassroomTeacher,
  Question,
  Submission,
  SubmissionAnswer,
  SubmissionEvent,
  SubmissionOverrideStatus,
  TeacherRole,
  User,
} from '@/types/database';
import { DateTimeField } from '@/components/DateTimeField';
import { daysFromNowAt, formatDateTime } from '@/lib/utils/datetime';
import { AntiCheatingBadge } from '@/components/AntiCheatingBadge';
import { IntegrityAuditModal } from '@/components/IntegrityAuditModal';
import { GradingWorkspace } from '@/components/GradingWorkspace';
import {
  Search,
  Filter,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Award,
  ChevronRight,
  ExternalLink,
  Sparkles,
  UserCheck,
  FileText,
  Lock,
  Unlock,
  RotateCcw,
  Check,
  Calendar,
  Layers,
} from 'lucide-react';
import { ASSIGNMENT_STATUS_CLASSES, getAssignmentStatus, getAssignmentWindow } from '@/lib/utils/assignmentWindow';

/**
 * Back button that returns to wherever the teacher came from. Links into this
 * page carry ?from=classroom|dashboard|grading; anything else uses history.
 */
function GradingBackLink({ classroomId }: { classroomId?: string }) {
  const search = useSearchParams();
  const router = useRouter();
  const { language } = useLanguage();
  const th = language === 'th';
  const from = search.get('from');
  const fromClassroomId = search.get('classroomId') || classroomId;
  const courseId = search.get('courseId');
  const className =
    'inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-amber-600 transition-colors cursor-pointer';

  let target: { href: string; label: string } | null = null;
  if (from === 'classroom' && fromClassroomId) {
    target = { href: `/classrooms/${fromClassroomId}?tab=classwork`, label: th ? 'กลับไปหน้างานของห้องเรียน' : 'Back to classwork' };
  } else if (from === 'dashboard') {
    target = { href: '/dashboard', label: th ? 'กลับไปแดชบอร์ด' : 'Back to dashboard' };
  } else if (from === 'grading') {
    target = { href: courseId ? `/grading?courseId=${encodeURIComponent(courseId)}` : '/grading', label: th ? 'กลับไปหน้าตรวจงาน' : 'Back to grading' };
  }

  if (target) {
    return (
      <Link href={target.href} className={className}>
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>{target.label}</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(classroomId ? `/classrooms/${classroomId}?tab=classwork` : '/dashboard');
      }}
      className={className}
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      <span>{th ? 'ย้อนกลับ' : 'Back'}</span>
    </button>
  );
}

type RosterRow = {
  key: string;
  student: Partial<User> | undefined;
  submission: Submission | null;
};

export default function GradingPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const assignmentId = resolvedParams.id;

  const { t, language } = useLanguage();
  const { user: clerkUser } = useUser();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'suspicious' | 'pending' | 'graded' | 'missing'>('all');

  // Audit modal state
  const [auditSubmission, setAuditSubmission] = useState<Submission | null>(null);
  const [auditEvents, setAuditEvents] = useState<SubmissionEvent[]>([]);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

  // Grading workspace modal state
  const [gradingSubmission, setGradingSubmission] = useState<Submission | null>(null);
  const [gradingAnswers, setGradingAnswers] = useState<Record<string, SubmissionAnswer>>({});
  const [isGradingWorkspaceOpen, setIsGradingWorkspaceOpen] = useState(false);

  // Manual Submission Control Panel State
  const [overrideStatus, setOverrideStatus] = useState<SubmissionOverrideStatus>('auto');
  const [extendedDateTime, setExtendedDateTime] = useState('');
  const [showExtendPicker, setShowExtendPicker] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const loadAllData = async () => {
    try {
      // Assignment and submissions load together; the classroom roster follows
      // as soon as the assignment says which classroom it belongs to.
      const [{ assignment: asg, questions: qs }, subs] = await Promise.all([
        dataService.getAssignmentById(assignmentId),
        dataService.getSubmissions(assignmentId),
      ]);
      setAssignment(asg);
      setQuestions(qs);
      setSubmissions(subs);
      if (asg) {
        setOverrideStatus(asg.status_override || 'auto');
        // Suggest the current extension, or two days from now at 23:59.
        setExtendedDateTime(asg.extended_until || daysFromNowAt(2, 23, 59));
        if (asg.classroom_id) setClassroom(await dataService.getClassroomById(asg.classroom_id));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const refreshSubmissions = () =>
    dataService
      .getSubmissions(assignmentId)
      .then(setSubmissions)
      .catch((err) => console.warn('Refreshing submissions failed:', err));

  useEffect(() => {
    loadAllData();
  }, [assignmentId]);

  useEffect(() => {
    // Background refresh for new submissions (paused while grading or hidden).
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && !isGradingWorkspaceOpen && !isAuditModalOpen) {
        refreshSubmissions();
      }
    }, 15000);

    // Same-browser events refresh instantly.
    const handleSubmissionEvent = () => refreshSubmissions();

    window.addEventListener('pudding-submission-created', handleSubmissionEvent);
    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      bc = new BroadcastChannel('pudding-realtime');
      bc.onmessage = (event) => {
        if (event.data?.type === 'submission_created') {
          handleSubmissionEvent();
        }
      };
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener('pudding-submission-created', handleSubmissionEvent);
      if (bc) bc.close();
    };
  }, [assignmentId, isGradingWorkspaceOpen, isAuditModalOpen]);

  // Handle Manual Override
  const handleSetOverride = async (newStatus: SubmissionOverrideStatus, newExtendedUntil?: string) => {
    if (newStatus === 'extended' && new Date(newExtendedUntil || extendedDateTime).getTime() <= Date.now()) {
      alert(language === 'th' ? 'กรุณาเลือกเวลาขยายที่อยู่ในอนาคต' : 'Please pick a time in the future');
      return;
    }
    try {
      const updated = await dataService.updateAssignmentDeadlineOverride(assignmentId, {
        status_override: newStatus,
        extended_until: newExtendedUntil || (newStatus === 'extended' ? extendedDateTime : undefined),
      });

      if (updated) {
        setAssignment(updated);
        setOverrideStatus(newStatus);
      }

      if (newStatus === 'force_closed') {
        showToast(language === 'th' ? 'บังคับปิดรับงานทันทีเรียบร้อยแล้ว' : 'Submissions force-closed immediately');
        setShowExtendPicker(false);
      } else if (newStatus === 'extended') {
        showToast(language === 'th' ? 'ขยายเวลาส่งงานเรียบร้อยแล้ว' : 'Deadline extended successfully');
        setShowExtendPicker(false);
      } else {
        showToast(language === 'th' ? 'กลับสู่โหมดกำหนดส่งอัตโนมัติ' : 'Reset to automated deadline schedule');
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
    } catch {
      setAuditEvents([]);
    }
    setIsAuditModalOpen(true);
  };

  // Open Grading Workspace
  const handleOpenGrading = async (submission: Submission) => {
    // Load the saved grades first so the workspace mounts with them already filled in.
    let answers: Record<string, SubmissionAnswer> = {};
    try {
      answers = await dataService.getSubmissionAnswers(submission.id);
    } catch {
      answers = {};
    }
    setGradingAnswers(answers);
    setGradingSubmission(submission);
    setIsGradingWorkspaceOpen(true);
  };


  // Every enrolled student, with their submission if any, then submissions from
  // students no longer on the roster. Roster entries may carry users.id, the
  // LINE id or the school number, so match on any of them.
  const rosterRows: RosterRow[] = (() => {
    const used = new Set<string>();
    const rows: RosterRow[] = (classroom?.students || []).map((std) => {
      const sub = submissions.find(
        (s) =>
          !used.has(s.id) &&
          (s.student_id === std.id ||
            (std.line_uid && s.student_id === std.line_uid) ||
            (std.student_id && (s.student_id === std.student_id || s.student?.student_id === std.student_id)))
      );
      if (sub) used.add(sub.id);
      return { key: `std-${std.id}`, student: sub?.student || std, submission: sub || null };
    });
    for (const sub of submissions) {
      if (!used.has(sub.id)) rows.push({ key: sub.id, student: sub.student, submission: sub });
    }
    return rows;
  })();

  // Grading order: roster order, students with a submission only.
  const gradingOrder = rosterRows.flatMap((row) => (row.submission ? [row.submission] : []));
  const gradingIndex = gradingSubmission ? gradingOrder.findIndex((s) => s.id === gradingSubmission.id) : -1;

  // The signed-in teacher grades with their role in this classroom.
  const grader: ClassroomTeacher | null = (() => {
    if (!clerkUser || !classroom) return null;
    const entry = classroom.teachers?.find((teacher) => teacher.teacher_id === clerkUser.id);
    if (!entry && classroom.teacher_id !== clerkUser.id) return null;
    return {
      teacher_id: clerkUser.id,
      name: entry?.name || clerkUser.fullName || `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() || (language === 'th' ? 'คุณครู' : 'Teacher'),
      email: entry?.email || clerkUser.primaryEmailAddress?.emailAddress,
      avatar_url: clerkUser.imageUrl || entry?.avatar_url,
      role: entry?.role || 'primary',
    };
  })();

  const isSuspicious = (sub: Submission) =>
    sub.is_flagged_suspicious || sub.tab_switch_count >= 3 || sub.total_time_away_seconds >= 60;

  const filteredRows = rosterRows.filter(({ student, submission: sub }) => {
    const studentName = `${student?.first_name || ''} ${student?.last_name || ''}`;
    const studentId = student?.student_id || '';
    const matchesSearch =
      studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      studentId.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (statusFilter === 'missing') return !sub;
    if (statusFilter === 'suspicious') return !!sub && isSuspicious(sub);
    if (statusFilter === 'pending') return !!sub && sub.total_score == null;
    if (statusFilter === 'graded') return !!sub && sub.total_score != null;

    return true;
  });

  const suspiciousTotal = submissions.filter(isSuspicious).length;
  const gradedTotal = submissions.filter((s) => s.total_score != null).length;
  const missingTotal = rosterRows.filter((row) => !row.submission).length;

  const assignmentWindow = assignment ? getAssignmentWindow(assignment) : null;
  const assignmentStatus = assignment && assignmentWindow ? getAssignmentStatus(assignmentWindow, assignment.is_exam, language) : null;
  const deadlineLabel = formatDateTime(
    assignmentWindow?.deadline != null ? new Date(assignmentWindow.deadline).toISOString() : assignment?.due_date,
    language
  );
  const th = language === 'th';
  // What "auto" actually does right now: homework keeps taking late work, a quiz closes.
  const autoBannerText = !assignment
    ? ''
    : assignmentWindow?.isScheduled && assignment.publish_at
    ? th
      ? `ตั้งเวลาเผยแพร่ ${formatDateTime(assignment.publish_at, language)} — ก่อนถึงเวลานี้นักเรียนยังไม่เห็นงาน`
      : `Scheduled for ${formatDateTime(assignment.publish_at, language)}; hidden from students until then`
    : assignment.is_exam
    ? assignmentWindow?.isPastDeadline
      ? th ? 'อัตโนมัติ: หมดเวลาแล้ว ปิดรับคำตอบ' : 'Automatic: time is up, answers are closed'
      : th ? `อัตโนมัติ: เปิดรับคำตอบถึง ${deadlineLabel} แล้วปิดรับทันที` : `Automatic: open until ${deadlineLabel}, then closes`
    : assignmentWindow?.isPastDeadline
    ? th
      ? 'อัตโนมัติ: เลยกำหนดส่งแล้ว ยังรับงานส่งช้าอยู่ (บันทึกว่าส่งช้า) — กด "ล็อกปิดรับงานทันที" หากต้องการหยุดรับ'
      : 'Automatic: past due, still accepting late work (marked late). Use "Close now" to stop.'
    : th
    ? `อัตโนมัติ: เปิดรับงานถึง ${deadlineLabel} หลังจากนั้นยังรับงานส่งช้าได้`
    : `Automatic: open until ${deadlineLabel}; late work accepted after that`;

  return (
    <div className="space-y-8 pb-20">
      {/* Toast Notice */}
      {toastMessage && (
        <div className="fixed bottom-[max(env(safe-area-inset-bottom),1rem)] inset-x-4 sm:inset-x-auto sm:right-6 sm:bottom-6 z-60 p-4 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold shadow-2xl flex items-center gap-2.5 text-sm animate-in fade-in slide-in-from-bottom-5">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {classroom && clerkUser && !grader && (
        <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs font-semibold text-rose-700 dark:text-rose-300">
          {language === 'th'
            ? 'บัญชีนี้ไม่ได้อยู่ในรายชื่อผู้สอนของห้องเรียนนี้ จึงดูได้แต่ตรวจให้คะแนนไม่ได้'
            : 'Your account is not a teacher of this classroom, so you can view but not grade.'}
        </div>
      )}

      {/* Top Breadcrumb & Assignment Header */}
      <div className="space-y-4">
        <Suspense fallback={<span className="block h-4" />}>
          <GradingBackLink classroomId={assignment?.classroom_id} />
        </Suspense>

        <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 md:gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                    assignment?.is_exam
                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  }`}
                >
                  {assignment?.is_exam
                    ? t('assignment_creator.mode_exam')
                    : t('assignment_creator.mode_assignment')}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {classroom?.name || assignment?.classroom_name || ''}
                </span>
                {assignment?.sample_work_title && (
                  <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-[11px] font-semibold border border-blue-200 dark:border-blue-900/50">
                    📎 {assignment.sample_work_title}
                  </span>
                )}
              </div>

              <h1 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white">
                {assignment?.title || t('grading.title')}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {assignment?.description || '-'}
              </p>
            </div>

            {assignmentStatus && (
              <div className="w-full md:w-auto md:min-w-64 shrink-0 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-2.5">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    {th ? 'สถานะการรับงาน' : 'Submissions'}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-black whitespace-nowrap ${ASSIGNMENT_STATUS_CLASSES[assignmentStatus.tone]}`}
                  >
                    {assignmentStatus.tone === 'closed' ? <Lock className="w-3.5 h-3.5" /> : assignmentStatus.tone === 'late' ? <Unlock className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                    <span>{assignmentStatus.label}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4 pt-2.5 border-t border-slate-200/80 dark:border-slate-700/80">
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    {assignment?.is_exam ? (th ? 'ปิดรับคำตอบ' : 'Closes') : t('grading.due_date')}
                  </span>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200 text-right">{deadlineLabel}</span>
                </div>
                {assignmentStatus.note && (
                  <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{assignmentStatus.note}</p>
                )}
              </div>
            )}
          </div>

          {/* INTERACTIVE MANUAL SUBMISSION CONTROL PANEL */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                    {t('submission_control.title')}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('submission_control.subtitle')}
                  </p>
                </div>
              </div>

              {/* Status Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {/* 1. Automated */}
                <button
                  type="button"
                  onClick={() => handleSetOverride('auto')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    overrideStatus === 'auto'
                      ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 border border-emerald-500/50 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>{t('submission_control.mode_auto')}</span>
                </button>

                {/* 2. Force Close Immediately */}
                <button
                  type="button"
                  onClick={() => handleSetOverride('force_closed')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    overrideStatus === 'force_closed'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>{t('submission_control.btn_force_close')}</span>
                </button>

                {/* 3. Re-open / Extend Deadline */}
                <button
                  type="button"
                  onClick={() => setShowExtendPicker(!showExtendPicker)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                    overrideStatus === 'extended'
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : 'text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 border border-amber-300 dark:border-amber-900/60'
                  }`}
                >
                  <Unlock className="w-3.5 h-3.5" />
                  <span>{t('submission_control.btn_reopen')}</span>
                </button>
              </div>
            </div>

            {/* Extend Date-Time Picker Drawer */}
            {showExtendPicker && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-start gap-3 animate-in fade-in">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 sm:pt-3 shrink-0">
                  <Calendar className="w-3.5 h-3.5 text-amber-500" />
                  <span>{t('submission_control.extend_date_label')}:</span>
                </span>
                <DateTimeField
                  value={extendedDateTime}
                  onChange={setExtendedDateTime}
                  presets="deadline"
                  className="flex-1 min-w-0"
                />
                <button
                  type="button"
                  onClick={() => handleSetOverride('extended', extendedDateTime)}
                  disabled={!extendedDateTime}
                  className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {language === 'th' ? 'บันทึกเวลาขยาย' : 'Apply Extension'}
                </button>
              </div>
            )}

            {/* Current Active Status Indicator Banner */}
            <div
              className={`px-3.5 py-2.5 rounded-xl text-xs font-medium flex flex-wrap items-start sm:items-center justify-between gap-x-3 gap-y-1.5 ${
                overrideStatus === 'force_closed'
                  ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-900/60'
                  : overrideStatus === 'extended'
                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-900/60'
                  : 'bg-emerald-100/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-900/50'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0 flex-1">
                {overrideStatus === 'force_closed' && <Lock className="w-4 h-4 text-rose-600 shrink-0" />}
                {overrideStatus === 'extended' && <Unlock className="w-4 h-4 text-amber-600 shrink-0" />}
                {overrideStatus === 'auto' && <Clock className="w-4 h-4 text-emerald-600 shrink-0" />}
                <span className="min-w-0 break-words leading-relaxed">
                  {overrideStatus === 'force_closed'
                    ? t('submission_control.status_banner_closed')
                    : overrideStatus === 'extended'
                    ? t('submission_control.status_banner_extended').replace(
                        '{time}',
                        formatDateTime(assignment?.extended_until || extendedDateTime, language)
                      ) + (assignment?.is_exam ? '' : th ? ' (หลังจากนั้นรับงานส่งช้า)' : ' (late work accepted after that)')
                    : autoBannerText}
                </span>
              </div>

              {overrideStatus !== 'auto' && (
                <button
                  type="button"
                  onClick={() => handleSetOverride('auto')}
                  className="text-[11px] underline font-bold hover:text-slate-900 dark:hover:text-white cursor-pointer shrink-0 ml-6 sm:ml-0"
                >
                  {t('submission_control.btn_reset_auto')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Analytics Summary Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {t('grading.total_submissions')}
          </span>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            {submissions.filter((s) => s.status !== 'pending').length}
            <span className="text-xs font-normal text-slate-400 ml-1">/ {rosterRows.length}</span>
          </p>
          {missingTotal > 0 && (
            <span className="text-[11px] font-semibold text-slate-400">
              {language === 'th' ? `ยังไม่ส่ง ${missingTotal} คน` : `${missingTotal} not submitted`}
            </span>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {language === 'th' ? 'ตรวจแล้ว' : 'Graded'}
          </span>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {gradedTotal}
            <span className="text-xs font-normal text-slate-400 ml-1">/ {submissions.length}</span>
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {t('grading.pending_eval')}
          </span>
          <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">
            {submissions.length - gradedTotal}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-rose-200 dark:border-rose-900/50 shadow-xs">
          <span className="text-xs text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5" />
            {t('grading.suspicious_count')}
          </span>
          <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">
            {suspiciousTotal}
          </p>
        </div>
      </div>

      {/* Submissions Table & Filter Controls */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        {/* Table Filters Bar */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Search Box */}
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('grading.search_student')}
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 font-medium"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              {t('grading.filter_all')} ({rosterRows.length})
            </button>
            <button
              onClick={() => setStatusFilter('missing')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === 'missing'
                  ? 'bg-slate-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {language === 'th' ? 'ยังไม่ส่ง' : 'Not submitted'} ({missingTotal})
            </button>
            <button
              onClick={() => setStatusFilter('suspicious')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer ${
                statusFilter === 'suspicious'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>{t('grading.filter_suspicious')} ({suspiciousTotal})</span>
            </button>
            <button
              onClick={() => setStatusFilter('pending')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === 'pending'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {t('grading.filter_pending')} ({submissions.length - gradedTotal})
            </button>
            <button
              onClick={() => setStatusFilter('graded')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === 'graded'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {t('grading.filter_graded')} ({gradedTotal})
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 tracking-wide font-semibold border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="py-3.5 px-4 sm:px-6">{t('grading.table.student_name')}</th>
                <th className="py-3.5 px-4 sm:px-6">{t('grading.table.status')}</th>
                <th className="py-3.5 px-4 sm:px-6">{t('grading.table.time_spent')}</th>
                <th className="py-3.5 px-4 sm:px-6">{t('grading.table.integrity')}</th>
                <th className="py-3.5 px-4 sm:px-6 text-center">{t('grading.table.score')}</th>
                <th className="py-3.5 px-4 sm:px-6 text-right">{t('grading.table.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    {t('common.no_data')}
                  </td>
                </tr>
              ) : (
                filteredRows.map(({ key, student, submission: sub }) => {
                  const isGraded = sub?.total_score != null;
                  const fullName = student?.first_name
                    ? `${student.first_name} ${student.last_name || ''}`.trim()
                    : (language === 'th' ? 'ไม่พบข้อมูลนักเรียน' : 'Unknown student');
                  const initials = (student?.first_name?.[0] || '?') + (student?.last_name?.[0] || '');
                  const isLate = sub?.status === 'late';
                  const studentCell = (
                      <td className="py-3.5 px-4 sm:px-6">
                        <div className="flex items-center gap-3 min-w-0">
                          {student?.avatar_url ? (
                            <img src={student.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0 ring-2 ring-white dark:ring-slate-900" />
                          ) : (
                            <span className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-xs font-black flex items-center justify-center shrink-0">
                              {initials}
                            </span>
                          )}
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-slate-900 dark:text-white truncate">{fullName}</p>
                            <p className="text-[11px] text-slate-400 font-mono">
                              {student?.student_id ? `${language === 'th' ? 'รหัส' : 'ID'} ${student.student_id}` : (language === 'th' ? 'ยังไม่ระบุรหัสนักเรียน' : 'No student ID')}
                            </p>
                          </div>
                        </div>
                      </td>
                  );

                  if (!sub) {
                    return (
                      <tr key={key} className="bg-slate-50/40 dark:bg-slate-900/40">
                        {studentCell}
                        <td className="py-3.5 px-4 sm:px-6 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                            {language === 'th' ? 'ยังไม่ส่ง' : 'Not submitted'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 sm:px-6 text-slate-400">-</td>
                        <td className="py-3.5 px-4 sm:px-6 text-slate-400">-</td>
                        <td className="py-3.5 px-4 sm:px-6 text-center text-slate-400">-</td>
                        <td className="py-3.5 px-4 sm:px-6 text-right text-[11px] text-slate-400 italic whitespace-nowrap">
                          {language === 'th' ? 'รอนักเรียนส่งงาน' : 'Awaiting student'}
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={key} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      {/* Student: real photo (LINE) or initials, name and student number */}
                      {studentCell}

                      {/* Submission status + when it was submitted */}
                      <td className="py-3.5 px-4 sm:px-6 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            isLate
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : sub.status === 'submitted'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isLate ? 'bg-amber-500' : sub.status === 'submitted' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {sub.status === 'submitted'
                            ? t('grading.status_badges.submitted')
                            : isLate
                            ? t('grading.status_badges.late')
                            : t('grading.status_badges.pending')}
                        </span>
                        {sub.submitted_at && (
                          <p className="text-[11px] text-slate-400 mt-1">
                            {formatDateTime(sub.submitted_at, language)}
                          </p>
                        )}
                      </td>

                      <td className="py-3.5 px-4 sm:px-6 text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap">
                        {Math.floor(sub.time_spent_seconds / 60)} {t('common.minutes')}
                      </td>

                      <td className="py-3.5 px-4 sm:px-6">
                        <div className="flex items-center gap-2">
                          <AntiCheatingBadge
                            isFlagged={sub.is_flagged_suspicious}
                            tabSwitchCount={sub.tab_switch_count}
                            totalTimeAwaySeconds={sub.total_time_away_seconds}
                          />
                          {sub.is_flagged_suspicious && (
                            <button
                              type="button"
                              onClick={() => handleOpenAudit(sub)}
                              className="text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                            >
                              <span>{t('grading.actions.view_audit')}</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 sm:px-6 text-center whitespace-nowrap">
                        {isGraded ? (
                          <span className="inline-flex items-baseline gap-0.5 px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-black">
                            <span className="text-sm tabular-nums">{sub.total_score}</span>
                            <span className="text-[11px] font-semibold opacity-70">/ {sub.max_total_score || assignment?.total_points || 20}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-[11px] font-bold">
                            {t('grading.pending_eval')}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 sm:px-6 text-right">
                        <button
                          type="button"
                          disabled={!grader}
                          onClick={() => handleOpenGrading(sub)}
                          className={`px-3.5 py-1.5 rounded-xl font-bold transition-all shadow-xs flex items-center gap-1.5 ml-auto cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                            isGraded
                              ? 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-50'
                              : 'bg-amber-500 hover:bg-amber-600 text-slate-950'
                          }`}
                        >
                          <span>{isGraded ? (language === 'th' ? 'แก้ไขคะแนน' : 'Edit grade') : t('grading.actions.grade_btn')}</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Integrity Audit Modal */}
      {isAuditModalOpen && auditSubmission && (
        <IntegrityAuditModal
          isOpen={isAuditModalOpen}
          submission={auditSubmission}
          events={auditEvents}
          onClose={() => setIsAuditModalOpen(false)}
        />
      )}

      {/* Single-Page Continuous Grading Workspace Modal */}
      {isGradingWorkspaceOpen && gradingSubmission && grader && (
        <GradingWorkspace
          key={gradingSubmission.id}
          submission={gradingSubmission}
          questions={questions}
          initialAnswers={gradingAnswers}
          grader={grader}
          studentPosition={gradingIndex >= 0 ? { index: gradingIndex, total: gradingOrder.length } : undefined}
          onClose={() => {
            setIsGradingWorkspaceOpen(false);
            refreshSubmissions();
          }}
          onPrevStudent={gradingIndex > 0 ? () => handleOpenGrading(gradingOrder[gradingIndex - 1]) : undefined}
          onNextStudent={
            gradingIndex >= 0 && gradingIndex < gradingOrder.length - 1
              ? () => {
                  refreshSubmissions();
                  handleOpenGrading(gradingOrder[gradingIndex + 1]);
                }
              : undefined
          }
          onSaveGrade={(subId, qId, score, comment, teacherId, teacherName, teacherRole) =>
            dataService.saveTeacherGrade(subId, qId, score, comment, teacherId, teacherName, teacherRole as TeacherRole)
          }
        />
      )}
    </div>
  );
}
