'use client';

import { useEffect, useRef, useState } from 'react';
import type { Liff } from '@line/liff';
import { Check, Copy, Link2, Loader2, Send, Share2, X } from 'lucide-react';
import { ModalSheet, ModalSheetBody, ModalSheetHeader } from '@/components/ModalSheet';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LINE_PENDING_CANCEL_EVENT, LINE_UNSENT_EVENT, type LineUnsentDetail } from '@/lib/utils/lineShare';
import { canShareNow, connectLine, loadShareCard, openSharePage, shareCardNow, webLiff, type ShareCard } from '@/lib/line/webShare';

/**
 * Teacher pages: something to send into the class LINE group from the
 * teacher's own LINE (new work, a check-in, a reminder, scores, or a post the
 * bot could not send), which uses no message quota. The card is loaded as soon
 * as this opens, so one tap opens LINE's group picker on this page. The first
 * time in a browser, "เชื่อม LINE" signs in to LINE in a small window that
 * closes itself; from then on it is always one tap.
 * Opened by reportLineUnsent; several at once (work copied to many classes)
 * wait in line.
 */
export function LineSharePopup() {
  const { language } = useLanguage();
  const tr = (th: string, en: string) => (language === 'th' ? th : en);
  const [queue, setQueue] = useState<LineUnsentDetail[]>([]);
  const [copied, setCopied] = useState(false);
  const [liff, setLiff] = useState<Liff | null>(null);
  const [card, setCard] = useState<{ url: string | null; card: ShareCard } | null>(null);
  /** The card for this url could not be loaded: the share page takes over. */
  const [cardFailed, setCardFailed] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  /** Signed in to LINE in this browser (re-checked: the sign-in happens in another window). */
  const [linked, setLinked] = useState(false);
  const [connecting, setConnecting] = useState(false);
  /** Popups closed while still preparing: their late answer stays closed. */
  const closedPending = useRef(new Set<string>());

  useEffect(() => {
    const onUnsent = (event: Event) => {
      const detail = (event as CustomEvent<LineUnsentDetail>).detail;
      if (!detail || (!detail.text && !detail.pending)) return;
      if (detail.pendingId && closedPending.current.has(detail.pendingId)) return;
      setQueue((prev) => {
        // The server's answer for a popup opened at the tap: it takes that entry's place.
        const at = !detail.pending && detail.pendingId ? prev.findIndex((item) => item.pendingId === detail.pendingId) : -1;
        const rest = at >= 0 ? prev.filter((_, index) => index !== at) : prev;
        if (rest.some((item) => !item.pending && item.url === detail.url && item.text === detail.text)) return rest;
        if (at < 0) return [...rest, detail];
        const next = [...rest];
        next.splice(at, 0, { ...detail, pending: false });
        return next;
      });
    };
    const onCancel = (event: Event) => {
      const pendingId = (event as CustomEvent<{ pendingId: string }>).detail?.pendingId;
      if (pendingId) setQueue((prev) => prev.filter((item) => item.pendingId !== pendingId));
    };
    window.addEventListener(LINE_UNSENT_EVENT, onUnsent);
    window.addEventListener(LINE_PENDING_CANCEL_EVENT, onCancel);
    return () => {
      window.removeEventListener(LINE_UNSENT_EVENT, onUnsent);
      window.removeEventListener(LINE_PENDING_CANCEL_EVENT, onCancel);
    };
  }, []);

  const current = queue[0];
  const currentUrl = current?.url || null;
  const open = !!current;
  // The LIFF SDK starts as soon as the popup opens (even while the server is
  // still preparing the card), so it is ready by the time the card is.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    webLiff().then((sdk) => {
      if (!alive) return;
      setLiff(sdk);
      setLinked(canShareNow(sdk));
    });
    return () => {
      alive = false;
    };
  }, [open]);
  // Ready before the tap: LINE's picker must open straight from it.
  useEffect(() => {
    if (!currentUrl) return;
    let alive = true;
    loadShareCard(currentUrl)
      .then((loaded) => {
        if (!alive) return;
        if (loaded) setCard({ url: currentUrl, card: loaded });
        else setCardFailed(currentUrl);
      })
      .catch((error) => {
        console.warn('Loading the LINE card failed:', error);
        if (alive) setCardFailed(currentUrl);
      });
    return () => {
      alive = false;
    };
  }, [currentUrl]);

  // The connect window saves the LINE sign-in in this site's storage: pick it up when it lands.
  useEffect(() => {
    if (!liff) return;
    const recheck = () => setLinked(canShareNow(liff));
    window.addEventListener('storage', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      window.removeEventListener('storage', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [liff]);

  if (!current) return null;
  const next = () => {
    if (current.pendingId) closedPending.current.add(current.pendingId);
    setCopied(false);
    setQueue((prev) => prev.slice(1));
  };

  const toGroup = current.reason === 'card';
  const ready = card?.url === current.url ? card.card : null;
  /** Still waiting on the server, or on the card the picker sends. */
  const preparing = !!current.pending || (!!current.url && !ready && cardFailed !== current.url && canShareNow(liff));
  // LIFF cannot run on this page, or this is a phone: the share page does it. On a
  // phone it opens in the LINE app, where the group list comes up without another tap.
  const noLiffHere = !liff || liff.getOS() !== 'web';
  const connect = () => {
    setConnecting(true);
    connectLine(liff, () => {
      setConnecting(false);
      setLinked(canShareNow(liff));
    });
  };
  const send = async () => {
    if (!current.url) return;
    // Checked again at the tap: the sign-in may have just happened in the connect window.
    if (!ready || !canShareNow(liff)) return openSharePage(current.url);
    setSharing(true);
    try {
      if ((await shareCardNow(liff, current.url, ready)) === 'shared') next();
    } catch (error) {
      console.warn('LINE picker could not open here, using the share page:', error);
      openSharePage(current.url);
    } finally {
      setSharing(false);
    }
  };

  const heading =
    toGroup
      ? tr('ส่งเข้ากลุ่ม LINE', 'Send to the LINE group')
      : current.reason === 'quota'
      ? tr('โควตา LINE เดือนนี้ไม่พอ', 'Not enough LINE quota')
      : current.reason === 'limit'
      ? tr('บอทส่งซ้ำครบแล้ว', 'Bot re-sends used up')
      : current.reason === 'no_group'
      ? tr('ยังไม่ได้เชื่อมกลุ่ม LINE', 'No linked LINE group')
      : tr('บอทส่งไม่สำเร็จ', 'The bot could not send');

  return (
    <ModalSheet onClose={next} size="sm:max-w-md">
      <ModalSheetHeader>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${toGroup ? 'bg-violet-500/10 text-violet-600' : 'bg-amber-500/10 text-amber-600'}`}>
            <Share2 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-900 dark:text-white truncate">{heading}</h3>
            <p className="text-[11px] text-slate-400 truncate">
              {current.title || (current.pending ? tr('กำลังเตรียมการ์ด...', 'Preparing the card...') : tr('แชร์เองจาก LINE ของคุณครู', 'Share it from your own LINE'))}
              {queue.length > 1 ? ` • ${tr(`อีก ${queue.length - 1}`, `${queue.length - 1} more`)}` : ''}
            </p>
          </div>
        </div>
        <button type="button" onClick={next} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl cursor-pointer shrink-0" aria-label={tr('ปิด', 'Close')}>
          <X className="w-4 h-4" />
        </button>
      </ModalSheetHeader>
      <ModalSheetBody className="space-y-2.5">
        {current.note && <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">{current.note}</p>}
        {toGroup && (
          <p className="text-[11px] text-violet-800 dark:text-violet-200 leading-relaxed p-2.5 rounded-xl bg-violet-50 dark:bg-violet-950/40 ring-1 ring-violet-200 dark:ring-violet-900">
            {tr(
              'แตะ “ส่งเข้ากลุ่ม” แล้วเลือกกลุ่ม LINE ของห้องนี้ การ์ดจะถูกส่งจาก LINE ของคุณครู — ไม่ใช้โควตาข้อความ',
              'Tap “Send to group” and pick this class’s LINE group: the card goes from your own LINE, using no message quota'
            )}
          </p>
        )}
        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 max-h-36 overflow-y-auto">
          {current.pending ? (
            <div className="space-y-1.5 py-0.5" aria-label={tr('กำลังเตรียมข้อความ', 'Preparing the message')}>
              <div className="h-2.5 w-3/4 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
              <div className="h-2.5 w-1/2 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
              <div className="h-2.5 w-2/3 rounded bg-slate-200 dark:bg-slate-700 animate-pulse" />
            </div>
          ) : (
            <p className="text-[11px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap wrap-break-word leading-relaxed">{current.text}</p>
          )}
        </div>
        {current.pending ? (
          <button
            type="button"
            disabled
            className="w-full h-10 rounded-xl bg-[#06c755] text-white font-black text-sm inline-flex items-center justify-center gap-1.5 shadow-sm opacity-60"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            {tr('กำลังเตรียมการ์ด...', 'Preparing the card...')}
          </button>
        ) : (
          <div className="flex gap-2">
            {current.url && !noLiffHere && !linked && (
              <button
                type="button"
                onClick={connect}
                disabled={connecting}
                title={tr('ครั้งแรกในเบราว์เซอร์นี้: เข้าสู่ระบบ LINE หน้าต่างจะปิดเอง แล้วกดส่งได้ทันที', 'First time in this browser: sign in to LINE; the window closes by itself, then send in one tap')}
                className="flex-1 h-10 rounded-xl bg-[#06c755] hover:bg-[#05b34c] text-white font-black text-sm inline-flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
              >
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {tr('เชื่อม LINE (ครั้งแรก)', 'Connect LINE (first time)')}
              </button>
            )}
            {current.url && (noLiffHere || linked) && (
              <button
                type="button"
                onClick={send}
                disabled={sharing || preparing}
                title={tr('ส่งการ์ดจากบัญชี LINE ของคุณครู — ไม่ใช้โควตาบอท', 'Send the card from your own LINE — uses none of the bot’s quota')}
                className="flex-1 h-10 rounded-xl bg-[#06c755] hover:bg-[#05b34c] text-white font-black text-sm inline-flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
              >
                {sharing || preparing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {toGroup ? tr('ส่งเข้ากลุ่ม', 'Send to group') : tr('แชร์ไป LINE', 'Share to LINE')}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(current.text).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className={`${current.url ? 'shrink-0 px-3' : 'flex-1'} h-10 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm inline-flex items-center justify-center gap-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer`}
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              {copied ? tr('คัดลอกแล้ว', 'Copied') : tr('คัดลอก', 'Copy')}
            </button>
          </div>
        )}
        {current.url && !current.pending && !noLiffHere && !linked && (
          <p className="text-[10px] text-slate-400 leading-relaxed">
            {tr('เชื่อมครั้งเดียวต่อเบราว์เซอร์ ครั้งต่อไปกด “ส่งเข้ากลุ่ม” แล้วเลือกกลุ่มได้ทันที • ', 'Once per browser; next time “Send to group” goes straight to the group list • ')}
            <button type="button" onClick={() => current.url && openSharePage(current.url)} className="underline underline-offset-2 cursor-pointer hover:text-slate-600">
              {tr('หรือเปิดหน้าแชร์', 'or open the share page')}
            </button>
          </p>
        )}
        {current.onDismiss ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-slate-400 leading-relaxed">
              {tr('ส่งจาก LINE ของคุณครู ไม่ใช้โควตาบอท • ปิดไว้ก่อน จะเตือนอีกครั้งเมื่อเปิดเว็บครั้งหน้า', 'Sent from your own LINE, no bot quota • close it and you are asked again next visit')}
            </p>
            <button
              type="button"
              onClick={() => {
                current.onDismiss?.();
                next();
              }}
              className="shrink-0 text-[11px] font-bold text-slate-500 hover:text-rose-600 underline underline-offset-2 cursor-pointer"
            >
              {tr('ไม่ต้องส่งแล้ว', 'No need to send')}
            </button>
          </div>
        ) : (
          <p className="text-[10px] text-slate-400 leading-relaxed">
            {tr('ส่งจาก LINE ของคุณครู ไม่ใช้โควตาบอท • แชร์ภายหลังได้จากไทม์ไลน์', 'Sent from your own LINE, no bot quota • you can share later from the timeline')}
          </p>
        )}
      </ModalSheetBody>
    </ModalSheet>
  );
}
