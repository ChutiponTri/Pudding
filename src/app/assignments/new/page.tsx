'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { Course, Classroom, LearningIndicator, QuestionType, Question } from '@/types/database';
import {
  PlusCircle,
  Trash2,
  Calendar,
  Clock,
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
} from 'lucide-react';

interface QuestionDraft {
  indicator_id: string;
  type: QuestionType;
  question_text: string;
  options: string[];
  ideal_answer: string;
  rubric_criteria: string;
  max_score: number;
}

export default function NewAssignmentPage() {
  const router = useRouter();
  const { t, language } = useLanguage();

  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [selectedClassroomIds, setSelectedClassroomIds] = useState<string[]>([]);
  const [indicators, setIndicators] = useState<LearningIndicator[]>([]);
  const [loading, setLoading] = useState(true);

  // Form fields
  const [isExam, setIsExam] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [reminderCron, setReminderCron] = useState('0 18 * * *');
  const [cronPreset, setCronPreset] = useState('1d');

  // Conditional Sample Work / Guidelines (Assignment Mode only)
  const [sampleWorkTitle, setSampleWorkTitle] = useState("");
  const [sampleWorkUrl, setSampleWorkUrl] = useState("");
  const [sampleWorkDescription, setSampleWorkDescription] = useState("");
  const [isUploadingSample, setIsUploadingSample] = useState(false);
  const [sampleUploadError, setSampleUploadError] = useState<string | null>(null);

  const handleSampleFileUpload = async (file: File) => {
    setIsUploadingSample(true);
    setSampleUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("assignment_id", "sample-works");
      formData.append("student_id", "teacher-sample");

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json.url) {
        throw new Error(json.error || "Failed to upload to Cloudflare R2");
      }

      setSampleWorkUrl(json.url);
      if (!sampleWorkTitle.trim()) {
        const cleanName = file.name.replace(/\.[^/.]+$/, "");
        setSampleWorkTitle(cleanName);
      }
    } catch (err: any) {
      console.error("R2 sample upload error:", err);
      setSampleUploadError(err.message || "เกิดข้อผิดพลาดในการอัปโหลดไฟล์ขึ้น Cloudflare R2");
    } finally {
      setIsUploadingSample(false);
    }
  };

  // Dynamic Questions
  const [questions, setQuestions] = useState<QuestionDraft[]>([
    {
      indicator_id: '',
      type: 'short_answer',
      question_text: '',
      options: ['ตัวเลือก ก', 'ตัวเลือก ข', 'ตัวเลือก ค', 'ตัวเลือก ง'],
      ideal_answer: '',
      rubric_criteria: '',
      max_score: 5,
    },
  ]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const lastQuestionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const [crs, cls, ind] = await Promise.all([
          dataService.getCourses(),
          dataService.getClassrooms(),
          dataService.getLearningIndicators(),
        ]);
        setCourses(crs);
        setClassrooms(cls);
        setIndicators(ind);

        if (crs.length > 0) {
          setSelectedCourseId(crs[0].id);
          const matchingClasses = cls.filter((c) => c.course_id === crs[0].id);
          setSelectedClassroomIds(matchingClasses.length > 0 ? [matchingClasses[0].id] : [cls[0]?.id || '']);
        } else if (cls.length > 0) {
          setSelectedClassroomIds([cls[0].id]);
        }

        if (ind.length > 0) {
          setQuestions((prev) =>
            prev.map((q) => ({ ...q, indicator_id: ind[0].id }))
          );
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const handleCourseChange = (courseId: string) => {
    setSelectedCourseId(courseId);
    const matchingClasses = classrooms.filter((c) => c.course_id === courseId);
    if (matchingClasses.length > 0) {
      setSelectedClassroomIds([matchingClasses[0].id]);
    }
  };

  const toggleClassroomSelection = (classId: string) => {
    setSelectedClassroomIds((prev) => {
      if (prev.includes(classId)) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter((id) => id !== classId);
      }
      return [...prev, classId];
    });
  };

  const handleCronPresetChange = (preset: string) => {
    setCronPreset(preset);
    if (preset === '1d') {
      setReminderCron('0 18 * * *');
    } else if (preset === '6h') {
      setReminderCron('0 */6 * * *');
    } else if (preset === 'morning') {
      setReminderCron('0 8 * * *');
    }
  };

  const handleAddQuestion = (type: QuestionType = 'short_answer') => {
    setQuestions((prev) => [
      ...prev,
      {
        indicator_id: indicators[0]?.id || '',
        type,
        question_text: '',
        options: ['ตัวเลือก ก', 'ตัวเลือก ข', 'ตัวเลือก ค', 'ตัวเลือก ง'],
        ideal_answer: '',
        rubric_criteria: '',
        max_score: 5,
      },
    ]);

    setTimeout(() => {
      lastQuestionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  };

  const handleRemoveQuestion = (index: number) => {
    if (questions.length <= 1) return;
    setQuestions((prev) => prev.filter((_, i) => i !== index));
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
      const newOpts = [...copy[qIndex].options];
      newOpts[optIndex] = val;
      copy[qIndex].options = newOpts;
      return copy;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      alert(language === 'th' ? 'กรุณาระบุชื่อการบ้านหรือข้อสอบ' : 'Please provide a title');
      return;
    }

    setIsSubmitting(true);
    try {
      const primaryClassId = selectedClassroomIds[0] || classrooms[0]?.id || 'class-401';
      const targetClass = classrooms.find((c) => c.id === primaryClassId);
      const totalPoints = questions.reduce((acc, q) => acc + Number(q.max_score || 0), 0);

      const created = await dataService.createAssignment(
        {
          course_id: selectedCourseId,
          classroom_id: primaryClassId,
          classroom_name: targetClass?.name || 'Classroom',
          title,
          description,
          is_exam: isExam,
          due_date: dueDate || new Date(Date.now() + 7 * 86400000).toISOString(),
          reminder_cron: reminderCron,
          total_points: totalPoints,
          status_override: 'auto',
          sample_work_title: !isExam ? sampleWorkTitle : undefined,
          sample_work_url: !isExam ? sampleWorkUrl : undefined,
          sample_work_description: !isExam ? sampleWorkDescription : undefined,
        },
        questions.map((q) => ({
          type: q.type,
          question_text: q.question_text || 'คำถามข้อนี้',
          indicator_id: q.indicator_id,
          options: q.type === 'multiple_choice' ? q.options : undefined,
          ideal_answer: q.ideal_answer,
          rubric_criteria: q.rubric_criteria,
          max_score: Number(q.max_score) || 5,
        }))
      );

      alert(
        language === 'th'
          ? 'สร้างการบ้าน/แบบทดสอบสำเร็จ! ระบบเชื่อมต่อ LINE Reminder Bot เรียบร้อย'
          : 'Assignment created successfully! LINE Reminder scheduled.'
      );

      router.push(`/assignments/${created.assignment.id}/grading`);
    } catch (err) {
      console.error(err);
      alert('Error creating assignment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentCourseClassrooms = classrooms.filter(
    (c) => !selectedCourseId || c.course_id === selectedCourseId
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-24">
      {/* Page Header */}
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-xs font-bold mb-2">
          <span>{isExam ? '🛡️ ' + t('assignment_creator.mode_exam') : '📚 ' + t('assignment_creator.mode_assignment')}</span>
        </div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          {t('assignment_creator.title')}
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          {t('assignment_creator.subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Mode Selector Toggle: Assignment vs Exam */}
        <div className="p-4 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsExam(false)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-all cursor-pointer ${
                !isExam
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/20'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              📚 {t('assignment_creator.mode_assignment')}
            </button>
            <button
              type="button"
              onClick={() => setIsExam(true)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                isExam
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-500/20'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>{t('assignment_creator.mode_exam')}</span>
            </button>
          </div>

          {isExam ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-purple-700 dark:text-purple-300 font-semibold bg-purple-50 dark:bg-purple-950/60 px-3.5 py-1.5 rounded-full border border-purple-200 dark:border-purple-800">
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {language === 'th'
                  ? 'โหมดข้อสอบ: เฝ้าระวังการสลับหน้าต่าง & ล็อกไฟล์ตัวอย่าง'
                  : 'Exam Mode: Screen monitor active & sample work disabled'}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-3.5 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-800">
              <Paperclip className="w-3.5 h-3.5" />
              <span>
                {language === 'th'
                  ? 'โหมดการบ้าน: สามารถแนบตัวอย่างและแนวทางการตอบให้นักเรียนได้'
                  : 'Assignment Mode: Sample work attachments allowed'}
              </span>
            </span>
          )}
        </div>

        {/* Basic Assignment Details */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-6">
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-amber-500" />
            <span>{language === 'th' ? 'ข้อมูลรายวิชาและการมอบหมาย' : 'Course & Assignment Details'}</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Parent Course Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                {t('assignment_creator.fields.parent_course')} *
              </label>
              <select
                value={selectedCourseId}
                onChange={(e) => handleCourseChange(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
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
                {t('assignment_creator.fields.classroom_label')} *
              </label>
              <div className="flex flex-wrap gap-2 pt-0.5">
                {currentCourseClassrooms.map((cls) => {
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

            {/* Due Date */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-500" />
                <span>{t('assignment_creator.fields.due_date_label')}</span>
              </label>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-medium focus:outline-hidden focus:border-amber-500"
              />
            </div>

            {/* LINE Reminder Cron Setting */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-500" />
                <span>{t('assignment_creator.fields.line_reminder_label')}</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleCronPresetChange('1d')}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center cursor-pointer ${
                    cronPreset === '1d'
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {language === 'th' ? '1 วันก่อนส่ง' : '1 day before submission'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCronPresetChange('6h')}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center cursor-pointer ${
                    cronPreset === '6h'
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {language === 'th' ? '6 ชม. ก่อนส่ง' : '6 hours before submission'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCronPresetChange('morning')}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all text-center cursor-pointer ${
                    cronPreset === 'morning'
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 text-emerald-700 dark:text-emerald-300 font-bold'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {language === 'th' ? 'ทุก 08:00 น.' : 'Every 8:00 AM'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* CONDITIONAL ATTACHMENT COMPONENT: Sample Work / Guidelines */}
        {!isExam ? (
          /* Assignment Mode: Active Sample Work Section */
          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-emerald-200 dark:border-emerald-900/60 shadow-xs space-y-4 animate-in fade-in duration-300">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400">
                  <Paperclip className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {t('assignment_creator.sample_work.title')}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('assignment_creator.sample_work.subtitle')}
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                {language === 'th' ? 'เปิดใช้งานสำหรับโหมดการบ้าน' : 'Active for Assignment'}
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
                    {t('assignment_creator.sample_work.work_url_label')} (หรืออัปโหลดตรงขึ้น Cloudflare R2)
                  </label>
                  {sampleWorkUrl && (
                    <a
                      href={sampleWorkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>เปิดดูไฟล์ตัวอย่าง</span>
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

                  {/* Direct Cloudflare R2 Upload Button */}
                  <label className="shrink-0 cursor-pointer px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/20 flex items-center justify-center gap-2 transition-transform active:scale-95">
                    {isUploadingSample ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>กำลังอัปโหลดขึ้น R2...</span>
                      </>
                    ) : (
                      <>
                        <UploadCloud className="w-4 h-4" />
                        <span>อัปโหลดขึ้น Cloudflare R2</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="application/pdf,image/png,image/jpeg,image/webp"
                      disabled={isUploadingSample}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleSampleFileUpload(file);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>

                {sampleUploadError && (
                  <p className="text-[11px] text-rose-500 font-semibold">{sampleUploadError}</p>
                )}

                {sampleWorkUrl && sampleWorkUrl.includes("r2.dev") && (
                  <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 font-medium truncate">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>บันทึกไฟล์บน Cloudflare R2 เรียบร้อยแล้ว</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSampleWorkUrl("")}
                      className="text-slate-400 hover:text-rose-500 text-xs px-1"
                    >
                      ลบ
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('assignment_creator.sample_work.work_desc_label')}
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
          <div className="bg-slate-50 dark:bg-slate-900/50 p-5 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 flex items-center gap-3.5 animate-in fade-in duration-300">
            <div className="p-2.5 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                {language === 'th' ? 'ปิดการใช้งานตัวอย่างผลงานในโหมดข้อสอบ' : 'Sample Works Disabled in Exam Mode'}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {t('assignment_creator.sample_work.exam_disabled_notice')}
              </p>
            </div>
          </div>
        )}

        {/* Dynamic Questions Builder */}
        <div className="space-y-6">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white">
                {t('assignment_creator.questions_builder.title')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {language === 'th'
                  ? 'กำหนดประเภทข้อสอบ เกณฑ์การประเมิน (Rubric) และตัวชี้วัด'
                  : 'Configure question types, rubric scoring, and standard indicators'}
              </p>
            </div>
            <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              {questions.length} {language === 'th' ? 'ข้อ' : 'Questions'}
            </span>
          </div>

          {/* Questions Stack */}
          <div className="space-y-6">
            {questions.map((q, idx) => (
              <div
                key={idx}
                ref={idx === questions.length - 1 ? lastQuestionRef : null}
                className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 shadow-xs space-y-6 relative transition-all"
              >
                {/* Question Card Header */}
                <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-2xl bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center shadow-xs">
                      {idx + 1}
                    </span>
                    <span className="font-bold text-sm text-slate-900 dark:text-white">
                      {t('assignment_creator.questions_builder.question_number')} {idx + 1}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Score */}
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-slate-500 font-semibold">
                        {t('assignment_creator.questions_builder.max_score')}:
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
                    {questions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveQuestion(idx)}
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
                      onChange={(e) =>
                        handleQuestionChange(idx, 'type', e.target.value as QuestionType)
                      }
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

                  {/* Indicator Select */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {t('assignment_creator.questions_builder.indicator_select')}
                    </label>
                    <select
                      value={q.indicator_id}
                      onChange={(e) => handleQuestionChange(idx, 'indicator_id', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500 cursor-pointer"
                    >
                      {indicators.map((ind) => (
                        <option key={ind.id} value={ind.id}>
                          {ind.code}: {ind.title.substring(0, 48)}...
                        </option>
                      ))}
                    </select>
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

                {/* Multiple Choice Options Builder */}
                {q.type === 'multiple_choice' && (
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {t('assignment_creator.questions_builder.options_label')}
                    </label>
                    <div className="space-y-2">
                      {q.options.map((opt, optIdx) => (
                        <div key={optIdx} className="flex items-center gap-2">
                          <span className="w-6 text-center text-xs font-bold text-slate-400">
                            {String.fromCharCode(65 + optIdx)}
                          </span>
                          <input
                            type="text"
                            value={opt}
                            onChange={(e) => handleOptionChange(idx, optIdx, e.target.value)}
                            className="flex-1 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ideal Answer & Rubric */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              </div>
            ))}
          </div>

          {/* QUESTION ADDER PLACEMENT: AT THE BOTTOM OF THE LAST QUESTION ITEM */}
          <div className="p-6 rounded-3xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 text-center space-y-3">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t('assignment_creator.questions_builder.add_question_hint')}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => handleAddQuestion('short_answer')}
                className="px-4 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition-all shadow-md hover:scale-[1.02] flex items-center gap-1.5 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>{language === 'th' ? 'ข้อความสั้น' : 'Short Answer'}</span>
              </button>

              <button
                type="button"
                onClick={() => handleAddQuestion('multiple_choice')}
                className="px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-700 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>{language === 'th' ? 'ปรนัย' : 'Multiple Choice'}</span>
              </button>

              <button
                type="button"
                onClick={() => handleAddQuestion('file_upload')}
                className="px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-700 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>{language === 'th' ? 'อัปโหลดไฟล์' : 'File Upload'}</span>
              </button>

              <button
                type="button"
                onClick={() => handleAddQuestion('true_false')}
                className="px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-700 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>{language === 'th' ? 'ถูก/ผิด' : 'True/False'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Submit Actions Bar */}
        <div className="pt-4 flex items-center justify-end gap-3">
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
            className="px-6 py-2.5 rounded-2xl bg-slate-950 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-900 dark:hover:bg-slate-100 text-xs font-bold shadow-lg shadow-black/15 transition-all hover:scale-[1.02] flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Send className="w-4 h-4 text-amber-500" />
            <span>{isSubmitting ? t('common.loading') : t('assignment_creator.buttons.publish')}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
