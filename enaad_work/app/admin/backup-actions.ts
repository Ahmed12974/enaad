'use server'

import { Resend } from 'resend'
import { getAuditRequestContext, writeAdminAudit } from '@/lib/admin-audit'
import { requirePermission } from '@/lib/auth-session'
import { db } from '@/lib/db'
import {
  achievements,
  banners,
  categories,
  certificates,
  challengeParticipants,
  challenges,
  competitionParticipants,
  competitions,
  encouragementMessages,
  examples,
  mathAttempts,
  mathQuestions,
  mathSections,
  sentences,
  testAnswers,
  tests,
  user,
  userAchievements,
  userProgress,
  words,
} from '@/lib/db/schema'

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

async function requireSoleAdmin() {
  return requirePermission('backups:write')
}

function backupRecipient() {
  const value = process.env.BACKUP_RECIPIENT_EMAIL?.trim().toLowerCase()
  if (!value || !/^\S+@\S+\.\S+$/.test(value)) throw new Error('بريد استقبال النسخ الاحتياطية غير مهيأ.')
  return value
}

async function buildBackup() {
  const [
    users,
    wordRows,
    sentenceRows,
    testRows,
    answerRows,
    categoryRows,
    exampleRows,
    progressRows,
    achievementRows,
    earnedRows,
    challengeRows,
    challengeParticipantRows,
    certificateRows,
    bannerRows,
    messageRows,
    sectionRows,
    questionRows,
    attemptRows,
    competitionRows,
    competitionParticipantRows,
  ] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        recoveryEmail: user.recoveryEmail,
        recoveryEmailVerified: user.recoveryEmailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user),
    db.select().from(words),
    db.select().from(sentences),
    db.select().from(tests),
    db.select().from(testAnswers),
    db.select().from(categories),
    db.select().from(examples),
    db.select().from(userProgress),
    db.select().from(achievements),
    db.select().from(userAchievements),
    db.select().from(challenges),
    db.select().from(challengeParticipants),
    db.select().from(certificates),
    db.select().from(banners),
    db.select().from(encouragementMessages),
    db.select().from(mathSections),
    db.select().from(mathQuestions),
    db.select().from(mathAttempts),
    db.select().from(competitions),
    db.select().from(competitionParticipants),
  ])
  const data = {
    users,
    words: wordRows,
    sentences: sentenceRows,
    tests: testRows,
    testAnswers: answerRows,
    categories: categoryRows,
    examples: exampleRows,
    userProgress: progressRows,
    achievements: achievementRows,
    userAchievements: earnedRows,
    challenges: challengeRows,
    challengeParticipants: challengeParticipantRows,
    certificates: certificateRows,
    banners: bannerRows,
    encouragementMessages: messageRows,
    mathSections: sectionRows,
    mathQuestions: questionRows,
    mathAttempts: attemptRows,
    competitions: competitionRows,
    competitionParticipants: competitionParticipantRows,
  }
  const counts = Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length]))
  const generatedAt = new Date()
  const payload = JSON.stringify(
    {
      metadata: {
        platform: 'لُغتي',
        generatedAt: generatedAt.toISOString(),
        formatVersion: 2,
        excluded: [
          'passwords',
          'accounts',
          'sessions',
          'verification tokens',
          'recovery tokens',
          'environment secrets',
        ],
        counts,
      },
      data,
    },
    null,
    2,
  )
  const date = generatedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return {
    payload,
    content: Buffer.from(payload, 'utf8'),
    filename: `lughti-backup-${date}.json`,
    generatedAt,
    records: Object.values(counts).reduce((sum, count) => sum + count, 0),
  }
}

export async function createBackupDownload() {
  const actor = await requireSoleAdmin()
  const backup = await buildBackup()
  const context = await getAuditRequestContext()
  await db.transaction((tx) =>
    writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'backup.download',
        entityType: 'backup',
        entityId: backup.filename,
        after: { records: backup.records },
        reason: 'Manual administrative export.',
      },
      context,
    ),
  )
  return {
    ok: true,
    message: 'تم إنشاء النسخة وهي جاهزة للتنزيل.',
    filename: backup.filename,
    payload: backup.payload,
    records: backup.records,
  }
}

export async function createAndEmailBackup() {
  const actor = await requireSoleAdmin()
  const backup = await buildBackup()
  const context = await getAuditRequestContext()
  await db.transaction((tx) =>
    writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'backup.email.request',
        entityType: 'backup',
        entityId: backup.filename,
        after: { records: backup.records },
        reason: 'Manual administrative email export.',
      },
      context,
    ),
  )
  if (backup.content.byteLength > MAX_ATTACHMENT_BYTES)
    return {
      ok: false,
      message: 'تم إنشاء النسخة، لكن حجمها أكبر من حد مرفقات البريد. استخدم التنزيل المباشر.',
      records: backup.records,
    }
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey)
    return {
      ok: false,
      message: 'تم إنشاء النسخة، لكن البريد غير مهيأ. استخدم التنزيل المباشر.',
      records: backup.records,
    }
  const configuredFrom = process.env.EMAIL_FROM?.trim()
  const from =
    configuredFrom &&
    /^(?:[^<>]+\s*)?<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$|^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(configuredFrom)
      ? configuredFrom
      : 'Lughti <onboarding@resend.dev>'
  try {
    const { data, error } = await new Resend(apiKey).emails.send({
      from,
      to: backupRecipient(),
      subject: `نسخة احتياطية لمنصة لُغتي — ${backup.generatedAt.toLocaleDateString('ar-EG')}`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:32px;color:#173d34"><h1>نسخة بيانات منصة لُغتي</h1><p>تم إنشاء النسخة يدويًا من لوحة التحكم وإرفاقها بصيغة JSON.</p><p>تاريخ الإنشاء: ${backup.generatedAt.toLocaleString('ar-EG')}</p><p style="color:#6c7b74">لا تتضمن النسخة كلمات المرور أو الجلسات أو رموز التحقق والاسترداد.</p></div>`,
      text: `نسخة بيانات منصة لُغتي\nتاريخ الإنشاء: ${backup.generatedAt.toISOString()}\nلا تتضمن كلمات المرور أو الجلسات أو رموز التحقق والاسترداد.`,
      attachments: [{ filename: backup.filename, content: backup.content }],
    })
    if (error)
      return {
        ok: false,
        message: 'تم إنشاء النسخة، لكن خدمة البريد رفضت الإرسال. راجع سجل الخادم واستخدم التنزيل المباشر.',
        records: backup.records,
      }
    if (!data?.id)
      return {
        ok: false,
        message: 'تم إنشاء النسخة، لكن خدمة البريد لم تُرجع رقم تتبع. استخدم التنزيل المباشر.',
        records: backup.records,
      }
    return { ok: true, message: 'تم إرسال النسخة إلى بريد النسخ الاحتياطية المهيأ.', records: backup.records }
  } catch (error) {
    console.error('[backup:email]', error instanceof Error ? error.message : 'unknown error')
    return {
      ok: false,
      message: 'تم إنشاء النسخة، لكن تعذر الاتصال بخدمة البريد. استخدم التنزيل المباشر.',
      records: backup.records,
    }
  }
}
