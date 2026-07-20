import { platformSettings } from '@/lib/db/schema'

export const MAX_UPLOAD_MB = 10

export type GeneralPlatformSettings = {
  siteName: string
  siteDescription: string
  timezone: 'Africa/Cairo' | 'UTC' | 'Asia/Riyadh'
  defaultLanguage: 'ar' | 'en'
  arabicEnabled: boolean
  englishEnabled: boolean
  registrationEnabled: boolean
  maintenanceMode: boolean
  maxUploadMb: number
}

export const defaultPlatformSettings: GeneralPlatformSettings = {
  siteName: 'لُغتي',
  siteDescription:
    'منصة متكاملة لحفظ الكلمات والعبارات العربية والإنجليزية، الدراسة بالنطق، الاختبارات والتحديات.',
  timezone: 'Africa/Cairo',
  defaultLanguage: 'ar',
  arabicEnabled: true,
  englishEnabled: true,
  registrationEnabled: true,
  maintenanceMode: false,
  maxUploadMb: 5,
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

export function parsePlatformSettings(value: Record<string, unknown> | null | undefined) {
  if (!value) return defaultPlatformSettings
  const timezone = ['Africa/Cairo', 'UTC', 'Asia/Riyadh'].includes(String(value.timezone))
    ? (value.timezone as GeneralPlatformSettings['timezone'])
    : defaultPlatformSettings.timezone
  const defaultLanguage = value.defaultLanguage === 'en' ? 'en' : 'ar'
  const upload = Number(value.maxUploadMb)
  return {
    siteName:
      typeof value.siteName === 'string' && value.siteName.trim()
        ? value.siteName.trim().slice(0, 120)
        : defaultPlatformSettings.siteName,
    siteDescription:
      typeof value.siteDescription === 'string'
        ? value.siteDescription.trim().slice(0, 500)
        : defaultPlatformSettings.siteDescription,
    timezone,
    defaultLanguage,
    arabicEnabled: isBoolean(value.arabicEnabled) ? value.arabicEnabled : true,
    englishEnabled: isBoolean(value.englishEnabled) ? value.englishEnabled : true,
    registrationEnabled: isBoolean(value.registrationEnabled) ? value.registrationEnabled : true,
    maintenanceMode: isBoolean(value.maintenanceMode) ? value.maintenanceMode : false,
    maxUploadMb: Number.isInteger(upload) ? Math.min(MAX_UPLOAD_MB, Math.max(1, upload)) : 5,
  } satisfies GeneralPlatformSettings
}

export async function getPlatformSettings() {
  const [{ eq }, { db }] = await Promise.all([import('drizzle-orm'), import('@/lib/db')])
  const [record] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, 'general'))
    .limit(1)
  return parsePlatformSettings(record?.value)
}

export async function getPlatformSettingsSafe() {
  try {
    return await getPlatformSettings()
  } catch {
    return defaultPlatformSettings
  }
}
