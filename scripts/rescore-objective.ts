/**
 * One-off: re-scores handed-in multiple choice / true-false answers with the
 * current answer matcher (matchChoiceOption, commit b9ee154). Older keys such
 * as "ตอบ ข" or "\t\tง. ถูกทุกข้อ" made the previous matcher mark every answer
 * wrong.
 *
 * Only scores the system gave move: an answer whose score equals what the OLD
 * matcher gave is re-scored; a score a teacher set by hand stays. Blank sheets
 * the system handed in (auto_forfeited) and "no submission" rows are skipped.
 * Totals are recomputed, and retake scores copied into the original quiz again.
 *
 *   dry run:  JITI_ALIAS="{\"@/\":\"$PWD/src/\",\"server-only\":\"$PWD/node_modules/server-only/empty.js\"}" \
 *               node --env-file=.env node_modules/.bin/jiti scripts/rescore-objective.ts
 *   apply:    the same with --apply
 * Ran on 2026-11-05: 1 answer re-scored (พื้นฐานไฟฟ้า 1); a second dry run finds nothing.
 */
import { createClient } from '@supabase/supabase-js';
import { scoreObjectiveAnswer } from '@/lib/utils/autoGrade';
import { recomputeSubmissionTotals } from '@/lib/server/grading';
import { syncRetakeScores } from '@/lib/server/retake';
import type { Assignment, Question } from '@/types/database';

const APPLY = process.argv.includes('--apply');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// ---- The matcher before b9ee154 (to recognise scores it gave) ----
const OLD_TRUE = new Set(['ถูก', 'จริง', 'ใช่', 'true', 't', 'yes', 'y', '1', '✓', 'o']);
const OLD_FALSE = new Set(['ผิด', 'เท็จ', 'ไม่ใช่', 'ไม่จริง', 'false', 'f', 'no', 'n', '0', '✗', 'x']);
function oldParseTrueFalse(text: string | null | undefined): boolean | null {
  const value = (text || '').trim().toLowerCase();
  if (!value) return null;
  if (OLD_TRUE.has(value)) return true;
  if (OLD_FALSE.has(value)) return false;
  return null;
}
function oldIsChoiceCorrect(ideal: string, studentText: string, options: unknown): boolean {
  const norm = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const answer = norm(studentText);
  if (!answer) return false;
  if (norm(ideal) === answer) return true;
  const list = Array.isArray(options) ? options.map((o) => String(o)) : [];
  const key = ideal.trim().replace(/^(ข้อ|ตัวเลือก|option)\s*/i, '').replace(/[.)]$/, '').trim();
  let index = -1;
  if (/^[ก-ฮ]$/.test(key)) index = 'กขคงจฉชซฌญ'.indexOf(key);
  else if (/^[a-z]$/i.test(key)) index = key.toUpperCase().charCodeAt(0) - 65;
  else if (/^\d+$/.test(key)) index = Number(key) - 1;
  return index >= 0 && index < list.length && norm(list[index]) === answer;
}
function oldScore(q: Question, text: string | null | undefined): number {
  const ideal = (q.ideal_answer || '').trim();
  const student = (text || '').trim();
  let correct = false;
  if (ideal && student) {
    const a = q.type === 'true_false' ? oldParseTrueFalse(ideal) : null;
    const b = q.type === 'true_false' ? oldParseTrueFalse(student) : null;
    correct = a !== null && b !== null ? a === b : oldIsChoiceCorrect(ideal, student, q.options);
  }
  return correct ? Number(q.max_score || 0) : 0;
}

async function readAll<T>(run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await run(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
const chunk = <T,>(items: T[], size = 150) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));

type AnswerRow = { id: string; submission_id: string; question_id: string; text_answer: string | null; teacher_score: number | null };
type SubRow = { id: string; assignment_id: string; status: string; auto_forfeited?: boolean | null };

