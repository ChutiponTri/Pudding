'use client';

import Image from 'next/image';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import logoTh from '../../public/brand/logo-th.png';
import logoEn from '../../public/brand/logo-en.png';

/**
 * The Pudding logo (mascot + name) in the interface language: "พุดดิ้ง" in
 * Thai, "Pudding" in English. Transparent copies of public/logo-th.jpg and
 * public/logo-en.png (see public/brand), so it sits on light and dark themes.
 * Size it by height, e.g. className="h-11 w-auto".
 */
export function BrandLogo({ className = 'h-10 w-auto', priority = false }: { className?: string; priority?: boolean }) {
  const { language } = useLanguage();
  const th = language === 'th';
  return (
    <Image
      src={th ? logoTh : logoEn}
      alt={th ? 'พุดดิ้ง' : 'Pudding'}
      priority={priority}
      sizes="160px"
      draggable={false}
      className={`select-none ${className}`}
    />
  );
}
