import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getStudioData, isAdmin } from '@/app/actions'
import { AppShell } from './app-shell'
import { Studio } from './studio'
export async function ProtectedPage({ view }: { view: string }) {
  const s = await auth.api.getSession({ headers: await headers() })
  if (!s?.user) redirect('/sign-in')
  const [data, admin] = await Promise.all([getStudioData(view), isAdmin()])
  return (
    <AppShell name={s.user.name} isAdmin={admin}>
      <Studio view={view} data={data} />
    </AppShell>
  )
}
