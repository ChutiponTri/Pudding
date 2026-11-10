---
name: line-share
description: Rules for sending Pudding cards into LINE from the teacher website or teacher LIFF (liff.shareTargetPicker, liff.sendMessages, /liff/share, LineSharePopup, webShare.ts, kit.tsx postMessages). Use before changing anything that opens LINE's share picker or sends a card into a chat.
---

# LINE share rules

Files: `src/lib/line/webShare.ts` (website one-tap picker), `src/components/LineSharePopup.tsx` (website popup), `src/app/liff/share/page.tsx` (share page), `src/components/liff-teacher/kit.tsx` (`postMessages`: teacher LIFF), `src/app/api/line/share/route.ts` (card + `?target=1` group lookup).

## Never do

- **Never pass `isMultiple: false` to `liff.shareTargetPicker`.** LINE's picker then lists friends only and no groups, so teachers cannot pick the class group. Always use `{ isMultiple: true }`, in every call site.
- Don't put an async step (await, a fetch, a confirm box) between the teacher's tap and `shareTargetPicker` on the website: the picker is a popup and needs the tap. Load the card and the target group before the tap (as LineSharePopup does).
- Don't rely on `liff.getContext().groupId` / `roomId` / `utouId`: LINE no longer returns them, so the page cannot tell which chat it is in.

## How wrong-group sends are handled

- The picker never reports which chat was picked, so nothing can be refused. The website popup and share page name the right group ("เลือกกลุ่ม "<line_group_name>" เท่านั้น") before the picker opens.
- Teacher LIFF: opened from a group, the first send per opening asks "ส่งเข้าแชตนี้ใช่ไหม?"; anywhere else it names the group before the picker.
- Only the reminder picture (ทวงงาน) reaches the bot; a trigger in the wrong group gets a free bot reply "⚠️ ส่งผิดกลุ่ม" (`warnWrongGroup` in the webhook). Finished flex cards never reach the webhook.

## Copy

Keep the warnings short: group name + class name. The user removed "อย่าเลือกแชตส่วนตัวหรือกลุ่มของห้องอื่น"; don't add it back.

## Before finishing

`grep -rn "isMultiple" src` must show only `true`.