async function main() {
  const questions = await readAll<Question>((f, t) =>
    supabase.from('questions').select('id, assignment_id, type, options, ideal_answer, max_score').in('type', ['multiple_choice', 'true_false']).range(f, t)
  );
  const qById = new Map(questions.map((q) => [q.id, q]));
  const answers = (
    await Promise.all(
      chunk(questions.map((q) => q.id)).map((part) =>
        readAll<AnswerRow>((f, t) =>
          supabase.from('submission_answers').select('id, submission_id, question_id, text_answer, teacher_score').in('question_id', part).range(f, t)
        )
      )
    )
  ).flat();
  const subs = (
    await Promise.all(
      chunk([...new Set(answers.map((a) => a.submission_id))]).map((part) =>
        readAll<SubRow>((f, t) => supabase.from('submissions').select('id, assignment_id, status, auto_forfeited').in('id', part).range(f, t))
      )
    )
  ).flat();
  const subById = new Map(subs.map((s) => [s.id, s]));

  const updates: Array<{ id: string; submissionId: string; assignmentId: string; from: number; to: number }> = [];
  let keptManual = 0;
  let skipped = 0;
  for (const a of answers) {
    const q = qById.get(a.question_id);
    const sub = subById.get(a.submission_id);
    // Only handed-in sheets; never the system's blank sheet (0 by rule) or a "no submission" 0.
    if (!q || !sub || (sub.status !== 'submitted' && sub.status !== 'late') || sub.auto_forfeited) {
      skipped++;
      continue;
    }
    if (a.teacher_score == null) continue;
    const before = oldScore(q, a.text_answer);
    const after = scoreObjectiveAnswer(q, a.text_answer);
    if (before === after) continue;
    if (Number(a.teacher_score) !== before) {
      // Not what the old matcher gave: the teacher set it, or it was already re-scored.
      if (Number(a.teacher_score) !== after) keptManual++;
      continue;
    }
    updates.push({ id: a.id, submissionId: sub.id, assignmentId: sub.assignment_id, from: before, to: after });
  }

  const byAssignment = new Map<string, typeof updates>();
  for (const u of updates) byAssignment.set(u.assignmentId, [...(byAssignment.get(u.assignmentId) || []), u]);
  const { data: works } = await supabase.from('assignments').select('*').in('id', [...byAssignment.keys()].length ? [...byAssignment.keys()] : ['__none__']);
  const workById = new Map(((works || []) as Assignment[]).map((w) => [w.id, w]));

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — choice answers checked: ${answers.length}, skipped (not handed in / auto blank / orphan): ${skipped}`);
  console.log(`answers to re-score: ${updates.length} in ${new Set(updates.map((u) => u.submissionId)).size} sheets, ${byAssignment.size} quizzes/works; teacher scores kept: ${keptManual}`);
  for (const [id, list] of byAssignment) {
    const up = list.filter((u) => u.to > u.from).length;
    console.log(`  • ${workById.get(id)?.title || id}: ${list.length} answers (${up} now correct, ${list.length - up} now wrong), ${new Set(list.map((u) => u.submissionId)).size} sheets`);
  }
  if (!APPLY || !updates.length) return;

  const now = new Date().toISOString();
  for (const part of chunk(updates, 25)) {
    const results = await Promise.all(part.map((u) => supabase.from('submission_answers').update({ teacher_score: u.to, updated_at: now }).eq('id', u.id)));
    const failed = results.find((r) => r.error)?.error;
    if (failed) throw new Error(failed.message);
  }
  for (const [assignmentId, list] of byAssignment) {
    const sheetIds = [...new Set(list.map((u) => u.submissionId))];
    await recomputeSubmissionTotals(supabase, assignmentId, sheetIds);
    const work = workById.get(assignmentId);
    // A retake's new total replaces the original quiz's score again.
    if (work?.retake_of) await syncRetakeScores(supabase, work, sheetIds);
  }
  console.log('done: answers updated, totals recomputed, retakes synced');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
