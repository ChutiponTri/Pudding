'use client';

import React from 'react';
import { Loader2, RefreshCw, Users } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export type LineGroupChoice = { ref: string; groupName?: string };

/**
 * Linking a classroom to a LINE group from the web: the groups Pudding Bot is
 * in with this teacher are listed, and one click links one. No group yet?
 * Invite the bot, then tap its "เชื่อมห้องเรียน" button in LINE (or come back
 * and refresh this list). Nothing waits for a message in the group.
 */
export const LineGroupConnectSteps: React.FC<{
  botFriend?: boolean | null;
  addFriendUrl?: string;
  /** undefined while loading */
  groups?: LineGroupChoice[];
  /** false: the teacher's account has no LINE sign-in, so no group can be checked */
  lineLinked?: boolean;
  onLinkGroup: (ref: string) => void;
  linkingRef?: string | null;
  onRefresh: () => void;
  refreshing?: boolean;
}> = ({ botFriend, addFriendUrl, groups, lineLinked, onLinkGroup, linkingRef, onRefresh, refreshing }) => {
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
    tr(
      <>เปิดกลุ่ม LINE ของห้องเรียน แล้วเชิญ <b>Pudding Bot</b> เข้ากลุ่ม</>,
      <>Open the class LINE group and invite <b>Pudding Bot</b></>
    ),
    tr(
      <>แตะ <b>เชื่อมห้องเรียน</b> ในข้อความของบอท แล้วเลือกห้องนี้ หรือกลับมากด <b>รีเฟรช</b> แล้วเลือกกลุ่มด้านบน</>,
      <>Tap <b>เชื่อมห้องเรียน</b> in the bot&apos;s message and pick this classroom, or come back, press <b>Refresh</b> and pick the group above</>
    ),
  ].filter(Boolean);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{tr('กลุ่มที่มี Pudding Bot อยู่', 'Groups with Pudding Bot')}</p>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="text-[11px] font-bold text-amber-700 dark:text-amber-400 inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> {tr('รีเฟรช', 'Refresh')}
          </button>
        </div>
        {groups === undefined ? (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 className="w-4 h-4 animate-spin" /> {tr('กำลังค้นหากลุ่ม...', 'Looking for groups...')}
          </div>
        ) : lineLinked === false ? (
          <p className="text-xs p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200">
            {tr('บัญชีครูยังไม่ได้เชื่อม LINE กรุณาเข้าสู่ระบบด้วย LINE ก่อน', 'Your account has no LINE sign-in yet. Sign in with LINE first')}
          </p>
        ) : groups.length ? (
          groups.map((group) => (
            <button
              key={group.ref}
              type="button"
              disabled={Boolean(linkingRef)}
              onClick={() => onLinkGroup(group.ref)}
              className="w-full h-10 px-3 rounded-xl bg-line hover:bg-line-dark text-white text-xs font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {linkingRef === group.ref ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              <span className="truncate">{tr('เชื่อมกับ', 'Link to')} “{group.groupName || tr('กลุ่ม LINE', 'LINE group')}”</span>
            </button>
          ))
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400 p-3 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800">
            {tr('ยังไม่พบกลุ่มที่มีบอทและคุณครูอยู่ด้วยกัน ทำตามขั้นตอนด้านล่าง', 'No group with both the bot and you yet. Follow the steps below')}
          </p>
        )}
      </div>

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
    </div>
  );
};
