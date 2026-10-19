# Pudding × LINE: setup and usage guide

Teachers sign in **only with LINE**. Their LINE account and Pudding Bot are linked automatically: there are no pairing codes. Classroom LINE groups link when the bot joins a group, and unlink when the bot leaves.

Check the setup at any time with:

```bash
npm run line:verify
```

It is read-only and prints no secrets. It checks Clerk's sign-in methods, the Supabase columns, the teachers who have no LINE ID yet, and the LINE env vars.

---

## 1. Current status (checked 2026-10-19)

| Area | Status |
|---|---|
| **Supabase service-role privileges** | ❌ The server key cannot read `courses`, `assignments`, `questions`, `submissions` (and 4 more) or update `users`. Run the grants in section 10. This breaks LIFF submissions and leaves teacher LINE linking stuck on "กำลังตรวจสอบ...". |
| Supabase columns (`users.line_bot_friend`, `classrooms.line_group_name`, …) | ✅ All present, nothing to alter |
| LINE env vars (`LINE_CHANNEL_*`, LIFF ID, `LINE_BOT_BASIC_ID`) | ✅ Set in `.env` |
| Clerk **development** instance (`pumped-hyena-2033`, the one in `.env`) | ❌ Email, password and Google are **still on** |
| Existing teachers | ⚠️ 2 teachers (อรวรรณ, ธิปนรรจ์) have no LINE ID yet |

> Clerk settings are **per instance**. If you changed the *production* instance, the local `.env` (development) still allows email and Google. Apply section 3 to **every** instance you use: development and production.

---

## 2. Before turning off email and Google: move the existing teachers to LINE

A LINE sign-in creates a **new** Clerk user unless LINE is connected to the existing account first. A new user would not own the teacher's courses or classrooms. Each existing teacher should do this **while email or Google still works**:

1. Sign in to Pudding the usual way (email or Google).
2. Click the avatar (top right) → **Manage account** → **Connected accounts** → **Connect account** → **LINE**, then approve in LINE.
3. Open the dashboard once. Pudding copies the LINE ID automatically. In **ข้อมูลคุณครู** (the profile popup), the LINE card should show **เชื่อมแล้ว**.
4. Run `npm run line:verify`. "Teachers" should report **Every teacher has a LINE id**.

Only then continue with section 3.

---

## 3. Clerk dashboard (each instance)

Menu names can differ slightly between Clerk versions.

1. **User & authentication → Email, phone, username**
   - **Email address:** turn off *Sign-in with email*, and make it **not required**. This matters: LINE only shares an email when your LINE Login channel has email permission. If email stays required, LINE sign-ups get stuck on an "add email" step.
   - **Password:** off.
   - **Phone / Username / Passkey:** off.
2. **User & authentication → SSO connections (Social connections)**
   - **Google:** off.
   - **LINE:** on, with **Use custom credentials** set to the *Channel ID / Channel secret* of your **LINE Login channel**.
   - That LINE Login channel **must be under the same LINE provider as the Messaging API bot**. Otherwise the LINE ID Clerk gives Pudding differs from the one the bot sees, and nothing will link.
3. Make sure Clerk's callback URL is listed in the LINE Login channel → **LINE Login → Callback URL**.

Re-run `npm run line:verify`. The Clerk section should be all ✅.

---

## 4. LINE Developers console

**Messaging API channel (Pudding Bot)**
- **Webhook URL:** `https://<your-domain>/api/line/webhook`. Turn on **Use webhook**, then press **Verify**.
- **Allow bot to join group chats:** **On** (needed for classroom groups).
- In the LINE Official Account Manager, turn **Auto-reply messages off**, so only Pudding answers.
- The webhook needs these events, which LINE sends by default: `follow`, `unfollow`, `join`, `leave`, `memberJoined`, `message`.

**LINE Login channel (used by Clerk)**
- Same provider as the bot (see section 3).
- **Linked LINE Official Account:** choose Pudding Bot. If Clerk forwards LINE's `bot_prompt`, LINE then offers "add friend" during sign-up. If it doesn't, teachers get an **"+ เพิ่มเพื่อน Pudding Bot"** button in Pudding (section 6).

**LIFF app (students):** the endpoint URL should be `https://<your-domain>/liff`.

---

## 5. Environment variables (local `.env` and the hosting provider, e.g. Vercel)

| Variable | Purpose |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` | Messaging API (bot replies, webhook signature) |
| `LINE_LIFF_ID` / `NEXT_PUBLIC_LINE_LIFF_ID` | Student LIFF app |
| `LINE_BOT_BASIC_ID` | Bot ID such as `@123abcd`, used for the add-friend button |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | The webhook and linking write to Supabase with the service role |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk. Production uses its own `pk_live_…` / `sk_live_…` keys |

Add `LINE_BOT_BASIC_ID` to the production environment too, then redeploy.

---

## 6. Teacher flow (new app flow)

### Sign up (one time)
1. Open Pudding → **เข้าสู่ระบบครูผู้สอน** → **Continue with LINE** → approve in LINE.
2. The **ยินดีต้อนรับสู่ Pudding!** popup opens. Enter your first and last name, pick your institution from the list, then press **บันทึกและเริ่มใช้งาน**.
3. Your LINE account is now linked automatically. The LINE card in the profile popup shows **เชื่อมแล้ว**. You can reopen the popup from the institution button on the dashboard.
4. If the card says **Pudding Bot: ยังไม่ได้เพิ่มเพื่อน**, press **+ เพิ่มเพื่อน Pudding Bot**. The bot greets you by name, and the card updates.

### Connect a classroom to a LINE group
1. On the dashboard class card (or the classroom page → **เชื่อมบอท LINE**), press **เชื่อม LINE Group**. The status changes to **🟡 รอเพิ่มบอทเข้ากลุ่ม**, and Pudding waits for **15 minutes**.
2. In LINE, open the classroom's group (you must be a member) and invite **Pudding Bot**.
3. The bot replies **✅ เชื่อมกลุ่มนี้กับห้องเรียน “…” เรียบร้อยแล้ว**, followed by the student join link. Within a few seconds, Pudding shows **🟢 เชื่อมแล้ว: \<group name\>**.

- **Bot already in the group?** Press **เชื่อม LINE Group** in Pudding, then send *any* message in the group. That completes the link.
- **One at a time:** each teacher can have only one classroom waiting. Starting a new one cancels the previous wait.

### Disconnect
- **From LINE:** remove Pudding Bot from the group. The classroom unlinks automatically.
- **From Pudding:** press **ยกเลิกการเชื่อมต่อ**. The classroom unlinks **and the bot leaves the group**.

### What a linked group gets
- Assignment reminders and attendance announcements.
- Students can type **ขอรหัสเข้าห้อง** (or `#pudding join`) to get the classroom code and join link.
- New members get the join link automatically.

