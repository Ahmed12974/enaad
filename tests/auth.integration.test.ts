import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, describe, test } from 'node:test'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/pglite'
import { eq } from 'drizzle-orm'
import { createAuthOptions, resolveAuthRuntime } from '@/lib/auth-config'
import { getArabicAuthError } from '@/lib/auth-messages'
import { hasPermission, landingPathForRole } from '@/lib/admin'
import type { DbTransaction } from '@/lib/db'
import { awardProgress } from '@/lib/rewards'
import { account, rewardLedger, user, userProgress } from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

const env = {
  NODE_ENV: 'test',
  BETTER_AUTH_SECRET: 'test-only-stable-secret-with-more-than-32-characters',
  BETTER_AUTH_URL: 'http://localhost:3000',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  AUTH_TRUSTED_ORIGINS: 'http://127.0.0.1:3000',
}

const email = 'auth.integration@example.invalid'
const password = 'Integration-A9! password'
let databaseClient: PGlite
let database: ReturnType<typeof drizzle<typeof schema>>
let auth: ReturnType<typeof betterAuth>

function endpoint(path: string) {
  return `${env.BETTER_AUTH_URL}/api/auth${path}`
}

function cookiePair(response: Response) {
  return (response.headers.get('set-cookie') ?? '').split(';', 1)[0]
}

