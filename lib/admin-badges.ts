import { and, count, desc, eq, ilike, isNotNull, isNull, or, type SQL } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth-session'
import { db } from '@/lib/db'
import { auditLogs, badges, educationalSections, media, user, userBadges } from '@/lib/db/schema'

export async function getAdminBadgeDetail(
  badgeId: string,
  filters: { page?: number; search?: string; status?: 'all' | 'active' | 'revoked' } = {},
) {
  await requirePermission('rewards:write')
  const page = Math.max(1, Math.trunc(filters.page ?? 1))
  const pageSize = 25
  const [badge] = await db.select().from(badges).where(eq(badges.id, badgeId)).limit(1)
  if (!badge) return null
  const conditions: SQL[] = [eq(userBadges.badgeId, badgeId)]
  if (filters.status === 'active') conditions.push(isNull(userBadges.revokedAt))
  if (filters.status === 'revoked') conditions.push(isNotNull(userBadges.revokedAt))
  const search = filters.search?.trim().slice(0, 120)
  if (search) {
    const pattern = `%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    conditions.push(or(ilike(user.name, pattern), ilike(user.email, pattern))!)
  }
  const where = and(...conditions)
  const [holders, totalRows, audits, options] = await Promise.all([
    db
      .select({
        id: userBadges.id,
        userId: userBadges.userId,
        userName: user.name,
        userEmail: user.email,
        repeatKey: userBadges.repeatKey,
        reason: userBadges.reason,
        sourceType: userBadges.sourceType,
        sourceId: userBadges.sourceId,
        grantedBy: userBadges.grantedBy,
        grantedAt: userBadges.grantedAt,
        revokedAt: userBadges.revokedAt,
        revokedBy: userBadges.revokedBy,
        revokeReason: userBadges.revokeReason,
      })
      .from(userBadges)
      .innerJoin(user, eq(user.id, userBadges.userId))
      .where(where)
      .orderBy(desc(userBadges.grantedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(userBadges)
      .innerJoin(user, eq(user.id, userBadges.userId))
      .where(where),
    db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'badge'), eq(auditLogs.entityId, badgeId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100),
    Promise.all([
      db.select({ id: educationalSections.id, name: educationalSections.name }).from(educationalSections),
      db.select({ id: media.id, name: media.originalName }).from(media).where(isNull(media.deletedAt)),
    ]),
  ])
  const total = totalRows[0]?.total ?? 0
  return {
    badge,
    holders: { rows: holders, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) },
    audits,
    options: { sections: options[0], media: options[1] },
  }
}
