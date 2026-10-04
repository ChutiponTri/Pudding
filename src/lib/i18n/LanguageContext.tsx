'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import th from './th.json';
import en from './en.json';

export type Language = 'th' | 'en';

type Translations = typeof th;

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (path: string, fallback?: string) => string;
  isLoaded: boolean;
}

const dictionaries: Record<Language, Translations> = {
  th,
  en,
};

const LanguageContext = createContext<LanguageContextType>({
  language: 'th',
  setLanguage: () => {},
  t: (path: string, fallback?: string) => fallback || path,
  isLoaded: false,
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Thai MUST be set as the DEFAULT language per user prompt
  const [language, setLanguageState] = useState<Language>('th');
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    try {
      const savedLang = localStorage.getItem('ag_platform_lang') as Language | null;
      if (savedLang && (savedLang === 'th' || savedLang === 'en')) {
        setLanguageState(savedLang);
      }
    } catch {
      // ignore SSR or restricted localStorage
    }
    setIsLoaded(true);
  }, []);

  const setLanguage = (newLang: Language) => {
    setLanguageState(newLang);
    try {
      localStorage.setItem('ag_platform_lang', newLang);
      document.documentElement.lang = newLang;
    } catch {
      // ignore
    }
  };

  const t = (path: string, fallback?: string): string => {
    const dict = dictionaries[language] || dictionaries.th;
    const parts = path.split('.');
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = dict;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        // Fallback to Thai if missing in current dictionary
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let thCurrent: any = dictionaries.th;
        for (const thPart of parts) {
          if (thCurrent && typeof thCurrent === 'object' && thPart in thCurrent) {
            thCurrent = thCurrent[thPart];
          } else {
            return fallback || path;
          }
        }
        return typeof thCurrent === 'string' ? thCurrent : fallback || path;
      }
    }

    return typeof current === 'string' ? current : fallback || path;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, isLoaded }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
