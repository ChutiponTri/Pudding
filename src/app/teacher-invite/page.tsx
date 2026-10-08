'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useUser, SignInButton } from '@clerk/nextjs';
import Link from 'next/link';
import { dataService } from '@/lib/supabase/dataService';
import { Course, ClassroomTeacher } from '@/types/database';
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user: clerkUser, isLoaded, isSignedIn } = useUser();

  const courseId = searchParams.get('courseId') || '';
  const inviterName = searchParams.get('inviter') || 'อาจารย์ประจำวิชา';
  const inviteRole: 'assistant' | 'researcher' = (searchParams.get('role') as 'assistant' | 'researcher') === 'researcher' ? 'researcher' : 'assistant';

  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joinedSuccess, setJoinedSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCourse() {
      if (!courseId) {
        setErrorMessage('ไม่พบรหัสรายวิชาในลิงก์คำเชิญ');
        setLoading(false);
        return;
      }
      try {
        const found = await dataService.getCourseById(courseId);
        if (found) {
          setCourse(found);
        } else {
          setErrorMessage('ไม่พบข้อมูลรายวิชานี้ในระบบ หรือวิชาอาจถูกลบไปแล้ว');
        }
      } catch (err) {
        console.error(err);
        setErrorMessage('เกิดข้อผิดพลาดในการโหลดข้อมูลวิชา');
      } finally {
        setLoading(false);
      }
    }
    fetchCourse();
  }, [courseId]);

  const handleAcceptInvite = async () => {
    if (!course || !clerkUser) return;
    setJoining(true);
    try {
      const teacherName =
        `${clerkUser.firstName || ''} ${clerkUser.lastName || ''}`.trim() ||
        clerkUser.username ||
        (inviteRole === 'researcher' ? 'ครูตรวจวิจัย' : 'ครูผู้ช่วย');
      const teacherEmail =
        clerkUser.primaryEmailAddress?.emailAddress || `${clerkUser.id}@pudding.ac.th`;

      const currentTeachers = course.teachers || [];
      const alreadyTeacherIndex = currentTeachers.findIndex(
        (t) => t.teacher_id === clerkUser.id || t.email === teacherEmail
      );

      let updatedTeachers = [...currentTeachers];
      if (alreadyTeacherIndex >= 0) {
        // Update their role if they rejoin with another invite
        updatedTeachers[alreadyTeacherIndex] = {
          ...updatedTeachers[alreadyTeacherIndex],
          role: inviteRole,
          name: teacherName,
        };
      } else {
        const newTeacher: ClassroomTeacher = {
          teacher_id: clerkUser.id,
          name: teacherName,
          email: teacherEmail,
          avatar_url: clerkUser.imageUrl || undefined,
          role: inviteRole,
        };
        updatedTeachers.push(newTeacher);
      }

      await dataService.updateCourse(course.id, {
        teachers: updatedTeachers,
      });

      setJoinedSuccess(true);
      setTimeout(() => {
        router.push('/dashboard');
      }, 2000);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err?.message || 'ไม่สามารถบันทึกการเข้าร่วมได้ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-semibold text-slate-500">กำลังตรวจสอบคำเชิญ...</p>
        </div>
      </div>
    );
  }

  if (errorMessage || !course) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-xl text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center mx-auto">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white">คำเชิญไม่ถูกต้อง</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {errorMessage || 'ไม่พบวิชาที่ระบุ'}
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-950 font-bold text-xs hover:opacity-90"
          >
            กลับสู่แดชบอร์ด
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
        {/* Banner */}
        <div className="bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600 p-6 sm:p-8 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <FlaskConical className="w-36 h-36" />
          </div>
          <div className="relative z-10 space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-white text-xs font-black">
              {inviteRole === 'researcher' ? <FlaskConical className="w-3.5 h-3.5" /> : <GraduationCap className="w-3.5 h-3.5" />}
              <span>{inviteRole === 'researcher' ? 'การตรวจงานวิจัย • IRR Benchmark' : 'ครูผู้ช่วยสอน • Teaching Assistant (TA)'}</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight">
              {inviteRole === 'researcher' ? 'คำเชิญเป็นครูตรวจงานวิจัย (Research Evaluator)' : 'คำเชิญเป็นครูผู้ช่วยสอน (Teaching Assistant)'}
            </h1>
            <p className="text-xs text-white/90">
              {inviterName} {inviteRole === 'researcher' ? 'ได้เชิญคุณเข้าร่วมประเมินและตรวจงานวิจัยในรายวิชา' : 'ได้เชิญคุณเข้าร่วมเป็นครูผู้ช่วยสอนในรายวิชา'}
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
                    ? 'สิทธิ์: ครูตรวจงานวิจัย (คะแนนจัดเก็บแยกส่วน ไม่โชว์นักเรียน)'
                    : 'สิทธิ์: ครูผู้ช่วยสอน (ตรวจและให้คะแนนทางการแก่นักเรียนได้)'}
                </span>
              </span>
              <span>ตัวชี้วัด {course.indicators?.length || 0} ข้อ</span>
            </div>
          </div>

          {/* Role Scope Notice */}
          {inviteRole === 'researcher' ? (
            <div className="p-3.5 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-300 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <span>🔬 วัตถุประสงค์เพื่อการวิจัยเท่านั้น</span>
              </p>
              <p className="text-[11px] leading-relaxed text-blue-700 dark:text-blue-400">
                คะแนนและความเห็นที่คุณตรวจจะถูกบันทึกในช่องงานวิจัย เพื่อวิเคราะห์ความเที่ยงตรงระหว่างผู้ตรวจ
                (Inter-Rater Reliability: IRR) เท่านั้น โดยจะไม่แสดงให้นักเรียนเห็น และไม่กระทบคะแนนทางการของผู้สอนหลักหรือ TA
              </p>
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <span>🎓 บทบาทครูผู้ช่วยสอน (TA)</span>
              </p>
              <p className="text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400">
                คุณสามารถตรวจงาน ให้คะแนนจริงแก่นักเรียน และนักเรียนจะสามารถเห็นคำแนะนำของคุณได้ อย่างไรก็ตาม
                การแก้ไขรายวิชาและตั้งค่าหลักสูตรจะสงวนไว้ให้ครูผู้สอนหลักเท่านั้น
              </p>
            </div>
          )}

          {/* Actions */}
          {joinedSuccess ? (
            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-center space-y-2 animate-in fade-in">
              <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
              <p className="font-black text-sm">
                {inviteRole === 'researcher' ? 'เข้าร่วมเป็นครูตรวจงานวิจัยเรียบร้อยแล้ว!' : 'เข้าร่วมเป็นครูผู้ช่วยสอนเรียบร้อยแล้ว!'}
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">กำลังนำทางไปยังแดชบอร์ด...</p>
            </div>
          ) : !isLoaded ? (
            <div className="text-center py-4 text-xs text-slate-400">กำลังตรวจสอบสถานะบัญชี...</div>
          ) : isSignedIn ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs">
                <img
                  src={clerkUser.imageUrl || 'https://images.unsplash.com/photo-1534528741775?w=100'}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-900 dark:text-white truncate">
                    {clerkUser.fullName || clerkUser.username || 'คุณครู'}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {clerkUser.primaryEmailAddress?.emailAddress}
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300">
                  เข้าสู่ระบบแล้ว
                </span>
              </div>

              <button
                type="button"
                onClick={handleAcceptInvite}
                disabled={joining}
                className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs shadow-md shadow-amber-500/20 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {joining ? (
                  <span>กำลังบันทึกข้อมูล...</span>
                ) : (
                  <>
                    <span>
                      {inviteRole === 'researcher'
                        ? 'ยืนยันเข้าร่วมเป็นครูตรวจงานวิจัย (Research Evaluator)'
                        : 'ยืนยันเข้าร่วมเป็นครูผู้ช่วยสอน (TA)'}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                กรุณาลงชื่อเข้าใช้ด้วยบัญชีครูของท่าน เพื่อยืนยันสิทธิ์ครูผู้ช่วยตรวจ
              </p>
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="w-full py-3 rounded-2xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs shadow-md shadow-amber-500/20 transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <GraduationCap className="w-4 h-4" />
                  <span>เข้าสู่ระบบด้วยบัญชีครู</span>
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
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
          <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <TeacherInviteContent />
    </Suspense>
  );
}
