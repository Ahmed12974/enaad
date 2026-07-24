import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getMathSections, isAdmin } from '@/app/actions'
import { AppShell } from '@/components/app-shell'
import { MathSections } from '@/components/math-hub'

export default async function MathPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  const sections = await getMathSections()
  return (
    <AppShell name={session.user.name} isAdmin={await isAdmin()}>
      <MathSections sections={sections} />
    </AppShell>
  )
}
