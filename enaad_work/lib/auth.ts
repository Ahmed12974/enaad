import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthOptions } from '@/lib/auth-config'
import { db } from '@/lib/db'
import * as schema from '@/lib/db/schema'
import { getPlatformSettings } from '@/lib/platform-settings'

export const auth = betterAuth(
  createAuthOptions({
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    isRegistrationEnabled: async () => (await getPlatformSettings()).registrationEnabled,
  }),
)