async function post(
  path: string,
  body: object,
  cookie?: string,
  origin = env.BETTER_AUTH_URL,
  clientIp = '127.0.0.1',
) {
  return auth.handler(
    new Request(endpoint(path), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        'x-forwarded-for': clientIp,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  )
}

async function getSession(cookie: string) {
  return auth.handler(
    new Request(endpoint('/get-session'), {
      headers: { cookie, origin: env.BETTER_AUTH_URL, 'x-forwarded-for': '127.0.0.1' },
    }),
  )
}

describe('Better Auth PostgreSQL integration', { concurrency: 1 }, () => {
  before(async () => {
    databaseClient = new PGlite()
    const migrations = await Promise.all([
      readFile(resolve(process.cwd(), 'drizzle/0000_ordinary_spitfire.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0001_productive_red_ghost.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0002_glamorous_rhodey.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0003_puzzling_black_tarantula.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0004_chief_archangel.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0005_admin_completion.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0006_scheduled_content.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0007_media_metadata.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0008_rules_lifecycle.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0009_soft_delete_words.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0010_audit_outcomes.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0011_rate_limit_repair.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0012_academy_brand.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0013_backup_jobs.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0014_section_metadata.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0015_competition_lifecycle.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0016_challenge_type.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'drizzle/0017_branch_compatibility.sql'), 'utf8'),
    ])
    await databaseClient.exec(migrations.join('\n'))
    database = drizzle(databaseClient, { schema })
    auth = betterAuth(
      createAuthOptions({
        database: drizzleAdapter(database, { provider: 'pg', schema }),
        env,
      }),
    )
  })

  after(async () => {
    await databaseClient.close()
  })

  test('creates an account through the official endpoint and hashes its password', async () => {
    const response = await post('/sign-up/email', {
      name: 'Integration user',
      email: `  ${email.toUpperCase()}  `,
      password,
    })
    assert.equal(response.status, 200)
    const [created] = await database.select({ email: user.email }).from(user).where(eq(user.email, email))
    assert.equal(created?.email, email)
    const [credential] = await database
      .select({ password: account.password, providerId: account.providerId })
      .from(account)
      .where(eq(account.providerId, 'credential'))
    assert.equal(credential?.providerId, 'credential')
    assert.ok(
      Boolean(credential?.password && credential.password !== password),
      'credential must contain a non-plain hash',
    )
    assert.match(credential?.password ?? '', /^[0-9a-f]{32}:[0-9a-f]{128}$/i)
  })

  test('blocks the sign-up endpoint server-side when registration is disabled', async () => {
    const blockedAuth = betterAuth(
      createAuthOptions({
        database: drizzleAdapter(database, { provider: 'pg', schema }),
        env,
        isRegistrationEnabled: async () => false,
      }),
    )
    const response = await blockedAuth.handler(
      new Request(endpoint('/sign-up/email'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: env.BETTER_AUTH_URL },
        body: JSON.stringify({
          name: 'Blocked registration',
          email: 'blocked-registration@example.invalid',
          password,
        }),
      }),
    )
    assert.equal(response.status, 403)
    const [created] = await database
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, 'blocked-registration@example.invalid'))
    assert.equal(created, undefined)
  })

  test('sets a localhost-compatible session cookie and reads the session after navigation/refresh', async () => {
    const response = await post('/sign-in/email', { email: ` ${email.toUpperCase()} `, password })
    assert.equal(response.status, 200)
    const setCookie = response.headers.get('set-cookie') ?? ''
    const cookie = cookiePair(response)
    assert.ok(Boolean(cookie), 'session cookie must be present')
    assert.equal(/;\s*Secure/i.test(setCookie), false)
    assert.equal(/;\s*HttpOnly/i.test(setCookie), true)
    assert.equal(/;\s*SameSite=Lax/i.test(setCookie), true)
    assert.equal(/;\s*Path=\//i.test(setCookie), true)

    const firstRead = await getSession(cookie)
    const secondRead = await getSession(cookie)
    assert.equal(firstRead.status, 200)
    assert.equal(secondRead.status, 200)
    assert.equal(Boolean((await firstRead.json())?.user), true)
    assert.equal(Boolean((await secondRead.json())?.user), true)
  })

  test('rejects both a wrong password and an unknown email without exposing account existence', async () => {
    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '))
    let wrong: Response
    let unknown: Response
    try {
      wrong = await post('/sign-in/email', { email, password: `${password}x` })
      unknown = await post('/sign-in/email', { email: 'missing@example.invalid', password })
    } finally {
      console.warn = originalWarn
    }
    assert.equal(wrong.status, 401)
    assert.equal(unknown.status, 401)
    const wrongBody = (await wrong.json()) as { code?: string; status?: number }
    const unknownBody = (await unknown.json()) as { code?: string; status?: number }
    assert.equal(
      getArabicAuthError({ ...wrongBody, status: wrong.status }, 'sign-in'),
      'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    )
    assert.equal(
      getArabicAuthError({ ...unknownBody, status: unknown.status }, 'sign-in'),
      'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    )
    assert.equal(
      warnings.some((line) => /invalid password|user not found|token|cookie/i.test(line)),
      false,
    )
  })

  test('destroys the server session on sign-out and permits a subsequent sign-in', async () => {
    const signIn = await post('/sign-in/email', { email, password })
    const cookie = cookiePair(signIn)
    const signOut = await post('/sign-out', {}, cookie)
    assert.equal(signOut.status, 200)
    const staleSession = await getSession(cookie)
    assert.equal(await staleSession.json(), null)
    assert.equal((await post('/sign-in/email', { email, password })).status, 200)
  })

  test('enforces exact trusted origins and production cookie policy', async () => {
    const invalidOrigin = await post(
      '/sign-in/email',
      { email, password },
      undefined,
      'https://untrusted.example',
    )
    assert.equal(invalidOrigin.status, 403)
    const development = resolveAuthRuntime(env)
    assert.deepEqual(development.trustedOrigins.sort(), ['http://127.0.0.1:3000', 'http://localhost:3000'])
    const productionOptions = createAuthOptions({
      database: drizzleAdapter(database, { provider: 'pg', schema }),
      env: {
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        BETTER_AUTH_URL: 'https://lughati.example',
        NEXT_PUBLIC_APP_URL: 'https://lughati.example',
      },
    })
    assert.equal(productionOptions.baseURL, 'https://lughati.example')
    assert.equal(productionOptions.advanced?.useSecureCookies, true)
  })

  test('separates successful authentication from administrator authorization', async () => {
    const [created] = await database.select({ id: user.id }).from(user).where(eq(user.email, email))
    assert.ok(created)
    assert.equal(landingPathForRole('user'), '/')
    assert.equal(hasPermission('user', 'users:write'), false)
    await database.update(user).set({ role: 'admin' }).where(eq(user.id, created.id))
    assert.equal((await post('/sign-in/email', { email, password })).status, 200)
    assert.equal(landingPathForRole('admin'), '/admin')
    assert.equal(hasPermission('admin', 'users:write'), true)
  })

  test('preserves safe protected destinations without allowing redirect loops or external URLs', () => {
    assert.equal(landingPathForRole('user', '/words?language=ar'), '/words?language=ar')
    assert.equal(landingPathForRole('user', '/admin'), '/')
    assert.equal(landingPathForRole('admin', '/admin?tab=users'), '/admin?tab=users')
    assert.equal(landingPathForRole('user', '/auth/continue?next=/auth/continue'), '/')
    assert.equal(landingPathForRole('user', '//evil.example/path'), '/')
    assert.equal(landingPathForRole('user', 'https://evil.example/path'), '/')
  })

  test('blocks a suspended account without treating it as an ordinary credential error', async () => {
    await database
      .update(user)
      .set({ banned: true, banReason: 'integration test' })
      .where(eq(user.email, email))
    const response = await post('/sign-in/email', { email, password })
    assert.equal(response.status, 403)
    await database.update(user).set({ banned: false, banReason: null }).where(eq(user.email, email))
  })

  test('rate-limits repeated sign-in attempts', async () => {
    let response: Response | undefined
    for (let attempt = 0; attempt < 9; attempt += 1) {
      response = await post(
        '/sign-in/email',
        { email: 'rate-limit@example.invalid', password },
        undefined,
        env.BETTER_AUTH_URL,
        '198.51.100.9',
      )
    }
    assert.equal(response?.status, 429)
  })

  test('exposes only the application recovery flow', async () => {
    const response = await post('/request-password-reset', { email })
    assert.equal(response.status, 404)
  })

  test('awards an idempotent reward only once when requests overlap', async () => {
    const [created] = await database.select({ id: user.id }).from(user).where(eq(user.email, email))
    assert.ok(created)
    const sourceId = 'overlap-integration-attempt'
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        database.transaction((tx) =>
          awardProgress(tx as unknown as DbTransaction, {
            userId: created.id,
            sourceType: 'integration-overlap',
            sourceId,
            xp: 25,
            coins: 5,
          }),
        ),
      ),
    )
    assert.equal(results.filter(Boolean).length, 1)
    const ledgerRows = await database
      .select({ id: rewardLedger.id })
      .from(rewardLedger)
      .where(eq(rewardLedger.sourceId, sourceId))
    assert.equal(ledgerRows.length, 1)
    const [progress] = await database
      .select({ xp: userProgress.xp, coins: userProgress.coins })
      .from(userProgress)
      .where(eq(userProgress.userId, created.id))
    assert.deepEqual(progress, { xp: 25, coins: 5 })
  })
})
