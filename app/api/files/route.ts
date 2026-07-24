import { get } from '@vercel/blob'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { matchesAdminIdentity } from '@/lib/admin-policy'
import { db } from '@/lib/db'
import { banners, certificates, user } from '@/lib/db/schema'
import { consumeRateLimit } from '@/lib/rate-limit'

const safePath = /^(banners|certificates)\/[a-zA-Z0-9][a-zA-Z0-9._-]{1,180}$/
const allowedMediaTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
])

function anonymousRateLimitKey(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const direct = request.headers.get('x-real-ip')?.trim()
  return (forwarded || direct || 'unknown').slice(0, 100)
}

export async function GET(request: NextRequest) {
  const pathname = request.nextUrl.searchParams.get('pathname') ?? ''
  if (!safePath.test(pathname) || pathname.includes('..') || pathname.includes('\\')) {
    return NextResponse.json({ error: 'مسار غير صالح' }, { status: 400 })
  }

  const isPublicBanner = pathname.startsWith('banners/')
  const session = isPublicBanner ? null : await auth.api.getSession({ headers: request.headers })
  if (!isPublicBanner && !session?.user) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
  }

  const rateLimitKey = isPublicBanner
    ? `public-banner:${anonymousRateLimitKey(request)}`
    : `files:${session!.user.id}`
  const limit = await consumeRateLimit(rateLimitKey, isPublicBanner ? 240 : 120, 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'محاولات كثيرة' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
    )
  }

  let expectedMediaType: string | null = null
  let disposition = 'inline'
  if (isPublicBanner) {
    const [record] = await db
      .select({ imageMediaType: banners.imageMediaType })
      .from(banners)
      .where(
        and(
          eq(banners.imagePathname, pathname),
          eq(banners.isActive, true),
          or(isNull(banners.startsAt), sql`${banners.startsAt} <= now()`),
          or(isNull(banners.endsAt), sql`${banners.endsAt} >= now()`),
        ),
      )
      .limit(1)
    if (!record) return new NextResponse('غير موجود', { status: 404 })
    expectedMediaType = record.imageMediaType
  } else {
    const currentUserId = session!.user.id
    const [current] = await db
      .select({
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        banned: user.banned,
      })
      .from(user)
      .where(and(eq(user.id, currentUserId), isNull(user.deletedAt)))
      .limit(1)
    const [record] = await db
      .select({ userId: certificates.userId, publicId: certificates.publicId })
      .from(certificates)
      .where(and(eq(certificates.blobPathname, pathname), isNull(certificates.revokedAt)))
      .limit(1)
    const isAdministrator = matchesAdminIdentity(current)
    if (!record || (record.userId !== currentUserId && !isAdministrator))
      return new NextResponse('غير موجود', { status: 404 })
    expectedMediaType = 'application/pdf'
    disposition = `attachment; filename="certificate-${record.publicId}.pdf"`
  }

  const result = await get(pathname, {
    access: 'private',
    ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
  })
  if (!result) return new NextResponse('غير موجود', { status: 404 })
  const cacheControl = isPublicBanner
    ? 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
    : 'private, no-store'
  if (result.statusCode === 304)
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: result.blob.etag, 'Cache-Control': cacheControl },
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
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  })
}
