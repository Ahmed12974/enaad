import { randomUUID } from 'node:crypto'
import { del, get, put } from '@vercel/blob'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { getAuditRequestContext, writeAdminAudit } from '@/lib/admin-audit'
import { ForbiddenError, UnauthorizedError } from '@/lib/admin-policy'
import { requirePermission } from '@/lib/auth-session'
import { db } from '@/lib/db'
import { media } from '@/lib/db/schema'
import { consumeRateLimit } from '@/lib/rate-limit'
import { detectSafeMediaType } from '@/lib/security'
import { getPlatformSettings, MAX_UPLOAD_MB } from '@/lib/platform-settings'
import { publicActionError } from '@/lib/public-error'

const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

function errorResponse(error: unknown) {
  if (error instanceof ForbiddenError || error instanceof UnauthorizedError)
    return NextResponse.json({ error: error.message }, { status: error.status })
  return NextResponse.json(
    { error: publicActionError(error, 'تعذر تنفيذ طلب الوسائط.') },
    { status: 400 },
  )
}

function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin')
  const configured = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL
  if (!origin || !configured || origin !== new URL(configured).origin)
    throw new ForbiddenError('Origin غير مسموح.')
}

function logBlobCleanupFailure(operation: string, error: unknown) {
  console.error('[blob:cleanup]', {
    operation,
    error: error instanceof Error ? error.name : 'UnknownError',
  })
}

