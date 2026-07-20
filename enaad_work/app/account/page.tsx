import { redirect } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { RecoveryEmailForm } from '@/components/recovery-forms'
import { getCurrentUser } from '@/lib/auth-session'
import { getRecoveryEmailStatus } from './actions'

export default async function AccountPage() {
  const current = await getCurrentUser()
  if (!current) redirect('/sign-in')
  const status = await getRecoveryEmailStatus()
  return (
    <AppShell name={current.name}>
      <RecoveryEmailForm
        primaryEmail={current.email}
        primaryVerified={current.emailVerified}
        verificationEnabled={Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)}
        initialEmail={status?.recoveryEmail || null}
        verified={status?.recoveryEmailVerified || false}
      />
    </AppShell>
  )
}
