import { createHash } from 'node:crypto'
export { normalizeEmail } from '@/lib/normalization'

const SECRET_PATTERN = /((?:password|token|secret|authorization|cookie)\s*[=:]\s*)([^\s,;}]+)/gi
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi

export function redactSensitive(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(SECRET_PATTERN, '$1[REDACTED]').replace(BEARER_PATTERN, 'Bearer [REDACTED]')
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactSensitive(value.message) }
  }
  if (Array.isArray(value)) return value.map(redactSensitive)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        /password|token|secret|authorization|cookie/i.test(key) ? '[REDACTED]' : redactSensitive(item),
      ]),
    )
  }
  return value
}

export function hashSecurityIdentifier(value: string) {
  const pepper = process.env.BETTER_AUTH_SECRET
  if (!pepper) throw new Error('BETTER_AUTH_SECRET is required for security hashing.')
  return createHash('sha256').update(`${pepper}:${value}`).digest('hex')
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function splitGraphemes(value: string, locale: 'ar' | 'en') {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(value)].map(
      (part) => part.segment,
    )
  }
  return Array.from(value)
}

export function safeExternalUrl(value: string, appOrigin: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed, appOrigin)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    if (
      process.env.NODE_ENV === 'production' &&
      url.protocol !== 'https:' &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    )
      return null
    return trimmed.startsWith('/') ? `${url.pathname}${url.search}${url.hash}` : url.toString()
  } catch {
    return null
  }
}

export type SafeImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
export type SafeMediaType =
  | SafeImageType
  | 'application/pdf'
  | 'audio/mpeg'
  | 'audio/wav'
  | 'video/mp4'
  | 'video/webm'

export function detectSafeImageType(bytes: Uint8Array): SafeImageType | null {
  if (
    bytes.length >= 8 &&
    bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])
  )
    return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp'
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(new TextDecoder().decode(bytes.slice(0, 6))))
    return 'image/gif'
  return null
}

export function detectSafeMediaType(bytes: Uint8Array): SafeMediaType | null {
  const image = detectSafeImageType(bytes)
  if (image) return image
  const text = new TextDecoder('latin1').decode(bytes.slice(0, 16))
  if (bytes.length >= 5 && text.startsWith('%PDF-')) return 'application/pdf'
  if (bytes.length >= 3 && (text.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)))
    return 'audio/mpeg'
  if (bytes.length >= 12 && text.slice(0, 4) === 'RIFF' && text.slice(8, 12) === 'WAVE') return 'audio/wav'
  if (bytes.length >= 12 && text.slice(4, 8) === 'ftyp') return 'video/mp4'
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return 'video/webm'
  return null
}
