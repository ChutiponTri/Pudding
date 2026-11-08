import type { Metadata, Viewport } from "next";

// The LIFF header shows the page title: teachers see this, not the student app's.
export const metadata: Metadata = {
  title: { absolute: "Pudding สำหรับคุณครู" },
  description: "เมนูครูประจำกลุ่ม LINE: เช็กชื่อ สร้างงาน ตรวจงาน ประกาศผล (สำหรับคุณครู)",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#7c3aed",
};

export default function TeacherLiffLayout({ children }: { children: React.ReactNode }) {
  return children;
}
