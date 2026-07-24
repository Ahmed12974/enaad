import { createHash, randomBytes } from 'node:crypto'
import { Resend } from 'resend'

export const TOKEN_TTL_MS = 30 * 60 * 1000

export function createRecoveryToken() {
  const token = randomBytes(32).toString('hex')
  return { token, tokenHash: hashRecoveryToken(token) }
}

export function hashRecoveryToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function getAppUrl() {
  const raw =
    process.env.BETTER_AUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined) ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ||
    process.env.V0_RUNTIME_URL
  if (!raw) throw new Error('App URL is not configured')
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('App URL must use HTTP or HTTPS')
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
    throw new Error('Production App URL must use HTTPS')
  return url.origin
}

function html(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export async function sendRecoveryEmail({
  to,
  subject,
  title,
  text,
  actionLabel,
  actionUrl,
}: {
  to: string
  subject: string
  title: string
  text: string
  actionLabel: string
  actionUrl: string
}) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (!apiKey || !from) throw new Error('Email service is not configured')
  const resend = new Resend(apiKey)
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:32px;color:#173d34"><h1 style="font-size:28px">${html(title)}</h1><p style="line-height:1.8">${html(text)}</p><p><a href="${html(actionUrl)}" style="display:inline-block;background:#123c32;color:#fffdf8;padding:12px 20px;border-radius:10px;text-decoration:none">${html(actionLabel)}</a></p><p style="color:#6c7b74;font-size:14px">ينتهي هذا الرابط خلال 30 دقيقة ولا يمكن استخدامه أكثر من مرة.</p></div>`,
    text: `${title}\n\n${text}\n\n${actionLabel}: ${actionUrl}\n\nينتهي هذا الرابط خلال 30 دقيقة ولا يمكن استخدامه أكثر من مرة.`,
  })
  if (error || !data?.id) {
    console.error('[email:delivery]', error?.name || 'missing_provider_message_id')
    throw new Error('Email delivery failed')
  }
  return data.id
}
