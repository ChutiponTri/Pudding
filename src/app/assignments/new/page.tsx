'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { cachedCall, readCache, TEACHER_DASHBOARD_CACHE_KEY } from '@/lib/cache/sessionCache';
import { Assignment, Course, Classroom, LearningIndicator, CourseLearningIndicator, QuestionType, Question } from '@/types/database';
import { TRUE_FALSE_OPTIONS, parseTrueFalse } from '@/lib/utils/trueFalse';
import { DateTimeField } from '@/components/DateTimeField';
import { Collapse } from '@/components/Collapse';
import { indicatorStyle, useSlidingIndicator } from '@/lib/hooks/useSlidingIndicator';
import { daysFromNowAt, formatDateTime } from '@/lib/utils/datetime';
import { DRAFT_PUBLISH_AT, DRAFT_RETENTION_DAYS, draftExpiresAt, isAssignmentDraft, LATE_WINDOW_HOURS, QUIZ_LATE_GRACE_MINUTES } from '@/lib/utils/assignmentWindow';
import { optimizeImage, UploadError, uploadToStorage } from '@/lib/storage/uploadClient';
import { uploadRejection } from '@/lib/storage/uploadRules';
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
  FileText,
  UploadCloud,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Lock,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';

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

/** Phones get the short text (small screens, little room); from sm up the full one, unchanged. */
function MobileText({ short, full }: { short: React.ReactNode; full: React.ReactNode }) {
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{full}</span>
    </>
  );
}

