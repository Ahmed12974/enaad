import { normalizeEmail } from '@/lib/normalization'

export const SOLE_ADMIN_EMAIL = 'enaadx@gmail.com' as const

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

export function matchesSoleAdminIdentity(identity: AdminIdentity | null | undefined) {
  return Boolean(
    identity &&
      !identity.banned &&
      identity.emailVerified &&
      identity.role === 'admin' &&
      normalizeEmail(identity.email) === SOLE_ADMIN_EMAIL,
  )
}
