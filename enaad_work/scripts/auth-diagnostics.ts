import { randomUUID } from 'node:crypto'
import { resolveAuthRuntime } from '@/lib/auth-config'

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const record = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

function requiredEnvironment() {
  const databaseOk = Boolean(process.env.DATABASE_URL)
  const secretOk = Boolean(process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32)
  record('DATABASE_URL', databaseOk, databaseOk ? 'configured' : 'missing')
  record(
    'BETTER_AUTH_SECRET',
    secretOk,
    secretOk ? 'configured with sufficient length' : 'missing or shorter than 32 characters',
  )
  try {
    const runtime = resolveAuthRuntime(process.env)
    record('application origin', true, runtime.baseURL)
    record(
      'trusted origins',
      runtime.trustedOrigins.every((origin) => !origin.includes('*')),
      `${runtime.trustedOrigins.length} exact origin(s) configured`,
    )
  } catch (error) {
    record('authentication runtime', false, error instanceof Error ? error.message : 'invalid configuration')
  }
  return databaseOk && secretOk
}

async function inspectDatabase() {
  const { pool } = await import('@/lib/db')
  const client = await pool.connect()
  try {
    await client.query('select 1')
    record('database connection', true, 'connected')

    const requiredTables = ['user', 'account', 'session', 'verification', 'rateLimit']
    const tableResult = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])`,
      [requiredTables],
    )
    const present = new Set(tableResult.rows.map((row) => row.table_name))
    record(
      'Better Auth tables',
      requiredTables.every((name) => present.has(name)),
      `${present.size}/${requiredTables.length} required tables present`,
    )
    const requiredColumns: Record<string, string[]> = {
      user: ['id', 'name', 'email', 'emailVerified', 'createdAt', 'updatedAt'],
      account: ['id', 'accountId', 'providerId', 'userId', 'password', 'createdAt', 'updatedAt'],
      session: ['id', 'token', 'expiresAt', 'userId', 'createdAt', 'updatedAt'],
      verification: ['id', 'identifier', 'value', 'expiresAt', 'createdAt', 'updatedAt'],
      rateLimit: ['id', 'key', 'count', 'lastRequest'],
    }
    const columnResult = await client.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name = any($1::text[])`,
      [requiredTables],
    )
    const columns = new Map<string, Set<string>>()
    for (const row of columnResult.rows) {
      const tableColumns = columns.get(row.table_name) ?? new Set<string>()
      tableColumns.add(row.column_name)
      columns.set(row.table_name, tableColumns)
    }
    const missingColumns = Object.entries(requiredColumns).flatMap(([table, names]) =>
      names.filter((name) => !columns.get(table)?.has(name)).map((name) => `${table}.${name}`),
    )
    record(
      'Better Auth columns',
      missingColumns.length === 0,
      missingColumns.length
        ? `${missingColumns.length} required column(s) missing`
        : 'all required columns present',
    )
    if (!present.has('user') || !present.has('account')) return { pool, canSelfTest: false }

    const structure = await client.query<{
      users: number
      nonNormalizedEmails: number
      duplicateEmails: number
      missingCredentialAccounts: number
      emptyCredentialHashes: number
      incompatibleCredentialHashes: number
      providerOnlyAccounts: number
    }>(`select
      (select count(*)::int from "user") as "users",
      (select count(*)::int from "user" where email <> lower(btrim(email))) as "nonNormalizedEmails",
      (select count(*)::int from (select lower(btrim(email)) from "user" group by 1 having count(*) > 1) duplicates) as "duplicateEmails",
      (select count(*)::int from "user" u where not exists (select 1 from account a where a."userId" = u.id and a."providerId" = 'credential')) as "missingCredentialAccounts",
      (select count(*)::int from account where "providerId" = 'credential' and (password is null or password = '')) as "emptyCredentialHashes",
      (select count(*)::int from account where "providerId" = 'credential' and password is not null and password !~ '^[0-9a-fA-F]{32}:[0-9a-fA-F]{128}$') as "incompatibleCredentialHashes",
      (select count(*)::int from "user" u where exists (select 1 from account a where a."userId" = u.id) and not exists (select 1 from account a where a."userId" = u.id and a."providerId" = 'credential')) as "providerOnlyAccounts"`)
    const stats = structure.rows[0]
    record(
      'normalized account emails',
      stats.nonNormalizedEmails === 0,
      `${stats.nonNormalizedEmails} non-normalized row(s)`,
    )
    record(
      'duplicate normalized emails',
      stats.duplicateEmails === 0,
      `${stats.duplicateEmails} duplicate group(s)`,
    )
    record(
      'credential linkage',
      stats.missingCredentialAccounts === 0,
      `${stats.missingCredentialAccounts} user(s) without a credential account`,
    )
    record(
      'credential hash presence',
      stats.emptyCredentialHashes === 0,
      `${stats.emptyCredentialHashes} empty hash row(s)`,
    )
    record(
      'credential hash compatibility',
      stats.incompatibleCredentialHashes === 0,
      `${stats.incompatibleCredentialHashes} structurally incompatible hash row(s)`,
    )
    record(
      'provider-only accounts',
      true,
      `${stats.providerOnlyAccounts} intentionally non-password account(s); password sign-in is not expected for these`,
    )

    if (present.has('session')) {
      const orphanResult = await client.query<{ orphanSessions: number; orphanAccounts: number }>(`select
        (select count(*)::int from session s left join "user" u on u.id = s."userId" where u.id is null) as "orphanSessions",
        (select count(*)::int from account a left join "user" u on u.id = a."userId" where u.id is null) as "orphanAccounts"`)
      const orphan = orphanResult.rows[0]
      record(
        'auth foreign-key integrity',
        orphan.orphanSessions === 0 && orphan.orphanAccounts === 0,
        `${orphan.orphanSessions} orphan session(s), ${orphan.orphanAccounts} orphan account(s)`,
      )
    }
    return {
      pool,
      canSelfTest: requiredTables.every((name) => present.has(name)) && missingColumns.length === 0,
    }
  } finally {
    client.release()
  }
}

