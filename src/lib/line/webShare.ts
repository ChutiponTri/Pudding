"use client";

import type { Liff } from "@line/liff";

/**
 * Sharing a card into LINE from the teacher website in one tap. The website
 * runs the LIFF SDK itself (outside the LIFF path it only logs a warning). In
 * a browser the SDK keeps the LINE sign-in in localStorage, so once the
 * teacher has connected LINE in this browser (a small window that signs in and
 * closes itself, see connectLine), the share button opens LINE's group picker
 * straight away, with the card fetched in advance. The picker always asks for
 * the group on the website: only a page opened from inside the group (the
 * teacher LIFF pages) can send without asking.
 */

type Messages = Parameters<Liff["shareTargetPicker"]>[0];
export type ShareCard = { messages: Messages; text: string };

let sdkReady: Promise<Liff | null> | null = null;

/** The LIFF SDK on this page (initialised once), or null when LIFF cannot run here. */
export function webLiff(): Promise<Liff | null> {
  sdkReady ||= (async () => {
    try {
      let id = process.env.NEXT_PUBLIC_LINE_LIFF_ID || "";
      if (!id) id = (await (await fetch("/api/liff/config")).json()).liffId || "";
      if (!id) return null;
      const sdk = (await import("@line/liff")).default;
      await sdk.init({ liffId: id });
      return sdk;
    } catch (error) {
      console.warn("LIFF is not available on this page:", error);
      return null;
    }
  })();
  return sdkReady;
}

/**
 * Whether the picker can open here now. Read at the moment it is needed: the
 * sign-in may have happened since, in the connect window (same site, same storage).
 */
export function canShareNow(liff: Liff | null): liff is Liff {
  try {
    return !!liff && liff.isLoggedIn() && liff.isApiAvailable("shareTargetPicker");
  } catch {
    return false;
  }
}

/**
 * Connects LINE in this browser once: a small window signs in to LINE
 * (/liff/share?login=1) and closes itself. Calls `onDone` when that window
 * has closed, so the caller can check canShareNow again.
 */
export function connectLine(liff: Liff | null, onDone: () => void) {
  const liffId = liff?.id || process.env.NEXT_PUBLIC_LINE_LIFF_ID || "";
  const url = liffId ? `https://liff.line.me/${liffId}/share?login=1` : `${window.location.origin}/liff/share?login=1`;
  const win = window.open(url, "pudding-line-connect", "popup,width=480,height=720");
  if (!win) {
    window.open(url, "_self");
    return;
  }
  const timer = window.setInterval(() => {
    if (!win.closed) return;
    window.clearInterval(timer);
    onDone();
  }, 500);
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
