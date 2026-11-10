'use client';

import React, { useEffect, useState, useRef, useSyncExternalStore } from 'react';
import { useUser, UserButton, Show } from '@clerk/nextjs';
import { notificationManager, AppNotification } from '@/lib/utils/notificationManager';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { useSidebar } from '@/components/SidebarContext';
import { BrandLogo } from './BrandLogo';
import { ThemeToggle } from './ThemeToggle';
import {
  Bell,
  GraduationCap,
  LogIn,
  Menu,
} from 'lucide-react';
import { studentLoginUrl } from '@/lib/line/liffLink';

const noopSubscribe = () => () => {};

/**
 * The section beside the logo, from the route: short and always current.
 * Order matters (first match wins). Null = show nothing (landing, sign-in).
 */
const SECTIONS: Array<{ test: (path: string) => boolean; th: string; en: string }> = [
  { test: (p) => p.startsWith('/dashboard'), th: 'แดชบอร์ด', en: 'Dashboard' },
  { test: (p) => p.startsWith('/works/grade') || p.startsWith('/grading') || /^\/assignments\/[^/]+\/grading/.test(p), th: 'ตรวจงาน', en: 'Grading' },
  { test: (p) => p.startsWith('/assignments/new') || p.startsWith('/creation'), th: 'งานและข้อสอบ', en: 'Work' },
  { test: (p) => p.startsWith('/works'), th: 'งานทั้งหมด', en: 'All work' },
  { test: (p) => p.startsWith('/classrooms'), th: 'ห้องเรียน', en: 'Classrooms' },
  { test: (p) => p.startsWith('/students'), th: 'นักเรียน', en: 'Students' },
  { test: (p) => p.startsWith('/exports'), th: 'ส่งออกข้อมูล', en: 'Export' },
  { test: (p) => p.startsWith('/teacher-invite'), th: 'คำเชิญครู', en: 'Invite' },
  { test: (p) => p.startsWith('/pending-approval'), th: 'รออนุมัติ', en: 'Pending' },
  { test: (p) => p.startsWith('/admin'), th: 'ผู้ดูแลระบบ', en: 'Admin' },
];

