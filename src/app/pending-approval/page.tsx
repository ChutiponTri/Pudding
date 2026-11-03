'use client';

import { useState } from 'react';
import { useClerk, useUser } from '@clerk/nextjs';
import { Check, Clock, Copy, Loader2, LogOut, Mail, RefreshCw, ShieldX } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { recheckTeacherAccess, useTeacherAccess } from '@/lib/hooks/useTeacherAccess';

/** Where teachers can write with questions about their approval. */
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'admin@pudding-p.com';

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
  const [copied, setCopied] = useState(false);
  const known = userId && userId === user?.id ? access : null;

  const checkAgain = () => {
    setChecking(true);
    recheckTeacherAccess();
    // The gate redirects on approval; this only stops the spinner otherwise.
    window.setTimeout(() => setChecking(false), 1500);
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (e.g. insecure context): the address is still visible and tappable.
    }
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
                      'ผู้ดูแลระบบไม่อนุมัติให้บัญชีนี้ใช้งาน Pudding หากคิดว่าเป็นความผิดพลาด กรุณาติดต่อผู้ดูแลระบบทางอีเมลด้านล่าง',
                      'The administrator did not approve this account for Pudding. If you think this is a mistake, please email the administrator below.'
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

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 flex items-center gap-3 text-left">
              <span className="w-10 h-10 shrink-0 rounded-xl bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                <Mail className="w-4.5 h-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {tr('มีคำถาม? ติดต่อผู้ดูแลระบบได้ที่', 'Questions? Contact the administrator')}
                </p>
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(tr('สอบถามการอนุมัติบัญชีครู Pudding', 'Pudding teacher account approval'))}`}
                  className="block truncate text-sm font-bold text-slate-900 dark:text-white hover:text-sky-600 dark:hover:text-sky-400 underline-offset-2 hover:underline"
                >
                  {SUPPORT_EMAIL}
                </a>
              </div>
              <button
                type="button"
                onClick={copyEmail}
                aria-label={copied ? tr('คัดลอกแล้ว', 'Copied') : tr('คัดลอกอีเมล', 'Copy email')}
                title={copied ? tr('คัดลอกแล้ว', 'Copied') : tr('คัดลอกอีเมล', 'Copy email')}
                className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center cursor-pointer transition-colors ${
                  copied
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <span className="sr-only" aria-live="polite">{copied ? tr('คัดลอกอีเมลแล้ว', 'Email copied') : ''}</span>

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
