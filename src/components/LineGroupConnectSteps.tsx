'use client';

import React from 'react';
import { Loader2, Users } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export type LineCandidateGroup = { groupId: string; groupName?: string };

/**
 * Instructions for linking a classroom to a LINE group without a pairing code.
 * Groups Pudding Bot already sits in with this teacher are offered first (one
 * click links). Otherwise the teacher taps "เชื่อม LINE Group", adds the bot
 * to the group within 24 hours and confirms there; or starts from LINE: add
 * the bot first and tap "เชื่อมห้องเรียน". Only that teacher's LINE account
 * can complete the link.
 */
export const LineGroupConnectSteps: React.FC<{
  status: 'disconnected' | 'waiting' | 'connected';
  botFriend?: boolean | null;
  addFriendUrl?: string;
  candidates?: LineCandidateGroup[];
  onLinkGroup?: (groupId: string) => void;
  linkingGroupId?: string | null;
}> = ({ status, botFriend, addFriendUrl, candidates, onLinkGroup, linkingGroupId }) => {
  const { tr } = useLanguage();
  const botLink = (
    <a href={addFriendUrl} target="_blank" rel="noreferrer" className="font-bold text-line underline">
      Pudding Bot
    </a>
  );
  const steps = [
    botFriend === false && addFriendUrl
      ? tr(
          <>เพิ่มเพื่อน {botLink} ก่อน (จำเป็นสำหรับการเชิญบอทเข้ากลุ่ม)</>,
          <>Add {botLink} as a friend first (needed to invite the bot to a group)</>
        )
      : null,
    tr(<>กดปุ่ม <b>เชื่อม LINE Group</b> ด้านล่าง</>, <>Tap <b>Connect LINE group</b> below</>),
    tr(
      <>เปิดกลุ่ม LINE ของห้องเรียน แล้วเชิญ <b>Pudding Bot</b> เข้ากลุ่ม ภายใน 24 ชม.</>,
      <>Open the class LINE group and invite <b>Pudding Bot</b> within 24 hours</>
    ),
    tr(
      <>กด <b>เชื่อมกลุ่ม</b> ในข้อความของบอท ด้วยบัญชี LINE ของคุณครูเอง (ถ้าบอทอยู่ในกลุ่มแล้ว พิมพ์ข้อความใดก็ได้)</>,
      <>Tap <b>เชื่อมกลุ่ม</b> in the bot&apos;s message from your own LINE account (bot already there? send any message)</>
    ),
  ].filter(Boolean);

  return (
    <div className="space-y-3">
      {candidates && candidates.length > 0 && onLinkGroup && (
        <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 space-y-2">
          <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
            {tr('พบกลุ่มที่มี Pudding Bot อยู่แล้ว แตะเพื่อเชื่อมทันที', 'Pudding Bot is already in these groups. Tap one to link it')}
          </p>
          {candidates.map((group) => (
            <button
              key={group.groupId}
              type="button"
              disabled={Boolean(linkingGroupId)}
              onClick={() => onLinkGroup(group.groupId)}
              className="w-full h-10 px-3 rounded-xl bg-line hover:bg-line-dark text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {linkingGroupId === group.groupId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              <span className="truncate">{group.groupName || tr('กลุ่ม LINE', 'LINE group')}</span>
            </button>
          ))}
          <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80">
            {tr('ไม่ใช่กลุ่มเหล่านี้? ทำตามขั้นตอนด้านล่าง', 'Not one of these? Follow the steps below')}
          </p>
        </div>
      )}

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

      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {tr(
          <>💡 เริ่มจาก LINE ก็ได้: เชิญ Pudding Bot เข้ากลุ่มก่อน แล้วแตะ <b>เชื่อมห้องเรียน</b> เลือกห้องนี้ ไม่ต้องกดปุ่มบนเว็บ</>,
          <>💡 Or start in LINE: invite Pudding Bot to the group first, tap <b>เชื่อมห้องเรียน</b> and pick this classroom. No web button needed</>
        )}
      </p>

      {status === 'waiting' && (
        <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold">{tr('กำลังรอให้เพิ่ม Pudding Bot เข้ากลุ่ม...', 'Waiting for Pudding Bot to be added to the group...')}</p>
            <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80">
              {tr('ถ้าเพิ่มบอทไว้ในกลุ่มแล้ว ให้คุณครูพิมพ์ข้อความใดก็ได้ในกลุ่ม ระบบจะเชื่อมทันที (รอได้ 24 ชม.)', 'If the bot is already in the group, send any message there and it links right away (waits up to 24 hours)')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
