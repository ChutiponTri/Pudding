"use client";

import React from "react";
import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function SignUpPage() {
  return (
    <div className="min-h-[85vh] flex flex-col items-center justify-center py-10 px-4">
      <div className="w-full max-w-md mb-6 text-center space-y-2">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400 mb-2 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>กลับสู่หน้าหลัก</span>
        </Link>
        <div className="flex items-center justify-center gap-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-600 via-amber-500 to-yellow-400 flex items-center justify-center shadow-lg shadow-amber-500/25">
            <span className="text-2xl select-none">🍮</span>
          </div>
          <span className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            พุดดิ้ง (Pudding)
          </span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          ลงทะเบียนบัญชีครูผู้สอนใหม่ (รองรับ Google & LINE)
        </p>
      </div>

      <div className="w-full max-w-md flex justify-center">
        <SignUp
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "shadow-2xl border border-slate-200/80 dark:border-slate-800 rounded-3xl bg-white dark:bg-slate-900",
              headerTitle: "text-slate-900 dark:text-white font-black text-xl",
              headerSubtitle: "text-slate-500 dark:text-slate-400 text-xs",
              formButtonPrimary:
                "bg-gradient-to-r from-amber-600 via-orange-500 to-yellow-500 hover:from-amber-700 hover:to-orange-600 text-slate-950 font-bold rounded-xl shadow-md shadow-amber-500/20",
              socialButtonsBlockButton:
                "border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold text-xs",
              footerActionLink: "text-amber-600 dark:text-amber-400 font-bold hover:underline",
            },
          }}
          routing="path"
          path="/sign-up"
          signInUrl="/sign-in"
          fallbackRedirectUrl="/dashboard"
        />
      </div>
    </div>
  );
}
