'use client';

import { announceNote } from '@/lib/utils/announceNote';
import { usePageTitle } from '@/lib/hooks/usePageTitle';
import React, { useState, useEffect, useRef, useMemo, use, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { fetchCached, patchCache, readCache, watchClassrooms, writeCache } from '@/lib/cache/sessionCache';
import {
  Assignment,
  Classroom,
  ClassroomTeacher,
  Question,
  Submission,
  SubmissionAnswer,
  SubmissionEvent,
  User,
} from '@/types/database';
import { formatDateTime } from '@/lib/utils/datetime';
import { AntiCheatingBadge } from '@/components/AntiCheatingBadge';
import { IntegrityAuditModal } from '@/components/IntegrityAuditModal';
import { GradingWorkspace } from '@/components/GradingWorkspace';
import { PageSkeleton } from '@/components/LoadingState';
import { AttachmentList } from '@/components/AssignmentAttachments';
import { assignmentAttachments } from '@/lib/utils/referenceWork';
import { AssignmentStatusDialog } from '@/components/AssignmentStatusDialog';
import { ReopenTimeDialog, reopenTimeSuggestion } from '@/components/ReopenTimeDialog';
import { RetakePicker } from '@/components/RetakePicker';
import { SiblingClassTabs } from '@/components/works/SiblingClassTabs';
import { announcesResults } from '@/components/works/WorkBits';
import { isRetake, isRetakeOf, rosterFor } from '@/lib/utils/retake';
import { isSurvey } from '@/lib/utils/survey';
import { SurveyResults } from '@/components/SurveyResults';
import {
  Search,
  Filter,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Award,
  ChevronDown,
  ChevronRight,
  Sparkles,
  UserCheck,
  FileText,
  Lock,
  Unlock,
  RotateCcw,
  Check,
  Calendar,
  Layers,
  PencilLine,
  Ban,
  Undo2,
  Loader2,
  Megaphone,
  Send,
} from 'lucide-react';
import { ASSIGNMENT_STATUS_CLASSES, canRecordNoSubmission, getAssignmentStatus, getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { useScheduleNow } from '@/lib/hooks/useScheduleNow';
import { isGraded, isHandedIn, isIntegrityFlagged, isMissing, isReopenActive, isStudentSubmission, needsGrading } from '@/lib/utils/gradingStatus';

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
  const className =
    'inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-amber-600 transition-colors cursor-pointer';

  let target: { href: string; label: string } | null = null;
  if (from === 'classroom' && fromClassroomId) {
    target = { href: `/classrooms/${fromClassroomId}?tab=classwork`, label: th ? 'กลับไปหน้างานของห้อง' : 'Back to classwork' };
  } else if (from === 'dashboard') {
    target = { href: '/dashboard', label: th ? 'กลับไปแดชบอร์ด' : 'Back to dashboard' };
  } else if (from === 'grading') {
    // The old grading hub now lives in the work list.
    target = { href: '/works', label: th ? 'กลับไปรายการงาน' : 'Back to work list' };
  } else if (from === 'works') {
    const returnTo = search.get('returnTo');
    target = { href: returnTo?.startsWith('/works') ? returnTo : '/works', label: th ? 'กลับไปรายการงาน' : 'Back to work list' };
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

/** The submission-status card, in the same soft tints as the grading card beside it. */
const STATUS_CARD_CLASSES: Record<keyof typeof ASSIGNMENT_STATUS_CLASSES, string> = {
  draft: 'bg-slate-50 dark:bg-slate-800/60 border-dashed border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300',
  scheduled: 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200',
  open: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200',
  late: 'bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-900/70 text-orange-800 dark:text-orange-200',
  closed: 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/70 text-rose-800 dark:text-rose-200',
};

/** ISO time `minutes` from now (outside the component: reading the clock is not render work). */
const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60000).toISOString();

/** "Edit grade" on graded work: a clear outlined amber button, apart from the solid "Grade" one. */
const EDIT_GRADE_CLASSES =
  'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 ring-2 ring-amber-400 dark:ring-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 shadow-sm shadow-amber-500/10';

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
  // Opened from the work list: every link out of here (edit, copy, retake…) keeps the way back to it.
  const pageSearch = useSearchParams();
  const worksReturn =
    pageSearch.get('from') === 'works' ? (pageSearch.get('returnTo')?.startsWith('/works') ? pageSearch.get('returnTo')! : '/works') : null;
  const editorFrom = worksReturn ? `from=works&returnTo=${encodeURIComponent(worksReturn)}` : 'from=classroom';

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  usePageTitle(assignment?.title ? `ตรวจ: ${assignment.title}` : null);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'suspicious' | 'pending' | 'graded' | 'missing'>('all');

  // Audit modal state
  const [auditSubmission, setAuditSubmission] = useState<Submission | null>(null);
  const [auditEvents, setAuditEvents] = useState<SubmissionEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const auditEventsCacheRef = useRef(new Map<string, SubmissionEvent[]>());
  const auditRequestRef = useRef(0);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

  // Grading workspace modal state
  const [gradingSubmission, setGradingSubmission] = useState<Submission | null>(null);
  const [gradingAnswers, setGradingAnswers] = useState<Record<string, SubmissionAnswer>>({});
  const [isGradingWorkspaceOpen, setIsGradingWorkspaceOpen] = useState(false);

  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const cacheKey = `assignmentGrading:${assignmentId}`;
  // The cached copy follows the assignment shown here (published now, deadline changed,
  // results announced). Without this, a later grade (applySubmissionChange stores the
  // copy as fresh) would bring back the old "draft / scheduled" assignment on the next
  // visit, with no refetch to correct it. Freshness is unchanged.
  useEffect(() => {
    const teacherId = clerkUser?.id;
    if (!teacherId || !assignment || assignment.id !== assignmentId) return;
    const cached = readCache<{ assignment: Assignment | null }>(cacheKey, teacherId);
    if (cached && cached.value.assignment !== assignment) patchCache(cacheKey, teacherId, { ...cached.value, assignment });
  }, [clerkUser?.id, assignment, assignmentId, cacheKey]);
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

  // Open Integrity Audit Modal
  // The popup opens at once (counts and start/hand-in times are already on the row);
  // the event log loads behind it. Logs seen this visit show instantly next time.
  const handleOpenAudit = async (submission: Submission) => {
    const cached = auditEventsCacheRef.current.get(submission.id);
    const request = ++auditRequestRef.current;
    setAuditSubmission(submission);
    setAuditEvents(cached || []);
    setAuditLoading(!cached);
    setIsAuditModalOpen(true);
    try {
      const events = await dataService.getSubmissionEvents(submission.id);
      auditEventsCacheRef.current.set(submission.id, events);
      if (request === auditRequestRef.current) setAuditEvents(events);
    } catch {
      if (request === auditRequestRef.current && !cached) setAuditEvents([]);
    } finally {
      if (request === auditRequestRef.current) setAuditLoading(false);
    }
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


  // Students who handed in nothing: once the deadline has passed (or the work
  // is closed) the teacher marks them "no submission", an official 0. Before
  // that nothing can be scored; the server enforces the same rule.
  const [recordingKeys, setRecordingKeys] = useState<Set<string>>(new Set());
  const recordMissing = async (rows: RosterRow[]) => {
    const targets = rows.filter((row) => row.rosterId && !recordingKeys.has(row.key));
    if (!targets.length || !grader) return [];
    setRecordingKeys((prev) => new Set([...prev, ...targets.map((row) => row.key)]));
    try {
      const recorded = await dataService.recordMissingSubmissions(
        assignmentId,
        targets.map((row) => row.rosterId as string),
        grader.name
      );
      await refreshSubmissions();
      return recorded;
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

  const lateStillAccepted = () => !!assignmentWindow?.acceptsSubmissions;

  const handleMarkNoSubmission = async (row: RosterRow) => {
    const recorded = await recordMissing([row]);
    if (recorded.length) {
      showToast(lateStillAccepted()
        ? (th ? 'บันทึกว่าไม่ส่งงาน (0 คะแนน) • หากนักเรียนส่งช้าภายหลัง งานที่ส่งจะแทนที่ 0' : 'Marked as no submission (0) • late work handed in later replaces it')
        : (th ? 'บันทึกว่าไม่ส่งงาน (0 คะแนน) แล้ว' : 'Marked as no submission (0)'));
    }
  };

  const handleMarkAllNoSubmission = async () => {
    if (!unrecordedRows.length) return;
    const message = th
      ? `บันทึกว่า "ไม่ส่งงาน" (0 คะแนน) ให้นักเรียน ${unrecordedRows.length} คนที่ยังไม่ส่ง?${lateStillAccepted() ? '\nงานนี้ยังรับงานส่งช้าอยู่ หากนักเรียนส่งภายหลัง งานที่ส่งจะแทนที่ 0' : ''}`
      : `Mark ${unrecordedRows.length} students as "no submission" (0)?${lateStillAccepted() ? '\nLate work is still accepted; work handed in later replaces the 0.' : ''}`;
    if (!confirm(message)) return;
    const recorded = await recordMissing(unrecordedRows);
    if (recorded.length) showToast(th ? `บันทึกว่าไม่ส่งงานแล้ว ${recorded.length} คน` : `Marked ${recorded.length} students as no submission`);
  };

  const [clearingId, setClearingId] = useState<string | null>(null);
  const handleClearNoSubmission = async (sub: Submission) => {
    const name = sub.student?.first_name || (th ? 'นักเรียน' : 'the student');
    if (!confirm(th ? `ยกเลิก "ไม่ส่งงาน" ของ ${name}?\nนักเรียนจะกลับไปเป็น "ยังไม่ส่ง" และคะแนน 0 จะถูกลบ` : `Undo "no submission" for ${name}?\nThey go back to "not submitted" and the 0 is removed.`)) return;
    setClearingId(sub.id);
    try {
      await dataService.clearMissingSubmission(sub.id);
      await refreshSubmissions();
      showToast(th ? 'ยกเลิกแล้ว' : 'Undone');
    } catch (err) {
      alert(err instanceof Error && err.message ? err.message : th ? 'บันทึกไม่สำเร็จ' : 'Could not save');
    } finally {
      setClearingId(null);
    }
  };

  // Per student: "Allow edit" (handed-in homework, e.g. a wrong file attached)
  // or "Allow hand-in" (nothing handed in, homework or quiz, e.g. they could not
  // get in before it closed). Close to or after the deadline the teacher picks
  // how long; with more than a day left it is granted straight away.
  type ReopenTarget = { key: string; sub: Submission | null; rosterId?: string; name: string };
  const [reopeningKey, setReopeningKey] = useState<string | null>(null);
  const [retakeOpen, setRetakeOpen] = useState(false);
  // retry: a handed-in quiz taken again from a blank sheet ("ให้สอบใหม่").
  type ReopenKind = 'edit' | 'handin' | 'retry';
  const [reopenDialog, setReopenDialog] = useState<(ReopenTarget & { kind: ReopenKind; minutes: number }) | null>(null);
  // Re-renders now and then so a time-limited permission drops off when it runs out, and
  // exactly when a scheduled publish time or a deadline passes (status flips without a refresh).
  const scheduleTarget = useMemo(() => (assignment ? [assignment] : []), [assignment]);
  const nowTick = useScheduleNow(scheduleTarget, 30000);

  /**
   * Shows a saved change at once and stores it as this session's fresh copy:
   * the server's answer is the row's new state, so no refetch round trip.
   */
  const applySubmissionChange = (update: (prev: Submission[]) => Submission[]) => {
    submissionsSeqRef.current++;
    setSubmissions((prev) => {
      const next = update(prev);
      const teacherId = clerkUser?.id;
      const cached = teacherId ? readCache<{ subs: Submission[] }>(cacheKey, teacherId) : null;
      if (teacherId && cached) writeCache(cacheKey, teacherId, { ...cached.value, subs: next });
      return next;
    });
  };

  const saveReopen = async (target: ReopenTarget, kind: ReopenKind, minutes: number | null) => {
    const until = minutes ? minutesFromNow(minutes) : null;
    setReopeningKey(target.key);
    try {
      if (kind === 'retry' && target.sub && until) {
        const subId = target.sub.id;
        const row = await dataService.resetQuizSubmission(subId, until);
        applySubmissionChange((prev) => prev.map((s) => (s.id === subId ? { ...s, ...row } : s)));
      } else if (target.sub) {
        const subId = target.sub.id;
        const result = await dataService.setSubmissionReopened(subId, true, until);
        applySubmissionChange((prev) => prev.map((s) => (s.id === subId ? { ...s, ...result } : s)));
      } else if (target.rosterId) {
        const row = await dataService.allowStudentHandIn(assignmentId, target.rosterId, until);
        applySubmissionChange((prev) =>
          prev.some((s) => s.id === row.id) ? prev.map((s) => (s.id === row.id ? { ...s, ...row } : s)) : [...prev, row]
        );
      }
      setReopenDialog(null);
      const when = until ? ` · ${th ? 'ถึง' : 'until'} ${formatDateTime(until, language)}` : '';
      showToast(
        kind === 'retry'
          ? (th ? `เปิดให้ ${target.name} สอบใหม่แล้ว (เริ่มจากกระดาษเปล่า)` : `${target.name} can retake it now (blank sheet)`) + when
          : kind === 'edit'
          ? (th ? `เปิดให้ ${target.name} แก้ไขงานแล้ว` : `${target.name} can edit now`) + when
          : (th ? `เปิดให้ ${target.name} ส่งงานแล้ว` : `${target.name} can hand in now`) + when
      );
    } catch (err) {
      alert(err instanceof Error && err.message ? err.message : th ? 'บันทึกไม่สำเร็จ' : 'Could not save');
    } finally {
      setReopeningKey(null);
    }
  };

  const requestReopen = (target: ReopenTarget, kind: ReopenKind) => {
    if (!assignment) return;
    if (kind === 'retry') {
      // Always timed: suggest the quiz's own length.
      const start = Date.parse(assignment.publish_at || assignment.created_at || '');
      const derived = Math.round((Date.parse(assignment.due_date) - start) / 60000);
      const quizMinutes = Number(assignment.quiz_duration_minutes) > 0
        ? Number(assignment.quiz_duration_minutes)
        : Number.isFinite(derived) && derived > 0 && derived <= 24 * 60 ? derived : 30;
      setReopenDialog({ ...target, kind, minutes: Math.max(10, quizMinutes) });
      return;
    }
    const suggestion = reopenTimeSuggestion(getAssignmentWindow(assignment));
    if (!suggestion.needsTime) {
      void saveReopen(target, kind, null);
      return;
    }
    setReopenDialog({ ...target, kind, minutes: suggestion.minutes });
  };

  const revokeReopen = async (sub: Submission, name: string, kind: 'edit' | 'handin') => {
    if (!confirm(kind === 'edit'
      ? th ? `ยกเลิกการเปิดให้ ${name} แก้ไขงาน?` : `Stop letting ${name} edit this work?`
      : th ? `ยกเลิกการเปิดให้ ${name} ส่งงาน?` : `Stop letting ${name} hand in?`)) return;
    setReopeningKey(sub.id);
    try {
      const result = await dataService.setSubmissionReopened(sub.id, false);
      applySubmissionChange((prev) => prev.map((s) => (s.id === sub.id ? { ...s, ...result } : s)));
      showToast(th ? 'ยกเลิกสิทธิ์แล้ว' : 'Permission removed');
    } catch (err) {
      alert(err instanceof Error && err.message ? err.message : th ? 'บันทึกไม่สำเร็จ' : 'Could not save');
    } finally {
      setReopeningKey(null);
    }
  };
  /** The score came from a retake (graded on the retake's own page). */
  const retakeMark = (sub: Submission | null | undefined) =>
    sub?.retake_submission_id ? (
      <span
        title={th ? 'คะแนนจากการสอบซ่อม (ตรวจที่หน้าข้อสอบซ่อม)' : 'Retake score (graded on the retake page)'}
        className="ml-1 self-center px-1.5 py-px rounded-md text-[10px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
      >
        {th ? 'ซ่อม' : 'Retake'}
      </span>
    ) : null;
  const canReopen = () => !!grader && grader.role !== 'researcher';
  const studentLabel = (sub: Submission | null, row?: RosterRow) =>
    sub?.student?.first_name || row?.student?.first_name || (th ? 'นักเรียน' : 'the student');
  /** Short "until" text: minutes/hours left, or the date when further away. */
  const untilLabel = (until?: string | null) => {
    if (!until) return th ? 'ไม่จำกัดเวลา' : 'no time limit';
    const left = new Date(until).getTime() - nowTick;
    if (left <= 0) return th ? 'หมดเวลา' : 'time up';
    const min = Math.ceil(left / 60000);
    if (min < 60) return th ? `เหลือ ${min} นาที` : `${min} min left`;
    if (min < 24 * 60) return th ? `เหลือ ${Math.floor(min / 60)} ชม. ${min % 60} นาที` : `${Math.floor(min / 60)}h ${min % 60}m left`;
    return `${th ? 'ถึง' : 'until'} ${formatDateTime(until, language)}`;
  };
  const reopenBadge = (sub: Submission, name: string, kind: 'edit' | 'handin') => (
    <span
      className="inline-flex items-center gap-1.5 pl-2.5 pr-1 h-8 rounded-xl bg-orange-50 dark:bg-orange-950/40 text-orange-800 dark:text-orange-200 ring-1 ring-orange-300 dark:ring-orange-800 text-[11px] font-bold whitespace-nowrap animate-in fade-in zoom-in-95"
      title={sub.reopen_until ? formatDateTime(sub.reopen_until, language) : undefined}
    >
      <span className="relative flex w-2 h-2 shrink-0" aria-hidden>
        <span className="absolute inset-0 rounded-full bg-orange-400 animate-ping opacity-60" />
        <span className="relative w-2 h-2 rounded-full bg-orange-500" />
      </span>
      {kind === 'edit' ? (th ? 'เปิดให้แก้ไข' : 'Editing allowed') : assignment?.is_exam ? (th ? 'เปิดให้สอบ' : 'Quiz open') : th ? 'เปิดให้ส่ง' : 'Hand-in allowed'}
      <span className="font-semibold opacity-75">· {untilLabel(sub.reopen_until)}</span>
      <button
        type="button"
        onClick={() => revokeReopen(sub, name, kind)}
        disabled={reopeningKey === sub.id}
        className="ml-0.5 h-6 px-2 rounded-lg bg-white/90 dark:bg-slate-900/70 hover:bg-white dark:hover:bg-slate-900 text-[10px] text-slate-600 dark:text-slate-300 cursor-pointer disabled:opacity-50"
      >
        {th ? 'ยกเลิก' : 'Undo'}
      </button>
    </span>
  );
  const reopenButton = (target: ReopenTarget, kind: ReopenKind, className = '') => (
    <button
      type="button"
      onClick={() => requestReopen(target, kind)}
      disabled={reopeningKey === target.key}
      title={kind === 'retry'
        ? th ? 'ให้นักเรียนคนนี้สอบใหม่ — คำตอบและคะแนนเดิมจะถูกลบ เริ่มจากกระดาษเปล่า' : 'Let this student take the quiz again — earlier answers and score are deleted'
        : kind === 'edit'
        ? th ? 'ให้นักเรียนคนนี้แก้งานที่ส่งแล้ว (เช่น แนบไฟล์ผิด)' : 'Let this student fix and hand in again'
        : th ? 'ให้นักเรียนคนนี้ส่งงานได้ แม้เลยกำหนดหรือปิดรับแล้ว' : 'Let this student hand in, even after it closed'}
      className={`inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-xl text-[11px] sm:text-xs font-black whitespace-nowrap bg-orange-500 hover:bg-orange-600 text-white shadow-md shadow-orange-500/25 cursor-pointer active:scale-[0.97] transition-all disabled:opacity-50 ${className}`}
    >
      {reopeningKey === target.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : kind === 'retry' ? <RotateCcw className="w-3.5 h-3.5" /> : kind === 'edit' ? <PencilLine className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />}
      {kind === 'retry' ? (th ? 'ให้สอบใหม่' : 'Allow retake') : kind === 'edit' ? (th ? 'ให้แก้ไขงาน' : 'Allow edit') : th ? 'ให้ส่งงาน' : 'Allow hand-in'}
    </button>
  );

  /**
   * Handed-in homework: "Allow edit", or the running permission with its time left.
   * Handed-in quiz: "Allow retake" (a blank sheet; the earlier answers are deleted).
   */
  const reopenControl = (sub: Submission, className = '') => {
    if (!assignment || !isHandedIn(sub) || !canReopen()) return null;
    const name = studentLabel(sub);
    if (assignment.is_exam) {
      // A score copied from a retake quiz is retaken there, not here.
      if (sub.retake_submission_id) return null;
      return reopenButton({ key: sub.id, sub, name }, 'retry', className);
    }
    if (isReopenActive(sub, nowTick)) return reopenBadge(sub, name, 'edit');
    return reopenButton({ key: sub.id, sub, name }, 'edit', className);
  };

  /**
   * Nothing handed in (no row, or recorded as missing): "Allow hand-in" once the
   * student may soon be unable to hand in by themselves (deadline within a day,
   * past, or closed). Homework and quizzes.
   */
  const handInControl = (row: RosterRow) => {
    const sub = row.submission;
    if (!canReopen() || !assignment || !assignmentWindow || (sub && isHandedIn(sub))) return null;
    const name = studentLabel(sub, row);
    if (sub && isReopenActive(sub, nowTick)) return reopenBadge(sub, name, 'handin');
    if (!sub && !row.rosterId) return null;
    if (assignmentWindow.isDraft || assignmentWindow.isScheduled) return null;
    if (!reopenTimeSuggestion(assignmentWindow, nowTick).needsTime) return null;
    return reopenButton({ key: sub?.id || row.key, sub, rosterId: row.rosterId, name }, 'handin');
  };

  // A student with nothing handed in: no grading, only "no submission" (0) once the deadline has passed.
  const missingActions = (row: RosterRow) => {
    // A survey has no score: a missing response just stays missing.
    if (!row.rosterId || !grader || grader.role === 'researcher' || isSurvey(assignment)) {
      return <span className="text-[11px] text-slate-400 italic">{th ? 'ยังไม่ตอบ' : 'No response yet'}</span>;
    }
    if (!canMarkNoSubmission) {
      return (
        <span
          className="text-[11px] text-slate-400 italic text-right"
          title={th ? 'ให้คะแนนได้เฉพาะงานที่นักเรียนส่งแล้ว' : 'Only handed-in work can be graded'}
        >
          {th ? 'รอส่ง • บันทึกว่าไม่ส่งได้หลังกำหนดส่ง' : 'Awaiting work • mark as no submission after the due date'}
        </span>
      );
    }
    const busy = recordingKeys.has(row.key);
    return (
      <button
        type="button"
        onClick={() => handleMarkNoSubmission(row)}
        disabled={busy}
        title={th ? 'นักเรียนไม่ได้ส่งงาน: บันทึกว่าตรวจแล้ว ได้ 0 คะแนน' : 'Nothing was handed in: record it as checked with 0'}
        className="h-8 px-2.5 rounded-xl text-[11px] font-bold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-rose-300 hover:text-rose-700 dark:hover:text-rose-300 cursor-pointer disabled:opacity-50 inline-flex items-center gap-1 whitespace-nowrap"
      >
        <Ban className="w-3 h-3" />
        {th ? 'ไม่ส่งงาน · ให้ 0' : 'No submission · 0'}
      </button>
    );
  };

  // A student marked "no submission": 0, with an undo.
  const noSubmissionBadge = (
    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] sm:text-[11px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 whitespace-nowrap">
      <Ban className="w-3 h-3" />
      {language === 'th' ? 'ไม่ส่งงาน' : 'No submission'}
    </span>
  );
  const clearNoSubmissionControl = (sub: Submission) =>
    !grader || grader.role === 'researcher' ? null : (
      <button
        type="button"
        onClick={() => handleClearNoSubmission(sub)}
        disabled={clearingId === sub.id}
        className="h-8 px-2.5 rounded-xl text-[11px] font-bold text-slate-500 dark:text-slate-400 ring-1 ring-slate-200 dark:ring-slate-700 hover:text-slate-800 dark:hover:text-slate-200 hover:ring-slate-400 cursor-pointer disabled:opacity-50 inline-flex items-center gap-1 whitespace-nowrap"
      >
        <Undo2 className="w-3 h-3" />
        {th ? 'ยกเลิก' : 'Undo'}
      </button>
    );

  // Every enrolled student, with their submission if any, then submissions from
  // students no longer on the roster. Roster entries may carry users.id, the
  // LINE id or the school number, so match on any of them.
  const rosterRows: RosterRow[] = (() => {
    const used = new Set<string>();
    // A retake lists only the students it is for.
    const rows: RosterRow[] = rosterFor(assignment, classroom?.students || []).map((std) => {
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

  // Grading order: roster order, handed-in work only (nothing to grade otherwise).
  const gradingOrder = rosterRows.flatMap((row) => (row.submission && isHandedIn(row.submission) ? [row.submission] : []));
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
  // Students still missing, who "mark everyone missing as no submission" applies to.
  const unrecordedRows = rosterRows.filter((row) => row.rosterId && isMissing(row.submission));

  const assignmentWindow = assignment ? getAssignmentWindow(assignment) : null;
  const canMarkNoSubmission = !!assignmentWindow && canRecordNoSubmission(assignmentWindow);
  // Handed-in homework is locked for students until the teacher allows edits.
  const assignmentStatus = assignment && assignmentWindow ? getAssignmentStatus(assignmentWindow, assignment.is_exam, language) : null;
  const deadlineLabel = formatDateTime(
    assignmentWindow?.deadline != null ? new Date(assignmentWindow.deadline).toISOString() : assignment?.due_date,
    language
  );
  const th = language === 'th';

  // "ประกาศคะแนน", as on the classwork and works lists: offered once nobody is
  // left to remind (everyone handed in or has a score, or the work is closed).
  const canAnnounce =
    !!assignment && !isSurvey(assignment) && !!assignmentWindow && !!grader && grader.role !== 'researcher' &&
    !assignmentWindow.isDraft && !assignmentWindow.isScheduled &&
    announcesResults({ notSubmitted: missingTotal }, assignmentWindow.acceptsSubmissions);
  const [announcing, setAnnouncing] = useState(false);
  /**
   * Closes the work first if it still takes hand-ins (results only show once it
   * is closed), after the teacher confirms; then the bot posts to the class
   * group, or the share popup opens whenever it cannot (quota, no group, limit).
   */
  const handleAnnounceResults = async () => {
    if (!assignment || !assignmentWindow || announcing) return;
    setAnnouncing(true);
    try {
      const result = await dataService.announceResults(assignment.id, assignment.title);
      if (result.assignment) setAssignment((prev) => (prev ? { ...prev, ...result.assignment } : prev));
      const line =
        result.line === 'card'
          ? th ? 'กด “ส่งเข้ากลุ่ม” ในหน้าต่างที่เปิดขึ้น แล้วเลือกกลุ่ม LINE ของห้อง' : 'Tap “Send to group” in the window that opened and pick the class LINE group'
          : result.line === 'quota'
          ? th ? 'โควตา LINE เดือนนี้ไม่พอ — แชร์เองได้จากหน้าต่างที่เปิดขึ้น' : 'Not enough LINE quota — share it from the window that opened'
          : th ? 'บอทส่งไม่ได้ตอนนี้ — แชร์เองได้จากหน้าต่างที่เปิดขึ้น' : 'The bot could not send it — share it from the window that opened';
      showToast([result.closed && (th ? 'ปิดรับงานแล้ว' : 'Closed'), line, announceNote(result, th)].filter(Boolean).join(' • '));
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : th ? 'ประกาศคะแนนไม่สำเร็จ' : 'Could not announce the scores');
    } finally {
      setAnnouncing(false);
    }
  };

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

  // First open with nothing cached yet: placeholders shaped like the page, not an empty
  // header and "no data" (which would read as a missing assignment).
  if (loading && !assignment) {
    return <PageSkeleton variant="grading" />;
  }

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
            ? 'บัญชีนี้ไม่ใช่ผู้สอนของห้องนี้ ดูได้แต่ให้คะแนนไม่ได้'
            : 'Your account is not a teacher of this classroom, so you can view but not grade.'}
        </div>
      )}

      {/* Top Breadcrumb & Assignment Header */}
      <div className="space-y-3 sm:space-y-4">
        <Suspense fallback={<span className="block h-4" />}>
          <GradingBackLink classroomId={assignment?.classroom_id} />
          <SiblingClassTabs assignmentId={assignmentId} />
        </Suspense>

        <div className="bg-white dark:bg-slate-900 p-3 sm:p-6 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3 sm:space-y-5">
          {/* What it is */}
          <div className="space-y-1.5 sm:space-y-2 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${
                  assignment?.is_exam
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                    : isSurvey(assignment)
                    ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                }`}
              >
                {assignment?.is_exam ? t('assignment_creator.mode_exam') : isSurvey(assignment) ? (th ? 'แบบสอบถาม' : 'Survey') : t('assignment_creator.mode_assignment')}
              </span>
              {isRetakeOf(assignment) && (
                <span
                  title={th ? `สอบซ่อม ${assignment?.retake_student_ids?.length || 0} คน` : `Retake for ${assignment?.retake_student_ids?.length || 0}`}
                  className="px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                >
                  🔁 {th ? 'สอบซ่อม' : 'Retake'}
                </span>
              )}
              {isRetake(assignment) && assignment?.retake_of && (
                <Link
                  href={`/assignments/${assignment.retake_of}/grading${worksReturn ? `?from=works&returnTo=${encodeURIComponent(worksReturn)}` : ''}`}
                  className="px-2.5 py-0.5 rounded-lg text-[11px] font-bold text-orange-700 dark:text-orange-300 ring-1 ring-orange-200 dark:ring-orange-900 hover:bg-orange-50 dark:hover:bg-orange-950/40"
                >
                  {th ? 'ข้อสอบเดิม →' : 'Original quiz →'}
                </Link>
              )}
              {(classroom?.name || assignment?.classroom_name) && (
                <span className="px-2.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold">
                  {classroom?.name || assignment?.classroom_name}
                </span>
              )}
            </div>
            <div className="flex items-start sm:items-start max-sm:items-center justify-between gap-2 sm:gap-3">
              <h1 className="text-base sm:text-2xl font-black text-slate-900 dark:text-white leading-snug min-w-0 wrap-break-word">
                {assignment?.title || t('grading.title')}
              </h1>
              {assignment && grader && (
                <div className="shrink-0 flex items-center gap-1.5">
                  {assignment.is_exam && !isRetake(assignment) && grader.role !== 'researcher' && (
                    <button
                      type="button"
                      onClick={() => setRetakeOpen(true)}
                      title={th ? 'สร้างข้อสอบซ่อมให้นักเรียนที่เลือก' : 'Retake for chosen students'}
                      aria-label={th ? 'สอบซ่อม' : 'Retake'}
                      className="inline-flex items-center gap-1 justify-center min-w-8 sm:min-w-10 h-8 sm:h-auto px-2 sm:px-2.5 sm:py-1.5 rounded-lg sm:rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-bold shadow-sm shadow-orange-500/25 cursor-pointer transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{th ? 'สอบซ่อม' : 'Retake'}</span>
                    </button>
                  )}
                  <Link
                    href={`/assignments/new?copy=${assignment.id}&classroomId=${assignment.classroom_id}&${editorFrom}`}
                    title={th ? 'คัดลอกไปห้องอื่น' : 'Copy to other classrooms'}
                    aria-label={th ? 'คัดลอกไปห้องอื่น' : 'Copy to other classrooms'}
                    className="inline-flex items-center gap-1 justify-center min-w-8 sm:min-w-10 h-8 sm:h-auto px-2 sm:px-2.5 sm:py-1.5 rounded-lg sm:rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-sky-600 hover:border-sky-400 transition-colors"
                  >
                    📋 <span className="hidden sm:inline">{th ? 'คัดลอก' : 'Copy'}</span>
                  </Link>
                  <Link
                    href={`/assignments/new?edit=${assignment.id}&classroomId=${assignment.classroom_id}&${editorFrom}`}
                    aria-label={th ? 'แก้ไขงาน' : 'Edit'}
                    className="inline-flex items-center gap-1 justify-center min-w-8 sm:min-w-10 h-8 sm:h-auto px-2 sm:px-2.5 sm:py-1.5 rounded-lg sm:rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:text-amber-600 hover:border-amber-400 transition-colors"
                  >
                    ✏️ <span className="hidden sm:inline">{th ? 'แก้ไขงาน' : 'Edit'}</span>
                  </Link>
                </div>
              )}
            </div>
            {assignment?.description && (
              <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{assignment.description}</p>
            )}
            {assignment && (
              <AttachmentList attachments={assignmentAttachments(assignment)} size="sm" className="pt-1 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl" />
            )}
          </div>

          {/* The two answers a teacher looks for: does it still take work, and is grading done? */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {assignmentStatus && (
              <button
                type="button"
                onClick={() => setShowStatusDialog(true)}
                disabled={!grader || grader.role === 'researcher'}
                title={th ? 'กดเพื่อขยายเวลาหรือปิดรับงาน' : 'Tap to extend or close submissions'}
                className={`min-w-0 p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border text-left transition-shadow enabled:cursor-pointer enabled:hover:shadow-md disabled:cursor-default ${STATUS_CARD_CLASSES[assignmentStatus.tone]}`}
              >
                <span className="text-[11px] font-bold opacity-80 flex items-center justify-between gap-2">
                  {th ? 'การรับงาน' : 'Submissions'}
                  {grader && grader.role !== 'researcher' && (
                    <span className="inline-flex items-center gap-0.5 font-bold underline underline-offset-2">
                      <span className="max-sm:hidden">{th ? 'ขยายเวลา / ปิดรับ' : 'Extend / close'}</span>
                      <ChevronRight className="w-3 h-3" />
                    </span>
                  )}
                </span>
                <p className="mt-0.5 text-sm sm:text-base font-black flex items-center gap-1 sm:gap-1.5">
                  {assignmentStatus.tone === 'closed' ? <Lock className="w-4 h-4" /> : assignmentStatus.tone === 'late' ? <Unlock className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                  {assignmentStatus.label}
                </p>
                <p className="mt-1 text-[10px] sm:text-[11px] font-semibold opacity-90 flex items-center gap-1 max-sm:leading-snug">
                  <Calendar className="w-3 h-3 shrink-0" />
                  {assignment?.is_exam ? (th ? 'ปิดรับคำตอบ' : 'Closes') : t('grading.due_date')} {deadlineLabel}
                </p>
                {assignmentStatus.note && <p className="max-sm:hidden mt-1 text-[11px] leading-relaxed opacity-80">{assignmentStatus.note}</p>}
              </button>
            )}

            <div
              className={`min-w-0 p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl border ${
                toGradeTotal > 0
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-900 text-amber-900 dark:text-amber-200'
                  : gradedTotal > 0
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
                  : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <span className="text-[11px] font-bold opacity-80 block">{th ? 'การตรวจ' : 'Grading'}</span>
              <p className="mt-0.5 text-sm sm:text-base font-black flex items-center gap-1 sm:gap-1.5">
                {toGradeTotal > 0 ? <Clock className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                {toGradeTotal > 0
                  ? th ? `รอตรวจ ${toGradeTotal} คน` : `${toGradeTotal} left to grade`
                  : gradedTotal > 0
                  ? th ? 'ตรวจครบแล้ว' : 'All graded'
                  : th ? 'ยังไม่มีผู้ส่งงาน' : 'Nothing handed in yet'}
              </p>
              <div className="mt-1.5 sm:mt-2 flex w-full h-1.5 sm:h-2 rounded-full overflow-hidden bg-white/70 dark:bg-slate-900/60">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(gradedTotal / (rosterRows.length || 1)) * 100}%` }} />
                <div className="h-full bg-amber-400 transition-all" style={{ width: `${(toGradeTotal / (rosterRows.length || 1)) * 100}%` }} />
              </div>
              <p className="mt-1 sm:mt-1.5 text-[10px] sm:text-[11px] font-semibold opacity-90 max-sm:leading-snug">
                {th
                  ? `ตรวจแล้ว ${gradedTotal}/${checkableTotal} คน · ส่งแล้ว ${handedInTotal}/${rosterRows.length} คน`
                  : `${gradedTotal}/${checkableTotal} checked · ${handedInTotal}/${rosterRows.length} handed in`}
              </p>
              {canAnnounce && (
                <button
                  type="button"
                  onClick={handleAnnounceResults}
                  disabled={gradedTotal === 0 || announcing}
                  title={
                    gradedTotal === 0
                      ? th ? 'ยังไม่มีงานที่ตรวจเสร็จ' : 'Nothing graded yet'
                      : th ? 'ประกาศคะแนนในกลุ่ม LINE ของห้อง' : 'Announce the scores in the class LINE group'
                  }
                  className={`mt-2 sm:mt-3 w-full h-8 sm:h-10 rounded-lg sm:rounded-xl text-xs sm:text-sm font-black inline-flex items-center justify-center gap-1.5 transition-colors disabled:cursor-not-allowed ${
                    gradedTotal === 0
                      ? 'bg-white/70 dark:bg-slate-900/60 text-slate-400 ring-1 ring-slate-200 dark:ring-slate-700'
                      : toGradeTotal === 0
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-600/25 cursor-pointer'
                      : 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-300 dark:ring-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer'
                  }`}
                >
                  {announcing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
                  {th ? 'ประกาศคะแนน' : 'Announce scores'}
                  {toGradeTotal > 0 && gradedTotal > 0 && (
                    <span className="max-sm:hidden text-[11px] font-bold opacity-80">· {th ? `รอตรวจ ${toGradeTotal}` : `${toGradeTotal} to grade`}</span>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Counts: tap one to show those students below */}
          <div className={`grid gap-1.5 sm:gap-3 ${tracksAway ? 'grid-cols-5' : 'grid-cols-4'}`}>
            {summaryTiles.map((tile) => (
              <button
                key={tile.id}
                type="button"
                onClick={() => {
                  setStatusFilter(statusFilter === tile.id ? 'all' : tile.id);
                  document.getElementById('grading-roster')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`min-w-0 px-1.5 py-2 sm:p-3 rounded-xl sm:rounded-2xl text-center sm:text-left border transition-colors cursor-pointer ${
                  statusFilter === tile.id ? tile.active : 'bg-slate-50 dark:bg-slate-800/60 border-transparent hover:border-slate-200 dark:hover:border-slate-700'
                }`}
              >
                <span className={`text-[10px] sm:text-[11px] font-bold flex items-center justify-center sm:justify-start gap-1 min-w-0 ${tile.label_class}`}>
                  <span className="max-sm:hidden contents">{tile.icon}</span>
                  <span className="truncate">{tile.label}</span>
                </span>
                <span className={`block text-lg sm:text-2xl font-black leading-tight mt-0.5 tabular-nums ${tile.value_class}`}>
                  {tile.value}
                  {tile.of != null && <span className="text-[10px] sm:text-xs font-semibold text-slate-400 ml-0.5 sm:ml-1">/{tile.of}</span>}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 empty:hidden">
            {unrecordedRows.length > 0 && grader && grader.role !== 'researcher' && canMarkNoSubmission && (
              <button
                type="button"
                onClick={handleMarkAllNoSubmission}
                disabled={recordingKeys.size > 0}
                className="w-full sm:w-auto px-3 py-1.5 sm:py-2 rounded-xl text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
              >
                <Ban className="w-3.5 h-3.5" />
                {th ? `บันทึกว่าไม่ส่งงาน (0 คะแนน) ทุกคนที่ยังไม่ส่ง (${unrecordedRows.length})` : `Mark all missing as no submission · 0 (${unrecordedRows.length})`}
              </button>
            )}
          </div>

        </div>
      </div>

      {showStatusDialog && assignment && (
        <AssignmentStatusDialog
          assignment={assignment}
          onClose={() => setShowStatusDialog(false)}
          onSaved={(updated, action) => {
            setAssignment((prev) => (prev ? { ...prev, ...updated } : updated));
            setShowStatusDialog(false);
            const kind = updated.is_exam ? (th ? 'ข้อสอบ' : 'quiz') : th ? 'งาน' : 'assignment';
            showToast(
              action === 'published'
                ? th ? `🚀 เผยแพร่${kind} “${updated.title}” แล้ว` : `🚀 Published ${kind} “${updated.title}”`
                : updated.status_override === 'force_closed'
                ? th ? `🔒 ปิดรับ${kind} “${updated.title}” แล้ว` : `🔒 Closed ${kind} “${updated.title}”`
                : updated.status_override === 'extended'
                ? th
                  ? `⏳ ขยายเวลาส่ง${kind} “${updated.title}” ถึง ${formatDateTime(updated.extended_until, language)} แล้ว`
                  : `⏳ Extended ${kind} “${updated.title}” until ${formatDateTime(updated.extended_until, 'en')}`
                : th ? `${kind} “${updated.title}” กลับไปรับงานตามกำหนดส่งแล้ว` : `${kind} “${updated.title}” is back on its deadline`
            );
          }}
        />
      )}

      {/* Survey: the summary of every response comes first (the roster below shows who answered). */}
      {assignment && isSurvey(assignment) && (
        <section className="space-y-3">
          <h2 className="text-sm font-black text-slate-900 dark:text-white">{th ? 'สรุปคำตอบ' : 'Summary'}</h2>
          <SurveyResults assignmentId={assignment.id} lang={th ? 'th' : 'en'} totalStudents={rosterRows.length} />
        </section>
      )}

      {/* Submissions Table & Filter Controls */}
      <div id="grading-roster" className="scroll-mt-20 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        {/* Table Filters Bar */}
        <div className="p-2.5 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between gap-2 sm:gap-4">
          {/* Phones: the status filter as one dropdown, left of the search. */}
          <label className="sm:hidden relative shrink-0 w-[42%] h-9 pl-2.5 pr-7 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-1 text-[11px] font-bold text-slate-800 dark:text-slate-100 focus-within:border-amber-500">
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusFilter === 'pending' ? 'bg-amber-500' : statusFilter === 'graded' ? 'bg-emerald-500' : statusFilter === 'suspicious' ? 'bg-rose-500' : statusFilter === 'missing' ? 'bg-slate-500' : 'bg-slate-300'}`} />
            <span className="truncate">
              {statusFilter === 'missing'
                ? `${th ? 'ยังไม่ส่ง' : 'Not submitted'} (${missingTotal})`
                : statusFilter === 'suspicious'
                ? `${t('grading.filter_suspicious')} (${suspiciousTotal})`
                : statusFilter === 'pending'
                ? `${t('grading.filter_pending')} (${toGradeTotal})`
                : statusFilter === 'graded'
                ? `${t('grading.filter_graded')} (${gradedTotal})`
                : `${t('grading.filter_all')} (${rosterRows.length})`}
            </span>
            <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              aria-label={th ? 'กรองตามสถานะ' : 'Filter by status'}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            >
              <option value="all">{t('grading.filter_all')} ({rosterRows.length})</option>
              <option value="pending">{t('grading.filter_pending')} ({toGradeTotal})</option>
              <option value="graded">{t('grading.filter_graded')} ({gradedTotal})</option>
              <option value="missing">{th ? 'ยังไม่ส่ง' : 'Not submitted'} ({missingTotal})</option>
              {tracksAway && <option value="suspicious">{t('grading.filter_suspicious')} ({suspiciousTotal})</option>}
            </select>
          </label>

          {/* Search Box */}
          <div className="relative min-w-0 flex-1 sm:flex-none sm:w-72">
            <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 absolute left-3 sm:left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={th ? 'ค้นหาชื่อ / รหัส' : 'Name or ID'}
              className="w-full pl-8 sm:pl-9 pr-3 sm:pr-4 h-9 sm:h-auto sm:py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 font-medium"
            />
          </div>

          {/* Filter Pills (tablet / desktop) */}
          <div className="max-sm:hidden flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setStatusFilter('all')}
              className={`shrink-0 px-3 h-10 sm:h-auto sm:py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              {t('grading.filter_all')} ({rosterRows.length})
            </button>
            <button
              onClick={() => setStatusFilter('missing')}
              className={`shrink-0 px-3 h-10 sm:h-auto sm:py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
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
              className={`shrink-0 px-3 h-10 sm:h-auto sm:py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer ${
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
              className={`shrink-0 px-3 h-10 sm:h-auto sm:py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                statusFilter === 'pending'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {t('grading.filter_pending')} ({toGradeTotal})
            </button>
            <button
              onClick={() => setStatusFilter('graded')}
              className={`shrink-0 px-3 h-10 sm:h-auto sm:py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
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
                <li key={key} className={`px-3 py-2.5 space-y-2 ${sub ? '' : 'bg-slate-50/40 dark:bg-slate-900/40'}`}>
                  <div className="flex items-center gap-2.5">
                    {student?.avatar_url ? (
                      <img src={student.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0 ring-2 ring-white dark:ring-slate-900" />
                    ) : (
                      <span className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[11px] font-black flex items-center justify-center shrink-0">
                        {initials}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-[13px] leading-snug text-slate-900 dark:text-white truncate">{fullName}</p>
                      <p className="text-[10px] leading-tight mt-0.5 text-slate-400 truncate">
                        <span className="font-mono">
                          {student?.student_id ? `${language === 'th' ? 'รหัส' : 'ID'} ${student.student_id}` : (language === 'th' ? 'ไม่มีรหัสนักเรียน' : 'No student ID')}
                        </span>
                        {/* Borrowed phone: shown under the name (like the desktop table) instead of an extra row. */}
                        {sub?.submitted_by && isHandedIn(sub) && (
                          <span className="text-slate-500 dark:text-slate-400">
                            {' · 📱 '}{th ? 'ส่งจากเครื่องของ' : 'Sent via'} {sub.submitted_by_name || (th ? 'เพื่อน' : 'a classmate')}
                          </span>
                        )}
                      </p>
                    </div>
                    {sub && (isGraded || isHandedIn(sub)) && (isGraded ? (
                      <span className="shrink-0 h-7 inline-flex items-center gap-0.5 px-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-black">
                        <span className="text-[13px] tabular-nums">{sub.total_score}</span>
                        <span className="text-[10px] font-semibold opacity-70">/{sub.max_total_score || assignment?.total_points || 20}</span>
                            {retakeMark(sub)}
                      </span>
                    ) : (
                      <span className="shrink-0 h-7 inline-flex items-center px-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                        {t('grading.pending_eval')}{retakeMark(sub)}
                      </span>
                    ))}
                  </div>

                  {sub && !isHandedIn(sub) && isGraded ? (
                    <div className="flex items-center justify-between gap-2 text-[11px] pl-[42px]">
                      {noSubmissionBadge}
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {handInControl(row)}
                        {clearNoSubmissionControl(sub)}
                      </div>
                    </div>
                  ) : !sub || !isHandedIn(sub) ? (
                    <div className="flex items-center justify-between gap-2 text-[11px] pl-[42px]">
                      <span className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                        {language === 'th' ? 'ยังไม่ส่ง' : 'Not submitted'}
                      </span>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {handInControl(row)}
                        {missingActions(row)}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 text-[10px] pl-[42px] min-w-0">
                        <span
                          className={`shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full font-bold ${
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
                        <span className="min-w-0 flex-1 truncate text-slate-400">
                          {sub.submitted_at && formatDateTime(sub.submitted_at, language)}
                          <span className="font-mono"> · {Math.floor(sub.time_spent_seconds / 60)} {t('common.minutes')}</span>
                        </span>
                        {/* Integrity chip rides on the status line so a card stays two rows under the name. */}
                        {tracksAway && (
                          <span className="shrink-0">
                            <AntiCheatingBadge
                              isFlagged={sub.is_flagged_suspicious}
                              tabSwitchCount={sub.tab_switch_count}
                              totalTimeAwaySeconds={sub.total_time_away_seconds}
                              quizExitCount={sub.quiz_exit_count}
                              autoForfeited={sub.auto_forfeited}
                              onClick={() => handleOpenAudit(sub)}
                              // The chip only: the counts and every event are in the log it opens.
                              showDetails={false}
                            />
                          </span>
                        )}
                      </div>

                      <div className="flex items-stretch gap-1.5 pl-[42px]">
                        {reopenControl(sub, 'flex-1')}
                        <button
                          type="button"
                          disabled={!grader}
                          onClick={() => handleOpenGrading(sub)}
                          className={`flex-1 min-w-0 h-8 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed ${
                            isGraded ? EDIT_GRADE_CLASSES : 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-xs'
                          }`}
                        >
                          {isGraded && <PencilLine className="w-3.5 h-3.5" />}
                          <span>{isGraded ? (language === 'th' ? 'แก้ไขคะแนน' : 'Edit grade') : t('grading.actions.grade_btn')}</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })
          )}
        </ul>

        {/* Table Content */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full min-w-152 lg:min-w-184 text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 tracking-wide font-semibold border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="py-3.5 px-3 lg:px-6">{t('grading.table.student_name')}</th>
                <th className="py-3.5 px-3 lg:px-6">{t('grading.table.status')}</th>
                <th className="hidden lg:table-cell py-3.5 px-3 lg:px-6">{t('grading.table.time_spent')}</th>
                <th className="py-3.5 px-3 lg:px-6">{t('grading.table.integrity')}</th>
                <th className="py-3.5 px-3 lg:px-6 text-center">{t('grading.table.score')}</th>
                <th className="py-3.5 px-3 lg:px-6 text-right">{t('grading.table.action')}</th>
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
                      <td className="py-3.5 px-3 lg:px-6">
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
                              {student?.student_id ? `${language === 'th' ? 'รหัส' : 'ID'} ${student.student_id}` : (language === 'th' ? 'ไม่มีรหัสนักเรียน' : 'No student ID')}
                            </p>
                            {/* Borrowed phone: who sent it, under the name (not an integrity signal). */}
                            {sub?.submitted_by && isHandedIn(sub) && (
                              <p
                                className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-48"
                                title={th ? 'นักเรียนส่งด้วยโทรศัพท์ของเพื่อนร่วมห้อง' : "Sent from a classmate's phone"}
                              >
                                📱 {th ? 'ส่งจากเครื่องของ' : 'Sent via'} {sub.submitted_by_name || (th ? 'เพื่อน' : 'a classmate')}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                  );

                  if (sub && !isHandedIn(sub) && isGraded) {
                    return (
                      <tr key={key} className="bg-slate-50/40 dark:bg-slate-900/40">
                        {studentCell}
                        <td className="py-3.5 px-3 lg:px-6 whitespace-nowrap">{noSubmissionBadge}</td>
                        <td className="hidden lg:table-cell py-3.5 px-3 lg:px-6 text-slate-400">-</td>
                        <td className="py-3.5 px-3 lg:px-6 text-slate-400">-</td>
                        <td className="py-3.5 px-3 lg:px-6 text-center whitespace-nowrap">
                          <span className="inline-flex items-baseline gap-0.5 px-2.5 py-1 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-black">
                            <span className="text-sm tabular-nums">{sub.total_score}</span>
                            <span className="text-[11px] font-semibold opacity-70">/ {sub.max_total_score || assignment?.total_points || 20}</span>
                            {retakeMark(sub)}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 lg:px-6 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            {handInControl(row)}
                            {clearNoSubmissionControl(sub)}
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  if (!sub || !isHandedIn(sub)) {
                    return (
                      <tr key={key} className="bg-slate-50/40 dark:bg-slate-900/40">
                        {studentCell}
                        <td className="py-3.5 px-3 lg:px-6 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                            {language === 'th' ? 'ยังไม่ส่ง' : 'Not submitted'}
                          </span>
                        </td>
                        <td className="hidden lg:table-cell py-3.5 px-3 lg:px-6 text-slate-400">-</td>
                        <td className="py-3.5 px-3 lg:px-6 text-slate-400">-</td>
                        <td className="py-3.5 px-3 lg:px-6 text-center text-slate-400">-</td>
                        <td className="py-3.5 px-3 lg:px-6 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            {handInControl(row)}
                            {missingActions(row)}
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={key} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      {/* Student: real photo (LINE) or initials, name and student number */}
                      {studentCell}

                      {/* Submission status + when it was submitted */}
                      <td className="py-3.5 px-3 lg:px-6 whitespace-nowrap">
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
                            <span className="lg:hidden font-mono"> · {Math.floor(sub.time_spent_seconds / 60)} {t('common.minutes')}</span>
                          </p>
                        )}
                      </td>

                      <td className="hidden lg:table-cell py-3.5 px-3 lg:px-6 text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap">
                        {Math.floor(sub.time_spent_seconds / 60)} {t('common.minutes')}
                      </td>

                      <td className="py-3.5 px-3 lg:px-6">
                        <div className="flex items-center">
                          {tracksAway ? (
                            <AntiCheatingBadge
                              isFlagged={sub.is_flagged_suspicious}
                              tabSwitchCount={sub.tab_switch_count}
                              totalTimeAwaySeconds={sub.total_time_away_seconds}
                              quizExitCount={sub.quiz_exit_count}
                              autoForfeited={sub.auto_forfeited}
                              onClick={() => handleOpenAudit(sub)}
                              // The chip only: the counts and every event are in the log it opens.
                              showDetails={false}
                            />
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 lg:px-6 text-center whitespace-nowrap">
                        {isGraded ? (
                          <span className="inline-flex items-baseline gap-0.5 px-2.5 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-black">
                            <span className="text-sm tabular-nums">{sub.total_score}</span>
                            <span className="text-[11px] font-semibold opacity-70">/ {sub.max_total_score || assignment?.total_points || 20}</span>
                            {retakeMark(sub)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-[11px] font-bold">
                            {t('grading.pending_eval')}{retakeMark(sub)}
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-3 lg:px-6 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {reopenControl(sub)}
                          <button
                            type="button"
                            disabled={!grader}
                            onClick={() => handleOpenGrading(sub)}
                            className={`h-8 px-3.5 rounded-xl font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${
                              isGraded ? EDIT_GRADE_CLASSES : 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-xs'
                            }`}
                          >
                            {isGraded && <PencilLine className="w-3.5 h-3.5" />}
                            <span>{isGraded ? (language === 'th' ? 'แก้ไขคะแนน' : 'Edit grade') : t('grading.actions.grade_btn')}</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-student time for "Allow edit" / "Allow hand-in" close to or after the deadline */}
      {reopenDialog && (
        <ReopenTimeDialog
          studentName={reopenDialog.name}
          kind={reopenDialog.kind}
          deadline={assignmentWindow?.deadline ?? null}
          defaultMinutes={reopenDialog.minutes}
          busy={reopeningKey === reopenDialog.key}
          onConfirm={(minutes) => saveReopen(reopenDialog, reopenDialog.kind, minutes)}
          onClose={() => setReopenDialog(null)}
        />
      )}

      {retakeOpen && assignment && (
        <RetakePicker
          classroomId={assignment.classroom_id}
          sourceId={assignment.id}
          from={worksReturn ? 'works' : 'classroom'}
          returnTo={worksReturn || undefined}
          onClose={() => setRetakeOpen(false)}
        />
      )}

      {/* Integrity Audit Modal */}
      {isAuditModalOpen && auditSubmission && (
        <IntegrityAuditModal
          isOpen={isAuditModalOpen}
          submission={auditSubmission}
          events={auditEvents}
          loading={auditLoading}
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
          onSaveGrades={(subId, grades, gradingTeacher) => dataService.saveTeacherGrades(subId, grades, gradingTeacher.name)}
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