async function runSelfTest() {
  const { auth } = await import('@/lib/auth')
  const { db } = await import('@/lib/db')
  const { user } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')
  const runtime = resolveAuthRuntime(process.env)
  const email = `diagnostic-${randomUUID()}@example.invalid`
  const password = `D-${randomUUID()}-aA9!`
  const endpoint = (path: string) => `${runtime.baseURL}/api/auth${path}`
  const post = (path: string, body: object, cookie?: string) =>
    auth.handler(
      new Request(endpoint(path), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: runtime.baseURL,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    )

  try {
    const signUp = await post('/sign-up/email', {
      name: 'Diagnostic account',
      email: `  ${email.toUpperCase()}  `,
      password,
    })
    record('self-test sign-up', signUp.status === 200, `HTTP ${signUp.status}`)

    const setCookie = signUp.headers.get('set-cookie') ?? ''
    const cookie = setCookie.split(';', 1)[0]
    record(
      'self-test session cookie',
      Boolean(cookie) && /lughati\.session_token=/.test(cookie),
      cookie ? 'created with the application prefix' : 'missing',
    )
    record(
      'localhost cookie security',
      runtime.baseURL.startsWith('https://') || !/;\s*secure/i.test(setCookie),
      runtime.baseURL.startsWith('https://')
        ? 'Secure is required on HTTPS'
        : 'Secure is disabled on HTTP localhost',
    )

    const sessionResponse = await auth.handler(
      new Request(endpoint('/get-session'), { headers: { cookie, origin: runtime.baseURL } }),
    )
    record(
      'self-test session read',
      sessionResponse.status === 200 && Boolean((await sessionResponse.json())?.user),
      `HTTP ${sessionResponse.status}`,
    )

    const signOut = await post('/sign-out', {}, cookie)
    record('self-test sign-out', signOut.status === 200, `HTTP ${signOut.status}`)

    const signIn = await post('/sign-in/email', { email: ` ${email.toUpperCase()} `, password })
    record('self-test sign-in', signIn.status === 200, `HTTP ${signIn.status}`)

    const rejected = await post('/sign-in/email', { email, password: `${password}x` })
    record(
      'self-test wrong password rejection',
      rejected.status >= 400 && rejected.status < 500,
      `HTTP ${rejected.status}`,
    )
  } finally {
    await db.delete(user).where(eq(user.email, email))
  }
}

async function main() {
  if (!requiredEnvironment()) return
  const { pool, canSelfTest } = await inspectDatabase()
  try {
    if (process.argv.includes('--self-test')) {
      if (!canSelfTest)
        record('authentication self-test', false, 'required tables are missing; run migrations first')
      else await runSelfTest()
    }
  } finally {
    await pool.end()
  }
}

main()
  .catch((error) => {
    record('diagnostic execution', false, error instanceof Error ? error.message : 'unexpected error')
    process.exitCode = 1
  })
  .finally(() => {
    for (const check of checks)
      console.info(`${check.ok ? 'PASS' : 'FAIL'} | ${check.name} | ${check.detail}`)
    if (checks.some((check) => !check.ok)) process.exitCode = 1
  })
