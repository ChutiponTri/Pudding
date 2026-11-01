'use client';

import { useMemo, useRef, useState } from 'react';
import { Database, Download, FileImage, FileSpreadsheet, FolderTree, Loader2, RefreshCw, Square } from 'lucide-react';
import { createZip, downloadBlob, type ZipEntry } from '@/lib/storage/zip';
import { createXlsx, sheetFromObjects, sheetToCsv, XLSX_MIME, type Sheet } from '@/lib/export/xlsx';

/**
 * Admin dataset builder: turns graded work into training data.
 * - Text answers → Excel workbook (sheet per split) or a bundle (xlsx + JSONL + chat JSONL + CSV).
 * - Uploaded images/PDFs → YOLO-style folders: classification (split/class/file)
 *   or detection (images/ + labels/ + data.yaml), with metadata.csv beside them.
 * Labels, splits and filters are chosen here; the server only returns rows
 * (GET /api/admin/dataset), and file bytes come straight from storage.
 */

type Row = Record<string, unknown> & {
  answer_id: string;
  assignment_id: string;
  assignment_title: string;
  classroom_id: string | null;
  classroom: string;
  question_id: string;
  question_type: string;
  question_text: string;
  max_score: number;
  teacher_score: number | null;
  score_ratio: number | null;
  student: string | null;
  is_flagged_suspicious: boolean;
};
type FileRow = Row & { key: string; file_url: string; filename: string; ext: string; file_kind: 'image' | 'pdf' | 'other'; size_bytes: number | null };

type Kind = 'text' | 'files';
type LabelScheme = 'score_band' | 'pass_fail' | 'exact_score' | 'question_type' | 'assignment' | 'classroom' | 'flagged' | 'none';
type SplitGroup = 'student' | 'answer' | 'assignment' | 'question';
type Split = 'train' | 'val' | 'test';

const LABELS: Record<LabelScheme, string> = {
  score_band: 'ช่วงคะแนน (zero / low / mid / high / full)',
  pass_fail: 'ผ่าน / ไม่ผ่าน (ตามเกณฑ์ %)',
  exact_score: 'คะแนนจริง (score_0, score_1 …)',
  question_type: 'ประเภทคำถาม',
  assignment: 'ชื่องาน',
  classroom: 'ห้องเรียน',
  flagged: 'พฤติกรรมน่าสงสัย / ปกติ',
  none: 'ไม่มี label (all)',
};
const GROUPS: Record<SplitGroup, string> = {
  student: 'ตามนักเรียน (กันข้อมูลรั่วข้าม split)',
  answer: 'สุ่มรายคำตอบ',
  assignment: 'ตามงาน',
  question: 'ตามคำถาม',
};
const TEXT_COLUMNS = [
  'answer_id', 'classroom', 'assignment_title', 'is_exam', 'question_id', 'question_type', 'question_text', 'options',
  'ideal_answer', 'rubric_criteria', 'max_score', 'student', 'student_answer', 'teacher_score', 'score_ratio',
  'teacher_comment', 'ai_score', 'ai_feedback', 'research_grades', 'submission_status', 'is_flagged_suspicious',
  'sent_from_friend_phone', 'submitted_at', 'has_file',
];
const DEFAULT_TEXT_COLUMNS = new Set([
  'answer_id', 'classroom', 'assignment_title', 'question_type', 'question_text', 'options', 'ideal_answer', 'rubric_criteria',
  'max_score', 'student', 'student_answer', 'teacher_score', 'score_ratio', 'teacher_comment',
]);

/** FNV-1a: the same seed and key always land in the same split. */
function hash01(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}

