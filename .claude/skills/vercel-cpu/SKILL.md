---
name: vercel-cpu
description: Rules that keep Pudding's Vercel Fluid Active CPU quota low (proxy.ts matcher, static vs server-rendered pages, polling, cron). Use before editing src/proxy.ts, adding a page/layout/not-found, calling auth()/currentUser()/headers()/cookies()/connection() on the server, adding an API route, or adding any setInterval/setTimeout loop that calls the server.
---

# Vercel CPU rules

The Hobby quota is small. Vercel is the backup server: it serves `www` only while the home computer is down (see the `two-servers` skill), but any day can be a Vercel day. Usage splits into **middleware** (`src/proxy.ts`) and **functions** (page renders + API routes). Active CPU counts busy CPU only (not waiting on Supabase/LINE), so cost = how often code runs × work per run.

## 1. Proxy (`src/proxy.ts`) runs only where Clerk is needed

Next 16 Proxy always runs on Node = a billed function per matched request. The matcher is the allow-list; keep it narrow.

- Clerk `auth()` / `currentUser()` **throw a 500** ("can't detect clerkMiddleware") on any route the proxy skipped. So:
  - A server page/layout that calls them must be matched for every request, prefetch included (today: `/` and `/admin/*`).
  - An API route that calls `auth()` directly (not via `getActor`) goes in the always-matched list: `/api/(admin|line/connections|line/teacher-link|classrooms/students)`. Add new ones there.
  - Prefer `getActor(request)` in new routes: with the LIFF header `x-line-access-token` it never reaches `auth()`, so LIFF calls skip the proxy.
- Skipped on purpose: `/liff/*` pages, any `/api` request carrying `x-line-access-token`, Clerk-free routes (`line/webhook|group-response|daily-summary|share|student-link`, `liff/*`, `cron/*`), and `next-router-prefetch` requests to teacher pages.
- A new Clerk-free API route (webhook, cron, signed link) → add it to the negative lookahead of the `/api/((?!…).*)` entry.
- Matcher values must be string literals (read at build time).

## 2. Keep pages static

`npx next build` must show teacher pages as `○` (static) or `●` (SSG), not `ƒ`. Only `/`, `/admin*`, redirect routes (`/grading`, `[...rest]`), sign-in/up and the two `[id]` pages are `ƒ`.

- **Never** call `connection()`, `headers()`, `cookies()`, `auth()` or read `searchParams` in `src/app/layout.tsx` or `src/app/not-found.tsx`. They sit in every page's tree; one dynamic call there turned every page into a server render per visit.
- Unknown URLs get their server redirect from `src/app/[...rest]/page.tsx`, not from not-found.
- **Don't** add `generateStaticParams` (empty or not) under `classrooms/[id]` or `assignments/[id]`. Tried 2026-11-11: on Vercel, the on-demand ISR render of an id that wasn't prebuilt returned 500 for every link prefetch. Classroom and grading links then broke across the app, though `next start` locally looked fine. Those two stay `ƒ`.
- Teacher pages are client components that load data through the API; keep it that way.

## 3. Polling must stop when nobody looks

Every timer that calls the server:
- returns early when `document.visibilityState !== 'visible'`, and catches up on `visibilitychange` if a missed tick matters (see `AttendanceQrScreen.tsx`);
- is only a fallback when realtime is down (`subscribeToClassroomSignals` `onLive`), never the main path;
- uses ≥ 5 s for "waiting for something to happen" (LINE link dialog) and ≥ 15 s for fallback refresh.
Local-only timers (clocks, countdowns, split-screen checks) are free; they don't touch the server.

## 4. Cron

pg_cron calls `/api/cron/daily` hourly 17:00–21:00 Bangkok only (`supabase_daily_cron.sql`). Keep it that sparse; don't go back to a 5-minute tick. Each run must exit early when there is nothing to do.

## Before finishing

1. `npx next build` → check the route list (`○`/`●` vs `ƒ`) hasn't grown new `ƒ` teacher pages (expected `ƒ`: `/`, `/admin*`, `/grading`, `[...rest]`, `/liff/[...rest]`, sign-in/up, `classrooms/[id]`, `assignments/[id]/grading`).
2. If proxy.ts changed: `next start` and curl a LIFF API call with `-H "x-line-access-token: x"` to every route that calls `auth()` → must be 401, never 500. Check `/`, `/dashboard`, `/liff`, an unknown URL, `/api/nope` redirect as before.
3. After deploy, curl the live site with `-H 'rsc: 1' -H 'next-router-prefetch: 1' -H 'next-router-segment-prefetch: /_tree'` on each page (`/classrooms/abc` included) → 200, never 500. Local `next start` does not reproduce Vercel's ISR behaviour.
4. Kill the old `next-server` before restarting, or the new one fails with EADDRINUSE and you test the old build.
