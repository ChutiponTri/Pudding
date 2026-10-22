/** Broadcast events about one classroom (shared by the server sender and browser listeners). */
export type ClassroomSignal =
  | { type: 'submission'; assignmentId: string }
  | { type: 'timeline' }
  | { type: 'published'; assignmentId?: string }
  | { type: 'attendance' }
  /** Roster changed; `student`/`autoAdmit`/`action` let the dashboard show a join notice. */
  | {
      type: 'roster';
      action?: 'joined' | 'admitted' | 'rejected' | 'removed' | 'updated';
      autoAdmit?: boolean;
      student?: { id?: string; first_name?: string; last_name?: string };
    };

export const classroomSignalChannel = (classroomId: string) => `classroom-signal:${classroomId}`;
