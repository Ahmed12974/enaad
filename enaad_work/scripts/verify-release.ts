import { and, eq, sql } from 'drizzle-orm'
import { pool, db } from '@/lib/db'
import { adminAllowlist, mathQuestions, mathSections, platformSettings, user } from '@/lib/db/schema'
import { SOLE_ADMIN_EMAIL } from '@/lib/admin-policy'
import { SITE_NAME } from '@/lib/brand'

async function verifyRelease() {
  const requiredTables = [
    'user',
    'session',
    'account',
    'rateLimit',
    'adminAllowlist',
    'auditLogs',
    'mathSections',
    'mathQuestions',
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

  const [allowlist] = await db
    .select({ isActive: adminAllowlist.isActive, role: adminAllowlist.role })
    .from(adminAllowlist)
    .where(and(eq(adminAllowlist.email, SOLE_ADMIN_EMAIL), eq(adminAllowlist.isActive, true)))
    .limit(1)
  if (!allowlist || allowlist.role !== 'SUPER_ADMIN') {
    throw new Error('The sole administrator allowlist entry is missing or inactive.')
  }

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
  ].filter(Boolean)
  if (missingBackupEnvironment.length) {
    console.warn(
      `Backup delivery is not fully configured yet: ${missingBackupEnvironment.join(', ')}. The website build will continue, and the backup page will show a clear setup error until these values are added.`,
    )
  }

  if (!emailFrom) {
    console.warn(
      'EMAIL_FROM is not configured. Backup emails will use onboarding@resend.dev, which Resend allows only when the recipient is the email address associated with the Resend account.',
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
        'EMAIL_FROM is not a usable Resend sender. Backup emails will fall back to onboarding@resend.dev.',
      )
    }
  }

  const [adminAccount] = await db
    .select({ role: user.role, emailVerified: user.emailVerified, banned: user.banned })
    .from(user)
    .where(sql`lower(trim(${user.email})) = ${SOLE_ADMIN_EMAIL} and ${user.deletedAt} is null`)
    .limit(1)
  if (adminAccount) {
    if (adminAccount.role !== 'admin' || !adminAccount.emailVerified || adminAccount.banned) {
      throw new Error('The existing sole administrator account was not synchronized correctly.')
    }
    console.info('Release verification: administrator account is ready.')
  } else {
    console.info('Release verification: administrator account will be promoted automatically on first login.')
  }

  console.info('Release verification passed: database, branding, admin policy, and math question banks are ready.')
}

verifyRelease()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
