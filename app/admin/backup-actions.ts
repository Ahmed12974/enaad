'use server'

import { createHash, createHmac } from 'node:crypto'
import { del, get, list, put } from '@vercel/blob'
import { Resend } from 'resend'
import { and, eq, inArray, lt } from 'drizzle-orm'
import { getAuditRequestContext, writeAdminAudit } from '@/lib/admin-audit'
import { requirePermission } from '@/lib/auth-session'
import { BACKUP_FILENAME_PREFIX, SITE_NAME } from '@/lib/brand'
import { db } from '@/lib/db'
import { getPublicAppUrl } from '@/lib/runtime-config'
import { consumeRateLimit } from '@/lib/rate-limit'
import { isUniqueViolation } from '@/lib/utils'
import { assertBackupEncryptionSecret, encryptBackupPayload } from '@/lib/backup-crypto'
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  verifyBackupArchive,
} from '@/lib/backup-verification'
import { createZipArchive } from '@/lib/zip-archive'
import {
  account,
  achievements,
  backupJobs,
  adminAllowlist,
  adminNotes,
  auditLogs,
  badges,
  banners,
  categories,
  certificates,
  challengeModeration,
  challengeParticipants,
  challengeResults,
  challengeSettings,
  challenges,
  competitionCategories,
  competitionMathSections,
  competitionParticipants,
  competitionQuestions,
  competitions,
  contentPrerequisites,
  educationalSections,
  encouragementMessages,
  examples,
  levels,
  mathAttemptQuestions,
  mathAttempts,
  mathQuestions,
  mathSections,
  media,
  platformSettings,
  promotionRuleExecutions,
  promotionRules,
  rewardLedger,
  sectionContents,
  sentences,
  siteContent,
  siteContentVersions,
  testAnswers,
  tests,
  user,
  userAchievements,
  userActivities,
  userAdminProfiles,
  userBadges,
  userContentProgress,
  userProgress,
  wordQuizAttempts,
  wordQuizQuestions,
  words,
} from '@/lib/db/schema'

const MAX_EMAIL_ARCHIVE_BYTES = 25 * 1024 * 1024
const MAX_FULL_BACKUP_SOURCE_BYTES = 60 * 1024 * 1024
const DOWNLOAD_LINK_TTL_SECONDS = 7 * 24 * 60 * 60

async function requireBackupAdmin() {
  return requirePermission('backups:write')
}

function sha256(data: Buffer | string) {
  return createHash('sha256').update(data).digest('hex')
}

const PUBLIC_OR_TEST_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
])

function validEmailFrom(value: string | undefined) {
  const normalized = value?.trim()
  if (!normalized) return null
  if (
    !/^(?:[^<>]+\s*)?<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$|^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(
      normalized,
    )
  ) {
    return null
  }

  const address = normalized.match(/<([^<>]+)>$/)?.[1] ?? normalized
  const domain = address.split('@')[1]?.toLowerCase()
  if (!domain || PUBLIC_OR_TEST_EMAIL_DOMAINS.has(domain)) return null
  return normalized
}


function backupDateStamp(date: Date) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

