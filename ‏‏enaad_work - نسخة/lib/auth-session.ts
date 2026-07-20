import { cache } from 'react'
import { headers } from 'next/headers'
import { and, eq, isNull } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { getAuditRequestContext, writeAdminAudit } from '@/lib/admin-audit'
import { db } from '@/lib/db'
import { adminAllowlist, user, userAdminProfiles } from '@/lib/db/schema'
import { canOpenAdmin, hasPermission, type Permission } from '@/lib/admin'
import {
  ForbiddenError,
  matchesSoleAdminIdentity,
  SOLE_ADMIN_EMAIL,
  UnauthorizedError,
} from '@/lib/admin-policy'

export const getCurrentSession = cache(async () => auth.api.getSession({ headers: await headers() }))

export const getCurrentUser = cache(async () => {
  const session = await getCurrentSession()
  if (!session?.user) return null
  const [record] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      managedStatus: userAdminProfiles.status,
      suspendedUntil: userAdminProfiles.suspendedUntil,
    })
    .from(user)
    .leftJoin(userAdminProfiles, eq(userAdminProfiles.userId, user.id))
    .where(and(eq(user.id, session.user.id), isNull(user.deletedAt)))
    .limit(1)
  return record ?? null
})

export async function requireUser() {
  const current = await getCurrentUser()
  const suspended =
    current?.managedStatus === 'suspended' &&
    (!current.suspendedUntil || current.suspendedUntil.getTime() > Date.now())
  if (!current) throw new UnauthorizedError()
  if (
    current.banned ||
    current.managedStatus === 'disabled' ||
    current.managedStatus === 'banned' ||
    suspended
  )
    throw new ForbiddenError('هذا الحساب غير مسموح له بالوصول.')
  return current
}

export async function isAllowedAdministrator(current: Awaited<ReturnType<typeof getCurrentUser>>) {
  const suspended =
    current?.managedStatus === 'suspended' &&
    (!current.suspendedUntil || current.suspendedUntil.getTime() > Date.now())
  if (!current || current.managedStatus === 'disabled' || current.managedStatus === 'banned' || suspended)
    return false
  if (!matchesSoleAdminIdentity(current)) return false
  const [allowed] = await db
    .select({ isActive: adminAllowlist.isActive })
    .from(adminAllowlist)
    .where(and(eq(adminAllowlist.email, SOLE_ADMIN_EMAIL), eq(adminAllowlist.isActive, true)))
    .limit(1)
  return Boolean(allowed?.isActive)
}

export async function requirePermission(permission: Permission) {
  const current = await requireUser()
  if (!(await isAllowedAdministrator(current)) || !hasPermission(current.role, permission)) {
    await logAdminAccessDenied(current.id, `permission:${permission}`)
    throw new ForbiddenError('ليس لديك صلاحية تنفيذ هذه العملية.')
  }
  return current
}

export async function logAdminAccessDenied(userId: string, reason: string) {
  const context = await getAuditRequestContext()
  await db.transaction((tx) =>
    writeAdminAudit(
      tx,
      {
        actorUserId: userId,
        action: 'admin.access.denied',
        entityType: 'adminAccess',
        entityId: null,
        reason: reason.slice(0, 200),
        outcome: 'denied',
        errorCode: 'ADMIN_ACCESS_DENIED',
      },
      context,
    ),
  )
}

export async function isCurrentUserAdmin() {
  const current = await getCurrentUser()
  return Boolean(current && canOpenAdmin(current.role) && (await isAllowedAdministrator(current)))
}
