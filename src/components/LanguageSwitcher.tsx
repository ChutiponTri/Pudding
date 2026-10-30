'use client';

import React from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Globe } from 'lucide-react';

export const LanguageSwitcher: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { language, setLanguage } = useLanguage();
  const isThai = language === 'th';

  return (
    <>
    {/* Phones: one round button like the theme toggle, showing the current
        language; each tap swaps to the other one. */}
    <button
      type="button"
      onClick={() => setLanguage(isThai ? 'en' : 'th')}
      className={`md:hidden p-2 rounded-full border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all cursor-pointer ${className}`}
      aria-label={isThai ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
      title={isThai ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
    >
      <span className="w-4 h-4 flex items-center justify-center text-sm leading-none">{isThai ? '🇹🇭' : '🇬🇧'}</span>
    </button>

    <div
      className={`hidden md:inline-flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700 text-xs font-medium ${className}`}
      role="group"
      aria-label="Language Selector"
    >
      <div className="pl-1.5 pr-0.5 text-slate-400 dark:text-slate-500">
        <Globe className="w-3.5 h-3.5" />
      </div>
      <button
        type="button"
        onClick={() => setLanguage('th')}
        className={`px-2.5 py-1 rounded-full transition-all duration-200 flex items-center gap-1 ${
          language === 'th'
            ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 font-bold shadow-xs'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
        }`}
        title="ภาษาไทย (ค่าเริ่มต้น)"
      >
        <span>🇹🇭</span>
        <span>ไทย</span>
      </button>
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={`px-2.5 py-1 rounded-full transition-all duration-200 flex items-center gap-1 ${
          language === 'en'
            ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400 font-bold shadow-xs'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
        }`}
        title="English"
      >
        <span>🇬🇧</span>
        <span>EN</span>
      </button>
    </div>
    </>
  );
};
