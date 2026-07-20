import { get } from '@vercel/blob'
import { and, eq, isNull } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { matchesSoleAdminIdentity, SOLE_ADMIN_EMAIL } from '@/lib/admin-policy'
import { db } from '@/lib/db'
import { adminAllowlist, banners, certificates, user } from '@/lib/db/schema'
import { consumeRateLimit } from '@/lib/rate-limit'

const safePath = /^(banners|certificates)\/[a-zA-Z0-9][a-zA-Z0-9._-]{1,180}$/
const allowedMediaTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'])

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const limit = await consumeRateLimit(`files:${session.user.id}`, 120, 60)
  if (!limit.allowed)
    return NextResponse.json(
      { error: 'محاولات كثيرة' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )

  const pathname = request.nextUrl.searchParams.get('pathname') ?? ''
  if (!safePath.test(pathname) || pathname.includes('..') || pathname.includes('\\')) {
    return NextResponse.json({ error: 'مسار غير صالح' }, { status: 400 })
  }

  let expectedMediaType: string | null = null
  let disposition = 'inline'
  if (pathname.startsWith('banners/')) {
    const [record] = await db
      .select({ imageMediaType: banners.imageMediaType })
      .from(banners)
      .where(and(eq(banners.imagePathname, pathname), eq(banners.isActive, true)))
      .limit(1)
    if (!record) return new NextResponse('غير موجود', { status: 404 })
    expectedMediaType = record.imageMediaType
  } else {
    const [current] = await db
      .select({
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        banned: user.banned,
      })
      .from(user)
      .where(and(eq(user.id, session.user.id), isNull(user.deletedAt)))
      .limit(1)
    const [allowlist] = await db
      .select({ isActive: adminAllowlist.isActive })
      .from(adminAllowlist)
      .where(and(eq(adminAllowlist.email, SOLE_ADMIN_EMAIL), eq(adminAllowlist.isActive, true)))
      .limit(1)
    const [record] = await db
      .select({ userId: certificates.userId, publicId: certificates.publicId })
      .from(certificates)
      .where(and(eq(certificates.blobPathname, pathname), isNull(certificates.revokedAt)))
      .limit(1)
    const isAdministrator = matchesSoleAdminIdentity(current) && Boolean(allowlist?.isActive)
    if (!record || (record.userId !== session.user.id && !isAdministrator))
      return new NextResponse('غير موجود', { status: 404 })
    expectedMediaType = 'application/pdf'
    disposition = `attachment; filename="certificate-${record.publicId}.pdf"`
  }

  const result = await get(pathname, {
    access: 'private',
    ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
  })
  if (!result) return new NextResponse('غير موجود', { status: 404 })
  if (result.statusCode === 304)
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: result.blob.etag, 'Cache-Control': 'private, no-cache' },
    })
  const contentType = expectedMediaType || result.blob.contentType
  if (
    !contentType ||
    !allowedMediaTypes.has(contentType) ||
    (expectedMediaType && result.blob.contentType !== expectedMediaType)
  ) {
    return NextResponse.json({ error: 'نوع ملف غير مسموح' }, { status: 415 })
  }
  return new NextResponse(result.stream, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': disposition,
      ETag: result.blob.etag,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
