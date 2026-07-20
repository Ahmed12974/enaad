import Link from 'next/link'
import { Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getPlatformSettingsSafe } from '@/lib/platform-settings'

export const dynamic = 'force-dynamic'

export default async function MaintenancePage() {
  const settings = await getPlatformSettingsSafe()
  return (
    <main className="auth-page" dir={settings.defaultLanguage === 'ar' ? 'rtl' : 'ltr'}>
      <Card className="auth-card">
        <CardHeader>
          <Wrench aria-hidden="true" />
          <CardTitle>{settings.siteName} قيد الصيانة</CardTitle>
          <CardDescription>نُجري تحسينات ضرورية وسنعود قريبًا. بيانات حسابك محفوظة.</CardDescription>
        </CardHeader>
        <CardContent className="form-stack">
          <p>يمكن للمستخدمين الحاليين العودة بعد انتهاء الصيانة، بينما يظل دخول الإدارة متاحًا.</p>
          <Button render={<Link href="/sign-in" />}>دخول الإدارة</Button>
        </CardContent>
      </Card>
    </main>
  )
}
