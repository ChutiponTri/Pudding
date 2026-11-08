"use client";

import type { Liff } from "@line/liff";

/**
 * Sharing a card into LINE from the teacher website in one tap. The website
 * runs the LIFF SDK itself (outside the LIFF path it only logs a warning), so
 * once the teacher's browser has signed in to LINE (any earlier /liff/share
 * visit counts; it is the same site), the share button opens LINE's group
 * picker right away, with the card fetched in advance. LINE's picker always
 * needs the teacher to choose the group on the website: only a page opened
 * from inside the group (the teacher LIFF pages) can send without asking.
 */

type Messages = Parameters<Liff["shareTargetPicker"]>[0];
export type ShareCard = { messages: Messages; text: string };

let ready: Promise<Liff | null> | null = null;

/** The LIFF SDK on this page, signed in to LINE; null when it is not available here or not signed in. */
export function webLiff(): Promise<Liff | null> {
  ready ||= (async () => {
    try {
      let id = process.env.NEXT_PUBLIC_LINE_LIFF_ID || "";
      if (!id) id = (await (await fetch("/api/liff/config")).json()).liffId || "";
      if (!id) return null;
      const sdk = (await import("@line/liff")).default;
      await sdk.init({ liffId: id });
      return sdk.isLoggedIn() && sdk.isApiAvailable("shareTargetPicker") ? sdk : null;
    } catch (error) {
      console.warn("LIFF is not available on this page:", error);
      return null;
    }
  })();
  return ready;
}

const tokenOf = (url: string | null) => {
  try {
    return url ? new URL(url).searchParams.get("t") : null;
  } catch {
    return null;
  }
};

/** The messages a share sends (the card, or the reminder picture). */
export async function loadShareCard(url: string | null): Promise<ShareCard | null> {
  const token = tokenOf(url);
  if (!token) return null;
  const res = await fetch(`/api/line/share?t=${encodeURIComponent(token)}`, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "โหลดการ์ดไม่สำเร็จ");
  return { messages: json.messages as Messages, text: json.text as string };
}

/**
 * Opens LINE's group picker with the card. Must run straight from the tap
 * (the picker is a popup window); throws when it could not open here, so the
 * caller falls back to the share page.
 */
export async function shareCardNow(liff: Liff, url: string | null, card: ShareCard): Promise<"shared" | "cancelled"> {
  const result = await liff.shareTargetPicker(card.messages, { isMultiple: false });
  if (result?.status !== "success") return "cancelled";
  const token = tokenOf(url);
  // The timeline stops offering it as unsent.
  if (token) fetch("/api/line/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: token }) }).catch(() => {});
  return "shared";
}

/** The share page in a small window (signs in to LINE first when needed), which opens the picker by itself. */
export function openSharePage(url: string) {
  const target = `${url}${url.includes("?") ? "&" : "?"}auto=1`;
  const win = window.open(target, "pudding-line-share", "popup,width=480,height=760");
  // Popups blocked: open it in this tab instead.
  if (!win) window.open(target, "_self");
}
