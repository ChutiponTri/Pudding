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

  if (isLiff) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen flex flex-col transition-[padding] duration-300 ease-in-out">
      <GlobalClassroomSidebar />
      <div className={`flex flex-col flex-1 transition-[padding] duration-300 ease-in-out ${isOpen ? 'md:pl-80' : 'pl-0'}`}>
        <Navbar />
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 transition-all duration-300">
          {children}
        </main>
      </div>
    </div>
  );
};