export const Navbar: React.FC = () => {
  const pathname = usePathname();
  const { t, tr, language } = useLanguage();
  const { user, isSignedIn, isLoaded } = useUser();
  const { toggleSidebar } = useSidebar();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  // Read the browser permission after hydration ('default' on the server), then
  // let a granted/denied answer from the prompt override it.
  const initialPerm = useSyncExternalStore(
    noopSubscribe,
    () => notificationManager.getPermissionStatus(),
    () => 'default' as NotificationPermission
  );
  const [requestedPerm, setBrowserPerm] = useState<NotificationPermission | null>(null);
  const browserPerm = requestedPerm ?? initialPerm;
  const notificationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = notificationManager.subscribe((items) => {
      setNotifications(items);
    });
    return unsub;
  }, []);

  // Close notification popover when clicking anywhere outside
  useEffect(() => {
    if (!isNotificationOpen) return;
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setIsNotificationOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isNotificationOpen]);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const section = SECTIONS.find((s) => s.test(pathname)) || null;

  // Signing in syncs the users row in TeacherProfileGate (AppShell).

  if (pathname.startsWith('/liff')) {
    return null;
  }

  return (
    <header className="sticky top-0 z-30 w-full border-b border-slate-200/70 dark:border-slate-800/80 bg-white/80 dark:bg-slate-950/75 backdrop-blur-xl supports-backdrop-filter:bg-white/65 dark:supports-backdrop-filter:bg-slate-950/60 transition-colors pt-[env(safe-area-inset-top)]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left Section: Sidebar Toggle Button + Brand Logo */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink-0 min-[420px]:shrink">
          <button
            type="button"
            onClick={toggleSidebar}
            className="p-2 -ml-2 rounded-xl text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            title={tr('เปิด/ปิดแถบเมนูห้องเรียนและวิชา', 'Toggle the classroom & course sidebar')}
            aria-label="Toggle classroom sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Brand Logo - Pudding (พุดดิ้ง) */}
          <Link
            href={isSignedIn ? "/dashboard" : "/"}
            aria-label={language === 'th' ? 'พุดดิ้ง หน้าหลัก' : 'Pudding home'}
            className="flex items-center gap-3 group min-w-0"
          >
            <BrandLogo priority className="h-11 sm:h-12 w-auto shrink-0 group-hover:scale-105 group-hover:-rotate-2 transition-transform duration-300" />
            {/* Current section, sized to sit beside the logo; fades in on each change. */}
            {section && (
              <span
                key={section.th}
                className="hidden md:block self-center border-l-2 border-slate-200 dark:border-slate-700 pl-3 text-xl font-black tracking-tight leading-8 text-slate-900 dark:text-white whitespace-nowrap truncate max-w-64 animate-in fade-in slide-in-from-left-1 [--tw-duration:250ms]"
              >
                {tr(section.th, section.en)}
              </span>
            )}
          </Link>
        </div>

        {/* Right Section: Theme Toggle, Alerts & Profile */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Light / Dark Mode Toggle (hidden below 360px to keep the bar on one line) */}
          <ThemeToggle />

          {/* Notification Button & Popover (only meaningful once signed in) */}
          <Show when={"signed-in"}>
          <div className="relative" ref={notificationRef}>
            <button
              type="button"
              onClick={() => setIsNotificationOpen(!isNotificationOpen)}
              className="relative p-2 rounded-full text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title={t('nav.notifications')}
              aria-label={t('nav.notifications')}
              aria-expanded={isNotificationOpen}
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4.5 h-4.5 px-1 flex items-center justify-center text-[10px] leading-none font-black rounded-full bg-rose-500 text-white ring-2 ring-white dark:ring-slate-950">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* Notification Dropdown Popover */}
            {isNotificationOpen && (
              <div className="fixed inset-x-3 top-[calc(4rem+env(safe-area-inset-top))] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl shadow-slate-900/10 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">
                <div className="p-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-amber-500" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      {language === 'th' ? 'การแจ้งเตือน' : 'Notifications'}
                    </span>
                    {unreadCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px] font-bold">
                        {unreadCount} {tr('ใหม่', 'new')}
                      </span>
                    )}
                  </div>
                  {notifications.length > 0 && (
                    <button
                      type="button"
                      onClick={() => notificationManager.markAllAsRead()}
                      className="text-[11px] text-amber-600 hover:text-amber-700 dark:text-amber-400 font-semibold cursor-pointer"
                    >
                      {language === 'th' ? 'อ่านทั้งหมด' : 'Mark all read'}
                    </button>
                  )}
                </div>

                {/* Browser Native Notification Permission Prompt */}
                {browserPerm !== 'granted' && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200/60 dark:border-amber-900/60 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-amber-900 dark:text-amber-200">
                      {language === 'th' ? '🔔 เปิดแจ้งเตือนบนหน้าจอ' : '🔔 Enable desktop alerts'}
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        const perm = await notificationManager.requestBrowserPermission();
                        setBrowserPerm(perm);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 text-[10px] font-bold cursor-pointer shrink-0"
                    >
                      {language === 'th' ? 'เปิดใช้งาน' : 'Enable'}
                    </button>
                  </div>
                )}

                {/* Notifications List */}
                <div className="max-h-[min(20rem,60dvh)] overflow-y-auto overscroll-contain divide-y divide-slate-100 dark:divide-slate-800/60">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">
                      {language === 'th' ? 'ยังไม่มีการแจ้งเตือน' : 'No notifications yet'}
                    </div>
                  ) : (
                    notifications.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => notificationManager.markAsRead(item.id)}
                        className={`p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer ${
                          !item.read ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-bold text-slate-900 dark:text-white">
                            {item.title}
                          </p>
                          <span className="text-[10px] text-slate-400 whitespace-nowrap">
                            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                          {item.message}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          </Show>

          {/* Teacher Profile Avatar / Clerk Authentication */}
          <Show when={"signed-in"}>
            <div className="flex items-center gap-2.5 pl-1.5 sm:pl-3 border-l border-slate-200 dark:border-slate-800">
              <UserButton
                appearance={{
                  elements: {
                    userButtonAvatarBox: "w-8 h-8 ring-2 ring-amber-500/40",
                  },
                }}
              />
              <div className="hidden md:block text-left">
                <span className="block text-xs font-bold text-slate-800 dark:text-slate-200 leading-tight">
                  {user?.fullName || user?.firstName || tr('กำลังโหลด...', 'Loading...')}
                </span>
                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                  {t("nav.teacher_role")}
                </span>
              </div>
            </div>
          </Show>

          <Show when={"signed-out"}>
            {/* Phones show just "ครู" / "นักเรียน"; the login icon carries the meaning */}
            <div className="flex items-center gap-1.5 sm:gap-2 pl-1.5 sm:pl-2 border-l border-slate-200 dark:border-slate-800">
              <Link
                href="/sign-in"
                className="h-8 px-3 sm:px-3.5 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shadow-sm shadow-amber-500/30 transition-all flex items-center gap-1.5 cursor-pointer active:scale-[0.98] whitespace-nowrap"
              >
                <LogIn className="w-3.5 h-3.5 shrink-0" />
                <span className="sm:hidden">{language === "th" ? "ครู" : "Teacher"}</span>
                <span className="hidden sm:inline">{language === "th" ? "เข้าสู่ระบบครู" : "Teacher login"}</span>
              </Link>
              <a
                href={studentLoginUrl()}
                className="h-8 px-3 sm:px-3.5 rounded-full bg-line hover:bg-line-dark text-white font-bold text-xs shadow-sm shadow-emerald-600/25 transition-all flex items-center gap-1.5 cursor-pointer active:scale-[0.98] whitespace-nowrap"
              >
                <GraduationCap className="w-3.5 h-3.5 shrink-0" />
                <span className="sm:hidden">{language === "th" ? "นักเรียน" : "Student"}</span>
                <span className="hidden sm:inline">{language === "th" ? "เข้าสู่ระบบนักเรียน" : "Student login"}</span>
              </a>
            </div>
          </Show>
        </div>
      </div>
    </header>
  );
};
