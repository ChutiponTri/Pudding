'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { BookOpen, ChevronRight, ClipboardList, Copy, RotateCcw, ShieldAlert } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { ReuseWorkPicker } from '@/components/ReuseWorkPicker';
import { RetakePicker } from '@/components/RetakePicker';
import type { Assignment } from '@/types/database';

const MENU_WIDTH = 288;
const MENU_GAP = 8;
const VIEWPORT_MARGIN = 12;
/** Matches the close transition below, so the menu unmounts once it has faded out. */
const CLOSE_MS = 130;

/**
 * The "new assignment / quiz" button. Opens a small menu right next to the
 * button (below, or above when there is no room) with five starts:
 * homework, quiz, survey, a retake quiz for chosen students, or reuse earlier work.
 * All end on the normal creation page, set up for the choice.
 */
export function CreateWorkMenu({
  classroomId,
  from,
  returnTo,
  className,
  children,
  onNavigate,
}: {
  /** The classroom the work is for (preselected on the creation page). */
  classroomId?: string;
  /** Where the creation page's "back" button returns to. */
  from?: 'classroom' | 'dashboard' | 'works';
  /** With from="works": the exact list view to come back to (e.g. "/works?term=2_2026&tab=quiz"). */
  returnTo?: string;
  className?: string;
  children: ReactNode;
  /** Called before leaving the page (e.g. the mobile sidebar closes itself). */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { tr } = useLanguage();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // The menu stays mounted while it animates out; `shown` drives the transition both ways.
  const [rendered, setRendered] = useState(false);
  const [shown, setShown] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The retake picker opens with the "come back to" place read when it was chosen.
  const [retakeOpen, setRetakeOpen] = useState<null | { from?: 'classroom' | 'dashboard' | 'works'; returnTo?: string }>(null);
  const [position, setPosition] = useState<{ top: number; left: number; above: boolean; originX: number } | null>(null);

  // Opened on the work list (also from the sidebar there): come back to the list, read at click time
  // so tab / filter changes since render are kept. The creation page picks the quiz / homework tab.
  const origin = () => {
    const onWorks = typeof window !== 'undefined' && window.location.pathname.startsWith('/works');
    if ((from === 'works' || (!from && onWorks)) && onWorks) {
      return { from: 'works' as const, returnTo: `${window.location.pathname}${window.location.search}` };
    }
    return { from, returnTo };
  };

  const query = (extra: Record<string, string>) => {
    const params = new URLSearchParams();
    const back = origin();
    if (classroomId) params.set('classroomId', classroomId);
    if (back.from) params.set('from', back.from);
    if (back.returnTo) params.set('returnTo', back.returnTo);
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    return `/assignments/new?${params}`;
  };

  // Fixed position next to the trigger, kept inside the viewport; above when the space below is short.
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight || 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < menuHeight + MENU_GAP + VIEWPORT_MARGIN && rect.top > spaceBelow;
    const width = Math.min(MENU_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    // Right-aligned with the trigger when that fits (buttons often sit at the right edge), else left-aligned.
    let left = rect.right - width;
    if (left < VIEWPORT_MARGIN) left = rect.left;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - width - VIEWPORT_MARGIN));
    const top = above ? rect.top - menuHeight - MENU_GAP : rect.bottom + MENU_GAP;
    // Grow out of the trigger: the transform origin sits under (or over) its middle.
    const originX = Math.max(16, Math.min(width - 16, rect.left + rect.width / 2 - left));
    setPosition({ top: Math.max(VIEWPORT_MARGIN, top), left, above, originX });
  }, []);

  // Open: mount hidden, place, then flip to shown on the next frame so the transition runs.
  // Close: transition out, then unmount.
  const openMenu = () => {
    setRendered(true);
    setOpen(true);
  };
  const closeMenu = useCallback(() => {
    setOpen(false);
    setShown(false);
  }, []);
  // Unmount once the close transition has played (cancelled if it is opened again meanwhile).
  useEffect(() => {
    if (open || !rendered) return;
    const timer = window.setTimeout(() => setRendered(false), CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [open, rendered]);

  useLayoutEffect(() => {
    if (!open || !rendered) return;
    place();
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(frame);
  }, [open, rendered, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // Focus the first choice for keyboard users (once the menu is mounted).
    const focusFrame = requestAnimationFrame(() =>
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
    );
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place, closeMenu]);

  const go = (href: string) => {
    closeMenu();
    onNavigate?.();
    router.push(href);
  };

  const closePicker = useCallback(() => setPickerOpen(false), []);

  const pick = (assignment: Assignment) => {
    setPickerOpen(false);
    go(query({ copy: assignment.id, reuse: '1' }));
  };

  const options = [
    {
      key: 'homework',
      icon: BookOpen,
      tile: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400',
      label: tr('ชิ้นงาน', 'Assignment'),
      hint: tr('นักเรียนส่งข้อความ รูป หรือไฟล์ได้', 'Students answer with text, photos or files'),
      onSelect: () => go(query({ mode: 'homework' })),
    },
    {
      key: 'quiz',
      icon: ShieldAlert,
      tile: 'bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400',
      label: tr('ข้อสอบ', 'Quiz'),
      hint: tr('จับเวลา บันทึกการออกจากหน้าจอ', 'Timed, screen exits are logged'),
      onSelect: () => go(query({ mode: 'quiz' })),
    },
    {
      key: 'survey',
      icon: ClipboardList,
      tile: 'bg-teal-50 dark:bg-teal-950/50 text-teal-600 dark:text-teal-400',
      label: tr('แบบสอบถาม', 'Survey'),
      hint: tr('ไม่มีคะแนน', 'No scores'),
      onSelect: () => go(query({ mode: 'survey' })),
    },
    {
      key: 'retake',
      icon: RotateCcw,
      tile: 'bg-orange-50 dark:bg-orange-950/50 text-orange-600 dark:text-orange-400',
      label: tr('สอบซ่อม', 'Retake quiz'),
      hint: tr('เฉพาะนักเรียนที่เลือก คะแนนแทนของเดิม', 'Chosen students; replaces their score'),
      onSelect: () => {
        closeMenu();
        setRetakeOpen(origin());
      },
    },
    {
      key: 'reuse',
      icon: Copy,
      tile: 'bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400',
      label: tr('ใช้งานเดิม', 'Reuse earlier work'),
      hint: tr('เลือกงานจากห้องอื่นหรือภาคเรียนก่อน', 'From another classroom or term'),
      onSelect: () => {
        closeMenu();
        setPickerOpen(true);
      },
    },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? closeMenu() : openMenu())}
        className={className}
      >
        {children}
      </button>

      {rendered &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={tr('สร้างอะไร', 'Create')}
            style={{
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              width: Math.min(MENU_WIDTH, typeof window !== 'undefined' ? window.innerWidth - VIEWPORT_MARGIN * 2 : MENU_WIDTH),
              transformOrigin: `${position?.originX ?? MENU_WIDTH / 2}px ${position?.above ? '100%' : '0%'}`,
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])];
              const index = items.indexOf(document.activeElement as HTMLElement);
              items[(index + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
            }}
            className={`fixed z-90 p-1.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-900/10 dark:shadow-black/40 will-change-[transform,opacity] motion-reduce:transition-none ${
              shown
                ? 'opacity-100 scale-100 translate-y-0 transition-[opacity,scale,translate] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]'
                : `opacity-0 scale-95 ${position?.above ? 'translate-y-1' : '-translate-y-1'} pointer-events-none transition-[opacity,scale,translate] duration-[130ms] ease-in`
            }`}
          >
            {options.map((option) => {
              const Icon = option.icon;
              return (
                <div key={option.key}>
                  {option.key === 'retake' && <div className="my-1 mx-2 border-t border-slate-100 dark:border-slate-800" aria-hidden="true" />}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={option.onSelect}
                    className="w-full p-2 rounded-xl flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/70 focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/70 focus:outline-hidden cursor-pointer"
                  >
                    <span className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center ${option.tile}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-bold text-slate-900 dark:text-white">{option.label}</span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 truncate">{option.hint}</span>
                    </span>
                    {(option.key === 'reuse' || option.key === 'retake') && <ChevronRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0" />}
                  </button>
                </div>
              );
            })}
          </div>,
          document.body
        )}

      {retakeOpen && (
        <RetakePicker
          classroomId={classroomId}
          from={retakeOpen.from}
          returnTo={retakeOpen.returnTo}
          onNavigate={onNavigate}
          onClose={() => setRetakeOpen(null)}
        />
      )}
      {pickerOpen && <ReuseWorkPicker targetClassroomId={classroomId} onPick={pick} onClose={closePicker} />}
    </>
  );
}
