import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/auth-session'
import { db } from '@/lib/db'
import { userActivities } from '@/lib/db/schema'
import { consumeRateLimit } from '@/lib/rate-limit'

const activitySchema = z.object({
  path: z.string().trim().startsWith('/').max(300),
  durationSeconds: z.number().int().min(1).max(300),
})

export async function POST(request: NextRequest) {
  try {
    const configured = process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL
    const origin = request.headers.get('origin')
    if (!configured || !origin || origin !== new URL(configured).origin)
      return NextResponse.json({ error: 'Origin غير مسموح.' }, { status: 403 })
    const current = await requireUser()
    const limit = await consumeRateLimit(`activity:${current.id}`, 8, 60)
    if (!limit.allowed)
      return NextResponse.json(
        { error: 'طلبات كثيرة.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      )
    const input = activitySchema.parse(await request.json())
    await db.insert(userActivities).values({
      userId: current.id,
      activityType: 'page.active',
      entityType: 'route',
      entityId: input.path,
      durationSeconds: input.durationSeconds,
    })
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error) {
      const status = Number((error as { status: unknown }).status)
      if (status === 401 || status === 403)
        return NextResponse.json({ error: status === 401 ? 'غير مصرح' : 'ممنوع' }, { status })
    }
    return NextResponse.json({ error: 'تعذر تسجيل النشاط.' }, { status: 400 })
  }
}
