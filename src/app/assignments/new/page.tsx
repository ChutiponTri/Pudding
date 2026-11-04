'use client';

import { usePageTitle } from '@/lib/hooks/usePageTitle';
import React, { useState, useEffect, useRef } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { cachedCall, readCache, TEACHER_DASHBOARD_CACHE_KEY } from '@/lib/cache/sessionCache';
import { Assignment, AssignmentAttachment, Course, Classroom, LearningIndicator, CourseLearningIndicator, QuestionType, Question, User } from '@/types/database';
import { isRetake } from '@/lib/utils/retake';
import { TRUE_FALSE_OPTIONS, parseTrueFalse } from '@/lib/utils/trueFalse';
import { DateTimeField } from '@/components/DateTimeField';
import { Collapse } from '@/components/Collapse';
import { indicatorStyle, useSlidingIndicator } from '@/lib/hooks/useSlidingIndicator';
import { daysFromNowAt, formatDateTime } from '@/lib/utils/datetime';
import { DRAFT_PUBLISH_AT, DRAFT_RETENTION_DAYS, draftExpiresAt, isAssignmentDraft, LATE_WINDOW_HOURS, QUIZ_LATE_GRACE_MINUTES } from '@/lib/utils/assignmentWindow';
import { optimizeImage, UploadError, uploadToStorage } from '@/lib/storage/uploadClient';
import { normalizeLink, uploadRejection } from '@/lib/storage/uploadRules';
import { assignmentAttachments, googleAppName, isGoogleDriveUrl, linkDisplayName, MAX_ASSIGNMENT_ATTACHMENTS } from '@/lib/utils/referenceWork';
import { AttachmentCard, GoogleDriveMark } from '@/components/AssignmentAttachments';
import { MobileText } from '@/components/MobileText';
import {
  PlusCircle,
  Trash2,
  Calendar,
  Clock,
  FilePen,
  Sparkles,
  BookOpen,
  Send,
  Save,
  MessageSquare,
  ShieldAlert,
  HelpCircle,
  Layers,
  Check,
  ChevronDown,
  Paperclip,
  Link2,
  UploadCloud,
  Loader2,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Copy,
  PencilLine,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';

/** An attachment in the form; `file` = picked but not uploaded yet (url is a blob preview). */
type AttachmentDraft = AssignmentAttachment & { uid: string; file?: File };

interface QuestionDraft {
  /** Client-only React key, so cards keep their identity (and exit animation) when one is removed. */
  uid: string;
  /** Set when editing a saved question, so students' answers stay attached to it. */
  id?: string;
  indicator_id: string;
  type: QuestionType;
  question_text: string;
  options: string[];
  ideal_answer: string;
  rubric_criteria: string;
  max_score: number;
  is_required: boolean;
}

/** What the chosen mode means, shown next to (desktop) or under (mobile) the mode toggle. */
function ModeHint({ isExam, language }: { isExam: boolean; language: string }) {
  return isExam ? (
    <span className="inline-flex items-start gap-1.5 text-xs leading-relaxed text-purple-700 dark:text-purple-300 font-semibold bg-purple-50 dark:bg-purple-950/60 px-3.5 py-1.5 rounded-full border border-purple-200 dark:border-purple-800">
      <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>
        {language === 'th'
          ? 'โหมดข้อสอบ: บันทึกทุกครั้งที่ออกจากหน้าจอ • นักเรียนส่งรูป/ไฟล์ไม่ได้'
          : 'Exam Mode: every screen exit is logged • students cannot upload photos or files'}
      </span>
    </span>
  ) : (
    <span className="inline-flex items-start gap-1.5 text-xs leading-relaxed text-emerald-700 dark:text-emerald-300 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-3.5 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-800">
      <Paperclip className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>
        {language === 'th'
          ? 'โหมดการบ้าน: นักเรียนส่งรูปหรือไฟล์ได้'
          : 'Assignment Mode: students can upload photos or files'}
      </span>
    </span>
  );
}

/** Starting points for a new question: file work is worth more than a single short item. */
const defaultMaxScore = (type: QuestionType) => (type === 'file_upload' ? 10 : 1);

let questionUidSeq = 0;
const newQuestionUid = () => `q${++questionUidSeq}`;
/** Matches the card's collapse transition (duration-300). */
const QUESTION_EXIT_MS = 300;
/** Sliding highlight colour per release option (draft reads as "not live yet", the others use the app accent). */
const RELEASE_PILL = {
  draft: 'bg-slate-800 dark:bg-slate-100',
  schedule: 'bg-amber-500',
  now: 'bg-amber-500',
} as const;

/**
 * The same indicator (or lesson plan) in another course: kept when that course
 * has it, else the one at the same position, else the course's first. Used
 * when work moves to a classroom of another course (reuse, course change).
 */
function remapIndicatorId(id: string, from: Course | undefined, to: Course | undefined): string {
  if (!to) return id;
  const toIndicators = to.indicators || [];
  const toPlans = to.lesson_plans || [];
  if (id && (toIndicators.some((i) => i.id === id) || toPlans.some((p) => p.id === id))) return id;
  const indicatorIndex = from?.indicators?.findIndex((i) => i.id === id) ?? -1;
  if (indicatorIndex >= 0 && toIndicators[indicatorIndex]) return toIndicators[indicatorIndex].id;
  const planIndex = from?.lesson_plans?.findIndex((p) => p.id === id) ?? -1;
  if (planIndex >= 0 && toPlans[planIndex]) return toPlans[planIndex].id;
  const preferred = to.indicator_mode === 'competency' ? toPlans : toIndicators;
  return preferred[0]?.id || toIndicators[0]?.id || id;
}

/**
 * One context line above the form, same layout for every mode: a coloured
 * edge and icon, what is happening (kicker), which work, and where it comes
 * from. Quiet enough not to compete with the form.
 */
function WorkContextBanner({
  tone,
  icon,
  kicker,
  title,
  meta,
  action,
  children,
}: {
  tone: 'copy' | 'edit' | 'retake';
  icon: React.ReactNode;
  kicker: string;
  title: string;
  meta?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const accent = tone === 'copy'
    ? { edge: 'border-l-sky-500', tile: 'bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400', kicker: 'text-sky-700 dark:text-sky-300' }
    : tone === 'retake'
    ? { edge: 'border-l-orange-500', tile: 'bg-orange-500 text-white', kicker: 'text-orange-700 dark:text-orange-300' }
    : { edge: 'border-l-amber-500', tile: 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400', kicker: 'text-amber-700 dark:text-amber-300' };
  return (
    <div role="status" className={`mt-3 rounded-2xl border border-slate-200 dark:border-slate-800 border-l-4 ${accent.edge} bg-white dark:bg-slate-900 shadow-xs`}>
      <div className="p-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${accent.tile}`}>{icon}</span>
          <div className="min-w-0">
            <p className={`text-[11px] font-black ${accent.kicker}`}>{kicker}</p>
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{title}</p>
            {meta && <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{meta}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="px-3 pb-3 -mt-1">{children}</div>}
    </div>
  );
}

/** The clock, read in event handlers (kept outside the component: not render work). */
const clockNow = () => Date.now();

function NewAssignmentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlClassroomId = searchParams.get('classroomId');
  const urlFrom = searchParams.get('from');
  const isFromDashboard = urlFrom === 'dashboard' || (!urlClassroomId && urlFrom !== 'classroom');
  // Opened from the grading hub: go back to the same view (only /grading paths are accepted).
  // Opened from the work list: back to it (only /works paths are accepted).
  const returnParam = searchParams.get('returnTo');
  const returnTo =
    (urlFrom === 'grading' && returnParam?.startsWith('/grading')) || (urlFrom === 'works' && returnParam?.startsWith('/works'))
      ? returnParam
      : null;
  // ?edit=<assignmentId>: the same form, filled with a saved assignment or quiz.
  const editId = searchParams.get('edit');
  // ?copy=<assignmentId>: a new assignment filled from saved work (any state), for other classrooms.
  const copyId = editId ? null : searchParams.get('copy');
  // ?template=<token>: a new assignment filled from work another teacher shared.
  const templateToken = editId || copyId ? null : searchParams.get('template');
  // ?reuse=1 (with copy): "reuse earlier work" from the create menu — the new
  // work goes to ?classroomId (the classroom it was started from), not "another classroom".
  const isReuse = !!copyId && searchParams.get('reuse') === '1';
  // ?mode=quiz|homework: the type chosen in the create menu (new work only).
  const urlMode = searchParams.get('mode');
  // ?retakeOf=<quizId>&retakeStudents=<rosterIds>: a retake quiz for those students (RetakePicker).
  const retakeOfParam = editId ? null : searchParams.get('retakeOf');
  const retakeStudentsParam = searchParams.get('retakeStudents') || '';
  const { user: clerkUser } = useUser();
  const { t, tr, language } = useLanguage();

  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [lineConnectionStatuses, setLineConnectionStatuses] = useState<Record<string, 'disconnected' | 'waiting' | 'connected'>>({});
  const [selectedClassroomIds, setSelectedClassroomIds] = useState<string[]>([]);
  const [indicators, setIndicators] = useState<LearningIndicator[]>([]);
  // Course-level indicators derived from the selected course
  const [courseIndicators, setCourseIndicators] = useState<CourseLearningIndicator[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [copySource, setCopySource] = useState<Assignment | null>(null);
  // Typed into the form since it loaded (asked before leaving an edit for a copy).
  const [formTouched, setFormTouched] = useState(false);
  const [editSubmissionCount, setEditSubmissionCount] = useState(0);
  // Retake quiz: the original quiz, the classroom roster and the chosen students.
  const [retake, setRetake] = useState<{ source: Assignment | null; roster: User[]; ids: string[] } | null>(null);
  const [retakeAdding, setRetakeAdding] = useState(false);
  usePageTitle(editingAssignment ? `แก้ไข: ${editingAssignment.title}` : retake ? 'สร้างข้อสอบซ่อม' : copyId ? 'คัดลอกงาน' : templateToken ? 'สร้างจากแม่แบบ' : null);
  const originalQuestionIdsRef = useRef<string[]>([]);

  // Form fields
  const [isExam, setIsExam] = useState(() => !editId && ((!copyId && urlMode === 'quiz') || !!retakeOfParam));
  const [trackModeToggle, modeIndicator] = useSlidingIndicator(isExam);
  const [title, setTitle] = useState('');
  const [groupName, setGroupName] = useState('');
  const [existingGroups, setExistingGroups] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(() => daysFromNowAt(7, 23, 59));
  // Release: now, at a scheduled time (prepare work ahead for class time), or
  // kept as a draft that only the teacher publishes, by hand.
  const [releaseMode, setReleaseMode] = useState<'now' | 'schedule' | 'draft'>('draft');
  const schedulePublish = releaseMode === 'schedule';
  const saveAsDraft = releaseMode === 'draft';
  const [publishAt, setPublishAt] = useState(() => daysFromNowAt(1, 8, 0));
  const [trackReleaseToggle, releaseIndicator] = useSlidingIndicator(releaseMode);
  const reminderCron = 'relative_due_date';
  // One reminder per assignment (each one is a LINE message from the quota).
  // undefined = not chosen yet (the teacher must pick), null = no reminder.
  const [reminderOffset, setReminderOffset] = useState<number | null | undefined>(undefined);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  // Already visible to students: the release time can no longer be changed.
  const editIsPublished = !!editingAssignment && (!editingAssignment.publish_at || new Date(editingAssignment.publish_at).getTime() <= clock);

  // Homework attachments (links, Google Drive, images / PDFs). Picked files
  // stay in the browser (blob preview) until the assignment is saved.
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([]);
  const [linkDialog, setLinkDialog] = useState<null | 'link' | 'drive'>(null);
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isUploadingSample, setIsUploadingSample] = useState(false);
  const [sampleUploadError, setSampleUploadError] = useState<string | null>(null);
  const attachmentSlots = MAX_ASSIGNMENT_ATTACHMENTS - attachments.length;

  const removeAttachment = (uid: string) => {
    setAttachments((list) => {
      const gone = list.find((a) => a.uid === uid);
      if (gone?.file) URL.revokeObjectURL(gone.url);
      return list.filter((a) => a.uid !== uid);
    });
    setSampleUploadError(null);
  };

  const handleAttachmentFiles = async (picked: File[]) => {
    setSampleUploadError(null);
    const room = MAX_ASSIGNMENT_ATTACHMENTS - attachments.length;
    if (picked.length > room) {
      setSampleUploadError(tr(`แนบได้สูงสุด ${MAX_ASSIGNMENT_ATTACHMENTS} รายการ — เพิ่มได้อีก ${room} รายการ`, `Up to ${MAX_ASSIGNMENT_ATTACHMENTS} attachments — ${room} more allowed`));
    }
    // Large photos are shrunk without visible loss; anything still over the limit should be a link.
    setIsUploadingSample(true);
    const added: AttachmentDraft[] = [];
    try {
      for (const original of picked.slice(0, Math.max(room, 0))) {
        const file = await optimizeImage(original);
        const rejection = uploadRejection(file, language);
        if (rejection) {
          setSampleUploadError(`${original.name}: ${rejection}`);
          continue;
        }
        added.push({
          uid: newQuestionUid(),
          kind: file.type === 'application/pdf' ? 'file' : 'image',
          url: URL.createObjectURL(file),
          name: original.name,
          file,
        });
      }
    } finally {
      setIsUploadingSample(false);
    }
    if (added.length) setAttachments((list) => [...list, ...added].slice(0, MAX_ASSIGNMENT_ATTACHMENTS));
  };

  const openLinkDialog = (kind: 'link' | 'drive') => {
    setLinkInput("");
    setLinkError(null);
    setLinkDialog(kind);
  };

  const submitLinkDialog = () => {
    const url = normalizeLink(linkInput);
    if (!url) {
      setLinkError(tr('ลิงก์ไม่ถูกต้อง กรุณาวางลิงก์ที่ขึ้นต้นด้วย https://', 'That is not a valid link — paste one starting with https://'));
      return;
    }
    const drive = isGoogleDriveUrl(url);
    if (linkDialog === 'drive' && !drive) {
      setLinkError(tr('ลิงก์นี้ไม่ใช่ Google Drive — ใช้ปุ่ม "ลิงก์" สำหรับเว็บไซต์อื่น', 'This is not a Google Drive link — use "Link" for other websites'));
      return;
    }
    if (attachments.some((a) => a.url === url)) {
      setLinkError(tr('แนบลิงก์นี้ไว้แล้ว', 'This link is already attached'));
      return;
    }
    setAttachments((list) =>
      [...list, { uid: newQuestionUid(), kind: drive ? 'drive' as const : 'link' as const, url, name: drive ? googleAppName(url) : linkDisplayName(url) }].slice(0, MAX_ASSIGNMENT_ATTACHMENTS)
    );
    setLinkDialog(null);
  };

  // Dynamic Questions
  const [questions, setQuestions] = useState<QuestionDraft[]>(() => [
    {
      uid: newQuestionUid(),
      indicator_id: '',
      type: 'short_answer',
      question_text: '',
      options: ['', '', '', ''],
      ideal_answer: '',
      rubric_criteria: '',
      max_score: defaultMaxScore('short_answer'),
      is_required: true,
    },
  ]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const lastQuestionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const teacherId = clerkUser?.id;
    if (!teacherId) return;
    async function init(teacherId: string) {
      try {
        // Course/classroom pickers: the dashboard's copy when still fresh (same
        // data), else this session's own copy. The edited assignment below is
        // always fetched.
        const dashboard = readCache<Awaited<ReturnType<typeof dataService.getTeacherDashboard>>>(TEACHER_DASHBOARD_CACHE_KEY, teacherId);
        const [crs, cls, ind] = dashboard?.fresh
          ? [dashboard.value.courses, dashboard.value.classrooms, dashboard.value.indicators]
          : await cachedCall('assignmentEditorLists', teacherId, () =>
              Promise.all([
                dataService.getCourses(teacherId),
                dataService.getClassrooms(teacherId, { withRoster: false }),
                dataService.getLearningIndicators(),
              ])
            );
        setCourses(crs);
        setClassrooms(cls);
        setLineConnectionStatuses(Object.fromEntries(
          cls.map((classroom) => [
            classroom.id,
            classroom.line_connection_status || (classroom.line_group_id ? 'connected' : 'disconnected'),
          ])
        ));
        setIndicators(ind);

        if (crs.length > 0) {
          let initialClassroomId = cls[0]?.id || '';
          let initialCourseId = crs[0].id;

          if (urlClassroomId) {
            const matchedClass = cls.find((c) => c.id === urlClassroomId);
            if (matchedClass) {
              initialClassroomId = matchedClass.id;
              if (matchedClass.course_id && crs.some((c) => c.id === matchedClass.course_id)) {
                initialCourseId = matchedClass.course_id;
              }
            }
          }

          setSelectedCourseId(initialCourseId);
          setSelectedClassroomIds([initialClassroomId]);

          // Use matched course's CourseLearningIndicators as the initial indicator list
          const matchedCourse = crs.find((c) => c.id === initialCourseId) || crs[0];
          const firstCourseInds = matchedCourse.indicators || [];
          setCourseIndicators(firstCourseInds);
          if (firstCourseInds.length > 0) {
            setQuestions((prev) =>
              prev.map((q) => ({ ...q, indicator_id: firstCourseInds[0].id }))
            );
          } else if (ind.length > 0) {
            setQuestions((prev) =>
              prev.map((q) => ({ ...q, indicator_id: ind[0].id }))
            );
          }
        } else if (cls.length > 0) {
          setSelectedClassroomIds([urlClassroomId || cls[0].id]);
        }

        const sourceId = editId || copyId;
        let loadedAssignment: Assignment | null = null;
        if (sourceId || templateToken) {
          const [{ assignment, questions: savedQuestions }, subs] = await Promise.all([
            templateToken
              ? dataService.getAssignmentTemplate(templateToken).then((tpl) => ({
                  ...tpl,
                  assignment: tpl.assignment && { ...tpl.assignment, classroom_name: tr('งานที่แชร์มา', 'shared work') },
                }), () => ({ assignment: null, questions: [] as Question[] }))
              : dataService.getAssignmentById(sourceId!),
            editId ? dataService.getSubmissionsByAssignmentIds([editId], { includeStudents: false }) : Promise.resolve([]),
          ]);
          if (!assignment) {
            alert(language === 'th' ? 'ไม่พบงานนี้ อาจถูกลบไปแล้ว' : 'This assignment no longer exists');
            router.back();
            return;
          }
          loadedAssignment = assignment;
          const ownClassroom = cls.find((c) => c.id === assignment.classroom_id);
          const courseId = assignment.course_id || ownClassroom?.course_id || '';
          // Edit → "copy" stays on this page, so the other mode's state is cleared here.
          if (editId) {
            setEditingAssignment(assignment);
            setEditSubmissionCount(subs.filter((sub) => sub.status !== 'pending').length);
            setCopySource(null);
          } else {
            setEditingAssignment(null);
            setEditSubmissionCount(0);
            originalQuestionIdsRef.current = [];
            setCopySource(assignment);
          }
          setFormTouched(false);
          // Reuse: into the classroom it was started from, whose course may differ
          // (e.g. work from last term); indicators then move to that course's.
          const reuseTarget = isReuse && urlClassroomId ? cls.find((c) => c.id === urlClassroomId) : undefined;
          const targetCourseId = reuseTarget?.course_id || courseId;
          const sourceCourse = crs.find((c) => c.id === courseId);
          const targetCourse = crs.find((c) => c.id === targetCourseId);
          if (targetCourseId) {
            setSelectedCourseId(targetCourseId);
            setCourseIndicators(targetCourse?.indicators || []);
          }
          if (editId) {
            setSelectedClassroomIds([assignment.classroom_id]);
          } else if (reuseTarget) {
            setSelectedClassroomIds([reuseTarget.id]);
          } else {
            // A copy goes to another classroom of the same course by default (the teacher can pick several).
            const other = cls.find((c) => c.id !== assignment.classroom_id && (!courseId || c.course_id === courseId));
            setSelectedClassroomIds([other?.id || assignment.classroom_id]);
          }
          setIsExam(!!assignment.is_exam);
          setTitle(assignment.title || '');
          setGroupName(assignment.group_name || '');
          setDescription(assignment.description || '');
          // A copy can't start with a deadline that has already passed.
          const dueMs = assignment.due_date ? new Date(assignment.due_date).getTime() : NaN;
          setDueDate(assignment.due_date && (editId || dueMs > Date.now()) ? assignment.due_date : daysFromNowAt(7, 23, 59));
          const publishMs = assignment.publish_at ? new Date(assignment.publish_at).getTime() : NaN;
          if (isAssignmentDraft(assignment)) {
            setReleaseMode('draft');
          } else {
            // A copy of work students already see is released right away too; scheduled work keeps its time.
            setReleaseMode(!Number.isNaN(publishMs) && publishMs > Date.now() ? 'schedule' : 'now');
            if (assignment.publish_at && (editId || publishMs > Date.now())) setPublishAt(assignment.publish_at);
          }
          // Work saved with several reminders keeps the earliest one.
          setReminderOffset(assignment.reminder_offsets_minutes?.length
            ? Math.max(...assignment.reminder_offsets_minutes)
            : assignment.reminder_offset_minutes || null);
          setAttachments(assignmentAttachments(assignment).map((a) => ({ ...a, uid: newQuestionUid() })));
          // Older homework kept a separate note about its reference; it now lives in the instructions.
          const legacyNote = assignment.sample_work_description?.trim();
          if (legacyNote && !(assignment.description || '').includes(legacyNote)) {
            setDescription([assignment.description?.trim(), legacyNote].filter(Boolean).join('\n\n'));
          }
          // Shared work comes without indicators: use the target course's first one.
          const templateIndicatorId = (targetCourse?.indicators || crs[0]?.indicators || [])[0]?.id || '';
          if (editId) originalQuestionIdsRef.current = savedQuestions.map((q) => q.id);
          if (savedQuestions.length) {
            setQuestions(savedQuestions.map((q) => ({
              uid: newQuestionUid(),
              // A copy gets new questions of its own.
              id: editId ? q.id : undefined,
              indicator_id: templateToken
                ? templateIndicatorId
                : targetCourseId !== courseId ? remapIndicatorId(q.indicator_id || '', sourceCourse, targetCourse) : q.indicator_id || '',
              type: q.type,
              question_text: q.question_text || '',
              options: q.type === 'multiple_choice'
                ? [...(q.options || []), '', '', '', ''].slice(0, Math.max(4, (q.options || []).length))
                : ['', '', '', ''],
              ideal_answer: q.ideal_answer || '',
              rubric_criteria: q.rubric_criteria || '',
              max_score: Number(q.max_score) || defaultMaxScore(q.type),
              is_required: q.is_required !== false,
            })));
          }
        }
        // Retake: the original quiz and its classroom roster (a new retake, or editing one).
        const editedRetake = editId ? loadedAssignment : null;
        const retakeSourceId = retakeOfParam || (editedRetake && isRetake(editedRetake) ? editedRetake.retake_of || null : null);
        if (retakeOfParam || (editedRetake && isRetake(editedRetake))) {
          const lookupId = retakeSourceId || editId!;
          const { assignment: found, classroom: rosterClass } = await dataService.getAssignmentById(lookupId, { withClassroom: true });
          const source = retakeSourceId ? found : null;
          const roster = rosterClass?.students || [];
          const known = new Set(roster.map((st) => st.id));
          const ids = editedRetake
            ? editedRetake.retake_student_ids || []
            : retakeStudentsParam.split(',').filter((id) => known.has(id));
          setRetake({ source, roster, ids });
          if (source && !editId) {
            setIsExam(true);
            setSelectedClassroomIds([source.classroom_id]);
            const sourceCourse = crs.find((c) => c.id === (source.course_id || cls.find((c2) => c2.id === source.classroom_id)?.course_id));
            if (sourceCourse) {
              setSelectedCourseId(sourceCourse.id);
              setCourseIndicators(sourceCourse.indicators || []);
            }
            setTitle(`${language === 'th' ? 'สอบซ่อม' : 'Retake'}: ${source.title}`);
            setGroupName(source.group_name || '');
            setReleaseMode('now');
            setReminderOffset(null);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    init(teacherId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per teacher / target
  }, [urlClassroomId, editId, copyId, templateToken, isReuse, retakeOfParam, clerkUser?.id]);

  // Groups already used in the selected classrooms, offered as one-tap choices.
  const selectedClassroomKey = selectedClassroomIds.join(',');
  useEffect(() => {
    const ids = selectedClassroomKey ? selectedClassroomKey.split(',') : [];
    if (!ids.length) return;
    let cancelled = false;
    dataService
      .getAssignmentsByClassroomIds(ids)
      .then((list) => {
        if (cancelled) return;
        const names = new Set(list.map((a) => a.group_name?.trim()).filter((name): name is string => !!name));
        setExistingGroups([...names].sort((a, b) => a.localeCompare(b, 'th')));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedClassroomKey]);

  const handleCourseChange = (courseId: string) => {
    if (editingAssignment || retake) return; // an edit (or a retake) stays in its own classroom
    setSelectedCourseId(courseId);
    const matchingClasses = classrooms.filter((c) => c.course_id === courseId);
    if (matchingClasses.length > 0) {
      setSelectedClassroomIds([matchingClasses[0].id]);
    }
    // Update available indicators for the newly-selected course
    const previous = courses.find((c) => c.id === selectedCourseId);
    const course = courses.find((c) => c.id === courseId);
    setCourseIndicators(course?.indicators || []);
    // Each question keeps the same indicator where the new course has it, else the one at the same position.
    if (course && ((course.indicators || []).length > 0 || (course.lesson_plans || []).length > 0)) {
      setQuestions((prev) => prev.map((q) => ({ ...q, indicator_id: remapIndicatorId(q.indicator_id, previous, course) })));
    }
  };

  const toggleClassroomSelection = (classId: string) => {
    if (editingAssignment || retake) return;
    setSelectedClassroomIds((prev) => {
      if (prev.includes(classId)) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter((id) => id !== classId);
      }
      return [...prev, classId];
    });
  };

  const allReminderOptions = [
    { value: 24 * 60, label: language === 'th' ? '24 ชั่วโมงก่อนกำหนดส่ง' : '24 hours before due' },
    { value: 12 * 60, label: language === 'th' ? '12 ชั่วโมงก่อนกำหนดส่ง' : '12 hours before due' },
    { value: 6 * 60, label: language === 'th' ? '6 ชั่วโมงก่อนกำหนดส่ง' : '6 hours before due' },
    { value: 3 * 60, label: language === 'th' ? '3 ชั่วโมงก่อนกำหนดส่ง' : '3 hours before due' },
    { value: 60, label: language === 'th' ? '1 ชั่วโมงก่อนกำหนดส่ง' : '1 hour before due' },
    { value: 30, label: language === 'th' ? '30 นาทีก่อนกำหนดส่ง' : '30 minutes before due' },
  ];
  // A reminder can't be earlier than "now": only offer offsets that fit before the due date.
  // `clock` ticks each minute so the list shrinks while the form stays open.
  // Reminders also can't fire before a scheduled assignment is published.
  const reminderFloor = schedulePublish && publishAt ? Math.max(clock, new Date(publishAt).getTime()) : clock;
  const minutesUntilDue = dueDate ? Math.floor((new Date(dueDate).getTime() - reminderFloor) / 60000) : Infinity;
  const reminderOptions = allReminderOptions.filter((option) => option.value < minutesUntilDue);
  // The chosen reminder, if it still fits before the deadline (saved as a one-item list).
  const effectiveReminderOffsets =
    typeof reminderOffset === 'number' && reminderOptions.some((option) => option.value === reminderOffset) ? [reminderOffset] : [];
  // Dropdown value: a fitting time, "none", or '' (please select; also when the chosen time no longer fits).
  const reminderSelectValue = effectiveReminderOffsets.length ? String(effectiveReminderOffsets[0]) : reminderOffset === null ? 'none' : '';

  /**
   * Quizzes take no photos or files. When a quiz needs one, offer homework mode
   * instead: in class the teacher can watch students themselves. True when a
   * file question may be added (now, or after switching to homework).
   */
  const offerHomeworkMode = (reason: string) => {
    const ok = confirm(
      language === 'th'
        ? `${reason}\n\nแบบทดสอบไม่อนุญาตให้ถ่ายรูปหรือแนบไฟล์ เพราะระบบนับทุกครั้งที่นักเรียนออกจากหน้าจอ\nเปลี่ยนเป็นโหมด "การบ้าน" แทนหรือไม่? (หากทำในห้องเรียน คุณครูเฝ้าดูนักเรียนเองได้)`
        : `${reason}\n\nQuizzes do not allow photos or file uploads, since every screen exit is counted.\nSwitch to homework mode instead? (In class, you can watch students yourself.)`
    );
    if (ok) setIsExam(false);
    return ok;
  };
  const allowFileQuestion = () =>
    !isExam || offerHomeworkMode(language === 'th' ? 'คำถามแบบแนบไฟล์ / ถ่ายรูป' : 'File upload / photo question');

  const handleAddQuestion = (type: QuestionType = 'short_answer') => {
    if (type === 'file_upload' && !allowFileQuestion()) return;
    // Use courseIndicators first, fall back to global indicators
    const defaultIndId = courseIndicators[0]?.id || indicators[0]?.id || '';
    setQuestions((prev) => [
      ...prev,
      {
        uid: newQuestionUid(),
        indicator_id: defaultIndId,
        type,
        question_text: '',
        options: ['', '', '', ''],
        ideal_answer: '',
        rubric_criteria: '',
        max_score: defaultMaxScore(type),
        is_required: true,
      },
    ]);

    setTimeout(() => {
      lastQuestionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  // A removed card first collapses and fades (see the questions stack), then leaves the list.
  const [removingQuestionUids, setRemovingQuestionUids] = useState<string[]>([]);
  const visibleQuestionCount = questions.length - removingQuestionUids.length;
  const handleRemoveQuestion = (uid: string) => {
    if (visibleQuestionCount <= 1 || removingQuestionUids.includes(uid)) return;
    setRemovingQuestionUids((prev) => [...prev, uid]);
    setTimeout(() => {
      setQuestions((prev) => prev.filter((q) => q.uid !== uid));
      setRemovingQuestionUids((prev) => prev.filter((id) => id !== uid));
    }, QUESTION_EXIT_MS);
  };

  // A score still at the old type's default follows the new type (e.g. 1 → 10 for
  // file upload); a score the teacher typed stays.
  const handleQuestionTypeChange = (index: number, type: QuestionType) => {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i !== index ? q : { ...q, type, max_score: Number(q.max_score) === defaultMaxScore(q.type) ? defaultMaxScore(type) : q.max_score }
      )
    );
  };

  const handleQuestionChange = (
    index: number,
    field: keyof QuestionDraft,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any
  ) => {
    setQuestions((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleOptionChange = (qIndex: number, optIndex: number, val: string) => {
    setQuestions((prev) => {
      const copy = [...prev];
      const current = copy[qIndex];
      const newOpts = [...current.options];
      const previousText = newOpts[optIndex];
      newOpts[optIndex] = val;
      // The chosen correct answer follows its option when the teacher edits the text.
      const idealFollows = current.type === 'multiple_choice' && previousText.trim() && current.ideal_answer === previousText;
      copy[qIndex] = { ...current, options: newOpts, ideal_answer: idealFollows ? val : current.ideal_answer };
      return copy;
    });
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!title.trim()) {
      alert(language === 'th' ? 'กรุณาระบุชื่อการบ้านหรือข้อสอบ' : 'Please provide a title');
      return;
    }
    if (retake && !retake.ids.length) {
      alert(tr('กรุณาเลือกนักเรียนที่ต้องสอบซ่อมอย่างน้อย 1 คน', 'Choose at least one student for the retake'));
      document.getElementById('retake-students')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // An edit may keep a deadline that has already passed; only a new one must be ahead.
    const dueChanged = !editingAssignment || new Date(dueDate).getTime() !== new Date(editingAssignment.due_date).getTime();
    if (dueChanged && dueDate && new Date(dueDate).getTime() <= clockNow()) {
      alert(language === 'th' ? 'กำหนดส่งต้องเป็นเวลาในอนาคต' : 'The due date must be in the future');
      return;
    }
    if (schedulePublish && !editIsPublished) {
      const publishMs = new Date(publishAt).getTime();
      if (!publishAt || Number.isNaN(publishMs) || publishMs <= clockNow()) {
        alert(language === 'th' ? 'เวลาเผยแพร่ต้องเป็นเวลาในอนาคต' : 'The publish time must be in the future');
        return;
      }
      if (dueDate && new Date(dueDate).getTime() <= publishMs) {
        alert(language === 'th' ? 'กำหนดส่งต้องอยู่หลังเวลาเผยแพร่' : 'The due date must be after the publish time');
        return;
      }
    }
    if (!isExam && selectedClassroomsLineReady && reminderOptions.length > 0 && !reminderSelectValue) {
      alert(language === 'th' ? 'กรุณาเลือกเวลาแจ้งเตือนทาง LINE (หรือเลือก "ไม่ต้องแจ้งเตือน")' : 'Please choose a LINE reminder (or "No reminder")');
      document.getElementById('line-reminder')?.focus();
      return;
    }
    const fileInQuiz = isExam ? questions.findIndex((q) => q.type === 'file_upload') : -1;
    if (fileInQuiz !== -1) {
      // Switching changes deadline, reminder and reference-file settings, so the teacher checks them before saving.
      if (offerHomeworkMode(language === 'th' ? `ข้อที่ ${fileInQuiz + 1} เป็นคำถามแบบแนบไฟล์ / ถ่ายรูป` : `Question ${fileInQuiz + 1} asks for a file / photo`)) {
        alert(language === 'th' ? 'เปลี่ยนเป็นโหมดการบ้านแล้ว ตรวจสอบกำหนดส่งและการแจ้งเตือน แล้วกดบันทึกอีกครั้ง' : 'Switched to homework mode. Check the deadline and reminder, then save again.');
      } else {
        alert(language === 'th' ? `กรุณาเปลี่ยนประเภทคำถามข้อที่ ${fileInQuiz + 1} ก่อนบันทึกแบบทดสอบ` : `Change the type of question ${fileInQuiz + 1} before saving the quiz.`);
      }
      return;
    }
    const incompleteChoice = questions.findIndex(
      (q) => q.type === 'multiple_choice' && q.options.filter((opt) => opt.trim()).length < 2
    );
    if (incompleteChoice !== -1) {
      alert(
        language === 'th'
          ? `ข้อที่ ${incompleteChoice + 1}: กรุณากรอกตัวเลือกอย่างน้อย 2 ตัวเลือก`
          : `Question ${incompleteChoice + 1}: please fill in at least 2 options`
      );
      return;
    }

    const noAnswerKey = questions
      .map((q, i) => ({ q, n: i + 1 }))
      .filter(({ q }) =>
        q.type === 'multiple_choice'
          ? !q.options.some((opt) => opt.trim() && opt === q.ideal_answer)
          : q.type === 'true_false' && parseTrueFalse(q.ideal_answer) === null
      );
    if (
      noAnswerKey.length &&
      !confirm(
        language === 'th'
          ? `ข้อ ${noAnswerKey.map((x) => x.n).join(', ')} ยังไม่ได้เลือกคำตอบที่ถูกต้อง ระบบจะให้ 0 คะแนนอัตโนมัติ (ตรวจเองภายหลังได้)\n\nต้องการสร้างต่อหรือไม่?`
          : `Question ${noAnswerKey.map((x) => x.n).join(', ')} has no correct answer selected and will auto-score 0. Continue?`
      )
    ) {
      return;
    }

    setIsSubmitting(true);
    try {
      const primaryClassId = selectedClassroomIds[0] || classrooms[0]?.id;
      if (!primaryClassId) {
        alert(language === 'th' ? 'กรุณาเลือกห้องเรียนก่อนสร้างงาน' : 'Please choose a classroom first');
        return;
      }
      // One copy per selected classroom (each gets its own timeline post and LINE message).
      const targetClassIds = selectedClassroomIds.length ? selectedClassroomIds : [primaryClassId];
      const selectedCourse = courses.find((course) => course.id === selectedCourseId);
      if (selectedCourse?.indicator_mode === 'competency' && (selectedCourse.lesson_plans || []).length === 0) {
        alert(language === 'th' ? 'กรุณากำหนดแผนการสอน/สมรรถนะก่อนสร้างงาน' : 'Please configure competency lesson plans before creating an assignment');
        return;
      }
      const totalPoints = questions.reduce((acc, q) => acc + Number(q.max_score || 0), 0);

      const questionRows = questions.map((q) => ({
        type: q.type,
        question_text: q.question_text || 'คำถามข้อนี้',
        indicator_id: q.indicator_id,
        options: q.type === 'multiple_choice' ? q.options.map((opt) => opt.trim()).filter(Boolean) : q.type === 'true_false' ? [...TRUE_FALSE_OPTIONS] : undefined,
        ideal_answer: q.type === 'true_false'
          ? (parseTrueFalse(q.ideal_answer) === null ? '' : parseTrueFalse(q.ideal_answer) ? 'ถูก' : 'ผิด')
          : q.ideal_answer,
        // Choice and true/false are scored from the key alone.
        rubric_criteria: q.type === 'multiple_choice' || q.type === 'true_false' ? '' : q.rubric_criteria,
        max_score: Number(q.max_score) || defaultMaxScore(q.type),
        is_required: isExam ? true : q.is_required,
      }));
      // Upload picked files first: if one fails, nothing is saved and the
      // teacher sees why. Uploaded ones keep their URL, so a retry skips them.
      const ready: AttachmentDraft[] = [];
      for (const draft of attachments) {
        if (!draft.file) {
          ready.push(draft);
          continue;
        }
        setIsUploadingSample(true);
        try {
          // Straight to storage; a failed earlier save may already have stored this file, so reuse it.
          const uploaded = await uploadToStorage(draft.file, {
            assignmentId: editingAssignment?.id || "draft",
            // Already shrunk when the teacher picked it.
            optimized: true,
            onDuplicate: () => "reuse",
          });
          URL.revokeObjectURL(draft.url);
          const done: AttachmentDraft = { uid: draft.uid, kind: draft.kind, url: uploaded.url, name: draft.name };
          ready.push(done);
          setAttachments((list) => list.map((a) => (a.uid === draft.uid ? done : a)));
        } catch (uploadError) {
          console.error("Attachment upload error:", uploadError);
          const message = uploadError instanceof UploadError ? uploadError.message : tr('อัปโหลดไฟล์แนบไม่สำเร็จ', 'Could not upload the attachment');
          setSampleUploadError(`${draft.name}: ${message}`);
          alert(`${draft.name}: ${message}\n\n${tr('ยังไม่ได้บันทึกงาน กรุณาแก้ไฟล์แล้วกดบันทึกอีกครั้ง', 'The assignment was not saved. Fix the file and save again.')}`);
          return;
        } finally {
          setIsUploadingSample(false);
        }
      }
      const savedAttachments: AssignmentAttachment[] = ready.map(({ kind, url, name }) => ({ kind, url, name }));

      if (editingAssignment) {
        const keptIds = new Set(questions.map((q) => q.id).filter(Boolean));
        const removedCount = originalQuestionIdsRef.current.filter((id) => !keptIds.has(id)).length;
        if (
          editSubmissionCount > 0 &&
          !confirm(
            tr(
              `มีนักเรียนส่งงานนี้แล้ว ${editSubmissionCount} คน\n` +
                (removedCount ? `• ข้อที่ลบ (${removedCount} ข้อ) จะลบคำตอบของนักเรียนในข้อนั้นด้วย\n` : '') +
                '• ข้อปรนัย / ถูก-ผิด ที่เปลี่ยนเฉลยหรือคะแนน จะตรวจคำตอบที่ส่งแล้วใหม่อัตโนมัติ (คะแนนที่คุณครูปรับเองรายคนยังคงไว้)\n' +
                '• ข้อเขียน / แนบไฟล์ ที่ตรวจไปแล้ว คะแนนไม่เปลี่ยน\n\nต้องการบันทึกการแก้ไขหรือไม่?',
              `${editSubmissionCount} students have already submitted\n` +
                (removedCount ? `• Removing ${removedCount} questions also deletes students' answers to them\n` : '') +
                '• Multiple-choice / true-false questions with a changed key or score are re-graded automatically (scores you adjusted by hand are kept)\n' +
                '• Written / file questions that were already graded keep their scores\n\nSave the changes?'
            )
          )
        ) {
          return;
        }
        const id = editingAssignment.id;
        await dataService.updateAssignment(id, {
          title,
          group_name: groupName.trim(),
          description,
          is_exam: isExam,
          due_date: dueDate || editingAssignment.due_date,
          ...(!editIsPublished && schedulePublish ? { publish_at: new Date(publishAt).toISOString() } : {}),
          ...(!editIsPublished && saveAsDraft ? { publish_at: DRAFT_PUBLISH_AT } : {}),
          reminder_offset_minutes: !isExam && selectedClassroomsLineReady ? effectiveReminderOffsets[0] || 0 : 0,
          reminder_offsets_minutes: !isExam && selectedClassroomsLineReady ? effectiveReminderOffsets : [],
          total_points: totalPoints,
          attachments: savedAttachments,
          ...(retake ? { retake_student_ids: retake.ids } : {}),
        });
        await dataService.replaceAssignmentQuestions(id, questionRows.map((row, index) => ({ ...row, id: questions[index].id })));
        // Was scheduled or a draft, teacher switched to "publish now".
        if (!editIsPublished && releaseMode === 'now') await dataService.publishAssignmentNow(id);
        alert(
          !editIsPublished && saveAsDraft
            ? language === 'th' ? 'บันทึกฉบับร่างแล้ว นักเรียนยังไม่เห็นงานนี้' : 'Draft saved. Students cannot see it yet.'
            : language === 'th' ? 'บันทึกการแก้ไขเรียบร้อยแล้ว' : 'Changes saved'
        );
        router.push(returnTo || (isFromDashboard ? '/dashboard' : `/classrooms/${editingAssignment.classroom_id}?tab=classwork`));
        return;
      }

      const createdIds: string[] = [];
      for (const classId of targetClassIds) {
        const created = await dataService.createAssignment(
          {
            course_id: selectedCourseId,
            classroom_id: classId,
            classroom_name: classrooms.find((c) => c.id === classId)?.name || 'Classroom',
            title,
            group_name: groupName.trim() || undefined,
            description,
            is_exam: isExam,
            due_date: dueDate || daysFromNowAt(7, 23, 59),
            publish_at: saveAsDraft ? DRAFT_PUBLISH_AT : schedulePublish ? new Date(publishAt).toISOString() : undefined,
            reminder_cron: reminderCron,
            reminder_offset_minutes: !isExam && selectedClassroomsLineReady ? effectiveReminderOffsets[0] || 0 : 0,
            reminder_offsets_minutes: !isExam && selectedClassroomsLineReady ? effectiveReminderOffsets : [],
            total_points: totalPoints,
            status_override: 'auto',
            attachments: savedAttachments,
            ...(retake?.source ? { retake_of: retake.source.id, retake_student_ids: retake.ids } : {}),
          },
          questionRows
        );
        createdIds.push(created.assignment.id);
      }

      const copiedTo = copySource && !retake
        ? tr('คัดลอกไปยัง: ', 'Copied to: ') + targetClassIds.map((id) => classrooms.find((c) => c.id === id)?.name || id).join(', ') + '\n\n'
        : '';
      alert(
        copiedTo + (saveAsDraft
          ? language === 'th'
            ? `บันทึกฉบับร่างแล้ว • นักเรียนยังไม่เห็นจนกว่าจะกด "เผยแพร่ตอนนี้"\nลบอัตโนมัติถ้าไม่เผยแพร่ใน ${DRAFT_RETENTION_DAYS} วัน`
            : `Draft saved • hidden until you press "Publish now"\nDeleted if not published within ${DRAFT_RETENTION_DAYS} days`
          : schedulePublish
          ? language === 'th'
            ? `ตั้งเวลาเผยแพร่${isExam ? 'แบบทดสอบ' : 'การบ้าน'}แล้ว: ${formatDateTime(publishAt, 'th')}\nนักเรียนจะเห็นงานและได้รับแจ้งเตือน LINE เมื่อถึงเวลา`
            : `Scheduled for ${formatDateTime(publishAt, 'en')}. Students will see it then.`
          : retake
          ? selectedClassroomsLineReady
            ? tr(`สร้างข้อสอบซ่อมแล้ว · ส่งลิงก์เข้ากลุ่ม LINE แล้ว\nเปิดได้เฉพาะ ${retake.ids.length} คนที่เลือก`, `Retake created · link sent to the LINE group\nOnly the ${retake.ids.length} chosen students can open it`)
            : tr(`สร้างข้อสอบซ่อมแล้ว · เปิดได้เฉพาะ ${retake.ids.length} คนที่เลือก\nห้องนี้ยังไม่เชื่อม LINE จึงต้องส่งลิงก์เอง`, `Retake created · only the ${retake.ids.length} chosen students can open it\nThis class has no LINE group, so share the link yourself`)
          : isExam
          ? (language === 'th' ? 'สร้างแบบทดสอบสำเร็จ!' : 'Quiz created successfully!')
          : !selectedClassroomsLineReady || !effectiveReminderOffsets.length
          ? (language === 'th' ? 'สร้างการบ้านสำเร็จ!' : 'Assignment created successfully!')
          : language === 'th'
          ? 'สร้างการบ้านสำเร็จ! ตั้งเวลาเตือนส่งงานผ่าน LINE เรียบร้อย'
          : 'Assignment created successfully! LINE reminder scheduled.')
      );

      const targetClassId = primaryClassId || urlClassroomId || selectedClassroomIds[0];
      if (copySource && !retake) {
        // Back to where the copy was started (the source classroom or the grading hub).
        router.push(returnTo || `/classrooms/${urlClassroomId || targetClassId}?tab=classwork`);
      } else if (targetClassId) {
        router.push(`/classrooms/${targetClassId}?tab=classwork`);
      } else {
        router.push('/dashboard');
      }
    } catch (err) {
      console.error(err);
      alert(err instanceof Error && err.message ? err.message : 'Error creating assignment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentCourseClassrooms = classrooms.filter(
    (c) => !selectedCourseId || c.course_id === selectedCourseId
  );
  const selectedClassroomsLineReady = selectedClassroomIds.length > 0
    && selectedClassroomIds.every((classroomId) => lineConnectionStatuses[classroomId] === 'connected');

  // Retake: who takes it (chips to remove, the rest of the roster to add).
  const retakeCard = () => {
    if (!retake) return null;
    const name = (st: User) => `${st.first_name || ''} ${st.last_name || ''}`.trim() || st.name || st.student_id || '-';
    const chosen = retake.roster.filter((st) => retake.ids.includes(st.id));
    const others = retake.roster.filter((st) => !retake.ids.includes(st.id));
    const setIds = (ids: string[]) => {
      setRetake((prev) => (prev ? { ...prev, ids } : prev));
      setFormTouched(true);
    };
    return (
      <WorkContextBanner
        tone="retake"
        icon={<RotateCcw className="w-4 h-4" />}
        kicker={tr('สอบซ่อม · เห็นและทำได้เฉพาะคนที่เลือก · คะแนนแทนของเดิม', 'Retake · only chosen students · replaces their score')}
        title={retake.source ? tr(`จาก ${retake.source.title}`, `Of ${retake.source.title}`) : tr('ข้อสอบเดิมถูกลบแล้ว', 'Original quiz deleted')}
        meta={selectedClassroomsLineReady ? tr('บันทึกแล้วส่งลิงก์เข้ากลุ่ม LINE ของห้อง', 'Saving sends the link to the class LINE group') : tr('ห้องนี้ยังไม่เชื่อม LINE', 'This class has no LINE group')}
      >
        <div id="retake-students" className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {chosen.map((st) => (
              <span key={st.id} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-orange-50 dark:bg-orange-950/40 ring-1 ring-orange-200 dark:ring-orange-900 text-[11px] font-bold text-orange-800 dark:text-orange-200">
                {name(st)}
                <button
                  type="button"
                  onClick={() => setIds(retake.ids.filter((id) => id !== st.id))}
                  aria-label={tr(`เอา ${name(st)} ออก`, `Remove ${name(st)}`)}
                  className="w-5 h-5 rounded-full hover:bg-orange-200 dark:hover:bg-orange-900 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {!chosen.length && <span className="text-[11px] font-bold text-rose-600">{tr('ยังไม่ได้เลือกนักเรียน', 'No students chosen')}</span>}
            {others.length > 0 && (
              <button
                type="button"
                onClick={() => setRetakeAdding((v) => !v)}
                aria-expanded={retakeAdding}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full ring-1 ring-dashed ring-slate-300 dark:ring-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:ring-orange-400 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                {tr('เพิ่มนักเรียน', 'Add student')}
              </button>
            )}
          </div>
          {retakeAdding && others.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
              {others.map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setIds([...retake.ids, st.id])}
                  className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-xs hover:bg-orange-50 dark:hover:bg-orange-950/30 cursor-pointer"
                >
                  <span className="truncate font-semibold text-slate-800 dark:text-slate-100">{name(st)}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{st.student_id || ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </WorkContextBanner>
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-24">
      {/* Dynamic Back Button based on entry source */}
      <div>
        <button
          type="button"
          onClick={() => {
            if (returnTo) {
              router.push(returnTo);
            } else if (isFromDashboard) {
              router.push('/dashboard');
            } else {
              const targetId = urlClassroomId || selectedClassroomIds[0];
              if (targetId) {
                router.push(`/classrooms/${targetId}?tab=classwork`);
              } else {
                router.push('/dashboard');
              }
            }
          }}
          className="inline-flex items-center gap-2 max-w-full px-3.5 py-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:border-amber-300 hover:text-amber-700 dark:hover:text-amber-400 transition-all shadow-xs cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="truncate">
            <MobileText
              short={returnTo?.startsWith('/works') ? tr('กลับไปรายการงาน', 'Back to work') : returnTo ? tr('กลับไปตรวจงาน', 'Back to grading') : isFromDashboard ? tr('กลับแดชบอร์ด', 'Dashboard') : tr('กลับไปห้องเรียน', 'Back to class')}
              full={returnTo?.startsWith('/works') ? tr('กลับไปรายการงานและข้อสอบ', 'Back to assignments & quizzes') : returnTo ? tr('กลับไปหน้าตรวจงาน', 'Back to grading') : isFromDashboard ? tr('กลับสู่แดชบอร์ด (Dashboard)', 'Back to dashboard') : tr('กลับไปหน้าห้องเรียน (งานและเนื้อหา)', 'Back to classroom (Classwork)')}
            />
          </span>
        </button>
      </div>

      {/* Page Header */}
      <div>
        <div className="hidden sm:inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-xs font-bold mb-2">
          <span>{isExam ? '🛡️ ' + t('assignment_creator.mode_exam') : '📚 ' + t('assignment_creator.mode_assignment')}</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          {retake
            ? editId ? tr('แก้ไขข้อสอบซ่อม', 'Edit retake quiz') : tr('สร้างข้อสอบซ่อม', 'New retake quiz')
            : editId
            ? (language === 'th' ? 'แก้ไขงาน / ข้อสอบ' : 'Edit assignment / quiz')
            : isReuse
            ? tr('สร้างงานใหม่จากงานเดิม', 'New work from earlier work')
            : templateToken
            ? tr('สร้างงานจากแม่แบบ', 'New work from a template')
            : copyId
            ? tr('คัดลอกงาน / ข้อสอบไปห้องอื่น', 'Copy assignment / quiz to other classrooms')
            : t('assignment_creator.title')}
        </h1>
        {retake && retakeCard()}
        {copySource && !retake && (() => {
          const from = classrooms.find((c) => c.id === copySource.classroom_id)?.name || copySource.classroom_name || tr('ห้องเดิม', 'original classroom');
          return (
            <WorkContextBanner
              tone="copy"
              icon={<Copy className="w-4 h-4" />}
              kicker={tr('กำลังสร้างสำเนาใหม่ · งานต้นฉบับไม่ถูกแก้ไข', 'Creating a new copy · the original stays unchanged')}
              title={copySource.title || tr('(ไม่มีชื่อ)', '(untitled)')}
              meta={tr(
                `ต้นฉบับจาก ${from} • ตรวจห้อง กำหนดส่ง และการเผยแพร่ก่อนบันทึก`,
                `Original from ${from} • check classrooms, due date and release before saving`
              )}
            />
          );
        })()}
        {editingAssignment && (() => {
          const where = classrooms.find((c) => c.id === editingAssignment.classroom_id)?.name || editingAssignment.classroom_name || '';
          const copyHref = `/assignments/new?copy=${editingAssignment.id}&classroomId=${editingAssignment.classroom_id}&from=${returnTo ? urlFrom : isFromDashboard ? 'dashboard' : 'classroom'}${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`;
          return (
            <WorkContextBanner
              tone="edit"
              icon={<PencilLine className="w-4 h-4" />}
              kicker={editIsPublished
                ? tr('กำลังแก้ไขงานเดิม · นักเรียนเห็นการเปลี่ยนแปลงทันทีที่บันทึก', 'Editing saved work · students see changes once you save')
                : tr('กำลังแก้ไขงานเดิม (ยังไม่เผยแพร่)', 'Editing saved work (not released yet)')}
              title={editingAssignment.title || tr('(ไม่มีชื่อ)', '(untitled)')}
              meta={where ? tr(`ในห้อง ${where}`, `In ${where}`) : undefined}
              action={
                <button
                  type="button"
                  onClick={() => {
                    if (formTouched && !confirm(tr(
                      'การแก้ไขที่ยังไม่บันทึกจะไม่ถูกนำไปด้วย — สำเนาใช้ฉบับที่บันทึกไว้ล่าสุด\nไปหน้าสร้างสำเนาเลยหรือไม่?',
                      'Unsaved changes are not included — the copy uses the last saved version.\nGo to the copy page?'
                    ))) return;
                    router.push(copyHref);
                  }}
                  className="group w-full sm:w-auto flex items-center gap-2.5 pl-2 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 hover:bg-white dark:hover:bg-slate-800 hover:border-sky-300 dark:hover:border-sky-700 text-left cursor-pointer transition-colors"
                >
                  <span className="w-7 h-7 shrink-0 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 text-sky-600 dark:text-sky-400 flex items-center justify-center group-hover:ring-sky-300 dark:group-hover:ring-sky-700 transition-colors">
                    <Copy className="w-3.5 h-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{tr('ทำสำเนาไปห้องอื่น', 'Copy to other classrooms')}</span>
                    <span className="block text-[10px] text-slate-500 dark:text-slate-400">{tr('ใช้ฉบับที่บันทึกล่าสุด', 'Uses the last saved version')}</span>
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-0.5 transition-all" />
                </button>
              }
            >
              {editSubmissionCount > 0 && (
                <p className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                  <MobileText
                    short={language === 'th'
                      ? `ส่งแล้ว ${editSubmissionCount} คน — ข้อปรนัย/ถูกผิดตรวจใหม่อัตโนมัติ • ลบคำถามแล้วคำตอบข้อนั้นหาย`
                      : `${editSubmissionCount} submitted — choice answers are re-scored • removing a question deletes its answers`}
                    full={language === 'th'
                      ? `ส่งแล้ว ${editSubmissionCount} คน • บันทึกแล้วข้อปรนัย/ถูก-ผิดตรวจใหม่ตามเฉลยใหม่ (คะแนนที่ปรับเองคงไว้) • ลบข้อ = คำตอบข้อนั้นหาย`
                      : `${editSubmissionCount} handed in • choice/true-false re-scored on save (manual scores kept) • removing a question deletes its answers`}
                  />
                </p>
              )}
            </WorkContextBanner>
          );
        })()}
        <p className="hidden sm:block text-slate-500 dark:text-slate-400 text-sm mt-1">
          {t('assignment_creator.subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} onInputCapture={() => setFormTouched(true)} className="space-y-8">
        {/* Mode Selector Toggle: Assignment vs Exam. Sticky under the navbar so the mode can be
            switched from anywhere on a long form; the highlight slides between the two buttons. */}
        <div className="sticky top-[calc(4rem+env(safe-area-inset-top)+0.5rem)] z-20 p-2 sm:p-2.5 rounded-3xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200 dark:border-slate-800 shadow-lg shadow-slate-900/5 flex items-center justify-between gap-4">
          <div
            ref={trackModeToggle}
            role="radiogroup"
            aria-label={language === 'th' ? 'ประเภทงาน' : 'Work type'}
            className="relative grid grid-cols-2 gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80 w-full lg:w-auto"
          >
            {modeIndicator && (
              <span
                aria-hidden
                className={`absolute top-0 left-0 rounded-xl shadow-md transition-[transform,width,height,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isExam ? 'bg-purple-600 shadow-purple-500/25' : 'bg-emerald-600 shadow-emerald-500/25'
                }`}
                style={indicatorStyle(modeIndicator)}
              />
            )}
            {([
              { exam: false, icon: BookOpen, short: language === 'th' ? 'การบ้าน' : 'Assignment', label: t('assignment_creator.mode_assignment'), pill: 'bg-emerald-600' },
              { exam: true, icon: ShieldAlert, short: language === 'th' ? 'ข้อสอบ' : 'Quiz', label: t('assignment_creator.mode_exam'), pill: 'bg-purple-600' },
            ] as const).map((option) => {
              const Icon = option.icon;
              const selected = isExam === option.exam;
              return (
                <button
                  key={String(option.exam)}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-active={selected}
                  onClick={() => !retake && setIsExam(option.exam)}
                  disabled={!!retake && !option.exam}
                  className={`relative lg:min-w-40 px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors duration-300 cursor-pointer ${
                    selected
                      ? `text-white ${modeIndicator ? '' : option.pill}`
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 shrink-0 transition-transform duration-300 ${selected ? 'scale-110' : ''}`} />
                  <span>
                    <MobileText short={option.short} full={option.label} />
                  </span>
                </button>
              );
            })}
          </div>

          <span key={`hint-${isExam}`} className="hidden lg:inline-flex animate-in fade-in slide-in-from-top-1">
            <ModeHint isExam={isExam} language={language} />
          </span>
          {((copySource && !retake) || editingAssignment) && (
            <span
              title={copySource ? tr('กำลังสร้างสำเนาใหม่ งานต้นฉบับไม่ถูกแก้ไข', 'Creating a new copy; the original is not changed') : tr('กำลังแก้ไขงานที่บันทึกไว้', 'Editing saved work')}
              className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-bold ring-1 ${
                copySource
                  ? 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 ring-sky-200 dark:ring-sky-900'
                  : 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 ring-amber-200 dark:ring-amber-900'
              }`}
            >
              {copySource ? <Copy className="w-3.5 h-3.5" /> : <PencilLine className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{copySource ? tr('สำเนาใหม่', 'New copy') : tr('แก้ไขงานเดิม', 'Editing')}</span>
            </span>
          )}
        </div>
        <div key={`hint-${isExam}`} className="hidden sm:block lg:hidden -mt-5 animate-in fade-in slide-in-from-top-1">
          <ModeHint isExam={isExam} language={language} />
        </div>

        {/* Basic Assignment Details */}
        <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-6">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-amber-500" />
            <span>{language === 'th' ? 'ข้อมูลรายวิชาและการมอบหมาย' : 'Course & Assignment Details'}</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Parent Course Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                <MobileText short={language === 'th' ? 'รายวิชา' : 'Course'} full={t('assignment_creator.fields.parent_course')} /> *
              </label>
              <select
                value={selectedCourseId}
                disabled={!!editingAssignment}
                onChange={(e) => handleCourseChange(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code} - {course.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Target Classrooms / Sections Multi-select */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                <MobileText short={language === 'th' ? 'ห้องเรียน' : 'Classrooms'} full={t('assignment_creator.fields.classroom_label')} /> *
              </label>
              {editingAssignment && (
                <p className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400">
                  {language === 'th' ? 'งานที่สร้างแล้วย้ายห้องไม่ได้ (แก้ไขเฉพาะห้องนี้)' : 'Saved work stays in its classroom.'}
                </p>
              )}
              {copySource && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {tr('เลือกได้หลายห้อง — แต่ละห้องได้งานแยกกัน', 'Pick one or more — each classroom gets its own copy')}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-0.5">
                {(editingAssignment ? currentCourseClassrooms.filter((c) => c.id === editingAssignment.classroom_id) : currentCourseClassrooms).map((cls) => {
                  const isSelected = selectedClassroomIds.includes(cls.id);
                  return (
                    <button
                      key={cls.id}
                      type="button"
                      onClick={() => toggleClassroomSelection(cls.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-amber-500 text-slate-950 border-amber-600 font-bold shadow-xs'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5" />}
                      <span>{cls.name}</span>
                      {copySource?.classroom_id === cls.id && (
                        <span className="text-[10px] font-semibold opacity-70">{tr('(ต้นฉบับ)', '(original)')}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Title */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {t('assignment_creator.fields.title_label')} *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('assignment_creator.fields.title_placeholder')}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-medium focus:outline-hidden focus:border-amber-500"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="assignment-group" className="text-xs font-bold text-slate-700 dark:text-slate-300">{tr('หมวดหมู่การแสดงผล', 'Display group')}</label>
              <input
                id="assignment-group"
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={existingGroups.length ? tr('เลือกด้านล่าง หรือพิมพ์ชื่อใหม่', 'Pick below or type a new name') : isExam ? tr('เช่น สอบกลางภาค', 'e.g. Midterm') : tr('เช่น ใบงานบทที่ 1', 'e.g. Chapter 1 worksheet')}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500"
              />
              {existingGroups.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{tr('หมวดหมู่ที่มีอยู่แล้ว:', 'Existing groups:')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {existingGroups.map((name) => {
                      const selected = groupName.trim() === name;
                      return (
                        <button
                          key={name}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setGroupName(selected ? '' : name)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all cursor-pointer inline-flex items-center gap-1 ${
                            selected
                              ? 'bg-amber-500 text-slate-950 border-amber-600'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-400'
                          }`}
                        >
                          {selected ? <Check className="w-3 h-3" /> : <Layers className="w-3 h-3" />}
                          <span>{name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {t('assignment_creator.fields.description_label')}
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('assignment_creator.fields.description_placeholder')}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 leading-relaxed"
              />
            </div>

            {/* Attachments: links, Google Drive, images / PDFs (homework and quizzes) */}
            <div className="space-y-2 md:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Paperclip className="w-3.5 h-3.5 text-amber-500" />
                  <span>{tr('ไฟล์แนบ', 'Attachments')}</span>
                  <span className="font-semibold text-slate-400">({attachments.length}/{MAX_ASSIGNMENT_ATTACHMENTS})</span>
                </label>
                <span className="hidden sm:inline text-[11px] text-slate-400">
                  {tr('ตัวอย่างผลงาน ใบงาน หรือสื่อประกอบ ให้นักเรียนเปิดดูได้', 'Examples, worksheets or materials students can open')}
                </span>
              </div>
              {isExam && (
                <p className="text-[11px] text-purple-600 dark:text-purple-300">
                  {tr('รูปภาพและ PDF นักเรียนเปิดดูในหน้าข้อสอบได้ • การเปิดลิงก์จะนับเป็นการออกจากหน้าจอ', 'Students view images and PDFs inside the quiz • opening a link counts as leaving the screen')}
                </p>
              )}
              <>
                  {attachments.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {attachments.map((a) => (
                        <AttachmentCard
                          key={a.uid}
                          attachment={a}
                          size="sm"
                          busy={!!a.file && isUploadingSample}
                          note={a.file ? tr('จะอัปโหลดเมื่อบันทึกงาน', 'Uploads when you save') : undefined}
                          onRemove={isUploadingSample ? undefined : () => removeAttachment(a.uid)}
                        />
                      ))}
                    </div>
                  )}
                  {attachmentSlots > 0 && (
                    <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                      <button
                        type="button"
                        onClick={() => openLinkDialog('link')}
                        className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors active:scale-95"
                      >
                        <Link2 className="w-4 h-4 text-sky-600" />
                        <span>{tr('ลิงก์', 'Link')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openLinkDialog('drive')}
                        className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors active:scale-95"
                      >
                        <GoogleDriveMark className="w-4 h-4" />
                        <span>Google Drive</span>
                      </button>
                      <label
                        className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors active:scale-95 ${
                          isUploadingSample ? 'opacity-60 cursor-wait' : 'cursor-pointer'
                        }`}
                      >
                        {isUploadingSample ? <Loader2 className="w-4 h-4 animate-spin text-amber-600" /> : <UploadCloud className="w-4 h-4 text-amber-600" />}
                        <span><MobileText short={tr('อัปโหลด', 'Upload')} full={tr('อัปโหลดรูป / PDF', 'Upload image / PDF')} /></span>
                        <input
                          type="file"
                          multiple
                          accept="application/pdf,image/*"
                          disabled={isUploadingSample}
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            e.target.value = "";
                            if (files.length) void handleAttachmentFiles(files);
                          }}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}
                  {sampleUploadError && <p className="text-[11px] text-rose-500 font-semibold">{sampleUploadError}</p>}
                  <p className="text-[11px] text-slate-400">
                    {attachmentSlots > 0
                      ? tr(`สูงสุด ${MAX_ASSIGNMENT_ATTACHMENTS} รายการ • รูป ≤5MB, PDF ≤10MB (ใหญ่กว่านี้ใช้ลิงก์ Drive)`, `Up to ${MAX_ASSIGNMENT_ATTACHMENTS} • images ≤5MB, PDF ≤10MB (bigger: Drive link)`)
                      : tr(`แนบครบ ${MAX_ASSIGNMENT_ATTACHMENTS} รายการแล้ว — นำออกเพื่อเพิ่มรายการใหม่`, `All ${MAX_ASSIGNMENT_ATTACHMENTS} slots used — remove one to add another`)}
                  </p>
              </>
            </div>

            {/* Release: now, scheduled, or saved as a draft */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5 text-amber-500" />
                <span><MobileText short={language === 'th' ? 'การเผยแพร่' : 'Release'} full={language === 'th' ? 'เวลาเผยแพร่ให้นักเรียน' : 'Release to students'} /></span>
              </label>
              {editIsPublished ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {language === 'th' ? 'เผยแพร่ให้นักเรียนแล้ว' : 'Already released to students'}
                  {editingAssignment?.publish_at ? ` • ${formatDateTime(editingAssignment.publish_at, language)}` : ''}
                </p>
              ) : (
              <>
              <div ref={trackReleaseToggle} className="relative grid grid-cols-3 gap-2" role="radiogroup">
                {/* Highlight slides to the chosen option (down the stack on phones, across on wider screens). */}
                {releaseIndicator && (
                  <span
                    aria-hidden
                    className={`absolute top-0 left-0 rounded-xl shadow-xs transition-[transform,width,height,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                      RELEASE_PILL[releaseMode]
                    }`}
                    style={indicatorStyle(releaseIndicator)}
                  />
                )}
                {([
                  {
                    value: 'draft',
                    icon: FilePen,
                    label: language === 'th' ? 'บันทึกฉบับร่าง' : 'Save as draft',
                    short: language === 'th' ? 'ฉบับร่าง' : 'Draft',
                    hint: language === 'th' ? 'ยังไม่เผยแพร่ คุณครูกดเผยแพร่เองภายหลัง' : 'Not released; you publish it later',
                    text: 'text-white dark:text-slate-900',
                  },
                  {
                    value: 'schedule',
                    icon: Clock,
                    label: language === 'th' ? 'ตั้งเวลาเผยแพร่' : 'Schedule',
                    short: language === 'th' ? 'ตั้งเวลา' : 'Schedule',
                    hint: language === 'th' ? 'เผยแพร่เองเมื่อถึงเวลาที่เลือก' : 'Released automatically at a set time',
                    text: 'text-slate-950',
                  },
                  {
                    value: 'now',
                    icon: Send,
                    label: language === 'th' ? 'เผยแพร่ทันที' : 'Publish now',
                    short: language === 'th' ? 'ทันที' : 'Now',
                    hint: language === 'th' ? 'นักเรียนเห็นและแจ้งเข้า LINE ทันที' : 'Students see it now; LINE is notified',
                    text: 'text-slate-950',
                  },
                ] as const).map((option) => {
                  const Icon = option.icon;
                  const isSelected = releaseMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      data-active={isSelected}
                      onClick={() => setReleaseMode(option.value)}
                      className={`relative min-w-0 px-1.5 sm:px-3 py-2.5 rounded-xl border transition-colors duration-300 cursor-pointer text-center sm:text-left flex flex-col sm:flex-row items-center sm:items-start gap-1 sm:gap-2 ${
                        isSelected
                          ? `border-transparent ${option.text} ${releaseIndicator ? '' : RELEASE_PILL[option.value]}`
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-400'
                      } ${option.value === 'draft' && !isSelected ? 'border-dashed' : ''}`}
                    >
                      <Icon className={`w-4 h-4 sm:mt-0.5 shrink-0 transition-transform duration-300 ${isSelected ? 'scale-110' : ''}`} />
                      <span className="min-w-0 max-w-full">
                        <span className="block text-xs font-bold truncate sm:whitespace-normal">
                          <MobileText short={option.short} full={option.label} />
                        </span>
                        <span className={`hidden sm:block text-[10px] leading-snug mt-0.5 transition-colors duration-300 ${isSelected ? 'opacity-85' : 'text-slate-400 dark:text-slate-500'}`}>{option.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* Each option's details open and close smoothly (inner pt-2 instead of space-y so a closed one leaves no gap). */}
              <div className="-mt-2">
              <Collapse open={schedulePublish}>
                <div className="pt-2">
                <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 space-y-2">
                  <DateTimeField value={publishAt} onChange={setPublishAt} presets="start" />
                  <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                    <MobileText
                      short={language === 'th' ? 'นักเรียนเห็นงานและได้แจ้งเตือน LINE เมื่อถึงเวลานี้' : 'Students see it (and LINE is notified) at this time.'}
                      full={language === 'th'
                        ? 'นักเรียนเห็นงานและได้รับแจ้งใน LINE เมื่อถึงเวลานี้'
                        : 'Students see it and get a LINE notice at this time'}
                    />
                  </p>
                </div>
                </div>
              </Collapse>
              <Collapse open={saveAsDraft}>
                <div className="pt-2">
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-dashed border-slate-300 dark:border-slate-600 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  <p className="flex items-start gap-1.5">
                    <FilePen className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500" />
                    <span>
                      <MobileText
                        short={language === 'th' ? 'นักเรียนยังไม่เห็นงาน จนกว่าคุณครูจะกดเผยแพร่' : 'Hidden from students until you publish it.'}
                        full={language === 'th'
                          ? 'ซ่อนจากนักเรียนจนกว่าจะกด "เผยแพร่ตอนนี้"'
                          : 'Hidden until you press "Publish now"'}
                      />
                    </span>
                  </p>
                  <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400 font-bold">
                    <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      {(() => {
                        const expires = editingAssignment && isAssignmentDraft(editingAssignment) ? draftExpiresAt(editingAssignment) : null;
                        if (expires) {
                          return language === 'th'
                            ? `ฉบับร่างนี้จะถูกลบอัตโนมัติ ${formatDateTime(expires, language)} หากยังไม่เผยแพร่`
                            : `This draft is deleted automatically on ${formatDateTime(expires, language)} unless published.`;
                        }
                        return (
                          <MobileText
                            short={language === 'th' ? `ลบอัตโนมัติหากไม่เผยแพร่ใน ${DRAFT_RETENTION_DAYS} วัน` : `Deleted if not published in ${DRAFT_RETENTION_DAYS} days.`}
                            full={language === 'th'
                              ? `ฉบับร่างที่ไม่ได้เผยแพร่ภายใน ${DRAFT_RETENTION_DAYS} วันจะถูกลบอัตโนมัติ`
                              : `Drafts not published within ${DRAFT_RETENTION_DAYS} days are deleted automatically.`}
                          />
                        );
                      })()}
                    </span>
                  </p>
                </div>
                </div>
              </Collapse>
              </div>
              </>
              )}
            </div>

            {/* Due Date */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-500" />
                <span><MobileText short={language === 'th' ? 'กำหนดส่ง' : 'Due'} full={t('assignment_creator.fields.due_date_label')} /></span>
              </label>
              <DateTimeField value={dueDate} onChange={setDueDate} presets="deadline" />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                <MobileText
                  short={isExam
                    ? (language === 'th' ? 'ปิดรับข้อสอบเมื่อถึงเวลานี้' : 'The quiz closes at this time.')
                    : (language === 'th' ? `ส่งช้าได้อีก ${LATE_WINDOW_HOURS} ชม. แล้วปิดรับเอง` : `Late work accepted for ${LATE_WINDOW_HOURS}h.`)}
                  full={isExam
                    ? (language === 'th'
                      ? `ปิดรับเมื่อถึงเวลา • เปิดค้างไว้ส่งได้อีก ${QUIZ_LATE_GRACE_MINUTES} นาที (ส่งช้า, นักเรียนไม่เห็น)`
                      : `Closes at this time • open sheets get ${QUIZ_LATE_GRACE_MINUTES} more min (late, hidden from students)`)
                    : (language === 'th'
                      ? `หลังเวลานี้ส่งช้าได้อีก ${LATE_WINDOW_HOURS} ชม. แล้วปิดเอง`
                      : `Late work for ${LATE_WINDOW_HOURS}h after, then closes`)}
                />
              </p>
            </div>

            {/* LINE Reminder Setting (homework only — quizzes close at the deadline) */}
            {!isExam && (
            <div className="space-y-2 animate-in fade-in slide-in-from-top-2 [--tw-duration:280ms]">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-500" />
                <span><MobileText short={language === 'th' ? 'แจ้งเตือนทาง LINE' : 'LINE reminder'} full={t('assignment_creator.fields.line_reminder_label')} /></span>
              </label>
              {selectedClassroomsLineReady && reminderOptions.length === 0 ? (
                <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
                  <MobileText
                    short={language === 'th' ? 'ใกล้กำหนดส่งเกินไป ตั้งเตือนไม่ได้' : 'Too close to the due date for a reminder.'}
                    full={language === 'th'
                      ? 'เหลือเวลาก่อนกำหนดส่งไม่ถึง 30 นาที จึงไม่สามารถตั้งเวลาเตือนได้'
                      : 'Less than 30 minutes until the due date, so no reminder can be scheduled.'}
                  />
                </div>
              ) : selectedClassroomsLineReady ? (
                <div className="relative max-w-md">
                  <select
                    id="line-reminder"
                    value={reminderSelectValue}
                    onChange={(e) => setReminderOffset(e.target.value === 'none' ? null : e.target.value ? Number(e.target.value) : undefined)}
                    aria-label={t('assignment_creator.fields.line_reminder_label')}
                    className={`w-full appearance-none pl-3.5 pr-9 py-2.5 rounded-xl border text-xs font-bold cursor-pointer focus:outline-hidden focus:border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 ${
                      reminderSelectValue ? 'text-slate-900 dark:text-white' : 'text-slate-400'
                    }`}
                  >
                    <option value="" disabled>{language === 'th' ? '— กรุณาเลือก —' : '— Please select —'}</option>
                    {reminderOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                    <option value="none">{language === 'th' ? 'ไม่ต้องแจ้งเตือน' : 'No reminder'}</option>
                  </select>
                  <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-emerald-600" />
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 space-y-2">
                  <p><MobileText short={tr('ห้องนี้ยังไม่ได้เชื่อม LINE Bot', 'This class has no LINE bot')} full={tr('ห้องเรียนที่เลือกยังไม่ได้เชื่อมต่อ LINE Bot จึงยังตั้งเวลาทวงงานไม่ได้', 'The selected classroom is not connected to the LINE bot, so reminders cannot be scheduled yet')} /></p>
                  <button type="button" onClick={() => router.push('/dashboard')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold">
                    {tr('ไปเชื่อมต่อ LINE Bot', 'Connect the LINE bot')} <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <p className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400">
                {selectedClassroomsLineReady
                  ? effectiveReminderOffsets.length
                    ? tr('ส่งรายชื่อคนที่ยังไม่ส่งเข้า LINE group 1 ครั้ง', 'Posts who has not handed in to the LINE group once')
                    : reminderSelectValue === 'none'
                    ? tr('ไม่ส่งแจ้งเตือนเข้า LINE group สำหรับงานนี้', 'No LINE group reminder for this assignment')
                    : tr('แสดงเฉพาะเวลาที่ยังทันก่อนกำหนดส่ง — ถ้าเปลี่ยนกำหนดส่งแล้วเวลาที่เลือกไม่ทัน ต้องเลือกใหม่', 'Only times before the due date are shown — if a new due date makes the chosen time too late, pick again')
                  : tr('เมื่อเชื่อมต่อ LINE Bot แล้ว จึงจะสามารถตั้งเวลาและส่งสรุปเข้า LINE group ได้', 'Connect the LINE bot to schedule reminders to the LINE group')}
              </p>
            </div>
            )}
          </div>
        </div>

        {linkDialog && (
          <div className="fixed inset-0 z-70 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-6 animate-in fade-in" onClick={() => setLinkDialog(null)}>
            {/* A div, not a form: it sits inside the assignment form. */}
            <div
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 p-5 sm:p-6 pb-[max(env(safe-area-inset-bottom),1.25rem)] shadow-2xl space-y-4 animate-in slide-in-from-bottom-5"
            >
              <div className="flex items-center gap-2.5">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${linkDialog === 'drive' ? 'bg-slate-100 dark:bg-slate-800' : 'bg-sky-100 dark:bg-sky-950 text-sky-600'}`}>
                  {linkDialog === 'drive' ? <GoogleDriveMark className="w-5 h-5" /> : <Link2 className="w-5 h-5" />}
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-black text-slate-900 dark:text-white">
                    {linkDialog === 'drive' ? tr('แนบจาก Google Drive', 'Attach from Google Drive') : tr('แนบลิงก์', 'Attach a link')}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {linkDialog === 'drive'
                      ? tr('คัดลอกลิงก์จากปุ่ม "แชร์" ใน Drive แล้ววางที่นี่ — ตั้งค่าเป็น "ทุกคนที่มีลิงก์"', 'Copy the link from "Share" in Drive and paste it here — set it to "Anyone with the link"')
                      : tr('วางลิงก์เว็บไซต์ วิดีโอ หรือเอกสารออนไลน์', 'Paste a website, video or online document link')}
                  </p>
                </div>
              </div>
              <input
                type="url"
                inputMode="url"
                autoFocus
                value={linkInput}
                onChange={(e) => {
                  setLinkInput(e.target.value);
                  setLinkError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitLinkDialog();
                  } else if (e.key === 'Escape') {
                    setLinkDialog(null);
                  }
                }}
                placeholder={linkDialog === 'drive' ? 'https://drive.google.com/...' : 'https://...'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
              />
              {linkError && <p className="text-[11px] text-rose-500 font-semibold -mt-2">{linkError}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setLinkDialog(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                  {tr('ยกเลิก', 'Cancel')}
                </button>
                <button type="button" onClick={submitLinkDialog} disabled={!linkInput.trim()} className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer">
                  {tr('แนบ', 'Attach')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Dynamic Questions Builder */}
        <div className="space-y-6">
          <div className="flex items-start sm:items-center justify-between gap-3 pb-2 border-b border-slate-200 dark:border-slate-800">
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-900 dark:text-white">
                {t('assignment_creator.questions_builder.title')}
              </h2>
              <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400">
                {language === 'th'
                  ? 'กำหนดประเภทข้อสอบ เกณฑ์การประเมิน (Rubric) และตัวชี้วัด'
                  : 'Configure question types, rubric scoring, and standard indicators'}
              </p>
            </div>
            <span className="shrink-0 text-xs font-bold px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              {visibleQuestionCount} {language === 'th' ? 'ข้อ' : 'Questions'}
            </span>
          </div>

          {/* Questions Stack */}
          {/* Each card sits in a grid row that collapses (with a fade and slight shrink) when it is
              deleted; the gap lives inside the row (pb-6) so it closes together with the card. */}
          <div className="flex flex-col">
            {questions.map((q, idx) => {
              const removing = removingQuestionUids.includes(q.uid);
              return (
              <div
                key={q.uid}
                inert={removing}
                className={`grid last:[&>div]:pb-0 transition-[grid-template-rows,opacity,scale] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  removing ? 'grid-rows-[0fr] opacity-0 scale-[0.97]' : 'grid-rows-[1fr] opacity-100'
                }`}
              >
              <div className={`min-h-0 pb-6 ${removing ? 'overflow-hidden' : ''}`}>
              <div
                ref={idx === questions.length - 1 ? lastQuestionRef : null}
                className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-xs space-y-6 relative transition-colors animate-in fade-in slide-in-from-bottom-5 [--tw-duration:320ms]"
              >
                {/* Question Card Header */}
                <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-2xl bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center shadow-xs">
                      {idx + 1}
                    </span>
                    <span className="hidden min-[380px]:inline font-bold text-sm text-slate-900 dark:text-white">
                      {t('assignment_creator.questions_builder.question_number')} {idx + 1}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 sm:gap-3">
                    {/* Required / optional (homework only; quizzes may be handed in unfinished) */}
                    {!isExam && (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={q.is_required}
                        onClick={() => handleQuestionChange(idx, 'is_required', !q.is_required)}
                        title={q.is_required ? tr('นักเรียนต้องตอบข้อนี้ก่อนส่งงาน', 'Students must answer this before submitting') : tr('นักเรียนเว้นข้อนี้ได้', 'Students may skip this')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                          q.is_required
                            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
                            : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        <span className={`w-6 h-3.5 rounded-full relative transition-colors ${q.is_required ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                          <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${q.is_required ? 'left-3' : 'left-0.5'}`} />
                        </span>
                        <span>{q.is_required ? tr('จำเป็น', 'Required') : tr('ไม่บังคับ', 'Optional')}</span>
                      </button>
                    )}

                    {/* Score */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-slate-500 font-semibold">
                        <MobileText short={language === 'th' ? 'คะแนน' : 'Pts'} full={t('assignment_creator.questions_builder.max_score')} />:
                      </span>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={q.max_score}
                        onChange={(e) =>
                          handleQuestionChange(idx, 'max_score', Number(e.target.value))
                        }
                        className="w-16 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center font-bold text-slate-900 dark:text-white"
                      />
                    </div>

                    {/* Delete Question */}
                    {visibleQuestionCount > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveQuestion(q.uid)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title={t('assignment_creator.questions_builder.delete_question')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Question Type */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {t('assignment_creator.questions_builder.question_type')}
                    </label>
                    <select
                      value={q.type}
                      onChange={(e) => {
                        const type = e.target.value as QuestionType;
                        if (type === 'file_upload' && !allowFileQuestion()) return;
                        handleQuestionTypeChange(idx, type);
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                    >
                      <option value="multiple_choice">
                        {t('assignment_creator.questions_builder.type_multiple_choice')}
                      </option>
                      <option value="short_answer">
                        {t('assignment_creator.questions_builder.type_short_answer')}
                      </option>
                      <option value="file_upload">
                        {t('assignment_creator.questions_builder.type_file_upload')}
                      </option>
                      <option value="true_false">
                        {t('assignment_creator.questions_builder.type_true_false')}
                      </option>
                    </select>
                  </div>

                  {/* Indicator / Competency Select — sourced from selected course */}
                  <div className="space-y-1.5">
                    {(() => {
                      const selectedCourse = courses.find((c) => c.id === selectedCourseId);
                      const isCompetency = selectedCourse?.indicator_mode === 'competency';
                      const lessonPlans = selectedCourse?.lesson_plans || [];

                      if (isCompetency) {
                        // Competency mode: choose a lesson plan entry (which maps to competency items)
                        return (
                          <>
                            <label className="text-xs font-bold text-violet-700 dark:text-violet-300">
                              {tr('แผนการสอน / สมรรถนะ', 'Lesson plan / competency')}
                            </label>
                            <select
                              value={q.indicator_id}
                              onChange={(e) => handleQuestionChange(idx, 'indicator_id', e.target.value)}
                              className="w-full px-3 py-2 rounded-xl bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-violet-500 cursor-pointer"
                            >
                              {lessonPlans.map((plan, planIdx) => {
                                const mappedLabels = (plan.mapped_indicator_ids || [])
                                  .map((mid) => {
                                    const ci = courseIndicators.find((c) => c.id === mid);
                                    const ciIdx = courseIndicators.findIndex((c) => c.id === mid);
                                    return ci ? `${tr('สมรรถนะ', 'Competency')} ${ciIdx + 1}` : null;
                                  })
                                  .filter(Boolean)
                                  .join(', ');
                                return (
                                  <option key={plan.id} value={plan.id}>
                                    {tr('แผน', 'Plan')} {planIdx + 1}: {plan.title.substring(0, 35) || tr('(ไม่มีชื่อ)', '(untitled)')}
                                    {mappedLabels ? ` → ${mappedLabels}` : ''}
                                  </option>
                                );
                              })}
                            </select>
                          </>
                        );
                      }

                      // Indicator mode: choose from course's CourseLearningIndicator list
                      const indOptions = courseIndicators.length > 0 ? courseIndicators : indicators;
                      return (
                        <>
                          <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                            {t('assignment_creator.questions_builder.indicator_select')}
                          </label>
                          {indOptions.length === 0 ? (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                              {tr('ยังไม่มีตัวชี้วัดในวิชานี้ — ไปตั้งค่าใน Dashboard ก่อน', 'This course has no indicators yet — set them up on the Dashboard first')}
                            </p>
                          ) : (
                            <select
                              value={q.indicator_id}
                              onChange={(e) => handleQuestionChange(idx, 'indicator_id', e.target.value)}
                              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                            >
                              {indOptions.map((ind, indIdx) => (
                                <option key={ind.id} value={ind.id}>
                                  {tr('ข้อ', 'Item')} {indIdx + 1}: {ind.title.substring(0, 50)}{ind.title.length > 50 ? '…' : ''}
                                </option>
                              ))}
                            </select>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Question Prompt */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {t('assignment_creator.questions_builder.question_text')} *
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={q.question_text}
                    onChange={(e) => handleQuestionChange(idx, 'question_text', e.target.value)}
                    placeholder={language === 'th' ? 'ระบุเนื้อหาโจทย์หรือคำสั่งข้อนี้...' : 'Write the question prompt...'}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 leading-relaxed font-medium"
                  />
                </div>

                {/* Multiple Choice Options Builder: tap the circle to mark the correct option */}
                {q.type === 'multiple_choice' && (
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3 animate-in fade-in slide-in-from-top-2 [--tw-duration:280ms]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        {t('assignment_creator.questions_builder.options_label')}
                      </label>
                      {q.options.some((opt) => opt.trim() && opt === q.ideal_answer) ? (
                        <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <MobileText
                            short={language === 'th' ? 'ตรวจอัตโนมัติ' : 'Auto-scored'}
                            full={language === 'th' ? 'เลือกข้อที่ถูกแล้ว • ระบบตรวจให้อัตโนมัติ' : 'Correct answer set • auto-scored'}
                          />
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
                          <MobileText
                            short={language === 'th' ? 'แตะวงกลมข้อที่ถูก' : 'Tap the correct one'}
                            full={language === 'th' ? 'กดวงกลมหน้าตัวเลือกที่ถูกต้อง' : 'Tap the circle next to the correct option'}
                          />
                        </span>
                      )}
                    </div>
                    <div className="space-y-2" role="radiogroup" aria-label={language === 'th' ? 'คำตอบที่ถูกต้อง' : 'Correct answer'}>
                      {q.options.map((opt, optIdx) => {
                        const isCorrect = !!opt.trim() && q.ideal_answer === opt;
                        return (
                          <div key={optIdx} className="flex items-center gap-2">
                            <button
                              type="button"
                              role="radio"
                              aria-checked={isCorrect}
                              disabled={!opt.trim()}
                              onClick={() => handleQuestionChange(idx, 'ideal_answer', opt)}
                              title={language === 'th' ? 'ตั้งเป็นคำตอบที่ถูกต้อง' : 'Mark as the correct answer'}
                              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 border-2 transition-all ${
                                isCorrect
                                  ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                                  : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-400 hover:border-emerald-500 hover:text-emerald-600 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-300 disabled:hover:text-slate-400'
                              }`}
                            >
                              {isCorrect ? <Check className="w-4 h-4" /> : String.fromCharCode(65 + optIdx)}
                            </button>
                            <input
                              type="text"
                              value={opt}
                              onChange={(e) => handleOptionChange(idx, optIdx, e.target.value)}
                              placeholder={language === 'th' ? `ตัวเลือก ${'กขคงจฉชซ'[optIdx] || optIdx + 1}` : `Option ${String.fromCharCode(65 + optIdx)}`}
                              className={`flex-1 px-3 py-1.5 rounded-lg border text-xs text-slate-900 dark:text-white ${
                                isCorrect
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 dark:border-emerald-700 font-bold'
                                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                              }`}
                            />
                            {isCorrect && (
                              <span className="text-[10px] font-black text-emerald-700 dark:text-emerald-400 shrink-0">
                                {language === 'th' ? 'ข้อที่ถูก' : 'Correct'}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* True/false: pick the correct answer (auto-scored, no rubric) */}
                {q.type === 'true_false' && (
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3 animate-in fade-in slide-in-from-top-2 [--tw-duration:280ms]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                        {language === 'th' ? 'คำตอบที่ถูกต้อง' : 'Correct answer'}
                      </label>
                      {parseTrueFalse(q.ideal_answer) !== null ? (
                        <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {language === 'th' ? 'ระบบตรวจให้อัตโนมัติ' : 'Auto-scored'}
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
                          {language === 'th' ? 'เลือก ถูก หรือ ผิด' : 'Choose true or false'}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 max-w-sm" role="radiogroup">
                      {TRUE_FALSE_OPTIONS.map((option) => {
                        const isSelected = parseTrueFalse(q.ideal_answer) === (option === 'ถูก');
                        return (
                          <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            onClick={() => handleQuestionChange(idx, 'ideal_answer', option)}
                            className={`py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                              isSelected
                                ? option === 'ถูก'
                                  ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                                  : 'bg-rose-600 border-rose-600 text-white shadow-xs'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                            }`}
                          >
                            {option === 'ถูก' ? tr('✓ ถูก', '✓ True') : tr('✗ ผิด', '✗ False')}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Ideal Answer & Rubric: written / file questions (choices are scored from the key above) */}
                {q.type !== 'multiple_choice' && q.type !== 'true_false' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 [--tw-duration:280ms]">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {t('assignment_creator.questions_builder.ideal_answer')}
                    </label>
                    <textarea
                      rows={2}
                      value={q.ideal_answer}
                      onChange={(e) => handleQuestionChange(idx, 'ideal_answer', e.target.value)}
                      placeholder={t('assignment_creator.questions_builder.ideal_answer_hint')}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {t('assignment_creator.questions_builder.rubric')}
                    </label>
                    <textarea
                      rows={2}
                      value={q.rubric_criteria}
                      onChange={(e) => handleQuestionChange(idx, 'rubric_criteria', e.target.value)}
                      placeholder={t('assignment_creator.questions_builder.rubric_hint')}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
                    />
                  </div>
                </div>
                )}
              </div>
              </div>
              </div>
              );
            })}
          </div>

          {/* QUESTION ADDER PLACEMENT: AT THE BOTTOM OF THE LAST QUESTION ITEM */}
          <div className="p-4 sm:p-6 rounded-3xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 text-center space-y-3">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              <MobileText short={language === 'th' ? 'เพิ่มคำถาม' : 'Add a question'} full={t('assignment_creator.questions_builder.add_question_hint')} />
            </p>
            {/* Phones: one row of four (icon above a short label); wider screens: the full labels in a wrapped row. */}
            <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-2.5">
              {([
                { type: 'multiple_choice', th: ['ปรนัย', 'ปรนัย'], en: ['Choice', 'Multiple Choice'] },
                { type: 'short_answer', th: ['ข้อความ', 'ข้อความสั้น'], en: ['Text', 'Short Answer'] },
                { type: 'file_upload', th: ['ไฟล์', 'อัปโหลดไฟล์'], en: ['File', 'File Upload'] },
                { type: 'true_false', th: ['ถูก/ผิด', 'ถูก/ผิด'], en: ['T/F', 'True/False'] },
              ] as const).map((option, i) => {
                const [short, full] = language === 'th' ? option.th : option.en;
                return (
                  <button
                    key={option.type}
                    type="button"
                    onClick={() => handleAddQuestion(option.type)}
                    className={`min-w-0 px-1 py-2.5 rounded-2xl text-[11px] sm:text-xs font-bold transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-1.5 cursor-pointer ${
                      i === 0
                        ? 'sm:px-4 bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md hover:scale-[1.02]'
                        : 'sm:px-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    <PlusCircle className="w-4 h-4 shrink-0" />
                    <span className="max-w-full truncate sm:hidden">{short}</span>
                    <span className="hidden sm:inline">{full}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Submit Actions Bar (sticky so publishing is always reachable on long forms) */}
        <div className="sticky bottom-[max(env(safe-area-inset-bottom),0.75rem)] z-20 w-fit ml-auto sm:w-auto sm:ml-0 p-3 rounded-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200 dark:border-slate-800 shadow-lg shadow-slate-900/5 flex items-center justify-end gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-5 py-2.5 rounded-2xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className={`flex-none justify-center px-6 py-3 sm:py-2.5 rounded-2xl text-sm sm:text-xs font-black shadow-lg transition-all duration-300 active:scale-[0.98] flex items-center gap-2 cursor-pointer disabled:opacity-50 border-2 ${
              saveAsDraft && !editIsPublished
                ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border-dashed border-slate-400 dark:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-black/5'
                : 'bg-amber-500 hover:bg-amber-600 text-slate-950 border-transparent shadow-amber-500/25'
            }`}
          >
            {(() => {
              const th = language === 'th';
              // [short, full] for every state the button can show.
              const labels = {
                uploading: [th ? 'กำลังอัปโหลด...' : 'Uploading...', th ? 'กำลังอัปโหลดไฟล์...' : 'Uploading file...'],
                loading: [t('common.loading'), t('common.loading')],
                draft: [th ? 'บันทึกร่าง' : 'Save draft', th ? 'บันทึกฉบับร่าง' : 'Save draft'],
                savePublish: [th ? 'บันทึก+เผยแพร่' : 'Save & publish', th ? 'บันทึกและเผยแพร่' : 'Save & publish'],
                save: [th ? 'บันทึก' : 'Save', th ? 'บันทึกการแก้ไข' : 'Save changes'],
                schedule: [th ? 'ตั้งเวลา' : 'Schedule', th ? 'ตั้งเวลาเผยแพร่' : 'Schedule'],
                publish: [th ? 'มอบหมายทันที' : 'Publish', t('assignment_creator.buttons.publish')],
              };
              const [short, full] = isSubmitting
                ? isUploadingSample ? labels.uploading : labels.loading
                : saveAsDraft && !editIsPublished
                ? labels.draft
                : editId
                ? !editIsPublished && releaseMode === 'now' ? labels.savePublish : labels.save
                : schedulePublish
                ? labels.schedule
                : labels.publish;
              return (
                // On phones every short label sits invisibly in the same grid cell, so the
                // button is as wide as the longest one and doesn't resize as the mode changes.
                <span className="grid">
                  {Object.values(labels).map(([s], i) => (
                    <span key={i} aria-hidden className="sm:hidden invisible col-start-1 row-start-1 inline-flex items-center gap-2 whitespace-nowrap">
                      <span className="w-4 h-4 shrink-0" />
                      {s}
                    </span>
                  ))}
                  {/* Re-keyed per release mode so the icon and label swap in with a small rise. */}
                  <span
                    key={editIsPublished ? 'saved' : releaseMode}
                    className="col-start-1 row-start-1 justify-self-center inline-flex items-center gap-2 whitespace-nowrap animate-in fade-in slide-in-from-bottom-1 [--tw-duration:260ms]"
                  >
                    {saveAsDraft && !editIsPublished
                      ? <FilePen className="w-4 h-4 text-slate-500" />
                      : schedulePublish && !editIsPublished
                      ? <Clock className="w-4 h-4" />
                      : <Send className="w-4 h-4" />}
                    {/* Phones get a short label so the bar stays balanced; from sm up the full one. */}
                    <span className="sm:hidden">{short}</span>
                    <span className="hidden sm:inline">{full}</span>
                  </span>
                </span>
              );
            })()}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewAssignmentPage() {
  const { tr } = useLanguage();
  return (
    <React.Suspense fallback={<div className="p-8 text-center text-sm text-slate-400">{tr('กำลังโหลด...', 'Loading...')}</div>}>
      <NewAssignmentContent />
    </React.Suspense>
  );
}
