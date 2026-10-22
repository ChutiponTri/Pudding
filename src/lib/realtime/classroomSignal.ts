import 'server-only';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { classroomSignalChannel, type ClassroomSignal } from '@/lib/realtime/signals';

/**
 * Tells pages that have this classroom open that something changed, so they
 * refetch once instead of polling. Sent over Supabase Realtime broadcast (REST,
 * no socket), which needs no table publication or RLS access. Best effort.
 */
export async function signalClassroom(classroomId: string | null | undefined, signal: ClassroomSignal) {
  if (!classroomId) return;
  try {
    const supabase = createServiceSupabaseClient();
    const channel = supabase.channel(classroomSignalChannel(classroomId));
    try {
      await channel.httpSend(signal.type, signal, { timeout: 3000 });
    } finally {
      await supabase.removeChannel(channel);
    }
  } catch (error) {
    console.warn('Classroom signal failed:', error);
  }
}
