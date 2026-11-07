'use client';

import { Suspense } from 'react';
import { CombinedGrading } from '@/components/works/CombinedGrading';
import { PageSkeleton } from '@/components/LoadingState';

/** /works/grade?ids=<assignment ids> — one work's students from all its classrooms. */
export default function CombinedGradingPage() {
  return (
    <Suspense
      fallback={<PageSkeleton variant="grading" />}
    >
      <CombinedGrading />
    </Suspense>
  );
}
