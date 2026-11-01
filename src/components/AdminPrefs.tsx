'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useLanguage } from '@/lib/i18n/LanguageContext';

/**
 * Theme toggle and language switcher for the admin header. Admin pages are
 * rendered on the server in the language of the `pudding_lang` cookie, so when
 * the chosen language differs from what the server rendered (switched here, or
 * restored from this browser's saved choice) the page is rendered again.
 */
export function AdminPrefs({ serverLang }: { serverLang: 'th' | 'en' }) {
  const router = useRouter();
  const { language, isLoaded } = useLanguage();

  useEffect(() => {
    if (isLoaded && language !== serverLang) router.refresh();
  }, [isLoaded, language, serverLang, router]);

  return (
    <div className="flex items-center gap-1.5 p-1 rounded-full bg-white/10 ring-1 ring-white/10">
      <LanguageSwitcher />
      <ThemeToggle />
    </div>
  );
}
