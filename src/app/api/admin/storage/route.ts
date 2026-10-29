import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { fetchAll, getAdmin } from '@/lib/server/admin';
import { classroomTitle } from '@/lib/utils/classroomLabel';
import { isR2Configured, keyFromPublicUrl, r2Client, R2_BUCKET_NAME, R2_PUBLIC_URL } from '@/lib/storage/r2Client';
import { isMissingTable, removeFiles, STORED_FILES, sweepExpiredDrafts, type StoredFile } from '@/lib/storage/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

const MIGRATION_MESSAGE = 'ยังไม่มีตาราง stored_files — กรุณารัน supabase_storage_files_update.sql ใน Supabase ก่อน';
const IN_CHUNK = 150;
const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

/** Every tracked file, labelled with its classroom, assignment and uploader for the admin table. */
async function listFiles(supabase: Supabase) {
  const files = (await fetchAll(supabase, STORED_FILES)) as StoredFile[];
  const [assignments, classrooms, users] = await Promise.all([
    fetchAll(supabase, 'assignments', 'id, title, classroom_id'),
    fetchAll(supabase, 'classrooms', 'id, name, course_name, subject_code'),
    fetchAll(supabase, 'users', 'id, line_uid, first_name, last_name, student_id'),
  ]);
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const classroomById = new Map(classrooms.map((c) => [c.id, c]));
  const userById = new Map<string, Record<string, string>>();
  for (const user of users) {
    userById.set(user.id, user);
    if (user.line_uid) userById.set(user.line_uid, user);
  }
  return files
    .map((file) => {
      const assignment = file.assignment_id ? assignmentById.get(file.assignment_id) : undefined;
      const classroom = assignment ? classroomById.get(assignment.classroom_id) : undefined;
      const owner = file.owner_id ? userById.get(file.owner_id) : undefined;
      return {
        ...file,
        assignment_title: assignment?.title || null,
        classroom_title: classroom ? classroomTitle(classroom) : null,
        owner_name: owner ? `${owner.first_name || ''} ${owner.last_name || ''}`.trim() : null,
        owner_number: owner?.student_id || null,
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Brings stored_files in line with the bucket: adds objects uploaded before
 * tracking existed (attached when an answer or assignment points at them,
 * otherwise orphan), marks rows whose object is gone as deleted, and marks
 * attached rows nothing points at any more as orphan.
 */
async function syncWithBucket(supabase: Supabase) {
  const objects: Array<{ key: string; size: number; modified: string }> = [];
  let token: string | undefined;
  do {
    const page = await r2Client.send(new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME, ContinuationToken: token }));
    for (const o of page.Contents || []) if (o.Key) objects.push({ key: o.Key, size: o.Size || 0, modified: (o.LastModified || new Date()).toISOString() });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  const [rows, answers, assignments] = await Promise.all([
    fetchAll(supabase, STORED_FILES, 'key, status'),
    fetchAll(supabase, 'submission_answers', 'file_url'),
    fetchAll(supabase, 'assignments', 'sample_work_url'),
  ]);
  const referenced = new Set(
    [...answers.map((a) => a.file_url), ...assignments.map((a) => a.sample_work_url)].map(keyFromPublicUrl).filter(Boolean) as string[]
  );
  const inBucket = new Set(objects.map((o) => o.key));
  const tracked = new Map(rows.map((r) => [r.key as string, r.status as string]));
  const now = new Date().toISOString();

  // Keys look like submissions/<assignment>/<uploader>/<stamp>_<name>.
  const untracked = objects
    .filter((o) => !tracked.has(o.key))
    .map((o) => {
      const [root, assignmentId, ownerId, ...rest] = o.key.split('/');
      const isReferenced = referenced.has(o.key);
      return {
        key: o.key,
        url: `${R2_PUBLIC_URL}/${o.key}`,
        purpose: root === 'assignment-samples' ? 'sample' : 'submission',
        owner_id: rest.length ? ownerId : null,
        assignment_id: rest.length ? assignmentId : null,
        size_bytes: o.size,
        original_filename: (rest.join('/') || o.key).replace(/^\d+(-[a-z0-9]+)?_/, ''),
        status: isReferenced ? 'attached' : 'orphan',
        created_at: o.modified,
        attached_at: isReferenced ? o.modified : null,
      };
    });
  for (const part of chunks(untracked, 500)) {
    const { error } = await supabase.from(STORED_FILES).upsert(part);
    if (error) throw new Error(error.message);
  }

  const gone = rows.filter((r) => r.status !== 'deleted' && !inBucket.has(r.key)).map((r) => r.key as string);
  const unused = rows.filter((r) => r.status === 'attached' && inBucket.has(r.key) && !referenced.has(r.key)).map((r) => r.key as string);
  for (const part of chunks(gone, IN_CHUNK)) await supabase.from(STORED_FILES).update({ status: 'deleted', deleted_at: now }).in('key', part);
  for (const part of chunks(unused, IN_CHUNK)) await supabase.from(STORED_FILES).update({ status: 'orphan' }).in('key', part);
  return { objects: objects.length, added: untracked.length, missing: gone.length, orphaned: unused.length };
}

/**
 * GET /api/admin/storage            → every tracked file (admin storage panel)
 * GET /api/admin/storage?key=<key>  → the file itself (backup download fallback)
 */
export async function GET(request: NextRequest) {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const key = request.nextUrl.searchParams.get('key');
  if (key) {
    try {
      const object = await r2Client.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
      return new NextResponse(object.Body!.transformToWebStream(), {
        headers: { 'Content-Type': object.ContentType || 'application/octet-stream', 'Cache-Control': 'no-store' },
      });
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
  }
  const supabase = createServiceSupabaseClient();
  try {
    return NextResponse.json({ files: await listFiles(supabase), r2Configured: isR2Configured });
  } catch (error) {
    if (error instanceof Error && error.message.includes(STORED_FILES)) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 409 });
    console.error('[GET /api/admin/storage] failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to list files' }, { status: 500 });
  }
}

/**
 * POST /api/admin/storage {action, keys?, backedUp?}
 *   mark   → set or clear the backed-up flag
 *   delete → remove the objects from R2 (rows stay, status deleted)
 *   sweep  → remove expired never-submitted uploads now
 *   sync   → reconcile with the bucket (see syncWithBucket)
 */
export async function POST(request: NextRequest) {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { action?: string; keys?: unknown; backedUp?: boolean };
  const keys = Array.isArray(body.keys) ? body.keys.filter((k): k is string => typeof k === 'string' && !!k) : [];
  const supabase = createServiceSupabaseClient();
  try {
    switch (body.action) {
      case 'mark': {
        const backedUpAt = body.backedUp === false ? null : new Date().toISOString();
        for (const part of chunks(keys, IN_CHUNK)) {
          const { error } = await supabase.from(STORED_FILES).update({ backed_up_at: backedUpAt }).in('key', part);
          if (error) throw error;
        }
        return NextResponse.json({ success: true, backed_up_at: backedUpAt });
      }
      case 'delete':
        return NextResponse.json({ success: true, removed: await removeFiles(supabase, keys) });
      case 'sweep':
        return NextResponse.json({ success: true, removed: await sweepExpiredDrafts(supabase) });
      case 'sync':
        if (!isR2Configured) return NextResponse.json({ error: 'R2 is not configured' }, { status: 503 });
        return NextResponse.json({ success: true, ...(await syncWithBucket(supabase)) });
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (error) {
    const err = error as { message?: string; code?: string };
    if (isMissingTable(err)) return NextResponse.json({ error: MIGRATION_MESSAGE }, { status: 409 });
    console.error('[POST /api/admin/storage] failed:', error);
    return NextResponse.json({ error: err.message || 'Storage action failed' }, { status: 500 });
  }
}
