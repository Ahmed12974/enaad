import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth-session'
import { db } from '@/lib/db'
import { contentPrerequisites, educationalSections, media, sectionContents } from '@/lib/db/schema'

export async function getAdminContentEditorData(contentId?: string) {
  await requirePermission('content:read')
  const [sections, contents, current, prerequisites, mediaRows] = await Promise.all([
    db
      .select()
      .from(educationalSections)
      .where(isNull(educationalSections.deletedAt))
      .orderBy(asc(educationalSections.sortOrder))
      .limit(500),
    db
      .select({ id: sectionContents.id, title: sectionContents.title, sectionId: sectionContents.sectionId })
      .from(sectionContents)
      .where(isNull(sectionContents.deletedAt))
      .orderBy(asc(sectionContents.title))
      .limit(2_000),
    contentId
      ? db
          .select()
          .from(sectionContents)
          .where(and(eq(sectionContents.id, contentId), isNull(sectionContents.deletedAt)))
          .limit(1)
      : Promise.resolve([]),
    contentId
      ? db
          .select({ prerequisiteId: contentPrerequisites.prerequisiteId })
          .from(contentPrerequisites)
          .where(eq(contentPrerequisites.contentId, contentId))
      : Promise.resolve([]),
    db
      .select({ id: media.id, name: media.originalName, mediaType: media.mediaType })
      .from(media)
      .where(isNull(media.deletedAt))
      .orderBy(asc(media.originalName))
      .limit(1_000),
  ])
  return {
    sections,
    contents,
    current: current[0] ?? null,
    prerequisiteIds: prerequisites.map((item) => item.prerequisiteId),
    media: mediaRows,
  }
}

export async function getAdminSectionDetail(sectionId: string) {
  await requirePermission('content:read')
  const [section] = await db
    .select()
    .from(educationalSections)
    .where(eq(educationalSections.id, sectionId))
    .limit(1)
  if (!section) return null
  const [contents, statisticRows] = await Promise.all([
    db
      .select()
      .from(sectionContents)
      .where(eq(sectionContents.sectionId, sectionId))
      .orderBy(asc(sectionContents.sortOrder))
      .limit(2_000),
    db.execute<{
      learners: number
      completed: number
      inProgress: number
      averageProgress: number
      averageScore: number
      recentActivity: number
    }>(sql`
      select
        count(distinct p."userId")::int as learners,
        count(*) filter (where p.status = 'completed')::int as completed,
        count(*) filter (where p.status = 'in_progress')::int as "inProgress",
        coalesce(round(avg(p.progress)), 0)::int as "averageProgress",
        coalesce(round(avg(p.score)), 0)::int as "averageScore",
        count(*) filter (where p."lastActivityAt" >= now() - interval '30 days')::int as "recentActivity"
      from "sectionContents" c left join "userContentProgress" p on p."contentId" = c.id
      where c."sectionId" = ${sectionId}::uuid and c."deletedAt" is null
    `),
  ])
  return {
    section,
    contents,
    statistics: statisticRows.rows[0] ?? {
      learners: 0,
      completed: 0,
      inProgress: 0,
      averageProgress: 0,
      averageScore: 0,
      recentActivity: 0,
    },
  }
}
