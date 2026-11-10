'use client';

import { usePageTitle } from '@/lib/hooks/usePageTitle';
import React, { useState, useEffect, useRef } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { isUnsent } from '@/lib/utils/lineShare';
import { dataService } from '@/lib/supabase/dataService';
import { cachedCall, readCache, TEACHER_DASHBOARD_CACHE_KEY } from '@/lib/cache/sessionCache';
import { Assignment, AssignmentAttachment, Course, Classroom, LearningIndicator, CourseLearningIndicator, QuestionType, Question, User } from '@/types/database';
import { isRetake, isRetakeOf } from '@/lib/utils/retake';
import { StudentPickLink, StudentPickerSheet } from '@/components/StudentPickerSheet';
import { TRUE_FALSE_OPTIONS, parseTrueFalse } from '@/lib/utils/trueFalse';
import { matchChoiceOption, nonNegativeScore } from '@/lib/utils/autoGrade';
import { SCALE_POINTS, SURVEY_TYPES, SURVEY_TYPE_LABEL, hasOptions, surveyProblem } from '@/lib/utils/survey';
import { indicatorChoicesFor, missingIndicatorMessage } from '@/lib/utils/questionIndicator';
import { DateTimeField } from '@/components/DateTimeField';
import { Collapse } from '@/components/Collapse';
import { indicatorStyle, useSlidingIndicator } from '@/lib/hooks/useSlidingIndicator';
import { daysFromNowAt, formatDateTime } from '@/lib/utils/datetime';
import { DRAFT_PUBLISH_AT, DRAFT_RETENTION_DAYS, draftExpiresAt, isAssignmentDraft, LATE_WINDOW_HOURS } from '@/lib/utils/assignmentWindow';
import { optimizeImage, UploadError, uploadToStorage } from '@/lib/storage/uploadClient';
import { normalizeLink, uploadRejection } from '@/lib/storage/uploadRules';
import { assignmentAttachments, googleAppName, isGoogleDriveUrl, linkDisplayName, MAX_ASSIGNMENT_ATTACHMENTS } from '@/lib/utils/referenceWork';
import { AttachmentCard, GoogleDriveMark } from '@/components/AssignmentAttachments';
import { MobileText } from '@/components/MobileText';
import {
  PlusCircle,
  Trash2,
  Calendar,
  Lock,
  Clock,
  FilePen,
  BookOpen,
  Send,
  Save,
  MessageSquare,
  ShieldAlert,
  HelpCircle,
  Layers,
  Check,
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
  ClipboardList,
} from 'lucide-react';
import { PageSkeleton } from '@/components/LoadingState';

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

/** Starting points for a new question: file work is worth more than a single short item. */
const defaultMaxScore = (type: QuestionType) => (type === 'file_upload' ? 10 : 1);
/** A choice question keeps at least MIN_OPTIONS options (it starts with 4). */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

let questionUidSeq = 0;
const newQuestionUid = () => `q${++questionUidSeq}`;
/** A blank question card (no indicator: the teacher picks one). */
const blankQuestion = (type: QuestionType): QuestionDraft => ({
  uid: newQuestionUid(),
  indicator_id: '',
  type,
  question_text: '',
  options: ['', '', '', ''],
  ideal_answer: '',
  rubric_criteria: '',
  max_score: defaultMaxScore(type),
  is_required: true,
});
/** Matches the card's collapse transition (duration-300). */
const QUESTION_EXIT_MS = 300;
/** Sliding highlight colour per release option (draft reads as "not live yet", the others use the app accent). */
const RELEASE_PILL = {
  draft: 'bg-slate-800 dark:bg-slate-100',
  now: 'bg-amber-500',
} as const;

/**
 * The same indicator (or lesson plan) in another course: kept when that course
 * has it, else the one at the same position, else none (the teacher picks). Used
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
  // No match: the teacher picks one (there is no default).
  return '';
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

const DEFAULT_QUIZ_MINUTES = 60;
const MAX_QUIZ_MINUTES = 24 * 60;
const QUIZ_MINUTE_PRESETS = [10, 15, 20, 30, 45, 60, 90, 120];

/** A saved quiz's minutes: stored, or read from its deadline (older quizzes); a default when neither fits. */
function quizMinutesOf(assignment: Assignment) {
  const stored = Number(assignment.quiz_duration_minutes);
  if (stored > 0) return Math.min(stored, MAX_QUIZ_MINUTES);
  const startIso = assignment.publish_at && !isAssignmentDraft(assignment) ? assignment.publish_at : assignment.created_at;
  const minutes = Math.round((Date.parse(assignment.due_date) - Date.parse(startIso || '')) / 60000);
  return Number.isFinite(minutes) && minutes > 0 && minutes <= MAX_QUIZ_MINUTES ? minutes : DEFAULT_QUIZ_MINUTES;
}

function NewAssignmentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlClassroomId = searchParams.get('classroomId');
  const urlFrom = searchParams.get('from');
  const isFromDashboard = urlFrom === 'dashboard' || (!urlClassroomId && urlFrom !== 'classroom');
  // Opened from the grading hub: go back to the same view (only /grading paths are accepted).
  // Opened from the work list: back to it (only /works paths are accepted).
  const returnParam = searchParams.get('returnTo');
  const allowedReturn =
    (urlFrom === 'grading' && returnParam?.startsWith('/grading')) || (urlFrom === 'works' && returnParam?.startsWith('/works'))
      ? returnParam
      : null;
  // ?edit=<assignmentId>: the same form, filled with a saved assignment or quiz.
  const editId = searchParams.get('edit');
  // ?copy=<assignmentId>: a new assignment filled from saved work (any state), for other classrooms.
  const copyId = editId ? null : searchParams.get('copy');
  // ?siblings=<ids> (with edit): the same work in other classrooms; saving applies the changes to them too.
  const siblingIds = editId ? (searchParams.get('siblings') || '').split(',').filter((id) => id && id !== editId).slice(0, 40) : [];
  const siblingKey = siblingIds.join(',');
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
  const [, setCourseIndicators] = useState<CourseLearningIndicator[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [copySource, setCopySource] = useState<Assignment | null>(null);
  // Typed into the form since it loaded (asked before leaving an edit for a copy).
  const [formTouched, setFormTouched] = useState(false);
  const [editSubmissionCount, setEditSubmissionCount] = useState(0);
  // Retake quiz: the original quiz, the classroom roster and the chosen students.
  const [retake, setRetake] = useState<{ source: Assignment | null; roster: User[]; ids: string[] } | null>(null);
  const [retakeAdding, setRetakeAdding] = useState(false);
  usePageTitle(editingAssignment ? `แก้ไข: ${editingAssignment.title}` : retake ? 'สร้างข้อสอบซ่อม' : copyId ? 'คัดลอกงาน' : templateToken ? 'สร้างจากเทมเพลต' : null);
  const originalQuestionIdsRef = useRef<string[]>([]);
  // The edited work's questions as loaded, to find the matching question in each sibling copy.
  const originalQuestionsRef = useRef<Question[]>([]);
  // Sibling copies (other classrooms) loaded with the form: their row and questions.
  const [siblings, setSiblings] = useState<Array<{ assignment: Assignment; questions: Question[] }>>([]);

  // Form fields
  const [isExam, setIsExam] = useState(() => !editId && ((!copyId && urlMode === 'quiz') || !!retakeOfParam));
  // "กิจกรรม": no scores, keys or indicators (never together with isExam).
  const [isSurveyMode, setIsSurveyMode] = useState(() => !editId && !copyId && !retakeOfParam && urlMode === 'survey');
  const workMode = isExam ? 'quiz' : isSurveyMode ? 'survey' : 'homework';
  const [trackModeToggle, modeIndicator] = useSlidingIndicator(workMode);
  // Graded and survey questions are kept apart; switching between them parks the other set here.
  const parkedQuestionsRef = useRef<QuestionDraft[] | null>(null);
  // Back to the work list on the tab of what is being made (quiz → quizzes, homework → assignments).
  const returnTo = (() => {
    if (!allowedReturn?.startsWith('/works')) return allowedReturn;
    const [path, query = ''] = allowedReturn.split('?');
    const params = new URLSearchParams(query);
    if (isExam) params.set('tab', 'quiz');
    else if (isSurveyMode) params.set('tab', 'survey');
    else params.delete('tab');
    const next = params.toString();
    return next ? `${path}?${next}` : path;
  })();
  const [title, setTitle] = useState('');
  const [groupName, setGroupName] = useState('');
  // false = "ไม่นับคะแนน": students still see the score; the grade book lists it without adding it to the total / percent.
  const [countsTowardGrade, setCountsTowardGrade] = useState(true);
  /** Quiz: students unticked per classroom (empty = everyone in it takes the quiz). */
  const [excludedByClass, setExcludedByClass] = useState<Record<string, string[]>>({});
  const [rosters, setRosters] = useState<Record<string, User[]>>({});
  const [pickingClassId, setPickingClassId] = useState<string | null>(null);
  const [existingGroups, setExistingGroups] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(() => daysFromNowAt(7, 23, 59));
  /** Homework "ปิดรับส่งงาน" (optional): '' = LATE_WINDOW_HOURS after the due date. */
  const [closeAt, setCloseAt] = useState('');
  // Quiz: minutes students get once it is published (the deadline follows the publish time).
  const [quizMinutes, setQuizMinutes] = useState(String(DEFAULT_QUIZ_MINUTES));
  // The edited quiz's minutes as loaded: unchanged, its saved deadline is kept as is.
  const [loadedQuizMinutes, setLoadedQuizMinutes] = useState<string | null>(null);
  // Release: now, or kept as a draft that only the teacher publishes, by hand.
  const [releaseMode, setReleaseMode] = useState<'now' | 'draft'>('draft');
  const saveAsDraft = releaseMode === 'draft';
  const [trackReleaseToggle, releaseIndicator] = useSlidingIndicator(releaseMode);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  // Already visible to students: the release time can no longer be changed.
  const editIsPublished = !!editingAssignment && (!editingAssignment.publish_at || new Date(editingAssignment.publish_at).getTime() <= clock);
  const quizMinutesValue = Math.floor(Number(quizMinutes));
  const quizMinutesValid = quizMinutesValue >= 1 && quizMinutesValue <= MAX_QUIZ_MINUTES;
  // When the quiz clock starts: its publish time (null for a draft: when the teacher publishes it).
  const quizStartMs = (now: number) =>
    editIsPublished && editingAssignment
      ? Date.parse(editingAssignment.publish_at || editingAssignment.created_at || '') || now
      : saveAsDraft
      ? null
      : now;
  /** The deadline saved with the work: a quiz's is its start + minutes (a draft's is a placeholder, reset when published). */
  const effectiveDueDate = (now: number) => {
    if (!isExam) return dueDate;
    // Same minutes from the same start: the saved deadline stays (older quizzes may not be start + minutes exactly).
    if (editingAssignment?.is_exam && loadedQuizMinutes === quizMinutes && editIsPublished) return editingAssignment.due_date;
    return new Date((quizStartMs(now) ?? now) + quizMinutesValue * 60000).toISOString();
  };

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
  const [questions, setQuestions] = useState<QuestionDraft[]>(() => [blankQuestion(isSurveyMode ? 'multiple_choice' : 'short_answer')]);

  /** Homework / quiz / survey. Survey questions are a set of their own, so switching keeps both. */
  const pickMode = (mode: 'homework' | 'quiz' | 'survey') => {
    if (retake || mode === workMode) return;
    if ((mode === 'survey') !== isSurveyMode) {
      const parked = parkedQuestionsRef.current;
      parkedQuestionsRef.current = questions;
      setQuestions(parked || [blankQuestion(mode === 'survey' ? 'multiple_choice' : 'short_answer')]);
    }
    setIsExam(mode === 'quiz');
    setIsSurveyMode(mode === 'survey');
  };

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

        // Opened from the dashboard (no classroom in the URL): the teacher picks the course and
        // classroom ("กรุณาเลือก..."). From a classroom: that classroom and its course.
        // Edit / copy / template / retake fill these themselves below.
        if (!urlClassroomId) {
          setSelectedCourseId('');
          setSelectedClassroomIds([]);
        } else if (crs.length > 0) {
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
              : cachedCall(`assignmentSource:${sourceId}`, teacherId, () => dataService.getAssignmentById(sourceId!)),
            editId
              ? cachedCall(`assignmentSubs:${editId}`, teacherId, () => dataService.getSubmissionsByAssignmentIds([editId], { includeStudents: false }))
              : Promise.resolve([]),
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
          setIsExam(!!assignment.is_exam && !assignment.is_survey);
          setIsSurveyMode(!!assignment.is_survey);
          // A quiz for chosen students (not a retake): the others start unticked once the roster loads.
          setExcludedByClass(
            editId && isRetake(assignment) && !isRetakeOf(assignment)
              ? { [assignment.classroom_id]: [`__keep:${(assignment.retake_student_ids || []).join(',')}`] }
              : {}
          );
          setTitle(assignment.title || '');
          setGroupName(assignment.group_name || '');
          setCountsTowardGrade(assignment.counts_toward_grade !== false);
          setDescription(assignment.description || '');
          // A copy can't start with a deadline that has already passed.
          const dueMs = assignment.due_date ? new Date(assignment.due_date).getTime() : NaN;
          setDueDate(assignment.due_date && (editId || dueMs > Date.now()) ? assignment.due_date : daysFromNowAt(7, 23, 59));
          // A copy follows its new due date (the default 24 hours after); an edit keeps its own.
          setCloseAt(editId && assignment.close_at ? assignment.close_at : '');
          if (assignment.is_exam) {
            const minutes = String(quizMinutesOf(assignment));
            setQuizMinutes(minutes);
            setLoadedQuizMinutes(editId ? minutes : null);
          }
          // A copy of work students already see is released right away too.
          setReleaseMode(isAssignmentDraft(assignment) ? 'draft' : 'now');
          setAttachments(assignmentAttachments(assignment).map((a) => ({ ...a, uid: newQuestionUid() })));
          // Older homework kept a separate note about its reference; it now lives in the instructions.
          const legacyNote = assignment.sample_work_description?.trim();
          if (legacyNote && !(assignment.description || '').includes(legacyNote)) {
            setDescription([assignment.description?.trim(), legacyNote].filter(Boolean).join('\n\n'));
          }
          if (editId) {
            originalQuestionIdsRef.current = savedQuestions.map((q) => q.id);
            originalQuestionsRef.current = savedQuestions;
          }
          if (editId && siblingKey) {
            const loadedSiblings = await Promise.all(siblingKey.split(',').map((id) => dataService.getAssignmentById(id).catch(() => null)));
            // Retakes are per classroom and never edited along.
            setSiblings(loadedSiblings.flatMap((sib) => (sib?.assignment && !isRetake(sib.assignment) ? [{ assignment: sib.assignment, questions: sib.questions }] : [])));
          } else {
            setSiblings([]);
          }
          if (savedQuestions.length) {
            setQuestions(savedQuestions.map((q) => {
              const options = q.type === 'multiple_choice' || q.type === 'checkboxes'
                ? (q.options || []).length >= MIN_OPTIONS ? [...(q.options || [])] : [...(q.options || []), '', '', '', ''].slice(0, 4)
                : ['', '', '', ''];
              // The editor marks the correct choice by exact text, but older or imported keys may be
              // "ตอบ ข", a letter, or the text with stray tabs: point them at the option they mean.
              const keyIndex = q.type === 'multiple_choice' ? matchChoiceOption(q.ideal_answer, q.options) : -1;
              const tf = q.type === 'true_false' ? parseTrueFalse(q.ideal_answer) : null;
              const idealAnswer = keyIndex >= 0
                ? options[keyIndex]
                : tf !== null
                ? (tf ? 'ถูก' : 'ผิด')
                : q.ideal_answer || '';
              return {
              uid: newQuestionUid(),
              // A copy gets new questions of its own.
              id: editId ? q.id : undefined,
              // Shared work comes without indicators: the teacher picks them.
              indicator_id: templateToken
                ? ''
                : targetCourseId !== courseId ? remapIndicatorId(q.indicator_id || '', sourceCourse, targetCourse) : q.indicator_id || '',
              type: q.type,
              question_text: q.question_text || '',
              options,
              ideal_answer: idealAnswer,
              rubric_criteria: q.rubric_criteria || '',
              max_score: nonNegativeScore(q.max_score) || defaultMaxScore(q.type),
              is_required: q.is_required !== false,
              };
            }));
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
            // No "สอบซ่อม" in the title: the system labels retakes itself (pills, posts, LINE).
            setTitle(source.title);
            setGroupName(source.group_name || '');
            setReleaseMode('now');
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
  }, [urlClassroomId, editId, copyId, templateToken, siblingKey, isReuse, retakeOfParam, clerkUser?.id]);

  // Groups already used in the selected classrooms, offered as one-tap choices.
  // Fetched once per classroom (cached here), not again when switching back and forth.
  const selectedClassroomKey = selectedClassroomIds.join(',');
  const groupsByClassRef = useRef<Record<string, string[]>>({});
  useEffect(() => {
    const ids = selectedClassroomKey ? selectedClassroomKey.split(',') : [];
    if (!ids.length) return;
    const cache = groupsByClassRef.current;
    const show = () => {
      const names = new Set(ids.flatMap((id) => cache[id] || []));
      setExistingGroups([...names].sort((a, b) => a.localeCompare(b, 'th')));
    };
    const missing = ids.filter((id) => !cache[id]);
    if (!missing.length) {
      show();
      return;
    }
    let cancelled = false;
    dataService
      .getAssignmentsByClassroomIds(missing)
      .then((list) => {
        for (const id of missing) cache[id] = [];
        for (const a of list) {
          const name = a.group_name?.trim();
          if (name && cache[a.classroom_id] && !cache[a.classroom_id].includes(name)) cache[a.classroom_id].push(name);
        }
        if (!cancelled) show();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedClassroomKey]);

  // Quiz: each selected classroom's roster, for "who takes it" (loaded once per classroom).
  useEffect(() => {
    if (!isExam || retake) return;
    const ids = selectedClassroomKey ? selectedClassroomKey.split(',') : [];
    const missing = ids.filter((id) => !rosters[id]);
    if (!missing.length) return;
    let cancelled = false;
    Promise.all(missing.map((id) => dataService.getClassroomRoster(id).then((r) => [id, r.students || []] as const).catch(() => [id, [] as User[]] as const))).then((loaded) => {
      if (cancelled) return;
      setRosters((prev) => ({ ...prev, ...Object.fromEntries(loaded) }));
      // An edited quiz's saved list: everyone not on it starts unticked.
      setExcludedByClass((prev) => {
        const next = { ...prev };
        for (const [id, students] of loaded) {
          const keep = next[id]?.[0]?.startsWith('__keep:') ? new Set(next[id][0].slice(7).split(',')) : null;
          if (keep) next[id] = students.filter((st) => !keep.has(st.id) && !(st.line_uid && keep.has(st.line_uid))).map((st) => st.id);
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rosters is a cache filled here
  }, [isExam, retake, selectedClassroomKey]);
  /** Roster ids who take the quiz in a classroom, or null for everyone. */
  const chosenStudentIds = (classId: string): string[] | null => {
    const roster = rosters[classId];
    const out = (excludedByClass[classId] || []).filter((id) => !id.startsWith('__keep:'));
    if (!isExam || retake || !roster?.length || !out.length) return null;
    return roster.filter((st) => !out.includes(st.id)).map((st) => st.id);
  };

  const handleCourseChange = (courseId: string) => {
    if (editingAssignment || retake) return; // an edit (or a retake) stays in its own classroom
    setSelectedCourseId(courseId);
    // Keep the classroom if it belongs to the new course; a course with one classroom picks it; else the teacher chooses.
    const matchingClasses = classrooms.filter((c) => c.course_id === courseId);
    setSelectedClassroomIds((prev) =>
      prev[0] && matchingClasses.some((c) => c.id === prev[0]) ? prev : matchingClasses.length === 1 ? [matchingClasses[0].id] : []
    );
    // Update available indicators for the newly-selected course
    const previous = courses.find((c) => c.id === selectedCourseId);
    const course = courses.find((c) => c.id === courseId);
    setCourseIndicators(course?.indicators || []);
    // Each question keeps the same indicator where the new course has it, else the one at the same position.
    if (course && ((course.indicators || []).length > 0 || (course.lesson_plans || []).length > 0)) {
      setQuestions((prev) => prev.map((q) => ({ ...q, indicator_id: remapIndicatorId(q.indicator_id, previous, course) })));
    }
  };

  /** One classroom per work (an edit or a retake stays in its own). */
  const selectClassroom = (classId: string) => {
    if (editingAssignment || retake || !classId) return;
    setSelectedClassroomIds([classId]);
    // Picked before the course: the course follows the classroom.
    const courseId = classrooms.find((c) => c.id === classId)?.course_id;
    if (courseId && courseId !== selectedCourseId && courses.some((c) => c.id === courseId)) handleCourseChange(courseId);
  };

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
    setQuestions((prev) => [
      ...prev,
      {
        uid: newQuestionUid(),
        // No default: the teacher picks the indicator / lesson plan.
        indicator_id: '',
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

  /** File questions whose model answer and rubric fields were opened (written questions always show them). */
  const [openRubrics, setOpenRubrics] = useState<string[]>([]);

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

  /** Removes one choice (never below MIN_OPTIONS); the key goes with it if it was the correct one. */
  const handleRemoveOption = (qIndex: number, optIndex: number) => {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIndex || q.options.length <= MIN_OPTIONS) return q;
        const removed = q.options[optIndex];
        return { ...q, options: q.options.filter((_, j) => j !== optIndex), ideal_answer: removed.trim() && q.ideal_answer === removed ? '' : q.ideal_answer };
      })
    );
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
    if (isExam && !quizMinutesValid) {
      alert(tr(`กรุณาระบุเวลาทำข้อสอบ 1–${MAX_QUIZ_MINUTES} นาที`, `Enter a quiz time of 1–${MAX_QUIZ_MINUTES} minutes`));
      document.getElementById('quiz-minutes')?.focus();
      return;
    }
    const dueDate = effectiveDueDate(clockNow());
    // An edit may keep a deadline that has already passed; only a new one must be ahead.
    const dueChanged = !editingAssignment || new Date(dueDate).getTime() !== new Date(editingAssignment.due_date).getTime();
    if (dueChanged && dueDate && new Date(dueDate).getTime() <= clockNow()) {
      alert(
        isExam
          ? tr('เวลาทำข้อสอบนับจากเวลาที่เผยแพร่ไปแล้ว — เพิ่มจำนวนนาทีเพื่อให้ยังปิดรับในอนาคต', 'The quiz time counts from when it was published and would already be over — add more minutes')
          : language === 'th' ? 'กำหนดส่งต้องเป็นเวลาในอนาคต' : 'The due date must be in the future'
      );
      return;
    }
    if (!isExam && closeAt && dueDate && new Date(closeAt).getTime() < new Date(dueDate).getTime()) {
      alert(language === 'th' ? 'เวลาปิดรับส่งงานต้องไม่ก่อนกำหนดส่ง' : 'Closing time cannot be before the due date');
      return;
    }
    const fileInQuiz = isExam ? questions.findIndex((q) => q.type === 'file_upload') : -1;
    if (fileInQuiz !== -1) {
      // Switching changes deadline and reference-file settings, so the teacher checks them before saving.
      if (offerHomeworkMode(language === 'th' ? `ข้อที่ ${fileInQuiz + 1} เป็นคำถามแบบแนบไฟล์ / ถ่ายรูป` : `Question ${fileInQuiz + 1} asks for a file / photo`)) {
        alert(language === 'th' ? 'เปลี่ยนเป็นโหมดการบ้านแล้ว ตรวจสอบกำหนดส่ง แล้วกดบันทึกอีกครั้ง' : 'Switched to homework mode. Check the deadline, then save again.');
      } else {
        alert(language === 'th' ? `กรุณาเปลี่ยนประเภทคำถามข้อที่ ${fileInQuiz + 1} ก่อนบันทึกแบบทดสอบ` : `Change the type of question ${fileInQuiz + 1} before saving the quiz.`);
      }
      return;
    }
    if (isExam && !retake && selectedClassroomIds.some((id) => chosenStudentIds(id)?.length === 0)) {
      alert(tr('เลือกนักเรียนที่ทำแบบทดสอบอย่างน้อย 1 คน', 'Choose at least one student to take the quiz'));
      return;
    }
    if (isSurveyMode) {
      const problem = surveyProblem(questions);
      if (problem) {
        alert(problem);
        return;
      }
    }
    const incompleteChoice = questions.findIndex(
      (q) => hasOptions(q.type) && q.options.filter((opt) => opt.trim()).length < 2
    );
    if (incompleteChoice !== -1) {
      alert(
        language === 'th'
          ? `ข้อที่ ${incompleteChoice + 1}: กรุณากรอกตัวเลือกอย่างน้อย 2 ตัวเลือก`
          : `Question ${incompleteChoice + 1}: please fill in at least 2 options`
      );
      return;
    }

    // A survey has no answer keys.
    const noAnswerKey = questions
      .map((q, i) => ({ q, n: i + 1 }))
      .filter(({ q }) => !isSurveyMode &&
        q.type === 'multiple_choice'
          ? !q.options.some((opt) => opt.trim() && opt === q.ideal_answer)
          : q.type === 'true_false' && parseTrueFalse(q.ideal_answer) === null
      );
    // Published or scheduled work needs every key (it would auto-score 0 for everyone); a draft may wait.
    const publishing = editIsPublished || !saveAsDraft;
    if (noAnswerKey.length && publishing) {
      alert(
        language === 'th'
          ? `ข้อ ${noAnswerKey.map((x) => x.n).join(', ')} ยังไม่ได้เลือกคำตอบที่ถูกต้อง กรุณาเลือกคำตอบก่อนเผยแพร่\n(หรือบันทึกเป็นฉบับร่างไว้ก่อน)`
          : `Question ${noAnswerKey.map((x) => x.n).join(', ')} has no correct answer selected. Pick one before publishing (or save it as a draft).`
      );
      document.getElementById(`question-${noAnswerKey[0].n - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    setIsSubmitting(true);
    try {
      const primaryClassId = selectedClassroomIds[0];
      if (courses.length > 0 && !selectedCourseId) {
        alert(language === 'th' ? 'กรุณาเลือกรายวิชาก่อนสร้างงาน' : 'Please choose a course first');
        return;
      }
      if (!primaryClassId) {
        alert(language === 'th' ? 'กรุณาเลือกห้องเรียนก่อนสร้างงาน' : 'Please choose a classroom first');
        return;
      }
      // One copy per selected classroom (each gets its own timeline post and LINE message).
      const targetClassIds = selectedClassroomIds.length ? selectedClassroomIds : [primaryClassId];
      const selectedCourse = courses.find((course) => course.id === selectedCourseId);
      // Every graded question names its indicator / lesson plan (surveys have none).
      const indicatorProblem = isSurveyMode ? null : missingIndicatorMessage(questions, indicatorChoicesFor(selectedCourse, indicators, language === 'th' ? 'th' : 'en'));
      if (indicatorProblem) {
        alert(indicatorProblem);
        const first = questions.findIndex((q) => !q.indicator_id);
        document.getElementById(`question-${Math.max(0, first)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      // "ไม่นับคะแนน" is for homework only: a quiz always counts, a survey never.
      const countsNow = !isSurveyMode && (isExam || countsTowardGrade);
      const totalPoints = isSurveyMode ? 0 : questions.reduce((acc, q) => acc + (nonNegativeScore(q.max_score) || defaultMaxScore(q.type)), 0);

      const questionRows = questions.map((q) => ({
        type: q.type,
        question_text: q.question_text || 'คำถามข้อนี้',
        ...(isSurveyMode ? {} : { indicator_id: q.indicator_id }),
        options: hasOptions(q.type) ? q.options.map((opt) => opt.trim()).filter(Boolean) : q.type === 'true_false' ? [...TRUE_FALSE_OPTIONS] : undefined,
        ideal_answer: q.type === 'true_false'
          ? (parseTrueFalse(q.ideal_answer) === null ? '' : parseTrueFalse(q.ideal_answer) ? 'ถูก' : 'ผิด')
          : q.ideal_answer,
        // Choice and true/false are scored from the key alone.
        rubric_criteria: q.type === 'multiple_choice' || q.type === 'true_false' ? '' : q.rubric_criteria,
        max_score: isSurveyMode ? 0 : nonNegativeScore(q.max_score) || defaultMaxScore(q.type),
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
        if (
          siblings.length &&
          !confirm(
            tr(
              `บันทึกการแก้ไขนี้ไปยังทุกห้อง (${siblings.length + 1} ห้อง)?\nถ้าจะแก้เฉพาะห้องเดียว ให้กลับไปแก้จากแถวของห้องนั้น`,
              `Save these changes to every class (${siblings.length + 1})?\nTo change one class only, edit it from that class's row.`
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
          ...(retake || isSurveyMode || countsNow === (editingAssignment.counts_toward_grade !== false) ? {} : { counts_toward_grade: countsNow }),
          due_date: dueDate || editingAssignment.due_date,
          close_at: isExam ? null : closeAt || null,
          ...(isExam ? { quiz_duration_minutes: quizMinutesValue } : editingAssignment.quiz_duration_minutes ? { quiz_duration_minutes: null } : {}),
          ...(!editIsPublished && saveAsDraft ? { publish_at: DRAFT_PUBLISH_AT } : {}),
          total_points: totalPoints,
          attachments: savedAttachments,
          ...(retake
            ? { retake_student_ids: retake.ids }
            : isExam && rosters[editingAssignment.classroom_id]
            ? { retake_student_ids: chosenStudentIds(editingAssignment.classroom_id) }
            : !isExam && isRetake(editingAssignment)
            ? { retake_student_ids: null }
            : {}),
        });
        await dataService.replaceAssignmentQuestions(id, questionRows.map((row, index) => ({ ...row, id: questions[index].id })));
        // Was scheduled or a draft, teacher switched to "publish now".
        if (!editIsPublished && releaseMode === 'now') await dataService.publishAssignmentNow(id);
        // The same work in other classrooms: only what was changed here, and
        // each copy keeps its own question ids (so its students' answers stay).
        if (siblings.length) {
          const before = editingAssignment;
          const changed: Partial<Assignment> = { total_points: totalPoints, attachments: savedAttachments };
          if (title !== before.title) changed.title = title;
          if (groupName.trim() !== (before.group_name || '')) changed.group_name = groupName.trim();
          if (description !== (before.description || '')) changed.description = description;
          if (dueDate && new Date(dueDate).getTime() !== new Date(before.due_date).getTime()) changed.due_date = dueDate;
          if ((isExam ? null : closeAt || null) !== (before.close_at || null)) changed.close_at = isExam ? null : closeAt || null;
          if (isExam !== !!before.is_exam) changed.is_exam = isExam;
          if (!retake && !isSurveyMode && countsNow !== (before.counts_toward_grade !== false)) changed.counts_toward_grade = countsNow;
          if (isExam && quizMinutesValue !== Number(before.quiz_duration_minutes)) changed.quiz_duration_minutes = quizMinutesValue;
          const sameQuestion = (a: Pick<Question, 'type' | 'question_text'>, b: Pick<Question, 'type' | 'question_text'>) =>
            a.type === b.type && (a.question_text || '').trim() === (b.question_text || '').trim();
          for (const sib of siblings) {
            await dataService.updateAssignment(sib.assignment.id, changed);
            const used = new Set<string>();
            const rows = questionRows.map((row, index) => {
              const original = originalQuestionsRef.current.find((q) => q.id === questions[index].id);
              if (!original) return row;
              const position = originalQuestionsRef.current.indexOf(original);
              const match =
                sib.questions.find((q) => !used.has(q.id) && sameQuestion(q, original)) ||
                (sib.questions[position] && !used.has(sib.questions[position].id) ? sib.questions[position] : undefined);
              if (!match) return row;
              used.add(match.id);
              return { ...row, id: match.id };
            });
            await dataService.replaceAssignmentQuestions(sib.assignment.id, rows);
          }
        }
        alert(
          !editIsPublished && saveAsDraft
            ? language === 'th' ? 'บันทึกฉบับร่างแล้ว นักเรียนยังไม่เห็นงานนี้' : 'Draft saved. Students cannot see it yet.'
            : siblings.length
            ? tr(`บันทึกการแก้ไขแล้ว (${siblings.length + 1} ห้อง)`, `Changes saved in ${siblings.length + 1} classes`)
            : language === 'th' ? 'บันทึกการแก้ไขเรียบร้อยแล้ว' : 'Changes saved'
        );
        router.push(returnTo || (isFromDashboard ? '/dashboard' : `/classrooms/${editingAssignment.classroom_id}?tab=classwork`));
        return;
      }

      const createdIds: string[] = [];
      // Classes whose LINE group did not get the announcement (a share popup opens for each).
      let lineUnsent = 0;
      // Classes where the teacher posts the work card (the bot answers the shared link).
      let lineCards = 0;
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
            ...(isSurveyMode ? { is_survey: true } : !retake && !countsNow ? { counts_toward_grade: false } : {}),
            due_date: dueDate || daysFromNowAt(7, 23, 59),
            ...(!isExam && closeAt ? { close_at: closeAt } : {}),
            ...(isExam ? { quiz_duration_minutes: quizMinutesValue } : {}),
            publish_at: saveAsDraft ? DRAFT_PUBLISH_AT : undefined,
            total_points: totalPoints,
            status_override: 'auto',
            attachments: savedAttachments,
            ...(retake?.source
              ? { retake_of: retake.source.id, retake_student_ids: retake.ids }
              : chosenStudentIds(classId)
              ? { retake_student_ids: chosenStudentIds(classId)! }
              : {}),
          },
          questionRows
        );
        createdIds.push(created.assignment.id);
        // 'card' is not a failure: the popup asks the teacher to post the work card.
        if (created.line === 'card') lineCards += 1;
        else if (isUnsent(created.line)) lineUnsent += 1;
      }

      const copiedTo = copySource && !retake
        ? tr('คัดลอกไปยัง: ', 'Copied to: ') + targetClassIds.map((id) => classrooms.find((c) => c.id === id)?.name || id).join(', ') + '\n\n'
        : '';
      alert(
        copiedTo + (saveAsDraft
          ? language === 'th'
            ? `บันทึกฉบับร่างแล้ว • นักเรียนยังไม่เห็นจนกว่าจะกด "เผยแพร่ตอนนี้"\nลบอัตโนมัติถ้าไม่เผยแพร่ใน ${DRAFT_RETENTION_DAYS} วัน`
            : `Draft saved • hidden until you press "Publish now"\nDeleted if not published within ${DRAFT_RETENTION_DAYS} days`
          : retake
          ? selectedClassroomsLineReady && !lineUnsent && lineCards
            ? tr(`สร้างข้อสอบซ่อมแล้ว · เปิดได้เฉพาะ ${retake.ids.length} คนที่เลือก`, `Retake created · only the ${retake.ids.length} chosen students can open it`)
            : selectedClassroomsLineReady && !lineUnsent
            ? tr(`สร้างข้อสอบซ่อมแล้ว · ส่งลิงก์เข้ากลุ่ม LINE แล้ว\nเปิดได้เฉพาะ ${retake.ids.length} คนที่เลือก`, `Retake created · link sent to the LINE group\nOnly the ${retake.ids.length} chosen students can open it`)
            : tr(`สร้างข้อสอบซ่อมแล้ว · เปิดได้เฉพาะ ${retake.ids.length} คนที่เลือก\nห้องนี้ยังไม่เชื่อม LINE จึงต้องส่งลิงก์เอง`, `Retake created · only the ${retake.ids.length} chosen students can open it\nThis class has no LINE group, so share the link yourself`)
          : isExam
          ? (language === 'th' ? 'สร้างแบบทดสอบสำเร็จ!' : 'Quiz created successfully!')
          : isSurveyMode
          ? tr('สร้างกิจกรรมแล้ว', 'Activity created')
          : (language === 'th' ? 'สร้างการบ้านสำเร็จ!' : 'Assignment created successfully!')) +
        (lineUnsent
          ? tr(
              `\n\n⚠️ ส่งประกาศเข้ากลุ่ม LINE ไม่ได้${lineUnsent > 1 ? ` (${lineUnsent} ห้อง)` : ''} — กด “แชร์ไป LINE” ในหน้าต่างถัดไปเพื่อส่งจาก LINE ของคุณครูเอง`,
              `\n\n⚠️ The LINE announcement could not be sent${lineUnsent > 1 ? ` (${lineUnsent} classes)` : ''}. Use “Share to LINE” in the next window to send it from your own LINE.`
            )
          : '') +
        (lineCards
          ? tr(
              `\n\n📌 ขั้นต่อไป: กด “โพสต์เข้ากลุ่ม” ในหน้าต่างถัดไป แล้วเลือกกลุ่ม LINE ของห้อง บอทจะตอบด้วยการ์ดงาน (ไม่ใช้โควตาข้อความ)`,
              `\n\n📌 Next: tap “Post to group” in the next window and pick the class LINE group. The bot answers with the work card (no message quota).`
            )
          : '')
      );

      const targetClassId = primaryClassId || urlClassroomId || selectedClassroomIds[0];
      if (copySource && !retake) {
        // Back to where the copy was started (the source classroom or the grading hub).
        router.push(returnTo || `/classrooms/${urlClassroomId || targetClassId}?tab=classwork`);
      } else if (returnTo) {
        router.push(returnTo);
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

  // Classroom choices: only the selected course's classrooms (none until a course is picked).
  const selectedCourse = courses.find((c) => c.id === selectedCourseId);
  const currentCourseClassrooms = selectedCourseId
    ? classrooms.filter((c) => c.course_id === selectedCourseId || (!c.course_id && selectedCourse?.classroom_ids?.includes(c.id)))
    : [];
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
        kicker={tr('สอบซ่อม · เฉพาะคนที่เลือก', 'Retake · chosen students only')}
        title={retake.source ? tr(`จาก ${retake.source.title}`, `Of ${retake.source.title}`) : tr('ข้อสอบเดิมถูกลบแล้ว', 'Original quiz deleted')}
        meta={selectedClassroomsLineReady ? tr('ส่งลิงก์เข้ากลุ่ม LINE เมื่อบันทึก', 'Link sent to LINE on save') : tr('ห้องนี้ยังไม่เชื่อม LINE', 'This class has no LINE group')}
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

  // Opening an existing work (edit / copy / template / retake): placeholders until it is filled
  // in, so the teacher never starts typing into an empty form that is about to be replaced.
  if (loading && (editId || copyId || templateToken || retakeOfParam)) {
    return <PageSkeleton variant="form" label={language === 'th' ? 'กำลังโหลดข้อมูลงาน…' : 'Loading the work…'} />;
  }

  // Back to where the form was opened from (the work list: on the tab of what is being made).
  const goBack = () => {
    if (returnTo) router.push(returnTo);
    else if (isFromDashboard) router.push('/dashboard');
    else {
      const targetId = urlClassroomId || selectedClassroomIds[0];
      router.push(targetId ? `/classrooms/${targetId}?tab=classwork` : '/dashboard');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6 pb-24">
      {/* Dynamic Back Button based on entry source */}
      <div>
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1.5 sm:gap-2 max-w-full px-3 sm:px-3.5 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:border-amber-300 hover:text-amber-700 dark:hover:text-amber-400 transition-all shadow-xs cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="truncate">
            {returnTo?.startsWith('/works') ? tr('กลับไปรายการงาน', 'Back to work') : returnTo ? tr('กลับไปตรวจงาน', 'Back to grading') : isFromDashboard ? tr('กลับแดชบอร์ด', 'Dashboard') : tr('กลับไปห้องเรียน', 'Back to class')}
          </span>
        </button>
      </div>

      {/* Page Header */}
      <div>
        <h1 className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          {retake
            ? editId ? tr('แก้ไขข้อสอบซ่อม', 'Edit retake quiz') : tr('สร้างข้อสอบซ่อม', 'New retake quiz')
            : editId
            ? (language === 'th' ? 'แก้ไขงาน / ข้อสอบ' : 'Edit assignment / quiz')
            : isReuse
            ? tr('สร้างงานใหม่จากงานเดิม', 'New work from earlier work')
            : templateToken
            ? tr('สร้างงานจากเทมเพลต', 'New work from a template')
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
                ? tr('กำลังแก้ไขงาน', 'Editing')
                : tr('กำลังแก้ไขงาน (ยังไม่เผยแพร่)', 'Editing (not released)')}
              title={editingAssignment.title || tr('(ไม่มีชื่อ)', '(untitled)')}
              meta={
                siblings.length
                  ? tr(
                      `ใช้กับทุกห้อง: ${[where, ...siblings.map((sib) => classrooms.find((c) => c.id === sib.assignment.classroom_id)?.name || sib.assignment.classroom_name || '')].filter(Boolean).join(', ')}`,
                      `Applies to every class: ${[where, ...siblings.map((sib) => classrooms.find((c) => c.id === sib.assignment.classroom_id)?.name || sib.assignment.classroom_name || '')].filter(Boolean).join(', ')}`
                    )
                  : where
                  ? tr(`ในห้อง ${where}`, `In ${where}`)
                  : undefined
              }
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
              {siblings.length > 0 && (
                <p className="px-3 py-2 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-[11px] font-bold text-amber-900 dark:text-amber-200">
                  {tr(
                    `บันทึกแล้วเปลี่ยนทุกห้อง (${siblings.length + 1} ห้อง)`,
                    `Saving updates all ${siblings.length + 1} classes`
                  )}
                </p>
              )}
              {editSubmissionCount > 0 && (
                <p className="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                  {tr(`ส่งแล้ว ${editSubmissionCount} คน · ลบข้อแล้วคำตอบข้อนั้นหาย`, `${editSubmissionCount} submitted · removing a question deletes its answers`)}
                </p>
              )}
            </WorkContextBanner>
          );
        })()}
      </div>

      <form onSubmit={handleSubmit} onInputCapture={() => setFormTouched(true)} className="space-y-5 sm:space-y-8">
        {/* Mode Selector Toggle: Assignment vs Exam. Sticky under the navbar so the mode can be
            switched from anywhere on a long form; the highlight slides between the two buttons. */}
        <div className="sticky top-[calc(4rem+env(safe-area-inset-top)+0.5rem)] z-20 p-1.5 rounded-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between gap-4">
          <div
            ref={trackModeToggle}
            role="radiogroup"
            aria-label={language === 'th' ? 'ประเภทงาน' : 'Work type'}
            className="relative grid grid-cols-3 gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80 w-full lg:w-auto"
          >
            {modeIndicator && (
              <span
                aria-hidden
                className={`absolute top-0 left-0 rounded-xl shadow-md transition-[transform,width,height,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isExam ? 'bg-purple-600 shadow-purple-500/25' : isSurveyMode ? 'bg-sky-600 shadow-sky-500/25' : 'bg-emerald-600 shadow-emerald-500/25'
                }`}
                style={indicatorStyle(modeIndicator)}
              />
            )}
            {([
              { mode: 'homework', icon: BookOpen, short: language === 'th' ? 'การบ้าน' : 'Homework', label: t('assignment_creator.mode_assignment'), pill: 'bg-emerald-600' },
              { mode: 'quiz', icon: ShieldAlert, short: language === 'th' ? 'ข้อสอบ' : 'Quiz', label: t('assignment_creator.mode_exam'), pill: 'bg-purple-600' },
              { mode: 'survey', icon: ClipboardList, short: language === 'th' ? 'กิจกรรม' : 'Activity', label: language === 'th' ? 'กิจกรรม' : 'Activity', pill: 'bg-sky-600' },
            ] as const).map((option) => {
              const Icon = option.icon;
              const selected = workMode === option.mode;
              // A retake stays a quiz; saved work can't turn into a survey or back.
              const locked = retake
                ? option.mode !== 'quiz'
                : !!editingAssignment && (option.mode === 'survey') !== !!editingAssignment.is_survey;
              return (
                <button
                  key={option.mode}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-active={selected}
                  onClick={() => pickMode(option.mode)}
                  disabled={locked}
                  className={`relative lg:min-w-36 px-2 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors duration-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
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

        {/* Basic Assignment Details */}
        <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
            {/* Parent Course Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                <MobileText short={language === 'th' ? 'รายวิชา' : 'Course'} full={t('assignment_creator.fields.parent_course')} /> *
              </label>
              <select
                value={selectedCourseId}
                disabled={!!editingAssignment}
                onChange={(e) => handleCourseChange(e.target.value)}
                className="w-full px-3 sm:px-3.5 py-2 sm:py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="" disabled>{language === 'th' ? 'กรุณาเลือกรายวิชา...' : 'Please select a course...'}</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code} - {course.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Target classroom (one) */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                <MobileText short={language === 'th' ? 'ห้องเรียน' : 'Classroom'} full={t('assignment_creator.fields.classroom_label')} /> *
              </label>
              <select
                value={selectedClassroomIds[0] || ''}
                disabled={!!editingAssignment || !!retake || !selectedCourseId}
                onChange={(e) => selectClassroom(e.target.value)}
                className="w-full px-3 sm:px-3.5 py-2 sm:py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <option value="" disabled>
                  {!selectedCourseId
                    ? tr('กรุณาเลือกรายวิชาก่อน', 'Choose a course first')
                    : currentCourseClassrooms.length
                    ? tr('กรุณาเลือกห้องเรียน...', 'Please select a classroom...')
                    : tr('รายวิชานี้ยังไม่มีห้องเรียน', 'This course has no classrooms yet')}
                </option>
                {(editingAssignment || retake ? classrooms.filter((c) => c.id === selectedClassroomIds[0]) : currentCourseClassrooms).map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                    {copySource?.classroom_id === cls.id ? ` ${tr('(ต้นฉบับ)', '(original)')}` : ''}
                  </option>
                ))}
              </select>
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
                className="w-full px-3 sm:px-4 h-9 sm:h-10 py-0 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-medium focus:outline-hidden focus:border-amber-500"
              />
            </div>

            {/* Full width when the grading choice beside it is hidden (quiz / retake). */}
            <div className={`space-y-2 ${isExam || retake || isSurveyMode ? 'md:col-span-2' : ''}`}>
              <label htmlFor="assignment-group" className="block text-xs font-bold text-slate-700 dark:text-slate-300">{tr('หมวดหมู่', 'Category')}</label>
              <input
                id="assignment-group"
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={existingGroups.length ? tr('เลือกด้านล่าง หรือพิมพ์ชื่อใหม่', 'Pick below or type a new name') : isExam ? tr('เช่น สอบกลางภาค', 'e.g. Midterm') : tr('เช่น ใบงานบทที่ 1', 'e.g. Chapter 1 worksheet')}
                className="w-full px-3 sm:px-4 h-9 sm:h-10 py-0 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500"
              />
              {existingGroups.length > 0 && (
                <div className="space-y-1.5">
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

            {/* Counts toward the grade: homework only (a quiz always counts, a survey never). Phones get a dropdown. */}
            {!retake && !isExam && !isSurveyMode && (
              <div className="space-y-2">
                <label htmlFor="assignment-counts" className="block text-xs font-bold text-slate-700 dark:text-slate-300">{tr('การนับคะแนน', 'Grading')}</label>
                <select
                  id="assignment-counts"
                  value={countsTowardGrade ? 'counts' : 'not'}
                  onChange={(e) => setCountsTowardGrade(e.target.value === 'counts')}
                  className="sm:hidden w-full h-9 px-3 py-0 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                >
                  <option value="counts">{tr('นับคะแนน', 'Counts')}</option>
                  <option value="not">{tr('ไม่นับคะแนน', "Doesn't count")}</option>
                </select>
                {/* Same fixed height (h-10), border and background as the category box beside it, so the Thai font can't make them differ. */}
                <div className="relative hidden sm:grid grid-cols-2 h-10 p-[3px] rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  {/* The pill slides under the picked choice. */}
                  <span
                    aria-hidden
                    className={`absolute top-[3px] bottom-[3px] left-[3px] w-[calc(50%-3px)] rounded-[9px] shadow-xs transition-[translate,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                      countsTowardGrade ? 'translate-x-0 bg-amber-500' : 'translate-x-full bg-slate-200 dark:bg-slate-600'
                    }`}
                  />
                  {([
                    [true, tr('นับคะแนน', 'Counts')],
                    [false, tr('ไม่นับคะแนน', "Doesn't count")],
                  ] as const).map(([value, label]) => (
                    <button
                      key={String(value)}
                      type="button"
                      aria-pressed={countsTowardGrade === value}
                      onClick={() => setCountsTowardGrade(value)}
                      className={`relative z-10 rounded-lg text-xs font-bold transition-colors duration-300 cursor-pointer ${
                        countsTowardGrade === value
                          ? value ? 'text-slate-950' : 'text-slate-950 dark:text-white'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {t('assignment_creator.fields.description_label')}
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('assignment_creator.fields.description_placeholder')}
                className="w-full px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 leading-relaxed"
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
              </div>
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
                        className="flex flex-row items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 sm:py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors active:scale-95"
                      >
                        <Link2 className="w-4 h-4 text-sky-600" />
                        <span>{tr('ลิงก์', 'Link')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openLinkDialog('drive')}
                        className="flex flex-row items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 sm:py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors active:scale-95"
                      >
                        <GoogleDriveMark className="w-4 h-4" />
                        <span>Google Drive</span>
                      </button>
                      <label
                        className={`flex flex-row items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-2 sm:py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors active:scale-95 ${
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
                      ? tr(`สูงสุด ${MAX_ASSIGNMENT_ATTACHMENTS} รายการ · รูป ≤5MB, PDF ≤10MB`, `Up to ${MAX_ASSIGNMENT_ATTACHMENTS} · images ≤5MB, PDF ≤10MB`)
                      : tr(`แนบครบ ${MAX_ASSIGNMENT_ATTACHMENTS} รายการแล้ว`, `All ${MAX_ASSIGNMENT_ATTACHMENTS} slots used`)}
                                  {isExam && (
                  <span className="hidden sm:inline-block text-[11px] text-purple-600 dark:text-purple-300 ml-4">
                    {tr('การเปิดลิงก์นับเป็นการออกจากหน้าจอ', 'Opening a link counts as leaving the quiz')}
                  </span>
              )}
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
              <div ref={trackReleaseToggle} className="relative grid grid-cols-2 gap-2" role="radiogroup">
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
                    hint: language === 'th' ? 'ยังไม่เผยแพร่ ครูกดเผยแพร่ภายหลัง' : 'Not released; you publish it later',
                    text: 'text-white dark:text-slate-900',
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
              <Collapse open={saveAsDraft}>
                <div className="pt-2">
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-dashed border-slate-300 dark:border-slate-600 space-y-1.5 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                  <p className="flex items-start gap-1.5">
                    <FilePen className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500" />
                    <span>
                      {tr('ซ่อนจากนักเรียนจนกว่าจะเผยแพร่', 'Hidden until published')}
                    </span>
                  </p>
                  <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400 font-bold">
                    <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      {(() => {
                        const expires = editingAssignment && isAssignmentDraft(editingAssignment) ? draftExpiresAt(editingAssignment) : null;
                        if (expires) {
                          return language === 'th'
                            ? `ลบ ${formatDateTime(expires, language)} หากไม่เผยแพร่`
                            : `Deleted ${formatDateTime(expires, language)} unless published`;
                        }
                        return tr(`ลบหากไม่เผยแพร่ใน ${DRAFT_RETENTION_DAYS} วัน`, `Deleted if not published in ${DRAFT_RETENTION_DAYS} days`);
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

            {/* Due Date (homework) / minutes to do it after publishing (quiz) */}
            {isExam ? (
            <div className="space-y-2">
              <label htmlFor="quiz-minutes" className="text-xs font-bold text-slate-700 dark:text-slate-300 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Clock className="w-3.5 h-3.5 text-amber-500 self-center" />{tr('เวลาทำข้อสอบ', 'Quiz time')}</span>
                <span className="text-[11px] font-semibold text-slate-400 whitespace-nowrap">{tr('(นับจากเผยแพร่)', '(from publishing)')}</span>
              </label>
              {/* The minutes box first, its shortcuts below: both the same width at every size. */}
              <div className="w-full max-w-sm space-y-2">
              <div className="relative">
                <input
                  id="quiz-minutes"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_QUIZ_MINUTES}
                  step={1}
                  value={quizMinutes}
                  onChange={(e) => setQuizMinutes(e.target.value)}
                  aria-invalid={!quizMinutesValid}
                  className={`w-full pl-3.5 pr-14 py-2.5 rounded-xl border text-sm font-bold bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 ${
                    quizMinutesValid ? 'border-slate-200 dark:border-slate-700' : 'border-rose-400 dark:border-rose-600'
                  }`}
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">{tr('นาที', 'min')}</span>
              </div>
              {/* Shortcuts: always two even rows, as wide as the box above. */}
              <div className="grid grid-cols-4 gap-1.5">
                {QUIZ_MINUTE_PRESETS.map((minutes) => {
                  const active = quizMinutesValue === minutes;
                  return (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => setQuizMinutes(String(minutes))}
                      aria-pressed={active}
                      className={`px-1 py-1.5 rounded-lg border text-[11px] font-bold whitespace-nowrap text-center transition-colors cursor-pointer ${
                        active
                          ? 'bg-amber-500 border-amber-500 text-slate-950'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-400'
                      }`}
                    >
                      {minutes >= 60 && minutes % 60 === 0 ? tr(`${minutes / 60} ชม.`, `${minutes / 60} h`) : tr(`${minutes} นาที`, `${minutes} min`)}
                    </button>
                  );
                })}
              </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {(() => {
                  if (!quizMinutesValid) return tr(`ระบุ 1–${MAX_QUIZ_MINUTES} นาที`, `Enter 1–${MAX_QUIZ_MINUTES} minutes`);
                  const start = quizStartMs(clock);
                  if (start === null) return tr('เริ่มนับเวลาเมื่อเผยแพร่', 'Starts when published');
                  return tr(
                    `ปิดรับ ${formatDateTime(effectiveDueDate(clock), 'th')}`,
                    `Closes ${formatDateTime(effectiveDueDate(clock), 'en')}`
                  );
                })()}
              </p>
              {/* Who takes it: everyone by default; untick some in the popup (per classroom). */}
              {!retake && (
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 pt-1">
                  {selectedClassroomIds.filter((id) => rosters[id]?.length).map((id) => (
                    <span key={id} className="flex flex-col gap-1 sm:w-auto">
                      {selectedClassroomIds.length > 1 && <span className="text-[11px] font-bold text-slate-500">{classrooms.find((c) => c.id === id)?.name}</span>}
                      <StudentPickLink
                        total={rosters[id].length}
                        excludedCount={(excludedByClass[id] || []).filter((x) => rosters[id].some((st) => st.id === x)).length}
                        onClick={() => setPickingClassId(id)}
                      />
                    </span>
                  ))}
                </div>
              )}
              {pickingClassId && rosters[pickingClassId] && (
                <StudentPickerSheet
                  students={rosters[pickingClassId]}
                  excluded={(excludedByClass[pickingClassId] || []).filter((x) => !x.startsWith('__keep:'))}
                  onChange={(ids) => setExcludedByClass((prev) => ({ ...prev, [pickingClassId]: ids }))}
                  onClose={() => setPickingClassId(null)}
                  title={selectedClassroomIds.length > 1 ? tr(`นักเรียนที่ทำ · ${classrooms.find((c) => c.id === pickingClassId)?.name || ''}`, `Who takes it · ${classrooms.find((c) => c.id === pickingClassId)?.name || ''}`) : undefined}
                />
              )}
            </div>
            ) : (
            // Due date and "ปิดรับส่งงาน" side by side across the form's two columns; stacked on small screens.
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-x-8">
            <div className="space-y-2 min-w-0 rounded-2xl p-3 sm:p-4 bg-amber-100/70 border border-amber-300 dark:bg-amber-500/15 dark:border-amber-400/50">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-500" />
                <span><MobileText short={language === 'th' ? 'กำหนดส่ง' : 'Due'} full={t('assignment_creator.fields.due_date_label')} /></span>
              </label>
              <DateTimeField value={dueDate} onChange={setDueDate} presets="deadline" />
            </div>
            <div className="space-y-2 min-w-0 rounded-2xl p-3 sm:p-4 bg-rose-100/70 border border-rose-300 dark:bg-rose-500/15 dark:border-rose-400/50">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-rose-500" />
                <span>
                  {tr('ปิดรับส่งงาน', 'Stop accepting work')}{' '}
                  <span className="font-normal text-slate-400">{tr('(ไม่บังคับ)', '(optional)')}</span>
                </span>
              </label>
              <DateTimeField
                value={closeAt}
                onChange={setCloseAt}
                presets="deadline"
                allowEmpty
                emptyHint={
                  dueDate
                    ? tr(
                        `ค่าเริ่มต้น: ${LATE_WINDOW_HOURS} ชม. หลังกำหนดส่ง (${formatDateTime(new Date(new Date(dueDate).getTime() + LATE_WINDOW_HOURS * 3600_000).toISOString(), 'th')})`,
                        `Default: ${LATE_WINDOW_HOURS}h after the due date (${formatDateTime(new Date(new Date(dueDate).getTime() + LATE_WINDOW_HOURS * 3600_000).toISOString(), 'en')})`
                      )
                    : tr(`ค่าเริ่มต้น: ${LATE_WINDOW_HOURS} ชม. หลังกำหนดส่ง`, `Default: ${LATE_WINDOW_HOURS}h after the due date`)
                }
              />
            </div>
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
                      ? tr('ตั้งค่าแชร์เป็น "ทุกคนที่มีลิงก์"', 'Share as "Anyone with the link"')
                      : tr('เว็บไซต์ วิดีโอ หรือเอกสาร', 'Website, video or document')}
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
                className="w-full px-3 sm:px-3.5 py-2 sm:py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
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
        <div className="space-y-4 sm:space-y-6">
          <div className="flex items-baseline justify-between gap-3 px-1">
            <h2 className="text-sm font-black text-slate-900 dark:text-white">{t('assignment_creator.questions_builder.title')}</h2>
            <span className="shrink-0 text-[11px] font-bold text-slate-500">
              {visibleQuestionCount} {language === 'th' ? 'ข้อ' : 'questions'} · {tr('เต็ม', 'total')} {questions.reduce((sum, q) => sum + (Number(q.max_score) || 0), 0)}
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
                id={`question-${idx}`}
                inert={removing}
                className={`grid last:[&>div]:pb-0 transition-[grid-template-rows,opacity,scale] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  removing ? 'grid-rows-[0fr] opacity-0 scale-[0.97]' : 'grid-rows-[1fr] opacity-100'
                }`}
              >
              <div className={`min-h-0 pb-3 ${removing ? 'overflow-hidden' : ''}`}>
              <div
                ref={idx === questions.length - 1 ? lastQuestionRef : null}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4 relative transition-colors animate-in fade-in slide-in-from-bottom-5 [--tw-duration:320ms]"
              >
                {/* Question Card Header */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-black text-slate-900 dark:text-white">
                    {t('assignment_creator.questions_builder.question_number')} {idx + 1}
                  </span>

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

                    {/* Score (a survey has none) */}
                    {!isSurveyMode && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-slate-500 font-semibold">
                        <MobileText short={language === 'th' ? 'คะแนน' : 'Pts'} full={t('assignment_creator.questions_builder.max_score')} />:
                      </span>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        value={q.max_score}
                        onKeyDown={(e) => {
                          if (e.key === '-' || e.key === 'e' || e.key === 'E') e.preventDefault();
                        }}
                        onChange={(e) =>
                          handleQuestionChange(idx, 'max_score', nonNegativeScore(e.target.value))
                        }
                        className="w-16 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center font-bold text-slate-900 dark:text-white"
                      />
                    </div>
                    )}

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

                <div className={`grid grid-cols-1 gap-4 ${isSurveyMode ? '' : 'md:grid-cols-2'}`}>
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
                      {isSurveyMode ? (
                        SURVEY_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {SURVEY_TYPE_LABEL[type][language === 'th' ? 'th' : 'en']}
                          </option>
                        ))
                      ) : (
                        <>
                          <option value="multiple_choice">
                            {t('assignment_creator.questions_builder.type_multiple_choice')}
                          </option>
                          <option value="short_answer">
                            {t('assignment_creator.questions_builder.type_short_answer')}
                          </option>
                          <option value="true_false">
                            {t('assignment_creator.questions_builder.type_true_false')}
                          </option>
                          <option value="file_upload">
                            {t('assignment_creator.questions_builder.type_file_upload')}
                          </option>
                        </>
                      )}
                    </select>
                  </div>

                  {/* Indicator / lesson plan (required, no default) — from the selected course; a survey has none */}
                  {!isSurveyMode && (
                  <div className="space-y-1.5">
                    {(() => {
                      const selectedCourse = courses.find((c) => c.id === selectedCourseId);
                      const { kind, choices } = indicatorChoicesFor(selectedCourse, indicators, language === 'th' ? 'th' : 'en');
                      const isPlan = kind === 'plan';
                      const picked = choices.some((c) => c.id === q.indicator_id);
                      return (
                        <>
                          <label htmlFor={`question-indicator-${idx}`} className={`block text-xs font-bold ${isPlan ? 'text-violet-700 dark:text-violet-300' : 'text-slate-700 dark:text-slate-300'}`}>
                            {isPlan ? tr('แผนการสอน / สมรรถนะ', 'Lesson plan / competency') : t('assignment_creator.questions_builder.indicator_select')} *
                          </label>
                          {choices.length === 0 ? (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                              {isPlan
                                ? tr('ยังไม่มีแผนการสอนในวิชานี้ — ไปตั้งค่าใน Dashboard ก่อน', 'This course has no lesson plans yet — set them up on the Dashboard first')
                                : tr('ยังไม่มีตัวชี้วัดในวิชานี้ — ไปตั้งค่าใน Dashboard ก่อน', 'This course has no indicators yet — set them up on the Dashboard first')}
                            </p>
                          ) : (
                            <select
                              id={`question-indicator-${idx}`}
                              required
                              value={picked ? q.indicator_id : ''}
                              onChange={(e) => handleQuestionChange(idx, 'indicator_id', e.target.value)}
                              className={`w-full px-3 py-2 rounded-xl border text-xs focus:outline-hidden cursor-pointer ${
                                isPlan
                                  ? 'bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 focus:border-violet-500'
                                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus:border-amber-500'
                              } ${picked ? 'text-slate-900 dark:text-white' : 'text-slate-400'}`}
                            >
                              <option value="" disabled>
                                {isPlan ? tr('กรุณาเลือกแผนการสอน...', 'Please select a lesson plan...') : tr('กรุณาเลือกตัวชี้วัด...', 'Please select an indicator...')}
                              </option>
                              {choices.map((choice) => (
                                <option key={choice.id} value={choice.id} className="text-slate-900 dark:text-white">
                                  {choice.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  )}
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
                    className="w-full px-3 sm:px-3.5 py-2 sm:py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 leading-relaxed font-medium"
                  />
                </div>

                {/* Survey: options to pick from (one, or several for checkboxes), no correct answer */}
                {isSurveyMode && hasOptions(q.type) && (
                  <div className="space-y-2 animate-in fade-in [--tw-duration:280ms]">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">{tr('ตัวเลือก', 'Options')}</label>
                    {q.options.map((opt, optIdx) => (
                      <div key={optIdx} className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className={`w-4 h-4 shrink-0 border-2 border-slate-300 dark:border-slate-600 ${q.type === 'checkboxes' ? 'rounded-[4px]' : 'rounded-full'}`}
                        />
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => handleOptionChange(idx, optIdx, e.target.value)}
                          placeholder={tr(`ตัวเลือก ${optIdx + 1}`, `Option ${optIdx + 1}`)}
                          className="flex-1 px-3 py-1.5 rounded-lg border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                        />
                        {q.options.length > MIN_OPTIONS && (
                          <button
                            type="button"
                            onClick={() => handleRemoveOption(idx, optIdx)}
                            aria-label={tr('ลบตัวเลือกนี้', 'Remove this option')}
                            className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {q.options.length < MAX_OPTIONS && (
                      <button
                        type="button"
                        onClick={() => handleQuestionChange(idx, 'options', [...q.options, ''])}
                        className="ml-6 inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-sky-600 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {tr('เพิ่มตัวเลือก', 'Add option')}
                      </button>
                    )}
                  </div>
                )}

                {/* Survey scale: students pick 1 (lowest) to 5 (highest) */}
                {isSurveyMode && q.type === 'scale' && (
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 animate-in fade-in [--tw-duration:280ms]">
                    <span>{tr('น้อย', 'Low')}</span>
                    {SCALE_POINTS.map((point) => (
                      <span key={point} className="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 flex items-center justify-center text-xs font-bold text-slate-500 dark:text-slate-300">
                        {point}
                      </span>
                    ))}
                    <span>{tr('มาก', 'High')}</span>
                  </div>
                )}

                {/* Multiple Choice Options Builder: tap the circle to mark the correct option */}
                {q.type === 'multiple_choice' && !isSurveyMode && (
                  <div className="space-y-2.5 animate-in fade-in [--tw-duration:280ms]">
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
                            {q.options.length > MIN_OPTIONS && (
                              <button
                                type="button"
                                onClick={() => handleRemoveOption(idx, optIdx)}
                                aria-label={tr('ลบตัวเลือกนี้', 'Remove this option')}
                                className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {q.options.length < MAX_OPTIONS && (
                      <button
                        type="button"
                        onClick={() => handleQuestionChange(idx, 'options', [...q.options, ''])}
                        className="ml-9 inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-amber-600 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {tr('เพิ่มตัวเลือก', 'Add option')}
                      </button>
                    )}
                  </div>
                )}

                {/* True/false: pick the correct answer (auto-scored, no rubric) */}
                {q.type === 'true_false' && (
                  <div className="space-y-2.5 animate-in fade-in [--tw-duration:280ms]">
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

                {/* Ideal Answer & Rubric: always shown for written questions; file questions open them on demand (choices are scored from the key above) */}
                {q.type === 'file_upload' && !isSurveyMode && !(openRubrics.includes(q.uid) || q.ideal_answer.trim() || q.rubric_criteria.trim()) && (
                  <button
                    type="button"
                    onClick={() => setOpenRubrics((prev) => [...prev, q.uid])}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-amber-600 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {tr('แนวคำตอบ / เกณฑ์ให้คะแนน', 'Model answer / rubric')}
                  </button>
                )}
                {!isSurveyMode && q.type !== 'multiple_choice' && q.type !== 'true_false' && (q.type === 'short_answer' || openRubrics.includes(q.uid) || q.ideal_answer.trim() || q.rubric_criteria.trim()) && (
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
          <div className="p-3 sm:p-6 rounded-2xl sm:rounded-3xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 text-center space-y-3">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {tr('เพิ่มคำถาม', 'Add a question')}
            </p>
            {/* Phones: one row (icon above a short label); wider screens: the full labels in a wrapped row. */}
            <div className={`grid ${isSurveyMode ? 'grid-cols-5' : 'grid-cols-4'} gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-2.5`}>
              {(isSurveyMode
                ? SURVEY_TYPES.map((type) => {
                    const label = SURVEY_TYPE_LABEL[type];
                    const short = { multiple_choice: ['ตัวเลือก', 'Choice'], checkboxes: ['หลายข้อ', 'Checks'], scale: ['ระดับ', 'Scale'], short_answer: ['ข้อความ', 'Text'], file_upload: ['ไฟล์', 'File'] }[type];
                    return { type, th: [short[0], label.th], en: [short[1], label.en] } as const;
                  })
                : ([
                    { type: 'multiple_choice', th: ['ปรนัย', 'ปรนัย'], en: ['Choice', 'Multiple Choice'] },
                    { type: 'short_answer', th: ['ข้อความ', 'ข้อความสั้น'], en: ['Text', 'Short Answer'] },
                    { type: 'true_false', th: ['ถูก/ผิด', 'ถูก/ผิด'], en: ['T/F', 'True/False'] },
                    { type: 'file_upload', th: ['ไฟล์', 'อัปโหลดไฟล์'], en: ['File', 'File Upload'] },
                  ] as const)
              ).map((option, i) => {
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
        <div className="sticky bottom-[max(env(safe-area-inset-bottom),0.75rem)] z-20 w-fit ml-auto sm:w-auto sm:ml-0 p-2 sm:p-3 rounded-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200 dark:border-slate-800 shadow-lg shadow-slate-900/5 flex items-center justify-end gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => (returnTo ? goBack() : router.back())}
            className="px-3.5 sm:px-5 py-2 sm:py-2.5 rounded-xl sm:rounded-2xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className={`flex-none justify-center px-4 sm:px-6 py-2.5 rounded-xl sm:rounded-2xl text-xs font-black shadow-lg transition-all duration-300 active:scale-[0.98] flex items-center gap-2 cursor-pointer disabled:opacity-50 border-2 ${
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
                publish: [th ? 'มอบหมายทันที' : 'Publish', t('assignment_creator.buttons.publish')],
              };
              const [short, full] = isSubmitting
                ? isUploadingSample ? labels.uploading : labels.loading
                : saveAsDraft && !editIsPublished
                ? labels.draft
                : editId
                ? !editIsPublished && releaseMode === 'now' ? labels.savePublish : labels.save
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
  return (
    <React.Suspense fallback={<PageSkeleton variant="form" />}>
      <NewAssignmentContent />
    </React.Suspense>
  );
}