const slug = (text: string, fallback = 'unknown') =>
  (text || '').replace(/[\\/:*?"<>|#%{}^~[\]`'\s]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || fallback;

function labelOf(row: Row, scheme: LabelScheme, passPercent: number): string {
  const ratio = row.score_ratio;
  switch (scheme) {
    case 'score_band':
      return ratio === null ? 'ungraded' : ratio >= 1 ? 'full' : ratio >= 0.8 ? 'high' : ratio >= 0.5 ? 'mid' : ratio > 0 ? 'low' : 'zero';
    case 'pass_fail':
      return ratio === null ? 'ungraded' : ratio * 100 >= passPercent ? 'pass' : 'fail';
    case 'exact_score':
      return row.teacher_score === null ? 'ungraded' : `score_${String(row.teacher_score).replace('.', '_')}`;
    case 'question_type':
      return row.question_type || 'unknown';
    case 'assignment':
      return slug(row.assignment_title);
    case 'classroom':
      return slug(row.classroom);
    case 'flagged':
      return row.is_flagged_suspicious ? 'suspicious' : 'normal';
    default:
      return 'all';
  }
}

function groupKey(row: Row, group: SplitGroup) {
  return group === 'student' ? row.student || row.answer_id : group === 'assignment' ? row.assignment_id : group === 'question' ? row.question_id : row.answer_id;
}

const formatBytes = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

async function fetchFileBytes(file: FileRow, signal: AbortSignal): Promise<Uint8Array> {
  for (const source of [file.file_url, `/api/admin/storage?key=${encodeURIComponent(file.key)}`]) {
    try {
      const res = await fetch(source, { cache: 'no-store', signal });
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  throw new Error(`Cannot download ${file.key}`);
}

const field = 'h-9 px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs';
const chip = (on: boolean) =>
  `px-2.5 py-1 rounded-full text-[11px] font-bold border cursor-pointer transition-colors ${
    on
      ? 'bg-violet-600 border-violet-600 text-white'
      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-violet-400'
  }`;

export function AdminDatasetBuilder() {
  const [kind, setKind] = useState<Kind>('text');
  const [rows, setRows] = useState<Record<Kind, Row[] | null>>({ text: null, files: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [anonymize, setAnonymize] = useState(true);

  // Filters
  const [classroomFilter, setClassroomFilter] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [gradedOnly, setGradedOnly] = useState(true);
  const [fileKinds, setFileKinds] = useState<Set<string>>(new Set(['image', 'pdf']));
  const [search, setSearch] = useState('');

  // Labels and splits
  const [scheme, setScheme] = useState<LabelScheme>('score_band');
  const [passPercent, setPassPercent] = useState(50);
  const [split, setSplit] = useState({ train: 80, val: 10, test: 10 });
  const [group, setGroup] = useState<SplitGroup>('student');
  const [seed, setSeed] = useState('pudding');

  // Output
  const [textOutput, setTextOutput] = useState<'xlsx' | 'bundle'>('xlsx');
  const [columns, setColumns] = useState<Set<string>>(DEFAULT_TEXT_COLUMNS);
  const [layout, setLayout] = useState<'yolo-cls' | 'yolo-det'>('yolo-cls');
  const [boxes, setBoxes] = useState<'empty' | 'full'>('empty');

  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = async (which: Kind = kind) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/dataset?kind=${which}${anonymize ? '' : '&anonymize=0'}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'โหลดข้อมูลไม่สำเร็จ');
      setRows((prev) => ({ ...prev, [which]: json.rows as Row[] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const current = rows[kind];
  const classrooms = useMemo(() => [...new Set((current || []).map((r) => r.classroom).filter(Boolean))].sort(), [current]);
  const questionTypes = useMemo(() => [...new Set((current || []).map((r) => r.question_type).filter(Boolean))].sort(), [current]);

  /** Rows after filters, each with its label and split. */
  const labelled = useMemo(() => {
    if (!current) return [];
    const needle = search.trim().toLowerCase();
    const total = Math.max(1, split.train + split.val + split.test);
    return current
      .filter((r) => !classroomFilter.size || classroomFilter.has(r.classroom))
      .filter((r) => !typeFilter.size || typeFilter.has(r.question_type))
      .filter((r) => !gradedOnly || r.teacher_score !== null)
      .filter((r) => kind !== 'files' || fileKinds.has((r as FileRow).file_kind))
      .filter((r) => !needle || `${r.assignment_title} ${r.question_text}`.toLowerCase().includes(needle))
      .map((r) => {
        const x = hash01(`${seed}:${groupKey(r, group)}`) * total;
        const s: Split = x < split.train ? 'train' : x < split.train + split.val ? 'val' : 'test';
        return { row: r, label: labelOf(r, scheme, passPercent), split: s };
      });
  }, [current, classroomFilter, typeFilter, gradedOnly, fileKinds, search, kind, seed, group, split, scheme, passPercent]);

  const classNames = useMemo(() => [...new Set(labelled.map((l) => l.label))].sort(), [labelled]);
  const matrix = useMemo(() => {
    const m = new Map<string, Record<Split, number>>();
    for (const l of labelled) {
      const entry = m.get(l.label) || { train: 0, val: 0, test: 0 };
      entry[l.split]++;
      m.set(l.label, entry);
    }
    return m;
  }, [labelled]);
  const totalBytes = kind === 'files' ? labelled.reduce((sum, l) => sum + ((l.row as FileRow).size_bytes || 0), 0) : 0;

  const stamp = new Date().toISOString().slice(0, 10);
  const root = `pudding-${kind === 'text' ? 'text' : layout}-${stamp}`;
  const info = () => ({
    created_at: new Date().toISOString(),
    source: 'Pudding admin dataset builder',
    kind,
    rows: labelled.length,
    anonymized: anonymize,
    label_scheme: scheme,
    ...(scheme === 'pass_fail' ? { pass_percent: passPercent } : {}),
    classes: classNames,
    split_percent: split,
    split_group: group,
    seed,
    filters: { classrooms: [...classroomFilter], question_types: [...typeFilter], graded_only: gradedOnly, search, ...(kind === 'files' ? { file_kinds: [...fileKinds] } : {}) },
    counts: Object.fromEntries(matrix),
  });

  const pickColumns = (row: Row) => Object.fromEntries(TEXT_COLUMNS.filter((c) => columns.has(c)).map((c) => [c, row[c]]));

  const buildText = () => {
    const records = labelled.map((l) => ({ split: l.split, label: l.label, ...pickColumns(l.row) }));
    const bySplit = (s: Split) => records.filter((r) => r.split === s);
    const readme: Sheet = {
      name: 'README',
      header: ['key', 'value'],
      rows: Object.entries(info()).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : (v as string | number | boolean)]),
      widths: [18, 100],
    };
    const counts: Sheet = {
      name: 'label_counts',
      header: ['label', 'train', 'val', 'test', 'total'],
      rows: [...matrix].map(([label, c]) => [label, c.train, c.val, c.test, c.train + c.val + c.test]),
    };
    const questions = [...new Map(labelled.map((l) => [l.row.question_id, l.row])).values()].map((r) => ({
      question_id: r.question_id,
      assignment_title: r.assignment_title,
      question_type: r.question_type,
      question_text: r.question_text,
      options: r.options,
      ideal_answer: r.ideal_answer,
      rubric_criteria: r.rubric_criteria,
      max_score: r.max_score,
      answers: labelled.filter((l) => l.row.question_id === r.question_id).length,
    }));
    const workbook = createXlsx([
      readme,
      sheetFromObjects('all', records),
      sheetFromObjects('train', bySplit('train')),
      sheetFromObjects('val', bySplit('val')),
      sheetFromObjects('test', bySplit('test')),
      counts,
      sheetFromObjects('questions', questions),
    ]);
    if (textOutput === 'xlsx') {
      downloadBlob(`${root}.xlsx`, workbook, XLSX_MIME);
      return;
    }
    const enc = new TextEncoder();
    const file = (name: string, text: string): ZipEntry => ({ name: `${root}/${name}`, data: enc.encode(text) });
    const jsonl = (items: unknown[]) => items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : '');
    // Score-and-feedback prediction in chat format: written answers a teacher graded.
    const chat = (s: Split) =>
      labelled
        .filter((l) => l.split === s && l.row.teacher_score !== null && String(l.row.student_answer || '').trim() && l.row.question_type !== 'file_upload')
        .map((l) => ({
          messages: [
            { role: 'system', content: 'คุณเป็นครูผู้ตรวจงาน ให้คะแนนคำตอบของนักเรียนตามเกณฑ์ และเขียนคำแนะนำสั้น ๆ ตอบเป็น JSON {"score": number, "comment": string}' },
            {
              role: 'user',
              content: [
                `คำถาม: ${l.row.question_text}`,
                l.row.options ? `ตัวเลือก: ${JSON.stringify(l.row.options)}` : '',
                l.row.ideal_answer ? `คำตอบที่คาดหวัง: ${l.row.ideal_answer}` : '',
                l.row.rubric_criteria ? `เกณฑ์การให้คะแนน: ${l.row.rubric_criteria}` : '',
                `คะแนนเต็ม: ${l.row.max_score}`,
                `คำตอบของนักเรียน: ${l.row.student_answer}`,
              ].filter(Boolean).join('\n'),
            },
            { role: 'assistant', content: JSON.stringify({ score: l.row.teacher_score, comment: l.row.teacher_comment || '' }) },
          ],
        }));
    const zip = createZip([
      { name: `${root}/${root}.xlsx`, data: workbook },
      file('train.jsonl', jsonl(bySplit('train'))),
      file('val.jsonl', jsonl(bySplit('val'))),
      file('test.jsonl', jsonl(bySplit('test'))),
      file('chat/train.jsonl', jsonl(chat('train'))),
      file('chat/val.jsonl', jsonl(chat('val'))),
      file('chat/test.jsonl', jsonl(chat('test'))),
      file('all.csv', sheetToCsv(sheetFromObjects('all', records))),
      file('classes.txt', classNames.join('\n') + '\n'),
      file('dataset_info.json', JSON.stringify(info(), null, 2)),
      file(
        'README.md',
        `# ${root}\n\nText answers exported from Pudding.\n\n` +
          `- \`${root}.xlsx\`: sheets all / train / val / test / label_counts / questions / README\n` +
          '- `train|val|test.jsonl`: one JSON object per answer (`split`, `label`, chosen columns)\n' +
          '- `chat/*.jsonl`: chat fine-tune format (messages) for graded written answers\n' +
          '- `all.csv`: every row (UTF-8 with BOM)\n' +
          `- Label scheme: **${scheme}**; split ${split.train}/${split.val}/${split.test} grouped by **${group}** (seed \`${seed}\`)\n` +
          (anonymize ? '- Students are pseudonymised (`s_xxxxxxxxxxxx`), stable across exports.\n' : '- ⚠️ NOT anonymised.\n') +
          '\n```python\nimport pandas as pd\nsheets = pd.read_excel("' + root + '.xlsx", sheet_name=None)\ntrain = sheets["train"]\n```\n'
      ),
    ]);
    downloadBlob(`${root}.zip`, zip);
  };

  const buildFiles = async () => {
    const files = labelled as Array<{ row: FileRow; label: string; split: Split }>;
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ done: 0, total: files.length, failed: 0 });
    const enc = new TextEncoder();
    const entries: ZipEntry[] = [];
    const meta: Array<Record<string, unknown>> = [];
    const failed: string[] = [];
    const usedNames = new Set<string>();
    const classId = new Map(classNames.map((c, i) => [c, i]));
    let done = 0;

    const pathFor = (item: (typeof files)[number]) => {
      const { row, label, split: s } = item;
      const ext = row.ext || 'bin';
      const base = `${row.answer_id.slice(-10)}_${slug(row.filename.replace(/\.[^.]+$/, ''), 'file').slice(0, 40)}`;
      let name = `${base}.${ext}`;
      for (let n = 2; usedNames.has(name); n++) name = `${base}_${n}.${ext}`;
      usedNames.add(name);
      const top = row.file_kind === 'image' ? 'images' : row.file_kind === 'pdf' ? 'documents' : 'other';
      // Classification: <top>/<split>/<class>/file ; detection: <top>/<split>/file (+ labels/<split>/<stem>.txt)
      const path = layout === 'yolo-cls' ? `${top}/${s}/${slug(label)}/${name}` : `${top}/${s}/${name}`;
      return { path, name, stem: name.replace(/\.[^.]+$/, '') };
    };

    const queue = files.map((item) => ({ item, ...pathFor(item) }));
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length && !controller.signal.aborted) {
        const job = queue[cursor++];
        try {
          const data = await fetchFileBytes(job.item.row, controller.signal);
          entries.push({ name: `${root}/${job.path}`, data });
          if (layout === 'yolo-det' && job.item.row.file_kind === 'image') {
            const line = boxes === 'full' ? `${classId.get(job.item.label) ?? 0} 0.5 0.5 1 1\n` : '';
            entries.push({ name: `${root}/labels/${job.item.split}/${job.stem}.txt`, data: enc.encode(line) });
          }
          const r = job.item.row;
          meta.push({
            path: job.path,
            split: job.item.split,
            label: job.item.label,
            label_id: classId.get(job.item.label),
            file_kind: r.file_kind,
            ext: r.ext,
            size_bytes: r.size_bytes,
            answer_id: r.answer_id,
            classroom: r.classroom,
            assignment_title: r.assignment_title,
            question_type: r.question_type,
            question_text: r.question_text,
            max_score: r.max_score,
            teacher_score: r.teacher_score,
            score_ratio: r.score_ratio,
            teacher_comment: r.teacher_comment,
            student: r.student,
            student_caption: r.student_answer,
            original_filename: anonymize ? undefined : r.filename,
            source_url: anonymize ? undefined : r.file_url,
          });
        } catch (err) {
          if (controller.signal.aborted) return;
          failed.push(job.item.row.key);
          console.warn(err);
        }
        done++;
        setProgress({ done, total: queue.length, failed: failed.length });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (controller.signal.aborted) {
      setProgress(null);
      return;
    }

    const names = classNames.map((c, i) => `  ${i}: ${JSON.stringify(slug(c))}`).join('\n');
    const metaSheet = sheetFromObjects('metadata', meta.sort((a, b) => String(a.path).localeCompare(String(b.path))));
    const text = (name: string, value: string): ZipEntry => ({ name: `${root}/${name}`, data: enc.encode(value) });
    entries.push(
      text('metadata.csv', sheetToCsv(metaSheet)),
      text('metadata.jsonl', meta.map((m) => JSON.stringify(m)).join('\n') + '\n'),
      { name: `${root}/metadata.xlsx`, data: createXlsx([metaSheet]) },
      text('classes.txt', classNames.map((c) => slug(c)).join('\n') + '\n'),
      text('dataset_info.json', JSON.stringify({ ...info(), layout, boxes: layout === 'yolo-det' ? boxes : undefined, failed: failed.length }, null, 2)),
      text(
        'data.yaml',
        layout === 'yolo-det'
          ? `# Ultralytics YOLO detection dataset\npath: .\ntrain: images/train\nval: images/val\ntest: images/test\nnc: ${classNames.length}\nnames:\n${names}\n`
          : `# Ultralytics YOLO classification: train with data=<this folder>/images\npath: images\ntrain: train\nval: val\ntest: test\nnc: ${classNames.length}\nnames:\n${names}\n`
      ),
      text(
        'README.md',
        `# ${root}\n\nFiles students uploaded in Pudding, packed ${layout === 'yolo-cls' ? 'for YOLO classification' : 'for YOLO detection'}.\n\n` +
          (layout === 'yolo-cls'
            ? '```\nimages/{train,val,test}/<class>/<file>   # photos (yolo classify: data=images)\ndocuments/{train,val,test}/<class>/<file.pdf>\n```\n'
            : '```\nimages/{train,val,test}/<file>\nlabels/{train,val,test}/<file>.txt   # one line per box: class cx cy w h (0-1)\ndocuments/{train,val,test}/<file.pdf>\ndata.yaml\n```\n' +
              (boxes === 'empty'
                ? '\nLabel files are **empty**: draw boxes in CVAT / Label Studio / Roboflow (import as YOLO). The image-level class is in metadata.csv.\n'
                : '\nEach label file holds one **whole-image box** with the image-level class (weak label) — refine boxes in an annotation tool.\n')) +
          `\nClasses (${scheme}): ${classNames.map((c) => `\`${slug(c)}\``).join(', ')}\n\n` +
          `Split ${split.train}/${split.val}/${split.test} grouped by **${group}** (seed \`${seed}\`). metadata.csv / .jsonl / .xlsx list every file with its score and question.\n` +
          'PDFs are kept apart under documents/ so image loaders are not confused; convert pages to images (e.g. pdf2image) if needed.\n' +
          (failed.length ? `\n⚠️ ${failed.length} file(s) could not be downloaded; see failed.txt.\n` : '') +
          (anonymize ? '\nStudents are pseudonymised; original file names and URLs are left out.\n' : '\n⚠️ NOT anonymised.\n')
      )
    );
    if (failed.length) entries.push(text('failed.txt', failed.join('\n') + '\n'));
    downloadBlob(`${root}.zip`, createZip(entries));
    setProgress(null);
  };

  const download = async () => {
    setError('');
    try {
      if (kind === 'text') buildText();
      else await buildFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'สร้างไฟล์ไม่สำเร็จ');
      setProgress(null);
    }
  };

  const toggle = (set: Set<string>, value: string, update: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };
  const splitTotal = split.train + split.val + split.test;

  const tree =
    kind === 'text'
      ? textOutput === 'xlsx'
        ? `${root}.xlsx\n ├ README       (settings)\n ├ all          (split, label, columns)\n ├ train / val / test\n ├ label_counts\n └ questions`
        : `${root}/\n ├ ${root}.xlsx\n ├ train.jsonl  val.jsonl  test.jsonl\n ├ chat/{train,val,test}.jsonl\n ├ all.csv  classes.txt\n └ dataset_info.json  README.md`
      : layout === 'yolo-cls'
        ? `${root}/\n ├ images/{train,val,test}/<class>/*.jpg\n ├ documents/{train,val,test}/<class>/*.pdf\n ├ data.yaml  classes.txt\n └ metadata.{csv,jsonl,xlsx}  README.md`
        : `${root}/\n ├ images/{train,val,test}/*.jpg\n ├ labels/{train,val,test}/*.txt\n ├ documents/{train,val,test}/*.pdf\n ├ data.yaml  classes.txt\n └ metadata.{csv,jsonl,xlsx}  README.md`;

  return (
    <section id="datasets" className="rounded-3xl border border-violet-200 dark:border-violet-900/60 bg-white dark:bg-slate-900 overflow-hidden scroll-mt-28">
      <div className="px-5 py-4 bg-linear-to-r from-violet-600 to-indigo-600 text-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-white/15"><Database className="w-5 h-5" /></div>
          <div>
            <h2 className="text-sm font-black">สร้างชุดข้อมูลสำหรับเทรนโมเดล</h2>
            <p className="text-[11px] text-violet-100">เลือก label • แบ่ง train/val/test • ดาวน์โหลดเป็น Excel หรือโฟลเดอร์แบบ YOLO</p>
          </div>
        </div>
        <div className="flex rounded-xl bg-white/15 p-1 text-xs font-bold">
          {([
            ['text', 'ข้อความ → Excel', FileSpreadsheet],
            ['files', 'รูป / PDF → YOLO', FileImage],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setKind(id);
                setTypeFilter(new Set());
                setClassroomFilter(new Set());
              }}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer ${kind === id ? 'bg-white text-violet-700' : 'text-white/90 hover:bg-white/10'}`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5 space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="h-9 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {current ? 'โหลดใหม่' : 'โหลดข้อมูล'}
          </button>
          <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
            <input
              type="checkbox"
              checked={anonymize}
              onChange={(e) => {
                setAnonymize(e.target.checked);
                // Rows loaded the other way must not be packed under this setting.
                setRows({ text: null, files: null });
              }}
              className="accent-violet-600"
            />
            ปกปิดตัวตนนักเรียน
          </label>
          {current && (
            <span className="text-xs text-slate-500 tabular-nums">
              ทั้งหมด {current.length.toLocaleString()} แถว • หลังกรอง <b className="text-violet-700 dark:text-violet-300">{labelled.length.toLocaleString()}</b>
              {kind === 'files' && ` • ${formatBytes(totalBytes)}`}
            </span>
          )}
          {!anonymize && <span className="text-[11px] font-bold text-rose-600">⚠️ ไฟล์จะมีรหัสนักเรียนจริง</span>}
        </div>

        {error && <p className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs font-semibold">{error}</p>}

        {!current ? (
          <p className="text-xs text-slate-500">
            กด “โหลดข้อมูล” เพื่อดึง{kind === 'text' ? 'คำตอบแบบข้อความทั้งหมด' : 'รายการไฟล์ที่นักเรียนแนบ (รูป, PDF)'} แล้วเลือก label และรูปแบบไฟล์ได้ก่อนดาวน์โหลด
          </p>
        ) : (
          <div className="grid lg:grid-cols-[1fr_320px] gap-5">
            <div className="space-y-4">
              {/* 1. Filters */}
              <fieldset className="space-y-2">
                <legend className="text-[11px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-300">1 · กรองข้อมูล</legend>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className={chip(gradedOnly)} onClick={() => setGradedOnly(!gradedOnly)}>เฉพาะที่ครูตรวจแล้ว</button>
                  {kind === 'files' &&
                    (['image', 'pdf', 'other'] as const).map((k) => (
                      <button key={k} type="button" className={chip(fileKinds.has(k))} onClick={() => toggle(fileKinds, k, setFileKinds)}>
                        {k === 'image' ? '🖼 รูปภาพ' : k === 'pdf' ? '📄 PDF' : '📎 อื่น ๆ'}
                      </button>
                    ))}
                </div>
                {questionTypes.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    {questionTypes.map((t) => (
                      <button key={t} type="button" className={chip(typeFilter.has(t))} onClick={() => toggle(typeFilter, t, setTypeFilter)}>{t}</button>
                    ))}
                  </div>
                )}
                {classrooms.length > 1 && (
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {classrooms.map((c) => (
                      <button key={c} type="button" className={chip(classroomFilter.has(c))} onClick={() => toggle(classroomFilter, c, setClassroomFilter)}>{c}</button>
                    ))}
                  </div>
                )}
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่องาน / คำถาม" className={`${field} w-full sm:w-72`} />
              </fieldset>

              {/* 2. Labels and splits */}
              <fieldset className="space-y-2">
                <legend className="text-[11px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-300">2 · Label และการแบ่งชุด</legend>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={scheme} onChange={(e) => setScheme(e.target.value as LabelScheme)} className={field}>
                    {Object.entries(LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                  {scheme === 'pass_fail' && (
                    <label className="text-xs flex items-center gap-1">
                      ผ่านเมื่อ ≥
                      <input type="number" min={1} max={100} value={passPercent} onChange={(e) => setPassPercent(Number(e.target.value) || 50)} className={`${field} w-16`} />%
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {(['train', 'val', 'test'] as const).map((s) => (
                    <label key={s} className="flex items-center gap-1 font-semibold">
                      {s}
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={split[s]}
                        onChange={(e) => setSplit({ ...split, [s]: Math.max(0, Number(e.target.value) || 0) })}
                        className={`${field} w-16`}
                      />
                    </label>
                  ))}
                  {splitTotal !== 100 && <span className="text-amber-600 font-bold">รวม {splitTotal}% (คิดตามสัดส่วน)</span>}
                  <select value={group} onChange={(e) => setGroup(e.target.value as SplitGroup)} className={field}>
                    {Object.entries(GROUPS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                  <label className="flex items-center gap-1 font-semibold">
                    seed
                    <input value={seed} onChange={(e) => setSeed(e.target.value)} className={`${field} w-24 font-mono`} />
                  </label>
                </div>
              </fieldset>

              {/* 3. Output */}
              <fieldset className="space-y-2">
                <legend className="text-[11px] font-black uppercase tracking-wide text-violet-700 dark:text-violet-300">3 · รูปแบบไฟล์</legend>
                {kind === 'text' ? (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      <button type="button" className={chip(textOutput === 'xlsx')} onClick={() => setTextOutput('xlsx')}>Excel (.xlsx) อย่างเดียว</button>
                      <button type="button" className={chip(textOutput === 'bundle')} onClick={() => setTextOutput('bundle')}>ชุดเต็ม .zip (xlsx + JSONL + chat + CSV)</button>
                    </div>
                    <details className="text-xs">
                      <summary className="cursor-pointer font-bold text-slate-600 dark:text-slate-300">เลือกคอลัมน์ ({columns.size}/{TEXT_COLUMNS.length})</summary>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {TEXT_COLUMNS.map((c) => (
                          <button key={c} type="button" className={`${chip(columns.has(c))} font-mono`} onClick={() => toggle(columns, c, setColumns)}>{c}</button>
                        ))}
                      </div>
                    </details>
                  </>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className={chip(layout === 'yolo-cls')} onClick={() => setLayout('yolo-cls')}>YOLO Classification (โฟลเดอร์ตาม class)</button>
                    <button type="button" className={chip(layout === 'yolo-det')} onClick={() => setLayout('yolo-det')}>YOLO Detection (images + labels)</button>
                    {layout === 'yolo-det' && (
                      <select value={boxes} onChange={(e) => setBoxes(e.target.value as 'empty' | 'full')} className={field}>
                        <option value="empty">ไฟล์ label ว่าง (ไปวาดกรอบเอง)</option>
                        <option value="full">กรอบเต็มภาพ + class (weak label)</option>
                      </select>
                    )}
                  </div>
                )}
              </fieldset>
            </div>

            {/* Preview */}
            <aside className="space-y-3">
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3">
                <p className="text-[11px] font-black text-slate-500 mb-2 flex items-center gap-1"><FolderTree className="w-3.5 h-3.5" /> โครงสร้างไฟล์</p>
                <pre className="text-[10.5px] leading-relaxed font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-all">{tree}</pre>
              </div>
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <table className="w-full text-[11px] tabular-nums">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left">label</th>
                      <th className="px-2 py-1.5 text-right">train</th>
                      <th className="px-2 py-1.5 text-right">val</th>
                      <th className="px-2 py-1.5 text-right">test</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...matrix].slice(0, 30).map(([label, c]) => (
                      <tr key={label} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-2 py-1 font-mono truncate max-w-32" title={label}>{label}</td>
                        <td className="px-2 py-1 text-right">{c.train}</td>
                        <td className="px-2 py-1 text-right">{c.val}</td>
                        <td className="px-2 py-1 text-right">{c.test}</td>
                      </tr>
                    ))}
                    {matrix.size === 0 && (
                      <tr><td colSpan={4} className="px-2 py-3 text-center text-slate-400">ไม่มีข้อมูลตามตัวกรอง</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {progress ? (
                <div className="space-y-2">
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full bg-violet-600 transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                    <span>ดาวน์โหลดไฟล์ {progress.done}/{progress.total}{progress.failed ? ` • ล้มเหลว ${progress.failed}` : ''}</span>
                    <button type="button" onClick={() => abortRef.current?.abort()} className="flex items-center gap-1 font-bold text-rose-600 cursor-pointer">
                      <Square className="w-3 h-3" /> ยกเลิก
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={download}
                  disabled={!labelled.length}
                  className="w-full h-11 rounded-2xl bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white text-sm font-black flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-lg shadow-violet-600/20"
                >
                  <Download className="w-4 h-4" />
                  ดาวน์โหลด {labelled.length.toLocaleString()} {kind === 'text' ? 'แถว' : 'ไฟล์'}
                </button>
              )}
              {kind === 'files' && totalBytes > 1.5 * 1024 ** 3 && (
                <p className="text-[11px] font-bold text-amber-600">ไฟล์รวมเกิน 1.5 GB — แนะนำให้กรองทีละห้อง/งาน</p>
              )}
            </aside>
          </div>
        )}
      </div>
    </section>
  );
}
