'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Send, Share2, X } from 'lucide-react';
import { ModalSheet, ModalSheetBody, ModalSheetHeader } from '@/components/ModalSheet';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LINE_UNSENT_EVENT, type LineUnsentDetail } from '@/lib/utils/lineShare';

/**
 * Teacher pages: the bot could not send a post to the class LINE group
 * (monthly quota used up, LINE error, or no linked group). Offers to send the
 * same message from the teacher's own LINE account (/liff/share), which costs
 * the bot's quota nothing, or to copy its text. Opened by reportLineUnsent;
 * several at once (work copied to many classes) wait in line.
 */
export function LineSharePopup() {
  const { language } = useLanguage();
  const tr = (th: string, en: string) => (language === 'th' ? th : en);
  const [queue, setQueue] = useState<LineUnsentDetail[]>([]);
  const [copied, setCopied] = useState(false);

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
  if (!current) return null;
  const next = () => {
    setCopied(false);
    setQueue((prev) => prev.slice(1));
  };

  const heading =
    current.reason === 'quota'
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
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
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
        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 max-h-36 overflow-y-auto">
          <p className="text-[11px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap wrap-break-word leading-relaxed">{current.text}</p>
        </div>
        <div className="flex gap-2">
          {current.url && (
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              title={tr('ส่งข้อความเดียวกัน (มีปุ่ม) จากบัญชี LINE ของคุณครู — ไม่ใช้โควตาบอท', 'Send the same message (with its button) from your own LINE — uses none of the bot’s quota')}
              className="flex-1 h-10 rounded-xl bg-[#06c755] hover:bg-[#05b34c] text-white font-black text-sm inline-flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Send className="w-4 h-4" />
              {tr('แชร์ไป LINE', 'Share to LINE')}
            </a>
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
        <p className="text-[10px] text-slate-400 leading-relaxed">
          {tr('ส่งจาก LINE ของคุณครู ไม่ใช้โควตาบอท • แชร์ภายหลังได้จากไทม์ไลน์', 'Sent from your own LINE, no bot quota • you can share later from the timeline')}
        </p>
      </ModalSheetBody>
    </ModalSheet>
  );
}
