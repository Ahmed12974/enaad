import { createHmac, timingSafeEqual } from 'node:crypto'
import { get } from '@vercel/blob'
import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

function validSignature(pathname: string, expires: string, signature: string) {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32 || !/^backups\/[A-Za-z0-9._\/-]+$/.test(pathname)) return false
  const expiresNumber = Number(expires)
  if (!Number.isSafeInteger(expiresNumber) || expiresNumber <= Math.floor(Date.now() / 1000)) return false
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false
  const expected = createHmac('sha256', secret).update(`${pathname}\n${expires}`).digest()
  const provided = Buffer.from(signature, 'hex')
  return provided.byteLength === expected.byteLength && timingSafeEqual(provided, expected)
}

export async function GET(request: NextRequest) {
  const pathname = request.nextUrl.searchParams.get('pathname') ?? ''
  const expires = request.nextUrl.searchParams.get('expires') ?? ''
  const signature = request.nextUrl.searchParams.get('signature') ?? ''
  if (!validSignature(pathname, expires, signature)) {
    return NextResponse.json({ error: 'رابط النسخة غير صالح أو انتهت صلاحيته.' }, { status: 403 })
  }

  const result = await get(pathname, { access: 'private' })
  if (!result || result.statusCode !== 200 || !result.stream) {
    return NextResponse.json({ error: 'النسخة غير موجودة.' }, { status: 404 })
  }
  const filename = pathname.split('/').at(-1) ?? 'backup.zip'
  return new Response(result.stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename.replaceAll('"', '')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
