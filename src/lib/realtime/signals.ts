/** Broadcast events about one classroom (shared by the server sender and browser listeners). */
export type ClassroomSignal =
  | { type: 'submission'; assignmentId: string }
  | { type: 'timeline' }
  | { type: 'published'; assignmentId?: string };

export const classroomSignalChannel = (classroomId: string) => `classroom-signal:${classroomId}`;
