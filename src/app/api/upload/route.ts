import { after, NextRequest, NextResponse } from 'next/server';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2Client, R2_BUCKET_NAME, R2_PUBLIC_URL, isR2Configured } from '@/lib/storage/r2Client';
import { getActor, type Actor } from '@/lib/auth/actor';
import { classroomRole, errorResponse, FORBIDDEN, HttpError, loadClassroom, requireTeacherOfAssignment } from '@/lib/server/access';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { isMissingTable, removeFiles, STORED_FILES, sweepExpiredDraftsOccasionally, trackFile, type StoredFile } from '@/lib/storage/files';
import { MAX_DRAFT_FILES_PER_ASSIGNMENT, maxBytesFor, uploadRejection, type UploadPurpose } from '@/lib/storage/uploadRules';
import type { Classroom } from '@/types/database';

export const runtime = 'nodejs';

/**
 * Uploads go straight from the browser to R2, so file bytes never pass
 * through this server:
 *   1. POST {action:'sign', …}      → checks the file, returns a short-lived upload URL
 *                                      (or `duplicate` when the same file is already stored)
 *   2. browser PUTs the file to that URL
 *   3. POST {action:'complete', key} → verifies what arrived, keeps it as a draft
 *   DELETE {key}                     → drops a draft the user replaced or removed
 * A multipart POST (the file itself) is the fallback for when the direct
 * upload is blocked; the hosting platform caps that body at about 4.5MB.
 */

type Supabase = ReturnType<typeof createServiceSupabaseClient>;

const SIGNED_URL_TTL_SECONDS = 10 * 60;
const NOT_CONFIGURED = 'ระบบจัดเก็บไฟล์ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ';

/** Keeps a client-supplied value safe to use as one segment of a storage key. */
const keySegment = (value: string) => value.replace(/[^\w.-]/g, '_').slice(0, 80) || 'unknown';
const ownerIds = (actor: Actor) => (actor.kind === 'student' ? actor.keys : [actor.userId]);

/** Whether the caller may upload for this assignment ("draft" = a teacher's not-yet-saved assignment). */
async function checkAssignmentAccess(supabase: Supabase, actor: Actor, assignmentId: string, purpose: UploadPurpose) {
  if (actor.kind === 'teacher') {
    if (assignmentId !== 'draft') await requireTeacherOfAssignment(supabase, actor, assignmentId);
    return;
  }
  if (purpose !== 'submission') throw FORBIDDEN();
  const { data: assignment } = await supabase.from('assignments').select('id, classroom_id').eq('id', assignmentId).maybeSingle();
  if (!assignment) throw new HttpError(404, 'ไม่พบงานนี้ในระบบ อาจถูกลบไปแล้ว');
  const classroom = await loadClassroom(supabase, assignment.classroom_id);
  if (!classroom || (await classroomRole(supabase, actor, classroom as Classroom)) !== 'student') {
    throw new HttpError(403, 'คุณยังไม่ได้อยู่ในห้องเรียนนี้ หรือยังรอคุณครูอนุมัติ');
  }
}