async function loadDatabaseData() {
  const [
    users,
    allowlistRows,
    levelRows,
    adminProfileRows,
    mediaRows,
    educationalSectionRows,
    sectionContentRows,
    prerequisiteRows,
    contentProgressRows,
    categoryRows,
    wordRows,
    sentenceRows,
    wordAttemptRows,
    wordQuestionRows,
    testRows,
    answerRows,
    exampleRows,
    progressRows,
    rewardRows,
    achievementRows,
    earnedAchievementRows,
    badgeRows,
    userBadgeRows,
    promotionRuleRows,
    promotionExecutionRows,
    challengeRows,
    challengeParticipantRows,
    challengeSettingRows,
    challengeResultRows,
    challengeModerationRows,
    certificateRows,
    bannerRows,
    messageRows,
    mathSectionRows,
    mathQuestionRows,
    mathAttemptRows,
    mathAttemptQuestionRows,
    competitionRows,
    competitionCategoryRows,
    competitionMathSectionRows,
    competitionParticipantRows,
    competitionQuestionRows,
    siteContentRows,
    siteContentVersionRows,
    platformSettingRows,
    userActivityRows,
    adminNoteRows,
    auditRows,
  ] = await Promise.all([
    db.select().from(user),
    db.select().from(adminAllowlist),
    db.select().from(levels),
    db.select().from(userAdminProfiles),
    db.select().from(media),
    db.select().from(educationalSections),
    db.select().from(sectionContents),
    db.select().from(contentPrerequisites),
    db.select().from(userContentProgress),
    db.select().from(categories),
    db.select().from(words),
    db.select().from(sentences),
    db.select().from(wordQuizAttempts),
    db.select().from(wordQuizQuestions),
    db.select().from(tests),
    db.select().from(testAnswers),
    db.select().from(examples),
    db.select().from(userProgress),
    db.select().from(rewardLedger),
    db.select().from(achievements),
    db.select().from(userAchievements),
    db.select().from(badges),
    db.select().from(userBadges),
    db.select().from(promotionRules),
    db.select().from(promotionRuleExecutions),
    db.select().from(challenges),
    db.select().from(challengeParticipants),
    db.select().from(challengeSettings),
    db.select().from(challengeResults),
    db.select().from(challengeModeration),
    db.select().from(certificates),
    db.select().from(banners),
    db.select().from(encouragementMessages),
    db.select().from(mathSections),
    db.select().from(mathQuestions),
    db.select().from(mathAttempts),
    db.select().from(mathAttemptQuestions),
    db.select().from(competitions),
    db.select().from(competitionCategories),
    db.select().from(competitionMathSections),
    db.select().from(competitionParticipants),
    db.select().from(competitionQuestions),
    db.select().from(siteContent),
    db.select().from(siteContentVersions),
    db.select().from(platformSettings),
    db.select().from(userActivities),
    db.select().from(adminNotes),
    db.select().from(auditLogs),
  ])

  return {
    user: users,
    adminAllowlist: allowlistRows,
    levels: levelRows,
    userAdminProfiles: adminProfileRows,
    media: mediaRows,
    educationalSections: educationalSectionRows,
    sectionContents: sectionContentRows,
    contentPrerequisites: prerequisiteRows,
    userContentProgress: contentProgressRows,
    categories: categoryRows,
    words: wordRows,
    sentences: sentenceRows,
    wordQuizAttempts: wordAttemptRows,
    wordQuizQuestions: wordQuestionRows,
    tests: testRows,
    testAnswers: answerRows,
    examples: exampleRows,
    userProgress: progressRows,
    rewardLedger: rewardRows,
    achievements: achievementRows,
    userAchievements: earnedAchievementRows,
    badges: badgeRows,
    userBadges: userBadgeRows,
    promotionRules: promotionRuleRows,
    promotionRuleExecutions: promotionExecutionRows,
    challenges: challengeRows,
    challengeParticipants: challengeParticipantRows,
    challengeSettings: challengeSettingRows,
    challengeResults: challengeResultRows,
    challengeModeration: challengeModerationRows,
    certificates: certificateRows,
    banners: bannerRows,
    encouragementMessages: messageRows,
    mathSections: mathSectionRows,
    mathQuestions: mathQuestionRows,
    mathAttempts: mathAttemptRows,
    mathAttemptQuestions: mathAttemptQuestionRows,
    competitions: competitionRows,
    competitionCategories: competitionCategoryRows,
    competitionMathSections: competitionMathSectionRows,
    competitionParticipants: competitionParticipantRows,
    competitionQuestions: competitionQuestionRows,
    siteContent: siteContentRows,
    siteContentVersions: siteContentVersionRows,
    platformSettings: platformSettingRows,
    userActivities: userActivityRows,
    adminNotes: adminNoteRows,
    auditLogs: auditRows,
  }
}

type BlobListItem = Awaited<ReturnType<typeof list>>['blobs'][number]

