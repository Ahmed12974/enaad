import type { MetadataRoute } from 'next'
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://lughati.app'
  return ['/sign-in', '/sign-up'].map((url) => ({
    url: `${base}${url}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: url === '/sign-up' ? 0.8 : 0.7,
  }))
}