---

## 7. Student flow (LINE LIFF)

1. Open the join link (from the group, the QR code, or `#pudding join`). It opens Pudding inside LINE.
2. The first time, fill in name, student number and school.
3. Wait for the teacher to approve (**Admit**). Then use **งาน / ข้อสอบ** to do work, **เช็คชื่อ** to check in, and **ไทม์ไลน์** for announcements.

---

## 8. Bot commands

| Where | Command | Result |
|---|---|---|
| Group | `ขอรหัสเข้าห้อง` / `#pudding join` | Classroom code + join link |
| Group | `#pudding status` | Whether the group is linked |
| Teacher 1:1 chat | `#pudding status` | How many of your classrooms have a linked group |
| Teacher 1:1 chat | `#pudding test <classroom id>` | Sends a test message to that classroom's group |
| Anywhere | `#pudding help` | List of commands |

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| LINE card stuck on **กำลังตรวจสอบ...** or shows "ตรวจสอบสถานะ LINE ไม่สำเร็จ" | The server's Supabase key lacks table privileges (`permission denied for table`, 42501). Run the grants in section 10, then `npm run line:verify`. |
| LINE card: "พบบัญชีครูเดิมที่ใช้อีเมลเดียวกัน" | The teacher's old email/Google account row still holds this email. Clear the old row's email (section 10, part 2), or merge the accounts. |
| LINE card says **ยังไม่เชื่อม**: "บัญชีนี้ไม่ได้เข้าสู่ระบบด้วย LINE" | The Clerk account has no LINE connection. Connect LINE (section 2, step 2), then reopen the dashboard. |
| LINE card: "บัญชี LINE นี้ถูกใช้กับบัญชีอื่น" | That LINE account already belongs to another Pudding user, usually the same person's student LIFF profile. Use a different LINE account, or remove or merge the student row in `users`. |
| Bot replies "ยังไม่พบห้องเรียนที่รอเชื่อมกลุ่มนี้" | No classroom was waiting, the 15-minute window expired, or the teacher who pressed connect is not in that group. Press **เชื่อม LINE Group** again, then send a message in the group. |
| Linked, but the IDs never match (nothing links) | The LINE Login channel used by Clerk is under a different provider than the bot. Fix it in section 3. |
| Sign-up stuck asking for an email | Clerk still requires email (section 3, step 1). |
| No **+ เพิ่มเพื่อน Pudding Bot** button | `LINE_BOT_BASIC_ID` is missing on the deployed environment. |
| Webhook "Verify" fails | Wrong URL, or `LINE_CHANNEL_SECRET` / `SUPABASE_SERVICE_ROLE_KEY` is missing on the server. |

---

## 10. Database reference

### Part 1: server privileges (required, **not applied yet**)

Run this once in **Supabase → SQL Editor**. The API routes use the service-role key, and it currently cannot read most tables.

```sql
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
```

### Part 2: move two teachers to their new LINE accounts (one time)

ชุติพนธ์ and ธิปนรรจ์ signed in with LINE as new Clerk accounts. Their old teacher rows still hold their emails, which blocks the new rows. The old rows own no classrooms, posts or attendance sessions. Clearing their email lets the LINE accounts get their own rows on the next dashboard load:

```sql
UPDATE public.users SET email = NULL
WHERE role = 'teacher'
  AND id IN ('user_3KYUk3UE4MGjRWybtW7zsY600Lg', 'user_3Kii9aLiw2uem3ARhihNW8GlAir');
```

### Part 3: LINE columns

These columns are **already applied** to your Supabase project. The SQL is kept here (and at the end of `supabase_schema_update.sql`) for new environments. It is safe to re-run.

```sql
ALTER TABLE IF EXISTS public.users
ADD COLUMN IF NOT EXISTS line_bot_friend BOOLEAN DEFAULT FALSE;

ALTER TABLE IF EXISTS public.classrooms
ADD COLUMN IF NOT EXISTS line_group_name TEXT;

CREATE INDEX IF NOT EXISTS idx_classrooms_line_group_id ON public.classrooms(line_group_id);
CREATE INDEX IF NOT EXISTS idx_classrooms_line_connection_status ON public.classrooms(line_connection_status);
```

Run it in **Supabase → SQL Editor**. The two indexes are optional performance helpers. They couldn't be checked from the app, because Supabase's REST API doesn't expose indexes.
