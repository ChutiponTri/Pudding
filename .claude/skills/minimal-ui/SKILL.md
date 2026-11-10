---
name: minimal-ui
description: Trim Pudding's web UI (and teacher/student LIFF) to minimal copy that fits every screen size — cut helper paragraphs, hints that restate the label, "•"-chained explanations and AI-sounding phrasing (Thai + English), and fix text that wraps/overflows on phones. Use when the user asks to make a page/component minimal, cleaner, less wordy, "less AI-like", or to remove unnecessary text. Args: a page, component path, or "all".
---

# Minimal UI

Each screen should read from labels, values and buttons alone, at every width (320 px phone / LIFF → desktop). Change copy and the elements that only hold it — never behaviour.

## Scope
- Path → that file (+ page-specific children). Page name → find files, confirm in one line, go.
- "all" → one page at a time: `src/app/assignments/new/page.tsx`, `src/app/classrooms/[id]/page.tsx`, `src/app/exports/page.tsx`, `src/components/liff-teacher/*`.
- Skip: `src/lib/server/*` errors, `src/lib/line/*` message text, Excel headers.

## Work cheaply
- Don't read whole big files. Find copy first: `grep -nE "tr\(|hint=|<p |placeholder=|title=|·|•|—" <file>`, then `Read` only those line ranges.
- Edit with small `Edit` calls; no rewrites of whole files, no re-reading after edits.
- Report briefly (see Finish). Don't echo before/after code.

## Cut
1. Hints restating the label/option ("การนับคะแนน" + "รวมในคะแนนรวมและร้อยละ").
2. Helper paragraphs under section titles.
3. "•" / "—" / "·" chains → keep only the fact that changes what the teacher does, usually none.
4. Consequence essays on toggles — a clear option name is enough.
5. Duplicate title/subtitle/label → one.
6. Counts/meta nobody acts on.
7. Empty-state sermons → one line ("ยังไม่มีงาน") + action button.
8. Decorative emoji (keep established LIFF tab/menu icons).

AI phrasing → delete or state the result: ระบบจะ…อัตโนมัติ / The system will…; เพื่อให้…, เพื่อความสะดวก / so that…; ง่ายๆ, ได้ทันที / easily, instantly, seamlessly; ช่วยให้คุณครู…, คุณครูสามารถ… / helps you, you can… (start with the verb); กรุณา / Please in hints (keep in errors); ไม่ต้องกังวล / Don't worry; long explanatory parentheses (→ `title=` tooltip or delete).

## Keep
Validation/errors, `confirm(...)` text, data-loss or students-can-see warnings, units (นาที, น., /10), state not shown elsewhere (deadlines, ปิดรับ, ฉบับร่าง, รอตรวจ 3), `(ไม่บังคับ)`, migration/setup messages. Unsure → cut, but list it in the report.

## Fit every screen
Check each touched element at ~320 px, `sm` (640), `md`/`lg` desktop:
- Labels: Thai 1–3 words, English ≤ 3. Thai is wider than it looks — a button label must fit one line at 320 px.
- Long but needed → `MobileText short full` (`src/components/MobileText.tsx`), not a longer string.
- Rows of buttons/chips: `flex-wrap gap-2`, or stack `flex-col sm:flex-row`. Never fixed widths (`w-[…px]`) on text.
- Text in flex rows: `min-w-0` on the flex child + `truncate` (single line) or `break-words` (multi-line); put `title=` on truncated text.
- Segmented control with 2–3 options that wraps on phones → checkbox or `<select>` below `sm:`.
- Tables: wrap in `overflow-x-auto`; hide low-value columns below `sm:` (`hidden sm:table-cell`) rather than shrinking text.
- Tap targets ≥ 40 px tall on phones (`py-2`+); don't shrink below `text-sm` to make copy fit — cut copy instead.
- Removed hint → remove its wrapper (`<p>`, `hint=`, spacing) so no gap remains.
- Match neighbours' Tailwind/dark-mode classes; don't restyle untouched code.

## Edit rules
`tr('ไทย', 'English')` on web, plain Thai in LIFF. Change both languages together.

## Examples
- `'กำลังแก้ไขงานเดิม · นักเรียนเห็นการเปลี่ยนแปลงทันทีที่บันทึก'` → `'กำลังแก้ไขงาน'`.
- `'หลังกำหนดส่งยังส่งได้ (นับเป็นส่งช้า) จนถึงเวลาปิดรับ แล้วปิดรับเอง'` → `'หลังกำหนดส่ง นับเป็นส่งช้า'`.
- Exports `'ข้อมูลดึงใหม่ทุกครั้งที่กดดาวน์โหลด • …'` → delete.
- นับคะแนน/ไม่นับคะแนน toggle: hints removed; phones get one "☐ ไม่นับคะแนน" checkbox.

## Finish
1. `npx tsc --noEmit -p .` and `npx eslint <changed files>`; fix errors and unused imports your cuts left.
2. Report per file, one line per change: `old → new` (or `removed`), plus `layout: …` for responsive fixes. Then a short "unsure" list. No commit unless asked.
