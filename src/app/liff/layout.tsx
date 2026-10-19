import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "พุดดิ้ง (Pudding) - LINE LIFF นักเรียน",
  description: "ระบบทำข้อสอบและส่งการบ้านออนไลน์ผ่าน LINE สำหรับนักเรียน",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#06c755",
};

export default function LiffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // A phone-width column that widens on iPad/desktop. AppShell renders /liff
  // without the teacher <main> padding, so no negative margins are needed.
  return (
    <div className="min-h-dvh w-full bg-slate-100 dark:bg-black flex justify-center">
      <div className="w-full max-w-md md:max-w-2xl lg:max-w-3xl min-h-dvh bg-slate-50 dark:bg-slate-950 flex flex-col md:shadow-xl md:shadow-slate-900/5 md:border-x border-slate-200/70 dark:border-slate-800">
        {children}
      </div>
    </div>
  );
}
