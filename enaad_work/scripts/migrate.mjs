import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import pg from 'pg'

const { Pool } = pg
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  console.error('Migration failed: DATABASE_URL is required.')
  process.exit(1)
}

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 10_000,
  options: '-c timezone=UTC',
})
let client

try {
  client = await pool.connect()
  await client.query(`create table if not exists "_lughati_migrations" (
    "name" text primary key,
    "checksum" text not null,
    "appliedAt" timestamptz not null default now()
  )`)

  async function applyMigration(migrationName, relativeFiles) {
    const migrationSql = (
      await Promise.all(relativeFiles.map((file) => readFile(resolve(root, file), 'utf8')))
    ).join('\n')
    const checksum = createHash('sha256').update(migrationSql).digest('hex')
    const applied = await client.query('select "checksum" from "_lughati_migrations" where "name" = $1', [
      migrationName,
    ])
    if (applied.rowCount) {
      if (applied.rows[0].checksum !== checksum)
        throw new Error(`Applied migration ${migrationName} was modified after deployment.`)
      console.info(`Migration ${migrationName} is already applied.`)
      return
    }
    await client.query('begin')
    try {
      await client.query(`select pg_advisory_xact_lock(hashtext('lughati-schema-migration'))`)
      await client.query(`set local lock_timeout = '10s'`)
      await client.query(`set local statement_timeout = '5min'`)
      await client.query(migrationSql)
      await client.query('insert into "_lughati_migrations" ("name", "checksum") values ($1, $2)', [
        migrationName,
        checksum,
      ])
      await client.query('commit')
      console.info(`Applied migration ${migrationName}.`)
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  }

  const baseApplied = await client.query(
    `select "name" from "_lughati_migrations"
     where "name" in ('fresh-0000-schema', 'legacy-0001-secure-upgrade')`,
  )
  if (!baseApplied.rowCount) {
    const existing = await client.query(`select to_regclass('public."user"') is not null as present`)
    const isLegacyUpgrade = Boolean(existing.rows[0]?.present)
    await applyMigration(
      isLegacyUpgrade ? 'legacy-0001-secure-upgrade' : 'fresh-0000-schema',
      isLegacyUpgrade
        ? ['drizzle/legacy/0001_secure_upgrade.sql']
        : [
            'drizzle/0000_ordinary_spitfire.sql',
            'drizzle/0001_productive_red_ghost.sql',
            'drizzle/0002_glamorous_rhodey.sql',
          ],
    )
  }

  await applyMigration('0003-admin-console', ['drizzle/0003_puzzling_black_tarantula.sql'])
  await applyMigration('0004-challenge-disqualification', ['drizzle/0004_chief_archangel.sql'])
  await applyMigration('0005-admin-completion', ['drizzle/0005_admin_completion.sql'])
  await applyMigration('0006-scheduled-content', ['drizzle/0006_scheduled_content.sql'])
  await applyMigration('0007-media-metadata', ['drizzle/0007_media_metadata.sql'])
  await applyMigration('0008-rules-lifecycle', ['drizzle/0008_rules_lifecycle.sql'])
  await applyMigration('0009-soft-delete-words', ['drizzle/0009_soft_delete_words.sql'])
  await applyMigration('0010-audit-outcomes', ['drizzle/0010_audit_outcomes.sql'])

  const validation = await client.query(`select
    to_regclass('public."user"') is not null as "userTable",
    to_regclass('public.account') is not null as "accountTable",
    to_regclass('public.session') is not null as "sessionTable",
    to_regclass('public.verification') is not null as "verificationTable",
    to_regclass('public."rewardLedger"') is not null as "rewardLedgerTable",
    to_regclass('public."wordQuizAttempts"') is not null as "wordQuizAttemptsTable",
    to_regclass('public."adminAllowlist"') is not null as "adminAllowlistTable",
    to_regclass('public."educationalSections"') is not null as "educationalSectionsTable",
    to_regclass('public."sectionContents"') is not null as "sectionContentsTable",
    to_regclass('public."promotionRules"') is not null as "promotionRulesTable",
    to_regclass('public.badges') is not null as "badgesTable",
    to_regclass('public."siteContent"') is not null as "siteContentTable",
    to_regclass('public."siteContentVersions"') is not null as "siteContentVersionsTable",
    to_regclass('public."platformSettings"') is not null as "platformSettingsTable",
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'promotionRules' and column_name = 'applicationMode'
    ) as "rulesLifecycleColumns",
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'promotionRuleExecutions' and column_name = 'attemptCount'
    ) as "ruleExecutionRetryColumns",
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'words' and column_name = 'deletedAt'
    ) as "wordSoftDeleteColumn",
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'auditLogs' and column_name = 'outcome'
    ) as "auditOutcomeColumn"`)
  if (Object.values(validation.rows[0]).some((value) => value !== true))
    throw new Error('Post-migration schema validation failed.')
  console.info('Schema validation passed.')
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : 'unknown database error')
  process.exitCode = 1
} finally {
  client?.release()
  await pool.end()
}
