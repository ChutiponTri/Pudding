'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Edit2,
  Eye,
  GripVertical,
  ListChecks,
  NotebookPen,
  EyeOff,
  FileText,
  Lock,
  MessageCircle,
  Palette,
  Plus,
  Rocket,
  School,
  Search,
  Share2,
  ShieldAlert,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import type { Assignment } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useTeacherDashboardData, type TeacherDashboardData } from '@/lib/hooks/useTeacherDashboardData';
import { useSemesterParam } from '@/lib/hooks/useSemesterParam';
import { useCollapsedGroups } from '@/lib/hooks/useCollapsedGroups';
import { indicatorStyle, useSlidingIndicator } from '@/lib/hooks/useSlidingIndicator';
import { applySavedOrder, useDragReorder } from '@/lib/hooks/useDragReorder';
import { useWorkPrefs, WORK_COLORS, WORK_COLOR_CLASSES, type WorkColor } from '@/lib/hooks/useWorkPrefs';
import { dataService } from '@/lib/supabase/dataService';
import { SemesterSelect } from '@/components/SemesterSelect';
import { CreateWorkMenu } from '@/components/CreateWorkMenu';
import { Collapse } from '@/components/Collapse';
import { ActionMenu, type ActionMenuItem } from '@/components/works/ActionMenu';
import { DueDateDialog, MetricCells, Pill, ROW_INSET, WorkDetailSheet, WorkRowLayout } from '@/components/works/WorkBits';
import { acceptStatus, BulkStatusDialog, groupStatus, StatusButton } from '@/components/works/StatusBits';
import { AssignmentStatusDialog } from '@/components/AssignmentStatusDialog';
import { formatAcademicPeriod } from '@/lib/utils/academicYear';
import { filterClassroomsBySemester, semesterOptions } from '@/lib/utils/semesterFilter';
import { isRetake } from '@/lib/utils/retake';
import {
  buildWorkGroups,
  type WorkClass,
  type WorkGroup,
} from '@/lib/utils/workGroups';

type Tab = 'homework' | 'quiz';
type LocalEdits = { base: TeacherDashboardData | null; updated: Record<string, Partial<Assignment>>; deleted: string[] };

const NO_EDITS: LocalEdits = { base: null, updated: {}, deleted: [] };

/** 0 not published yet, 1 still being graded, 2 fully graded. */
const workRank = (g: WorkGroup) => (!g.published ? 0 : g.totals.pending === 0 && g.totals.notSubmitted === 0 && g.totals.totalStudents > 0 ? 2 : 1);
/** "<id>~<state>": the saved order entry; a different state means "place it by default again". */
const orderEntry = (g: WorkGroup) =>
  `${g.rep.id}~${workRank(g)}${[...new Set(g.classes.map((c) => (c.published ? (c.assignment.status_override || 'auto')[0] : 'h')))].sort().join('')}`;

/**
 * Every assignment and quiz of the term, across classrooms: one card per work
 * (all its classes together), unfolding to each class. Uses the dashboard's session-cached data, so opening it from the
 * dashboard is instant and it refetches by itself after any change.
 */
