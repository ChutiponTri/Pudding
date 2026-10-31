'use client';

import { useState } from 'react';
import { useClerk, useUser } from '@clerk/nextjs';
import { Clock, Loader2, LogOut, RefreshCw, ShieldX } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { recheckTeacherAccess, useTeacherAccess } from '@/lib/hooks/useTeacherAccess';

/**
 * The only page a signed-in teacher sees until the admin approves the account
 * (TeacherProfileGate sends them here and back). It loads no classroom data.
 */
export default function PendingApprovalPage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const { tr } = useLanguage();
  const { access, profile, userId } = useTeacherAccess();
  const [checking, setChecking] = useState(false);
  const known = userId && userId === user?.id ? access : null;

  const checkAgain = () => {
    setChecking(true);
    recheckTeacherAccess();
    // The gate redirects on approval; this only stops the spinner otherwise.
    window.setTimeout(() => setChecking(false), 1500);
  };

  const name = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : user?.fullName || '';
  const rejected = known === 'rejected';

  return (
    <div className="min-h-dvh flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-6 sm:p-8 text-center space-y-5">
        {known === null || known === 'ok' ? (
          <Loader2 className="w-7 h-7 animate-spin text-amber-500 mx-auto" />
        ) : (
          <>
            <div
              className={`w-14 h-14 rounded-2xl mx-auto flex items-center justify-center ${
                rejected ? 'bg-rose-100 dark:bg-rose-950/50 text-rose-600' : 'bg-amber-100 dark:bg-amber-950/50 text-amber-600'
              }`}
            >
              {rejected ? <ShieldX className="w-7 h-7" /> : <Clock className="w-7 h-7" />}
            </div>
            <div className="space-y-2">
              <h1 className="text-lg font-black text-slate-900 dark:text-white">
                {rejected
                  ? tr('บัญชีไม่ได้รับการอนุมัติ', 'Account not approved')
                  : known === 'incomplete'
                    ? tr('กรอกข้อมูลครูให้ครบก่อน', 'Complete your teacher profile first')
                    : tr('รอการอนุมัติบัญชีครู', 'Waiting for account approval')}
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                {rejected
                  ? tr(
                      'ผู้ดูแลระบบไม่อนุมัติให้บัญชีนี้ใช้งาน Pudding หากคิดว่าเป็นความผิดพลาด กรุณาติดต่อผู้ดูแลระบบ',
                      'The administrator did not approve this account for Pudding. If you think this is a mistake, please contact the administrator.'
                    )
                  : tr(
                      'ขอบคุณที่สมัครใช้งาน Pudding! ผู้ดูแลระบบจะตรวจสอบบัญชีครูของคุณ เมื่อได้รับการอนุมัติแล้วจะใช้งานได้ทันที',
                      'Thanks for signing up for Pudding! The administrator will review your teacher account. You can start as soon as it is approved.'
                    )}
              </p>
            </div>

            {(name || profile?.institution || profile?.email) && (
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 px-4 py-3 text-left text-xs space-y-1">
                {name && <p className="font-bold text-slate-800 dark:text-slate-100">{name}</p>}
                {profile?.institution && <p className="text-slate-500 dark:text-slate-400">{profile.institution}</p>}
                {profile?.email && <p className="text-slate-400">{profile.email}</p>}
              </div>
            )}

            <div className="flex flex-col gap-2">
              {!rejected && (
                <button
                  type="button"
                  onClick={checkAgain}
                  disabled={checking}
                  className="w-full h-11 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-sm font-bold cursor-pointer disabled:opacity-60 inline-flex items-center justify-center gap-2"
                >
                  {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {tr('ตรวจสอบสถานะอีกครั้ง', 'Check again')}
                </button>
              )}
              <button
                type="button"
                onClick={() => signOut({ redirectUrl: '/' })}
                className="inline-flex items-center justify-center gap-1.5 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                {tr('ออกจากระบบ', 'Sign out')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
