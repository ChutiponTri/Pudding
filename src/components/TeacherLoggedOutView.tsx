"use client";

import React from "react";
import Link from "next/link";
import {
  ShieldCheck,
  FileCheck2,
  MessageCircle,
  CalendarCheck,
  BookOpen,
  Send,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/** LINE's logo mark: a speech bubble with "LINE" knocked out. */
const LineMark: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
    <path d="M12 2.5C6.2 2.5 1.5 6.3 1.5 11c0 4.2 3.7 7.7 8.8 8.4.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.5s5.9-3.5 8-6c1.5-1.6 2.2-3.3 2.2-5.3 0-4.7-4.7-8.5-10.2-8.5Zm-4.9 11h-2c-.3 0-.5-.2-.5-.5v-4c0-.3.2-.5.5-.5s.5.2.5.5V12.5h1.5c.3 0 .5.2.5.5s-.2.5-.5.5Zm2-.5c0 .3-.2.5-.5.5s-.5-.2-.5-.5v-4c0-.3.2-.5.5-.5s.5.2.5.5v4Zm4.8 0c0 .2-.1.4-.3.5h-.2c-.2 0-.3-.1-.4-.2l-2-2.8V13c0 .3-.2.5-.5.5s-.5-.2-.5-.5V9c0-.2.1-.4.3-.5h.2c.2 0 .3.1.4.2l2 2.8V9c0-.3.2-.5.5-.5s.5.2.5.5v4Zm3.3-2.5c.3 0 .5.2.5.5s-.2.5-.5.5h-1.5v1h1.5c.3 0 .5.2.5.5s-.2.5-.5.5h-2c-.3 0-.5-.2-.5-.5V9c0-.3.2-.5.5-.5h2c.3 0 .5.2.5.5s-.2.5-.5.5h-1.5v1h1.5Z" />
  </svg>
);

const SignInButton: React.FC<{ th: boolean; className?: string }> = ({ th, className = "" }) => (
  <Link
    href="/sign-in"
    className={`h-13 px-6 rounded-2xl bg-[#06C755] hover:bg-[#05b34c] text-white font-bold text-base shadow-lg shadow-emerald-600/25 transition-all hover:-translate-y-0.5 active:scale-[0.98] inline-flex items-center justify-center gap-2.5 ${className}`}
  >
    <LineMark className="w-5 h-5" />
    <span>{th ? "เข้าสู่ระบบด้วย LINE" : "Sign in with LINE"}</span>
  </Link>
);

