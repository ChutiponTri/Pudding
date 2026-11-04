import type { Metadata } from 'next';
import { Inter, Prompt } from 'next/font/google';
import './globals.css';
import { LanguageProvider } from '@/lib/i18n/LanguageContext';
import { ThemeProvider } from '@/lib/theme/ThemeContext';
import { SidebarProvider } from '@/components/SidebarContext';
import { AppShell } from '@/components/AppShell';
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

const SITE_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.pudding-p.com').replace(/\/+$/, '');
const SITE_NAME = 'Pudding';
const TITLE = 'Pudding - แพลตฟอร์มอัจฉริยะเพื่อการเรียนรู้และจัดการการบ้านผ่าน LINE';
const DESCRIPTION =
  'แพลตฟอร์มช่วยคุณครูสั่งและตรวจการบ้านผ่านเว็บ พร้อมให้เด็กๆ ทำงานผ่าน LINE LIFF ได้ทันที มีบอทคอยทวงงานในไลน์กลุ่ม และเทคโนโลยี AI ช่วยตรวจ | SIIT มธ.';
export const metadata: Metadata = {
  // Absolute URLs for og:image / canonical (Facebook and LINE need them).
  metadataBase: new URL(SITE_URL),

  // 1. Title: the big blue line on Google (keep under ~60 characters).
  //    Inner pages set their own title and get " | Pudding" appended.
  title: {
    default: TITLE,
    template: `%s | ${SITE_NAME}`,
  },

  // 2. Description: the snippet under the title (keep under ~160 characters).
  description: DESCRIPTION,

  // 3. Keywords: little weight on Google today, harmless to keep.
  keywords: [
    'Pudding',
    'ตรวจการบ้าน',
    'สั่งการบ้านผ่าน LINE',
    'ควิซออนไลน์',
    'ข้อสอบออนไลน์',
    'เช็คชื่อนักเรียน',
    'ระบบจัดการห้องเรียน',
    'LINE สำหรับครู',
    'SIIT',
  ],
  applicationName: SITE_NAME,

  // 4. Open Graph: the card shown when the link is shared on Facebook / LINE.
  openGraph: {
    title: TITLE,
    description: 'สั่งการบ้าน ทำควิซ เช็คชื่อ และตรวจงานนักเรียนได้ง่ายๆ ผ่าน LINE',
    url: '/',
    siteName: SITE_NAME,
    images: [
      {
        url: '/image.png',
        width: 1024,
        height: 541,
        alt: 'Pudding แพลตฟอร์มอัจฉริยะเพื่อการเรียนรู้ จัดการ Assignment & Quiz ง่ายๆ ผ่าน LINE',
      },
    ],
    locale: 'th_TH',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/image.png'],
  },

  // Icons come from the file conventions in this folder: favicon.ico
  // (16/32/48 px), icon.png (192 px) and apple-icon.png (180 px). Google
  // shows a favicon only when it is square and a multiple of 48 px.
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
              <SidebarProvider>
                <AppShell>{children}</AppShell>
              </SidebarProvider>
            </LanguageProvider>
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}

