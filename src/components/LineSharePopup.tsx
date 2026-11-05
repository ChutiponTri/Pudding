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

  return (
    <ModalSheet onClose={next} size="sm:max-w-md">
      <ModalSheetHeader>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
            <Share2 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">
              {current.reason === 'quota'
                ? tr('โควตาข้อความ LINE ของเดือนนี้หมดแล้ว', 'This month’s LINE message quota is used up')
                : current.reason === 'limit'
                ? tr('ส่งซ้ำผ่านบอทครบจำนวนแล้ว', 'Bot re-announcements used up for now')
                : current.reason === 'no_group'
                ? tr('ห้องนี้ยังไม่ได้เชื่อมกลุ่ม LINE', 'This class is not linked to a LINE group')
                : tr('บอทส่งเข้ากลุ่ม LINE ไม่สำเร็จ', 'The bot could not send to the LINE group')}
            </h3>
            <p className="text-[11px] text-slate-400 truncate">
              {current.title ? `${current.title} • ` : ''}
              {tr('บันทึกในไทม์ไลน์แล้ว • แชร์เข้ากลุ่มเองได้', 'Saved to the timeline • share it yourself')}
              {queue.length > 1 ? ` • ${tr(`อีก ${queue.length - 1} รายการ`, `${queue.length - 1} more`)}` : ''}
            </p>
          </div>
        </div>
        <button type="button" onClick={next} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl cursor-pointer shrink-0" aria-label={tr('ปิด', 'Close')}>
          <X className="w-4 h-4" />
        </button>
      </ModalSheetHeader>
      <ModalSheetBody className="space-y-3">
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {current.reason === 'quota'
            ? tr(
                'การส่งเข้ากลุ่มนับ 1 ข้อความต่อสมาชิก 1 คน กด “แชร์ไป LINE” เพื่อส่งข้อความเดียวกัน (มีปุ่ม) จากบัญชี LINE ของคุณครูเอง ไม่ใช้โควตาของบอท',
                'A group message counts once per member. Tap “Share to LINE” to send the same message (with its button) from your own LINE account; it uses none of the bot’s quota.'
              )
            : tr(
                'กด “แชร์ไป LINE” เพื่อส่งข้อความเดียวกัน (มีปุ่ม) จากบัญชี LINE ของคุณครูเอง',
                'Tap “Share to LINE” to send the same message (with its button) from your own LINE account.'
              )}
        </p>
        {current.note && <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">{current.note}</p>}
        <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 max-h-48 overflow-y-auto">
          <p className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap wrap-break-word leading-relaxed">{current.text}</p>
        </div>
        <div className="grid gap-2">
          {current.url && (
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              className="h-11 rounded-2xl bg-[#06c755] hover:bg-[#05b34c] text-white font-black text-sm inline-flex items-center justify-center gap-2 shadow-sm"
            >
              <Send className="w-4 h-4" />
              {tr('แชร์ไป LINE (มีปุ่ม)', 'Share to LINE (with button)')}
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(current.text).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="h-11 rounded-2xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            {copied ? tr('คัดลอกแล้ว', 'Copied') : tr('คัดลอกข้อความ (วางในกลุ่มเอง)', 'Copy the text (paste it yourself)')}
          </button>
        </div>
        {current.url && (
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {tr(
              'บนมือถือจะเปิดในแอป LINE • บนคอมพิวเตอร์ให้เข้าสู่ระบบ LINE ครั้งแรก แล้วเลือกกลุ่มที่จะส่ง • แชร์ภายหลังได้จากปุ่มในไทม์ไลน์ของห้อง',
              'On a phone it opens in the LINE app • on a computer, log in to LINE the first time, then pick the group • you can also share later from the class timeline'
            )}
          </p>
        )}
      </ModalSheetBody>
    </ModalSheet>
  );
}