export async function GET(request: NextRequest) {
  try {
    await requirePermission('content:read')
    const id = request.nextUrl.searchParams.get('id') ?? ''
    const [record] = await db
      .select()
      .from(media)
      .where(and(eq(media.id, id), isNull(media.deletedAt)))
      .limit(1)
    if (!record) return new NextResponse('غير موجود', { status: 404 })
    const result = await get(record.pathname, { access: 'private' })
    if (!result) return new NextResponse('غير موجود', { status: 404 })
    if (result.blob.contentType !== record.mediaType || !extensions[record.mediaType])
      return NextResponse.json({ error: 'نوع ملف غير مسموح.' }, { status: 415 })
    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': record.mediaType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request)
    const actor = await requirePermission('content:write')
    const limit = await consumeRateLimit(`admin-media:${actor.id}`, 20, 60)
    if (!limit.allowed)
      return NextResponse.json(
        { error: 'محاولات رفع كثيرة.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      )
    const form = await request.formData()
    const file = form.get('file')
    const replaceId = String(form.get('replaceId') ?? '').trim()
    if (replaceId && !/^[0-9a-f-]{36}$/i.test(replaceId))
      return NextResponse.json({ error: 'معرّف ملف الاستبدال غير صالح.' }, { status: 400 })
    if (!(file instanceof File))
      return NextResponse.json({ error: 'اختر ملف وسائط صالحًا.' }, { status: 400 })
    const settings = await getPlatformSettings()
    const uploadLimitMb = Math.min(MAX_UPLOAD_MB, settings.maxUploadMb)
    if (file.size < 1 || file.size > uploadLimitMb * 1024 * 1024)
      return NextResponse.json(
        { error: `حجم ملف الوسائط يجب ألا يتجاوز ${uploadLimitMb} ميجابايت.` },
        { status: 413 },
      )
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const mediaType = detectSafeMediaType(bytes)
    if (!mediaType || mediaType !== file.type)
      return NextResponse.json({ error: 'نوع الملف المعلن لا يطابق توقيعه أو غير مسموح.' }, { status: 415 })
    if (!process.env.BLOB_READ_WRITE_TOKEN)
      return NextResponse.json({ error: 'تخزين الوسائط غير مهيأ.' }, { status: 503 })
    const pathname = `media/${randomUUID()}.${extensions[mediaType]}`
    const uploaded = await put(pathname, buffer, {
      access: 'private',
      contentType: mediaType,
      addRandomSuffix: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    })
    const context = await getAuditRequestContext()
    let previousPathname: string | null = null
    let saved
    try {
      saved = await db.transaction(async (tx) => {
        const altText =
          String(form.get('altText') ?? '')
            .trim()
            .slice(0, 500) || null
        const title =
          String(form.get('title') ?? '')
            .trim()
            .slice(0, 200) || null
        const description =
          String(form.get('description') ?? '')
            .trim()
            .slice(0, 2_000) || null
        if (replaceId) {
          const [current] = await tx
            .select()
            .from(media)
            .where(and(eq(media.id, replaceId), isNull(media.deletedAt)))
            .limit(1)
          if (!current) throw new Error('ملف الوسائط المطلوب استبداله غير موجود.')
          previousPathname = current.pathname
          const [record] = await tx
            .update(media)
            .set({
              pathname: uploaded.pathname,
              originalName: file.name.slice(0, 255),
              title: title ?? current.title,
              description: description ?? current.description,
              mediaType,
              sizeBytes: file.size,
              altText: altText ?? current.altText,
            })
            .where(eq(media.id, replaceId))
            .returning()
          if (!record) throw new Error('تعذر استبدال ملف الوسائط.')
          await writeAdminAudit(
            tx,
            {
              actorUserId: actor.id,
              action: 'media.replace',
              entityType: 'media',
              entityId: record.id,
              before: {
                pathname: current.pathname,
                mediaType: current.mediaType,
                sizeBytes: current.sizeBytes,
              },
              after: { pathname: record.pathname, mediaType: record.mediaType, sizeBytes: record.sizeBytes },
              reason: 'Safe media replacement while preserving references.',
            },
            context,
          )
          return record
        }
        const [record] = await tx
          .insert(media)
          .values({
            pathname: uploaded.pathname,
            originalName: file.name.slice(0, 255),
            title,
            description,
            mediaType,
            sizeBytes: file.size,
            altText,
            uploadedBy: actor.id,
          })
          .returning()
        if (!record) throw new Error('تعذر حفظ سجل الوسائط.')
        await writeAdminAudit(
          tx,
          {
            actorUserId: actor.id,
            action: 'media.upload',
            entityType: 'media',
            entityId: record.id,
            after: {
              pathname: record.pathname,
              mediaType: record.mediaType,
              sizeBytes: record.sizeBytes,
            },
          },
          context,
        )
        return record
      })
    } catch (error) {
      try {
        await del(uploaded.pathname, { token: process.env.BLOB_READ_WRITE_TOKEN })
      } catch (cleanupError) {
        logBlobCleanupFailure('rollback-new-upload', cleanupError)
      }
      throw error
    }
    let cleanupPending = false
    if (previousPathname) {
      try {
        await del(previousPathname, { token: process.env.BLOB_READ_WRITE_TOKEN })
      } catch (cleanupError) {
        cleanupPending = true
        logBlobCleanupFailure('remove-replaced-blob', cleanupError)
      }
    }
    return NextResponse.json(
      {
        ok: true,
        media: saved,
        ...(cleanupPending
          ? { warning: 'تم حفظ الملف الجديد، لكن تعذر تنظيف الملف السابق وسيحتاج إلى إعادة محاولة.' }
          : {}),
      },
      { status: replaceId ? 200 : 201 },
    )
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request)
    const actor = await requirePermission('content:write')
    const limit = await consumeRateLimit(`admin-media-metadata:${actor.id}`, 60, 60)
    if (!limit.allowed)
      return NextResponse.json(
        { error: 'محاولات تعديل كثيرة.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      )
    const input = (await request.json()) as Record<string, unknown>
    const id = typeof input.id === 'string' ? input.id : ''
    if (!/^[0-9a-f-]{36}$/i.test(id))
      return NextResponse.json({ error: 'معرّف الوسائط غير صالح.' }, { status: 400 })
    const title = typeof input.title === 'string' ? input.title.trim().slice(0, 200) || null : null
    const description =
      typeof input.description === 'string' ? input.description.trim().slice(0, 2_000) || null : null
    const altText = typeof input.altText === 'string' ? input.altText.trim().slice(0, 500) || null : null
    const context = await getAuditRequestContext()
    const updated = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(media)
        .where(and(eq(media.id, id), isNull(media.deletedAt)))
        .limit(1)
      if (!before) throw new Error('ملف الوسائط غير موجود.')
      const [after] = await tx
        .update(media)
        .set({ title, description, altText })
        .where(eq(media.id, id))
        .returning()
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'media.metadata.update',
          entityType: 'media',
          entityId: id,
          before: { title: before.title, description: before.description, altText: before.altText },
          after: { title: after?.title, description: after?.description, altText: after?.altText },
        },
        context,
      )
      return after
    })
    return NextResponse.json({ ok: true, media: updated })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request)
    const actor = await requirePermission('content:write')
    if (!process.env.BLOB_READ_WRITE_TOKEN)
      return NextResponse.json({ error: 'تخزين الوسائط غير مهيأ.' }, { status: 503 })
    const id = request.nextUrl.searchParams.get('id') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id))
      return NextResponse.json({ error: 'معرّف الوسائط غير صالح.' }, { status: 400 })
    const context = await getAuditRequestContext()
    const record = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(media).where(eq(media.id, id)).limit(1)
      if (!current || current.deletedAt) throw new Error('ملف الوسائط غير موجود.')
      const links = await tx.execute<{ count: number }>(sql`
        select (
          (select count(*) from "educationalSections" where "iconMediaId" = ${id} or "imageMediaId" = ${id}) +
          (select count(*) from "sectionContents" where "mediaId" = ${id} and "deletedAt" is null) +
          (select count(*) from badges where "imageMediaId" = ${id} and "deletedAt" is null) +
          (select count(*) from "challengeSettings" where "imageMediaId" = ${id})
        )::int as count
      `)
      if ((links.rows[0]?.count ?? 0) > 0) throw new Error('لا يمكن حذف صورة مستخدمة. أزل ارتباطها أولًا.')
      const [deleted] = await tx
        .update(media)
        .set({ deletedAt: new Date() })
        .where(eq(media.id, id))
        .returning()
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'media.delete',
          entityType: 'media',
          entityId: id,
          before: current,
          after: deleted,
          reason: 'Unused media cleanup.',
        },
        context,
      )
      return current
    })
    try {
      await del(record.pathname, { token: process.env.BLOB_READ_WRITE_TOKEN })
      return NextResponse.json({ ok: true })
    } catch (cleanupError) {
      logBlobCleanupFailure('remove-deleted-blob', cleanupError)
      await db.transaction((tx) =>
        writeAdminAudit(
          tx,
          {
            actorUserId: actor.id,
            action: 'media.blob.cleanup.failed',
            entityType: 'media',
            entityId: id,
            reason: 'Database record was deleted, but the private blob cleanup must be retried.',
            outcome: 'failure',
            errorCode: 'BLOB_CLEANUP_FAILED',
          },
          context,
        ),
      )
      return NextResponse.json({
        ok: true,
        warning: 'تم حذف سجل الوسائط، لكن تعذر تنظيف الملف الخاص وسيحتاج إلى إعادة محاولة.',
      })
    }
  } catch (error) {
    return errorResponse(error)
  }
}
