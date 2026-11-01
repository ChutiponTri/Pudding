import { NextRequest, NextResponse } from 'next/server';
import { createServiceSupabaseClient } from '@/lib/supabase/server';
import { fetchAll, getAdmin, loadDataset } from '@/lib/server/admin';
import { keyFromPublicUrl } from '@/lib/storage/r2Client';
import { isMissingTable, STORED_FILES } from '@/lib/storage/files';
import { classroomTitle } from '@/lib/utils/classroomLabel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Dataset rows: columns of several tables joined.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const IN_CHUNK = 150;
const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'tif', 'tiff']);
const extOf = (name: string) => (name.match(/\.([a-z0-9]{1,5})(?:$|[?#])/i)?.[1] || '').toLowerCase();
const fileKind = (ext: string, contentType: string | null) =>
  IMAGE_EXT.has(ext) || contentType?.startsWith('image/') ? 'image' : ext === 'pdf' || contentType === 'application/pdf' ? 'pdf' : 'other';

/**
 * GET /api/admin/dataset?kind=text|files&anonymize=0|1
 * Rows for the admin dataset builder (admins only). The browser then labels,
 * splits and packs them (Excel / JSONL for text, YOLO-style folders for files),
 * so nothing large is built here and the response stays small for files: only
 * their URLs travel, the bytes are fetched by the browser from storage.
 *
 * text  → one row per answer: question, student answer, scores, comments.
 * files → one row per uploaded file in an answer (images, PDFs, other), with
 *         the same labels (score, question type, assignment …).
 */
export async function GET(request: NextRequest) {
  if (!(await getAdmin())) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const params = request.nextUrl.searchParams;
  const kind = params.get('kind') === 'files' ? 'files' : 'text';
  const anonymize = params.get('anonymize') !== '0';
  const supabase = createServiceSupabaseClient();

  try {
    const [pairs, classrooms] = await Promise.all([
      loadDataset(supabase, 'grading_pairs', anonymize),
      fetchAll(supabase, 'classrooms', 'id, name, course_name, subject_code'),
    ]);
    const classroomName = new Map(classrooms.map((c) => [c.id, classroomTitle(c)]));
    const withRatio: Row[] = pairs.map((p) => {
      const max = Number(p.max_score) || 0;
      const score = p.teacher_score === null || p.teacher_score === undefined ? null : Number(p.teacher_score);
      return {
        ...p,
        classroom: p.classroom_id ? classroomName.get(p.classroom_id) || '' : '',
        score_ratio: score === null || !max ? null : Math.round((score / max) * 1000) / 1000,
      };
    });

    if (kind === 'text') {
      return NextResponse.json({ kind, rows: withRatio.map(({ file_url: _file, ...row }) => ({ ...row, has_file: !!_file })) }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Files we hold in R2 (pasted links to other sites cannot be packed).
    const withFiles: Row[] = withRatio.map((p) => ({ ...p, key: keyFromPublicUrl(p.file_url) })).filter((p) => !!p.key);
    const meta = new Map<string, { content_type: string | null; size_bytes: number | null; original_filename: string | null; status: string }>();
    for (const part of chunks([...new Set(withFiles.map((p) => p.key))], IN_CHUNK)) {
      const { data, error } = await supabase
        .from(STORED_FILES)
        .select('key, content_type, size_bytes, original_filename, status')
        .in('key', part);
      if (error) {
        if (isMissingTable(error)) break;
        throw new Error(error.message);
      }
      for (const row of data || []) meta.set(row.key, row);
    }
    const rows = withFiles
      .filter((p) => meta.get(p.key)?.status !== 'deleted')
      .map(({ student_answer, ...p }) => {
        const info = meta.get(p.key);
        const key = p.key as string;
        const filename = info?.original_filename || decodeURIComponent(key.split('/').pop() || key).replace(/^\d+-[a-z0-9]+_/, '');
        const ext = extOf(filename) || extOf(key);
        return {
          ...p,
          // Short text beside the file (often a caption); the full answer is in the text dataset.
          student_answer: String(student_answer || '').slice(0, 500),
          filename,
          ext,
          file_kind: fileKind(ext, info?.content_type || null),
          content_type: info?.content_type || null,
          size_bytes: info?.size_bytes ?? null,
        };
      });
    return NextResponse.json({ kind, rows }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[GET /api/admin/dataset] failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Dataset failed' }, { status: 500 });
  }
}
