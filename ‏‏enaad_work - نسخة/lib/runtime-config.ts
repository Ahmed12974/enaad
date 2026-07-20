function parseOrigin(value: string | undefined) {
  if (!value || value.includes('*')) return null
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null
  } catch {
    return null
  }
}

export function getPublicAppUrl(env: Record<string, string | undefined> = process.env) {
  const configured = parseOrigin(env.NEXT_PUBLIC_APP_URL) ?? parseOrigin(env.BETTER_AUTH_URL)
  const vercel = parseOrigin(env.VERCEL_PROJECT_PRODUCTION_URL) ?? parseOrigin(env.VERCEL_URL)
  const result = configured ?? vercel ?? (env.NODE_ENV === 'production' ? null : 'http://localhost:3000')
  if (!result) throw new Error('NEXT_PUBLIC_APP_URL must be configured with the public application origin.')
  if (env.NODE_ENV === 'production' && !result.startsWith('https://')) {
    throw new Error('NEXT_PUBLIC_APP_URL must use HTTPS in production.')
  }
  return result
}

export function validateRuntimeEnvironment(env: Record<string, string | undefined> = process.env) {
  const missing: string[] = []
  if (!env.DATABASE_URL) missing.push('DATABASE_URL')
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)
    missing.push('BETTER_AUTH_SECRET (32+ characters)')
  if (env.NODE_ENV === 'production' && !env.NEXT_PUBLIC_APP_URL && !env.BETTER_AUTH_URL) {
    missing.push('NEXT_PUBLIC_APP_URL or BETTER_AUTH_URL')
  }
  if (missing.length) throw new Error(`Missing or invalid runtime configuration: ${missing.join(', ')}`)
  return { appUrl: getPublicAppUrl(env) }
}
