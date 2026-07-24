import Link from 'next/link'
import { asc, and, eq, isNull, lte, or } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getCurrentUser, isAllowedAdministrator } from '@/lib/auth-session'
import { db } from '@/lib/db'
import { educationalSections, sectionContents } from '@/lib/db/schema'
import { getSectionAccessState } from '@/lib/section-access'

export default async function LearnPage() {
  const current = await getCurrentUser()
  if (!current) redirect('/sign-in')
  const administrator = await isAllowedAdministrator(current)
  const sections = await db
    .select({
      id: educationalSections.id,
      name: educationalSections.name,
      slug: educationalSections.slug,
      shortDescription: educationalSections.shortDescription,
      color: educationalSections.color,
      access: educationalSections.access,
      isPaid: educationalSections.isPaid,
      previousSectionId: educationalSections.previousSectionId,
      unlockRules: educationalSections.unlockRules,
      contentCount: db.$count(
        sectionContents,
        and(
          eq(sectionContents.sectionId, educationalSections.id),
          or(
            eq(sectionContents.status, 'published'),
            and(eq(sectionContents.status, 'scheduled'), lte(sectionContents.publishedAt, new Date())),
          ),
          isNull(sectionContents.deletedAt),
        ),
      ),
    })
    .from(educationalSections)
    .where(
      and(
        eq(educationalSections.status, 'published'),
        eq(educationalSections.isActive, true),
        isNull(educationalSections.deletedAt),
      ),
    )
    .orderBy(asc(educationalSections.sortOrder))
  const sectionsWithAccess = await Promise.all(
    sections.map(async (section) => ({
      ...section,
      accessState: await getSectionAccessState(current.id, section, { administrator }),
    })),
  )
  return (
    <AppShell name={current.name} isAdmin={administrator}>
      <main>
        <div className="page-title">
          <div>
            <p>مسارات ديناميكية</p>
            <h1>الأقسام التعليمية</h1>
            <span>كل قسم ومحتواه يأتي مباشرة من قاعدة البيانات.</span>
          </div>
        </div>
        <section className="admin-card-grid">
          {sectionsWithAccess.map((section) => (
            <Link
              href={section.accessState.allowed ? `/learn/${section.slug}` : '#'}
              key={section.id}
              className="learn-section-link"
              aria-disabled={!section.accessState.allowed}
            >
              <Card style={{ borderTopColor: section.color ?? undefined }}>
                <CardHeader>
                  <CardTitle>{section.name}</CardTitle>
                  <CardDescription>{section.shortDescription || 'مسار تعليمي'}</CardDescription>
                </CardHeader>
                <CardContent className="admin-row">
                  <Badge>{section.isPaid ? 'مدفوع' : section.accessState.allowed ? 'متاح' : 'مغلق'}</Badge>
                  <span>{section.accessState.reason ?? `${section.contentCount} عنصر منشور`}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
          {!sectionsWithAccess.length && (
            <Card>
              <CardContent className="admin-empty">لا توجد أقسام منشورة حاليًا.</CardContent>
            </Card>
          )}
        </section>
      </main>
    </AppShell>
  )
}
