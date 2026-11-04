'use client';

import { useEffect } from 'react';

const SITE_NAME = 'Pudding';

/**
 * Browser tab title for a page that only knows its name after loading (a
 * classroom, an assignment): "<name> | Pudding". Until then, and after the
 * page closes, the route's own title (its layout's metadata) shows.
 */
export function usePageTitle(name: string | null | undefined) {
  useEffect(() => {
    const text = name?.trim();
    if (!text) return;
    const fallback = document.title;
    const mine = `${text} | ${SITE_NAME}`;
    document.title = mine;
    return () => {
      // Only undo our own title: the next page may already have set its own.
      if (document.title === mine) document.title = fallback;
    };
  }, [name]);
}
