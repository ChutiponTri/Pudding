import type { Metadata } from 'next';
import { Inter, Prompt } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { ThemeProvider } from '@/lib/theme/ThemeContext';
import { Navbar } from '@/components/Navbar';
import { ClerkProvider } from '@clerk/nextjs';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const promptFont = Prompt({
  variable: '--font-prompt',
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  subsets: ['thai', 'latin'],
});

export const metadata: Metadata = {
  title: 'พุดดิ้ง (Pudding Platform) - แพลตฟอร์มการจัดการการเรียนรู้และตรวจการบ้านอัจฉริยะ',
  description:
    'พุดดิ้ง (Pudding) - ระบบบริหารจัดการห้องเรียน การบ้าน ข้อสอบออนไลน์ และระบบตรวจจับพฤติกรรมความซื่อสัตย์ สำหรับครูไทย',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" suppressHydrationWarning className={`${inter.variable} ${promptFont.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans selection:bg-amber-500 selection:text-white transition-colors duration-200">
        <ClerkProvider>
          <ThemeProvider>
            <LanguageProvider>
              <Navbar />
              <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {children}
              </main>
            </LanguageProvider>
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