async function listSiteBlobs(token: string) {
  const blobs: BlobListItem[] = []
  let cursor: string | undefined
  do {
    const page = await list({ token, cursor, limit: 1000 })
    blobs.push(...page.blobs.filter((blob) => !blob.pathname.startsWith('backups/')))
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return blobs
}

async function beginBackupJob(
  actor: Awaited<ReturnType<typeof requireBackupAdmin>>,
  delivery: 'download' | 'email-attachment',
  recipient: string | null,
) {
  const limit = await consumeRateLimit(`backup:create:${actor.id}`, 3, 60 * 60)
  if (!limit.allowed)
    throw new Error(`تم الوصول إلى الحد الآمن لإنشاء النسخ. أعد المحاولة بعد ${limit.retryAfter} ثانية.`)

  const staleBefore = new Date(Date.now() - 30 * 60 * 1_000)
  await db
    .update(backupJobs)
    .set({
      status: 'failed',
      errorMessage: 'انتهت مهلة عملية نسخ سابقة قبل اكتمالها.',
      completedAt: new Date(),
    })
    .where(
      and(
        eq(backupJobs.requestedBy, actor.id),
        inArray(backupJobs.status, ['queued', 'running']),
        lt(backupJobs.startedAt, staleBefore),
      ),
    )

  try {
    const [job] = await db
      .insert(backupJobs)
      .values({ requestedBy: actor.id, status: 'running', delivery, recipient })
      .returning({ id: backupJobs.id })
    if (!job) throw new Error('تعذر تسجيل عملية النسخ الاحتياطي.')
    return job.id
  } catch (error) {
    if (isUniqueViolation(error))
      throw new Error('توجد نسخة احتياطية قيد الإنشاء بالفعل. انتظر اكتمالها ثم أعد المحاولة.')
    throw error
  }
}

async function finishBackupJob(
  jobId: string,
  values: {
    delivery: 'download' | 'email-attachment' | 'email-link'
    filename: string
    blobPathname?: string
    recordCount: number
    blobCount: number
    sizeBytes: number
    manifest: Record<string, unknown>
  },
) {
  await db
    .update(backupJobs)
    .set({
      status: 'completed',
      delivery: values.delivery,
      filename: values.filename,
      blobPathname: values.blobPathname ?? null,
      recordCount: values.recordCount,
      blobCount: values.blobCount,
      sizeBytes: values.sizeBytes,
      manifest: values.manifest,
      errorMessage: null,
      completedAt: new Date(),
    })
    .where(eq(backupJobs.id, jobId))
}

async function failBackupJob(jobId: string, error: unknown) {
  await db
    .update(backupJobs)
    .set({
      status: 'failed',
      errorMessage: publicBackupError(error).slice(0, 2_000),
      completedAt: new Date(),
    })
    .where(eq(backupJobs.id, jobId))
}

function backupRecipient(actorEmail: string) {
  const recipient = process.env.BACKUP_RECIPIENT_EMAIL?.trim() || actorEmail.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))
    throw new Error('BACKUP_RECIPIENT_EMAIL غير صالح، كما أن بريد حساب المدير لا يصلح للاستقبال.')
  return recipient.toLowerCase()
}

function publicBackupError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const allowed = [
    'BLOB_READ_WRITE_TOKEN',
    'BETTER_AUTH_SECRET',
    'BACKUP_RECIPIENT_EMAIL',
    'BACKUP_ENCRYPTION_SECRET',
    'RESEND_API_KEY',
    'EMAIL_FROM',
    'توجد نسخة احتياطية',
    'تم الوصول إلى الحد الآمن',
    'حجم البيانات والملفات',
    'تعذر قراءة ملف التخزين',
    'حجم ملف التخزين غير مطابق',
    'فشل فحص سلامة',
  ]
  return allowed.some((text) => message.includes(text))
    ? message
    : 'تعذر إكمال النسخة الاحتياطية. راجع سجل الإدارة وسجلات الخادم لمعرفة السبب.'
}

