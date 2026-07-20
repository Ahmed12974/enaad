import type { MetadataRoute } from 'next'
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'لُغتي — منصة تعلم اللغات',
    short_name: 'لُغتي',
    description: 'منصة متكاملة لتعلم الكلمات والعبارات العربية والإنجليزية',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f2e9',
    theme_color: '#123c32',
    lang: 'ar',
    dir: 'rtl',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  }
}
