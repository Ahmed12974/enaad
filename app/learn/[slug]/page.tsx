import { and, asc, eq, isNull, lte, or } from 'drizzle-orm'
import { notFound, redirect } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getCurrentUser, isAllowedAdministrator } from '@/lib/auth-session'
import { db } from '@/lib/db'
import { educationalSections, sectionContents } from '@/lib/db/schema'
import { getSectionAccessState } from '@/lib/section-access'

export default async function LearningSectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const current = await getCurrentUser()
  if (!current) redirect('/sign-in')
  const { slug } = await params
  const [section] = await db
    .select()
    .from(educationalSections)
    .where(
      and(
        eq(educationalSections.slug, slug),
        eq(educationalSections.status, 'published'),
        eq(educationalSections.isActive, true),
        isNull(educationalSections.deletedAt),
      ),
    )
    .limit(1)
  if (!section) notFound()
  const administrator = await isAllowedAdministrator(current)
  const accessState = await getSectionAccessState(current.id, section, { administrator })
  if (!accessState.allowed) redirect(`/learn?locked=${encodeURIComponent(accessState.reason)}`)
  const contents = await db
    .select()
    .from(sectionContents)
    .where(
      and(
        eq(sectionContents.sectionId, section.id),
        or(
          eq(sectionContents.status, 'published'),
          and(eq(sectionContents.status, 'scheduled'), lte(sectionContents.publishedAt, new Date())),
        ),
        isNull(sectionContents.deletedAt),
      ),
    )
    .orderBy(asc(sectionContents.sortOrder))
    .limit(500)
  return (
    <AppShell name={current.name} isAdmin={administrator}>
      <main>
        <div className="page-title">
          <div>
            <p>قسم تعليمي</p>
            <h1>{section.name}</h1>
            <span>{section.fullDescription || section.shortDescription || 'محتوى تعليمي منظم'}</span>
          </div>
          <Badge>{section.isPaid ? 'مدفوع' : section.access === 'free' ? 'مجاني' : 'مقيد'}</Badge>
        </div>
        <section className="admin-card-grid">
          {contents.map((content) => (
            <Card key={content.id}>
              <CardHeader>
                <div className="admin-row">
                  <Badge variant="secondary">{content.kind}</Badge>
                  <span>{content.points} نقطة</span>
                </div>
                <CardTitle>{content.title}</CardTitle>
                <CardDescription>{content.summary || 'عنصر تعليمي'}</CardDescription>
              </CardHeader>
              <CardContent>
                {content.passingScore !== null && <p>شرط النجاح: {content.passingScore}%</p>}
              </CardContent>
            </Card>
          ))}
          {!contents.length && (
            <Card>
              <CardContent className="admin-empty">لا يوجد محتوى منشور في هذا القسم بعد.</CardContent>
            </Card>
          )}
        </section>
      </main>
    </AppShell>
  )
}
