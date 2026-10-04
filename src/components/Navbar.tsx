'use client';

import React, { useEffect } from 'react';
import { useUser, UserButton, Show } from '@clerk/nextjs';
import { dataService } from '@/lib/supabase/dataService';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeToggle } from './ThemeToggle';
import {
  Sparkles,
  LayoutDashboard,
  School,
  PlusCircle,
  FileCheck2,
  Bell,
  LogIn,
  Smartphone,
} from 'lucide-react';
import { mockTeacher } from '@/lib/supabase/mockData';

export const Navbar: React.FC = () => {
  const pathname = usePathname();
  const { t, language } = useLanguage();
  const { user, isSignedIn, isLoaded } = useUser();

  useEffect(() => {
    if (isSignedIn && user) {
      dataService.syncClerkUser({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        imageUrl: user.imageUrl,
        email: user.primaryEmailAddress?.emailAddress,
      }).catch((err: unknown) => console.error("Error syncing clerk user:", err));
    }
  }, [isSignedIn, user]);

  if (pathname.startsWith('/liff')) {
    return null;
  }

  const navItems = [
    {
      href: '/dashboard',
      label: t('nav.dashboard'),
      icon: LayoutDashboard,
      isActive: pathname === '/' || pathname === '/dashboard',
    },
    {
      href: '/creation',
      label: t('dashboard.quick_actions.create_assignment'),
      icon: PlusCircle,
      isActive: pathname === '/creation' || pathname === '/assignments/new',
    },
    {
      href: '/grading',
      label: language === 'th' ? 'ตรวจข้อสอบ & วิเคราะห์' : 'Grading & Integrity',
      icon: FileCheck2,
      isActive: pathname.startsWith('/grading') || pathname.includes('/grading'),
    },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        {/* Brand Logo - Pudding (พุดดิ้ง) */}
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-600 via-amber-500 to-yellow-400 flex items-center justify-center shadow-lg shadow-amber-500/25 ring-2 ring-amber-400/30 group-hover:scale-105 group-hover:-rotate-3 transition-all duration-300">
            <span className="text-2xl select-none group-hover:scale-110 transition-transform">🍮</span>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-black text-lg tracking-tight text-slate-900 dark:text-white">
                {language === 'th' ? 'พุดดิ้ง' : 'Pudding'}
              </span>
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/60">
                Platform
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium line-clamp-1">
              {t('brand.subtitle')}
            </p>
          </div>
        </Link>

        {/* Center Navigation Links */}
        <nav className="hidden md:flex items-center gap-1 bg-slate-100/80 dark:bg-slate-800/60 p-1 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all ${
                  item.isActive
                    ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-slate-800/80'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right Section: Theme Toggle, Language Switcher, Alerts & Profile */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Light / Dark Mode Toggle */}
          <ThemeToggle />

          {/* Language Switcher */}
          <LanguageSwitcher />

          {/* Notification Button */}
          <button
            type="button"
            className="relative p-2 rounded-xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title={t('nav.notifications')}
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-900 animate-pulse" />
          </button>

          {/* Teacher Profile Avatar / Clerk Authentication */}
          <Show when={"signed-in"}>
            <div className="flex items-center gap-2.5 pl-2 border-l border-slate-200 dark:border-slate-800">
              <UserButton
                appearance={{
                  elements: {
                    userButtonAvatarBox: "w-8 h-8 ring-2 ring-amber-500/40",
                  },
                }}
              />
              <div className="hidden lg:block text-left">
                <span className="block text-xs font-bold text-slate-800 dark:text-slate-200 leading-tight">
                  {user?.fullName || user?.firstName || t("nav.demo_teacher")}
                </span>
                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                  {t("nav.teacher_role")}
                </span>
              </div>
            </div>
          </Show>

          <Show when={"signed-out"}>
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
              <Link
                href="/sign-in"
                className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>{language === "th" ? "เข้าสู่ระบบ" : "Sign In"}</span>
              </Link>
            </div>
          </Show>
        </div>
      </div>
    </header>
  );
};
