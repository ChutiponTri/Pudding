# 🍮 Pudding (พุดดิ้ง)

**An online classroom for Thai schools, built around LINE.** Teachers run courses, homework, quizzes, attendance and grading from a web portal. Students do everything inside LINE through a LIFF app, without installing anything or creating an account.

- **Production:** https://www.pudding-p.com
- **Student app:** opens from any Pudding link in LINE (`https://liff.line.me/<LIFF_ID>`)

---

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Database setup](#database-setup)
- [LINE setup](#line-setup)
- [Scripts](#scripts)
- [Deployment](#deployment)
- [Capacity and limits](#capacity-and-limits)
- [Development notes](#development-notes)

---

## Features

### 👩‍🏫 Teacher web portal

| Area | What it does |
|---|---|
| **Sign-in and approval** | Teachers sign in with LINE (through Clerk). New accounts wait at `/pending-approval` until an admin approves them in `/admin/teachers`, and the admin gets an email when someone signs up (Resend). |
| **Courses and classrooms** | Courses per semester, each with sections (classrooms), learning indicators and lesson plans. Classrooms have invite codes, a roster, join approval and a timeline of announcements. |
| **Co-teaching** | Several teachers per classroom, with roles: `primary`, `assistant` and `researcher` (view only). |
| **Homework and quizzes** | Question types: multiple choice, true/false, short answer and file upload. Work can be scheduled to publish later, ordered into groups, reused or copied between classes, and shared as a template. |
| **Retake quizzes** | A quiz for selected students only. The retake score replaces the original score. |
| **Grading** | A grading page per assignment and a combined page across sections. Choice questions are scored automatically. Short answers and files are graded in a grading workspace that moves from one student to the next, with feedback levels. |
| **Results release** | Results can be announced to students (with a LINE message) or kept hidden. |
| **Per-student reopening** | "Allow edit" or "Allow hand-in" for one student, with a time limit, even after the deadline. |
| **Integrity tracking** | Each submission is marked **Normal / Watch / Suspicious**, with a timeline of events: leaving the quiz, time away, split screen, copy and paste, closing and reopening the quiz. |
| **Attendance** | Check-in sessions that students answer from LINE, with present, late and absent records. |
| **LINE groups** | The bot links to a classroom's LINE group automatically. Announcements, new work, results and deadline reminders are posted there with deep links. |
| **Exports** | Excel reports: gradebook, attendance, submissions, question scores, roster and missing work. |
| **Admin console** | `/admin`: browse and edit tables, build datasets, manage storage, approve teachers. |
| **Languages** | Thai (default) and English. |

### 📱 Student LINE app (LIFF, `/liff`)

- **Home:** a to-do list of open work, a sideways-scrolling row of new results (each one disappears once opened, including from the teacher's LINE link), and open check-ins.
- **Classroom tabs:** timeline, work and quizzes, attendance, and **ส่งแทนเพื่อน** (lend this phone to a classmate whose phone has a problem).
- **Quizzes:** a countdown timer, live tracking of time away, warnings for closing and reopening the quiz, and an automatic blank hand-in after too many exits. With 1 question there is no warning; with 2 questions there is 1 warning; with 3 or more there are 2 warnings.
- **Deep links:** LINE messages open the exact assignment, result, check-in or announcement directly.
- **Fast start:** the last home screen is saved on the phone (per LINE account) and refreshed in the background.
- **Uploads:** images (JPEG, PNG, WebP, GIF, up to 5 MB) and PDFs (up to 10 MB), stored on Cloudflare R2.

### 🤖 LINE bot commands (in a classroom group)

Start a message with **`พุดดิ้ง`** or **`pudding`**, then a command:

| Command | Words |
|---|---|
| Check in | `เช็กชื่อ`, `มาเรียน`, `checkin` |
| Hand in / take a quiz | `ส่งงาน`, `ทำข้อสอบ`, `submit` |
| Join the classroom | `เข้าห้อง`, `รหัส`, `join` |
| Open work | `งาน`, `การบ้าน`, `ค้าง`, `todo` |
| Open the app | `หน้าหลัก`, `ลิงก์`, `home` |
| Status | `สถานะ`, `status` |
| Link / move / unlink this group (teachers) | `เชื่อม`, `ย้ายกลุ่ม`, `connect` |

Anything else replies with help. See [docs/LINE_SETUP_GUIDE.md](docs/LINE_SETUP_GUIDE.md#8-bot-commands).

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | **Next.js 16** (App Router), **React 19**, TypeScript |
| Styling | Tailwind CSS 4, `lucide-react` icons |
| Teacher auth | **Clerk** (LINE as the only sign-in method) |
| Student auth | **LINE LIFF**: the LINE access token is verified on the server for every request |
| Database | **Supabase** (PostgreSQL + Realtime) |
| File storage | **Cloudflare R2** (S3-compatible, served from `files.pudding-p.com`) |
| Messaging | **LINE Messaging API** (webhook, push, reply) |
| Email | Resend (teacher approval notices) |
| Hosting | **Vercel** (region `sin1`) |
| Scheduled jobs | Supabase `pg_cron` + `pg_net` (deadline reminders every 5 minutes) |

---

## Architecture

```
 Teacher browser (Clerk session)            Student in LINE (LIFF token)
            │                                          │
            └──────────────┬───────────────────────────┘
                           ▼
            Next.js on Vercel ── /api/data  (one door for all data)
                           │      /api/submissions, /api/upload, /api/line/*, …
                           │      • getActor(): verified Clerk teacher or LINE student
                           │      • each action checks what that caller may read or change
                           ▼
         Supabase (service role, server only) ── Realtime signals ──► open pages refresh
                           │
            Cloudflare R2 (files)      LINE Messaging API (groups, reminders)
```

Key points:

- **The browser never talks to the database directly.** `supabase_security_lockdown.sql` closes the database to the public key. All reads and writes go through `/api/data` (`src/lib/server/dataActions.ts`), which checks the caller.
- **Live updates:** the server broadcasts small per-classroom signals (submission, roster, attendance, timeline) over Supabase Realtime. Pages refetch only what changed, and fall back to polling when the socket is down.
- **Session cache for teachers** (`src/lib/cache/sessionCache.ts`): pages reuse data already loaded in the tab. Any write, a realtime signal or a maximum age marks it stale, and a stale copy is shown at once and refreshed silently.
- **Loading signals** (`src/components/LoadingState.tsx`): pages that are still fetching show a top progress bar and a chip, and first loads show placeholders shaped like the page. Silent refreshes of cached data show neither.
- **Rate limit:** 300 requests per minute per signed-in user and 60 per minute per IP without sign-in, counted in memory per Vercel instance.

---

## Project structure

```
src/
├── app/
│   ├── dashboard/, classrooms/[id]/    Teacher dashboard and classroom workspace
│   ├── works/, works/grade/            All work for the term, combined grading
│   ├── assignments/new/                Create, edit, copy or retake work
│   ├── assignments/[id]/grading/       Grade one assignment, integrity log
│   ├── students/, exports/             Student overview, Excel exports
│   ├── admin/                          Admin console (tables, teachers, storage)
│   ├── liff/                           Student LINE app (single page)
│   ├── pending-approval/, teacher-invite/
│   └── api/
│       ├── data/                       The data door (dataActions)
│       ├── submissions/, quiz-attempts/, upload/, attendance/
│       ├── line/webhook/               Bot: group linking, commands
│       ├── line/reminders/             Deadline reminders (called by pg_cron)
│       └── admin/…                     Admin-only endpoints
├── components/                         UI (teacher, works/, liff/)
├── lib/
│   ├── server/                         dataActions, access checks, grading, LINE sending
│   ├── supabase/dataService.ts         Browser client for /api/data
│   ├── cache/                          Teacher session cache, LIFF snapshot
│   ├── line/                           LIFF links, message texts, bot commands
│   ├── storage/                        R2 client, upload rules, zip
│   ├── i18n/                           th.json, en.json
│   └── utils/                          Integrity rules, quiz exits, grading status, …
└── types/database.ts                   Shared row types
supabase/schema.sql                     Base schema
supabase_*.sql                          Incremental migrations (see below)
scripts/                                Setup, verification and load-test scripts
docs/                                   LINE setup guide, load-test report
```

---

## Getting started

### Requirements

- Node.js 20 or later (developed on Node 24)
- A Supabase project, a Clerk application, a LINE Login channel with a LIFF app, a LINE Messaging API channel, and a Cloudflare R2 bucket

### Install and run

```bash
npm install
cp .env.example .env        # then fill in your own keys (see below)
npm run dev                 # http://localhost:3000
```

### Local development with production Clerk

The production Clerk instance refuses `localhost`, so teacher sign-in only works on an `https://*.pudding-p.com` origin. Use:

```bash
npm run dev:https           # serves https://dev.pudding-p.com
```

The script prints the one-time setup it needs: an `/etc/hosts` entry, permission to use port 443, and local certificates in `.certs/`. With development Clerk keys (`pk_test_…`), plain `npm run dev` works.

The student app (`/liff`) needs a real LINE login. Open it through the LIFF URL on a phone, or point the LIFF endpoint at your dev host.

---

## Environment variables

Set these in `.env` locally and in **Vercel → Settings → Environment Variables**. Never commit real values: `.env*` is git-ignored.

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public keys (Realtime only; the database itself is locked) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side database access. **Secret.** |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Teacher authentication |
| `NEXT_PUBLIC_LINE_LIFF_ID` (or `LINE_LIFF_ID`) | Student LIFF app id |
| `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` | Messaging API: sending and webhook signature |
| `LINE_BOT_BASIC_ID` | Bot id (e.g. `@xxxx`) for "add friend" links |
| `LINE_REMINDER_CRON_SECRET` | Protects `/api/line/reminders` (also used in `supabase_reminder_cron.sql`) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | File storage |
| `R2_PUBLIC_URL`, `R2_LEGACY_PUBLIC_URLS` | Public file URLs (current and older ones still served) |
| `ADMIN_EMAILS`, `ADMIN_USER_IDS` | Platform admins (comma-separated; verified Clerk emails or user ids) |
| `RESEND_API_KEY`, `ADMIN_NOTIFY_EMAILS`, `EMAIL_FROM` | Emails to admins when a teacher signs up |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Contact address on the approval page |
| `APP_URL` | Public site URL used in emails |
| `LINE_TEST_LIMIT_PER_CLASSROOM`, `LINE_TEST_LIMIT_PER_TEACHER`, `LINE_TEST_COOLDOWN_SECONDS` | Limits for the "send test message" button (rolling 30 days) |

---

## Database setup

1. In the Supabase SQL editor, run **`supabase/schema.sql`** (base tables: users, courses, learning indicators, classrooms, classroom students, posts, attendance, assignments, questions, submissions, answers, events, quiz attempts, stored files).
2. Run the migrations **in this order** (each is safe to re-run):

   | # | File | Adds |
   |---|---|---|
   | 1 | `supabase_schema_update.sql` | Comprehensive platform update |
   | 2 | `supabase_classroom_update.sql` | Timeline, groups and attendance permissions |
   | 3 | `supabase_line_join_update.sql` | LINE group join tracking |
   | 4 | `supabase_line_group_unique_update.sql` | One classroom per LINE group |
   | 5 | `supabase_security_lockdown.sql` | Closes the database to the public key |
   | 6 | `supabase_proxy_submission_update.sql` | Borrowed-phone submissions |
   | 7 | `supabase_assignment_order_update.sql` | Order of work inside a group |
   | 8 | `supabase_storage_files_update.sql` | R2 file tracking |
   | 9 | `supabase_teacher_line_repair.sql` | Repairs teachers holding a student LINE id |
   | 10 | `supabase_submission_reopen_update.sql` | Editing handed-in homework |
   | 11 | `supabase_teacher_approval_update.sql` | Teacher approval + LINE test quota |
   | 12 | `supabase_submission_reopen_until_update.sql` | Per-student reopen time limit |
   | 13 | `supabase_retake_update.sql` | Retake quizzes |
   | 14 | `supabase_quiz_exit_update.sql` | Quiz exit counting |
   | 15 | `supabase_reminder_unsent_update.sql` | Reminders the bot could not send |
   | 16 | `supabase_quiz_away_update.sql` | Live away-from-quiz tracking |
   | 17 | `supabase_line_connect_flow_update.sql` | Link LINE groups from the web, LIFF page or group, in any order |

3. Schedule the deadline reminders: edit the URL and `<CRON_SECRET>` in **`supabase_reminder_cron.sql`**, then run it. It calls `/api/line/reminders` every 5 minutes.
4. Verify with `npm run db:verify`. `npm run db:setup` can apply the schema with a `DATABASE_URL` (Supabase pooler connection string).

---

## LINE setup

The full guide is in **[docs/LINE_SETUP_GUIDE.md](docs/LINE_SETUP_GUIDE.md)**. It covers the Clerk LINE-only sign-in, the LINE Developers console (LIFF endpoint, webhook URL `https://<domain>/api/line/webhook`), environment variables, the teacher and student flows, bot commands and troubleshooting.

Check the setup at any time (read-only, prints no secrets):

```bash
npm run line:verify
```

> **Message quota:** the LINE plan allows 300 messages a month, and a group push costs one message per group member. When pushes fail, check the quota first. Messages that couldn't be sent are offered to the teacher to share from their own LINE.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on `http://localhost:3000` |
| `npm run dev:https` | Development server on `https://dev.pudding-p.com` (for production Clerk keys) |
| `npm run build` / `npm start` | Production build / run |
| `npm run lint` | ESLint |
| `npm run db:verify` | Checks the Supabase tables and columns |
| `npm run db:setup` | Applies the schema through a direct Postgres connection |
| `npm run storage:verify` | Tests the Supabase and R2 connections |
| `npm run storage:cors` | Sets the R2 bucket's CORS rules |
| `npm run line:verify` | Checks the Clerk, LINE and database setup for LINE |
| `node scripts/load-test.mjs .env [http\|realtime]` | Gentle read-only load test (run when no class is using the app) |

---

## Deployment

1. Push to GitHub and import the repository in **Vercel** (framework: Next.js).
2. Add every [environment variable](#environment-variables) for Production (and Preview if used).
3. Point the domain (`www.pudding-p.com`) at Vercel, and `files.pudding-p.com` at the R2 bucket.
4. In the LINE Developers console, set the LIFF endpoint to `https://<domain>/liff` and the webhook to `https://<domain>/api/line/webhook`.
5. Run the [database setup](#database-setup), including the reminder cron job.

---

## Capacity and limits

From the load test on 2026-11-07 ([full report](docs/LOAD_TEST_REPORT.md)): no errors up to 100 concurrent requests (≈300 requests/s on the API, ≈560 database reads/s), and 150 Realtime connections held open.

| Limit | Value |
|---|---|
| Supabase Realtime (Free plan) | ~200 concurrent connections, about **4–5 classes of 40 at the same moment**. Upgrade to Pro (~500) for more. |
| LINE messages | 300 per month (a group push costs one message per member) |
| Uploads | Images 5 MB, PDFs 10 MB, 30 draft files per assignment |
| Suspicious activity | 2 or more exits from the quiz, or 10 s or more away in total, or any quiz reopen |

---

## Development notes

- **Next.js 16 has breaking changes.** Read `node_modules/next/dist/docs/` before relying on older Next.js knowledge (see [AGENTS.md](AGENTS.md)).
- **Roster:** `classroom_students` is the source of truth. The `students` JSON on a classroom is a snapshot and can miss concurrent updates.
- **Latency:** each Supabase query takes about 150–200 ms from Vercel, so batch reads into one action rather than several round trips.
- **Teacher profile:** Clerk's name and institution win after the profile has been synced. The approval gate lives in `AppShell` / `TeacherProfileGate`.
- **Thai first:** user-facing text is Thai, with English in `src/lib/i18n/en.json` for teacher pages.
