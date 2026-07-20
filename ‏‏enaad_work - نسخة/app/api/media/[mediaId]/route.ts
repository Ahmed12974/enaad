import { get } from '@vercel/blob'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { media } from '@/lib/db/schema'

const allowedTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'audio/mpeg',
  'audio/wav',
  'video/mp4',
  'video/webm',
  'application/pdf',
])

export async function GET(_request: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await params
  if (!z.string().uuid().safeParse(mediaId).success) return new NextResponse('غير موجود', { status: 404 })
  const [record] = await db
    .select({ pathname: media.pathname, mediaType: media.mediaType })
    .from(media)
    .where(
      and(
        eq(media.id, mediaId),
        isNull(media.deletedAt),
        or(
          sql`exists(select 1 from "siteContent" c where c.content->>'imageMediaId' = ${mediaId} and c."isVisible" = true and (c.status = 'published' or (c.status = 'scheduled' and c."startsAt" <= now())) and (c."startsAt" is null or c."startsAt" <= now()) and (c."endsAt" is null or c."endsAt" >= now()))`,
          sql`exists(select 1 from "educationalSections" s where (s."imageMediaId" = ${mediaId}::uuid or s."iconMediaId" = ${mediaId}::uuid) and s.status = 'published' and s."deletedAt" is null)`,
          sql`exists(select 1 from badges b where b."imageMediaId" = ${mediaId}::uuid and b."isPublished" = true and b."deletedAt" is null)`,
        )!,
      ),
    )
    .limit(1)
  if (!record || !allowedTypes.has(record.mediaType)) return new NextResponse('غير موجود', { status: 404 })
  const result = await get(record.pathname, { access: 'private' })
  if (!result || result.blob.contentType !== record.mediaType)
    return new NextResponse('غير موجود', { status: 404 })
  return new NextResponse(result.stream, {
    headers: {
      'Content-Type': record.mediaType,
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })
}
