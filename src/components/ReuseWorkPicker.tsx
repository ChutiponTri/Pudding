'use client';

import { useEffect, useMemo, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { ArrowLeft, BookOpen, Check, ChevronRight, Copy, GraduationCap, Loader2, Search, ShieldAlert, X } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { dataService } from '@/lib/supabase/dataService';
import { cachedCall } from '@/lib/cache/sessionCache';
import { useAcademicCalendar } from '@/lib/hooks/useAcademicCalendar';
import { SemesterSelect } from '@/components/SemesterSelect';
import { ALL_SEMESTERS, filterClassroomsBySemester, semesterKeyOf, semesterOptions, type SemesterKey } from '@/lib/utils/semesterFilter';
import { ASSIGNMENT_STATUS_CLASSES, getAssignmentStatus, getAssignmentWindow } from '@/lib/utils/assignmentWindow';
import { formatAcademicPeriod } from '@/lib/utils/academicYear';
import { formatDateTime } from '@/lib/utils/datetime';
import type { Assignment, Classroom } from '@/types/database';

type KindFilter = 'all' | 'homework' | 'quiz';

/**
 * Full-screen picker for "reuse earlier work": choose a classroom (filtered by
 * term, like the dashboard), then any of its assignments or quizzes (drafts,
 * scheduled, open or closed). `onPick` receives the chosen assignment.
 */
export function ReuseWorkPicker({
  targetClassroomId,
  onPick,
  onClose,
}: {
  /** The classroom the new work is for (marked in the list); none from the dashboard. */
  targetClassroomId?: string | null;
  onPick: (assignment: Assignment) => void;
  onClose: () => void;
}) {
  const { user } = useUser();
  const teacherId = user?.id;
  const { tr, language } = useLanguage();
  const { currentPeriod } = useAcademicCalendar();

  const [classrooms, setClassrooms] = useState<Classroom[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [termKey, setTermKey] = useState<SemesterKey>(() => semesterKeyOf(currentPeriod.semester, currentPeriod.yearCE));
  const [classSearch, setClassSearch] = useState('');
  const [source, setSource] = useState<Classroom | null>(null);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [workSearch, setWorkSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');

  // Classrooms (names and terms only), shared with other pages of this tab while fresh.
  useEffect(() => {
    if (!teacherId) return;
    let cancelled = false;
    cachedCall('reuseClassroomList', teacherId, () => dataService.getClassroomList())
      .then((list) => {
        if (!cancelled) setClassrooms(list);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [teacherId]);

  // Assignments of the chosen classroom, every state.
  useEffect(() => {
    if (!source || !teacherId) return;
    let cancelled = false;
    cachedCall(`reuseAssignments:${source.id}`, teacherId, () => dataService.getAssignmentsByClassroomId(source.id))
      .then((list) => {
        if (!cancelled) setAssignments(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setAssignments([]);
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [source, teacherId]);

  // Escape closes; the page behind does not scroll.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const termOptions = useMemo(() => semesterOptions([], classrooms || [], currentPeriod.yearCE), [classrooms, currentPeriod.yearCE]);
  const visibleClassrooms = useMemo(() => {
    const inTerm = filterClassroomsBySemester(classrooms || [], [], termKey, currentPeriod.yearCE);
    const q = classSearch.trim().toLowerCase();
    const matched = q
      ? inTerm.filter((c) => `${c.name} ${c.course_name || ''} ${c.subject_code || ''}`.toLowerCase().includes(q))
      : inTerm;
    // The classroom being created for comes first.
    return [...matched].sort((a, b) => Number(b.id === targetClassroomId) - Number(a.id === targetClassroomId));
  }, [classrooms, termKey, classSearch, currentPeriod.yearCE, targetClassroomId]);

  const visibleAssignments = useMemo(() => {
    const q = workSearch.trim().toLowerCase();
    return (assignments || [])
      .filter((a) => (kind === 'all' ? true : kind === 'quiz' ? !!a.is_exam : !a.is_exam))
      .filter((a) => !q || `${a.title} ${a.group_name || ''}`.toLowerCase().includes(q))
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [assignments, workSearch, kind]);

  const termLabel = (c: Classroom) =>
    c.semester && c.year_ce ? formatAcademicPeriod(c.semester, c.year_ce, language) : c.academic_year || '';

  return (
    <div
      className="fixed inset-0 z-95 flex items-stretch sm:items-center justify-center bg-slate-950/50 backdrop-blur-sm sm:p-6 animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reuse-work-title"
        className="w-full sm:max-w-2xl h-dvh sm:h-[min(88dvh,760px)] flex flex-col bg-white dark:bg-slate-900 sm:rounded-3xl sm:border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
      >
        {/* Header with the two steps */}
        <div className="shrink-0 px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)+1rem)] sm:pt-5 pb-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
          <div className="flex items-start gap-3">
            {source ? (
              <button
                type="button"
                onClick={() => {
                  setSource(null);
                  setWorkSearch('');
                  setKind('all');
                }}
                aria-label={tr('กลับไปเลือกห้องเรียน', 'Back to classrooms')}
                className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <span className="w-9 h-9 shrink-0 rounded-xl bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                <Copy className="w-4 h-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h2 id="reuse-work-title" className="text-base font-black text-slate-900 dark:text-white">
                {tr('ใช้งานเดิมสร้างงานใหม่', 'Reuse earlier work')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {source
                  ? tr(`ขั้นที่ 2: เลือกงานจาก ${source.name}`, `Step 2: pick work from ${source.name}`)
                  : tr('ขั้นที่ 1: เลือกห้องเรียนที่มีงานเดิม', 'Step 1: pick the classroom that has the work')}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={tr('ปิด', 'Close')}
              className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {!source ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <SemesterSelect compact value={termKey} onChange={setTermKey} options={termOptions} currentPeriod={currentPeriod} />
              <SearchField value={classSearch} onChange={setClassSearch} placeholder={tr('ค้นหาห้อง / วิชา', 'Search classroom / course')} />
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2">
              <div role="radiogroup" aria-label={tr('ประเภทงาน', 'Work type')} className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 shrink-0">
                {([
                  ['all', tr('ทั้งหมด', 'All')],
                  ['homework', tr('การบ้าน', 'Homework')],
                  ['quiz', tr('ข้อสอบ', 'Quiz')],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={kind === value}
                    onClick={() => setKind(value)}
                    className={`px-3 h-9 lg:h-7 rounded-lg text-[11px] font-bold cursor-pointer transition-colors ${
                      kind === value ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <SearchField value={workSearch} onChange={setWorkSearch} placeholder={tr('ค้นหาชื่องาน / หมวดหมู่', 'Search title / group')} />
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 sm:px-4 py-3">
          {loadError && (
            <p className="mx-1 mb-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-xs font-semibold text-rose-700 dark:text-rose-300">{loadError}</p>
          )}

          {!source ? (
            classrooms === null ? (
              <LoadingRow label={tr('กำลังโหลดห้องเรียน...', 'Loading classrooms...')} />
            ) : visibleClassrooms.length === 0 ? (
              <EmptyState
                text={classSearch ? tr('ไม่พบห้องที่ค้นหา', 'No classroom matches') : tr('ไม่มีห้องเรียนในภาคเรียนนี้', 'No classrooms in this term')}
                action={termKey !== ALL_SEMESTERS ? { label: tr('ดูทุกภาคเรียน', 'Show all terms'), onClick: () => setTermKey(ALL_SEMESTERS) } : undefined}
              />
            ) : (
              <ul className="space-y-1.5">
                {visibleClassrooms.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setAssignments(null);
                        setSource(c);
                      }}
                      className="w-full p-3 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-sky-300 dark:hover:border-sky-800 hover:bg-sky-50/50 dark:hover:bg-sky-950/20 flex items-center gap-3 text-left cursor-pointer transition-colors"
                    >
                      <span className="w-9 h-9 shrink-0 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                        <GraduationCap className="w-4 h-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{c.name}</span>
                          {c.id === targetClassroomId && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                              {tr('ห้องนี้', 'This class')}
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {[c.subject_code, c.course_name].filter(Boolean).join(' · ') || tr('ไม่ระบุวิชา', 'No course')}
                          {termKey === ALL_SEMESTERS && termLabel(c) ? ` · ${termLabel(c)}` : ''}
                        </span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : assignments === null ? (
            <LoadingRow label={tr('กำลังโหลดงาน...', 'Loading work...')} />
          ) : visibleAssignments.length === 0 ? (
            <EmptyState
              text={assignments.length === 0 ? tr('ห้องนี้ยังไม่มีงานหรือข้อสอบ', 'This classroom has no work yet') : tr('ไม่พบงานที่ค้นหา', 'No work matches')}
            />
          ) : (
            <ul className="space-y-1.5">
              {visibleAssignments.map((a) => {
                const status = getAssignmentStatus(getAssignmentWindow(a), a.is_exam, language === 'th' ? 'th' : 'en');
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => onPick(a)}
                      className="group w-full p-3 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-sky-300 dark:hover:border-sky-800 hover:bg-sky-50/50 dark:hover:bg-sky-950/20 flex items-center gap-3 text-left cursor-pointer transition-colors"
                    >
                      <span
                        className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${
                          a.is_exam ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                        }`}
                        title={a.is_exam ? tr('ข้อสอบ', 'Quiz') : tr('การบ้าน', 'Homework')}
                      >
                        {a.is_exam ? <ShieldAlert className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-slate-900 dark:text-white truncate">{a.title || tr('(ไม่มีชื่อ)', '(untitled)')}</span>
                        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <span className={`px-1.5 py-px rounded-md border text-[10px] font-bold ${ASSIGNMENT_STATUS_CLASSES[status.tone]}`}>{status.label}</span>
                          <span>{a.is_exam ? tr('ข้อสอบ', 'Quiz') : tr('การบ้าน', 'Homework')}</span>
                          {a.group_name && <span className="truncate max-w-40">· {a.group_name}</span>}
                          {a.created_at && <span>· {tr('สร้าง', 'Created')} {formatDateTime(a.created_at, language)}</span>}
                        </span>
                      </span>
                      <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100 transition-opacity">
                        <Check className="w-3 h-3" />
                        {tr('ใช้งานนี้', 'Use')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="shrink-0 px-4 sm:px-6 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
          {tr(
            'งานที่เลือกจะเปิดเป็นงานใหม่ให้ตรวจและแก้ไขก่อนบันทึก • งานต้นฉบับไม่ถูกเปลี่ยนแปลง',
            'The chosen work opens as new work to review and edit before saving • the original is not changed'
          )}
        </p>
      </div>
    </div>
  );
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative flex items-center min-w-0 flex-1">
      <Search className="w-3.5 h-3.5 absolute left-3 text-slate-400 pointer-events-none" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full h-11 lg:h-9 pl-8 pr-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-hidden focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
      />
    </label>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-400">
      <Loader2 className="w-4 h-4 animate-spin" />
      {label}
    </div>
  );
}

function EmptyState({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="py-12 text-center space-y-2">
      <p className="text-xs text-slate-400">{text}</p>
      {action && (
        <button type="button" onClick={action.onClick} className="text-xs font-bold text-amber-700 dark:text-amber-400 hover:underline cursor-pointer">
          {action.label}
        </button>
      )}
    </div>
  );
}