/** What the chosen mode means, shown next to (desktop) or under (mobile) the mode toggle. */
function ModeHint({ isExam, language }: { isExam: boolean; language: string }) {
  return isExam ? (
    <span className="inline-flex items-start gap-1.5 text-xs leading-relaxed text-purple-700 dark:text-purple-300 font-semibold bg-purple-50 dark:bg-purple-950/60 px-3.5 py-1.5 rounded-full border border-purple-200 dark:border-purple-800">
      <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>
        {language === 'th'
          ? 'โหมดข้อสอบ: บันทึกทุกครั้งที่ออกจากหน้าจอ'
          : 'Exam Mode: every screen exit is logged • no photos or file uploads'}
      </span>
    </span>
  ) : (
    <span className="inline-flex items-start gap-1.5 text-xs leading-relaxed text-emerald-700 dark:text-emerald-300 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-3.5 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-800">
      <Paperclip className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>
        {language === 'th'
          ? 'โหมดการบ้าน: สามารถแนบตัวอย่างและแนวทางการตอบให้นักเรียนได้'
          : 'Assignment Mode: Sample work attachments allowed'}
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

function NewAssignmentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlClassroomId = searchParams.get('classroomId');
  const urlFrom = searchParams.get('from');
  const isFromDashboard = urlFrom === 'dashboard' || (!urlClassroomId && urlFrom !== 'classroom');
  // Opened from the grading hub: go back to the same view (only /grading paths are accepted).
  const returnTo = urlFrom === 'grading' && searchParams.get('returnTo')?.startsWith('/grading') ? searchParams.get('returnTo') : null;
  // ?edit=<assignmentId>: the same form, filled with a saved assignment or quiz.
  const editId = searchParams.get('edit');
  const { user: clerkUser } = useUser();
  const { t, language } = useLanguage();

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
  const [editSubmissionCount, setEditSubmissionCount] = useState(0);
  const originalQuestionIdsRef = useRef<string[]>([]);

  // Form fields
  const [isExam, setIsExam] = useState(false);
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

  // Conditional Sample Work / Guidelines (Assignment Mode only)
  const [sampleWorkTitle, setSampleWorkTitle] = useState("");
  const [sampleWorkUrl, setSampleWorkUrl] = useState("");
  const [sampleWorkFile, setSampleWorkFile] = useState<File | null>(null);
  const [sampleWorkPreviewUrl, setSampleWorkPreviewUrl] = useState("");
  const [sampleWorkDescription, setSampleWorkDescription] = useState("");
  const [isUploadingSample, setIsUploadingSample] = useState(false);
  const [sampleUploadError, setSampleUploadError] = useState<string | null>(null);

  const handleSampleFileSelect = async (picked: File) => {
    setSampleUploadError(null);
    // Large photos are shrunk without visible loss; anything still over the limit should be a link.
    setIsUploadingSample(true);
    const file = await optimizeImage(picked).finally(() => setIsUploadingSample(false));
    const rejection = uploadRejection(file);
    if (rejection) {
      setSampleUploadError(rejection);
      return;
    }
    setSampleWorkFile(file);
    setSampleWorkUrl("");
    setSampleWorkPreviewUrl(URL.createObjectURL(file));
    if (!sampleWorkTitle.trim()) setSampleWorkTitle(file.name.replace(/\.[^/.]+$/, ""));
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

        if (editId) {
          const [{ assignment, questions: savedQuestions }, subs] = await Promise.all([
            dataService.getAssignmentById(editId),
            dataService.getSubmissionsByAssignmentIds([editId], { includeStudents: false }),
          ]);
          if (!assignment) {
            alert(language === 'th' ? 'ไม่พบงานนี้ อาจถูกลบไปแล้ว' : 'This assignment no longer exists');
            router.back();
            return;
          }
          const ownClassroom = cls.find((c) => c.id === assignment.classroom_id);
          const courseId = assignment.course_id || ownClassroom?.course_id || '';
          setEditingAssignment(assignment);
          setEditSubmissionCount(subs.filter((sub) => sub.status !== 'pending').length);
          if (courseId) {
            setSelectedCourseId(courseId);
            setCourseIndicators(crs.find((c) => c.id === courseId)?.indicators || []);
          }
          setSelectedClassroomIds([assignment.classroom_id]);
          setIsExam(!!assignment.is_exam);
          setTitle(assignment.title || '');
          setGroupName(assignment.group_name || '');
          setDescription(assignment.description || '');
          setDueDate(assignment.due_date || daysFromNowAt(7, 23, 59));
          const publishMs = assignment.publish_at ? new Date(assignment.publish_at).getTime() : NaN;
          if (isAssignmentDraft(assignment)) {
            setReleaseMode('draft');
          } else {
            setReleaseMode(!Number.isNaN(publishMs) && publishMs > Date.now() ? 'schedule' : 'now');
            if (assignment.publish_at) setPublishAt(assignment.publish_at);
          }
          // Work saved with several reminders keeps the earliest one.
          setReminderOffset(assignment.reminder_offsets_minutes?.length
            ? Math.max(...assignment.reminder_offsets_minutes)
            : assignment.reminder_offset_minutes || null);
          setSampleWorkTitle(assignment.sample_work_title || '');
          setSampleWorkUrl(assignment.sample_work_url || '');
          setSampleWorkDescription(assignment.sample_work_description || '');
          originalQuestionIdsRef.current = savedQuestions.map((q) => q.id);
          if (savedQuestions.length) {
            setQuestions(savedQuestions.map((q) => ({
              uid: newQuestionUid(),
              id: q.id,
              indicator_id: q.indicator_id || '',
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
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    init(teacherId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per teacher / target
  }, [urlClassroomId, editId, clerkUser?.id]);

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
    if (editingAssignment) return; // an edit stays in its own classroom
    setSelectedCourseId(courseId);
    const matchingClasses = classrooms.filter((c) => c.course_id === courseId);
    if (matchingClasses.length > 0) {
      setSelectedClassroomIds([matchingClasses[0].id]);
    }
    // Update available indicators for the newly-selected course
    const course = courses.find((c) => c.id === courseId);
    const indList = course?.indicators || [];
    setCourseIndicators(indList);
    // Reset all question indicator_ids to the first available
    if (indList.length > 0) {
      setQuestions((prev) => prev.map((q) => ({ ...q, indicator_id: indList[0].id })));
    }
  };

  const toggleClassroomSelection = (classId: string) => {
    if (editingAssignment) return;
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert(language === 'th' ? 'กรุณาระบุชื่อการบ้านหรือข้อสอบ' : 'Please provide a title');
      return;
    }
    // An edit may keep a deadline that has already passed; only a new one must be ahead.
    const dueChanged = !editingAssignment || new Date(dueDate).getTime() !== new Date(editingAssignment.due_date).getTime();
    if (dueChanged && dueDate && new Date(dueDate).getTime() <= Date.now()) {
      alert(language === 'th' ? 'กำหนดส่งต้องเป็นเวลาในอนาคต' : 'The due date must be in the future');
      return;
    }
    if (schedulePublish && !editIsPublished) {
      const publishMs = new Date(publishAt).getTime();
      if (!publishAt || Number.isNaN(publishMs) || publishMs <= Date.now()) {
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
      // Upload the reference file first: if it fails, nothing is saved and the
      // teacher sees why (it used to fail silently after the work was created).
      let uploadedSampleUrl: string | undefined;
      if (!isExam && sampleWorkFile) {
        setIsUploadingSample(true);
        try {
          // Straight to storage; a failed earlier save already stored this file, so reuse it.
          const uploaded = await uploadToStorage(sampleWorkFile, {
            assignmentId: editingAssignment?.id || "draft",
            // Already shrunk when the teacher picked it.
            optimized: true,
            onDuplicate: () => "reuse",
          });
          uploadedSampleUrl = uploaded.url;
        } catch (uploadError) {
          console.error("Sample work upload error:", uploadError);
          const message = uploadError instanceof UploadError ? uploadError.message : "อัปโหลดไฟล์ตัวอย่างไม่สำเร็จ";
          setSampleUploadError(message);
          alert(`${message}\n\nยังไม่ได้บันทึกงาน กรุณาแก้ไฟล์แล้วกดบันทึกอีกครั้ง`);
          return;
        } finally {
          setIsUploadingSample(false);
        }
      }
      const sampleUrl = isExam ? '' : uploadedSampleUrl || sampleWorkUrl.trim();

      if (editingAssignment) {
        const keptIds = new Set(questions.map((q) => q.id).filter(Boolean));
        const removedCount = originalQuestionIdsRef.current.filter((id) => !keptIds.has(id)).length;
        if (
          editSubmissionCount > 0 &&
          !confirm(
            `มีนักเรียนส่งงานนี้แล้ว ${editSubmissionCount} คน\n` +
              (removedCount ? `• ข้อที่ลบ (${removedCount} ข้อ) จะลบคำตอบของนักเรียนในข้อนั้นด้วย\n` : '') +
              '• ข้อปรนัย / ถูก-ผิด ที่เปลี่ยนเฉลยหรือคะแนน จะตรวจคำตอบที่ส่งแล้วใหม่อัตโนมัติ (คะแนนที่คุณครูปรับเองรายคนยังคงไว้)\n' +
              '• ข้อเขียน / แนบไฟล์ ที่ตรวจไปแล้ว คะแนนไม่เปลี่ยน\n\nต้องการบันทึกการแก้ไขหรือไม่?'
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
          sample_work_title: isExam ? '' : sampleWorkTitle.trim(),
          sample_work_url: sampleUrl,
          sample_work_description: isExam ? '' : sampleWorkDescription.trim(),
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
            sample_work_title: !isExam ? sampleWorkTitle : undefined,
            sample_work_url: sampleUrl || undefined,
            sample_work_description: !isExam ? sampleWorkDescription : undefined,
          },
          questionRows
        );
        createdIds.push(created.assignment.id);
      }

      alert(
        saveAsDraft
          ? language === 'th'
            ? `บันทึกฉบับร่าง${isExam ? 'แบบทดสอบ' : 'การบ้าน'}แล้ว\nนักเรียนจะยังไม่เห็นงานนี้ จนกว่าคุณครูจะกด "เผยแพร่ตอนนี้" ในหน้างานของห้องเรียน\nฉบับร่างที่ไม่ได้เผยแพร่ภายใน ${DRAFT_RETENTION_DAYS} วันจะถูกลบอัตโนมัติ`
            : `Draft saved. Students won't see it until you press "Publish now" in the classwork list.\nDrafts not published within ${DRAFT_RETENTION_DAYS} days are deleted automatically.`
          : schedulePublish
          ? language === 'th'
            ? `ตั้งเวลาเผยแพร่${isExam ? 'แบบทดสอบ' : 'การบ้าน'}แล้ว: ${formatDateTime(publishAt, 'th')}\nนักเรียนจะเห็นงานและได้รับแจ้งเตือน LINE เมื่อถึงเวลา`
            : `Scheduled for ${formatDateTime(publishAt, 'en')}. Students will see it then.`
          : isExam
          ? (language === 'th' ? 'สร้างแบบทดสอบสำเร็จ!' : 'Quiz created successfully!')
          : !selectedClassroomsLineReady || !effectiveReminderOffsets.length
          ? (language === 'th' ? 'สร้างการบ้านสำเร็จ!' : 'Assignment created successfully!')
          : language === 'th'
          ? 'สร้างการบ้านสำเร็จ! ตั้งเวลาเตือนส่งงานผ่าน LINE เรียบร้อย'
          : 'Assignment created successfully! LINE reminder scheduled.'
      );

      const targetClassId = primaryClassId || urlClassroomId || selectedClassroomIds[0];
      if (targetClassId) {
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
              short={returnTo ? 'กลับไปตรวจงาน' : isFromDashboard ? 'กลับแดชบอร์ด' : 'กลับไปห้องเรียน'}
              full={returnTo ? 'กลับไปหน้าตรวจงาน' : isFromDashboard ? 'กลับสู่แดชบอร์ด (Dashboard)' : 'กลับไปหน้าห้องเรียน (งานและเนื้อหา)'}
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
          {editId ? (language === 'th' ? 'แก้ไขงาน / ข้อสอบ' : 'Edit assignment / quiz') : t('assignment_creator.title')}
        </h1>
        {editingAssignment && editSubmissionCount > 0 && (
          <p role="status" className="mt-3 p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs font-semibold text-amber-900 dark:text-amber-200">
            <MobileText
              short={language === 'th'
                ? `มีนักเรียนส่งแล้ว ${editSubmissionCount} คน — ลบคำถามแล้วคำตอบข้อนั้นจะหายไป`
                : `${editSubmissionCount} submitted — removing a question deletes its answers.`}
              full={language === 'th'
                ? `มีนักเรียนส่งแล้ว ${editSubmissionCount} คน — แก้ไขได้ทุกส่วน แต่ถ้าลบคำถาม คำตอบของข้อนั้นจะหายไป และคะแนนที่ตรวจแล้วจะไม่คำนวณใหม่`
                : `${editSubmissionCount} students have submitted. Removing a question deletes its answers, and existing scores are not recalculated.`}
            />
          </p>
        )}
        <p className="hidden sm:block text-slate-500 dark:text-slate-400 text-sm mt-1">
          {t('assignment_creator.subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
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
                  onClick={() => setIsExam(option.exam)}
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
              <label htmlFor="assignment-group" className="text-xs font-bold text-slate-700 dark:text-slate-300">หมวดหมู่การแสดงผล</label>
              <input
                id="assignment-group"
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={existingGroups.length ? 'เลือกด้านล่าง หรือพิมพ์ชื่อใหม่' : isExam ? 'เช่น สอบกลางภาค' : 'เช่น ใบงานบทที่ 1'}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs focus:outline-hidden focus:border-amber-500"
              />
              {existingGroups.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">หมวดหมู่ที่มีอยู่แล้ว:</p>
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
                        ? 'ก่อนถึงเวลานี้ นักเรียนจะยังไม่เห็นงานและส่งไม่ได้ เมื่อถึงเวลา งานจะขึ้นในไทม์ไลน์และแจ้งเข้า LINE group อัตโนมัติ'
                        : 'Students cannot see or submit before this time. At this time it appears on the timeline and is announced in the LINE group.'}
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
                          ? 'นักเรียนจะยังไม่เห็นงานนี้และไม่มีการแจ้งเข้า LINE จนกว่าคุณครูจะกด "เผยแพร่ตอนนี้" ในหน้างานของห้องเรียน (หรือกลับมาแก้ไขแล้วเลือก "เผยแพร่ทันที")'
                          : 'Students won\'t see it and nothing is sent to LINE until you press "Publish now" in the classwork list (or edit it and choose "Publish now").'}
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
                      ? `ข้อสอบปิดรับเมื่อถึงเวลานี้ — นักเรียนที่เปิดข้อสอบค้างไว้ยังส่งได้อีก ${QUIZ_LATE_GRACE_MINUTES} นาที (บันทึกว่าส่งช้า) โดยนักเรียนจะไม่เห็นข้อนี้`
                      : `The quiz closes at this time. Sheets already open may still arrive for ${QUIZ_LATE_GRACE_MINUTES} min (marked late); students are not told.`)
                    : (language === 'th'
                      ? `ส่งหลังเวลานี้ได้อีก ${LATE_WINDOW_HOURS} ชม. (บันทึกว่า "ส่งช้า") แล้วปิดรับเอง — ขยายเวลาหรือปิดรับเองได้ภายหลัง`
                      : `Late work is accepted for ${LATE_WINDOW_HOURS}h after this time (marked late), then it closes. You can extend or close it later.`)}
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
                  <p><MobileText short="ห้องนี้ยังไม่ได้เชื่อม LINE Bot" full="ห้องเรียนที่เลือกยังไม่ได้เชื่อมต่อ LINE Bot จึงยังตั้งเวลาทวงงานไม่ได้" /></p>
                  <button type="button" onClick={() => router.push('/dashboard')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold">
                    ไปเชื่อมต่อ LINE Bot <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <p className="hidden sm:block text-[11px] text-slate-500 dark:text-slate-400">
                {selectedClassroomsLineReady
                  ? effectiveReminderOffsets.length
                    ? 'เตือน 1 ครั้งตามเวลาที่เลือก — ระบบจะตรวจรายชื่อนักเรียนที่ยังไม่ส่งงาน แล้วส่งสรุปเข้า LINE group ของห้องเรียน'
                    : reminderSelectValue === 'none'
                    ? 'ไม่ส่งแจ้งเตือนเข้า LINE group สำหรับงานนี้'
                    : 'แสดงเฉพาะเวลาที่ยังทันก่อนกำหนดส่ง — ถ้าเปลี่ยนกำหนดส่งแล้วเวลาที่เลือกไม่ทัน ต้องเลือกใหม่'
                  : 'เมื่อเชื่อมต่อ LINE Bot แล้ว จึงจะสามารถตั้งเวลาและส่งสรุปเข้า LINE group ได้'}
              </p>
            </div>
            )}
          </div>
        </div>

        {/* CONDITIONAL ATTACHMENT COMPONENT: Sample Work / Guidelines */}
        {!isExam ? (
          /* Assignment Mode: Active Sample Work Section */
          <div className="bg-white dark:bg-slate-900 p-4 sm:p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 animate-in fade-in slide-in-from-bottom-5 [--tw-duration:320ms]">
            <div className="flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-0 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400">
                  <Paperclip className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {t('assignment_creator.sample_work.title')}
                  </h3>
                  <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400">
                    {t('assignment_creator.sample_work.subtitle')}
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-xl sm:rounded-full leading-relaxed bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                <span className="sm:hidden">
                  {language === 'th' ? 'แนบไฟล์ ลิงก์ หรือคำแนะนำให้นักเรียนดูได้' : 'Attach a file, link or tips for students'}
                </span>
                <span className="hidden sm:inline">{language === 'th' ? 'เปิดใช้งานสำหรับโหมดการบ้าน' : 'Active for Assignment'}</span>
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('assignment_creator.sample_work.work_title_label')}
                </label>
                <input
                  type="text"
                  value={sampleWorkTitle}
                  onChange={(e) => setSampleWorkTitle(e.target.value)}
                  placeholder={t('assignment_creator.sample_work.work_title_placeholder')}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    <MobileText short={language === 'th' ? 'ลิงก์หรือไฟล์ตัวอย่าง' : 'Link or file'} full={<>{t('assignment_creator.sample_work.work_url_label')} (หรือแนบไฟล์ไว้ชั่วคราว)</>} />
                  </label>
                  {(sampleWorkPreviewUrl || sampleWorkUrl) && (
                    <a
                      href={sampleWorkPreviewUrl || sampleWorkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span><MobileText short="เปิดดู" full="เปิดดูไฟล์ตัวอย่าง" /></span>
                    </a>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    value={sampleWorkUrl}
                    onChange={(e) => setSampleWorkUrl(e.target.value)}
                    placeholder={t('assignment_creator.sample_work.work_url_placeholder')}
                    className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-white focus:outline-hidden focus:border-emerald-500"
                  />

                  {/* Keep the file in browser memory until the assignment is confirmed. */}
                  <label className="shrink-0 cursor-pointer px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-sm flex items-center justify-center gap-2 transition-all active:scale-95">
                    {isUploadingSample ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>กำลังเตรียมไฟล์...</span>
                      </>
                    ) : (
                      <>
                        <UploadCloud className="w-4 h-4" />
                        <span>เลือกไฟล์ตัวอย่าง</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      disabled={isUploadingSample}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void handleSampleFileSelect(file);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>

                {sampleUploadError && (
                  <p className="text-[11px] text-rose-500 font-semibold">{sampleUploadError}</p>
                )}

                {sampleWorkFile && (
                  <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium truncate">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span className="truncate"><MobileText short="แนบไฟล์แล้ว (อัปโหลดตอนบันทึก)" full="แนบไฟล์ไว้ชั่วคราว — จะอัปโหลดหลังกดบันทึกงาน" /></span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSampleWorkFile(null);
                        setSampleWorkUrl("");
                        setSampleWorkPreviewUrl("");
                      }}
                      className="text-slate-400 hover:text-rose-500 text-xs px-1"
                    >
                      ลบ
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  <MobileText short={language === 'th' ? 'คำแนะนำ' : 'Tips'} full={t('assignment_creator.sample_work.work_desc_label')} />
                </label>
                <textarea
                  rows={2}
                  value={sampleWorkDescription}
                  onChange={(e) => setSampleWorkDescription(e.target.value)}
                  placeholder={t('assignment_creator.sample_work.work_desc_placeholder')}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-emerald-500 leading-relaxed"
                />
              </div>
            </div>
          </div>
        ) : (
          /* Exam Mode: Strictly Disabled Notice */
          <div className="bg-slate-50 dark:bg-slate-900/50 p-5 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 flex items-center gap-3.5 animate-in fade-in slide-in-from-bottom-5 [--tw-duration:320ms]">
            <div className="p-2.5 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                <MobileText
                  short={language === 'th' ? 'ข้อสอบแนบตัวอย่างผลงานไม่ได้' : 'No sample work in quizzes'}
                  full={language === 'th' ? 'ปิดการใช้งานตัวอย่างผลงานในโหมดข้อสอบ' : 'Sample Works Disabled in Exam Mode'}
                />
              </h4>
              <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('assignment_creator.sample_work.exam_disabled_notice')}
              </p>
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
                        title={q.is_required ? 'นักเรียนต้องตอบข้อนี้ก่อนส่งงาน' : 'นักเรียนเว้นข้อนี้ได้'}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                          q.is_required
                            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
                            : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        <span className={`w-6 h-3.5 rounded-full relative transition-colors ${q.is_required ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                          <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-all ${q.is_required ? 'left-3' : 'left-0.5'}`} />
                        </span>
                        <span>{q.is_required ? 'จำเป็น' : 'ไม่บังคับ'}</span>
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
                      <option value="short_answer">
                        {t('assignment_creator.questions_builder.type_short_answer')}
                      </option>
                      <option value="multiple_choice">
                        {t('assignment_creator.questions_builder.type_multiple_choice')}
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
                              แผนการสอน / สมรรถนะ
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
                                    return ci ? `สมรรถนะ ${ciIdx + 1}` : null;
                                  })
                                  .filter(Boolean)
                                  .join(', ');
                                return (
                                  <option key={plan.id} value={plan.id}>
                                    แผน {planIdx + 1}: {plan.title.substring(0, 35) || '(ไม่มีชื่อ)'}
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
                              ยังไม่มีตัวชี้วัดในวิชานี้ — ไปตั้งค่าใน Dashboard ก่อน
                            </p>
                          ) : (
                            <select
                              value={q.indicator_id}
                              onChange={(e) => handleQuestionChange(idx, 'indicator_id', e.target.value)}
                              className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                            >
                              {indOptions.map((ind, indIdx) => (
                                <option key={ind.id} value={ind.id}>
                                  ข้อ {indIdx + 1}: {ind.title.substring(0, 50)}{ind.title.length > 50 ? '…' : ''}
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
                            {option === 'ถูก' ? '✓ ถูก' : '✗ ผิด'}
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
                { type: 'short_answer', th: ['ข้อความ', 'ข้อความสั้น'], en: ['Text', 'Short Answer'] },
                { type: 'multiple_choice', th: ['ปรนัย', 'ปรนัย'], en: ['Choice', 'Multiple Choice'] },
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
        <div className="sticky bottom-[max(env(safe-area-inset-bottom),0.75rem)] z-20 p-3 rounded-2xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200 dark:border-slate-800 shadow-lg shadow-slate-900/5 flex items-center justify-end gap-2 sm:gap-3">
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
            className={`flex-1 sm:flex-none justify-center px-6 py-3 sm:py-2.5 rounded-2xl text-sm sm:text-xs font-black shadow-lg transition-all duration-300 active:scale-[0.98] flex items-center gap-2 cursor-pointer disabled:opacity-50 border-2 ${
              saveAsDraft && !editIsPublished
                ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border-dashed border-slate-400 dark:border-slate-500 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-black/5'
                : 'bg-amber-500 hover:bg-amber-600 text-slate-950 border-transparent shadow-amber-500/25'
            }`}
          >
            {/* Re-keyed per release mode so the icon and label swap in with a small rise. */}
            <span
              key={editIsPublished ? 'saved' : releaseMode}
              className="inline-flex items-center gap-2 animate-in fade-in slide-in-from-bottom-1 [--tw-duration:260ms]"
            >
            {saveAsDraft && !editIsPublished
              ? <FilePen className="w-4 h-4 text-slate-500" />
              : schedulePublish && !editIsPublished
              ? <Clock className="w-4 h-4" />
              : <Send className="w-4 h-4" />}
            {/* Phones get a short label so the bar stays balanced; from sm up the full one. */}
            {(() => {
              const th = language === 'th';
              const [short, full] = isSubmitting
                ? isUploadingSample
                  ? [th ? 'กำลังอัปโหลด...' : 'Uploading...', th ? 'กำลังอัปโหลดไฟล์...' : 'Uploading file...']
                  : [t('common.loading'), t('common.loading')]
                : saveAsDraft && !editIsPublished
                ? [th ? 'บันทึกร่าง' : 'Save draft', th ? 'บันทึกฉบับร่าง' : 'Save draft']
                : editId
                ? !editIsPublished && releaseMode === 'now'
                  ? [th ? 'บันทึก+เผยแพร่' : 'Save & publish', th ? 'บันทึกและเผยแพร่' : 'Save & publish']
                  : [th ? 'บันทึก' : 'Save', th ? 'บันทึกการแก้ไข' : 'Save changes']
                : schedulePublish
                ? [th ? 'ตั้งเวลา' : 'Schedule', th ? 'ตั้งเวลาเผยแพร่' : 'Schedule']
                : [th ? 'มอบหมายทันที' : 'Publish', t('assignment_creator.buttons.publish')];
              return (
                <>
                  <span className="sm:hidden">{short}</span>
                  <span className="hidden sm:inline">{full}</span>
                </>
              );
            })()}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewAssignmentPage() {
  return (
    <React.Suspense fallback={<div className="p-8 text-center text-sm text-slate-400">กำลังโหลด...</div>}>
      <NewAssignmentContent />
    </React.Suspense>
  );
}
