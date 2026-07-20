import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

declare global {
  var __lughatiPool: Pool | undefined
}

function createPool() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is required. Copy .env.example and configure the PostgreSQL connection.')
  }

  return new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? (process.env.NODE_ENV === 'production' ? 5 : 10)),
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: process.env.NODE_ENV !== 'production',
    options: '-c timezone=UTC',
    ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: true } : undefined,
  })
}

export const pool = globalThis.__lughatiPool ?? createPool()

if (process.env.NODE_ENV !== 'production') globalThis.__lughatiPool = pool

export const db = drizzle(pool, { schema })
export type Database = typeof db
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
