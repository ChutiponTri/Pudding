import type { Metadata, Viewport } from "next";

// The LIFF header shows the page title: teachers see this, not the student app's.
export const metadata: Metadata = {
  title: { absolute: "Pudding สำหรับคุณครู · เชื่อมกลุ่ม LINE" },
  description: "เลือกกลุ่ม LINE และห้องเรียนที่จะเชื่อมกับ Pudding (สำหรับคุณครู)",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f59e0b",
};

export default function TeacherConnectLayout({ children }: { children: React.ReactNode }) {
  return children;
}
