import { and, eq, isNull } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { adminAllowlist, auditLogs, user } from '@/lib/db/schema'
import { SOLE_ADMIN_EMAIL } from '@/lib/admin-policy'
import { normalizeEmail } from '@/lib/security'

async function promote() {
  const rawEmail =
    process.argv.slice(2).find((value) => !value.startsWith('--')) ?? process.env.INITIAL_ADMIN_EMAIL
  if (!rawEmail) throw new Error('Provide the account email as the first argument or INITIAL_ADMIN_EMAIL.')
  const email = normalizeEmail(rawEmail)
  if (email !== SOLE_ADMIN_EMAIL)
    throw new Error(`Only ${SOLE_ADMIN_EMAIL} can be promoted as the platform administrator.`)

  await db.transaction(async (tx) => {
    const [record] = await tx
      .select({ id: user.id, role: user.role, emailVerified: user.emailVerified })
      .from(user)
      .where(and(eq(user.email, email), isNull(user.deletedAt)))
      .limit(1)
    if (!record) throw new Error('No active account matches that normalized email.')
    if (!record.emailVerified)
      throw new Error('Refusing to grant administrator access to an unverified account.')

    await tx
      .insert(adminAllowlist)
      .values({ email: SOLE_ADMIN_EMAIL, role: 'SUPER_ADMIN', isActive: true, createdBy: record.id })
      .onConflictDoUpdate({
        target: adminAllowlist.email,
        set: { role: 'SUPER_ADMIN', isActive: true, updatedAt: new Date() },
      })
    if (record.role === 'admin') return

    await tx
      .update(user)
      .set({
        role: 'admin',
        emailVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(user.id, record.id))
    await tx.insert(auditLogs).values({
      actorUserId: record.id,
      action: 'bootstrap_admin',
      entityType: 'user',
      entityId: record.id,
      before: { role: record.role, emailVerified: record.emailVerified },
      after: { role: 'admin', emailVerified: true, allowlistedEmail: SOLE_ADMIN_EMAIL },
      reason: 'Verified sole administrator promotion command.',
    })
  })

  console.info('Administrator role granted to the verified account.')
}

promote()
  .catch((error) => {
    console.error(
      'Administrator promotion failed:',
      error instanceof Error ? error.message : 'unknown database error',
    )
    process.exitCode = 1
  })
  .finally(() => pool.end())
