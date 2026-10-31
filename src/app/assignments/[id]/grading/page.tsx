'use client';

import React, { useState, useEffect, useRef, use, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { fetchCached, patchCache, readCache, watchClassrooms } from '@/lib/cache/sessionCache';
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
import { ReferenceWorkLink } from '@/components/ReferenceWorkLink';
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
  Rocket,
} from 'lucide-react';
import { ASSIGNMENT_STATUS_CLASSES, draftExpiresAt, getAssignmentStatus, getAssignmentWindow, LATE_WINDOW_HOURS, QUIZ_LATE_GRACE_MINUTES } from '@/lib/utils/assignmentWindow';
import { isGraded, isHandedIn, isIntegrityFlagged, isMissing, isStudentSubmission, needsGrading } from '@/lib/utils/gradingStatus';

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
  /** Roster entry id (classroom.students[].id); missing for students no longer on the roster. */
  rosterId?: string;
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
  const [showControls, setShowControls] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const cacheKey = `assignmentGrading:${assignmentId}`;
  // Each submissions fetch gets a number; only the newest may write state, so a
  // slow earlier response (e.g. from "save & next") never brings back old scores.
  const submissionsSeqRef = useRef(0);

  /** useCache: show this session's copy at once (first open only; reloads after a change always refetch). */
  const loadAllData = async ({ useCache = false }: { useCache?: boolean } = {}) => {
    const teacherId = clerkUser?.id;
    const seq = ++submissionsSeqRef.current;
    try {
      // Assignment (with its classroom roster) and submissions load together.
      const load = async () => {
        const [detail, subs] = await Promise.all([
          dataService.getAssignmentById(assignmentId, { withClassroom: true }),
          dataService.getSubmissions(assignmentId),
        ]);
        return { ...detail, subs };
      };
      // Refetch only if something may have changed since.
      const hit = useCache && teacherId ? readCache<Awaited<ReturnType<typeof load>>>(cacheKey, teacherId) : null;
      if (hit) {
        applyLoaded(hit.value);
        setLoading(false);
        if (hit.fresh) return;
      }
      const loaded = teacherId ? await fetchCached(cacheKey, teacherId, load) : await load();
      if (seq !== submissionsSeqRef.current) return;
      applyLoaded(loaded);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const applyLoaded = ({
    assignment: asg,
    questions: qs,
    classroom: cls,
    subs,
  }: Awaited<ReturnType<typeof dataService.getAssignmentById>> & { subs: Submission[] }) => {
    setAssignment(asg);
    setQuestions(qs);
    setSubmissions(subs);
    if (asg) {
      setOverrideStatus(asg.status_override || 'auto');
      // Suggest the current extension, or two days from now at 23:59.
      setExtendedDateTime(asg.extended_until || daysFromNowAt(2, 23, 59));
      if (cls) {
        setClassroom(cls);
        watchClassrooms([cls.id]);
      }
    }
  };

  /**
   * Refetches the submissions and also refreshes this session's cached copy,
   * so coming back to the page later shows the new scores straight away.
   */
  const refreshSubmissions = async () => {
    const seq = ++submissionsSeqRef.current;
    try {
      const subs = await dataService.getSubmissions(assignmentId);
      if (seq !== submissionsSeqRef.current) return;
      setSubmissions(subs);
      const teacherId = clerkUser?.id;
      const cached = teacherId ? readCache<{ subs: Submission[] }>(cacheKey, teacherId) : null;
      if (teacherId && cached) patchCache(cacheKey, teacherId, { ...cached.value, subs });
    } catch (err) {
      console.warn('Refreshing submissions failed:', err);
    }
  };

  /** Shows a just-saved total at once, before the refetch confirms it. */
  const applyGradedTotal = (submissionId: string, total: number | null, maxTotal: number) => {
    submissionsSeqRef.current++;
    setSubmissions((prev) =>
      prev.map((s) => (s.id === submissionId ? { ...s, total_score: total ?? undefined, max_total_score: maxTotal || s.max_total_score } : s))
    );
  };

  useEffect(() => {
    // Shows this session's cached copy at once on purpose, then fetches if it may be stale.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAllData({ useCache: true });
  }, [assignmentId]);

  // New submissions arrive as a server signal for this classroom; refetch then.
  // A slow poll covers the case where the realtime socket is down. Refreshes
  // wait while a grading or audit dialog is open so it doesn't jump.
  const pausedRef = useRef(false);
  useEffect(() => {
    pausedRef.current = isGradingWorkspaceOpen || isAuditModalOpen;
  }, [isGradingWorkspaceOpen, isAuditModalOpen]);
  const signalClassroomId = assignment?.classroom_id;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setInterval> | undefined;
    let live = false;
    let lastFetch = Date.now();
    const refresh = () => {
      if (pausedRef.current || document.visibilityState !== 'visible') return;
      lastFetch = Date.now();
      refreshSubmissions();
    };
    const refreshSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch > 30000) refresh();
    };

    const unsubscribe = signalClassroomId
      ? dataService.subscribeToClassroomSignals(
          [signalClassroomId],
          (_id, signal) => {
            if (signal?.type === 'submission' && signal.assignmentId === assignmentId) refreshSoon();
          },
          (isLive) => {
            live = isLive;
            if (isLive) {
              clearInterval(fallback);
              fallback = undefined;
            } else if (!fallback) {
              fallback = setInterval(() => !live && refresh(), 30000);
            }
          }
        )
      : () => {};

    // Same-browser events refresh instantly.
    window.addEventListener('pudding-submission-created', refreshSoon);
    document.addEventListener('visibilitychange', onVisible);
    let bc: BroadcastChannel | null = null;
    if ('BroadcastChannel' in window) {
      bc = new BroadcastChannel('pudding-realtime');
      bc.onmessage = (event) => {
        if (event.data?.type === 'submission_created') refreshSoon();
      };
    }

    return () => {
      unsubscribe();
      clearTimeout(timer);
      clearInterval(fallback);
      window.removeEventListener('pudding-submission-created', refreshSoon);
      document.removeEventListener('visibilitychange', onVisible);
      bc?.close();
    };
  }, [assignmentId, signalClassroomId]);

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

      const name = (updated || assignment)?.title || '';
      const kind = (updated || assignment)?.is_exam ? (language === 'th' ? 'ข้อสอบ' : 'quiz') : language === 'th' ? 'งาน' : 'assignment';
      if (newStatus === 'force_closed') {
        showToast(language === 'th' ? `🔒 ปิดรับ${kind} “${name}” แล้ว` : `🔒 Closed ${kind} “${name}”`);
      } else if (newStatus === 'extended') {
        showToast(language === 'th' ? `⏳ ขยายเวลาส่ง${kind} “${name}” แล้ว` : `⏳ Extended ${kind} “${name}”`);
      } else {
        showToast(language === 'th' ? `${kind} “${name}” กลับไปรับงานตามกำหนดส่งแล้ว` : `${kind} “${name}” is back on its deadline`);
      }
      setShowExtendPicker(false);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error && err.message ? err.message : 'Error updating deadline override');
    }
  };

  // Release scheduled work now (the class reached the topic early).
  const handlePublishNow = async () => {
    if (!assignment) return;
    const kind = assignment.is_exam ? (language === 'th' ? 'ข้อสอบ' : 'quiz') : language === 'th' ? 'งาน' : 'assignment';
    if (!confirm(language === 'th'
      ? `เผยแพร่${kind}นี้ตอนนี้เลยหรือไม่?\nนักเรียนจะเห็นและเริ่มทำได้ทันที และจะได้รับแจ้งเตือนใน LINE`
      : `Publish this ${kind} now? Students can start right away and get a LINE notification.`)) return;
    try {
      const updated = await dataService.publishAssignmentNow(assignmentId);
      setAssignment(updated || { ...assignment, publish_at: new Date().toISOString() });
      showToast(language === 'th' ? `เผยแพร่${kind}แล้ว นักเรียนเริ่มทำได้ทันที` : `Published; students can start now`);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error && err.message ? err.message : 'Error publishing assignment');
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


  // Students who never handed in: record a row so the teacher can grade them
  // (zero = an official 0 on every question). Works after submissions close too.
  const [recordingKeys, setRecordingKeys] = useState<Set<string>>(new Set());
  const recordMissing = async (rows: RosterRow[], zero: boolean) => {
    const targets = rows.filter((row) => row.rosterId && !recordingKeys.has(row.key));
    if (!targets.length || !grader) return [];
    setRecordingKeys((prev) => new Set([...prev, ...targets.map((row) => row.key)]));
    try {
      const created = await dataService.recordMissingSubmissions(
        assignmentId,
        targets.map((row) => row.rosterId as string),
        zero,
        grader.name
      );
      await refreshSubmissions();
      return created;
    } catch (err) {
      console.error(err);
      alert(err instanceof Error && err.message ? err.message : th ? 'บันทึกไม่สำเร็จ' : 'Could not save');
      return [];
    } finally {
      setRecordingKeys((prev) => {
        const next = new Set(prev);
        targets.forEach((row) => next.delete(row.key));
        return next;
      });
    }
  };

  const handleGiveZero = async (row: RosterRow) => {
    const created = await recordMissing([row], true);
    if (created.length) showToast(th ? 'ให้ 0 คะแนนแล้ว (นักเรียนยังส่งงานได้หากงานยังเปิดรับ)' : 'Gave 0 (the student can still hand in while it is open)');
  };

  const handleGiveZeroToAll = async () => {
    if (!unrecordedRows.length) return;
    const stillOpen = assignmentWindow?.acceptsSubmissions;
    const message = th
      ? `ให้ 0 คะแนนนักเรียนที่ยังไม่ส่ง ${unrecordedRows.length} คน?${stillOpen ? '\nงานนี้ยังเปิดรับอยู่ หากนักเรียนส่งงานภายหลัง คะแนน 0 จะถูกแทนที่ด้วยงานที่ส่งมา' : ''}`
      : `Give 0 to ${unrecordedRows.length} students who have not submitted?${stillOpen ? '\nThis is still open; work handed in later replaces the 0.' : ''}`;
    if (!confirm(message)) return;
    const created = await recordMissing(unrecordedRows, true);
    if (created.length) showToast(th ? `ให้ 0 คะแนนแล้ว ${created.length} คน` : `Gave 0 to ${created.length} students`);
  };

  const handleGradeMissing = async (row: RosterRow) => {
    const [created] = await recordMissing([row], false);
    if (created) handleOpenGrading({ ...created, student: (created.student || row.student) as User });
  };

  // Actions on a student with nothing handed in: grade by hand, or a quick 0.
  const missingActions = (row: RosterRow) => {
    if (!row.rosterId || !grader || grader.role === 'researcher') {
      return <span className="text-[11px] text-slate-400 italic">{th ? 'รอนักเรียนส่งงาน' : 'Awaiting student'}</span>;
    }
    const busy = recordingKeys.has(row.key);
    return (
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => handleGiveZero(row)}
          disabled={busy}
          className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50"
        >
          {th ? 'ให้ 0' : 'Give 0'}
        </button>
        <button
          type="button"
          onClick={() => handleGradeMissing(row)}
          disabled={busy}
          className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 cursor-pointer disabled:opacity-50 inline-flex items-center gap-0.5"
        >
          {th ? 'ให้คะแนน' : 'Grade'}
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    );
  };

  // Every enrolled student, with their submission if any, then submissions from
  // students no longer on the roster. Roster entries may carry users.id, the
  // LINE id or the school number, so match on any of them.
  const rosterRows: RosterRow[] = (() => {
    const used = new Set<string>();
    const rows: RosterRow[] = (classroom?.students || []).map((std) => {
      const sub = submissions.find(
        (s) =>
          !used.has(s.id) && isStudentSubmission(s, std)
      );
      if (sub) used.add(sub.id);
      return { key: `std-${std.id}`, student: sub?.student || std, submission: sub || null, rosterId: std.id };
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

  // Leaving the screen is tracked during quizzes only, so homework never counts as suspicious.
  const tracksAway = !!assignment?.is_exam;
  const isSuspicious = (sub: Submission) => isIntegrityFlagged(sub, tracksAway);

  const filteredRows = rosterRows.filter(({ student, submission: sub }) => {
    const studentName = `${student?.first_name || ''} ${student?.last_name || ''}`;
    const studentId = student?.student_id || '';
    const matchesSearch =
      studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      studentId.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (statusFilter === 'missing') return isMissing(sub);
    if (statusFilter === 'suspicious') return !!sub && isSuspicious(sub);
    if (statusFilter === 'pending') return !!sub && needsGrading(sub);
    if (statusFilter === 'graded') return !!sub && isGraded(sub);

    return true;
  });

  const suspiciousTotal = submissions.filter(isSuspicious).length;
  const handedInTotal = submissions.filter(isHandedIn).length;
  const toGradeTotal = submissions.filter(needsGrading).length;
  // Checked: graded hand-ins plus scores (e.g. a 0) given to students who never handed in.
  const gradedTotal = submissions.filter(isGraded).length;
  const checkableTotal = gradedTotal + toGradeTotal;
  // Still missing: no row, or a recorded row the teacher has not scored yet.
  const missingTotal = rosterRows.filter((row) => isMissing(row.submission)).length;
  // Students with nothing recorded yet, who "give 0 to everyone missing" applies to.
  const unrecordedRows = rosterRows.filter((row) => !row.submission && row.rosterId);

  const assignmentWindow = assignment ? getAssignmentWindow(assignment) : null;
  const assignmentStatus = assignment && assignmentWindow ? getAssignmentStatus(assignmentWindow, assignment.is_exam, language) : null;
  const deadlineLabel = formatDateTime(
    assignmentWindow?.deadline != null ? new Date(assignmentWindow.deadline).toISOString() : assignment?.due_date,
    language
  );
  const lateUntilLabel = assignmentWindow?.lateUntil != null ? formatDateTime(new Date(assignmentWindow.lateUntil).toISOString(), language) : '';
  const th = language === 'th';
  // What "auto" actually does right now: homework keeps taking late work, a quiz closes.
  const autoBannerText = !assignment
    ? ''
    : assignmentWindow?.isDraft
    ? th
      ? `ฉบับร่าง — นักเรียนยังไม่เห็นงาน จนกว่าคุณครูจะกดเผยแพร่${draftExpiresAt(assignment) ? ` (ลบอัตโนมัติ ${formatDateTime(draftExpiresAt(assignment), language)} หากยังไม่เผยแพร่)` : ''}`
      : `Draft; hidden from students until you publish it${draftExpiresAt(assignment) ? ` (deleted automatically on ${formatDateTime(draftExpiresAt(assignment), language)} unless published)` : ''}`
    : assignmentWindow?.isScheduled && assignment.publish_at
    ? th
      ? `ตั้งเวลาเผยแพร่ ${formatDateTime(assignment.publish_at, language)} — ก่อนถึงเวลานี้นักเรียนยังไม่เห็นงาน`
      : `Scheduled for ${formatDateTime(assignment.publish_at, language)}; hidden from students until then`
    : assignment.is_exam
    ? assignmentWindow?.isPastDeadline
      ? th ? 'อัตโนมัติ: หมดเวลาแล้ว ปิดรับคำตอบ' : 'Automatic: time is up, answers are closed'
      : th
        ? `อัตโนมัติ: เปิดรับคำตอบถึง ${deadlineLabel} แล้วปิดรับ (คำตอบที่ส่งเข้ามาภายใน ${QUIZ_LATE_GRACE_MINUTES} นาทีหลังหมดเวลาจะบันทึกว่าส่งช้า นักเรียนไม่เห็นข้อนี้)`
        : `Automatic: open until ${deadlineLabel}, then closes (sheets arriving within ${QUIZ_LATE_GRACE_MINUTES} min after are saved as late; students are not told)`
    : assignmentWindow?.isLateClosed
    ? th
      ? `อัตโนมัติ: ปิดรับแล้ว (เลยกำหนดส่ง ${LATE_WINDOW_HOURS} ชม.) — ใช้ "ขยายเวลา" หากต้องการเปิดรับอีกครั้ง`
      : `Automatic: closed ${LATE_WINDOW_HOURS}h after the deadline. Extend the deadline to reopen.`
    : assignmentWindow?.isPastDeadline
    ? th
      ? `อัตโนมัติ: เลยกำหนดส่งแล้ว รับงานส่งช้าถึง ${lateUntilLabel} แล้วปิดรับเอง — กด "ล็อกปิดรับงานทันที" หากต้องการหยุดรับก่อน`
      : `Automatic: past due, accepting late work until ${lateUntilLabel}, then closes. Use "Close now" to stop earlier.`
    : th
    ? `อัตโนมัติ: เปิดรับงานถึง ${deadlineLabel} หลังจากนั้นรับงานส่งช้าได้อีก ${LATE_WINDOW_HOURS} ชม. แล้วปิดรับเอง`
    : `Automatic: open until ${deadlineLabel}; late work accepted for ${LATE_WINDOW_HOURS}h more, then closes`;

  const summaryTiles: Array<{
    id: typeof statusFilter;
    label: string;
    icon?: React.ReactNode;
    value: number;
    of?: number;
    active: string;
    label_class: string;
    value_class: string;
  }> = [
    {
      id: 'all',
      label: th ? 'ส่งแล้ว' : 'Handed in',
      value: handedInTotal,
      of: rosterRows.length,
      active: 'bg-white dark:bg-slate-900 border-slate-900 dark:border-white',
      label_class: 'text-slate-500 dark:text-slate-400',
      value_class: 'text-slate-900 dark:text-white',
    },
    {
      id: 'missing',
      label: th ? 'ยังไม่ส่ง' : 'Missing',
      value: missingTotal,
      active: 'bg-slate-100 dark:bg-slate-800 border-slate-500',
      label_class: 'text-slate-500 dark:text-slate-400',
      value_class: missingTotal > 0 ? 'text-slate-900 dark:text-white' : 'text-slate-400',
    },
    {
      id: 'pending',
      label: th ? 'รอตรวจ' : 'To grade',
      value: toGradeTotal,
      active: 'bg-amber-50 dark:bg-amber-950/40 border-amber-500',
      label_class: 'text-amber-700 dark:text-amber-400',
      value_class: toGradeTotal > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400',
    },
    {
      id: 'graded',
      label: th ? 'ตรวจแล้ว' : 'Graded',
      value: gradedTotal,
      of: checkableTotal,
      active: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500',
      label_class: 'text-emerald-700 dark:text-emerald-400',
      value_class: 'text-emerald-600 dark:text-emerald-400',
    },
    ...(tracksAway
      ? [
          {
            id: 'suspicious' as const,
            label: th ? 'สลับจอ' : 'Flagged',
            icon: <ShieldAlert className="w-3.5 h-3.5" />,
            value: suspiciousTotal,
            active: 'bg-rose-50 dark:bg-rose-950/40 border-rose-500',
            label_class: 'text-rose-600 dark:text-rose-400',
            value_class: suspiciousTotal > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400',
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-5 sm:space-y-6 pb-20">
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

        <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 sm:space-y-5">
          {/* What it is */}
          <div className="space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${
                  assignment?.is_exam
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                }`}
              >
                {assignment?.is_exam ? t('assignment_creator.mode_exam') : t('assignment_creator.mode_assignment')}
              </span>
              {(classroom?.name || assignment?.classroom_name) && (
                <span className="px-2.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold">
                  {classroom?.name || assignment?.classroom_name}
                </span>
              )}
              {assignment && <ReferenceWorkLink assignment={assignment} className="max-w-full sm:max-w-xs py-0.5" />}
            </div>
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white leading-snug min-w-0 break-words">
                {assignment?.title || t('grading.title')}
              </h1>
              {assignment && grader && (
                <Link
                  href={`/assignments/new?edit=${assignment.id}&classroomId=${assignment.classroom_id}&from=classroom`}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-amber-600 hover:border-amber-400 transition-colors"
                >
                  ✏️ <span className="hidden sm:inline">{th ? 'แก้ไขงาน' : 'Edit'}</span>
                </Link>
              )}
            </div>
            {assignment?.description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{assignment.description}</p>
            )}
          </div>

          {/* The two answers a teacher looks for: does it still take work, and is grading done? */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {assignmentStatus && (
              <div className={`p-3.5 rounded-2xl border ${ASSIGNMENT_STATUS_CLASSES[assignmentStatus.tone]} border-solid`}>
                <span className="text-[11px] font-bold opacity-80 block">{th ? 'การรับงาน' : 'Submissions'}</span>
                <p className="mt-0.5 text-base font-black flex items-center gap-1.5">
                  {assignmentStatus.tone === 'closed' ? <Lock className="w-4 h-4" /> : assignmentStatus.tone === 'late' ? <Unlock className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                  {assignmentStatus.label}
                </p>
                <p className="mt-1 text-[11px] font-semibold opacity-90 flex items-center gap-1">
                  <Calendar className="w-3 h-3 shrink-0" />
                  {assignment?.is_exam ? (th ? 'ปิดรับคำตอบ' : 'Closes') : t('grading.due_date')} {deadlineLabel}
                </p>
                {assignmentStatus.note && <p className="mt-1 text-[11px] leading-relaxed opacity-80">{assignmentStatus.note}</p>}
              </div>
            )}

            <div
              className={`p-3.5 rounded-2xl border ${
                toGradeTotal > 0
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-900 text-amber-900 dark:text-amber-200'
                  : gradedTotal > 0
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
                  : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <span className="text-[11px] font-bold opacity-80 block">{th ? 'การตรวจ' : 'Grading'}</span>
              <p className="mt-0.5 text-base font-black flex items-center gap-1.5">
                {toGradeTotal > 0 ? <Clock className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                {toGradeTotal > 0
                  ? th ? `รอตรวจ ${toGradeTotal} คน` : `${toGradeTotal} left to grade`
                  : gradedTotal > 0
                  ? th ? 'ตรวจครบแล้ว' : 'All graded'
                  : th ? 'ยังไม่มีผู้ส่งงาน' : 'Nothing handed in yet'}
              </p>
              <div className="mt-2 flex w-full h-2 rounded-full overflow-hidden bg-white/70 dark:bg-slate-900/60">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(gradedTotal / (rosterRows.length || 1)) * 100}%` }} />
                <div className="h-full bg-amber-400 transition-all" style={{ width: `${(toGradeTotal / (rosterRows.length || 1)) * 100}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] font-semibold opacity-90">
                {th
                  ? `ตรวจแล้ว ${gradedTotal}/${checkableTotal} คน · ส่งแล้ว ${handedInTotal}/${rosterRows.length} คน`
                  : `${gradedTotal}/${checkableTotal} checked · ${handedInTotal}/${rosterRows.length} handed in`}
              </p>
            </div>
          </div>

          {/* Counts: tap one to show those students below */}
          <div className={`grid grid-cols-2 gap-2 sm:gap-3 ${tracksAway ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
            {summaryTiles.map((tile) => (
              <button
                key={tile.id}
                type="button"
                onClick={() => {
                  setStatusFilter(statusFilter === tile.id ? 'all' : tile.id);
                  document.getElementById('grading-roster')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`p-3 rounded-2xl text-left border transition-colors cursor-pointer ${
                  statusFilter === tile.id ? tile.active : 'bg-slate-50 dark:bg-slate-800/60 border-transparent hover:border-slate-200 dark:hover:border-slate-700'
                }`}
              >
                <span className={`text-[11px] font-bold flex items-center gap-1 ${tile.label_class}`}>
                  {tile.icon}
                  {tile.label}
                </span>
                <span className={`block text-xl sm:text-2xl font-black mt-0.5 ${tile.value_class}`}>
                  {tile.value}
                  {tile.of != null && <span className="text-xs font-semibold text-slate-400 ml-1">/ {tile.of}</span>}
                </span>
              </button>
            ))}
          </div>

          {unrecordedRows.length > 0 && grader && grader.role !== 'researcher' && (
            <button
              type="button"
              onClick={handleGiveZeroToAll}
              disabled={recordingKeys.size > 0}
              className="w-full sm:w-auto px-3 py-2 rounded-xl text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50"
            >
              {th ? `ให้ 0 คะแนนทุกคนที่ยังไม่ส่ง (${unrecordedRows.length})` : `Give 0 to all missing (${unrecordedRows.length})`}
            </button>
          )}

          {/* Submission window controls, folded away until needed */}
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80">
            <button
              type="button"
              onClick={() => setShowControls((open) => !open)}
              aria-expanded={showControls}
              className="w-full p-3.5 flex items-center gap-2 text-left cursor-pointer"
            >
              <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">{t('submission_control.title')}</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {overrideStatus === 'force_closed'
                    ? t('submission_control.btn_force_close')
                    : overrideStatus === 'extended'
                    ? `${t('submission_control.btn_reopen')} · ${formatDateTime(assignment?.extended_until || extendedDateTime, language)}`
                    : t('submission_control.mode_auto')}
                </p>
              </div>
              <ChevronRight className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${showControls ? 'rotate-90' : ''}`} />
            </button>

            {showControls && (
              <div className="px-3.5 pb-3.5 space-y-3 animate-in fade-in">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('submission_control.subtitle')}</p>
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
                      ) + (assignment?.is_exam ? '' : th ? ` (หลังจากนั้นรับงานส่งช้าอีก ${LATE_WINDOW_HOURS} ชม.)` : ` (late work accepted for ${LATE_WINDOW_HOURS}h after that)`)
                    : autoBannerText}
                </span>
              </div>

              {(assignmentWindow?.isScheduled || assignmentWindow?.isDraft) && (
                <button
                  type="button"
                  onClick={handlePublishNow}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-black cursor-pointer shrink-0 ml-6 sm:ml-0 shadow-xs"
                >
                  <Rocket className="w-3.5 h-3.5" />
                  {th ? 'เผยแพร่ตอนนี้' : 'Publish now'}
                </button>
              )}

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
            )}
          </div>
        </div>
      </div>

      {/* Submissions Table & Filter Controls */}
      <div id="grading-roster" className="scroll-mt-20 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        {/* Table Filters Bar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
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
            {tracksAway && (
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
            )}
            <button
              onClick={() => setStatusFilter('pending')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === 'pending'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {t('grading.filter_pending')} ({toGradeTotal})
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

        {/* Phone list: one card per student instead of a sideways-scrolling table */}
        <ul className="sm:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {filteredRows.length === 0 ? (
            <li className="py-8 text-center text-xs text-slate-400">{t('common.no_data')}</li>
          ) : (
            filteredRows.map((row) => {
              const { key, student, submission: sub } = row;
              const isGraded = sub?.total_score != null;
              const isLate = sub?.status === 'late';
              const fullName = student?.first_name
                ? `${student.first_name} ${student.last_name || ''}`.trim()
                : (language === 'th' ? 'ไม่พบข้อมูลนักเรียน' : 'Unknown student');
              const initials = (student?.first_name?.[0] || '?') + (student?.last_name?.[0] || '');
              return (
                <li key={key} className={`p-4 space-y-3 ${sub ? '' : 'bg-slate-50/40 dark:bg-slate-900/40'}`}>
                  <div className="flex items-center gap-3">
                    {student?.avatar_url ? (
                      <img src={student.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0 ring-2 ring-white dark:ring-slate-900" />
                    ) : (
                      <span className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-xs font-black flex items-center justify-center shrink-0">
                        {initials}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm text-slate-900 dark:text-white truncate">{fullName}</p>
                      <p className="text-[11px] text-slate-400 font-mono truncate">
                        {student?.student_id ? `${language === 'th' ? 'รหัส' : 'ID'} ${student.student_id}` : (language === 'th' ? 'ยังไม่ระบุรหัสนักเรียน' : 'No student ID')}
                      </p>
                    </div>
                    {sub && (isGraded ? (
                      <span className="shrink-0 inline-flex items-baseline gap-0.5 px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-black">
                        <span className="text-sm tabular-nums">{sub.total_score}</span>
                        <span className="text-[11px] font-semibold opacity-70">/ {sub.max_total_score || assignment?.total_points || 20}</span>
                      </span>
                    ) : (
                      <span className="shrink-0 inline-flex items-center px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-[11px] font-bold">
                        {t('grading.pending_eval')}
                      </span>
                    ))}
                  </div>

                  {!sub ? (
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                        {language === 'th' ? 'ยังไม่ส่ง' : 'Not submitted'}
                      </span>
                      {missingActions(row)}
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px]">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold ${
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
                        {sub.submitted_at && <span className="text-slate-400">{formatDateTime(sub.submitted_at, language)}</span>}
                        <span className="text-slate-400 font-mono">· {Math.floor(sub.time_spent_seconds / 60)} {t('common.minutes')}</span>
                      </div>

                      {(tracksAway || sub.submitted_by) && (
                        <div className="flex flex-wrap items-center gap-2">
                          {tracksAway && (
                            <AntiCheatingBadge
                              isFlagged={sub.is_flagged_suspicious}
                              tabSwitchCount={sub.tab_switch_count}
                              totalTimeAwaySeconds={sub.total_time_away_seconds}
                            />
                          )}
                          {sub.submitted_by && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-900 text-[11px] font-bold">
                              📱 {th ? 'ส่งจากเครื่องของ' : 'Sent via'} {sub.submitted_by_name || (th ? 'เพื่อน' : 'a classmate')}
                            </span>
                          )}
                          {isSuspicious(sub) && (
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
                      )}

                      <button
                        type="button"
                        disabled={!grader}
                        onClick={() => handleOpenGrading(sub)}
                        className={`w-full h-10 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          isGraded
                            ? 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-50'
                            : 'bg-amber-500 hover:bg-amber-600 text-slate-950'
                        }`}
                      >
                        <span>{isGraded ? (language === 'th' ? 'แก้ไขคะแนน' : 'Edit grade') : t('grading.actions.grade_btn')}</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </li>
              );
            })
          )}
        </ul>

        {/* Table Content */}
        <div className="hidden sm:block overflow-x-auto">
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
                filteredRows.map((row) => {
                  const { key, student, submission: sub } = row;
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
                        <td className="py-3.5 px-4 sm:px-6 text-right whitespace-nowrap">
                          <div className="inline-flex">{missingActions(row)}</div>
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
                        <div className="flex flex-wrap items-center gap-2">
                          {tracksAway ? (
                            <AntiCheatingBadge
                              isFlagged={sub.is_flagged_suspicious}
                              tabSwitchCount={sub.tab_switch_count}
                              totalTimeAwaySeconds={sub.total_time_away_seconds}
                            />
                          ) : (
                            !sub.submitted_by && <span className="text-slate-400">-</span>
                          )}
                          {sub.submitted_by && (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-900 text-[11px] font-bold whitespace-nowrap"
                              title={th ? 'นักเรียนส่งด้วยโทรศัพท์ของเพื่อนร่วมห้อง' : "Sent from a classmate's phone"}
                            >
                              📱 {th ? 'ส่งจากเครื่องของ' : 'Sent via'} {sub.submitted_by_name || (th ? 'เพื่อน' : 'a classmate')}
                            </span>
                          )}
                          {isSuspicious(sub) && (
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
          tracksAway={tracksAway}
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
          onGraded={(total, maxTotal) => applyGradedTotal(gradingSubmission.id, total, maxTotal)}
          onSaveGrade={(subId, qId, score, comment, teacherId, teacherName, teacherRole) =>
            dataService.saveTeacherGrade(subId, qId, score, comment, teacherId, teacherName, teacherRole as TeacherRole)
          }
          onUpdateAnswerKey={async (questionId, idealAnswer) => {
            const result = await dataService.updateAnswerKey(assignmentId, questionId, idealAnswer);
            setQuestions((prev) => prev.map((q) => (q.id === questionId ? { ...q, ideal_answer: result.question.ideal_answer } : q)));
            refreshSubmissions();
            return result;
          }}
        />
      )}
    </div>
  );
}
