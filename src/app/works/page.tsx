'use client';

import { Suspense } from 'react';
import { WorksBoard } from '@/components/works/WorksBoard';

/** Every assignment and quiz of the term, across classrooms (linked from the dashboard). */
export default function WorksPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50dvh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <WorksBoard />
    </Suspense>
  );
}
