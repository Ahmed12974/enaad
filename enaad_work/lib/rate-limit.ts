import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { rateLimit } from '@/lib/db/schema'

export async function consumeRateLimit(key: string, max: number, windowSeconds: number) {
  const now = Date.now()
  const cutoff = now - windowSeconds * 1_000
  const result = await db.execute<{ count: number; lastRequest: number }>(sql`
    insert into ${rateLimit} (${rateLimit.key}, ${rateLimit.count}, ${rateLimit.lastRequest})
    values (${key}, 1, ${now})
    on conflict (${rateLimit.key}) do update set
      ${rateLimit.count} = case when ${rateLimit.lastRequest} < ${cutoff} then 1 else ${rateLimit.count} + 1 end,
      ${rateLimit.lastRequest} = case when ${rateLimit.lastRequest} < ${cutoff} then ${now} else ${rateLimit.lastRequest} end
    returning ${rateLimit.count} as count, ${rateLimit.lastRequest} as "lastRequest"
  `)
  const state = result.rows[0]
  return {
    allowed: Boolean(state && state.count <= max),
    retryAfter: state
      ? Math.max(1, Math.ceil((state.lastRequest + windowSeconds * 1_000 - now) / 1_000))
      : windowSeconds,
  }
}
