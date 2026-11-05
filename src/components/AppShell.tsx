'use client';

import React, { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useSidebar } from '@/components/SidebarContext';
import { GlobalClassroomSidebar } from '@/components/GlobalClassroomSidebar';
import { Navbar } from '@/components/Navbar';
import { SessionCacheSync } from '@/components/SessionCacheSync';
import { LineSharePopup } from '@/components/LineSharePopup';
import { UnsentReminderNotice } from '@/components/UnsentReminderNotice';
import { PENDING_APPROVAL_PATH, TeacherProfileGate } from '@/components/TeacherProfileGate';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const { isOpen } = useSidebar();
  const isLiff = pathname.startsWith('/liff');
  // The admin console has its own header and no classroom sidebar.
  const isAdmin = pathname.startsWith('/admin');
  // Key for the route fade. Clerk's catch-all auth routes change the path between
  // steps (e.g. /sign-in/factor-one); remounting there would reset the sign-in flow.
  const routeKey = pathname.match(/^\/(sign-in|sign-up)(\/|$)/)?.[1] ?? pathname;

  // Teacher pages: fields keep their designed (small) text on phones. iOS zooms
  // into a focused field under 16px, so there the page's zoom is capped at 1 —
  // Safari still lets people pinch-zoom, it only stops the jump on focus.
  // The student app (/liff, inside LINE) keeps 16px fields instead: LINE's
  // browser would honour the cap and block pinch-zoom.
  useEffect(() => {
    const root = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const original = meta?.getAttribute('content') ?? '';
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isLiff) {
      root.classList.remove('compact-fields');
      return;
    }
    root.classList.add('compact-fields');
    if (isIOS && meta && !/maximum-scale/.test(original)) meta.setAttribute('content', `${original}, maximum-scale=1`);
    return () => {
      root.classList.remove('compact-fields');
      if (meta) meta.setAttribute('content', original);
    };
  }, [isLiff]);

  if (isLiff) {
    return <>{children}</>;
  }
  // Waiting for the admin's approval: no sidebar or navbar (they would load classroom data).
  if (pathname === PENDING_APPROVAL_PATH) {
    return (
      <>
        <TeacherProfileGate />
        {children}
      </>
    );
  }
  if (isAdmin) {
    return (
      <>
        <SessionCacheSync />
        {children}
      </>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <SessionCacheSync />
      {/* Every teacher page waits until name, last name and institution are set
          and the admin has approved the account. */}
      <TeacherProfileGate />
      <GlobalClassroomSidebar />
      {/* A post the bot could not send to LINE: share it from the teacher's own LINE. */}
      <LineSharePopup />
      {/* Deadline reminders the bot could not send (quota): offered in the same popup. */}
      <UnsentReminderNotice />
      {/* The sidebar pushes content only on desktop; on phones and iPads it
          overlays the page so the workspace keeps its full width. */}
      <div className={`flex flex-col flex-1 min-w-0 transition-[padding] duration-300 ease-in-out ${isOpen ? 'lg:pl-80' : 'pl-0'}`}>
        <Navbar />
        <main className="flex-1 max-w-7xl w-full min-w-0 mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
          {/* Each route fades in on navigation. Opacity only: a transform here would
              re-anchor the pages' fixed bars and modals while it runs. */}
          <div key={routeKey} className="animate-fade [--tw-duration:280ms]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};
