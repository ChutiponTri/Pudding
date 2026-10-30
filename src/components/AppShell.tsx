'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { useSidebar } from '@/components/SidebarContext';
import { GlobalClassroomSidebar } from '@/components/GlobalClassroomSidebar';
import { Navbar } from '@/components/Navbar';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname();
  const { isOpen } = useSidebar();
  const isLiff = pathname.startsWith('/liff');
  // The admin console has its own header and no classroom sidebar.
  const isAdmin = pathname.startsWith('/admin');
  // Key for the route fade. Clerk's catch-all auth routes change the path between
  // steps (e.g. /sign-in/factor-one); remounting there would reset the sign-in flow.
  const routeKey = pathname.match(/^\/(sign-in|sign-up)(\/|$)/)?.[1] ?? pathname;

  if (isLiff || isAdmin) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <GlobalClassroomSidebar />
      {/* The sidebar pushes content only on desktop; on phones and iPads it
          overlays the page so the workspace keeps its full width. */}
      <div className={`flex flex-col flex-1 min-w-0 transition-[padding] duration-300 ease-in-out ${isOpen ? 'lg:pl-80' : 'pl-0'}`}>
        <Navbar />
        <main className="flex-1 max-w-7xl w-full min-w-0 mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
          {/* Each route fades in on navigation. Opacity only: a transform here would
              re-anchor the pages' fixed bars and modals while it runs. */}
          <div key={routeKey} className="animate-in fade-in [--tw-duration:280ms]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};
