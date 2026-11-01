import 'server-only';
import { cookies } from 'next/headers';
import { LANGUAGE_COOKIE } from '@/lib/i18n/languageCookie';

export type AdminLang = 'th' | 'en';

/** The admin's language (set by the language switcher; Thai by default). */
export async function getAdminLang(): Promise<AdminLang> {
  return (await cookies()).get(LANGUAGE_COOKIE)?.value === 'en' ? 'en' : 'th';
}

/** Inline bilingual text for server components, like useLanguage().tr. */
export const translator = (lang: AdminLang) => <T,>(thai: T, english: T): T => (lang === 'en' ? english : thai);
