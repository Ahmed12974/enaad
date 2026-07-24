import { createHash } from 'node:crypto'
import { readZipArchive } from '@/lib/zip-archive'

export const BACKUP_FORMAT_VERSION = 4 as const
export const BACKUP_SCHEMA_VERSION = '0017-branch-compatibility' as const

export const BACKUP_DATABASE_TABLES = [
  'user',
  'adminAllowlist',
  'levels',
  'userAdminProfiles',
  'media',
  'educationalSections',
  'sectionContents',
  'contentPrerequisites',
  'userContentProgress',
  'categories',
  'words',
  'sentences',
  'wordQuizAttempts',
  'wordQuizQuestions',
  'tests',
  'testAnswers',
  'examples',
  'userProgress',
  'rewardLedger',
  'achievements',
  'userAchievements',
  'badges',
  'userBadges',
  'promotionRules',
  'promotionRuleExecutions',
  'challenges',
  'challengeParticipants',
  'challengeSettings',
  'challengeResults',
  'challengeModeration',
  'certificates',
  'banners',
  'encouragementMessages',
  'mathSections',
  'mathQuestions',
  'mathAttempts',
  'mathAttemptQuestions',
  'competitions',
  'competitionCategories',
  'competitionMathSections',
  'competitionParticipants',
  'competitionQuestions',
  'siteContent',
  'siteContentVersions',
  'platformSettings',
  'userActivities',
  'adminNotes',
  'auditLogs',
] as const

type IntegrityFile = {
  path: string
  sizeBytes: number
  sha256: string
}

type BackupManifest = {
  formatVersion?: number
  schemaVersion?: string
  database?: {
    filename?: string
    tableCounts?: Record<string, number>
    records?: number
    sizeBytes?: number
    sha256?: string
  }
  encryptedCredentials?: {
    filename?: string
    accountCount?: number
    algorithm?: string
    sha256?: string
  }
  blobs?: {
    count?: number
    totalBytes?: number
    files?: Array<IntegrityFile & { archivePath?: string; pathname?: string }>
  }
  files?: IntegrityFile[]
  integrity?: {
    algorithm?: string
    zipEntriesVerified?: boolean
    expectedZipEntries?: number
  }
}

type BackupDatabase = {
  metadata?: {
    schemaVersion?: string
    tableCounts?: Record<string, number>
  }
  data?: Record<string, unknown[]>
}

const forbiddenDatabaseTables = new Set([
  'account',
  'session',
  'verification',
  'rateLimit',
  'recoveryTokens',
  'backupJobs',
])

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function parseJson<T>(value: Buffer, filename: string): T {
  try {
    return JSON.parse(value.toString('utf8')) as T
  } catch {
    throw new Error(`تعذر قراءة JSON داخل ${filename}.`)
  }
}

function equalCounts(left: Record<string, number>, right: Record<string, number>) {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
  )
}

/**
 * Performs a restore-oriented verification of the completed ZIP. It validates
 * decompression/CRC, manifest hashes, table counts, blob counts and the
 * intentional exclusion of live sessions and plaintext authentication data.
 */
