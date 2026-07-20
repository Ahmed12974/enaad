'use server'

import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { requireUser } from '@/lib/auth-session'
import { db } from '@/lib/db'
import { account, recoveryTokens, session, user } from '@/lib/db/schema'
import { consumeRateLimit } from '@/lib/rate-limit'
import {
  createRecoveryToken,
  getAppUrl,
  hashRecoveryToken,
  sendRecoveryEmail,
  TOKEN_TTL_MS,
} from '@/lib/recovery'
import { hashSecurityIdentifier, normalizeEmail } from '@/lib/security'

const genericResetMessage = {
  ok: true,
  message: 'إذا كانت البيانات مطابقة لحساب، ستصلك رسالة الاسترداد خلال دقائق.',
}

async function requestFingerprint(identifier: string) {
  const requestHeaders = await headers()
  const forwarded = requestHeaders.get('x-forwarded-for')
  const ip =
    forwarded && !forwarded.includes(',')
      ? forwarded.trim()
      : requestHeaders.get('x-real-ip')?.trim() || 'unknown'
  return {
    ip: hashSecurityIdentifier(`ip:${ip}`),
    identifier: hashSecurityIdentifier(`identifier:${normalizeEmail(identifier)}`),
  }
}

async function allowRecoveryRequest(identifier: string) {
  const fingerprint = await requestFingerprint(identifier)
  const [ipLimit, identifierLimit] = await Promise.all([
    consumeRateLimit(`recovery:ip:${fingerprint.ip}`, 10, 15 * 60),
    consumeRateLimit(`recovery:identifier:${fingerprint.identifier}`, 3, 15 * 60),
  ])
  return ipLimit.allowed && identifierLimit.allowed
}

export async function getRecoveryEmailStatus() {
  const current = await requireUser()
  const [record] = await db
    .select({
      email: user.email,
      recoveryEmail: user.recoveryEmail,
      recoveryEmailVerified: user.recoveryEmailVerified,
    })
    .from(user)
    .where(eq(user.id, current.id))
    .limit(1)
  return record
}

export async function requestRecoveryEmailVerification(emailValue: string) {
  const current = await requireUser()
  const email = normalizeEmail(emailValue)
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320)
    return { ok: false, message: 'أدخل بريدًا إلكترونيًا صحيحًا.' }
  if (!(await allowRecoveryRequest(`${current.id}:${email}`)))
    return { ok: false, message: 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.' }
  if (email === normalizeEmail(current.email))
    return { ok: false, message: 'استخدم بريدًا مختلفًا عن البريد الأساسي.' }
  const [used] = await db
    .select({ id: user.id })
    .from(user)
    .where(or(sql`lower(trim(${user.email})) = ${email}`, sql`lower(trim(${user.recoveryEmail})) = ${email}`))
    .limit(1)
  if (used && used.id !== current.id) return { ok: false, message: 'لا يمكن استخدام هذا البريد.' }
  const [latest] = await db
    .select({ createdAt: recoveryTokens.createdAt })
    .from(recoveryTokens)
    .where(and(eq(recoveryTokens.userId, current.id), eq(recoveryTokens.purpose, 'verify-recovery')))
    .orderBy(desc(recoveryTokens.createdAt))
    .limit(1)
  if (latest && Date.now() - latest.createdAt.getTime() < 60_000)
    return { ok: false, message: 'انتظر دقيقة قبل طلب رسالة أخرى.' }

  const { token, tokenHash } = createRecoveryToken()
  await db.transaction(async (tx) => {
    await tx
      .update(recoveryTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(recoveryTokens.userId, current.id),
          eq(recoveryTokens.purpose, 'verify-recovery'),
          isNull(recoveryTokens.usedAt),
        ),
      )
    await tx
      .update(user)
      .set({ recoveryEmail: email, recoveryEmailVerified: false, updatedAt: new Date() })
      .where(eq(user.id, current.id))
    await tx.insert(recoveryTokens).values({
      userId: current.id,
      purpose: 'verify-recovery',
      tokenHash,
      targetEmail: email,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    })
  })
  const url = `${getAppUrl()}/account/verify-recovery?token=${encodeURIComponent(token)}`
  await sendRecoveryEmail({
    to: email,
    subject: 'تأكيد بريدك الاحتياطي في لُغتي',
    title: 'تأكيد البريد الاحتياطي',
    text: 'افتح الصفحة ثم اضغط زر التأكيد لاستخدام هذا البريد في استرداد حسابك.',
    actionLabel: 'فتح صفحة التأكيد',
    actionUrl: url,
  })
  return { ok: true, message: 'أرسلنا رابط التأكيد إلى البريد الاحتياطي.' }
}

export async function verifyRecoveryEmail(token: string) {
  if (!/^[a-f0-9]{64}$/i.test(token)) return { ok: false, message: 'رابط التأكيد غير صالح أو انتهت مدته.' }
  const tokenHash = hashRecoveryToken(token)
  return db.transaction(async (tx) => {
    const now = new Date()
    const [record] = await tx
      .update(recoveryTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(recoveryTokens.tokenHash, tokenHash),
          eq(recoveryTokens.purpose, 'verify-recovery'),
          isNull(recoveryTokens.usedAt),
          gt(recoveryTokens.expiresAt, now),
        ),
      )
      .returning()
    if (!record) return { ok: false, message: 'رابط التأكيد غير صالح أو انتهت مدته.' }
    const [updated] = await tx
      .update(user)
      .set({ recoveryEmailVerified: true, updatedAt: now })
      .where(and(eq(user.id, record.userId), eq(user.recoveryEmail, record.targetEmail)))
      .returning({ id: user.id })
    if (!updated) throw new Error('تم تغيير البريد الاحتياطي. اطلب رابطًا جديدًا.')
    return { ok: true, message: 'تم تأكيد البريد الاحتياطي بنجاح.' }
  })
}

