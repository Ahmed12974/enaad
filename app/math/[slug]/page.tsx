import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getMathSections, isAdmin } from '@/app/actions'
import { AppShell } from '@/components/app-shell'
import { MathQuiz } from '@/components/math-hub'

export default async function MathQuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  const { slug } = await params,
    sections = await getMathSections(),
    section = sections.find((item) => item.slug === slug)
  if (!section) notFound()
  return (
    <AppShell name={session.user.name} isAdmin={await isAdmin()}>
      <MathQuiz slug={slug} name={section.name} />
    </AppShell>
  )
}