export function WorksBoard() {
  const { tr, language } = useLanguage();
  const th = language === 'th';
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { data, loading, error } = useTeacherDashboardData();
  const { semesterKey, setSemesterKey, currentPeriod } = useSemesterParam();
  const prefs = useWorkPrefs();

  // Tab and course live in local state (instant) and are mirrored to the URL
  // without a navigation, so "back" from grading returns to the same view.
  const [tab, setTab] = useState<Tab>(() => (search.get('tab') === 'quiz' ? 'quiz' : 'homework'));
  const [courseFilter, setCourseFilter] = useState(() => search.get('course') || 'all');
  const [query, setQuery] = useState('');
  const [tabDirection, setTabDirection] = useState(0);
  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(key, value);
    else params.delete(key);
    window.history.replaceState(window.history.state, '', `${pathname}?${params}`);
  };
  const selectTab = (next: Tab) => {
    if (next === tab) return;
    setTabDirection(next === 'quiz' ? 1 : -1);
    setTab(next);
    setParam('tab', next === 'quiz' ? 'quiz' : null);
  };
  const selectCourse = (id: string) => {
    setCourseFilter(id);
    setParam('course', id === 'all' ? null : id);
  };
  const [setTabGroup, tabIndicator] = useSlidingIndicator(tab);

  // Works start closed; opening or closing one is remembered for it (this browser).
  const { isOpen: isWorkClosed, toggle: toggleWork } = useCollapsedGroups('works:expanded');
  const isWorkOpen = (key: string) => !isWorkClosed(key);

  // Changes shown before the refetch (which already has them) arrives.
  const [localEdits, setLocalEdits] = useState<LocalEdits>(NO_EDITS);
  const edits = localEdits.base === data ? localEdits : NO_EDITS;
  const patch = (id: string, change: Partial<Assignment> | null) =>
    setLocalEdits((prev) => {
      const cur = prev.base === data ? prev : { ...NO_EDITS, base: data };
      return change
        ? { ...cur, base: data, updated: { ...cur.updated, [id]: { ...(cur.updated[id] || {}), ...change } } }
        : { ...cur, base: data, deleted: [...cur.deleted, id] };
    });

  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);
  const showToast = (text: string) => setToast((prev) => ({ text, at: (prev?.at || 0) + 1 }));
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);
  const [dueTarget, setDueTarget] = useState<{ item: WorkClass; group: WorkGroup } | null>(null);
  const [detail, setDetail] = useState<WorkGroup | null>(null);
  // Status: one class uses the full dialog; a work or a category the bulk one.
  const [statusOne, setStatusOne] = useState<WorkClass | null>(null);
  const [statusMany, setStatusMany] = useState<{ title: string; scope: string; items: WorkClass[] } | null>(null);

  // Ticks every minute so "2 days left" stays true on an open page.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const courses = useMemo(() => data?.courses || [], [data]);
  const classrooms = useMemo(() => data?.classrooms || [], [data]);
  const termOptions = useMemo(() => semesterOptions(courses, classrooms, currentPeriod.yearCE), [courses, classrooms, currentPeriod.yearCE]);
  const termClassrooms = useMemo(
    () => filterClassroomsBySemester(classrooms, courses, semesterKey, currentPeriod.yearCE),
    [classrooms, courses, semesterKey, currentPeriod.yearCE]
  );

  const allGroups = useMemo(() => {
    if (!data) return [];
    const ids = new Set(termClassrooms.map((c) => c.id));
    const assignments = data.assignments
      .filter((a) => ids.has(a.classroom_id) && !edits.deleted.includes(a.id))
      .map((a) => (edits.updated[a.id] ? { ...a, ...edits.updated[a.id] } : a));
    return buildWorkGroups(assignments, termClassrooms, courses, data.submissions, now);
  }, [data, termClassrooms, courses, edits, now]);

  const liveIds = useMemo(() => new Set(allGroups.map((g) => g.rep.id)), [allGroups]);
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const termCourses = useMemo(() => {
    const used = new Set(allGroups.map((g) => g.courseId));
    return courses.filter((c) => used.has(c.id)).sort((a, b) => a.code.localeCompare(b.code));
  }, [allGroups, courses]);
  const activeCourse = termCourses.some((c) => c.id === courseFilter) ? courseFilter : 'all';

  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (g: WorkGroup) =>
      (activeCourse === 'all' || g.courseId === activeCourse) &&
      (!q || g.rep.title.toLowerCase().includes(q) || g.classes.some((c) => c.classroom.name.toLowerCase().includes(q))),
    [activeCourse, q]
  );
  const tabCounts = useMemo(
    () => ({
      homework: allGroups.filter((g) => !g.isExam && matches(g)).length,
      quiz: allGroups.filter((g) => g.isExam && matches(g)).length,
    }),
    [allGroups, matches]
  );
  const tabPending = useMemo(
    () => ({
      homework: allGroups.filter((g) => !g.isExam && matches(g)).reduce((n, g) => n + g.totals.pending, 0),
      quiz: allGroups.filter((g) => g.isExam && matches(g)).reduce((n, g) => n + g.totals.pending, 0),
    }),
    [allGroups, matches]
  );

  // Both tabs are worked out together, so switching tabs only swaps what is shown.
  // The default place of a work: not published yet → still being graded →
  // fully graded (latest deadline first inside each). It only applies to work
  // that is new or whose state just changed (published, closed/reopened,
  // grading finished): the saved order records each work's state, and a work
  // whose state still matches stays exactly where the teacher dragged it.
  const byTab = useMemo(() => {
    const build = (isExam: boolean) => {
      const groups = allGroups
        .filter((g) => g.isExam === isExam && matches(g))
        .sort((a, b) => workRank(a) - workRank(b) || b.lastDeadline - a.lastDeadline || a.rep.title.localeCompare(b.rep.title, 'th'));
      return applySavedOrder(groups, orderEntry, prefs.order, (item, other) => workRank(item) <= workRank(other));
    };
    return { homework: build(false), quiz: build(true) };
  }, [allGroups, matches, prefs.order]);
  const works = byTab[tab];
  const workById = new Map(works.map((g) => [g.rep.id, g]));
  // Dragging only on the full list (not while searching or filtering a course).
  const canDrag = !q && activeCourse === 'all' && works.length > 1;
  const { bindList, bindItem, order: shownOrder, dragKey, itemStyle, handleProps } = useDragReorder(
    works.map((g) => g.rep.id),
    (keys) => prefs.setOrder(keys.map((id) => (workById.has(id) ? orderEntry(workById.get(id)!) : id)))
  );

  // ---------------------------------------------------------------- actions
  const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);
  const returnTo = `${pathname}?${search.toString()}`;
  const gradeHref = (id: string) => `/assignments/${id}/grading?from=works&returnTo=${encodeURIComponent(returnTo)}`;
  /** From the work itself: every class's students together (one class: its own page). */
  const workGradeHref = (g: WorkGroup) => {
    const ids = g.classes.filter((c) => c.published).map((c) => c.assignment.id);
    return ids.length === 1 ? gradeHref(ids[0]) : `/works/grade?ids=${ids.map(encodeURIComponent).join(',')}&returnTo=${encodeURIComponent(returnTo)}`;
  };
  const editorHref = (mode: 'edit' | 'copy', a: Assignment, siblingIds: string[] = []) =>
    `/assignments/new?${mode}=${a.id}&classroomId=${a.classroom_id}${siblingIds.length ? `&siblings=${siblingIds.map(encodeURIComponent).join(',')}` : ''}&from=works&returnTo=${encodeURIComponent(returnTo)}`;

  const publish = async (items: WorkClass[]) => {
    const list = items.filter((c) => !c.published);
    if (!list.length) return;
    const title = list[0].assignment.title;
    const where = list.length > 1 ? tr(` ใน ${list.length} ห้อง`, ` in ${list.length} classes`) : ` · ${list[0].classroom.name}`;
    if (!confirm(tr(`เผยแพร่ "${title}"${where} ตอนนี้?\nนักเรียนจะเห็นทันทีและได้รับแจ้งใน LINE`, `Publish "${title}"${where} now?\nStudents see it at once and get a LINE message.`))) return;
    let done = 0;
    let firstError = '';
    for (const c of list) {
      try {
        const updated = await dataService.publishAssignmentNow(c.assignment.id);
        patch(c.assignment.id, { publish_at: updated?.publish_at || new Date().toISOString() });
        done++;
      } catch (err) {
        firstError ||= errorText(err, tr('เผยแพร่ไม่สำเร็จ', 'Could not publish'));
      }
    }
    showToast(firstError && !done ? firstError : firstError ? tr(`เผยแพร่ ${done}/${list.length} ห้อง · ${firstError}`, `Published ${done}/${list.length} · ${firstError}`) : tr('เผยแพร่แล้ว', 'Published'));
  };

  const setClosed = async (items: WorkClass[], close: boolean) => {
    const list = items.filter((c) => c.published && (close ? c.assignment.status_override !== 'force_closed' : c.assignment.status_override === 'force_closed'));
    if (!list.length) return;
    if (close) {
      const where = list.length > 1 ? tr(`ทั้ง ${list.length} ห้อง`, `in all ${list.length} classes`) : list[0].classroom.name;
      if (!confirm(tr(`ปิดรับ "${list[0].assignment.title}" ${where}?\nนักเรียนจะส่งไม่ได้จนกว่าจะเปิดอีกครั้ง`, `Close "${list[0].assignment.title}" ${where}?\nStudents can't hand in until you reopen it.`))) return;
    }
    let firstError = '';
    await Promise.all(
      list.map(async (c) => {
        try {
          const updated = await dataService.updateAssignmentDeadlineOverride(c.assignment.id, { status_override: close ? 'force_closed' : 'auto' });
          patch(c.assignment.id, { status_override: updated?.status_override || (close ? 'force_closed' : 'auto') });
        } catch (err) {
          firstError ||= errorText(err, tr('บันทึกไม่สำเร็จ', 'Could not save'));
        }
      })
    );
    showToast(firstError || (close ? tr('ปิดรับแล้ว', 'Closed') : tr('เปิดรับอีกครั้งแล้ว', 'Reopened')));
  };

  const remove = async (c: WorkClass) => {
    if (!confirm(tr(`ลบ "${c.assignment.title}" ของห้อง ${c.classroom.name}?\nคำตอบและคะแนนของห้องนี้จะถูกลบด้วย`, `Delete "${c.assignment.title}" for ${c.classroom.name}?\nThis class's answers and scores are deleted too.`))) return;
    try {
      await dataService.deleteAssignment(c.assignment.id);
      patch(c.assignment.id, null);
      showToast(tr('ลบแล้ว', 'Deleted'));
    } catch (err) {
      showToast(errorText(err, tr('ลบไม่สำเร็จ', 'Could not delete')));
    }
  };

  const reannounce = async (c: WorkClass) => {
    if (!confirm(tr(`ส่งลิงก์ "${c.assignment.title}" เข้ากลุ่ม LINE ของ ${c.classroom.name} อีกครั้ง?`, `Post "${c.assignment.title}" to the ${c.classroom.name} LINE group again?`))) return;
    try {
      await dataService.reannounceAssignment(c.assignment.id);
      showToast(tr('ส่งเข้า LINE แล้ว', 'Posted to LINE'));
    } catch (err) {
      showToast(errorText(err, tr('ส่งไม่สำเร็จ', 'Could not post')));
    }
  };

  const saveDue = async (target: WorkClass, group: WorkGroup, due: string, all: boolean) => {
    const list = all ? group.classes : [target];
    for (const c of list) {
      const change: Partial<Assignment> = { due_date: due };
      // An extension would hide the new date; "closed" stays closed.
      if (c.assignment.status_override === 'extended') change.status_override = 'auto';
      await dataService.updateAssignment(c.assignment.id, change);
      patch(c.assignment.id, change);
    }
    showToast(tr('เปลี่ยนกำหนดส่งแล้ว', 'Due date changed'));
  };

  const shareTemplate = async (g: WorkGroup) => {
    try {
      const token = await dataService.getTemplateLink(g.rep.id);
      const url = `${window.location.origin}/assignments/new?template=${encodeURIComponent(token)}`;
      const coarse = window.matchMedia?.('(pointer: coarse)').matches;
      if (coarse && navigator.share) {
        await navigator.share({ title: g.rep.title, url }).catch(() => {});
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast(tr('คัดลอกลิงก์เทมเพลตแล้ว ครูท่านอื่นเปิดแล้วสร้างงานนี้ในห้องตัวเองได้', 'Template link copied. Other teachers can open it to create this work in their classes.'));
    } catch (err) {
      showToast(errorText(err, tr('สร้างลิงก์ไม่สำเร็จ', 'Could not create the link')));
    }
  };

  // ---------------------------------------------------------------- render bits
  const courseLabel = (id: string) => courseById.get(id)?.code || '';
  /** "ท31101 การสื่อสารภาษาไทย · บทที่ 1" — subject, then the classwork category if it has one. */
  const subjectLine = (g: WorkGroup) => {
    const course = courseById.get(g.courseId);
    const parts = [course ? `${course.code} ${course.name}`.trim() : '', g.category.startsWith('__') ? '' : g.category];
    return parts.filter(Boolean).join(' · ');
  };

  const classMenu = (c: WorkClass, g: WorkGroup): ActionMenuItem[] => {
    const lineReady = (c.classroom.line_connection_status || (c.classroom.line_group_id ? 'connected' : '')) === 'connected';
    const closedByTeacher = c.assignment.status_override === 'force_closed';
    return [
      { key: 'status', label: tr('เปลี่ยนสถานะการรับงาน', 'Change status'), icon: <Clock className="w-4 h-4" />, onSelect: () => setStatusOne(c) },
      !c.published && { key: 'publish', label: tr('เผยแพร่ตอนนี้', 'Publish now'), icon: <Rocket className="w-4 h-4" />, onSelect: () => publish([c]) },
      c.published &&
        lineReady && {
          key: 'line',
          label: tr('ประกาศซ้ำใน LINE', 'Post to LINE again'),
          icon: <MessageCircle className="w-4 h-4" />,
          disabled: !c.window.acceptsSubmissions,
          onSelect: () => reannounce(c),
        },
      { key: 'edit', label: tr('แก้ไขเฉพาะห้องนี้', 'Edit this class only'), icon: <Edit2 className="w-4 h-4" />, onSelect: () => router.push(editorHref('edit', c.assignment)) },
      { key: 'due', label: tr('เปลี่ยนกำหนดส่ง', 'Change due date'), icon: <Calendar className="w-4 h-4" />, onSelect: () => setDueTarget({ item: c, group: g }) },
      c.published &&
        (closedByTeacher
          ? { key: 'open', label: tr('เปิดรับอีกครั้ง', 'Reopen'), icon: <Unlock className="w-4 h-4" />, onSelect: () => setClosed([c], false) }
          : { key: 'close', label: tr('ปิดรับงาน', 'Close submissions'), icon: <Lock className="w-4 h-4" />, disabled: !c.window.acceptsSubmissions, onSelect: () => setClosed([c], true) }),
      { key: 'delete', label: tr('ลบ', 'Delete'), icon: <Trash2 className="w-4 h-4" />, danger: true, onSelect: () => remove(c) },
    ].filter(Boolean) as ActionMenuItem[];
  };

  const workMenu = (g: WorkGroup): ActionMenuItem[] => {
    const hidden = g.classes.filter((c) => !c.published);
    const accepting = g.classes.filter((c) => c.published && c.window.acceptsSubmissions);
    const color = prefs.colors[g.rep.id];
    return [
      { key: 'detail', label: tr('ดูรายละเอียด', 'See details'), icon: <Eye className="w-4 h-4" />, onSelect: () => setDetail(g) },
      {
        key: 'status',
        label: g.classes.length > 1 ? tr('เปลี่ยนสถานะทุกห้อง', 'Change status (all classes)') : tr('เปลี่ยนสถานะการรับงาน', 'Change status'),
        hint: g.classes.length > 1 ? tr(`${g.classes.length} ห้อง`, `${g.classes.length}`) : undefined,
        icon: <Clock className="w-4 h-4" />,
        onSelect: () => openWorkStatus(g),
      },
      hidden.length > 0 && {
        key: 'publish',
        label: tr('เผยแพร่', 'Publish'),
        hint: g.classes.length > 1 ? tr(`${hidden.length} ห้อง`, `${hidden.length} classes`) : undefined,
        icon: <Rocket className="w-4 h-4" />,
        onSelect: () => publish(hidden),
      },
      {
        key: 'edit',
        label: g.classes.length > 1 ? tr('แก้ไขทุกห้อง', 'Edit (all classes)') : tr('แก้ไข', 'Edit'),
        hint: g.classes.length > 1 ? tr(`${g.classes.length} ห้อง`, `${g.classes.length}`) : undefined,
        icon: <Edit2 className="w-4 h-4" />,
        onSelect: () => router.push(editorHref('edit', g.rep, g.classes.map((c) => c.assignment.id).filter((id) => id !== g.rep.id))),
      },
      { key: 'copy', label: tr('คัดลอกไปห้องอื่น', 'Copy to classes'), icon: <Copy className="w-4 h-4" />, onSelect: () => router.push(editorHref('copy', g.rep)) },
      !isRetake(g.rep) && { key: 'share', label: tr('แชร์เป็นเทมเพลต', 'Share as template'), icon: <Share2 className="w-4 h-4" />, onSelect: () => shareTemplate(g) },
      {
        key: 'color',
        label: tr('สีการ์ด', 'Card colour'),
        icon: color ? <span className={`w-3 h-3 rounded-full ${WORK_COLOR_CLASSES[color].swatch}`} /> : <Palette className="w-4 h-4" />,
        panel: {
          title: tr('สีการ์ด', 'Card colour'),
          render: (close: () => void) => (
            <div className="grid grid-cols-4 gap-1.5 p-1.5">
              <button
                type="button"
                onClick={() => {
                  prefs.setColor(g.rep.id, null, liveIds);
                  close();
                }}
                aria-label={tr('ไม่มีสี', 'No colour')}
                className={`h-10 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 flex items-center justify-center text-slate-400 cursor-pointer hover:ring-slate-400 ${!color ? 'ring-2 ring-slate-900 dark:ring-white' : ''}`}
              >
                <X className="w-4 h-4" />
              </button>
              {WORK_COLORS.map((c: WorkColor) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    prefs.setColor(g.rep.id, c, liveIds);
                    close();
                  }}
                  aria-label={tr(WORK_COLOR_CLASSES[c].label[0], WORK_COLOR_CLASSES[c].label[1])}
                  className={`h-10 rounded-xl flex items-center justify-center cursor-pointer ${WORK_COLOR_CLASSES[c].swatch} ${color === c ? 'ring-2 ring-offset-2 ring-slate-900 dark:ring-white dark:ring-offset-slate-900' : 'hover:brightness-95'}`}
                >
                  {color === c && <Check className="w-4 h-4 text-white" />}
                </button>
              ))}
            </div>
          ),
        },
      },
      g.published && {
        key: 'close',
        label: g.classes.length > 1 ? tr('ปิดรับทุกห้อง', 'Close in all classes') : tr('ปิดรับงาน', 'Close submissions'),
        icon: <Lock className="w-4 h-4" />,
        disabled: accepting.length === 0,
        danger: accepting.length > 0,
        onSelect: () => setClosed(accepting, true),
      },
    ].filter(Boolean) as ActionMenuItem[];
  };

  /** Always "ตรวจงาน"; filled amber with the count while work waits. */
  const gradeButton = (pending: number, href: string) => (
    <Link
      href={href}
      draggable={false}
      className={`h-9 px-3 rounded-xl text-xs font-black inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
        pending > 0
          ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-sm shadow-amber-500/20'
          : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
      }`}
    >
      {tr('ตรวจงาน', 'Grade')}
      {pending > 0 && <span className="min-w-5 px-1 rounded-full bg-slate-950/15 text-[11px] tabular-nums text-center">{pending}</span>}
    </Link>
  );
  const publishButton = (items: WorkClass[]) => (
    <button
      type="button"
      onClick={() => publish(items)}
      className="h-9 px-3 rounded-xl text-xs font-black inline-flex items-center gap-1.5 whitespace-nowrap bg-sky-100 hover:bg-sky-200 dark:bg-sky-950/60 dark:hover:bg-sky-900/60 text-sky-800 dark:text-sky-200 cursor-pointer transition-colors"
    >
      <Rocket className="w-3.5 h-3.5" />
      {tr('เผยแพร่', 'Publish')}
    </button>
  );
  const hiddenNote = (
    <span className="text-[11px] font-semibold text-slate-400 inline-flex items-center gap-1">
      <EyeOff className="w-3.5 h-3.5" />
      {tr('นักเรียนยังไม่เห็น', 'Hidden from students')}
    </span>
  );

  // ---- status: tap a class's pill, or ⋯ (class / work) → change status
  const classAccept = (c: WorkClass) => acceptStatus(c, th, language, now);
  const openWorkStatus = (g: WorkGroup) => {
    if (g.classes.length === 1) setStatusOne(g.classes[0]);
    else setStatusMany({ title: g.rep.title, scope: tr(`${g.classes.length} ห้อง`, `${g.classes.length} classes`), items: g.classes });
  };
  const applyChanges = (changes: Array<{ id: string; change: Partial<Assignment> }>, message: string) => {
    changes.forEach(({ id, change }) => patch(id, change));
    showToast(message);
  };
  const classRow = (c: WorkClass, g: WorkGroup) => (
    <li
      key={c.assignment.id}
      className={`px-3 py-1.5 rounded-2xl border ${c.published ? 'bg-slate-50/80 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/70' : 'bg-white/60 dark:bg-slate-900/40 border-dashed border-slate-300 dark:border-slate-700'}`}
    >
      <WorkRowLayout
        inset={ROW_INSET.class}
        lead={
          <span className="flex items-center gap-1.5 min-w-0">
            {/* Each class reads as its own room: icon tile + name. */}
            <span className="w-7 h-7 rounded-lg shrink-0 bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 flex items-center justify-center">
              <School className="w-3.5 h-3.5" />
            </span>
            <span className="text-sm font-black text-slate-900 dark:text-white truncate">{c.classroom.name}</span>
            {c.counts.flagged > 0 && (
              <Pill tone="rose" className="shrink-0">
                <ShieldAlert className="w-3 h-3" />
                {c.counts.flagged}
              </Pill>
            )}
          </span>
        }
        status={<StatusButton status={classAccept(c)} onClick={() => setStatusOne(c)} />}
        metrics={c.published ? <MetricCells totals={c.counts} /> : hiddenNote}
        action={c.published ? gradeButton(c.counts.pending, gradeHref(c.assignment.id)) : publishButton([c])}
        menu={<ActionMenu size="sm" label={tr(`ตัวเลือกของ ${c.classroom.name}`, `Options for ${c.classroom.name}`)} items={classMenu(c, g)} />}
      />
    </li>
  );

  const workCard = (g: WorkGroup) => {
    const open = isWorkOpen(g.rep.id);
    const color = prefs.colors[g.rep.id];
    const hidden = g.classes.filter((c) => !c.published);
    const subject = subjectLine(g);
    return (
      <div
        key={g.key}
        ref={bindItem(g.rep.id)}
        style={itemStyle(g.rep.id)}
        className={`relative overflow-hidden rounded-3xl border transition-colors ${dragKey === g.rep.id ? 'shadow-2xl shadow-amber-500/20 ring-2 ring-amber-400' : 'shadow-xs'} ${
          g.published ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800' : 'bg-slate-50/80 dark:bg-slate-900/50 border-dashed border-slate-300 dark:border-slate-700'
        } ${color ? WORK_COLOR_CLASSES[color].tint : ''}`}
      >
        {color && <span aria-hidden className={`absolute left-0 inset-y-0 w-1.5 ${WORK_COLOR_CLASSES[color].bar}`} />}
        <div className={`p-3 sm:p-4 ${color ? 'pl-4 sm:pl-5' : ''}`}>
          <WorkRowLayout
            inset={ROW_INSET.work}
            lead={
              <span className="w-full min-w-0 flex items-center gap-1">
              {canDrag && (
                <button
                  type="button"
                  aria-label={tr(`ลากเพื่อจัดลำดับ ${g.rep.title}`, `Drag to reorder ${g.rep.title}`)}
                  title={tr('ลากเพื่อจัดลำดับ', 'Drag to reorder')}
                  {...handleProps(g.rep.id)}
                  className="-ml-1.5 w-7 h-9 shrink-0 rounded-lg flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 touch-none select-none cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="w-4 h-4" />
                </button>
              )}
              <button type="button" onClick={() => toggleWork(g.rep.id)} aria-expanded={open} className="w-full min-w-0 flex items-center gap-2.5 text-left cursor-pointer group/work">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="min-w-0 truncate text-[15px] font-black text-slate-900 dark:text-white group-hover/work:text-amber-700 dark:group-hover/work:text-amber-400 transition-colors">
                      {g.rep.title}
                    </span>
                    {!g.published && (
                      <Pill tone={hidden.every((c) => c.window.isDraft) ? 'slate' : 'sky'} className="shrink-0">
                        {hidden.every((c) => c.window.isDraft) ? tr('ฉบับร่าง', 'Draft') : tr('ตั้งเวลา', 'Scheduled')}
                      </Pill>
                    )}
                    {isRetake(g.rep) && <Pill tone="amber" className="shrink-0">{tr('สอบซ่อม', 'Retake')}</Pill>}
                    {g.published && hidden.length > 0 && <Pill tone="sky" className="shrink-0">{tr(`ยังไม่เผยแพร่ ${hidden.length}`, `${hidden.length} unpublished`)}</Pill>}
                    {g.totals.flagged > 0 && (
                      <Pill tone="rose" className="shrink-0">
                        <ShieldAlert className="w-3 h-3" />
                        {g.totals.flagged}
                      </Pill>
                    )}
                  </span>
                  {subject && (
                    <span className="mt-0.5 flex items-center gap-1 min-w-0 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      <BookOpen className="w-3 h-3 shrink-0" />
                      <span className="truncate">{subject}</span>
                    </span>
                  )}
                </span>
              </button>
              </span>
            }
            status={
              <StatusButton
                status={groupStatus(g.classes.map(classAccept), th)}
                onClick={() => openWorkStatus(g)}
              />
            }
            metrics={g.published ? <MetricCells totals={g.totals} /> : hiddenNote}
            action={g.published ? gradeButton(g.totals.pending, workGradeHref(g)) : publishButton(hidden)}
            menu={<ActionMenu label={tr(`ตัวเลือกของ ${g.rep.title}`, `Options for ${g.rep.title}`)} items={workMenu(g)} />}
          />
          <Collapse open={open}>
            <ul className="pt-3 space-y-2">{g.classes.map((c) => classRow(c, g))}</ul>
          </Collapse>
          {/* The fold: the number of classes, centred at the bottom of the card. */}
          <div className="flex justify-center pt-2.5 -mb-1">
            <button
              type="button"
              onClick={() => toggleWork(g.rep.id)}
              aria-expanded={open}
              className={`h-8 pl-3 pr-2.5 rounded-full text-xs font-black inline-flex items-center gap-1.5 tabular-nums cursor-pointer transition-colors ${
                open
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200'
              }`}
            >
              <School className="w-3.5 h-3.5" />
              {g.classes.length} {tr('ห้อง', g.classes.length === 1 ? 'class' : 'classes')}
              <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ---------------------------------------------------------------- page
  const termLabel = semesterKey === 'all' ? tr('ทุกภาคเรียน', 'All terms') : formatAcademicPeriod(Number(semesterKey.split('_')[0]), Number(semesterKey.split('_')[1]), language);
  const total = tabCounts.homework + tabCounts.quiz;
  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'homework', label: tr('การบ้าน / ใบงาน', 'Assignments') },
    { id: 'quiz', label: tr('ข้อสอบ', 'Quizzes') },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-4 sm:space-y-5 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-24">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400">
        <ArrowLeft className="w-3.5 h-3.5" />
        {tr('กลับแดชบอร์ด', 'Back to dashboard')}
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-amber-500 shrink-0" />
            {tr('งานและข้อสอบ', 'Assignments & quizzes')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {termLabel} · {total} {tr('งาน', total === 1 ? 'item' : 'items')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 sm:flex-none min-w-0">
            <SemesterSelect value={semesterKey} onChange={setSemesterKey} options={termOptions} currentPeriod={currentPeriod} />
          </div>
          <CreateWorkMenu
            from="works"
            returnTo={returnTo}
            className="h-10 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{tr('สร้าง', 'New')}</span>
          </CreateWorkMenu>
        </div>
      </div>

      {/* Desktop: tabs and filters stay pinned under the navbar while scrolling. */}
      <div className="md:sticky md:top-[calc(4rem+env(safe-area-inset-top))] z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 md:py-3 space-y-2 md:bg-slate-50/90 md:dark:bg-slate-950/90 md:backdrop-blur-xl md:border-b md:border-slate-200/80 md:dark:border-slate-800">
        {/* Two main tabs; the highlight slides between them. */}
        <div ref={setTabGroup} role="tablist" className="hidden md:grid relative grid-cols-2 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/70">
          {tabIndicator && (
            <span
              aria-hidden
              className="absolute top-0 left-0 rounded-xl bg-white dark:bg-slate-900 shadow-sm transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={indicatorStyle(tabIndicator)}
            />
          )}
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                data-active={active}
                onClick={() => selectTab(id)}
                className={`relative h-11 rounded-xl text-sm font-black inline-flex items-center justify-center gap-2 transition-colors duration-300 cursor-pointer ${
                  active ? `text-slate-900 dark:text-white ${tabIndicator ? '' : 'bg-white dark:bg-slate-900'}` : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                <span className="truncate">{label}</span>
                <span className={`min-w-6 px-1.5 rounded-full text-[11px] tabular-nums ${tabPending[id] > 0 ? 'bg-amber-400 text-slate-950' : 'bg-slate-200/80 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                  {tabCounts[id]}
                </span>
              </button>
            );
          })}
        </div>

        {/* Course chips + search */}
        <div className="flex flex-col sm:flex-row gap-2">
          {termCourses.length > 1 && (
            <div className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-1.5 overflow-x-auto scrollbar-none sm:flex-1 sm:min-w-0">
              {[{ id: 'all', code: tr('ทุกวิชา', 'All courses'), name: '' }, ...termCourses].map((c) => {
                const active = activeCourse === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectCourse(c.id)}
                    title={c.name || undefined}
                    className={`shrink-0 h-9 px-3 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                      active ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-amber-400'
                    }`}
                  >
                    {c.code}
                  </button>
                );
              })}
            </div>
          )}
          <label className="relative block sm:w-64 sm:ml-auto">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr('ค้นหางานหรือห้อง', 'Search work or class')}
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-hidden focus:border-amber-500"
            />
          </label>
        </div>

      </div>

      {/* Phones: the two tabs as a bottom bar (like the classroom page). */}
      <nav
        aria-label={tr('ประเภทงาน', 'Work type')}
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-t border-slate-200/80 dark:border-slate-800 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="relative grid grid-cols-2 px-1 py-1.5">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-1.5 left-1 w-[calc((100%-0.5rem)/2)] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ transform: `translateX(${tab === 'quiz' ? 100 : 0}%)` }}
          >
            <span className="absolute top-1 left-1/2 -translate-x-1/2 h-7 w-14 rounded-full bg-amber-100 dark:bg-amber-950/70" />
          </span>
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            const Icon = id === 'quiz' ? ListChecks : NotebookPen;
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectTab(id)}
                aria-current={active ? 'page' : undefined}
                className={`relative min-w-0 flex flex-col items-center gap-1 py-1 rounded-2xl text-[11px] transition-colors cursor-pointer ${
                  active ? 'text-amber-600 dark:text-amber-400 font-black' : 'text-slate-500 dark:text-slate-400 font-semibold'
                }`}
              >
                <span className="relative px-4 py-1">
                  <Icon className={`w-5 h-5 transition-transform duration-300 ${active ? 'scale-110' : ''}`} />
                  {tabCounts[id] > 0 && (
                    <span className={`absolute -top-1 right-0 min-w-4.5 h-4.5 px-1 rounded-full text-[10px] leading-4.5 font-black tabular-nums ${tabPending[id] > 0 ? 'bg-amber-500 text-slate-950' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'}`}>
                      {tabCounts[id]}
                    </span>
                  )}
                </span>
                <span className="max-w-full truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Tab content: re-keyed so it slides in from the side of the chosen tab. */}
      <div
        key={tab}
        className="animate-in fade-in [--tw-duration:220ms] space-y-3"
        style={{ '--tw-enter-translate-x': `${tabDirection * 1.5}rem` } as CSSProperties}
      >
        {loading && !data ? (
          [0, 1, 2].map((i) => <div key={i} className="h-32 rounded-3xl bg-slate-100 dark:bg-slate-800/60 animate-pulse" />)
        ) : error && !data ? (
          <div className="p-6 rounded-3xl bg-rose-50 dark:bg-rose-950/30 text-sm font-semibold text-rose-700 dark:text-rose-300 text-center">{tr('โหลดข้อมูลไม่สำเร็จ ลองรีเฟรชหน้า', 'Could not load. Try refreshing.')}</div>
        ) : works.length === 0 ? (
          <div className="text-center py-14 px-6 rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {q || activeCourse !== 'all'
                ? tr('ไม่พบงานที่ค้นหา', 'Nothing matches')
                : tab === 'quiz'
                ? tr('ภาคเรียนนี้ยังไม่มีข้อสอบ', 'No quizzes this term')
                : tr('ภาคเรียนนี้ยังไม่มีการบ้าน', 'No assignments this term')}
            </p>
            {!q && activeCourse === 'all' && (
              <CreateWorkMenu from="works" returnTo={returnTo} className="h-10 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 cursor-pointer">
                <Plus className="w-4 h-4" />
                {tr('สร้างงาน / ข้อสอบ', 'New assignment / quiz')}
              </CreateWorkMenu>
            )}
          </div>
        ) : (
          // @container: rows go one line by the list's own width (the sidebar changes it).
          <div ref={bindList} className="@container relative space-y-2.5">
            {shownOrder.map((id) => workById.get(id)).filter((g): g is WorkGroup => !!g).map(workCard)}
          </div>
        )}
      </div>

      {dueTarget && (
        <DueDateDialog
          target={dueTarget.item}
          siblings={dueTarget.group.classes}
          onClose={() => setDueTarget(null)}
          onSave={(due, all) => saveDue(dueTarget.item, dueTarget.group, due, all)}
        />
      )}
      {statusOne && (
        <AssignmentStatusDialog
          assignment={statusOne.assignment}
          onClose={() => setStatusOne(null)}
          onSaved={(updated, action) => {
            patch(statusOne.assignment.id, updated);
            setStatusOne(null);
            showToast(action === 'published' ? tr('เผยแพร่แล้ว', 'Published') : tr('เปลี่ยนสถานะแล้ว', 'Status changed'));
          }}
        />
      )}
      {statusMany && <BulkStatusDialog {...statusMany} onClose={() => setStatusMany(null)} onDone={applyChanges} />}
      {detail && <WorkDetailSheet group={detail} courseLabel={courseLabel(detail.courseId)} onClose={() => setDetail(null)} />}

      {toast && (
        <div role="status" className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-6 inset-x-4 sm:inset-x-auto sm:right-6 sm:max-w-sm z-60 p-4 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold shadow-2xl flex items-center gap-2.5 text-sm animate-in fade-in slide-in-from-bottom-5">
          <Check className="w-4 h-4 shrink-0" />
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}
