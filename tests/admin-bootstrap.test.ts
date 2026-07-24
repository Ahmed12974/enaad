import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { after, before, beforeEach, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import {
  ensureInitialAdminTx,
  INITIAL_ADMIN_BOOTSTRAP_KEY,
} from '@/lib/admin-bootstrap'
import type { DbTransaction } from '@/lib/db'
import { adminAllowlist, auditLogs, platformSettings, user } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

let client: PGlite
let database: ReturnType<typeof drizzle<typeof schema>>

async function insertUser(values: {
  id: string
  email: string
  emailVerified?: boolean
  role?: 'user' | 'admin'
}) {
  await database.insert(user).values({
    id: values.id,
    name: values.id,
    email: values.email,
    role: values.role ?? 'user',
    emailVerified: values.emailVerified ?? true,
  })
}

describe('one-time initial administrator bootstrap', { concurrency: 1 }, () => {
  before(async () => {
    client = new PGlite()
    const migrations = await Promise.all(
      [
        'drizzle/0000_ordinary_spitfire.sql',
        'drizzle/0001_productive_red_ghost.sql',
        'drizzle/0002_glamorous_rhodey.sql',
        'drizzle/0003_puzzling_black_tarantula.sql',
        'drizzle/0004_chief_archangel.sql',
        'drizzle/0005_admin_completion.sql',
        'drizzle/0006_scheduled_content.sql',
        'drizzle/0007_media_metadata.sql',
        'drizzle/0008_rules_lifecycle.sql',
        'drizzle/0009_soft_delete_words.sql',
        'drizzle/0010_audit_outcomes.sql',
        'drizzle/0011_rate_limit_repair.sql',
        'drizzle/0012_academy_brand.sql',
        'drizzle/0013_backup_jobs.sql',
        'drizzle/0014_section_metadata.sql',
        'drizzle/0015_competition_lifecycle.sql',
        'drizzle/0016_challenge_type.sql',
        'drizzle/0017_branch_compatibility.sql',
      ].map((file) => readFile(resolve(process.cwd(), file), 'utf8')),
    )
    await client.exec(migrations.join('\n'))
    database = drizzle(client, { schema })
  })

  beforeEach(async () => {
    await database.delete(auditLogs)
    await database.delete(adminAllowlist)
    await database
      .delete(platformSettings)
      .where(eq(platformSettings.key, INITIAL_ADMIN_BOOTSTRAP_KEY))
    await database.delete(user)
  })

  after(async () => client.close())

  test('bootstraps the first verified account exactly once', async () => {
    const id = 'bootstrap-owner'
    const email = 'owner@example.test'
    await insertUser({ id, email })

    const first = await database.transaction((tx) =>
      ensureInitialAdminTx(
        tx as unknown as DbTransaction,
        { id, email, role: 'user', emailVerified: true, banned: false },
        { INITIAL_ADMIN_EMAIL: email },
        'seed',
      ),
    )
    assert.deepEqual(first, { status: 'completed', changed: true, role: 'admin' })

    const [updated] = await database.select().from(user).where(eq(user.id, id)).limit(1)
    const [marker] = await database
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, INITIAL_ADMIN_BOOTSTRAP_KEY))
      .limit(1)
    const [allowed] = await database
      .select()
      .from(adminAllowlist)
      .where(eq(adminAllowlist.email, email))
      .limit(1)
    assert.equal(updated?.role, 'admin')
    assert.equal(marker?.value.completed, true)
    assert.equal(marker?.value.bootstrappedUserId, id)
    assert.equal(allowed?.isActive, true)
    assert.equal((await database.select().from(auditLogs)).length, 1)
  })

  test('claims the bootstrap marker once when requests overlap', async () => {
    const id = 'concurrent-owner'
    const email = 'concurrent@example.test'
    await insertUser({ id, email })

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        database.transaction((tx) =>
          ensureInitialAdminTx(
            tx as unknown as DbTransaction,
            { id, email, role: 'user', emailVerified: true, banned: false },
            { INITIAL_ADMIN_EMAIL: email },
            'command',
          ),
        ),
      ),
    )

    assert.equal(results.filter((result) => result?.status === 'completed').length, 1)
    assert.equal(results.filter((result) => result?.status === 'already-completed').length, 3)
    assert.equal((await database.select().from(auditLogs)).length, 1)
    assert.equal(
      (
        await database
          .select()
          .from(platformSettings)
          .where(eq(platformSettings.key, INITIAL_ADMIN_BOOTSTRAP_KEY))
      ).length,
      1,
    )
  })

  test('does not re-promote a deliberately demoted account on later seed runs', async () => {
    const id = 'demoted-owner'
    const email = 'demoted@example.test'
    await insertUser({ id, email })
    await database.transaction((tx) =>
      ensureInitialAdminTx(
        tx as unknown as DbTransaction,
        { id, email, role: 'user', emailVerified: true, banned: false },
        { INITIAL_ADMIN_EMAIL: email },
        'seed',
      ),
    )

    await database.update(user).set({ role: 'user' }).where(eq(user.id, id))
    await database
      .update(adminAllowlist)
      .set({ isActive: false })
      .where(eq(adminAllowlist.email, email))

    const second = await database.transaction((tx) =>
      ensureInitialAdminTx(
        tx as unknown as DbTransaction,
        { id, email, role: 'user', emailVerified: true, banned: false },
        { INITIAL_ADMIN_EMAIL: email },
        'seed',
      ),
    )
    assert.deepEqual(second, { status: 'already-completed', changed: false, role: null })
    assert.equal((await database.select().from(user).where(eq(user.id, id)).limit(1))[0]?.role, 'user')
    assert.equal(
      (await database.select().from(adminAllowlist).where(eq(adminAllowlist.email, email)).limit(1))[0]
        ?.isActive,
      false,
    )
    assert.equal((await database.select().from(auditLogs)).length, 1)
  })

  test('changing INITIAL_ADMIN_EMAIL after bootstrap cannot create a second administrator', async () => {
    await insertUser({ id: 'first', email: 'first@example.test' })
    await insertUser({ id: 'second', email: 'second@example.test' })
    await database.transaction((tx) =>
      ensureInitialAdminTx(
        tx as unknown as DbTransaction,
        {
          id: 'first',
          email: 'first@example.test',
          role: 'user',
          emailVerified: true,
          banned: false,
        },
        { INITIAL_ADMIN_EMAIL: 'first@example.test' },
        'seed',
      ),
    )
    const second = await database.transaction((tx) =>
      ensureInitialAdminTx(
        tx as unknown as DbTransaction,
        {
          id: 'second',
          email: 'second@example.test',
          role: 'user',
          emailVerified: true,
          banned: false,
        },
        { INITIAL_ADMIN_EMAIL: 'second@example.test' },
        'seed',
      ),
    )
    assert.equal(second?.status, 'already-completed')
    assert.equal(
      (await database.select().from(user).where(eq(user.id, 'second')).limit(1))[0]?.role,
      'user',
    )
  })

  test('does not consume the marker for an unverified, banned or mismatched account', async () => {
    await insertUser({ id: 'pending', email: 'pending@example.test', emailVerified: false })
    const result = await database.transaction((tx) =>
      ensureInitialAdminTx(
        tx as unknown as DbTransaction,
        {
          id: 'pending',
          email: 'pending@example.test',
          role: 'user',
          emailVerified: false,
          banned: false,
        },
        { INITIAL_ADMIN_EMAIL: 'pending@example.test' },
        'seed',
      ),
    )
    assert.equal(result, null)
    assert.equal(
      (
        await database
          .select()
          .from(platformSettings)
          .where(eq(platformSettings.key, INITIAL_ADMIN_BOOTSTRAP_KEY))
      ).length,
      0,
    )
  })
})
