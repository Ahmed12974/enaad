import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { ensureSoleAdminTx } from '@/lib/admin-bootstrap'
import type { DbTransaction } from '@/lib/db'
import { adminAllowlist, user } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'
import { SOLE_ADMIN_EMAIL } from '@/lib/admin-policy'

let client: PGlite
let database: ReturnType<typeof drizzle<typeof schema>>

describe('sole administrator bootstrap', { concurrency: 1 }, () => {
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
      ].map((file) => readFile(resolve(process.cwd(), file), 'utf8')),
    )
    await client.exec(migrations.join('\n'))
    database = drizzle(client, { schema })
  })

  after(async () => client.close())

  test('promotes and verifies the authenticated exact owner account', async () => {
    const id = 'bootstrap-owner'
    await database.insert(user).values({
      id,
      name: 'Owner',
      email: SOLE_ADMIN_EMAIL.toUpperCase(),
      role: 'user',
      emailVerified: false,
    })

    const result = await database.transaction((tx) =>
      ensureSoleAdminTx(tx as unknown as DbTransaction, {
        id,
        email: SOLE_ADMIN_EMAIL.toUpperCase(),
        role: 'user',
        emailVerified: false,
        banned: false,
      }),
    )

    assert.equal(result?.role, 'admin')
    assert.equal(result?.emailVerified, true)
    const [updated] = await database.select().from(user).where(eq(user.id, id)).limit(1)
    const [allowed] = await database
      .select()
      .from(adminAllowlist)
      .where(eq(adminAllowlist.email, SOLE_ADMIN_EMAIL))
      .limit(1)
    assert.equal(updated?.role, 'admin')
    assert.equal(updated?.emailVerified, true)
    assert.equal(allowed?.isActive, true)
  })

  test('does not promote a different email', async () => {
    const id = 'not-owner'
    await database.insert(user).values({
      id,
      name: 'Learner',
      email: 'learner@example.invalid',
      role: 'user',
      emailVerified: true,
    })
    const result = await database.transaction((tx) =>
      ensureSoleAdminTx(tx as unknown as DbTransaction, {
        id,
        email: 'learner@example.invalid',
        role: 'user',
        emailVerified: true,
        banned: false,
      }),
    )
    assert.equal(result, null)
  })
})
