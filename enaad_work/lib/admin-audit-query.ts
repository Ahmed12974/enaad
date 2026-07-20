import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth-session'
import { db } from '@/lib/db'
import { auditLogs, user } from '@/lib/db/schema'

export type AuditFilters = {
  page?: number
  search?: string
  action?: string
  entityType?: string
  from?: string
  to?: string
  outcome?: 'success' | 'failure' | 'denied'
}

export async function getAdminAuditPage(filters: AuditFilters) {
  await requirePermission('reports:read')
  const page = Math.max(1, Math.trunc(filters.page || 1))
  const pageSize = 30
  const conditions: SQL[] = []
  const search = filters.search?.trim().slice(0, 120)
  if (search) {
    const pattern = `%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    conditions.push(
      or(
        ilike(auditLogs.action, pattern),
        ilike(auditLogs.entityId, pattern),
        ilike(auditLogs.reason, pattern),
      )!,
    )
  }
  if (filters.action) conditions.push(eq(auditLogs.action, filters.action.slice(0, 200)))
  if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType.slice(0, 120)))
  if (filters.outcome) conditions.push(eq(auditLogs.outcome, filters.outcome))
  if (filters.from) {
    const value = new Date(filters.from)
    if (!Number.isNaN(value.getTime())) conditions.push(gte(auditLogs.createdAt, value))
  }
  if (filters.to) {
    const value = new Date(filters.to)
    if (!Number.isNaN(value.getTime())) conditions.push(lte(auditLogs.createdAt, value))
  }
  const where = conditions.length ? and(...conditions) : undefined
  const [rows, totals] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        reason: auditLogs.reason,
        requestId: auditLogs.requestId,
        outcome: auditLogs.outcome,
        createdAt: auditLogs.createdAt,
        actorName: user.name,
        actorEmail: user.email,
      })
      .from(auditLogs)
      .leftJoin(user, eq(user.id, auditLogs.actorUserId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(auditLogs).where(where),
  ])
  const total = totals[0]?.total ?? 0
  return { rows, page, total, pages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function getAdminAuditDetail(id: string) {
  await requirePermission('reports:read')
  const [record] = await db
    .select({ audit: auditLogs, actorName: user.name, actorEmail: user.email })
    .from(auditLogs)
    .leftJoin(user, eq(user.id, auditLogs.actorUserId))
    .where(eq(auditLogs.id, id))
    .limit(1)
  return record ?? null
}
