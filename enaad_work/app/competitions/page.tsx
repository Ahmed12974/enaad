import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getCompetitions, isAdmin } from '@/app/actions'
import { AppShell } from '@/components/app-shell'
import { CompetitionsHub } from '@/components/competitions-hub'

export default async function CompetitionsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  const data = await getCompetitions()
  return (
    <AppShell name={session.user.name} isAdmin={await isAdmin()}>
      <CompetitionsHub data={data} />
    </AppShell>
  )
}
