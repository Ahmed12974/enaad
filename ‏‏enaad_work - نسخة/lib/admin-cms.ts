import { desc, eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth-session'
import { db } from '@/lib/db'
import { siteContent, siteContentVersions } from '@/lib/db/schema'

export async function getAdminSiteContent(contentId: string) {
  await requirePermission('content:read')
  const [item] = await db.select().from(siteContent).where(eq(siteContent.id, contentId)).limit(1)
  if (!item) return null
  const versions = await db
    .select()
    .from(siteContentVersions)
    .where(eq(siteContentVersions.siteContentId, contentId))
    .orderBy(desc(siteContentVersions.version))
    .limit(100)
  return { item, versions }
}
