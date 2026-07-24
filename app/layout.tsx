import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { getPublicAppUrl } from '@/lib/runtime-config'
import { getPlatformSettingsSafe } from '@/lib/platform-settings'
import './globals.css'

function metadataBase() {
  return new URL(getPublicAppUrl())
}

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getPlatformSettingsSafe()
  return {
    metadataBase: metadataBase(),
    title: {
      default: `${settings.siteName} | منصة تعلم العربية والإنجليزية`,
      template: `%s | ${settings.siteName}`,
    },
    description: settings.siteDescription,
    applicationName: settings.siteName,
    manifest: '/manifest.webmanifest',
    icons: { icon: '/icon.svg', apple: '/apple-icon.png' },
    openGraph: {
      type: 'website',
      locale: settings.defaultLanguage === 'ar' ? 'ar_EG' : 'en_US',
      siteName: settings.siteName,
      title: `${settings.siteName} | تعلم بذكاء`,
      description: settings.siteDescription,
    },
    robots: { index: true, follow: true },
  }
}
export const viewport: Viewport = {
  themeColor: '#123c32',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
  userScalable: true,
}
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getPlatformSettingsSafe()
  const isArabic = settings.defaultLanguage === 'ar'
  return (
    <html lang={settings.defaultLanguage} dir={isArabic ? 'rtl' : 'ltr'} className="bg-background">
      <body className="font-sans antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
