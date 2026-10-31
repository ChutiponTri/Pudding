'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';

interface SidebarContextType {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  closeSidebar: () => void;
}

const SidebarContext = createContext<SidebarContextType>({
  isOpen: false,
  setIsOpen: () => {},
  toggleSidebar: () => {},
  closeSidebar: () => {},
});

export const useSidebar = () => useContext(SidebarContext);

// Desktop is where the sidebar sits beside the page (Tailwind `lg`).
const DESKTOP_QUERY = '(min-width: 1024px)';
// Remembers the last open/closed choice made on desktop only.
const STORAGE_KEY = 'pudding:sidebar-open';

const isDesktop = () =>
  typeof window !== 'undefined' && window.matchMedia(DESKTOP_QUERY).matches;

const readDesktopPreference = (): boolean => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
};

const writeDesktopPreference = (open: boolean) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(open));
  } catch {
    // Storage unavailable (private mode etc.) — fall back to the default next time.
  }
};

export const SidebarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Start closed so server and first client render match; the effect below
  // opens it on desktop after mount.
  const [isOpen, setIsOpenState] = useState(false);
  const pathname = usePathname();

  const setIsOpen = useCallback((open: boolean) => {
    setIsOpenState(open);
    if (isDesktop()) writeDesktopPreference(open);
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsOpenState((prev) => {
      const next = !prev;
      if (isDesktop()) writeDesktopPreference(next);
      return next;
    });
  }, []);

  const closeSidebar = useCallback(() => setIsOpen(false), [setIsOpen]);

  // Desktop: open by default unless the user closed it last time.
  // Phones and iPads: always start closed since the sidebar overlays the page.
  useEffect(() => {
    // After mount only: the server render can't know the screen size or storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isDesktop()) setIsOpenState(readDesktopPreference());
  }, []);

  // Listen to legacy custom event for backward compatibility
  useEffect(() => {
    const handleToggle = () => toggleSidebar();
    window.addEventListener('toggle-classroom-sidebar', handleToggle);
    return () => window.removeEventListener('toggle-classroom-sidebar', handleToggle);
  }, [toggleSidebar]);

  // Auto-close on route navigation when the sidebar overlays the page (< 1024px)
  useEffect(() => {
    if (typeof window !== 'undefined' && !isDesktop()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsOpenState(false);
    }
  }, [pathname]);

  return (
    <SidebarContext.Provider value={{ isOpen, setIsOpen, toggleSidebar, closeSidebar }}>
      {children}
    </SidebarContext.Provider>
  );
};