async function buildFullBackup(
  actor: Awaited<ReturnType<typeof requireBackupAdmin>>,
  recipient: string,
) {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN غير مهيأ؛ لا يمكن تضمين ملفات الموقع في النسخة التشغيلية.')
  }

  const encryptionSecret = assertBackupEncryptionSecret(process.env.BACKUP_ENCRYPTION_SECRET)
  const generatedAt = new Date()
  const [database, credentialRows] = await Promise.all([
    loadDatabaseData(),
    db
      .select({
        id: account.id,
        accountId: account.accountId,
        providerId: account.providerId,
        userId: account.userId,
        password: account.password,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      })
      .from(account),
  ])
  const counts = Object.fromEntries(
    Object.entries(database).map(([name, rows]) => [name, rows.length]),
  )
  const records = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const databaseObject = {
    metadata: {
      platform: SITE_NAME,
      generatedAt: generatedAt.toISOString(),
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      sourceCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      excludedForSecurity: [
        'account credentials and password hashes from database.json (stored separately in encrypted form)',
        'sessions',
        'verification tokens',
        'rate-limit counters',
        'recovery tokens',
        'backup job runtime state',
        'environment secrets',
      ],
      tableCounts: counts,
    },
    data: database,
  }
  const databaseFile = Buffer.from(JSON.stringify(databaseObject, null, 2), 'utf8')
  const encryptedCredentialsFile = Buffer.from(
    JSON.stringify(
      encryptBackupPayload(
        { generatedAt: generatedAt.toISOString(), accounts: credentialRows },
        encryptionSecret,
      ),
      null,
      2,
    ),
    'utf8',
  )

  const blobList = await listSiteBlobs(token)
  const blobSourceBytes = blobList.reduce((sum, blob) => sum + blob.size, 0)
  const estimatedBytes = databaseFile.byteLength + encryptedCredentialsFile.byteLength + blobSourceBytes
  if (estimatedBytes > MAX_FULL_BACKUP_SOURCE_BYTES) {
    throw new Error(
      `حجم البيانات والملفات أكبر من الحد الآمن للنسخة اليدوية (${Math.ceil(estimatedBytes / 1024 / 1024)} MB).`,
    )
  }

  const blobEntries: Array<{ name: string; data: Buffer; modifiedAt: Date }> = []
  const blobManifest: Array<{
    archivePath: string
    pathname: string
    sizeBytes: number
    uploadedAt: string
    contentType: string
    sha256: string
  }> = []
  for (const blob of blobList) {
    const result = await get(blob.pathname, { access: 'private', token })
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new Error(`تعذر قراءة ملف التخزين: ${blob.pathname}`)
    }

    const content = Buffer.from(await new Response(result.stream).arrayBuffer())
    if (content.byteLength !== blob.size) {
      throw new Error(`حجم ملف التخزين غير مطابق: ${blob.pathname}`)
    }
    const archivePath = `blobs/${blob.pathname}`
    blobEntries.push({ name: archivePath, data: content, modifiedAt: blob.uploadedAt })
    blobManifest.push({
      archivePath,
      pathname: blob.pathname,
      sizeBytes: blob.size,
      uploadedAt: blob.uploadedAt.toISOString(),
      contentType: result.blob.contentType,
      sha256: sha256(content),
    })
  }

  const restoreGuide = Buffer.from(
    [
      `# استعادة نسخة ${SITE_NAME}`,
      '',
      'هذه نسخة تشغيلية لبيانات المنصة وملفات Vercel Blob وليست نسخة من مستودع الكود.',
      '',
      '## قبل الاستعادة',
      '- استخدم قاعدة بيانات PostgreSQL فارغة أو بيئة اختبار معزولة.',
      '- شغّل migrations حتى الإصدار المذكور في manifest.json.',
      '- افحص بصمات SHA-256 والأعداد قبل أي إدخال.',
      '- لا تستعد البيانات فوق الإنتاج مباشرة دون نسخة إضافية وخطة رجوع.',
      '',
      '## المحتويات',
      '- database.json: الجداول القابلة للاستعادة وأعدادها الحقيقية.',
      '- auth-credentials.enc.json: بيانات اعتماد Better Auth مشفرة بـ AES-256-GCM ولا تُفتح دون BACKUP_ENCRYPTION_SECRET.',
      '- manifest.json: الإصدار والأعداد والأحجام والبصمات.',
      '- blobs/: ملفات التخزين بالمسارات الأصلية عند وجودها.',
      '',
      '## قيود أمنية مقصودة',
      'لا تتضمن النسخة جلسات الدخول أو رموز التحقق والاسترداد أو مفاتيح البيئة أو رموز OAuth.',
      'تُحفظ تجزئات كلمات المرور اللازمة للاستعادة داخل ملف مشفر مستقل ولا تظهر كنص صريح.',
      '',
      'يمكن تشغيل scripts/restore-backup.ts من نسخة الكود المطابقة بعد مراجعة الخيارات والتعليمات.',
    ].join('\n'),
    'utf8',
  )

  const integrityFiles = [
    {
      path: 'database.json',
      sizeBytes: databaseFile.byteLength,
      sha256: sha256(databaseFile),
    },
    {
      path: 'auth-credentials.enc.json',
      sizeBytes: encryptedCredentialsFile.byteLength,
      sha256: sha256(encryptedCredentialsFile),
    },
    {
      path: 'RESTORE_AR.md',
      sizeBytes: restoreGuide.byteLength,
      sha256: sha256(restoreGuide),
    },
    ...blobManifest.map((blob) => ({
      path: blob.archivePath,
      sizeBytes: blob.sizeBytes,
      sha256: blob.sha256,
    })),
  ]
  const manifestObject: Record<string, unknown> = {
    platform: SITE_NAME,
    generatedAt: generatedAt.toISOString(),
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    sourceCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    recipient,
    database: {
      filename: 'database.json',
      tableCounts: counts,
      records,
      sizeBytes: databaseFile.byteLength,
      sha256: sha256(databaseFile),
    },
    encryptedCredentials: {
      filename: 'auth-credentials.enc.json',
      accountCount: credentialRows.length,
      algorithm: 'AES-256-GCM',
      sha256: sha256(encryptedCredentialsFile),
    },
    blobs: {
      count: blobManifest.length,
      totalBytes: blobManifest.reduce((sum, item) => sum + item.sizeBytes, 0),
      files: blobManifest,
    },
    files: integrityFiles,
    integrity: {
      algorithm: 'SHA-256',
      zipEntriesVerified: true,
      expectedZipEntries: 4 + blobEntries.length,
    },
    securityExclusions: databaseObject.metadata.excludedForSecurity,
  }
  const manifest = Buffer.from(JSON.stringify(manifestObject, null, 2), 'utf8')
  const filename = `${BACKUP_FILENAME_PREFIX}-${backupDateStamp(generatedAt)}.zip`
  const archive = createZipArchive([
    { name: 'database.json', data: databaseFile, modifiedAt: generatedAt },
    { name: 'manifest.json', data: manifest, modifiedAt: generatedAt },
    { name: 'auth-credentials.enc.json', data: encryptedCredentialsFile, modifiedAt: generatedAt },
    { name: 'RESTORE_AR.md', data: restoreGuide, modifiedAt: generatedAt },
    ...blobEntries,
  ])
  const verification = verifyBackupArchive(archive)
  if (verification.records !== records || verification.blobCount !== blobEntries.length) {
    throw new Error('فشل فحص سلامة بيانات النسخة الاحتياطية بعد إنشاء ZIP.')
  }

  return {
    actor,
    archive,
    archiveSha256: sha256(archive),
    filename,
    generatedAt,
    records,
    counts,
    blobCount: blobEntries.length,
    token,
    manifest: manifestObject,
  }
}

