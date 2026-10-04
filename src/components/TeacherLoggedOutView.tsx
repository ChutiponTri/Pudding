"use client";

import React from "react";
import Link from "next/link";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import {
  Sparkles,
  ShieldAlert,
  Smartphone,
  CheckCircle2,
  ArrowRight,
  School,
  FileCheck2,
  LogIn,
  UserPlus,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";

export const TeacherLoggedOutView: React.FC = () => {
  const { t, language } = useLanguage();

  return (
    <div className="space-y-12 py-4">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-500 p-8 md:p-14 text-slate-950 shadow-2xl shadow-amber-500/20">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-96 h-96 rounded-full bg-white/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/15 backdrop-blur-md text-xs font-black tracking-wide text-slate-950">
            <span className="text-base select-none">🍮</span>
            <span>{language === "th" ? "พุดดิ้งแพลทฟอร์ม • ครูผู้สอน" : "Pudding Platform • Teacher"}</span>
          </div>

          <h1 className="text-3xl md:text-5xl font-black tracking-tight leading-tight text-slate-950">
            {language === "th"
              ? "แพลตฟอร์มการจัดการการเรียนรู้และตรวจการบ้านอัจฉริยะ"
              : "Intelligent Learning Assessment & Integrity Platform"}
          </h1>

          <p className="text-slate-950/90 text-sm md:text-base font-medium leading-relaxed max-w-2xl">
            {language === "th"
              ? "ยกระดับการสอนภาษาไทยด้วยระบบเกณฑ์รูบริกอัตโนมัติ ตรวจจับพฤติกรรมความซื่อสัตย์แบบเรียลไทม์ และบูรณาการนักเรียนผ่าน LINE LIFF ได้อย่างไร้รอยต่อ"
              : "Empowering educators with AI-assisted rubric grading, real-time exam integrity monitoring, and seamless student engagement via LINE LIFF."}
          </p>

          {/* Teacher Login CTAs */}
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Link
              href="/sign-in"
              className="px-3 py-3.5 rounded-2xl bg-slate-950 hover:bg-slate-900 text-white font-bold text-sm shadow-xl shadow-black/25 hover:shadow-2xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2.5 cursor-pointer"
            >
              <LogIn className="w-4 h-4 text-amber-400" />
              <span>{language === "th" ? "เข้าสู่ระบบครูผู้สอน" : "Teacher Sign In"}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>

            <Link
              href="/sign-up"
              className="px-3 py-3.5 rounded-2xl bg-white/90 hover:bg-white text-slate-950 font-bold text-sm shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95 flex items-center gap-2 cursor-pointer border border-white/50"
            >
              <UserPlus className="w-4 h-4 text-orange-600" />
              <span>{language === "th" ? "ลงทะเบียนบัญชีใหม่" : "Create Account"}</span>
            </Link>

            <Link
              href="/liff"
              className="px-3 py-3.5 rounded-2xl bg-emerald-950/20 hover:bg-emerald-950/30 text-slate-950 font-bold text-xs shadow-md backdrop-blur-md border border-emerald-900/30 transition-all hover:scale-105 flex items-center gap-2"
            >
              <Smartphone className="w-4 h-4 text-emerald-900" />
              <span>{language === "th" ? "เข้าสู่มุมมองนักเรียน" : "Student Sign In"}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Feature Highlights Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
            <FileCheck2 className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-base text-slate-900 dark:text-white">
            {language === "th" ? "ตรวจข้อสอบ & วิเคราะห์ตามรูบริก" : "AI Rubric & Co-Grading"}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {language === "th"
              ? "วิเคราะห์คำตอบตามตัวชี้วัด สพฐ. คำนวณความสอดคล้องระหว่างผู้ตรวจ (IRR) และให้ข้อเสนอแนะรายบุคคล"
              : "Automated standard competency alignment, IRR calculation, and tailored student feedback."}
          </p>
        </div>

        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-base text-slate-900 dark:text-white">
            {language === "th" ? "ระบบตรวจจับความซื่อสัตย์" : "Exam Integrity Audit"}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {language === "th"
              ? "บันทึกสถิติการสลับแท็บ แอบออกจากแอป และเวลานอกจอของนักเรียนแบบวินาทีต่อวินาทีเพื่อความโปร่งใส"
              : "Second-by-second tracking of tab switches and off-screen time during online assessments."}
          </p>
        </div>

        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <Smartphone className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-base text-slate-900 dark:text-white">
            {language === "th" ? "เชื่อมโยงนักเรียนผ่าน LINE LIFF" : "Student LINE LIFF App"}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            {language === "th"
              ? "นักเรียนส่งงาน บันทึกเสียงพูดภาษาไทย และรับคะแนนแจ้งเตือนผ่าน LINE Official Account ทันที"
              : "Students complete tasks, record spoken answers, and receive push notifications on LINE."}
          </p>
        </div>
      </div>

      {/* Notice Banner */}
      <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xl">🔒</span>
          <div>
            <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
              {language === "th" ? "สถานะปัจจุบัน: ยังไม่ได้เข้าสู่ระบบ (Logged Out)" : "Current Status: Signed Out"}
            </p>
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              {language === "th"
                ? "กรุณาคลิกปุ่มเข้าสู่ระบบด้านบนด้วย Google หรือ LINE เพื่อเริ่มจัดการวิชาและตรวจข้อสอบ"
                : "Please sign in above using Google or LINE to access your courses and grading workspace."}
            </p>
          </div>
        </div>
        <Link
          href="/sign-in"
          className="shrink-0 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs transition-colors"
        >
          {language === "th" ? "เข้าสู่ระบบทันที" : "Sign In Now"}
        </Link>
      </div>
    </div>
  );
};
