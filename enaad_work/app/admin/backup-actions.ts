'use server'

import { createHash, createHmac } from 'node:crypto'
import { get, list, put } from '@vercel/blob'
import { Resend } from 'resend'
import { getAuditRequestContext, writeAdminAudit } from '@/lib/admin-audit'
import { requirePermission } from '@/lib/auth-session'
import { BACKUP_FILENAME_PREFIX, SITE_NAME } from '@/lib/brand'
import { db } from '@/lib/db'
import { SOLE_ADMIN_EMAIL } from '@/lib/admin-policy'
import { getPublicAppUrl } from '@/lib/runtime-config'
import { createZipArchive } from '@/lib/zip-archive'
import {
  achievements,
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

async function requireSoleAdmin() {
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
  'resend.dev',
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

async function buildFullBackup(actor = await requireSoleAdmin()) {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN غير مهيأ؛ لا يمكن تضمين ملفات الموقع في النسخة الكاملة.')
  }

  const generatedAt = new Date()
  const database = await loadDatabaseData()
  const counts = Object.fromEntries(
    Object.entries(database).map(([name, rows]) => [name, rows.length]),
  )
  const databaseFile = Buffer.from(
    JSON.stringify(
      {
        metadata: {
          platform: SITE_NAME,
          generatedAt: generatedAt.toISOString(),
          formatVersion: 3,
          sourceCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
          excludedForSecurity: [
            'account',
            'session',
            'verification',
            'rateLimit',
            'recoveryTokens',
            'environment secrets',
          ],
          tableCounts: counts,
        },
        data: database,
      },
      null,
      2,
    ),
    'utf8',
  )

  const blobList = await listSiteBlobs(token)
  const blobSourceBytes = blobList.reduce((sum, blob) => sum + blob.size, 0)
  const estimatedBytes = databaseFile.byteLength + blobSourceBytes
  if (estimatedBytes > MAX_FULL_BACKUP_SOURCE_BYTES) {
    throw new Error(
      `حجم البيانات والملفات أكبر من الحد الآمن للنسخة اليدوية (${Math.ceil(estimatedBytes / 1024 / 1024)} MB).`,
    )
  }

  const blobEntries: Array<{ name: string; data: Buffer; modifiedAt: Date }> = []
  const blobManifest: Array<Record<string, unknown>> = []
  for (const blob of blobList) {
    const result = await get(blob.pathname, { access: 'private', token })
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new Error(`تعذر قراءة ملف التخزين: ${blob.pathname}`)
    }

    const content = Buffer.from(await new Response(result.stream).arrayBuffer())
    if (content.byteLength !== blob.size) {
      throw new Error(`حجم ملف التخزين غير مطابق: ${blob.pathname}`)
    }

    blobEntries.push({
      name: `blobs/${blob.pathname}`,
      data: content,
      modifiedAt: blob.uploadedAt,
    })
    blobManifest.push({
      pathname: blob.pathname,
      size: blob.size,
      uploadedAt: blob.uploadedAt.toISOString(),
      contentType: result.blob.contentType,
      sha256: sha256(content),
    })
  }

  const records = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const manifest = Buffer.from(
    JSON.stringify(
      {
        platform: SITE_NAME,
        generatedAt: generatedAt.toISOString(),
        formatVersion: 3,
        recipient: SOLE_ADMIN_EMAIL,
        database: {
          filename: 'database.json',
          records,
          sha256: sha256(databaseFile),
        },
        blobs: blobManifest,
      },
      null,
      2,
    ),
    'utf8',
  )
  const restoreGuide = Buffer.from(
    [
      SITE_NAME,
      'نسخة تشغيلية كاملة من بيانات المنصة وملفات Vercel Blob.',
      '',
      'المحتويات:',
      '- database.json: بيانات الجداول القابلة للاستعادة مع استبعاد كلمات المرور والجلسات والرموز السرية.',
      '- manifest.json: عدد السجلات وبصمات SHA-256 للتحقق من سلامة النسخة.',
      '- blobs/: الملفات المخزنة في Vercel Blob بنفس المسارات الأصلية.',
      '',
      'لا تحتوي النسخة على مفاتيح البيئة أو كلمات المرور أو رموز الجلسات والاسترداد.',
      'ملفات الكود المصدرية محفوظة في مستودع GitHub ولا تُنسخ من بيئة التشغيل.',
    ].join('\n'),
    'utf8',
  )
  const filename = `${BACKUP_FILENAME_PREFIX}-${backupDateStamp(generatedAt)}.zip`
  const archive = createZipArchive([
    { name: 'database.json', data: databaseFile, modifiedAt: generatedAt },
    { name: 'manifest.json', data: manifest, modifiedAt: generatedAt },
    { name: 'RESTORE_AR.txt', data: restoreGuide, modifiedAt: generatedAt },
    ...blobEntries,
  ])

  return {
    actor,
    archive,
    filename,
    generatedAt,
    records,
    blobCount: blobEntries.length,
    token,
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

export async function createBackupDownload() {
  const actor = await requireSoleAdmin()
  const backup = await buildFullBackup(actor)
  const stored = await put(`backups/${backup.filename}`, backup.archive, {
    access: 'private',
    addRandomSuffix: true,
    token: backup.token,
    contentType: 'application/zip',
  })
  const expires = Math.floor(Date.now() / 1000) + DOWNLOAD_LINK_TTL_SECONDS
  const downloadUrl = signedDownloadUrl(stored.pathname, expires)
  const context = await getAuditRequestContext()
  await db.transaction((tx) =>
    writeAdminAudit(
      tx,
      {
        actorUserId: backup.actor.id,
        action: 'backup.generate',
        entityType: 'backup',
        entityId: backup.filename,
        after: {
          records: backup.records,
          blobCount: backup.blobCount,
          sizeBytes: backup.archive.byteLength,
          storedPathname: stored.pathname,
        },
        reason: 'Manual full administrative backup generated.',
      },
      context,
    ),
  )
  return {
    ok: true,
    message: 'تم إنشاء النسخة الكاملة وفتح رابط التنزيل الآمن.',
    filename: backup.filename,
    downloadUrl,
    records: backup.records,
    blobCount: backup.blobCount,
  }
}

export async function createAndEmailBackup() {
  const actor = await requireSoleAdmin()
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = validEmailFrom(process.env.EMAIL_FROM)
  if (!apiKey) return { ok: false, message: 'RESEND_API_KEY غير مهيأ.', records: 0 }
  if (!from)
    return {
      ok: false,
      message:
        'EMAIL_FROM يجب أن يكون عنوانًا من نطاقك الموثّق في Resend، وليس Gmail أو resend.dev.',
      records: 0,
    }

  const backup = await buildFullBackup(actor)
  const context = await getAuditRequestContext()
  let attachment: { filename: string; content: Buffer } | undefined
  let downloadUrl: string | undefined
  let storedPathname: string | undefined

  try {
    if (backup.archive.byteLength <= MAX_EMAIL_ARCHIVE_BYTES) {
      attachment = { filename: backup.filename, content: backup.archive }
    } else {
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
      to: SOLE_ADMIN_EMAIL,
      subject: `نسخة احتياطية كاملة — ${SITE_NAME} — ${backup.generatedAt.toLocaleDateString('ar-EG')}`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:680px;margin:auto;padding:32px;color:#173d34"><h1>نسخة احتياطية كاملة من ${SITE_NAME}</h1><p>تم إنشاء النسخة يدويًا من لوحة التحكم.</p><p><b>السجلات:</b> ${backup.records.toLocaleString('ar-EG')}<br><b>ملفات التخزين:</b> ${backup.blobCount.toLocaleString('ar-EG')}<br><b>تاريخ الإنشاء:</b> ${backup.generatedAt.toLocaleString('ar-EG')}</p>${downloadUrl ? `<p><a href="${downloadUrl.replaceAll('&', '&amp;')}" style="display:inline-block;padding:12px 18px;background:#123c32;color:#fff;text-decoration:none;border-radius:10px">تنزيل النسخة الكاملة</a></p><p style="color:#6c7b74">الرابط صالح لمدة 7 أيام.</p>` : '<p>النسخة مرفقة مع هذه الرسالة بصيغة ZIP.</p>'}<p style="color:#6c7b74">للحماية، لا تتضمن النسخة كلمات المرور أو الجلسات أو رموز التحقق والاسترداد أو مفاتيح البيئة.</p></div>`,
      text: `نسخة احتياطية كاملة من ${SITE_NAME}\nالسجلات: ${backup.records}\nملفات التخزين: ${backup.blobCount}\nتاريخ الإنشاء: ${backup.generatedAt.toISOString()}${downloadUrl ? `\nرابط التنزيل صالح 7 أيام: ${downloadUrl}` : '\nالنسخة مرفقة بصيغة ZIP.'}`,
      attachments: attachment ? [attachment] : undefined,
    })
    if (error || !data?.id) throw new Error(error?.message ?? 'لم تُرجع خدمة البريد رقم تتبع.')

    await db.transaction((tx) =>
      writeAdminAudit(
        tx,
        {
          actorUserId: backup.actor.id,
          action: 'backup.email.success',
          entityType: 'backup',
          entityId: backup.filename,
          after: {
            records: backup.records,
            blobCount: backup.blobCount,
            sizeBytes: backup.archive.byteLength,
            recipient: SOLE_ADMIN_EMAIL,
            delivery: attachment ? 'attachment' : 'signed-link',
            storedPathname,
            emailId: data.id,
          },
          reason: 'Manual full backup emailed to the sole administrator.',
        },
        context,
      ),
    )
    return {
      ok: true,
      message: `تم إرسال النسخة الكاملة إلى ${SOLE_ADMIN_EMAIL}.`,
      records: backup.records,
      blobCount: backup.blobCount,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    console.error('[backup:email]', message)
    await db.transaction((tx) =>
      writeAdminAudit(
        tx,
        {
          actorUserId: backup.actor.id,
          action: 'backup.email.failure',
          entityType: 'backup',
          entityId: backup.filename,
          after: { records: backup.records, blobCount: backup.blobCount, storedPathname },
          reason: 'Full backup email delivery failed.',
          outcome: 'failure',
          errorCode: 'BACKUP_EMAIL_FAILED',
        },
        context,
      ),
    )
    return {
      ok: false,
      message: `تم إنشاء النسخة لكن تعذر إرسالها: ${message}`,
      records: backup.records,
      blobCount: backup.blobCount,
    }
  }
}
