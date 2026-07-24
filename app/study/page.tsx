import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getStudioData } from '@/app/actions'
import { AppShell } from '@/components/app-shell'
import { StudySession } from '@/components/study-session'
export default async function StudyPage({ searchParams }: { searchParams: Promise<{ language?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  const [{ language }, data] = await Promise.all([searchParams, getStudioData('words')])
  return (
    <AppShell name={session.user.name}>
      <StudySession words={data.words} initialLanguage={language === 'ar' ? 'ar' : 'en'} />
    </AppShell>
  )
}
