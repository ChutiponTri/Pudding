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

/** Clerk photo URLs by user id, kept briefly so every page load does not ask Clerk again. */
const IMAGE_TTL_MS = 10 * 60 * 1000;
const imageCache = new Map<string, { url: Promise<string>; at: number }>();

/**
 * Teachers' current Clerk profile photos ('' when Clerk has none or cannot be
 * reached), so co-teacher lists show the same picture as Clerk does. One
 * Clerk request for all ids not cached yet; parallel callers share it.
 */
export async function clerkImageUrls(userIds: string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const ids = [...new Set(userIds.filter((id) => id?.startsWith('user_')))];
  const missing = ids.filter((id) => {
    const hit = imageCache.get(id);
    return !hit || now - hit.at > IMAGE_TTL_MS;
  });
  if (missing.length) {
    const batch = (async () => {
      const found = new Map<string, string>();
      try {
        const client = await clerkClient();
        for (let i = 0; i < missing.length; i += 100) {
          const { data } = await client.users.getUserList({ userId: missing.slice(i, i + 100), limit: 100 });
          for (const user of data) found.set(user.id, user.imageUrl || '');
        }
      } catch (error) {
        console.warn('Read Clerk photos failed:', error);
        // Not cached on failure, so the next request tries again.
        for (const id of missing) imageCache.delete(id);
      }
      return found;
    })();
    for (const id of missing) imageCache.set(id, { url: batch.then((found) => found.get(id) ?? ''), at: now });
  }
  const urls = await Promise.all(ids.map(async (id) => [id, await (imageCache.get(id)?.url ?? Promise.resolve(''))] as const));
  return new Map(urls);
}
