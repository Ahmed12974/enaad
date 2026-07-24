import { and, isNull, sql } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { ensureInitialAdminTx } from '@/lib/admin-bootstrap'
import { user } from '@/lib/db/schema'
import { resolveInitialAdminEmail } from '@/lib/admin-policy'

async function bootstrap() {
  const configuredEmail = resolveInitialAdminEmail()
  if (!configuredEmail) {
    throw new Error('INITIAL_ADMIN_EMAIL must be configured before running the one-time bootstrap command.')
  }
  if (!process.argv.includes('--confirm')) {
    throw new Error('Refusing to bootstrap without the explicit --confirm flag.')
  }

  const result = await db.transaction(async (tx) => {
    const [record] = await tx
      .select({
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        banned: user.banned,
      })
      .from(user)
      .where(
        and(
          sql`lower(trim(${user.email})) = ${configuredEmail}`,
          isNull(user.deletedAt),
        ),
      )
      .limit(1)
    if (!record) throw new Error('No active account matches INITIAL_ADMIN_EMAIL.')
    if (!record.emailVerified) {
      throw new Error('Refusing to bootstrap an administrator before email verification.')
    }
    if (record.banned) throw new Error('Refusing to bootstrap a banned account.')
    return ensureInitialAdminTx(tx, record, process.env, 'command')
  })

  if (!result) throw new Error('The configured account did not satisfy the bootstrap policy.')
  if (result.status === 'already-completed') {
    console.info('Initial administrator bootstrap was already consumed; no role was changed.')
    return
  }
  console.info(
    result.changed
      ? 'Initial administrator bootstrap completed.'
      : 'Initial administrator bootstrap recorded for the existing administrator.',
  )
}

bootstrap()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Administrator bootstrap failed.')
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
