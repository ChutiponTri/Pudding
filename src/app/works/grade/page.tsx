'use client';

import { Suspense } from 'react';
import { CombinedGrading } from '@/components/works/CombinedGrading';

/** /works/grade?ids=<assignment ids> — one work's students from all its classrooms. */
export default function CombinedGradingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50dvh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <CombinedGrading />
    </Suspense>
  );
}
