import type { MetadataRoute } from 'next';
import { appUrl } from '@/lib/server/adminNotify';

const SITE_URL = appUrl() || 'https://www.pudding-p.com';

/** Only the public landing page is worth indexing; everything else needs a login. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/liff', '/admin', '/dashboard', '/classrooms', '/assignments', '/grading', '/students', '/creation', '/exports', '/pending-approval', '/teacher-invite'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
