import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getData, isAdmin } from '@/app/actions'
import { AppShell } from '@/components/app-shell'
import { GrowthCenter } from '@/components/growth-center'

export default async function AchievementsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  const [data, admin] = await Promise.all([getData(), isAdmin()])
  return (
    <AppShell name={session.user.name} isAdmin={admin}>
      <GrowthCenter data={data} view="achievements" />
    </AppShell>
  )
}
