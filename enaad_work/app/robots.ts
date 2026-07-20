import type { MetadataRoute } from 'next'
import { getPublicAppUrl } from '@/lib/runtime-config'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/sign-in', '/sign-up', '/forgot-password', '/certificates/verify/'],
      disallow: [
        '/admin',
        '/api/',
        '/account',
        '/add',
        '/words',
        '/sentences',
        '/arabic',
        '/english',
        '/study',
        '/quiz',
        '/results',
        '/achievements',
        '/challenges',
        '/competitions',
        '/math',
        '/mistakes',
        '/certificates/',
        '/reset-password',
      ],
    },
    sitemap: `${getPublicAppUrl()}/sitemap.xml`,
  }
}
