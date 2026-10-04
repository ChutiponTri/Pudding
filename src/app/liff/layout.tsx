import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "พุดดิ้ง (Pudding) - LINE LIFF นักเรียน",
  description: "ระบบทำข้อสอบและส่งการบ้านออนไลน์ผ่าน LINE สำหรับนักเรียน",
};

export default function LiffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 -my-8 min-h-screen bg-slate-100 dark:bg-slate-950 flex justify-center">
      <div className="w-full max-w-md min-h-screen bg-white dark:bg-slate-900 shadow-2xl flex flex-col border-x border-slate-200 dark:border-slate-800">
        {children}
      </div>
    </div>
  );
}
