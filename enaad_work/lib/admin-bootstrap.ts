import { and, eq, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db'
import { adminAllowlist, auditLogs, user } from '@/lib/db/schema'
import { normalizeEmail } from '@/lib/normalization'
import { SOLE_ADMIN_EMAIL } from '@/lib/admin-policy'

export type BootstrapAdminRecord = {
  id: string
  email: string
  emailVerified: boolean
  role: unknown
  banned?: boolean
}

export type BootstrapAdminResult = {
  changed: boolean
  emailVerified: true
  role: 'admin'
}

export function isSoleAdminEmail(email: string) {
  return normalizeEmail(email) === SOLE_ADMIN_EMAIL
}

/**
 * Promotes the authenticated sole-owner account in a server-side transaction.
 * This is intentionally limited to the one exact platform-owner email and is
 * never driven by a role value coming from the browser.
 */
export async function ensureSoleAdminTx(
  tx: DbTransaction,
  record: BootstrapAdminRecord,
): Promise<BootstrapAdminResult | null> {
  if (!isSoleAdminEmail(record.email) || record.banned) return null

  const [allowlistEntry] = await tx
    .select({ isActive: adminAllowlist.isActive })
    .from(adminAllowlist)
    .where(sql`lower(trim(${adminAllowlist.email})) = ${SOLE_ADMIN_EMAIL}`)
    .limit(1)

  const needsUserUpdate = record.role !== 'admin' || !record.emailVerified
  const needsAllowlistUpdate = !allowlistEntry?.isActive
  if (!needsUserUpdate && !needsAllowlistUpdate) {
    return { changed: false, role: 'admin', emailVerified: true }
  }

  await tx
    .insert(adminAllowlist)
    .values({
      email: SOLE_ADMIN_EMAIL,
      role: 'SUPER_ADMIN',
      isActive: true,
      createdBy: record.id,
    })
    .onConflictDoUpdate({
      target: adminAllowlist.email,
      set: {
        role: 'SUPER_ADMIN',
        isActive: true,
        updatedAt: new Date(),
      },
    })

  if (needsUserUpdate) {
    await tx
      .update(user)
      .set({ role: 'admin', emailVerified: true, updatedAt: new Date() })
      .where(
        and(
          eq(user.id, record.id),
          sql`lower(trim(${user.email})) = ${SOLE_ADMIN_EMAIL}`,
          sql`${user.deletedAt} is null`,
        ),
      )
  }

  await tx.insert(auditLogs).values({
    actorUserId: record.id,
    action: 'bootstrap_admin_runtime',
    entityType: 'user',
    entityId: record.id,
    before: {
      role: record.role,
      emailVerified: record.emailVerified,
      allowlistActive: Boolean(allowlistEntry?.isActive),
    },
    after: {
      role: 'admin',
      emailVerified: true,
      allowlistActive: true,
      allowlistedEmail: SOLE_ADMIN_EMAIL,
    },
    reason: 'Authenticated sole-owner account was synchronized with the secure admin policy.',
  })

  return { changed: true, role: 'admin', emailVerified: true }
}
