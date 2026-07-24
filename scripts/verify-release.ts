import { and, eq, sql } from 'drizzle-orm'
import { pool, db } from '@/lib/db'
import { mathQuestions, mathSections, platformSettings, user } from '@/lib/db/schema'
import { INITIAL_ADMIN_BOOTSTRAP_KEY } from '@/lib/admin-bootstrap'
import { resolveInitialAdminEmail } from '@/lib/admin-policy'
import { SITE_NAME } from '@/lib/brand'
import { validateRuntimeEnvironment } from '@/lib/runtime-config'

async function verifyRelease() {
  validateRuntimeEnvironment()
  const requiredTables = [
    'user',
    'session',
    'account',
    'rateLimit',
    'adminAllowlist',
    'auditLogs',
    'mathSections',
    'mathQuestions',
    'backupJobs',
  ]
  const tableResult = await db.execute<{ table_name: string }>(sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (${sql.join(requiredTables.map((name) => sql`${name}`), sql`, `)})
  `)
  const existingTables = new Set(tableResult.rows.map((row) => row.table_name))
  const missingTables = requiredTables.filter((name) => !existingTables.has(name))
  if (missingTables.length) throw new Error(`Missing required database tables: ${missingTables.join(', ')}`)

  const sectionCounts = await db
    .select({
      slug: mathSections.slug,
      count: sql<number>`count(${mathQuestions.id})::int`,
    })
    .from(mathSections)
    .leftJoin(
      mathQuestions,
      and(eq(mathQuestions.sectionId, mathSections.id), eq(mathQuestions.isActive, true)),
    )
    .where(sql`${mathSections.slug} in ('basics', 'fractions', 'algebra')`)
    .groupBy(mathSections.slug)

  const counts = new Map(sectionCounts.map((row) => [row.slug, row.count]))
  for (const slug of ['basics', 'fractions', 'algebra']) {
    const count = counts.get(slug) ?? 0
    if (count < 30) throw new Error(`Math question bank ${slug} has ${count} active questions; expected at least 30.`)
  }


  const [generalSettings] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, 'general'))
    .limit(1)
  if (generalSettings?.value?.siteName !== SITE_NAME) {
    throw new Error(`Platform branding is not synchronized. Expected siteName: ${SITE_NAME}`)
  }

  const emailFrom = process.env.EMAIL_FROM?.trim() ?? ''
  const missingBackupEnvironment = [
    !process.env.RESEND_API_KEY && 'RESEND_API_KEY',
    !process.env.BLOB_READ_WRITE_TOKEN && 'BLOB_READ_WRITE_TOKEN',
    !emailFrom && 'EMAIL_FROM',
    (!process.env.BACKUP_ENCRYPTION_SECRET || process.env.BACKUP_ENCRYPTION_SECRET.length < 32) &&
      'BACKUP_ENCRYPTION_SECRET (32+ characters)',
  ].filter(Boolean)

  // Backup email delivery is an optional runtime feature and must never block the
  // whole application deployment. The admin action validates the same values and
  // returns a clear Arabic error when the feature is used before configuration.
  if (missingBackupEnvironment.length) {
    console.warn(
      `Release verification warning: backup email delivery is not fully configured (${missingBackupEnvironment.join(', ')}).`,
    )
  } else {
    const emailFromAddress = emailFrom.match(/<([^<>]+)>$/)?.[1] ?? emailFrom
    const emailFromDomain = emailFromAddress.split('@')[1]?.toLowerCase()
    const unsupportedSenderDomains = new Set([
      'gmail.com',
      'googlemail.com',
      'outlook.com',
      'hotmail.com',
      'live.com',
      'yahoo.com',
      'icloud.com',
    ])
    if (!emailFromDomain || unsupportedSenderDomains.has(emailFromDomain)) {
      console.warn(
        'Release verification warning: EMAIL_FROM must use a verified custom Resend domain for general delivery. onboarding@resend.dev is limited to the Resend account email.',
      )
    }
  }

  const [bootstrapMarker] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, INITIAL_ADMIN_BOOTSTRAP_KEY))
    .limit(1)
  if (bootstrapMarker) {
    if (bootstrapMarker.value?.completed !== true || bootstrapMarker.value?.version !== 1) {
      throw new Error('The initial administrator bootstrap marker is malformed.')
    }
    console.info('Release verification: the one-time initial administrator bootstrap is already consumed.')
  } else {
    const initialAdminEmail = resolveInitialAdminEmail()
    if (initialAdminEmail) {
      const [adminAccount] = await db
        .select({ emailVerified: user.emailVerified, banned: user.banned })
        .from(user)
        .where(sql`lower(trim(${user.email})) = ${initialAdminEmail} and ${user.deletedAt} is null`)
        .limit(1)
      if (adminAccount?.emailVerified && !adminAccount.banned) {
        throw new Error('A verified bootstrap account exists but the one-time bootstrap marker was not created.')
      }
      console.info(
        'Release verification: INITIAL_ADMIN_EMAIL is waiting for an existing, verified and active account.',
      )
    } else {
      console.warn(
        'Release verification warning: INITIAL_ADMIN_EMAIL is not configured; existing database admin roles still work.',
      )
    }
  }

  console.info('Release verification passed: database, branding, role-based admin policy, backup configuration, and math question banks are ready.')
}

verifyRelease()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
