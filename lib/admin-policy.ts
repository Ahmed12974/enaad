import { normalizeEmail } from '@/lib/normalization'

export type AdminIdentity = {
  email: string
  emailVerified: boolean
  role: unknown
  banned?: boolean
}

export class ForbiddenError extends Error {
  readonly status = 403
  readonly code = 'FORBIDDEN'

  constructor(message = 'ليس لديك صلاحية الوصول إلى لوحة التحكم.') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class UnauthorizedError extends Error {
  readonly status = 401
  readonly code = 'UNAUTHORIZED'

  constructor(message = 'يجب تسجيل الدخول أولًا.') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export function resolveInitialAdminEmail(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env.INITIAL_ADMIN_EMAIL?.trim()
  if (!raw) return null
  const email = normalizeEmail(raw)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('INITIAL_ADMIN_EMAIL must contain a valid email address.')
  }
  return email
}

/**
 * Administrator authorization is role-based and evaluated from the database.
 * The optional INITIAL_ADMIN_EMAIL is only a one-time bootstrap input; it is
 * never used as a permanent authorization rule.
 */
export function matchesAdminIdentity(identity: AdminIdentity | null | undefined) {
  return Boolean(
    identity &&
      !identity.banned &&
      identity.emailVerified &&
      identity.role === 'admin',
  )
}
