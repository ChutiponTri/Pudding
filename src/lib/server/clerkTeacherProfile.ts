import 'server-only';
import { clerkClient } from '@clerk/nextjs/server';

/**
 * The teacher profile as Clerk holds it. Name lives in Clerk's own
 * firstName/lastName; the institution lives in publicMetadata (editable in the
 * Clerk dashboard under the user's metadata, not by the user's browser).
 * `profileSyncedAt` marks accounts whose Pudding profile has been written to
 * Clerk; from then on Clerk is the copy other systems read from.
 */
export interface ClerkTeacherProfile {
  first_name: string;
  last_name: string;
  institution: string;
  email: string;
  image_url: string;
  synced: boolean;
}

export async function readClerkTeacherProfile(userId: string): Promise<ClerkTeacherProfile | null> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const meta = (user.publicMetadata || {}) as { institution?: unknown; profileSyncedAt?: unknown };
    return {
      first_name: user.firstName?.trim() || '',
      last_name: user.lastName?.trim() || '',
      institution: typeof meta.institution === 'string' ? meta.institution.trim() : '',
      email: user.primaryEmailAddress?.emailAddress || '',
      image_url: user.imageUrl || '',
      synced: Boolean(meta.profileSyncedAt),
    };
  } catch (error) {
    // Clerk being unreachable must not block sign-in; the users row still works.
    console.warn('Read Clerk teacher profile failed:', error);
    return null;
  }
}

export async function pushTeacherProfileToClerk(
  userId: string,
  profile: { first_name: string; last_name: string; institution: string }
): Promise<void> {
  try {
    const client = await clerkClient();
    await client.users.updateUser(userId, { firstName: profile.first_name, lastName: profile.last_name });
    await client.users.updateUserMetadata(userId, {
      publicMetadata: { institution: profile.institution, profileSyncedAt: new Date().toISOString() },
    });
  } catch (error) {
    // Pudding's row is already saved; the next sign-in retries (profileSyncedAt stays unset).
    console.warn('Push teacher profile to Clerk failed:', error);
  }
}
