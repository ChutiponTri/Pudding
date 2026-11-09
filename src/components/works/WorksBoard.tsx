'use client';

import { announceNote } from '@/lib/utils/announceNote';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, BellRing, BookOpen, Calendar, Check, ChevronDown, Clock, Copy, Edit2, Eye, EyeOff, FileText, GripVertical, ListChecks, Lock, Megaphone, MessageCircle, NotebookPen, Palette, Plus, Rocket, School, Search, ShieldAlert, Trash2, Unlock, X } from 'lucide-react';
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
import { ComboFilter } from '@/components/works/ComboFilter';
import { categoryLook } from '@/components/works/CategoryTools';
import { AnnounceButton, announcesResults, DueDateDialog, GradeButton, MetricCells, Pill, RemindButton, ROW_INSET, WorkDetailSheet, WorkRowLayout } from '@/components/works/WorkBits';
import { acceptStatus, BulkStatusDialog, groupStatus, PhoneWorkSummary, StatusButton } from '@/components/works/StatusBits';
import { AssignmentStatusDialog } from '@/components/AssignmentStatusDialog';
import { formatAcademicPeriod } from '@/lib/utils/academicYear';
import { filterClassroomsBySemester, semesterOptions } from '@/lib/utils/semesterFilter';
import { isRetakeOf } from '@/lib/utils/retake';
import { useScheduleNow } from '@/lib/hooks/useScheduleNow';
import {
  buildWorkGroups,
  type WorkClass,
  type WorkGroup,
} from '@/lib/utils/workGroups';

type Tab = 'homework' | 'quiz';
type LocalEdits = { base: TeacherDashboardData | null; updated: Record<string, Partial<Assignment>>; deleted: string[] };

const NO_EDITS: LocalEdits = { base: null, updated: {}, deleted: [] };

type AcceptFilter = 'all' | 'open' | 'closed' | 'hidden';
type GradeFilter = 'all' | 'unfinished' | 'finished';
/** open: some class takes work now; closed: published, none does; hidden: no class can see it yet. */
const acceptOf = (g: WorkGroup): Exclude<AcceptFilter, 'all'> =>
  !g.published ? 'hidden' : g.classes.some((c) => c.published && c.window.acceptsSubmissions) ? 'open' : 'closed';

