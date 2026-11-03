import type { MetadataRoute } from 'next';
import { appUrl } from '@/lib/server/adminNotify';

const SITE_URL = appUrl() || 'https://www.pudding-p.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/sign-in`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/sign-up`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