function signedDownloadUrl(pathname: string, expires: number) {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32) throw new Error('BETTER_AUTH_SECRET غير صالح لتوقيع رابط النسخة.')
  const signature = createHmac('sha256', secret).update(`${pathname}\n${expires}`).digest('hex')
  const url = new URL('/api/backup-download', getPublicAppUrl())
  url.searchParams.set('pathname', pathname)
  url.searchParams.set('expires', String(expires))
  url.searchParams.set('signature', signature)
  return url.toString()
}

async function cleanupStoredBackup(pathname: string | undefined, token: string | undefined) {
  if (!pathname || !token) return
  try {
    await del(pathname, { token })
  } catch (error) {
    console.error('[backup:storage-cleanup]', {
      pathname,
      error: error instanceof Error ? error.message : 'unknown cleanup error',
    })
  }
}

export async function createBackupDownload() {
  const actor = await requireBackupAdmin()
  const recipient = backupRecipient(actor.email)
  const jobId = await beginBackupJob(actor, 'download', recipient)
  const context = await getAuditRequestContext()
  let storedPathname: string | undefined
  let storageToken: string | undefined
  try {
    const backup = await buildFullBackup(actor, recipient)
    storageToken = backup.token
    const stored = await put(`backups/${backup.filename}`, backup.archive, {
      access: 'private',
      addRandomSuffix: true,
      token: backup.token,
      contentType: 'application/zip',
    })
    storedPathname = stored.pathname
    const expires = Math.floor(Date.now() / 1000) + DOWNLOAD_LINK_TTL_SECONDS
    const downloadUrl = signedDownloadUrl(stored.pathname, expires)
    await finishBackupJob(jobId, {
      delivery: 'download',
      filename: backup.filename,
      blobPathname: stored.pathname,
      recordCount: backup.records,
      blobCount: backup.blobCount,
      sizeBytes: backup.archive.byteLength,
      manifest: { ...backup.manifest, archiveSha256: backup.archiveSha256 },
    })
    await db.transaction((tx) =>
      writeAdminAudit(
        tx,
        {
          actorUserId: backup.actor.id,
          action: 'backup.generate',
          entityType: 'backup',
          entityId: jobId,
          after: {
            filename: backup.filename,
            records: backup.records,
            blobCount: backup.blobCount,
            sizeBytes: backup.archive.byteLength,
            archiveSha256: backup.archiveSha256,
            storedPathname: stored.pathname,
          },
          reason: 'Manual operational backup generated and integrity-checked.',
        },
        context,
      ),
    )
    return {
      ok: true,
      message: 'تم إنشاء نسخة البيانات والملفات التشغيلية وفحص سلامتها.',
      filename: backup.filename,
      downloadUrl,
      records: backup.records,
      blobCount: backup.blobCount,
    }
  } catch (error) {
    await cleanupStoredBackup(storedPathname, storageToken)
    try {
      await failBackupJob(jobId, error)
    } catch (jobError) {
      console.error('[backup:job-failure-update]', jobError)
    }
    console.error('[backup:download]', error)
    return { ok: false, message: publicBackupError(error), records: 0, blobCount: 0 }
  }
}

