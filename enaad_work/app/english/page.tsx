import { redirect } from 'next/navigation'
import { getLanguageWords } from '@/app/actions'
import { AppShell } from '@/components/app-shell'
import { LanguageHub } from '@/components/language-hub'
import { getCurrentUser, isAllowedAdministrator } from '@/lib/auth-session'

export default async function EnglishPage() {
  const current = await getCurrentUser()
  if (!current) redirect('/sign-in')
  const words = await getLanguageWords('en')
  return (
    <AppShell name={current.name} isAdmin={await isAllowedAdministrator(current)}>
      <LanguageHub language="en" words={words} />
    </AppShell>
  )
}
