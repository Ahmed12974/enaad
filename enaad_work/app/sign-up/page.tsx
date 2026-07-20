import { redirect } from 'next/navigation'
import { AuthForm } from '@/components/auth-form'
import { getCurrentSession } from '@/lib/auth-session'
import { getPlatformSettingsSafe } from '@/lib/platform-settings'

export default async function SignUpPage() {
  if ((await getCurrentSession())?.user) redirect('/auth/continue')
  const settings = await getPlatformSettingsSafe()
  return <AuthForm signup registrationEnabled={settings.registrationEnabled} siteName={settings.siteName} />
}
