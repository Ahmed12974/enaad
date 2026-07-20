import { headers } from 'next/headers'
import type { DbTransaction } from '@/lib/db'
import { auditLogs } from '@/lib/db/schema'
import { hashSecurityIdentifier, redactSensitive } from '@/lib/security'

type AuditInput = {
  actorUserId: string
  action: string
  entityType: string
  entityId?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  reason?: string | null
  outcome?: 'success' | 'failure' | 'denied'
  errorCode?: string | null
}

export async function getAuditRequestContext() {
  const requestHeaders = await headers()
  const ip =
    requestHeaders.get('x-real-ip') ?? requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  return {
    ipHash: ip ? hashSecurityIdentifier(ip) : null,
    userAgent: requestHeaders.get('user-agent')?.slice(0, 500) ?? null,
    requestId:
      requestHeaders.get('x-request-id')?.slice(0, 200) ??
      requestHeaders.get('x-vercel-id')?.slice(0, 200) ??
      null,
  }
}

export async function writeAdminAudit(
  tx: DbTransaction,
  input: AuditInput,
  requestContext: Awaited<ReturnType<typeof getAuditRequestContext>>,
) {
  await tx.insert(auditLogs).values({
    ...input,
    before: redactSensitive(input.before) as Record<string, unknown> | null | undefined,
    after: redactSensitive(input.after) as Record<string, unknown> | null | undefined,
    ipHash: requestContext.ipHash,
    userAgent: requestContext.userAgent,
    requestId: requestContext.requestId,
  })
}
