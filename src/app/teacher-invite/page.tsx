'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { Avatar } from '@/components/Avatar';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUser, SignInButton } from '@clerk/nextjs';
import Link from 'next/link';
import { dataService } from '@/lib/supabase/dataService';
import { Course } from '@/types/database';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  GraduationCap,
  FlaskConical,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  BookOpen,
} from 'lucide-react';

function TeacherInviteContent() {
  const { tr } = useLanguage();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user: clerkUser, isLoaded, isSignedIn } = useUser();

  // Short signed code; the course, role and inviter come from the server, not the URL.
  const inviteCode = searchParams.get('code') || '';
  const [inviterName, setInviterName] = useState(tr('อาจารย์ประจำวิชา', 'The course teacher'));
  const [inviteRole, setInviteRole] = useState<'assistant' | 'researcher'>('assistant');

  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joinedSuccess, setJoinedSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!inviteCode) {
      // Waits for Clerk to load before deciding what to show.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setErrorMessage(tr('ลิงก์คำเชิญไม่ครบ ขอลิงก์ใหม่จากครูประจำวิชา', 'This invite link is incomplete. Ask the course teacher for a new one.'));
      setLoading(false);
      return;
    }
    // The invite is shown to signed-in teachers only; the sign-in prompt below handles the rest.
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    dataService
      .getCourseInvite(inviteCode)
      .then((invite) => {
        if (cancelled) return;
        if (!invite) {
          setErrorMessage(tr('ลิงก์คำเชิญไม่ถูกต้อง หรือรายวิชาอาจถูกลบไปแล้ว', 'This invite link is invalid, or the course may have been deleted.'));
          return;
        }
        setCourse(invite.course);
        setInviteRole(invite.role);
        if (invite.inviterName) setInviterName(invite.inviterName);
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setErrorMessage(tr('เกิดข้อผิดพลาดในการโหลดคำเชิญ', 'Something went wrong while loading the invite'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteCode, isLoaded, isSignedIn, tr]);

  const handleAcceptInvite = async () => {
    if (!course || !clerkUser) return;
    setJoining(true);
    try {
      const teacherName =
        `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() ||
        clerkUser.username ||
        (inviteRole === 'researcher' ? tr('ครูตรวจวิจัย', 'research grader') : tr('ครูผู้ช่วย', 'teaching assistant'));
      const teacherEmail =
        clerkUser.primaryEmailAddress?.emailAddress || undefined;

      // The server adds this teacher to the course (as the invited role only).
      await dataService.acceptCourseInvite(inviteCode, {
        name: teacherName,
        email: teacherEmail,
        avatar_url: clerkUser.imageUrl || undefined,
      });

      setJoinedSuccess(true);
      setTimeout(() => {
        router.push('/dashboard');
      }, 2000);
    } catch (err) {
      console.error(err);
      setErrorMessage((err as { message?: string } | null)?.message || tr('เข้าร่วมไม่สำเร็จ ลองใหม่อีกครั้ง', 'Could not join, please try again'));
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-semibold text-slate-500">{tr('กำลังตรวจสอบคำเชิญ...', 'Checking invite...')}</p>
        </div>
      </div>
    );
  }

  if (isLoaded && !isSignedIn && inviteCode && !errorMessage) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-xl text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center mx-auto">
            <GraduationCap className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white">{tr('คำเชิญเข้าร่วมสอน', 'Teaching invitation')}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{tr('เข้าสู่ระบบด้วยบัญชีครูเพื่อดูและยืนยันคำเชิญ', 'Sign in with your teacher account to view and accept the invite')}</p>
          <SignInButton mode="modal">
            <button type="button" className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-sm cursor-pointer">
              {tr('เข้าสู่ระบบเพื่อดูคำเชิญ', 'Sign in to view the invite')}
            </button>
          </SignInButton>
        </div>
      </div>
    );
  }

  if (errorMessage || !course) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-xl text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white">{tr('คำเชิญไม่ถูกต้อง', 'Invalid invite')}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {errorMessage || tr('ไม่พบวิชาที่ระบุ', 'Course not found')}
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-950 font-bold text-xs hover:opacity-90"
          >
            {tr('กลับสู่แดชบอร์ด', 'Back to dashboard')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
        {/* Banner */}
        <div className="bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600 p-6 sm:p-8 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <FlaskConical className="w-36 h-36" />
          </div>
          <div className="relative z-10 space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-white text-xs font-black">
              {inviteRole === 'researcher' ? <FlaskConical className="w-3.5 h-3.5" /> : <GraduationCap className="w-3.5 h-3.5" />}
              <span>{inviteRole === 'researcher' ? tr('ครูตรวจเพื่อวิจัย • IRR', 'Research grader • IRR') : tr('ครูผู้ช่วยสอน (TA)', 'Teaching assistant (TA)')}</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight">
              {inviteRole === 'researcher' ? tr('คำเชิญเป็นครูตรวจเพื่อวิจัย', 'Invitation to be a research grader') : tr('คำเชิญเป็นครูผู้ช่วยสอน', 'Invitation to be a teaching assistant')}
            </h1>
            <p className="text-xs text-white/90">
              {inviterName} {inviteRole === 'researcher' ? tr('ได้เชิญคุณเข้าร่วมประเมินและตรวจงานวิจัยในรายวิชา', 'invited you to assess and grade for research in') : tr('ได้เชิญคุณเข้าร่วมเป็นครูผู้ช่วยสอนในรายวิชา', 'invited you to be a teaching assistant in')}
            </p>
          </div>
        </div>

        {/* Course Card Details */}
        <div className="p-6 sm:p-8 space-y-6">
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 space-y-3">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 mt-0.5">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
                    {course.code}
                  </span>
                  <span className="text-[11px] font-semibold text-slate-400">
                    {course.academic_year}
                  </span>
                </div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white mt-1">
                  {course.name}
                </h3>
                {course.description && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                    {course.description}
                  </p>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>
                  {inviteRole === 'researcher'
                    ? tr('สิทธิ์: ครูตรวจเพื่อวิจัย (คะแนนเก็บแยก นักเรียนไม่เห็น)', 'Access: research grader (scores kept separately, hidden from students)')
                    : tr('สิทธิ์: ครูผู้ช่วยสอน (ให้คะแนนจริงได้)', 'Access: teaching assistant (can give real scores)')}
                </span>
              </span>
              <span>{tr(`ตัวชี้วัด ${course.indicators?.length || 0} ข้อ`, `${course.indicators?.length || 0} indicators`)}</span>
            </div>
          </div>

          {/* Role Scope Notice */}
          {inviteRole === 'researcher' ? (
            <div className="p-3.5 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-300 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <span>{tr('🔬 วัตถุประสงค์เพื่อการวิจัยเท่านั้น', '🔬 For research purposes only')}</span>
              </p>
              <p className="text-[11px] leading-relaxed text-blue-700 dark:text-blue-400">
                {tr('คะแนนและความเห็นของคุณเก็บแยกไว้เพื่อวิเคราะห์ความสอดคล้องระหว่างผู้ตรวจ (IRR) เท่านั้น', 'Your scores and comments are kept separately, only to analyze inter-rater reliability (IRR).')}
                {tr('นักเรียนไม่เห็น และไม่กระทบคะแนนจริง', 'Students never see them and real scores are unaffected.')}
              </p>
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <span>{tr('🎓 บทบาทครูผู้ช่วยสอน (TA)', '🎓 Teaching assistant (TA) role')}</span>
              </p>
              <p className="text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400">
                {tr('คุณตรวจงานและให้คะแนนจริงได้ นักเรียนจะเห็นคำแนะนำของคุณ', 'You can grade and give real scores; students see your feedback.')}
                {tr('ส่วนการแก้ไขรายวิชาสงวนไว้ให้ครูผู้สอนหลัก', 'Editing the course stays with the primary teacher.')}
              </p>
            </div>
          )}

          {/* Actions */}
          {joinedSuccess ? (
            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-center space-y-2 animate-in fade-in">
              <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
              <p className="font-black text-sm">
                {inviteRole === 'researcher' ? tr('เข้าร่วมเป็นครูตรวจงานวิจัยเรียบร้อยแล้ว!', 'You joined as a research grader!') : tr('เข้าร่วมเป็นครูผู้ช่วยสอนเรียบร้อยแล้ว!', 'You joined as a teaching assistant!')}
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">{tr('กำลังนำทางไปยังแดชบอร์ด...', 'Taking you to the dashboard...')}</p>
            </div>
          ) : !isLoaded ? (
            <div className="text-center py-4 text-xs text-slate-400">{tr('กำลังตรวจสอบสถานะบัญชี...', 'Checking your account...')}</div>
          ) : isSignedIn ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs">
                <Avatar src={clerkUser.imageUrl} name={clerkUser.fullName} className="w-8 h-8 text-[10px]" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-900 dark:text-white truncate">
                    {clerkUser.fullName || clerkUser.username || tr('คุณครู', 'Teacher')}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {clerkUser.primaryEmailAddress?.emailAddress}
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300">
                  {tr('เข้าสู่ระบบแล้ว', 'Signed in')}
                </span>
              </div>

              <button
                type="button"
                onClick={handleAcceptInvite}
                disabled={joining}
                className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs shadow-md shadow-amber-500/20 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {joining ? (
                  <span>{tr('กำลังบันทึกข้อมูล...', 'Saving...')}</span>
                ) : (
                  <>
                    <span>
                      {inviteRole === 'researcher'
                        ? tr('ยืนยันเข้าร่วมเป็นครูตรวจเพื่อวิจัย', 'Join as research grader')
                        : tr('ยืนยันเข้าร่วมเป็นครูผู้ช่วยสอน (TA)', 'Join as teaching assistant (TA)')}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                {tr('เข้าสู่ระบบด้วยบัญชีครูเพื่อยืนยันคำเชิญ', 'Sign in with your teacher account to accept the invite')}
              </p>
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs shadow-md shadow-amber-500/20 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <GraduationCap className="w-4 h-4" />
                  <span>{tr('เข้าสู่ระบบด้วยบัญชีครู', 'Sign in as a teacher')}</span>
                </button>
              </SignInButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TeacherInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center bg-slate-50 dark:bg-slate-950">
          <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <TeacherInviteContent />
    </Suspense>
  );
}