/** 0 not published yet, 1 still being graded, 2 fully graded. */
const workRank = (g: WorkGroup) => (!g.published ? 0 : g.totals.pending === 0 && g.totals.notSubmitted === 0 && g.totals.totalStudents > 0 ? 2 : 1);


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
  // Filters: whether it takes work, and whether grading is done (also kept in the URL).
  const [acceptFilter, setAcceptFilter] = useState<AcceptFilter>(() => {
    const v = search.get('status');
    return v === 'open' || v === 'closed' || v === 'hidden' ? v : 'all';
  });
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>(() => {
    const v = search.get('grading');
    return v === 'unfinished' || v === 'finished' ? v : 'all';
  });
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
  const [classFilter, setClassFilter] = useState(() => search.get('class') || 'all');
  const selectCourse = (id: string) => {
    setCourseFilter(id);
    setParam('course', id === 'all' ? null : id);
  };
  /** The subject / class box: "course:<id>", "class:<id>" or "all". */
  const selectPlace = (value: string) => {
    const [kind, id] = value.split(':');
    selectCourse(kind === 'course' ? id : 'all');
    setClassFilter(kind === 'class' ? id : 'all');
    setParam('class', kind === 'class' ? id : null);
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

  // Ticks every minute so "2 days left" stays true on an open page, and exactly when a
  // scheduled publish time or a deadline passes, so the status flips without a refresh.
  const now = useScheduleNow(data?.assignments, 60_000);

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
  // Classrooms that have work this term, for the subject / class box.
  const termWorkClasses = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; courseId: string }>();
    for (const g of allGroups) for (const c of g.classes) if (!seen.has(c.classroom.id)) seen.set(c.classroom.id, { id: c.classroom.id, name: c.classroom.name, courseId: g.courseId });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'th', { numeric: true }));
  }, [allGroups]);
  const activeClass = termWorkClasses.some((c) => c.id === classFilter) ? classFilter : 'all';

  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (g: WorkGroup) =>
      (activeCourse === 'all' || g.courseId === activeCourse) &&
      (activeClass === 'all' || g.classes.some((c) => c.classroom.id === activeClass)) &&
      (acceptFilter === 'all' || acceptOf(g) === acceptFilter) &&
      (gradeFilter === 'all' || (gradeFilter === 'finished') === (workRank(g) === 2)) &&
      (!q || g.rep.title.toLowerCase().includes(q) || g.classes.some((c) => c.classroom.name.toLowerCase().includes(q))),
    [activeCourse, activeClass, acceptFilter, gradeFilter, q]
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
  // Where the teacher dragged a work, it stays. Only work that is not in the
  // saved order yet (new) gets a default place: not published → still being
  // graded → fully graded, latest deadline first.
  // The whole tab in order (filters ignored): a filtered list is a view of it.
  const fullByTab = useMemo(() => {
    const build = (isExam: boolean) => {
      const groups = allGroups
        .filter((g) => g.isExam === isExam)
        .sort((a, b) => workRank(a) - workRank(b) || b.lastDeadline - a.lastDeadline || a.rep.title.localeCompare(b.rep.title, 'th'));
      return applySavedOrder(groups, (g) => g.rep.id, prefs.order, (item, other) => workRank(item) <= workRank(other));
    };
    return { homework: build(false), quiz: build(true) };
  }, [allGroups, prefs.order]);
  const byTab = useMemo(
    () => ({ homework: fullByTab.homework.filter(matches), quiz: fullByTab.quiz.filter(matches) }),
    [fullByTab, matches]
  );
  const works = byTab[tab];
  const workById = new Map(works.map((g) => [g.rep.id, g]));
  // Work no class can see yet (draft / scheduled) is pinned on top: never dragged and not
  // part of the drag order (latest deadline first). It still folds open like any work.
  // The saved order of everything else is untouched (commitOrder keeps pinned ids in place).
  const pinnedWorks = works
    .filter((g) => !g.published)
    .sort((a, b) => b.lastDeadline - a.lastDeadline || a.rep.title.localeCompare(b.rep.title, 'th'));
  const draggableWorks = works.filter((g) => g.published);
  const filtering = !!q || activeCourse !== 'all' || activeClass !== 'all' || acceptFilter !== 'all' || gradeFilter !== 'all';
  const canDrag = draggableWorks.length > 1;
  /**
   * A drag in a filtered list reorders only the works shown: they swap among
   * the places they hold in the whole tab, and the hidden ones stay put.
   */
  const commitOrder = (shown: string[]) => {
    const visible = new Set(shown);
    let next = 0;
    prefs.setOrder(fullByTab[tab].map((g) => (visible.has(g.rep.id) ? shown[next++] : g.rep.id)));
  };
  const { bindList, bindItem, order: shownOrder, dragKey, itemStyle, handleProps, pressProps, recentlyDropped } = useDragReorder(
    draggableWorks.map((g) => g.rep.id),
    commitOrder
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
    // No confirmation: the LINE share window that follows shows what goes out.
    let done = 0;
    let firstError = '';
    for (const c of list) {
      try {
        const updated = await dataService.publishAssignmentNow(c.assignment.id);
        patch(c.assignment.id, { publish_at: updated?.publish_at || new Date().toISOString(), ...(updated?.due_date ? { due_date: updated.due_date } : {}) });
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
    try {
      const line = await dataService.reannounceAssignment(c.assignment.id, c.assignment.title);
      showToast(
        line === 'card'
          ? tr('กด “ส่งเข้ากลุ่ม” ในหน้าต่างที่เปิดขึ้น แล้วเลือกกลุ่ม LINE ของห้อง', 'Tap “Send to group” in the window that opened and pick the class LINE group')
          : line === 'no_group'
          ? tr('ห้องนี้ยังไม่เชื่อมกลุ่ม LINE — แชร์เองได้จากหน้าต่างที่เปิดขึ้น', 'No linked LINE group — share it from the window that opened')
          : tr('บอทส่งเข้า LINE ไม่ได้ — แชร์เองได้จากหน้าต่างที่เปิดขึ้น', 'The bot could not post it — share it yourself from the window that opened')
      );
    } catch (err) {
      showToast(errorText(err, tr('ส่งไม่สำเร็จ', 'Could not post')));
    }
  };

  /**
   * "ทวงงาน": the bot names who has not handed in, in each class's LINE group.
   * The server checks the LINE quota first; whenever the bot cannot send, the
   * share popup opens so the teacher sends it from their own LINE.
   */
  const remind = async (list: WorkClass[]) => {
    if (!list.length) return;
    let sent = 0;
    let manual = 0;
    let done = 0;
    let firstError = '';
    for (const c of list) {
      try {
        const line = await dataService.remindAssignment(c.assignment.id, list.length > 1 ? `${c.assignment.title} · ${c.classroom.name}` : c.assignment.title);
        if (line === 'none') done++;
        else if (line === 'sent') sent++;
        else manual++;
      } catch (err) {
        firstError ||= errorText(err, tr('ทวงงานไม่สำเร็จ', 'Could not send the reminder'));
      }
    }
    showToast(
      firstError ||
        [
          sent && tr(`ทวงงานแล้ว ${list.length > 1 ? `${sent} ห้อง` : ''}`.trim(), `Reminded${list.length > 1 ? ` ${sent} classes` : ''}`),
          manual && tr(`ส่งภาพทวงงานเข้ากลุ่มจากหน้าต่างที่เปิดขึ้น${manual > 1 ? ` (${manual} ห้อง)` : ''} บอทจะตอบรายชื่อและแท็กคนที่ยังไม่ส่ง`, `Send the reminder picture from the window that opened${manual > 1 ? ` (${manual} classes)` : ''}; the bot answers with who has not handed in`),
          done && tr(`ส่งครบแล้ว ${done} ห้อง`, `${done} all handed in`),
        ].filter(Boolean).join(' • ')
    );
  };

  /** Classes where "ทวงงาน" has turned into "ประกาศคะแนน" (see announcesResults). */
  const resultsMode = (c: WorkClass) => c.published && announcesResults(c.counts, c.window.acceptsSubmissions);

  /**
   * "ประกาศคะแนน": after the teacher confirms, classes still taking hand-ins are
   * closed (results only show once closed), then the bot posts to each class
   * group; whenever it cannot, the share popup opens for that class.
   */
  const announce = async (items: WorkClass[]) => {
    const list = items.filter((c) => c.published && c.counts.graded > 0);
    if (!list.length) return;
    let sent = 0;
    let manual = 0;
    let closed = 0;
    let zeroed = 0;
    let ungraded = 0;
    let firstError = '';
    for (const c of list) {
      try {
        const result = await dataService.announceResults(c.assignment.id, list.length > 1 ? `${c.assignment.title} · ${c.classroom.name}` : c.assignment.title);
        if (result.closed) {
          closed++;
          patch(c.assignment.id, { status_override: result.assignment?.status_override || 'force_closed' });
        }
        zeroed += result.zeroed;
        ungraded += result.ungraded;
        if (result.line === 'sent') sent++;
        else manual++;
      } catch (err) {
        firstError ||= errorText(err, tr('ประกาศคะแนนไม่สำเร็จ', 'Could not announce the scores'));
      }
    }
    showToast(
      firstError ||
        [
          closed && tr(`ปิดรับแล้ว${list.length > 1 ? ` ${closed} ห้อง` : ''}`, `Closed${list.length > 1 ? ` ${closed} classes` : ''}`),
          sent && tr(`ประกาศคะแนนแล้ว${list.length > 1 ? ` ${sent} ห้อง` : ''}`, `Scores announced${list.length > 1 ? ` in ${sent} classes` : ''}`),
          manual && tr(`ส่งการ์ดประกาศผลเข้ากลุ่มจากหน้าต่างที่เปิดขึ้น${manual > 1 ? ` (${manual} ห้อง)` : ''}`, `Send the results card from the window that opened${manual > 1 ? ` (${manual} classes)` : ''}`),
          announceNote({ zeroed, ungraded }, language === 'th'),
        ].filter(Boolean).join(' • ')
    );
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
      // No linked group: the same action opens the share popup (sent from the teacher's own LINE).
      c.published && {
          key: 'line',
          label: lineReady ? tr('ประกาศซ้ำใน LINE', 'Post to LINE again') : tr('แชร์ลิงก์งานไป LINE', 'Share the link to LINE'),
          icon: <MessageCircle className="w-4 h-4" />,
          disabled: !c.window.acceptsSubmissions,
          onSelect: () => reannounce(c),
        },
      c.published &&
        (resultsMode(c)
          ? {
              key: 'results',
              label: tr('ประกาศคะแนน', 'Announce scores'),
              hint: c.counts.pending > 0 ? tr(`รอตรวจ ${c.counts.pending}`, `${c.counts.pending} to grade`) : undefined,
              icon: <Megaphone className="w-4 h-4" />,
              disabled: c.counts.graded === 0,
              onSelect: () => announce([c]),
            }
          : {
              key: 'remind',
              label: tr('ทวงงาน', 'Remind'),
              hint: tr(`ยังไม่ส่ง ${c.counts.notSubmitted}`, `${c.counts.notSubmitted} missing`),
              icon: <BellRing className="w-4 h-4" />,
              onSelect: () => remind([c]),
            }),
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
      g.published && (() => {
        const shown = g.classes.filter((c) => c.published);
        // Every class past reminding: the card announces scores instead.
        if (shown.every(resultsMode)) {
          const ready = shown.filter((c) => c.counts.graded > 0);
          return {
            key: 'results',
            label: g.classes.length > 1 ? tr('ประกาศคะแนนทุกห้อง', 'Announce scores (all classes)') : tr('ประกาศคะแนน', 'Announce scores'),
            hint: g.classes.length > 1 && ready.length ? tr(`${ready.length} ห้อง`, `${ready.length} classes`) : undefined,
            icon: <Megaphone className="w-4 h-4" />,
            disabled: ready.length === 0,
            onSelect: () => announce(ready),
          };
        }
        const missing = accepting.filter((c) => c.counts.notSubmitted > 0);
        return {
          key: 'remind',
          label: g.classes.length > 1 ? tr('ทวงงานทุกห้อง', 'Remind (all classes)') : tr('ทวงงาน', 'Remind'),
          hint: missing.length
            ? g.classes.length > 1
              ? tr(`${missing.length} ห้อง`, `${missing.length} classes`)
              : tr(`ยังไม่ส่ง ${missing[0].counts.notSubmitted}`, `${missing[0].counts.notSubmitted} missing`)
            : undefined,
          icon: <BellRing className="w-4 h-4" />,
          disabled: missing.length === 0,
          onSelect: () => remind(missing),
        };
      })(),
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

  const gradeButton = (pending: number, href: string) => <GradeButton pending={pending} href={href} />;
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
      onClick={(e) => {
        // A tap anywhere on the class (not its buttons) opens its grading.
        e.stopPropagation();
        if (!c.published || recentlyDropped()) return;
        if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label, [role="menu"]')) return;
        if (window.getSelection()?.toString()) return;
        router.push(gradeHref(c.assignment.id));
      }}
      // Phones: the name starts under the work's title (past the header's fold chevron).
      className={`px-3 py-2 max-sm:pl-[33px] rounded-2xl border transition-colors ${
        !c.published
          ? 'bg-slate-50 dark:bg-slate-900/60 border-dashed border-slate-300 dark:border-slate-700'
          : `cursor-pointer bg-white dark:bg-slate-900 hover:border-amber-400 dark:hover:border-amber-600 ${c.counts.pending > 0 ? 'border-amber-300 dark:border-amber-800/70' : 'border-slate-200 dark:border-slate-800'}`
      }`}
    >
      <WorkRowLayout
        inset={ROW_INSET.class}
        lead={
          <span className="flex items-center gap-1.5 min-w-0">
            {/* Each class reads as its own room: icon tile + name. */}
            <span className="max-sm:hidden w-7 h-7 rounded-lg shrink-0 bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 flex items-center justify-center">
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
        phone={<PhoneWorkSummary status={classAccept(c)} onStatusClick={() => setStatusOne(c)} totals={c.counts} gradeHref={gradeHref(c.assignment.id)} hidden={!c.published} />}
        metrics={c.published ? <MetricCells totals={c.counts} /> : hiddenNote}
        action={
          c.published ? (
            <>
              {resultsMode(c) ? (
                <AnnounceButton graded={c.counts.graded} onClick={() => announce([c])} />
              ) : (
                <RemindButton missing={c.counts.notSubmitted} closed={!c.window.acceptsSubmissions} onClick={() => remind([c])} />
              )}
              {gradeButton(c.counts.pending, gradeHref(c.assignment.id))}
            </>
          ) : (
            publishButton([c])
          )
        }
        menu={<ActionMenu size="sm" label={tr(`ตัวเลือกของ ${c.classroom.name}`, `Options for ${c.classroom.name}`)} items={classMenu(c, g)} />}
      />
    </li>
  );

  const workCard = (g: WorkGroup, draggable = true) => {
    const open = isWorkOpen(g.rep.id);
    const dragHere = canDrag && draggable;
    const color = prefs.colors[g.rep.id];
    const hidden = g.classes.filter((c) => !c.published);
    const subject = subjectLine(g);
    const look = categoryLook(color);
    return (
      <div
        key={g.key}
        ref={draggable ? bindItem(g.rep.id) : undefined}
        style={draggable ? itemStyle(g.rep.id) : undefined}
        {...(dragHere ? pressProps(g.rep.id) : {})}
        // A tap anywhere on the work (not on a button, link or its class list) opens
        // or closes the class list; a tap on a class opens that class's grading.
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label, [role="menu"], [data-no-toggle]')) return;
          if (recentlyDropped()) return;
          if (window.getSelection()?.toString()) return;
          toggleWork(g.rep.id);
        }}
        className={`relative overflow-hidden rounded-3xl border-2 bg-white dark:bg-slate-900 cursor-pointer select-none [-webkit-touch-callout:none] transition-[border-color,box-shadow] ${look.border} ${
          g.published ? '' : 'border-dashed'
        } ${dragKey === g.rep.id ? 'shadow-2xl shadow-amber-500/20 ring-2 ring-amber-400' : 'shadow-xs'}`}
      >
        {look.bar && <span aria-hidden className={`absolute left-0 inset-y-0 w-1.5 z-1 ${look.bar}`} />}
        {/* Header: the work itself, on the category-style grey (or the teacher's colour). */}
        <div className={`px-3 sm:px-4 py-2 ${look.head} ${look.bar ? 'pl-4 sm:pl-5' : ''}`}>
          <WorkRowLayout
            inset={ROW_INSET.work}
            lead={
              <span className="w-full min-w-0 flex items-center gap-1">
              {dragHere && (
                <button
                  type="button"
                  aria-label={tr(`ลากเพื่อจัดลำดับ ${g.rep.title}`, `Drag to reorder ${g.rep.title}`)}
                  title={tr('ลากเพื่อจัดลำดับ', 'Drag to reorder')}
                  {...handleProps(g.rep.id)}
                  className="max-sm:hidden -ml-1.5 w-7 h-9 shrink-0 rounded-lg flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 touch-none select-none cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="w-4 h-4" />
                </button>
              )}
              {/* Phones: the fold chevron sits before the title, as on the classwork tab. */}
              <span
                aria-hidden
                className="sm:hidden w-6 h-6 mr-1.5 rounded-full shrink-0 flex items-center justify-center text-slate-500 dark:text-slate-400 bg-white/80 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700"
              >
                <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
              </span>
              <span className="w-full min-w-0 flex items-center gap-2.5 text-left group/work">
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
                    {isRetakeOf(g.rep) && <Pill tone="amber" className="shrink-0">{tr('สอบซ่อม', 'Retake')}</Pill>}
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
              </span>
              </span>
            }
            status={
              <StatusButton
                status={groupStatus(g.classes.map(classAccept), th)}
                onClick={() => openWorkStatus(g)}
              />
            }
            phone={
              <PhoneWorkSummary
                status={groupStatus(g.classes.map(classAccept), th)}
                onStatusClick={() => openWorkStatus(g)}
                totals={g.totals}
                gradeHref={g.published ? workGradeHref(g) : undefined}
                hidden={!g.published}
              />
            }
            metrics={g.published ? <MetricCells totals={g.totals} /> : hiddenNote}
            action={
              g.published ? (
                (() => {
                  // Classes still taking work with students who have not handed in.
                  const missing = g.classes.filter((c) => c.published && c.window.acceptsSubmissions && c.counts.notSubmitted > 0);
                  const count = missing.reduce((sum, c) => sum + c.counts.notSubmitted, 0);
                  const anyOpen = g.classes.some((c) => c.published && c.window.acceptsSubmissions);
                  const shown = g.classes.filter((c) => c.published);
                  if (shown.every(resultsMode)) {
                    const ready = shown.filter((c) => c.counts.graded > 0);
                    return (
                      <>
                        <AnnounceButton
                          graded={ready.length}
                          onClick={() => announce(ready)}
                          title={ready.length > 1 ? tr(`ประกาศคะแนน ${ready.length} ห้อง`, `Announce scores in ${ready.length} classes`) : undefined}
                        />
                        {gradeButton(g.totals.pending, workGradeHref(g))}
                      </>
                    );
                  }
                  return (
                    <>
                      <RemindButton
                        // Open: who can still hand in. Closed everywhere: greyed, with everyone still missing.
                        missing={anyOpen ? count : g.totals.notSubmitted}
                        closed={!anyOpen}
                        onClick={() => remind(missing)}
                        title={missing.length > 1 ? tr(`ทวงงาน ${missing.length} ห้อง • ยังไม่ส่ง ${count} คน`, `Remind ${missing.length} classes • ${count} not handed in`) : undefined}
                      />
                      {gradeButton(g.totals.pending, workGradeHref(g))}
                    </>
                  );
                })()
              ) : (
                publishButton(hidden)
              )
            }
            menu={<ActionMenu label={tr(`ตัวเลือกของ ${g.rep.title}`, `Options for ${g.rep.title}`)} items={workMenu(g)} />}
          />
        </div>
        <Collapse open={open}>
          <ul data-no-toggle data-no-drag className={`p-3 sm:p-4 space-y-2 cursor-default ${look.bar ? 'pl-4 sm:pl-5' : ''}`}>{g.classes.map((c) => classRow(c, g))}</ul>
        </Collapse>
        {/* Tablet / desktop fold: a full-width bar along the bottom. Folded, it
            previews the classes' names; the chevron turns as it opens. */}
        <div className={`max-sm:hidden border-t border-slate-100 dark:border-slate-800 ${look.bar ? 'pl-1.5' : ''}`}>
            <button
              type="button"
              onClick={() => toggleWork(g.rep.id)}
              aria-expanded={open}
              className="group/fold w-full h-10 px-3 sm:px-4 flex items-center gap-2 text-left cursor-pointer transition-colors hover:bg-amber-50/70 dark:hover:bg-amber-950/20"
            >
              <span className="shrink-0 h-6 pl-1.5 pr-2 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[11px] font-black inline-flex items-center gap-1 tabular-nums">
                <School className="w-3.5 h-3.5" />
                {g.classes.length} {tr('ห้อง', g.classes.length === 1 ? 'class' : 'classes')}
              </span>
              <span className={`min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-400 transition-opacity duration-300 ${open ? 'opacity-0' : 'opacity-100'}`}>
                {g.classes.map((c) => c.classroom.name).join(' · ')}
              </span>
              <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 dark:text-slate-400 group-hover/fold:text-amber-700 dark:group-hover/fold:text-amber-300 transition-colors">
                {open ? tr('ซ่อน', 'Hide') : tr('แสดง', 'Show')}
                <span className={`w-6 h-6 rounded-full flex items-center justify-center transition-[transform,background-color] duration-300 ${open ? 'rotate-180 bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-800 group-hover/fold:bg-amber-500 group-hover/fold:text-slate-950'}`}>
                  <ChevronDown className="w-3.5 h-3.5" />
                </span>
              </span>
            </button>
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
            <SemesterSelect value={semesterKey} onChange={setSemesterKey} options={termOptions} currentPeriod={currentPeriod} dense />
          </div>
          <CreateWorkMenu
            from="works"
            returnTo={returnTo}
            className="h-8 sm:h-10 px-3 sm:px-3.5 rounded-lg sm:rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-[11px] sm:text-xs inline-flex items-center gap-1 sm:gap-1.5 shadow-sm cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>{tr('สร้าง', 'New')}</span>
          </CreateWorkMenu>
        </div>
      </div>

      {/* Desktop: only the tabs stay pinned under the navbar while scrolling; filters scroll with the page. */}
      <div className="hidden md:block md:sticky md:top-[calc(4rem+env(safe-area-inset-top))] z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 md:py-3 md:bg-slate-50/90 md:dark:bg-slate-950/90 md:backdrop-blur-xl md:border-b md:border-slate-200/80 md:dark:border-slate-800">
        {/* Two main tabs; the highlight slides between them. */}
        <div ref={setTabGroup} role="tablist" className="grid relative grid-cols-2 p-1 rounded-2xl bg-slate-200/70 dark:bg-slate-900 ring-1 ring-slate-300/70 dark:ring-slate-700">
          {tabIndicator && (
            <span
              aria-hidden
              className="absolute top-0 left-0 rounded-xl bg-amber-500 shadow-md shadow-amber-500/30 dark:shadow-amber-950/60 transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
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
                  // The active tab sits on the solid amber highlight; the other stays muted, so the current one reads at a glance.
                  active ? `text-slate-950 ${tabIndicator ? '' : 'bg-amber-500'}` : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 hover:bg-white/60 dark:hover:text-slate-100 dark:hover:bg-slate-800/70'
                }`}
              >
                <span className="truncate">{label}</span>
                <span
                  className={`min-w-6 px-1.5 rounded-full text-[11px] tabular-nums ${
                    active
                      ? tabPending[id] > 0 ? 'bg-slate-950 text-amber-300' : 'bg-slate-950/15 text-slate-950'
                      : tabPending[id] > 0 ? 'bg-amber-400 text-slate-950' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {tabCounts[id]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

        {/* Filters, by the width they have (not the screen's): below 56rem two full-width lines of the
            same width (a 2 × 2 grid of equal boxes: subject/class + search, then status + grading;
            clear is a tall button down the right of both); from 56rem, where everything fits,
            one row (order sets the sequence). */}
        <div className="@container">
        <div className={`grid ${filtering ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]' : 'grid-cols-2'} gap-1.5 @4xl:flex @4xl:items-center @4xl:gap-2`}>
          <ComboFilter
            value={activeClass !== 'all' ? `class:${activeClass}` : activeCourse !== 'all' ? `course:${activeCourse}` : 'all'}
            onChange={selectPlace}
            className="flex-1 @4xl:flex-none @4xl:w-72 @4xl:order-1"
            options={[
              ...termCourses.map((c) => ({ value: `course:${c.id}`, label: `${c.code} ${c.name}`.trim(), kind: 'subject' as const })),
              ...termWorkClasses.map((c) => ({ value: `class:${c.id}`, label: c.name, sub: courseById.get(c.courseId)?.code, kind: 'class' as const })),
            ]}
          />
          <label className="relative flex-1 min-w-0 @4xl:min-w-48 @4xl:order-4 h-9 sm:h-10 flex items-center overflow-hidden pl-8 sm:pl-9 pr-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 focus-within:border-amber-500 cursor-text">
            <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr('ค้นหาชื่องานหรือห้อง', 'Search work or class')}
              className="phone-small-field w-full min-w-0 h-full bg-transparent text-xs sm:text-sm text-slate-900 dark:text-white outline-none"
            />
          </label>
          <FilterSelect
            label={tr('สถานะ', 'Status')}
            value={acceptFilter}
            active={acceptFilter !== 'all'}
            onChange={(v) => {
              const next = v as AcceptFilter;
              setAcceptFilter(next);
              setParam('status', next === 'all' ? null : next);
            }}
            className="flex-1 @4xl:flex-none @4xl:w-44 @4xl:order-2"
            options={[
              { value: 'all', label: tr('ทุกสถานะ', 'Any status') },
              { value: 'open', label: tr('เปิดรับ', 'Open') },
              { value: 'closed', label: tr('ปิดรับ', 'Closed') },
              { value: 'hidden', label: tr('ยังไม่เผยแพร่', 'Not published') },
            ]}
          />
          <FilterSelect
            label={tr('การตรวจ', 'Grading')}
            value={gradeFilter}
            active={gradeFilter !== 'all'}
            onChange={(v) => {
              const next = v as GradeFilter;
              setGradeFilter(next);
              setParam('grading', next === 'all' ? null : next);
            }}
            className="flex-1 @4xl:flex-none @4xl:w-44 @4xl:order-3"
            options={[
              { value: 'all', label: tr('ทั้งหมด', 'All') },
              { value: 'unfinished', label: tr('ยังตรวจไม่ครบ', 'Not fully graded') },
              { value: 'finished', label: tr('ตรวจครบแล้ว', 'Fully graded') },
            ]}
          />
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setAcceptFilter('all');
                setGradeFilter('all');
                setQuery('');
                selectPlace('all');
                setParam('status', null);
                setParam('grading', null);
              }}
              aria-label={tr('ล้างตัวกรอง', 'Clear filters')}
              title={tr('ล้างตัวกรอง', 'Clear filters')}
              // Two lines: one tall button down the right of both lines, so the four boxes stay equal.
              className="col-start-3 row-start-1 row-span-2 h-full w-9 sm:w-10 @4xl:col-auto @4xl:row-auto @4xl:w-auto @4xl:h-10 @4xl:px-3 @4xl:order-5 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white bg-slate-100 @4xl:bg-transparent dark:bg-slate-800 @4xl:dark:bg-transparent hover:bg-slate-200 @4xl:hover:bg-slate-100 dark:hover:bg-slate-700 @4xl:dark:hover:bg-slate-800 inline-flex items-center justify-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span className="@max-4xl:hidden">{tr('ล้างตัวกรอง', 'Clear filters')}</span>
            </button>
          )}
        </div>
        </div>

      {/* Phones: the two tabs as a bottom bar (like the classroom page). */}
      <nav
        aria-label={tr('ประเภทงาน', 'Work type')}
        // The solid ::after under the bar fills any sliver between it and the screen's edge
        // (fractional pixel ratios, browser toolbars sliding away), so the page never shows through.
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl border-t border-slate-200/80 dark:border-slate-800 pb-[env(safe-area-inset-bottom)] after:content-[''] after:absolute after:inset-x-0 after:top-full after:h-24 after:bg-white dark:after:bg-slate-900"
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
              {filtering
                ? tr('ไม่พบงานตามที่เลือก', 'Nothing matches')
                : tab === 'quiz'
                ? tr('ภาคเรียนนี้ยังไม่มีข้อสอบ', 'No quizzes this term')
                : tr('ภาคเรียนนี้ยังไม่มีการบ้าน', 'No assignments this term')}
            </p>
            {!filtering && (
              <CreateWorkMenu from="works" returnTo={returnTo} className="h-10 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 cursor-pointer">
                <Plus className="w-4 h-4" />
                {tr('สร้างงาน / ข้อสอบ', 'New assignment / quiz')}
              </CreateWorkMenu>
            )}
          </div>
        ) : (
          // @container: rows go one line by the list's own width (the sidebar changes it).
          <div className="@container space-y-2.5">
            {pinnedWorks.length > 0 && <div className="space-y-2.5">{pinnedWorks.map((g) => workCard(g, false))}</div>}
            <div ref={bindList} className="relative space-y-2.5">
              {shownOrder.map((id) => workById.get(id)).filter((g): g is WorkGroup => !!g).map((g) => workCard(g))}
            </div>
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

/**
 * A compact dropdown filter: the label sits inside the field ("สถานะ: เปิดรับ"),
 * and the field turns dark while it filters. Native <select>, so phones and
 * iPads get their own picker.
 */
function FilterSelect({
  label,
  value,
  options,
  onChange,
  active,
  className = '',
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  active: boolean;
  className?: string;
}) {
  const current = options.find((o) => o.value === value)?.label || '';
  return (
    <label
      className={`relative h-9 sm:h-10 min-w-0 rounded-xl border flex items-center gap-1 sm:gap-1.5 pl-2.5 sm:pl-3 pr-7 sm:pr-8 text-[11px] sm:text-xs transition-colors cursor-pointer ${
        active
          ? 'bg-slate-900 border-slate-900 text-white dark:bg-white dark:border-white dark:text-slate-900'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:border-amber-400'
      } ${className}`}
    >
      <span className={`shrink-0 font-semibold ${active ? 'opacity-70' : 'text-slate-400'}`}>{label}</span>
      <span className="min-w-0 truncate font-black">{current}</span>
      <ChevronDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 absolute right-2 sm:right-2.5 top-1/2 -translate-y-1/2 opacity-60 pointer-events-none" />
      {/* The real control covers the field, invisible, so the native picker opens on tap. */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