function newKey(actor: Actor, purpose: UploadPurpose, assignmentId: string, filename: string) {
  const root = purpose === 'sample' ? 'assignment-samples' : 'submissions';
  const name = filename.replace(/[^a-zA-Z0-9.-]/g, '_').slice(-80) || 'file';
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${root}/${keySegment(assignmentId)}/${keySegment(actor.userId)}/${unique}_${name}`;
}

async function signUpload(supabase: Supabase, actor: Actor, body: Record<string, unknown>) {
  const contentType = String(body.contentType || '');
  const size = Number(body.size || 0);
  const filename = String(body.filename || 'file');
  const sha256 = /^[a-f0-9]{64}$/.test(String(body.sha256 || '')) ? String(body.sha256) : null;
  const assignmentId = keySegment(String(body.assignment_id || 'general'));
  const purpose: UploadPurpose = actor.kind === 'teacher' ? 'sample' : 'submission';

  const rejection = uploadRejection({ type: contentType, size });
  if (rejection) return NextResponse.json({ error: rejection, tooLarge: maxBytesFor(contentType) > 0 }, { status: 400 });
  if (!size) return NextResponse.json({ error: 'ไฟล์ว่างเปล่า กรุณาเลือกไฟล์ใหม่' }, { status: 400 });
  await checkAssignmentAccess(supabase, actor, assignmentId, purpose);

  // The same file this user already stored for this assignment: let them reuse it instead of storing it twice.
  const owners = ownerIds(actor);
  if (sha256 && !body.force) {
    const { data: existing, error } = await supabase
      .from(STORED_FILES)
      .select('key, url, original_filename, created_at, status')
      .in('owner_id', owners)
      .eq('assignment_id', assignmentId)
      .eq('purpose', purpose)
      .eq('sha256', sha256)
      .in('status', ['draft', 'attached'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) isMissingTable(error);
    else if (existing) return NextResponse.json({ duplicate: existing });
  }

  if (actor.kind === 'student') {
    const { count, error } = await supabase
      .from(STORED_FILES)
      .select('key', { count: 'exact', head: true })
      .in('owner_id', owners)
      .eq('assignment_id', assignmentId)
      .in('status', ['uploading', 'draft']);
    if (!error && (count || 0) >= MAX_DRAFT_FILES_PER_ASSIGNMENT) {
      return NextResponse.json({ error: 'อัปโหลดไฟล์สำหรับงานนี้ครบจำนวนแล้ว กรุณาส่งงาน หรือลบไฟล์ที่ไม่ใช้ก่อน' }, { status: 429 });
    }
  }

  const key = newKey(actor, purpose, assignmentId, filename);
  const uploadUrl = await getSignedUrl(
    r2Client,
    new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, ContentType: contentType, ContentLength: size }),
    { expiresIn: SIGNED_URL_TTL_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) }
  );
  const url = `${R2_PUBLIC_URL}/${key}`;
  await trackFile(supabase, {
    key,
    url,
    purpose,
    owner_id: actor.userId,
    assignment_id: assignmentId,
    content_type: contentType,
    size_bytes: size,
    sha256,
    original_filename: filename.slice(0, 200),
    status: 'uploading',
  });
  after(() => sweepExpiredDraftsOccasionally(supabase));
  return NextResponse.json({ uploadUrl, key, url, headers: { 'Content-Type': contentType } });
}

/** The uploader's own row for a key; null when it is someone else's (or untracked). */
async function ownRow(supabase: Supabase, actor: Actor, key: string) {
  const { data, error } = await supabase.from(STORED_FILES).select('*').eq('key', key).maybeSingle();
  if (error) return isMissingTable(error) ? undefined : null;
  const row = data as StoredFile | null;
  return row && row.owner_id && ownerIds(actor).includes(row.owner_id) ? row : null;
}

async function completeUpload(supabase: Supabase, actor: Actor, key: string) {
  const row = await ownRow(supabase, actor, key);
  // Without the tracking table, the key itself names its uploader.
  if (row === null || (row === undefined && !key.includes(`/${keySegment(actor.userId)}/`))) throw FORBIDDEN();

  let head;
  try {
    head = await r2Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
  } catch {
    return NextResponse.json({ error: 'ไม่พบไฟล์ที่อัปโหลด กรุณาลองอีกครั้ง' }, { status: 400 });
  }
  // The upload URL fixed type and size, but check what actually arrived.
  const rejection = uploadRejection({ type: head.ContentType || '', size: head.ContentLength || 0 });
  if (rejection) {
    await removeFiles(supabase, [key]);
    return NextResponse.json({ error: rejection }, { status: 400 });
  }
  if (row) {
    const { error } = await supabase.from(STORED_FILES).update({ status: 'draft', size_bytes: head.ContentLength }).eq('key', key).eq('status', 'uploading');
    if (error && !isMissingTable(error)) console.warn('[upload] complete mark failed:', error.message);
  }
  return NextResponse.json({ success: true, key, url: `${R2_PUBLIC_URL}/${key}`, sizeBytes: head.ContentLength });
}

/** The old path: the file comes through this server (used when the browser cannot reach R2 directly). */
async function uploadThroughServer(supabase: Supabase, actor: Actor, req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  const rejection = uploadRejection(file);
  if (rejection) return NextResponse.json({ error: rejection, tooLarge: maxBytesFor(file.type) > 0 }, { status: 400 });

  const assignmentId = keySegment((formData.get('assignment_id') as string) || 'general');
  const purpose: UploadPurpose = actor.kind === 'teacher' ? 'sample' : 'submission';
  await checkAssignmentAccess(supabase, actor, assignmentId, purpose);
  const sha256 = String(formData.get('sha256') || '');

  const key = newKey(actor, purpose, assignmentId, file.name);
  await r2Client.send(
    new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, Body: Buffer.from(await file.arrayBuffer()), ContentType: file.type })
  );
  const url = `${R2_PUBLIC_URL}/${key}`;
  await trackFile(supabase, {
    key,
    url,
    purpose,
    owner_id: actor.userId,
    assignment_id: assignmentId,
    content_type: file.type,
    size_bytes: file.size,
    sha256: /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null,
    original_filename: file.name.slice(0, 200),
    status: 'draft',
  });
  after(() => sweepExpiredDraftsOccasionally(supabase));
  return NextResponse.json({ success: true, url, key, filename: file.name, contentType: file.type, sizeBytes: file.size });
}

export async function POST(req: NextRequest) {
  try {
    // Only signed-in teachers and LINE-verified students may upload.
    const actor = await getActor(req);
    if (!actor) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบก่อนอัปโหลดไฟล์' }, { status: 401 });
    if (!isR2Configured) {
      console.error('File upload rejected: Cloudflare R2 is not configured');
      return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
    }
    const supabase = createServiceSupabaseClient();

    if (req.headers.get('content-type')?.includes('multipart/form-data')) return await uploadThroughServer(supabase, actor, req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === 'sign') return await signUpload(supabase, actor, body);
    if (body.action === 'complete') return await completeUpload(supabase, actor, String(body.key || ''));
    return NextResponse.json({ error: 'Unknown upload action' }, { status: 400 });
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    console.error('Cloudflare R2 upload error:', error);
    return NextResponse.json({ error: 'อัปโหลดไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}

/** Deletes an upload its owner replaced or removed before handing in. Files already handed in stay. */
export async function DELETE(req: NextRequest) {
  try {
    const actor = await getActor(req);
    if (!actor) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
    const { key } = (await req.json().catch(() => ({}))) as { key?: string };
    if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 });
    const supabase = createServiceSupabaseClient();
    const row = await ownRow(supabase, actor, key);
    if (!row || !['uploading', 'draft'].includes(row.status)) return NextResponse.json({ success: true, removed: 0 });
    return NextResponse.json({ success: true, removed: await removeFiles(supabase, [key]) });
  } catch (error) {
    console.error('Cloudflare R2 release error:', error);
    return NextResponse.json({ error: 'ลบไฟล์ไม่สำเร็จ' }, { status: 500 });
  }
}