export const TeacherLoggedOutView: React.FC = () => {
  const { language } = useLanguage();
  const th = language === "th";

  const steps = [
    {
      icon: <LineMark className="w-5 h-5" />,
      title: th ? "เข้าสู่ระบบด้วย LINE" : "Sign in with LINE",
      body: th ? "ไม่ต้องจำรหัสผ่าน บัญชี LINE ของคุณครูเชื่อมกับ Pudding Bot ให้อัตโนมัติ" : "No password. Your LINE account is linked to Pudding Bot automatically.",
    },
    {
      icon: <BookOpen className="w-5 h-5" />,
      title: th ? "สร้างรายวิชาและห้องเรียน" : "Create courses & classes",
      body: th ? "ตั้งค่าตัวชี้วัด สร้างงานและข้อสอบออนไลน์ได้ในไม่กี่นาที" : "Set indicators, then create assignments and online exams in minutes.",
    },
    {
      icon: <Send className="w-5 h-5" />,
      title: th ? "ส่งลิงก์ให้นักเรียนผ่าน LINE" : "Share the LINE link",
      body: th ? "เพิ่มบอทเข้ากลุ่ม LINE ของห้อง นักเรียนกดลิงก์เพื่อเข้าห้อง ส่งงาน และเช็คชื่อในแอป LINE" : "Add the bot to your class group. Students join, submit and check in inside LINE.",
    },
  ];

  const features = [
    {
      icon: <FileCheck2 className="w-5 h-5" />,
      tint: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
      title: th ? "ตรวจงานตามรูบริก" : "Rubric grading",
      body: th ? "ตรวจต่อเนื่องทีละข้อ ให้คะแนนและคำแนะนำรายบุคคล พร้อมครูร่วมตรวจ" : "Continuous per-question grading with feedback and co-graders.",
    },
    {
      icon: <ShieldCheck className="w-5 h-5" />,
      tint: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
      title: th ? "ตรวจจับความซื่อสัตย์" : "Integrity monitoring",
      body: th ? "บันทึกการสลับหน้าจอและเวลาที่ออกจากข้อสอบของนักเรียนแบบเรียลไทม์" : "Real-time tracking of tab switches and time away during exams.",
    },
    {
      icon: <CalendarCheck className="w-5 h-5" />,
      tint: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
      title: th ? "เช็คชื่อออนไลน์" : "Attendance",
      body: th ? "เปิดคาบเช็คชื่อ นักเรียนกดเช็คชื่อใน LINE ระบบแยกตรงเวลา/สายให้อัตโนมัติ" : "Open a session; students check in on LINE, on-time or late is automatic.",
    },
    {
      icon: <MessageCircle className="w-5 h-5" />,
      tint: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
      title: th ? "แจ้งเตือนเข้ากลุ่ม LINE" : "LINE group reminders",
      body: th ? "ประกาศ งานใหม่ และเตือนกำหนดส่ง ส่งเข้ากลุ่ม LINE ของห้องเรียนอัตโนมัติ" : "Announcements, new work and due-date reminders go to the class group.",
    },
  ];

  return (
    <div className="space-y-10 sm:space-y-16 pb-6 sm:pb-10">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-[2rem] bg-linear-to-br from-amber-300 via-amber-400 to-orange-400 px-5 py-8 sm:p-10 lg:p-14 text-slate-950 shadow-xl shadow-amber-500/20">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 w-80 h-80 rounded-full bg-white/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 w-72 h-72 rounded-full bg-orange-500/30 blur-3xl" />

        <div className="relative grid lg:grid-cols-[minmax(0,1fr)_22rem] gap-10 lg:gap-12 items-center">
          <div className="space-y-5 sm:space-y-6 text-center lg:text-left">
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/40 backdrop-blur-md text-xs font-bold">
              <span className="text-base select-none">🍮</span>
              {th ? "สำหรับคุณครูผู้สอน" : "For teachers"}
            </span>

            <h1 className="text-[2rem] leading-[1.15] sm:text-5xl lg:text-[3.4rem] font-black tracking-tight text-balance">
              {th ? (
                <>
                  จัดการห้องเรียน
                  <br className="hidden sm:block" /> ตรวจงาน และเช็คชื่อ
                  <span className="block text-slate-950/70">ในที่เดียว</span>
                </>
              ) : (
                <>
                  Classes, grading and attendance
                  <span className="block text-slate-950/70">in one place</span>
                </>
              )}
            </h1>

            <p className="text-sm sm:text-base font-medium leading-relaxed text-slate-950/80 max-w-xl mx-auto lg:mx-0">
              {th
                ? "พุดดิ้งช่วยคุณครูสร้างงานและข้อสอบออนไลน์ ตรวจตามรูบริก และติดตามความซื่อสัตย์ของนักเรียน โดยนักเรียนใช้งานผ่าน LINE ได้ทันทีโดยไม่ต้องติดตั้งแอป"
                : "Pudding helps teachers create online work and exams, grade with rubrics and monitor integrity, while students use it straight from LINE, with no app to install."}
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center lg:justify-start gap-3 pt-1">
              <SignInButton th={th} className="w-full sm:w-auto" />
              <Link
                href="/sign-up"
                className="h-13 px-6 rounded-2xl bg-white/80 hover:bg-white text-slate-950 font-bold text-sm transition-all active:scale-[0.98] inline-flex items-center justify-center gap-1.5 ring-1 ring-white/70"
              >
                {th ? "ครูใหม่? สมัครใช้งาน" : "New teacher? Sign up"}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            <p className="text-xs text-slate-950/65 flex items-center justify-center lg:justify-start gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              {th ? "ฟรีสำหรับคุณครู • เชื่อม LINE อัตโนมัติ ไม่ต้องพิมพ์รหัส" : "Free for teachers • LINE links automatically, no codes"}
            </p>
          </div>

          {/* Product preview card (desktop and tablet only, keeps the phone view short) */}
          <div aria-hidden className="hidden sm:block lg:block max-w-sm w-full mx-auto">
            <div className="rounded-3xl bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl p-5 shadow-2xl shadow-orange-900/20 ring-1 ring-white/60 space-y-4 rotate-1">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold text-slate-400">ท31101 • ม.4/1</p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{th ? "ภาษาไทยเพื่อการสื่อสาร" : "Thai for Communication"}</p>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold">LINE ✓</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { n: "32", l: th ? "นักเรียน" : "Students" },
                  { n: "28", l: th ? "ส่งแล้ว" : "Submitted" },
                  { n: "4", l: th ? "รอตรวจ" : "To grade" },
                ].map((stat) => (
                  <div key={stat.l} className="rounded-2xl bg-slate-50 dark:bg-slate-800 py-2.5">
                    <p className="text-lg font-black text-slate-900 dark:text-white tabular-nums">{stat.n}</p>
                    <p className="text-[10px] font-semibold text-slate-400">{stat.l}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                {[
                  { t: th ? "ใบงานที่ 3: การอ่านจับใจความ" : "Worksheet 3: Reading", s: th ? "ตรวจแล้ว 24/28" : "Graded 24/28", w: "86%" },
                  { t: th ? "สอบย่อย บทที่ 2" : "Quiz: Chapter 2", s: th ? "กำลังสอบ" : "In progress", w: "45%" },
                ].map((row) => (
                  <div key={row.t} className="rounded-2xl ring-1 ring-slate-100 dark:ring-slate-800 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">{row.t}</span>
                      <span className="text-slate-400 shrink-0">{row.s}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: row.w }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="scroll-mt-24 space-y-5 sm:space-y-7">
        <div className="text-center space-y-1.5">
          <p className="text-xs font-bold text-amber-600 dark:text-amber-400">{th ? "เริ่มต้นใช้งาน" : "Getting started"}</p>
          <h2 className="text-xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white">
            {th ? "พร้อมสอนใน 3 ขั้นตอน" : "Ready to teach in 3 steps"}
          </h2>
        </div>
        {/* Phones: swipe sideways instead of a long vertical stack */}
        <ol className="flex sm:grid gap-3 sm:gap-4 md:grid-cols-3 overflow-x-auto sm:overflow-visible snap-x snap-mandatory scroll-px-4 -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 sm:pb-0 scrollbar-none">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="relative w-[64%] shrink-0 snap-start sm:w-auto flex flex-col sm:flex-row md:flex-col gap-4 p-4 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 ring-1 ring-slate-200/80 dark:ring-slate-800"
            >
              <div className="flex items-center gap-3 shrink-0">
                <span className="w-11 h-11 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center">
                  {step.icon}
                </span>
                <span className="hidden md:inline text-xs font-black text-slate-300 dark:text-slate-600">0{index + 1}</span>
              </div>
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  <span className="md:hidden text-slate-400 mr-1">{index + 1}.</span>
                  {step.title}
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* FEATURES */}
      <section id="features" className="scroll-mt-24 space-y-5 sm:space-y-7">
        <div className="text-center space-y-1.5">
          <p className="text-xs font-bold text-amber-600 dark:text-amber-400">{th ? "ทุกอย่างที่คุณครูต้องใช้" : "Everything you need"}</p>
          <h2 className="text-xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-white">
            {th ? "ลดงานเอกสาร เพิ่มเวลาสอน" : "Less admin, more teaching"}
          </h2>
        </div>
        {/* Phones: swipe sideways instead of a long vertical stack */}
        <div className="flex sm:grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4 overflow-x-auto sm:overflow-visible snap-x snap-mandatory scroll-px-4 -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 sm:pb-0 scrollbar-none">
          {features.map((feature) => (
            <div key={feature.title} className="w-[64%] shrink-0 snap-start sm:w-auto p-4 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 ring-1 ring-slate-200/80 dark:ring-slate-800 flex flex-col gap-4">
              <span className={`w-11 h-11 rounded-2xl ${feature.tint} flex items-center justify-center shrink-0`}>{feature.icon}</span>
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">{feature.title}</h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed">{feature.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="rounded-[2rem] bg-slate-900 dark:bg-slate-900 ring-1 ring-slate-800 px-5 py-8 sm:p-10 text-center space-y-5">
        <div className="space-y-2">
          <h2 className="text-xl sm:text-3xl font-black tracking-tight text-white">
            {th ? "เริ่มใช้พุดดิ้งกับห้องเรียนของคุณ" : "Start using Pudding in your classroom"}
          </h2>
          <p className="text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
            {th
              ? "นักเรียนไม่ต้องสมัครที่หน้านี้ เมื่อคุณครูสร้างห้องเรียนแล้ว ระบบจะมีลิงก์ LINE ให้ส่งต่อให้นักเรียน"
              : "Students don't sign up here. Once you create a class, you'll get a LINE link to share with them."}
          </p>
        </div>
        <SignInButton th={th} className="w-full sm:w-auto" />
      </section>
    </div>
  );
};
