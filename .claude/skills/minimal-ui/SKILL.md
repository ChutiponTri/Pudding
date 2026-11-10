---
name: minimal-ui
description: Trim Pudding's web UI (and teacher/student LIFF) down to minimal copy — cut helper paragraphs, hints that restate the label, "•"-chained explanations and AI-sounding phrasing, in both Thai and English. Use when the user asks to make a page/component minimal, cleaner, less wordy, "less AI-like", or to remove unnecessary text. Args: a page, component path, or "all".
---

# Minimal UI copy

Goal: a teacher understands each screen from labels, values and buttons alone. Text that explains what the UI already shows is noise. Change copy and the elements that only exist to hold it — never behaviour.

## Scope

- Arg is a path → only that file (and components it renders that are clearly page-specific).
- Arg is a page name (e.g. "grades tab", "create assignment") → find it, confirm the files in one line, go.
- "all" → work page by page, starting with the busiest: `src/app/assignments/new/page.tsx`, `src/app/classrooms/[id]/page.tsx`, `src/app/exports/page.tsx`, `src/components/liff-teacher/*`.
- Don't touch: server error messages in `src/lib/server/*`, LINE message text (`src/lib/line/*`), Excel export headers.

## What to cut

1. **Hints that restate the label or the choice.** Label "การนับคะแนน" + hint "รวมในคะแนนรวมและร้อยละ" → drop the hint.
2. **Helper paragraphs under a section title** describing what the section is for. Title says it.
3. **"•" / "—" / "·" chains** joining two or three facts. Keep at most the one fact that changes what the teacher does; usually none.
4. **Consequence essays** on toggles ("นักเรียนยังเห็นคะแนนและคำติชม • ไฟล์ Excel แสดงคะแนน แต่ไม่รวม…"). A clear option name is enough.
5. **Duplicate headings**: card title + subtitle + label saying the same thing → one.
6. **Counts and meta nobody acts on** ("12 งาน/ข้อสอบ" next to a table that shows them).
7. **Empty-state sermons** → one short line ("ยังไม่มีงาน") + the action button.
8. **Emoji decoration** in labels, except where it's the established tab/menu icon in LIFF.

## AI-like phrasing → replace or delete

| Thai | English | Do |
|---|---|---|
| ระบบจะ…ให้อัตโนมัติ, ระบบจะช่วย… | The system will automatically… | Say the result or delete |
| เพื่อให้…, เพื่อความสะดวก | so that…, for convenience | Delete the purpose clause |
| ได้อย่างง่ายดาย, ได้ทันที, ง่ายๆ | easily, instantly, simply, seamlessly | Delete |
| ช่วยให้คุณครู…, คุณครูสามารถ… | helps you…, you can… | Start with the verb |
| กรุณา… (in hints, not errors) | Please… | Delete in hints; keep in validation errors |
| ไม่ต้องกังวล, สบายใจได้ | Don't worry | Delete |
| Long parentheses explaining a term | | Delete or move to `title=` tooltip |

## What to keep

- Validation and error text, destructive-action confirms (`confirm(...)`), anything about data loss or students seeing something.
- Units and formats next to inputs (นาที, น., /10).
- State that isn't visible elsewhere: deadlines, "ปิดรับ …", "ฉบับร่าง", counts that drive an action (รอตรวจ 3).
- `(ไม่บังคับ)` on optional fields.
- Required-migration / setup messages.

If unsure whether a line is needed, it isn't — but list it in the report so the user can restore it.

## How to edit

- Strings are `tr('ไทย', 'English')` (web) or plain Thai (LIFF). Change **both languages** together; never leave a lone translation.
- Short labels: Thai 1–3 words, English ≤ 3 words. Use `MobileText short full` only when the full label genuinely doesn't fit on phones — not to keep a long label.
- When a hint is removed, remove its wrapper (`<p>`, `hint=` prop, spacing classes) so no empty gap stays.
- Prefer moving a still-useful explanation to a `title` tooltip over keeping it inline.
- Phones: replace a wide segmented control with a checkbox or `<select>` below `sm:` if it only has two/three options and the text wraps.
- Keep layout tokens (Tailwind classes, dark-mode variants) consistent with neighbours; don't restyle what you're not trimming.

## Examples (before → after, from this repo)

- `assignments/new` grading toggle: removed both hints under นับคะแนน / ไม่นับคะแนน; phones get a single "☐ ไม่นับคะแนน" checkbox.
- Exports page: `'ข้อมูลดึงใหม่ทุกครั้งที่กดดาวน์โหลด • ปุ่ม “ส่งออก CSV” ในแต่ละห้องเรียนยังใช้ได้ตามเดิม'` → delete (implementation detail).
- `'กำลังแก้ไขงานเดิม · นักเรียนเห็นการเปลี่ยนแปลงทันทีที่บันทึก'` → `'กำลังแก้ไขงาน'` (keep only the state).
- `'หลังกำหนดส่งยังส่งได้ (นับเป็นส่งช้า) จนถึงเวลาปิดรับ แล้วปิดรับเอง'` → `'หลังกำหนดส่ง นับเป็นส่งช้า'`.

## Finish

1. `npx tsc --noEmit -p .` and `npx eslint <changed files>` — fix errors and any unused imports/vars your cuts created.
2. Report a compact table per file: **removed / shortened → new text**, and a separate short list of lines you were unsure about. No commit unless asked.
