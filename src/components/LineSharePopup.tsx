'use client';

import { useEffect, useState } from 'react';
import type { Liff } from '@line/liff';
import { Check, Copy, Loader2, Send, Share2, X } from 'lucide-react';
import { ModalSheet, ModalSheetBody, ModalSheetHeader } from '@/components/ModalSheet';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LINE_UNSENT_EVENT, type LineUnsentDetail } from '@/lib/utils/lineShare';
import { loadShareCard, openSharePage, shareCardNow, webLiff, type ShareCard } from '@/lib/line/webShare';

/**
 * Teacher pages: something to send into the class LINE group from the
 * teacher's own LINE (new work, a check-in, a reminder, scores, or a post the
 * bot could not send), which uses no message quota. The card is loaded as soon
 * as this opens, so one tap opens LINE's group picker on this page; until the
 * browser has signed in to LINE once, the tap opens the share page instead.
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
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    const onUnsent = (event: Event) => {
      const detail = (event as CustomEvent<LineUnsentDetail>).detail;
      if (!detail?.text) return;
      setQueue((prev) => (prev.some((item) => item.url === detail.url && item.text === detail.text) ? prev : [...prev, detail]));
    };
    window.addEventListener(LINE_UNSENT_EVENT, onUnsent);
    return () => window.removeEventListener(LINE_UNSENT_EVENT, onUnsent);
  }, []);

  const current = queue[0];
  const currentUrl = current?.url || null;
  // Ready before the tap: LINE's picker must open straight from it.
  useEffect(() => {
    if (!currentUrl) return;
    let alive = true;
    webLiff().then((sdk) => alive && setLiff(sdk));
    loadShareCard(currentUrl)
      .then((loaded) => alive && loaded && setCard({ url: currentUrl, card: loaded }))
      .catch((error) => console.warn('Loading the LINE card failed:', error));
    return () => {
      alive = false;
    };
  }, [currentUrl]);

  if (!current) return null;
  const next = () => {
    setCopied(false);
    setQueue((prev) => prev.slice(1));
  };

  const toGroup = current.reason === 'card';
  const ready = liff && card?.url === current.url ? card.card : null;
  const send = async () => {
    if (!current.url) return;
    if (!ready || !liff) return openSharePage(current.url);
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
              {current.title || tr('แชร์เองจาก LINE ของคุณครู', 'Share it from your own LINE')}
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
          <p className="text-[11px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap wrap-break-word leading-relaxed">{current.text}</p>
        </div>
        <div className="flex gap-2">
          {current.url && (
            <button
              type="button"
              onClick={send}
              disabled={sharing}
              title={tr('ส่งการ์ดจากบัญชี LINE ของคุณครู — ไม่ใช้โควตาบอท', 'Send the card from your own LINE — uses none of the bot’s quota')}
              className="flex-1 h-10 rounded-xl bg-[#06c755] hover:bg-[#05b34c] text-white font-black text-sm inline-flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-60"
            >
              {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
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
