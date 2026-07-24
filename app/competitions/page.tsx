،import { redirect } from 'next/navigation'

import { AppShell } from '@/components/app-shell'
import { CompetitionsHub } from '@/components/competitions/competitions-hub'
import { getCompetitionsHubData, isAdmin } from '@/app/actions'
import { requireUser } from '@/lib/auth-session'

export default async function CompetitionsPage() {
  const session = await requireUser()

  if (!session?.user) {
    redirect('/sign-in')
  }

  const data = await getCompetitionsHubData()
  

  const visibleItems = data.items.filter(
    (item) =>
      item.lifecycle === 'active' ||
      item.lifecycle === 'scheduled',
  ) as Array<
    (typeof data.items)[number] & {
      lifecycle: 'active' | 'scheduled'
    }
  >

  const visibleData = {
    ...data,
    items: visibleItems,
  }

  return (
    <AppShell
      name={session.user.name}
      isAdmin={await isAdmin()}
    >
      <CompetitionsHub data={visibleData} />
    </AppShell>
  )
}