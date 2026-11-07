'use client';

import { Suspense } from 'react';
import { WorksBoard } from '@/components/works/WorksBoard';
import { PageSkeleton } from '@/components/LoadingState';

/** Every assignment and quiz of the term, across classrooms (linked from the dashboard). */
export default function WorksPage() {
  return (
    <Suspense
      fallback={<PageSkeleton variant="list" />}
    >
      <WorksBoard />
    </Suspense>
  );
}