export function verifyBackupArchive(archive: Buffer) {
  const parsed = readZipArchive(archive)
  const manifestFile = parsed.files.get('manifest.json')
  const databaseFile = parsed.files.get('database.json')
  const credentialsFile = parsed.files.get('auth-credentials.enc.json')
  const restoreGuide = parsed.files.get('RESTORE_AR.md')
  if (!manifestFile || !databaseFile || !credentialsFile || !restoreGuide) {
    throw new Error('النسخة لا تحتوي ملفات الاستعادة الأساسية الأربعة.')
  }

  const manifest = parseJson<BackupManifest>(manifestFile, 'manifest.json')
  const database = parseJson<BackupDatabase>(databaseFile, 'database.json')
  if (
    manifest.formatVersion !== BACKUP_FORMAT_VERSION ||
    manifest.schemaVersion !== BACKUP_SCHEMA_VERSION
  ) {
    throw new Error('إصدار النسخة أو مخطط قاعدة البيانات غير صالح.')
  }
  if (
    manifest.integrity?.algorithm !== 'SHA-256' ||
    manifest.integrity.zipEntriesVerified !== true ||
    manifest.integrity.expectedZipEntries !== parsed.entryCount
  ) {
    throw new Error('بيانات فحص سلامة ZIP في manifest غير متطابقة.')
  }

  const declaredFiles = manifest.files ?? []
  if (declaredFiles.length !== parsed.entryCount - 1) {
    throw new Error('عدد الملفات المعلنة في manifest لا يطابق محتوى ZIP.')
  }
  const declaredNames = new Set<string>()
  for (const expected of declaredFiles) {
    if (!expected.path || declaredNames.has(expected.path)) {
      throw new Error('manifest يحتوي اسم ملف فارغًا أو مكررًا.')
    }
    declaredNames.add(expected.path)
    const file = parsed.files.get(expected.path)
    if (!file) throw new Error(`ملف مفقود داخل النسخة: ${expected.path}`)
    if (file.byteLength !== expected.sizeBytes || sha256(file) !== expected.sha256) {
      throw new Error(`فشل SHA-256 أو الحجم للملف: ${expected.path}`)
    }
  }

  if (
    manifest.database?.filename !== 'database.json' ||
    manifest.database.sizeBytes !== databaseFile.byteLength ||
    manifest.database.sha256 !== sha256(databaseFile)
  ) {
    throw new Error('بيانات database.json في manifest غير صحيحة.')
  }
  if (
    manifest.encryptedCredentials?.filename !== 'auth-credentials.enc.json' ||
    manifest.encryptedCredentials.algorithm !== 'AES-256-GCM' ||
    manifest.encryptedCredentials.sha256 !== sha256(credentialsFile)
  ) {
    throw new Error('بيانات ملف اعتماد المصادقة المشفر غير صحيحة.')
  }

  if (restoreGuide.byteLength === 0 || databaseFile.byteLength === 0 || credentialsFile.byteLength === 0) {
    throw new Error('أحد ملفات النسخة الأساسية فارغ.')
  }

  const data = database.data ?? {}
  const allowedDatabaseTables = new Set<string>(BACKUP_DATABASE_TABLES)
  for (const table of BACKUP_DATABASE_TABLES) {
    if (!Object.hasOwn(data, table)) throw new Error(`جدول تشغيلي مفقود من database.json: ${table}`)
  }
  for (const table of Object.keys(data)) {
    if (!allowedDatabaseTables.has(table)) {
      throw new Error(`جدول غير معروف موجود داخل database.json: ${table}`)
    }
  }
  for (const table of forbiddenDatabaseTables) {
    if (Object.hasOwn(data, table)) {
      throw new Error(`جدول أمني محظور موجود داخل database.json: ${table}`)
    }
  }
  const actualCounts = Object.fromEntries(
    Object.entries(data).map(([table, rows]) => {
      if (!Array.isArray(rows)) throw new Error(`بيانات الجدول ${table} ليست مصفوفة.`)
      return [table, rows.length]
    }),
  )
  if (database.metadata?.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new Error('إصدار مخطط database.json لا يطابق النسخة.')
  }
  const metadataCounts = database.metadata.tableCounts ?? {}
  const manifestCounts = manifest.database.tableCounts ?? {}
  if (!equalCounts(actualCounts, metadataCounts) || !equalCounts(actualCounts, manifestCounts)) {
    throw new Error('أعداد سجلات الجداول لا تطابق البيانات الفعلية.')
  }
  const records = Object.values(actualCounts).reduce((sum, count) => sum + count, 0)
  if (manifest.database.records !== records) {
    throw new Error('إجمالي سجلات قاعدة البيانات في manifest غير مطابق.')
  }

  const blobEntries = [...parsed.files.entries()].filter(([name]) => name.startsWith('blobs/'))
  const blobBytes = blobEntries.reduce((sum, [, value]) => sum + value.byteLength, 0)
  if (manifest.blobs?.count !== blobEntries.length || manifest.blobs.totalBytes !== blobBytes) {
    throw new Error('عدد ملفات Blob أو حجمها الإجمالي غير مطابق.')
  }
  const blobManifest = manifest.blobs.files ?? []
  if (blobManifest.length !== blobEntries.length) {
    throw new Error('قائمة ملفات Blob في manifest غير مكتملة.')
  }
  const declaredBlobPaths = new Set<string>()
  const declaredBlobNames = new Set<string>()
  for (const blob of blobManifest) {
    const archivePath = blob.archivePath ?? blob.path
    if (
      declaredBlobPaths.has(archivePath) ||
      !blob.pathname ||
      declaredBlobNames.has(blob.pathname)
    ) {
      throw new Error('manifest يحتوي مرجع Blob فارغًا أو مكررًا.')
    }
    declaredBlobPaths.add(archivePath)
    declaredBlobNames.add(blob.pathname)
    const file = parsed.files.get(archivePath)
    if (!archivePath.startsWith('blobs/') || !file) {
      throw new Error(`ملف Blob المعلن غير موجود: ${archivePath}`)
    }
    if (file.byteLength !== blob.sizeBytes || sha256(file) !== blob.sha256) {
      throw new Error(`فشل سلامة Blob: ${archivePath}`)
    }
  }

  return {
    entryCount: parsed.entryCount,
    records,
    tableCounts: actualCounts,
    blobCount: blobEntries.length,
    blobBytes,
    formatVersion: manifest.formatVersion,
    schemaVersion: manifest.schemaVersion,
  }
}
