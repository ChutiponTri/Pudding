'use client';

import { Suspense } from 'react';
import { TeacherWorkspace } from '@/components/teacher/TeacherWorkspace';
import { useSemesterParam } from '@/lib/hooks/useSemesterParam';
import { PageSkeleton } from '@/components/LoadingState';

/** Every classroom the teacher teaches, with the same management tools as the dashboard. */
function ClassroomsContent() {
  const { semesterKey, setSemesterKey } = useSemesterParam();
  return <TeacherWorkspace view="classrooms" initialSemesterKey={semesterKey} onSemesterChange={setSemesterKey} />;
}

export default function ClassroomsPage() {
  return (
    <Suspense
      fallback={<PageSkeleton variant="dashboard" />}
    >
      <ClassroomsContent />
    </Suspense>
  );
}
