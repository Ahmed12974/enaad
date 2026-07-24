import { and, eq, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db'
import { adminAllowlist, auditLogs, platformSettings, user } from '@/lib/db/schema'
import { normalizeEmail } from '@/lib/normalization'
import { resolveInitialAdminEmail } from '@/lib/admin-policy'

export const INITIAL_ADMIN_BOOTSTRAP_KEY = 'security.initial-admin-bootstrap.v1'

export type BootstrapAdminRecord = {
  id: string
  email: string
  emailVerified: boolean
  role: unknown
  banned?: boolean
}

export type BootstrapAdminResult = {
  status: 'completed' | 'already-completed'
  changed: boolean
  role: 'admin' | null
}

/**
 * Consumes INITIAL_ADMIN_EMAIL exactly once for the whole database.
 *
 * This function is intentionally called only by the explicit seed/bootstrap
 * command. Session reads and page rendering must never call it. The durable
 * marker prevents a later seed or environment-variable change from silently
 * restoring a role that an administrator intentionally removed.
 */
export async function ensureInitialAdminTx(
  tx: DbTransaction,
  record: BootstrapAdminRecord,
  env: Record<string, string | undefined> = process.env,
  source: 'seed' | 'command' = 'seed',
): Promise<BootstrapAdminResult | null> {
  const configuredEmail = resolveInitialAdminEmail(env)
  if (
    !configuredEmail ||
    normalizeEmail(record.email) !== configuredEmail ||
    record.banned ||
    !record.emailVerified
  ) {
    return null
  }

  const [existingMarker] = await tx
    .select({ key: platformSettings.key })
    .from(platformSettings)
    .where(eq(platformSettings.key, INITIAL_ADMIN_BOOTSTRAP_KEY))
    .limit(1)
  if (existingMarker) {
    return {
      status: 'already-completed',
      changed: false,
      role: record.role === 'admin' ? 'admin' : null,
    }
  }

  const completedAt = new Date()
  const [claimedMarker] = await tx
    .insert(platformSettings)
    .values({
      key: INITIAL_ADMIN_BOOTSTRAP_KEY,
      value: {
        version: 1,
        completed: true,
        bootstrappedUserId: record.id,
        source,
        completedAt: completedAt.toISOString(),
      },
      updatedBy: record.id,
      createdAt: completedAt,
      updatedAt: completedAt,
    })
    .onConflictDoNothing({ target: platformSettings.key })
    .returning({ key: platformSettings.key })

  // A concurrent bootstrap transaction won the marker race. It is now the
  // only transaction allowed to modify the role.
  if (!claimedMarker) {
    return {
      status: 'already-completed',
      changed: false,
      role: record.role === 'admin' ? 'admin' : null,
    }
  }

  await tx
    .insert(adminAllowlist)
    .values({
      email: configuredEmail,
      role: 'SUPER_ADMIN',
      isActive: true,
      createdBy: record.id,
    })
    .onConflictDoUpdate({
      target: adminAllowlist.email,
      set: { role: 'SUPER_ADMIN', isActive: true, updatedAt: completedAt },
    })

  const changed = record.role !== 'admin'
  if (changed) {
    const [promoted] = await tx
      .update(user)
      .set({ role: 'admin', updatedAt: completedAt })
      .where(
        and(
          eq(user.id, record.id),
          eq(user.emailVerified, true),
          eq(user.banned, false),
          sql`lower(trim(${user.email})) = ${configuredEmail}`,
          sql`${user.deletedAt} is null`,
        ),
      )
      .returning({ id: user.id })
    if (!promoted) {
      throw new Error('Initial administrator bootstrap account changed before promotion completed.')
    }
  }

  await tx.insert(auditLogs).values({
    actorUserId: record.id,
    action: 'bootstrap_admin',
    entityType: 'user',
    entityId: record.id,
    before: {
      role: record.role,
      emailVerified: record.emailVerified,
      bootstrapCompleted: false,
    },
    after: {
      role: 'admin',
      emailVerified: true,
      bootstrapCompleted: true,
      bootstrapVersion: 1,
    },
    reason: `One-time initial administrator bootstrap completed by ${source}.`,
  })

  return { status: 'completed', changed, role: 'admin' }
}
