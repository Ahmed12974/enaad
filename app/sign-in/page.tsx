import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/auth-form'
import { getCurrentSession } from '@/lib/auth-session'
import { getPlatformSettingsSafe } from '@/lib/platform-settings'

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if ((await getCurrentSession())?.user) redirect('/auth/continue')
  const [{ next }, settings] = await Promise.all([searchParams, getPlatformSettingsSafe()])
  return (
    <AuthForm
      nextPath={next}
      registrationEnabled={settings.registrationEnabled}
      siteName={settings.siteName}
    />
  )
}
