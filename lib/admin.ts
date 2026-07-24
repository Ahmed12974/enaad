export const appRoles = [
  'user',
  'content_editor',
  'user_manager',
  'competition_manager',
  'reward_manager',
  'report_viewer',
  'admin',
] as const

export type AppRole = (typeof appRoles)[number]
export type Permission =
  | 'content:read'
  | 'content:write'
  | 'users:read'
  | 'users:write'
  | 'competitions:write'
  | 'rewards:write'
  | 'reports:read'
  | 'backups:write'

const permissions: Record<AppRole, readonly Permission[]> = {
  user: [],
  content_editor: ['content:read', 'content:write'],
  user_manager: ['users:read', 'users:write'],
  competition_manager: ['content:read', 'competitions:write'],
  reward_manager: ['rewards:write', 'reports:read'],
  report_viewer: ['content:read', 'users:read', 'reports:read'],
  admin: [
    'content:read',
    'content:write',
    'users:read',
    'users:write',
    'competitions:write',
    'rewards:write',
    'reports:read',
    'backups:write',
  ],
}

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && appRoles.includes(value as AppRole)
}

export function hasPermission(role: unknown, permission: Permission) {
  return isAppRole(role) && permissions[role].includes(permission)
}

export function canOpenAdmin(role: unknown) {
  return role === 'admin'
}

function safeInternalPath(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null
  try {
    const url = new URL(value, 'https://internal.invalid')
    return url.origin === 'https://internal.invalid' ? `${url.pathname}${url.search}${url.hash}` : null
  } catch {
    return null
  }
}

export function landingPathForRole(role: unknown, requestedPath?: unknown) {
  const requested = safeInternalPath(requestedPath)
  const authFlowPaths = [
    '/sign-in',
    '/sign-up',
    '/forgot-password',
    '/reset-password',
    '/auth/continue',
    '/account/verify-recovery',
  ]
  const entersAuthFlow = requested
    ? authFlowPaths.some((path) => requested === path || requested.startsWith(`${path}?`))
    : false
  if (requested && !entersAuthFlow && (!requested.startsWith('/admin') || canOpenAdmin(role))) {
    return requested
  }
  return canOpenAdmin(role) ? '/admin' : '/'
}