export async function createAndEmailBackup() {
  const actor = await requireBackupAdmin()
  const recipient = backupRecipient(actor.email)
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = validEmailFrom(process.env.EMAIL_FROM)
  if (!apiKey) return { ok: false, message: 'RESEND_API_KEY غير مهيأ.', records: 0, blobCount: 0 }
  if (!from)
    return {
      ok: false,
      message:
        'EMAIL_FROM يجب أن يكون عنوانًا صالحًا في Resend. استخدم onboarding@resend.dev للاختبار إلى بريد حساب Resend فقط، أو نطاقًا موثّقًا للإرسال العام.',
      records: 0,
      blobCount: 0,
    }

  const jobId = await beginBackupJob(actor, 'email-attachment', recipient)
  const context = await getAuditRequestContext()
  let attachment: { filename: string; content: Buffer } | undefined
  let downloadUrl: string | undefined
  let storedPathname: string | undefined
  let storageToken: string | undefined
  try {
    const backup = await buildFullBackup(actor, recipient)
    storageToken = backup.token
    let delivery: 'email-attachment' | 'email-link' = 'email-attachment'
    if (backup.archive.byteLength <= MAX_EMAIL_ARCHIVE_BYTES) {
      attachment = { filename: backup.filename, content: backup.archive }
    } else {
      delivery = 'email-link'
      const stored = await put(`backups/${backup.filename}`, backup.archive, {
        access: 'private',
        addRandomSuffix: true,
        token: backup.token,
        contentType: 'application/zip',
      })
      storedPathname = stored.pathname
      const expires = Math.floor(Date.now() / 1000) + DOWNLOAD_LINK_TTL_SECONDS
      downloadUrl = signedDownloadUrl(stored.pathname, expires)
    }

    const { data, error } = await new Resend(apiKey).emails.send({
      from,
      to: recipient,
      subject: `نسخة بيانات وملفات تشغيلية — ${SITE_NAME} — ${backup.generatedAt.toLocaleDateString('ar-EG')}`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:680px;margin:auto;padding:32px;color:#173d34"><h1>نسخة تشغيلية من ${SITE_NAME}</h1><p>اكتمل إنشاء النسخة وفحص ZIP وبصمات الملفات.</p><p><b>السجلات:</b> ${backup.records.toLocaleString('ar-EG')}<br><b>ملفات التخزين:</b> ${backup.blobCount.toLocaleString('ar-EG')}<br><b>الحجم:</b> ${(backup.archive.byteLength / 1024 / 1024).toFixed(2)} MB<br><b>تاريخ الإنشاء:</b> ${backup.generatedAt.toLocaleString('ar-EG')}<br><b>SHA-256:</b> <code>${backup.archiveSha256}</code></p>${downloadUrl ? `<p><a href="${downloadUrl.replaceAll('&', '&amp;')}" style="display:inline-block;padding:12px 18px;background:#123c32;color:#fff;text-decoration:none;border-radius:10px">تنزيل النسخة</a></p><p style="color:#6c7b74">الرابط صالح لمدة 7 أيام.</p>` : '<p>النسخة مرفقة مع هذه الرسالة بصيغة ZIP.</p>'}<p style="color:#6c7b74">لا تتضمن النسخة كلمات مرور صريحة أو جلسات أو رموز تحقق واسترداد أو مفاتيح بيئة. تُحفظ تجزئات كلمات المرور اللازمة للاستعادة داخل ملف مستقل مشفر.</p></div>`,
      text: `نسخة تشغيلية من ${SITE_NAME}\nالسجلات: ${backup.records}\nملفات التخزين: ${backup.blobCount}\nالحجم: ${backup.archive.byteLength} bytes\nSHA-256: ${backup.archiveSha256}\nتاريخ الإنشاء: ${backup.generatedAt.toISOString()}${downloadUrl ? `\nرابط التنزيل صالح 7 أيام: ${downloadUrl}` : '\nالنسخة مرفقة بصيغة ZIP.'}`,
      attachments: attachment ? [attachment] : undefined,
    })
    if (error || !data?.id) throw new Error(error?.message ?? 'لم تُرجع خدمة البريد رقم تتبع.')

    try {
      await finishBackupJob(jobId, {
        delivery,
        filename: backup.filename,
        blobPathname: storedPathname,
        recordCount: backup.records,
        blobCount: backup.blobCount,
        sizeBytes: backup.archive.byteLength,
        manifest: { ...backup.manifest, archiveSha256: backup.archiveSha256, emailId: data.id },
      })
      await db.transaction((tx) =>
        writeAdminAudit(
          tx,
          {
            actorUserId: backup.actor.id,
            action: 'backup.email.success',
            entityType: 'backup',
            entityId: jobId,
            after: {
              filename: backup.filename,
              records: backup.records,
              blobCount: backup.blobCount,
              sizeBytes: backup.archive.byteLength,
              recipient,
              delivery,
              storedPathname,
              emailId: data.id,
              archiveSha256: backup.archiveSha256,
            },
            reason: 'Integrity-checked operational backup delivered by email.',
          },
          context,
        ),
      )
    } catch (bookkeepingError) {
      // Resend already accepted the message. Do not return a false delivery
      // failure or delete a link that may already be in the recipient's inbox.
      console.error('[backup:email-bookkeeping]', bookkeepingError)
      return {
        ok: true,
        message: `قبلت خدمة البريد إرسال النسخة إلى ${recipient}، لكن تعذر تحديث سجل العملية الداخلي.`,
        records: backup.records,
        blobCount: backup.blobCount,
      }
    }

    return {
      ok: true,
      message: `تم إرسال النسخة التشغيلية إلى ${recipient}.`,
      records: backup.records,
      blobCount: backup.blobCount,
    }
  } catch (error) {
    await cleanupStoredBackup(storedPathname, storageToken)
    try {
      await failBackupJob(jobId, error)
    } catch (jobError) {
      console.error('[backup:job-failure-update]', jobError)
    }
    console.error('[backup:email]', error)
    try {
      await db.transaction((tx) =>
        writeAdminAudit(
          tx,
          {
            actorUserId: actor.id,
            action: 'backup.email.failure',
            entityType: 'backup',
            entityId: jobId,
            after: { recipient, storedPathname },
            reason: 'Operational backup generation or email delivery failed.',
            outcome: 'failure',
            errorCode: 'BACKUP_EMAIL_FAILED',
          },
          context,
        ),
      )
    } catch (auditError) {
      console.error('[backup:failure-audit]', auditError)
    }
    return { ok: false, message: publicBackupError(error), records: 0, blobCount: 0 }
  }
}