export async function removeRecoveryEmail() {
  const current = await requireUser()
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({ recoveryEmail: null, recoveryEmailVerified: false, updatedAt: new Date() })
      .where(eq(user.id, current.id))
    await tx
      .update(recoveryTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(recoveryTokens.userId, current.id),
          eq(recoveryTokens.purpose, 'verify-recovery'),
          isNull(recoveryTokens.usedAt),
        ),
      )
  })
  return { ok: true, message: 'تم حذف البريد الاحتياطي.' }
}

export async function requestPasswordReset(identifierValue: string) {
  const identifier = normalizeEmail(identifierValue)
  if (!/^\S+@\S+\.\S+$/.test(identifier) || identifier.length > 320) return genericResetMessage
  if (!(await allowRecoveryRequest(identifier))) return genericResetMessage
  const [record] = await db
    .select({
      id: user.id,
      email: user.email,
      recoveryEmail: user.recoveryEmail,
      recoveryEmailVerified: user.recoveryEmailVerified,
    })
    .from(user)
    .where(
      or(
        sql`lower(trim(${user.email})) = ${identifier}`,
        and(sql`lower(trim(${user.recoveryEmail})) = ${identifier}`, eq(user.recoveryEmailVerified, true)),
      ),
    )
    .limit(1)
  if (!record) return genericResetMessage
  const [latest] = await db
    .select({ createdAt: recoveryTokens.createdAt })
    .from(recoveryTokens)
    .where(and(eq(recoveryTokens.userId, record.id), eq(recoveryTokens.purpose, 'reset-password')))
    .orderBy(desc(recoveryTokens.createdAt))
    .limit(1)
  if (latest && Date.now() - latest.createdAt.getTime() < 60_000) return genericResetMessage

  const { token, tokenHash } = createRecoveryToken()
  const destination =
    identifier === normalizeEmail(record.recoveryEmail ?? '') && record.recoveryEmailVerified
      ? record.recoveryEmail!
      : record.email
  await db.transaction(async (tx) => {
    await tx
      .update(recoveryTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(recoveryTokens.userId, record.id),
          eq(recoveryTokens.purpose, 'reset-password'),
          isNull(recoveryTokens.usedAt),
        ),
      )
    await tx.insert(recoveryTokens).values({
      userId: record.id,
      purpose: 'reset-password',
      tokenHash,
      targetEmail: destination,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    })
  })
  const url = `${getAppUrl()}/reset-password?token=${encodeURIComponent(token)}`
  await sendRecoveryEmail({
    to: destination,
    subject: 'استعادة حسابك في لُغتي',
    title: 'استعادة الحساب',
    text: 'استخدم الرابط التالي لاختيار كلمة مرور جديدة. إذا لم تطلب ذلك، تجاهل الرسالة.',
    actionLabel: 'إعادة تعيين كلمة المرور',
    actionUrl: url,
  })
  return genericResetMessage
}

export async function consumePasswordReset(token: string, password: string) {
  if (!/^[a-f0-9]{64}$/i.test(token)) return { ok: false, message: 'رابط الاسترداد غير صالح أو انتهت مدته.' }
  if (password.length < 10) return { ok: false, message: 'يجب أن تتكون كلمة المرور من 10 أحرف على الأقل.' }
  if (password.length > 128) return { ok: false, message: 'كلمة المرور أطول من الحد المسموح.' }
  const common = new Set(['1234567890', 'password123', 'qwerty12345', '1111111111'])
  if (common.has(password.toLowerCase())) return { ok: false, message: 'اختر كلمة مرور أقوى وأقل شيوعًا.' }
  const tokenHash = hashRecoveryToken(token)
  const context = await auth.$context

  return db.transaction(async (tx) => {
    const now = new Date()
    const [record] = await tx
      .update(recoveryTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(recoveryTokens.tokenHash, tokenHash),
          eq(recoveryTokens.purpose, 'reset-password'),
          isNull(recoveryTokens.usedAt),
          gt(recoveryTokens.expiresAt, now),
        ),
      )
      .returning()
    if (!record) return { ok: false, message: 'رابط الاسترداد غير صالح أو انتهت مدته.' }
    const [credential] = await tx
      .select({ id: account.id, password: account.password })
      .from(account)
      .where(and(eq(account.userId, record.userId), eq(account.providerId, 'credential')))
      .limit(1)
    if (!credential?.password) throw new Error('لا توجد بيانات دخول بكلمة مرور لهذا الحساب.')
    if (await context.password.verify({ hash: credential.password, password }))
      return { ok: false, message: 'اختر كلمة مرور مختلفة عن كلمة المرور الحالية.' }
    const hashedPassword = await context.password.hash(password)
    await tx
      .update(account)
      .set({ password: hashedPassword, updatedAt: now })
      .where(eq(account.id, credential.id))
    await tx.delete(session).where(eq(session.userId, record.userId))
    await tx
      .update(recoveryTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(recoveryTokens.userId, record.userId),
          eq(recoveryTokens.purpose, 'reset-password'),
          isNull(recoveryTokens.usedAt),
        ),
      )
    return { ok: true, message: 'تم تغيير كلمة المرور وإبطال كل الجلسات السابقة. يمكنك تسجيل الدخول الآن.' }
  })
}
