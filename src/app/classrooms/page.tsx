'use client';

import { Suspense } from 'react';
import { TeacherWorkspace } from '@/components/teacher/TeacherWorkspace';
import { useSemesterParam } from '@/lib/hooks/useSemesterParam';

/** Every classroom the teacher teaches, with the same management tools as the dashboard. */
function ClassroomsContent() {
  const { semesterKey, setSemesterKey } = useSemesterParam();
  return <TeacherWorkspace view="classrooms" initialSemesterKey={semesterKey} onSemesterChange={setSemesterKey} />;
}

export default function ClassroomsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[50dvh] flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <ClassroomsContent />
    </Suspense>
  );
}
