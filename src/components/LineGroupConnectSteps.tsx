'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Instructions for linking a classroom to a LINE group without a pairing code:
 * the teacher taps "เชื่อม LINE Group", adds Pudding Bot to the group, then taps
 * the bot's confirm button or sends any message there. Only that teacher's
 * LINE account can complete the link.
 */
export const LineGroupConnectSteps: React.FC<{
  status: 'disconnected' | 'waiting' | 'connected';
  botFriend?: boolean | null;
  addFriendUrl?: string;
}> = ({ status, botFriend, addFriendUrl }) => {
  const steps = [
    botFriend === false && addFriendUrl ? (
      <>
        เพิ่มเพื่อน{' '}
        <a href={addFriendUrl} target="_blank" rel="noreferrer" className="font-bold text-[#06C755] underline">
          Pudding Bot
        </a>{' '}
        ก่อน (จำเป็นสำหรับการเชิญบอทเข้ากลุ่ม)
      </>
    ) : null,
    <>กดปุ่ม <b>เชื่อม LINE Group</b> ด้านล่าง</>,
    <>เปิดกลุ่ม LINE ของห้องเรียน แล้วเชิญ <b>Pudding Bot</b> เข้ากลุ่ม (ต้องเป็นกลุ่มที่คุณครูอยู่)</>,
    <>กด <b>เชื่อมกลุ่ม</b> ในข้อความของบอท หรือพิมพ์ข้อความใดก็ได้ในกลุ่ม ด้วยบัญชี LINE ของคุณครูเอง (ไม่ต้องพิมพ์รหัส)</>,
    <>ถ้ากลุ่มนี้เคยเชื่อมกับห้องเรียนอื่น (เช่น ภาคเรียนก่อน) บอทจะถามยืนยันก่อนย้ายกลุ่มมาห้องนี้</>,
  ].filter(Boolean);

  return (
    <div className="space-y-3">
      <ol className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
        {steps.map((step, index) => (
          <li key={index} className="flex items-start gap-2.5">
            <span className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-300 font-black text-[11px] flex items-center justify-center shrink-0 mt-0.5">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {status === 'waiting' && (
        <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold">กำลังรอให้เพิ่ม Pudding Bot เข้ากลุ่ม...</p>
            <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
              ถ้าเพิ่มบอทไว้ในกลุ่มแล้ว ให้คุณครูพิมพ์ข้อความใดก็ได้ในกลุ่ม ระบบจะเชื่อมทันที (รอได้ 15 นาที)
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
