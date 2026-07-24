import type { MetadataRoute } from 'next'
import { getPublicAppUrl } from '@/lib/runtime-config'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getPublicAppUrl()
  return ['/sign-in', '/sign-up'].map((url) => ({
    url: `${base}${url}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: url === '/sign-up' ? 0.8 : 0.7,
  }))
}
