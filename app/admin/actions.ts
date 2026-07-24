'use server'

import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  createEducationalSectionTx,
  createSectionContentWithPrerequisitesTx,
  executeConfiguredPromotionRuleTx,
  grantBadgeTx,
  previewPromotionRuleForUser,
  replaceContentPrerequisitesTx,
} from '@/lib/admin-domain'
import { getAuditRequestContext, writeAdminAudit } from '@/lib/admin-audit'
import { requirePermission } from '@/lib/auth-session'
import { db, type DbTransaction } from '@/lib/db'
import {
  adminAllowlist,
  adminNotes,
  achievements,
  badges,
  categories,
  challengeParticipants,
  challengeModeration,
  challengeResults,
  challengeSettings,
  challenges,
  competitionCategories,
  competitionMathSections,
  competitionParticipants,
  competitions,
  contentPrerequisites,
  educationalSections,
  levels,
  mathSections,
  platformSettings,
  promotionRuleExecutions,
  promotionRules,
  rewardLedger,
  sectionContents,
  session,
  siteContent,
  siteContentVersions,
  user,
  userAchievements,
  userAdminProfiles,
  userBadges,
  userProgress,
} from '@/lib/db/schema'
import { consumeRateLimit } from '@/lib/rate-limit'
import { cleanText, isUniqueViolation, normalizeText } from '@/lib/utils'
import { MAX_UPLOAD_MB } from '@/lib/platform-settings'
import { awardProgress, synchronizeAllUserLevels } from '@/lib/rewards'

type Result = { ok: boolean; message: string }
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120)
const uuid = z.string().uuid()
const positiveId = z.coerce.number().int().positive()
const publication = z.enum(['draft', 'scheduled', 'published', 'archived'])

async function authorizeMutation(permission: Parameters<typeof requirePermission>[0]) {
  const actor = await requirePermission(permission)
  const limit = await consumeRateLimit(`admin-mutation:${actor.id}`, 90, 60)
  if (!limit.allowed) throw new Error(`محاولات كثيرة. أعد المحاولة بعد ${limit.retryAfter} ثانية.`)
  return { actor, context: await getAuditRequestContext() }
}

function refreshAdmin() {
  revalidatePath('/admin', 'layout')
}

function nullableDate(value: FormDataEntryValue | null) {
  const raw = cleanText(value)
  if (!raw) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) throw new Error('التاريخ غير صالح.')
  return date
}

const sectionSchema = z
  .object({
  name: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().max(120).nullable(),
  slug,
  sectionType: z.enum(['subject', 'language', 'reading', 'math', 'skills', 'custom']),
  previousSectionId: uuid.nullable(),
  shortDescription: z.string().trim().max(300).nullable(),
  fullDescription: z.string().trim().max(5_000).nullable(),
  iconMediaId: uuid.nullable(),
  imageMediaId: uuid.nullable(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable(),
  ageRange: z.string().trim().max(80).nullable(),
  targetLevel: z.string().trim().max(80).nullable(),
  access: z.enum(['free', 'restricted']),
  isPaid: z.boolean(),
  priceMinor: z.coerce.number().int().min(0).max(100_000_000).nullable(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  status: z.enum(['draft', 'published', 'archived']),
  isActive: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(100_000),
  unlockRules: z.object({
    minimumXp: z.coerce.number().int().min(0).max(10_000_000),
    prerequisiteSectionId: uuid.nullable(),
  }),
})
  .superRefine((value, context) => {
    if (value.isPaid && (!value.priceMinor || value.priceMinor <= 0)) {
      context.addIssue({ code: 'custom', path: ['priceMinor'], message: 'السعر مطلوب للقسم المدفوع.' })
    }
    if (!value.isPaid && value.priceMinor && value.priceMinor > 0) {
      context.addIssue({ code: 'custom', path: ['priceMinor'], message: 'لا تضف سعرًا لقسم مجاني.' })
    }
    if (value.previousSectionId !== value.unlockRules.prerequisiteSectionId) {
      context.addIssue({ code: 'custom', path: ['previousSectionId'], message: 'القسم السابق غير متطابق.' })
    }
  })

function parseSection(form: FormData) {
  return sectionSchema.parse({
    name: form.get('name'),
    nameEn: cleanText(form.get('nameEn')) || null,
    slug: form.get('slug'),
    sectionType: form.get('sectionType') || 'subject',
    previousSectionId: cleanText(form.get('prerequisiteSectionId')) || null,
    shortDescription: cleanText(form.get('shortDescription')) || null,
    fullDescription: cleanText(form.get('fullDescription')) || null,
    iconMediaId: cleanText(form.get('iconMediaId')) || null,
    imageMediaId: cleanText(form.get('imageMediaId')) || null,
    color: cleanText(form.get('color')) || null,
    ageRange: cleanText(form.get('ageRange')) || null,
    targetLevel: cleanText(form.get('targetLevel')) || null,
    access: form.get('access') || 'free',
    isPaid: form.get('isPaid') === 'on',
    priceMinor: form.get('isPaid') === 'on' ? form.get('priceMinor') || null : null,
    currency: cleanText(form.get('currency')) || 'USD',
    status: form.get('status') || 'draft',
    isActive: form.get('isActive') === 'on',
    sortOrder: form.get('sortOrder') || 0,
    unlockRules: {
      minimumXp: form.get('unlockMinimumXp') || 0,
      prerequisiteSectionId: cleanText(form.get('prerequisiteSectionId')) || null,
    },
  })
}

async function validateSectionDependencyTx(
  tx: DbTransaction,
  sectionId: string | null,
  prerequisiteSectionId: string | null,
) {
  const graph = await tx
    .select({ id: educationalSections.id, previousSectionId: educationalSections.previousSectionId })
    .from(educationalSections)
    .where(isNull(educationalSections.deletedAt))
  const previousById = new Map<string, string | null>(
    graph.map((item) => [item.id, item.previousSectionId] as const),
  )
  if (prerequisiteSectionId && !previousById.has(prerequisiteSectionId)) {
    throw new Error('القسم السابق المطلوب غير موجود.')
  }
  if (!sectionId) return
  if (prerequisiteSectionId === sectionId) throw new Error('لا يمكن أن يكون القسم سابقًا لنفسه.')
  previousById.set(sectionId, prerequisiteSectionId)
  const visited = new Set<string>()
  let cursor: string | null = sectionId
  while (cursor) {
    if (visited.has(cursor)) throw new Error('لا يمكن إنشاء حلقة بين متطلبات فتح الأقسام.')
    visited.add(cursor)
    cursor = previousById.get(cursor) ?? null
  }
}

export async function createEducationalSection(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const parsed = parseSection(form)
  try {
    await db.transaction(async (tx) => {
      await validateSectionDependencyTx(tx, null, parsed.previousSectionId)
      const created = await createEducationalSectionTx(tx, parsed)
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'section.create',
          entityType: 'educationalSection',
          entityId: created.id,
          after: created,
        },
        context,
      )
    })
    refreshAdmin()
    return { ok: true, message: 'تم إنشاء القسم.' }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'اسم القسم أو المعرّف مستخدم في قسم آخر.' }
    throw error
  }
}

export async function updateEducationalSection(sectionId: string, form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const id = uuid.parse(sectionId)
  const parsed = parseSection(form)
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(educationalSections)
      .where(and(eq(educationalSections.id, id), isNull(educationalSections.deletedAt)))
      .limit(1)
    if (!before) throw new Error('القسم غير موجود.')
    await validateSectionDependencyTx(tx, id, parsed.previousSectionId)
    const [after] = await tx
      .update(educationalSections)
      .set({ ...parsed, updatedAt: new Date() })
      .where(eq(educationalSections.id, id))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'section.update',
        entityType: 'educationalSection',
        entityId: id,
        before,
        after,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم تحديث القسم.' }
}

export async function archiveEducationalSection(sectionId: string, reasonValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const id = uuid.parse(sectionId)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(educationalSections)
      .where(and(eq(educationalSections.id, id), isNull(educationalSections.deletedAt)))
      .limit(1)
    if (!before) throw new Error('القسم غير موجود.')
    const [after] = await tx
      .update(educationalSections)
      .set({ status: 'archived', deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(educationalSections.id, id))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'section.archive',
        entityType: 'educationalSection',
        entityId: id,
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تمت أرشفة القسم دون حذف بياناته.' }
}

export async function restoreEducationalSection(sectionId: string, reasonValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const id = uuid.parse(sectionId)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(educationalSections)
      .where(eq(educationalSections.id, id))
      .limit(1)
    if (!before || !before.deletedAt) throw new Error('القسم غير مؤرشف.')
    const [after] = await tx
      .update(educationalSections)
      .set({ status: 'draft', deletedAt: null, updatedAt: new Date() })
      .where(eq(educationalSections.id, id))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'section.restore',
        entityType: 'educationalSection',
        entityId: id,
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تمت استعادة القسم كمسودة.' }
}

const contentSchema = z.object({
  sectionId: uuid,
  parentId: uuid.nullable(),
  kind: z.enum([
    'unit',
    'level',
    'lesson',
    'quiz',
    'question',
    'activity',
    'story',
    'file',
    'image',
    'video',
    'instruction',
  ]),
  mediaId: uuid.nullable(),
  title: z.string().trim().min(2).max(200),
  slug,
  summary: z.string().trim().max(1_000).nullable(),
  targetLevel: z.string().trim().max(80).nullable(),
  points: z.coerce.number().int().min(0).max(100_000),
  passingScore: z.coerce.number().int().min(0).max(100).nullable(),
  status: publication,
  sortOrder: z.coerce.number().int().min(0).max(100_000),
})

function parseSectionContentBody(form: FormData, kind: z.infer<typeof contentSchema>['kind']) {
  const questionType = z
    .enum(['multiple_choice', 'true_false', 'short_answer'])
    .parse(form.get('questionType') || 'multiple_choice')
  const answerOptions = cleanText(form.get('answerOptions'))
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20)
  const body = z
    .object({
      text: z.string().trim().max(50_000),
      instructions: z.string().trim().max(10_000),
      estimatedMinutes: z.coerce.number().int().min(0).max(10_000),
      maxAttempts: z.coerce.number().int().min(0).max(1_000),
      questionType: z.enum(['multiple_choice', 'true_false', 'short_answer']),
      questionPrompt: z.string().trim().max(5_000),
      correctAnswer: z.string().trim().max(2_000),
      answerExplanation: z.string().trim().max(5_000),
    })
    .parse({
      text: cleanText(form.get('contentText')),
      instructions: cleanText(form.get('instructions')),
      estimatedMinutes: form.get('estimatedMinutes') || 0,
      maxAttempts: form.get('maxAttempts') || 0,
      questionType,
      questionPrompt: cleanText(form.get('questionPrompt')),
      correctAnswer: cleanText(form.get('correctAnswer')),
      answerExplanation: cleanText(form.get('answerExplanation')),
    })
  if (kind === 'question') {
    if (!body.questionPrompt || !body.correctAnswer) throw new Error('السؤال والإجابة الصحيحة مطلوبان.')
    if (questionType === 'multiple_choice') {
      if (answerOptions.length < 2)
        throw new Error('سؤال الاختيار المتعدد يحتاج إلى خيارين مختلفين على الأقل.')
      if (new Set(answerOptions).size !== answerOptions.length)
        throw new Error('خيارات الإجابة يجب ألا تتكرر.')
      if (!answerOptions.includes(body.correctAnswer))
        throw new Error('الإجابة الصحيحة يجب أن تكون ضمن الخيارات.')
    }
  }
  return { ...body, answerOptions }
}

function parsePrerequisiteIds(form: FormData) {
  const values = form
    .getAll('prerequisiteIds')
    .map((value) => cleanText(value))
    .filter(Boolean)
  if (new Set(values).size !== values.length)
    throw new Error('لا يجوز تكرار المحتوى نفسه ضمن المتطلبات السابقة.')
  return values.map((value) => uuid.parse(value))
}

function contentDependencyError(error: unknown) {
  if (!(error instanceof Error)) return null
  return /المتطلبات السابقة|متطلبًا لنفسه|اعتماد دائري|غير موجود أو مؤرشف/.test(error.message)
    ? error.message
    : null
}

async function auditContentFailure(
  actorUserId: string,
  context: Awaited<ReturnType<typeof getAuditRequestContext>>,
  action: 'content.create' | 'content.update',
  entityId: string | null,
  message: string,
) {
  await db.transaction((tx) =>
    writeAdminAudit(
      tx,
      {
        actorUserId,
        action,
        entityType: 'sectionContent',
        entityId,
        reason: message,
        outcome: 'failure',
        errorCode: 'CONTENT_VALIDATION_FAILED',
      },
      context,
    ),
  )
}

export async function createSectionContent(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const rawPassingScore = cleanText(form.get('passingScore'))
  const parsed = contentSchema.parse({
    sectionId: form.get('sectionId'),
    parentId: cleanText(form.get('parentId')) || null,
    kind: form.get('kind'),
    mediaId: cleanText(form.get('mediaId')) || null,
    title: form.get('title'),
    slug: form.get('slug'),
    summary: cleanText(form.get('summary')) || null,
    targetLevel: cleanText(form.get('targetLevel')) || null,
    points: form.get('points') || 0,
    passingScore: rawPassingScore ? Number(rawPassingScore) : null,
    status: form.get('status') || 'draft',
    sortOrder: form.get('sortOrder') || 0,
  })
  let prerequisiteIds: string[]
  try {
    prerequisiteIds = parsePrerequisiteIds(form)
  } catch (error) {
    const message = contentDependencyError(error) ?? 'أحد معرّفات المتطلبات السابقة غير صالح.'
    await auditContentFailure(actor.id, context, 'content.create', null, message)
    return {
      ok: false,
      message,
    }
  }
  const body = parseSectionContentBody(form, parsed.kind)
  const scheduledAt = nullableDate(form.get('scheduledAt'))
  if (parsed.status === 'scheduled' && (!scheduledAt || scheduledAt <= new Date())) {
    const message = 'حدد موعد نشر مستقبليًا للمحتوى المجدول.'
    await auditContentFailure(actor.id, context, 'content.create', null, message)
    return { ok: false, message }
  }
  try {
    await db.transaction(async (tx) => {
      const created = await createSectionContentWithPrerequisitesTx(
        tx,
        {
          ...parsed,
          body,
          publishedAt:
            parsed.status === 'published' ? new Date() : parsed.status === 'scheduled' ? scheduledAt : null,
        },
        prerequisiteIds,
      )
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'content.create',
          entityType: 'sectionContent',
          entityId: created.id,
          after: { ...created, prerequisiteIds },
        },
        context,
      )
    })
    refreshAdmin()
    return { ok: true, message: 'تم إنشاء المحتوى وحفظ متطلباته السابقة.' }
  } catch (error) {
    const message = isUniqueViolation(error)
      ? 'يوجد محتوى بالمعرّف نفسه في هذا القسم.'
      : contentDependencyError(error)
    if (message) {
      await auditContentFailure(actor.id, context, 'content.create', null, message)
      return { ok: false, message }
    }
    throw error
  }
}

export async function updateSectionContent(contentId: string, form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const id = uuid.parse(contentId)
  const rawPassingScore = cleanText(form.get('passingScore'))
  const parsed = contentSchema.parse({
    sectionId: form.get('sectionId'),
    parentId: cleanText(form.get('parentId')) || null,
    kind: form.get('kind'),
    mediaId: cleanText(form.get('mediaId')) || null,
    title: form.get('title'),
    slug: form.get('slug'),
    summary: cleanText(form.get('summary')) || null,
    targetLevel: cleanText(form.get('targetLevel')) || null,
    points: form.get('points') || 0,
    passingScore: rawPassingScore ? Number(rawPassingScore) : null,
    status: form.get('status') || 'draft',
    sortOrder: form.get('sortOrder') || 0,
  })
  let prerequisiteIds: string[]
  try {
    prerequisiteIds = parsePrerequisiteIds(form)
  } catch (error) {
    const message = contentDependencyError(error) ?? 'أحد معرّفات المتطلبات السابقة غير صالح.'
    await auditContentFailure(actor.id, context, 'content.update', id, message)
    return {
      ok: false,
      message,
    }
  }
  const body = parseSectionContentBody(form, parsed.kind)
  const scheduledAt = nullableDate(form.get('scheduledAt'))
  if (parsed.status === 'scheduled' && (!scheduledAt || scheduledAt <= new Date())) {
    const message = 'حدد موعد نشر مستقبليًا للمحتوى المجدول.'
    await auditContentFailure(actor.id, context, 'content.update', id, message)
    return { ok: false, message }
  }
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(sectionContents).where(eq(sectionContents.id, id)).limit(1)
      if (!before || before.deletedAt) throw new Error('المحتوى غير موجود.')
      await replaceContentPrerequisitesTx(tx, id, prerequisiteIds)
      const [after] = await tx
        .update(sectionContents)
        .set({
          ...parsed,
          body,
          publishedAt:
            parsed.status === 'published'
              ? before.status === 'published'
                ? (before.publishedAt ?? new Date())
                : new Date()
              : parsed.status === 'scheduled'
                ? scheduledAt
                : before.publishedAt,
          updatedAt: new Date(),
        })
        .where(eq(sectionContents.id, id))
        .returning()
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'content.update',
          entityType: 'sectionContent',
          entityId: id,
          before,
          after: { ...after, prerequisiteIds },
        },
        context,
      )
    })
    refreshAdmin()
    return { ok: true, message: 'تم تحديث المحتوى ومتطلباته.' }
  } catch (error) {
    const message = isUniqueViolation(error)
      ? 'يوجد محتوى بالمعرّف نفسه في هذا القسم.'
      : contentDependencyError(error)
    if (message) {
      await auditContentFailure(actor.id, context, 'content.update', id, message)
      return { ok: false, message }
    }
    throw error
  }
}

export async function duplicateSectionContent(contentIdValue: string, reasonValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const contentId = uuid.parse(contentIdValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  const createdId = await db.transaction(async (tx) => {
    const [source] = await tx.select().from(sectionContents).where(eq(sectionContents.id, contentId)).limit(1)
    if (!source || source.deletedAt) throw new Error('المحتوى غير موجود.')
    const prerequisites = await tx
      .select({ prerequisiteId: contentPrerequisites.prerequisiteId })
      .from(contentPrerequisites)
      .where(eq(contentPrerequisites.contentId, contentId))
    const suffix = randomUUID().slice(0, 8)
    const [created] = await tx
      .insert(sectionContents)
      .values({
        sectionId: source.sectionId,
        parentId: source.parentId,
        kind: source.kind,
        title: `نسخة من ${source.title}`,
        slug: `${source.slug}-copy-${suffix}`,
        summary: source.summary,
        body: source.body,
        mediaId: source.mediaId,
        targetLevel: source.targetLevel,
        points: source.points,
        passingScore: source.passingScore,
        status: 'draft',
        sortOrder: source.sortOrder + 1,
      })
      .returning()
    if (!created) throw new Error('تعذر نسخ المحتوى.')
    if (prerequisites.length)
      await tx
        .insert(contentPrerequisites)
        .values(prerequisites.map((item) => ({ contentId: created.id, prerequisiteId: item.prerequisiteId })))
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'content.duplicate',
        entityType: 'sectionContent',
        entityId: created.id,
        after: { sourceContentId: contentId, title: created.title },
        reason,
      },
      context,
    )
    return created.id
  })
  refreshAdmin()
  return { ok: true, message: `تم إنشاء نسخة مسودة برقم ${createdId}.` }
}

export async function moveSectionContent(
  contentIdValue: string,
  directionValue: 'up' | 'down',
): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const contentId = uuid.parse(contentIdValue)
  const direction = z.enum(['up', 'down']).parse(directionValue)
  const changed = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(sectionContents)
      .where(eq(sectionContents.id, contentId))
      .limit(1)
    if (!current || current.deletedAt) throw new Error('المحتوى غير موجود.')
    const siblings = await tx
      .select({ id: sectionContents.id, sortOrder: sectionContents.sortOrder })
      .from(sectionContents)
      .where(and(eq(sectionContents.sectionId, current.sectionId), isNull(sectionContents.deletedAt)))
      .orderBy(asc(sectionContents.sortOrder), asc(sectionContents.createdAt))
      .limit(2_000)
    const index = siblings.findIndex((item) => item.id === contentId)
    const target = siblings[direction === 'up' ? index - 1 : index + 1]
    if (!target) return false
    await tx
      .update(sectionContents)
      .set({ sortOrder: target.sortOrder, updatedAt: new Date() })
      .where(eq(sectionContents.id, current.id))
    await tx
      .update(sectionContents)
      .set({ sortOrder: current.sortOrder, updatedAt: new Date() })
      .where(eq(sectionContents.id, target.id))
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'content.reorder',
        entityType: 'sectionContent',
        entityId: contentId,
        before: { sortOrder: current.sortOrder },
        after: { sortOrder: target.sortOrder, swappedWith: target.id },
      },
      context,
    )
    return true
  })
  refreshAdmin()
  return changed
    ? { ok: true, message: 'تم تحديث ترتيب المحتوى.' }
    : { ok: false, message: 'المحتوى موجود بالفعل عند طرف القائمة.' }
}

export async function restoreSectionContent(contentId: string, reasonValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const id = uuid.parse(contentId)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(sectionContents).where(eq(sectionContents.id, id)).limit(1)
    if (!before || !before.deletedAt) throw new Error('المحتوى غير مؤرشف.')
    const [after] = await tx
      .update(sectionContents)
      .set({ status: 'draft', deletedAt: null, updatedAt: new Date() })
      .where(eq(sectionContents.id, id))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'content.restore',
        entityType: 'sectionContent',
        entityId: id,
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تمت استعادة المحتوى كمسودة.' }
}

export async function changeContentStatus(contentId: string, statusValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const id = uuid.parse(contentId)
  const status = z.enum(['draft', 'published', 'archived']).parse(statusValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(sectionContents).where(eq(sectionContents.id, id)).limit(1)
    if (!before || before.deletedAt) throw new Error('المحتوى غير موجود.')
    const [after] = await tx
      .update(sectionContents)
      .set({
        status,
        publishedAt: status === 'published' ? (before.publishedAt ?? new Date()) : before.publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(sectionContents.id, id))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'content.status.update',
        entityType: 'sectionContent',
        entityId: id,
        before: { status: before.status },
        after: { status: after?.status },
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم تحديث حالة المحتوى.' }
}

export async function archiveSectionContent(contentId: string, reasonValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const id = uuid.parse(contentId)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(sectionContents).where(eq(sectionContents.id, id)).limit(1)
    if (!before || before.deletedAt) throw new Error('المحتوى غير موجود.')
    const [after] = await tx
      .update(sectionContents)
      .set({ status: 'archived', deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(sectionContents.id, id))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'content.archive',
        entityType: 'sectionContent',
        entityId: id,
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تمت أرشفة المحتوى.' }
}

const lifecycle = z.enum(['draft', 'scheduled', 'open', 'active', 'paused', 'ended', 'cancelled'])

function parseManagedChallengeRules(form: FormData) {
  const values = z
    .object({
      minimumXp: z.coerce.number().int().min(0).max(10_000_000),
      requireVerifiedEmail: z.boolean(),
      targetAudience: z.string().trim().max(120),
      scoreMultiplier: z.coerce.number().min(0.1).max(100),
      tieBreaker: z.enum(['earliest_completion', 'highest_progress', 'earliest_join']),
    })
    .parse({
      minimumXp: form.get('minimumXp') || 0,
      requireVerifiedEmail: form.get('requireVerifiedEmail') === 'on',
      targetAudience: cleanText(form.get('targetAudience')),
      scoreMultiplier: form.get('scoreMultiplier') || 1,
      tieBreaker: form.get('tieBreaker') || 'earliest_completion',
    })
  return {
    participationRules: {
      minimumXp: values.minimumXp,
      requireVerifiedEmail: values.requireVerifiedEmail,
      targetAudience: values.targetAudience || null,
      allowRepeatParticipation: false,
      maximumAttempts: 1,
    },
    scoringRules: { multiplier: values.scoreMultiplier },
    winningRules: { tieBreaker: values.tieBreaker },
  }
}

const levelSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000).nullable(),
  rank: z.coerce.number().int().min(1).max(10_000),
  minimumPoints: z.coerce.number().int().min(0).max(1_000_000_000),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable(),
  isActive: z.boolean(),
})

function parseLevel(form: FormData) {
  return levelSchema.parse({
    name: form.get('name'),
    description: cleanText(form.get('description')) || null,
    rank: form.get('rank'),
    minimumPoints: form.get('minimumPoints') || 0,
    color: cleanText(form.get('color')) || null,
    isActive: form.get('isActive') === 'on',
  })
}

export async function createLevel(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('users:write')
  const parsed = parseLevel(form)
  try {
    await db.transaction(async (tx) => {
      const [created] = await tx.insert(levels).values(parsed).returning()
      if (!created) throw new Error('تعذر إنشاء المستوى.')
      await synchronizeAllUserLevels(tx)
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'level.create',
          entityType: 'level',
          entityId: String(created.id),
          after: created,
        },
        context,
      )
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'يوجد مستوى بالاسم أو الترتيب نفسه.' }
    throw error
  }
  refreshAdmin()
  return { ok: true, message: 'تم إنشاء المستوى.' }
}

export async function updateLevel(levelIdValue: number, form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('users:write')
  const levelId = positiveId.parse(levelIdValue)
  const parsed = parseLevel(form)
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(levels).where(eq(levels.id, levelId)).limit(1)
      if (!before) throw new Error('المستوى غير موجود.')
      const [after] = await tx
        .update(levels)
        .set({ ...parsed, updatedAt: new Date() })
        .where(eq(levels.id, levelId))
        .returning()
      if (!after) throw new Error('تعذر تعديل المستوى.')
      await synchronizeAllUserLevels(tx)
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'level.update',
          entityType: 'level',
          entityId: String(levelId),
          before,
          after,
        },
        context,
      )
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'يوجد مستوى بالاسم أو الترتيب نفسه.' }
    throw error
  }
  refreshAdmin()
  return { ok: true, message: 'تم تعديل المستوى.' }
}

export async function toggleLevel(levelIdValue: number): Promise<Result> {
  const { actor, context } = await authorizeMutation('users:write')
  const levelId = positiveId.parse(levelIdValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(levels).where(eq(levels.id, levelId)).limit(1)
    if (!before) throw new Error('المستوى غير موجود.')
    const [after] = await tx
      .update(levels)
      .set({
        isActive: !before.isActive,
        updatedAt: new Date(),
      })
      .where(eq(levels.id, levelId))
      .returning()
    await synchronizeAllUserLevels(tx)
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'level.toggle',
        entityType: 'level',
        entityId: String(levelId),
        before,
        after,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم تحديث حالة المستوى.' }
}

export async function deleteLevel(levelIdValue: number, reasonValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('users:write')
  const levelId = positiveId.parse(levelIdValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(levels).where(eq(levels.id, levelId)).limit(1)
    if (!before) throw new Error('المستوى غير موجود.')
    const [[profileUsage], [ruleUsage]] = await Promise.all([
      tx
        .select({ id: userAdminProfiles.userId })
        .from(userAdminProfiles)
        .where(eq(userAdminProfiles.levelId, levelId))
        .limit(1),
      tx
        .select({ id: promotionRules.id })
        .from(promotionRules)
        .where(eq(promotionRules.targetLevelId, levelId))
        .limit(1),
    ])
    if (profileUsage || ruleUsage)
      throw new Error('لا يمكن حذف مستوى مرتبط بمستخدمين أو قواعد ترقية. عطّله بدلًا من ذلك.')
    await tx.delete(levels).where(eq(levels.id, levelId))
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'level.delete',
        entityType: 'level',
        entityId: String(levelId),
        before,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم حذف المستوى غير المستخدم.' }
}

const competitionFormSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().min(2).max(2_000),
  rules: z.string().trim().max(5_000).nullable(),
  scope: z.enum(['all', 'en', 'ar', 'math']),
  lifecycle: z.enum(['draft', 'scheduled', 'active', 'ended', 'cancelled']),
  audience: z.enum(['all', 'verified', 'new_users', 'existing_users']),
  priority: z.coerce.number().int().min(1).max(100_000),
  requiresVerifiedEmail: z.boolean(),
  sectionId: positiveId.nullable(),
  mathSectionIds: z.array(positiveId).max(100),
  questionCount: z.coerce.number().int().min(1).max(30),
  xpReward: z.coerce.number().int().min(0).max(100_000),
  coinReward: z.coerce.number().int().min(0).max(100_000),
  startsAt: z.date().nullable(),
  endsAt: z.date().nullable(),
  isActive: z.boolean(),
  categoryIds: z.array(positiveId).max(100),
})

type ParsedCompetition = z.infer<typeof competitionFormSchema>

function parseManagedCompetition(form: FormData): ParsedCompetition {
  const categoryIds = [...new Set(form.getAll('categoryIds').map((value) => Number(value)).filter(Boolean))]
  const mathSectionIds = [
    ...new Set(
      [...form.getAll('mathSectionIds'), form.get('sectionId')]
        .map((value) => Number(value))
        .filter(Boolean),
    ),
  ]
  const lifecycle = String(form.get('lifecycle') || 'draft')
  const parsed = competitionFormSchema.parse({
    title: form.get('title'),
    description: form.get('description'),
    rules: cleanText(form.get('rules')) || null,
    scope: form.get('scope') || 'all',
    lifecycle,
    audience: form.get('audience') || 'all',
    priority: form.get('priority') || 100,
    requiresVerifiedEmail: form.get('requiresVerifiedEmail') === 'on',
    sectionId: mathSectionIds[0] ?? null,
    mathSectionIds,
    questionCount: form.get('questionCount') || 10,
    xpReward: form.get('xpReward') || 100,
    coinReward: form.get('coinReward') || 0,
    startsAt: nullableDate(form.get('startsAt')),
    endsAt: nullableDate(form.get('endsAt')),
    isActive: lifecycle === 'scheduled' || lifecycle === 'active',
    categoryIds,
  })
  if (parsed.startsAt && parsed.endsAt && parsed.endsAt <= parsed.startsAt)
    throw new Error('يجب أن يكون وقت النهاية بعد وقت البداية.')
  if (parsed.lifecycle === 'scheduled' && !parsed.startsAt)
    throw new Error('المنافسة المجدولة تحتاج إلى موعد بداية.')
  if (parsed.scope === 'en' || parsed.scope === 'ar') {
    parsed.sectionId = null
    parsed.mathSectionIds = []
  }
  if (parsed.scope === 'math') parsed.categoryIds = []
  if ((parsed.scope === 'math' || parsed.scope === 'all') && !parsed.mathSectionIds.length)
    throw new Error('اختر قسم رياضيات واحدًا على الأقل للنطاق الرياضي أو المختلط.')
  if ((parsed.scope === 'en' || parsed.scope === 'ar') && !parsed.categoryIds.length)
    throw new Error('اختر قسم أسئلة لغويًا واحدًا على الأقل.')
  return parsed
}

async function validateCompetitionReferences(tx: DbTransaction, parsed: ParsedCompetition) {
  if (parsed.mathSectionIds.length) {
    const mathRows = await tx
      .select({ id: mathSections.id })
      .from(mathSections)
      .where(and(inArray(mathSections.id, parsed.mathSectionIds), eq(mathSections.isActive, true)))
    if (mathRows.length !== parsed.mathSectionIds.length)
      throw new Error('بعض أقسام الرياضيات المحددة غير متاحة.')
  }
  if (!parsed.categoryIds.length) return
  const rows = await tx
    .select({ id: categories.id, language: categories.language })
    .from(categories)
    .where(
      and(
        inArray(categories.id, parsed.categoryIds),
        eq(categories.scope, 'platform'),
        eq(categories.isActive, true),
        isNull(categories.userId),
      ),
    )
  if (rows.length !== parsed.categoryIds.length) throw new Error('بعض أقسام الأسئلة غير صالحة أو غير نشطة.')
  const allowedLanguages = parsed.scope === 'all' ? new Set(['en', 'ar']) : new Set([parsed.scope])
  if (rows.some((row) => !allowedLanguages.has(row.language)))
    throw new Error('أقسام الأسئلة المختارة لا تطابق نطاق المنافسة.')
}

export async function createManagedCompetition(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('competitions:write')
  const parsed = parseManagedCompetition(form)
  const { categoryIds, mathSectionIds, ...record } = parsed
  try {
    await db.transaction(async (tx) => {
      await validateCompetitionReferences(tx, parsed)
      const [created] = await tx
        .insert(competitions)
        .values({ ...record, normalizedTitle: normalizeText(record.title) })
        .returning()
      if (!created) throw new Error('تعذر إنشاء المنافسة.')
      if (categoryIds.length)
        await tx
          .insert(competitionCategories)
          .values(categoryIds.map((categoryId) => ({ competitionId: created.id, categoryId })))
      if (mathSectionIds.length)
        await tx
          .insert(competitionMathSections)
          .values(mathSectionIds.map((sectionId) => ({ competitionId: created.id, sectionId })))
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'competition.create',
          entityType: 'competition',
          entityId: String(created.id),
          after: { ...created, categoryIds, mathSectionIds },
        },
        context,
      )
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'توجد منافسة بالعنوان نفسه.' }
    throw error
  }
  refreshAdmin()
  revalidatePath('/competitions')
  return { ok: true, message: 'تم إنشاء المنافسة وربطها بأقسام الأسئلة.' }
}

export async function updateManagedCompetition(
  competitionIdValue: number,
  form: FormData,
): Promise<Result> {
  const { actor, context } = await authorizeMutation('competitions:write')
  const competitionId = positiveId.parse(competitionIdValue)
  const parsed = parseManagedCompetition(form)
  const reason = z.string().trim().min(5).max(500).parse(form.get('reason'))
  const { categoryIds, mathSectionIds, ...record } = parsed
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(competitions).where(eq(competitions.id, competitionId)).limit(1)
      if (!before) throw new Error('المنافسة غير موجودة.')
      await validateCompetitionReferences(tx, parsed)
      const [after] = await tx
        .update(competitions)
        .set({ ...record, normalizedTitle: normalizeText(record.title), updatedAt: new Date() })
        .where(eq(competitions.id, competitionId))
        .returning()
      await tx.delete(competitionCategories).where(eq(competitionCategories.competitionId, competitionId))
      await tx.delete(competitionMathSections).where(eq(competitionMathSections.competitionId, competitionId))
      if (categoryIds.length)
        await tx
          .insert(competitionCategories)
          .values(categoryIds.map((categoryId) => ({ competitionId, categoryId })))
      if (mathSectionIds.length)
        await tx
          .insert(competitionMathSections)
          .values(mathSectionIds.map((sectionId) => ({ competitionId, sectionId })))
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'competition.update',
          entityType: 'competition',
          entityId: String(competitionId),
          before,
          after: { ...after, categoryIds, mathSectionIds },
          reason,
        },
        context,
      )
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'توجد منافسة بالعنوان نفسه.' }
    throw error
  }
  refreshAdmin()
  revalidatePath('/competitions')
  return { ok: true, message: 'تم تعديل المنافسة.' }
}

export async function toggleManagedCompetition(competitionIdValue: number): Promise<Result> {
  const { actor, context } = await authorizeMutation('competitions:write')
  const competitionId = positiveId.parse(competitionIdValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(competitions).where(eq(competitions.id, competitionId)).limit(1)
    if (!before) throw new Error('المنافسة غير موجودة.')
    const [after] = await tx
      .update(competitions)
      .set({ isActive: !before.isActive, updatedAt: new Date() })
      .where(eq(competitions.id, competitionId))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'competition.toggle',
        entityType: 'competition',
        entityId: String(competitionId),
        before,
        after,
      },
      context,
    )
  })
  refreshAdmin()
  revalidatePath('/competitions')
  return { ok: true, message: 'تم تحديث حالة المنافسة.' }
}

export async function deleteManagedCompetition(
  competitionIdValue: number,
  reasonValue: string,
): Promise<Result> {
  const { actor, context } = await authorizeMutation('competitions:write')
  const competitionId = positiveId.parse(competitionIdValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(competitions).where(eq(competitions.id, competitionId)).limit(1)
    if (!before) throw new Error('المنافسة غير موجودة.')
    const [usage] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(competitionParticipants)
      .where(eq(competitionParticipants.competitionId, competitionId))
    if ((usage?.count ?? 0) > 0)
      throw new Error('لا يمكن حذف منافسة لها مشاركون. عطّلها للحفاظ على النتائج والسجل.')
    await tx.delete(competitions).where(eq(competitions.id, competitionId))
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'competition.delete',
        entityType: 'competition',
        entityId: String(competitionId),
        before,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  revalidatePath('/competitions')
  return { ok: true, message: 'تم حذف المنافسة التي لم تبدأ.' }
}

export async function setCompetitionParticipantStatus(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('competitions:write')
  const participantId = positiveId.parse(form.get('participantId'))
  const requestedStatus = z.enum(['joined', 'active', 'disqualified']).parse(form.get('status'))
  const reason = z.string().trim().min(5).max(500).parse(form.get('reason'))
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${participantId})`)
    const [before] = await tx
      .select()
      .from(competitionParticipants)
      .where(eq(competitionParticipants.id, participantId))
      .limit(1)
    if (!before) throw new Error('المشارك غير موجود.')
    if (!['joined', 'active', 'disqualified'].includes(before.status))
      throw new Error('لا يمكن تغيير هذه المشاركة أثناء التصحيح أو بعد التسليم أو انتهاء المهلة.')
    const status =
      requestedStatus === 'joined' && before.status === 'disqualified' && before.startedAt
        ? 'active'
        : requestedStatus
    const [after] = await tx
      .update(competitionParticipants)
      .set({ status, updatedAt: new Date() })
      .where(eq(competitionParticipants.id, participantId))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'competition.participant.status',
        entityType: 'competitionParticipant',
        entityId: String(participantId),
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  revalidatePath('/competitions')
  return { ok: true, message: 'تم تحديث حالة المشارك.' }
}


export async function createManagedChallenge(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('competitions:write')
  const parsed = z
    .object({
      title: z.string().trim().min(3).max(160),
      description: z.string().trim().min(5).max(5_000),
      sectionId: uuid.nullable(),
      imageMediaId: uuid.nullable(),
      metric: z.enum(['words', 'sentences', 'reviews', 'streak']),
      target: z.coerce.number().int().positive().max(1_000_000),
      xpReward: z.coerce.number().int().min(0).max(1_000_000),
      coinReward: z.coerce.number().int().min(0).max(1_000_000),
      status: lifecycle,
      competitionType: z.enum(['progress', 'speed', 'accuracy', 'streak']),
      minimumParticipants: z.coerce.number().int().positive(),
      maximumParticipants: z.coerce.number().int().positive().nullable(),
      winnerCount: z.coerce.number().int().positive().max(100),
    })
    .parse({
      title: form.get('title'),
      description: form.get('description'),
      sectionId: cleanText(form.get('sectionId')) || null,
      imageMediaId: cleanText(form.get('imageMediaId')) || null,
      metric: form.get('metric') || 'words',
      target: form.get('target'),
      xpReward: form.get('xpReward') || 0,
      coinReward: form.get('coinReward') || 0,
      status: form.get('status') || 'draft',
      competitionType: form.get('competitionType') || 'progress',
      minimumParticipants: form.get('minimumParticipants') || 1,
      maximumParticipants: cleanText(form.get('maximumParticipants'))
        ? Number(form.get('maximumParticipants'))
        : null,
      winnerCount: form.get('winnerCount') || 1,
    })
  const startsAt = nullableDate(form.get('startsAt'))
  const endsAt = nullableDate(form.get('endsAt'))
  const ruleConfiguration = parseManagedChallengeRules(form)
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error('وقت النهاية يجب أن يلي البداية.')
  if (parsed.maximumParticipants && parsed.maximumParticipants < parsed.minimumParticipants)
    throw new Error('الحد الأقصى للمشاركين يجب ألا يقل عن الحد الأدنى.')
  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(challenges)
        .values({
          title: parsed.title,
          normalizedTitle: normalizeText(parsed.title),
          description: parsed.description,
          metric: parsed.metric,
          target: parsed.target,
          xpReward: parsed.xpReward,
          coinReward: parsed.coinReward,
          startsAt,
          endsAt,
          isActive: ['scheduled', 'open', 'active'].includes(parsed.status),
        })
        .returning()
      if (!created) throw new Error('تعذر إنشاء التحدي.')
      await tx.insert(challengeSettings).values({
        challengeId: created.id,
        sectionId: parsed.sectionId,
        imageMediaId: parsed.imageMediaId,
        lifecycle: parsed.status,
        competitionType: parsed.competitionType,
        participationRules: ruleConfiguration.participationRules,
        minimumParticipants: parsed.minimumParticipants,
        maximumParticipants: parsed.maximumParticipants,
        scoringRules: ruleConfiguration.scoringRules,
        winningRules: ruleConfiguration.winningRules,
        winnerCount: parsed.winnerCount,
        updatedBy: actor.id,
      })
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'challenge.create',
          entityType: 'challenge',
          entityId: String(created.id),
          after: { ...created, lifecycle: parsed.status },
        },
        context,
      )
    })
    refreshAdmin()
    return { ok: true, message: 'تم إنشاء التحدي.' }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'يوجد تحدٍ بالاسم نفسه.' }
    throw error
  }
}

export async function updateManagedChallenge(challengeIdValue: number, form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('competitions:write')
  const challengeId = positiveId.parse(challengeIdValue)
  const parsed = z
    .object({
      title: z.string().trim().min(3).max(160),
      description: z.string().trim().min(5).max(5_000),
      sectionId: uuid.nullable(),
      imageMediaId: uuid.nullable(),
      metric: z.enum(['words', 'sentences', 'reviews', 'streak']),
      target: z.coerce.number().int().positive().max(1_000_000),
      xpReward: z.coerce.number().int().min(0).max(1_000_000),
      coinReward: z.coerce.number().int().min(0).max(1_000_000),
      competitionType: z.enum(['progress', 'speed', 'accuracy', 'streak']),
      minimumParticipants: z.coerce.number().int().positive(),
      maximumParticipants: z.coerce.number().int().positive().nullable(),
      winnerCount: z.coerce.number().int().positive().max(100),
      prizeBadgeId: uuid.nullable(),
    })
    .parse({
      title: form.get('title'),
      description: form.get('description'),
      sectionId: cleanText(form.get('sectionId')) || null,
      imageMediaId: cleanText(form.get('imageMediaId')) || null,
      metric: form.get('metric'),
      target: form.get('target'),
      xpReward: form.get('xpReward') || 0,
      coinReward: form.get('coinReward') || 0,
      competitionType: form.get('competitionType') || 'progress',
      minimumParticipants: form.get('minimumParticipants') || 1,
      maximumParticipants: cleanText(form.get('maximumParticipants'))
        ? Number(form.get('maximumParticipants'))
        : null,
      winnerCount: form.get('winnerCount') || 1,
      prizeBadgeId: cleanText(form.get('prizeBadgeId')) || null,
    })
  const startsAt = nullableDate(form.get('startsAt'))
  const endsAt = nullableDate(form.get('endsAt'))
  const ruleConfiguration = parseManagedChallengeRules(form)
  const reason = z.string().trim().min(5).max(500).parse(form.get('reason'))
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error('وقت النهاية يجب أن يلي البداية.')
  if (parsed.maximumParticipants && parsed.maximumParticipants < parsed.minimumParticipants)
    throw new Error('الحد الأقصى للمشاركين يجب ألا يقل عن الحد الأدنى.')

  try {
    await db.transaction(async (tx) => {
      const [resultCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(challengeResults)
        .where(eq(challengeResults.challengeId, challengeId))
      if ((resultCount?.count ?? 0) > 0)
        throw new Error('لا يمكن تعديل تحدٍ بعد اعتماد نتائجه. أنشئ نسخة جديدة بدلًا من ذلك.')
      const [beforeChallenge] = await tx
        .select()
        .from(challenges)
        .where(eq(challenges.id, challengeId))
        .limit(1)
      const [beforeSettings] = await tx
        .select()
        .from(challengeSettings)
        .where(eq(challengeSettings.challengeId, challengeId))
        .limit(1)
      if (!beforeChallenge || !beforeSettings) throw new Error('التحدي غير موجود.')
      const [afterChallenge] = await tx
        .update(challenges)
        .set({
          title: parsed.title,
          normalizedTitle: normalizeText(parsed.title),
          description: parsed.description,
          metric: parsed.metric,
          target: parsed.target,
          xpReward: parsed.xpReward,
          coinReward: parsed.coinReward,
          startsAt,
          endsAt,
          updatedAt: new Date(),
        })
        .where(eq(challenges.id, challengeId))
        .returning()
      const [afterSettings] = await tx
        .update(challengeSettings)
        .set({
          sectionId: parsed.sectionId,
          imageMediaId: parsed.imageMediaId,
          competitionType: parsed.competitionType,
          participationRules: ruleConfiguration.participationRules,
          minimumParticipants: parsed.minimumParticipants,
          maximumParticipants: parsed.maximumParticipants,
          scoringRules: ruleConfiguration.scoringRules,
          winningRules: ruleConfiguration.winningRules,
          prizeBadgeId: parsed.prizeBadgeId,
          winnerCount: parsed.winnerCount,
          updatedBy: actor.id,
          updatedAt: new Date(),
        })
        .where(eq(challengeSettings.challengeId, challengeId))
        .returning()
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'challenge.update',
          entityType: 'challenge',
          entityId: String(challengeId),
          before: { challenge: beforeChallenge, settings: beforeSettings },
          after: { challenge: afterChallenge, settings: afterSettings },
          reason,
        },
        context,
      )
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'يوجد تحدٍ بالاسم نفسه.' }
    throw error
  }
  refreshAdmin()
  return { ok: true, message: 'تم تحديث التحدي وتسجيل التغييرات.' }
}

export async function duplicateManagedChallenge(challengeIdValue: number): Promise<Result> {
  const { actor, context } = await authorizeMutation('competitions:write')
  const challengeId = positiveId.parse(challengeIdValue)
  const newId = await db.transaction(async (tx) => {
    const [source] = await tx.select().from(challenges).where(eq(challenges.id, challengeId)).limit(1)
    const [settings] = await tx
      .select()
      .from(challengeSettings)
      .where(eq(challengeSettings.challengeId, challengeId))
      .limit(1)
    if (!source || !settings) throw new Error('التحدي غير موجود.')
    const title = `نسخة من ${source.title} ${randomUUID().slice(0, 8)}`
    const [created] = await tx
      .insert(challenges)
      .values({
        title,
        normalizedTitle: normalizeText(title),
        description: source.description,
        metric: source.metric,
        target: source.target,
        xpReward: source.xpReward,
        coinReward: source.coinReward,
        badgeName: source.badgeName,
        isActive: false,
      })
      .returning({ id: challenges.id })
    if (!created) throw new Error('تعذر نسخ التحدي.')
    await tx.insert(challengeSettings).values({
      challengeId: created.id,
      sectionId: settings.sectionId,
      imageMediaId: settings.imageMediaId,
      lifecycle: 'draft',
      competitionType: settings.competitionType,
      participationRules: settings.participationRules,
      minimumParticipants: settings.minimumParticipants,
      maximumParticipants: settings.maximumParticipants,
      scoringRules: settings.scoringRules,
      winningRules: settings.winningRules,
      prizeBadgeId: settings.prizeBadgeId,
      winnerCount: settings.winnerCount,
      updatedBy: actor.id,
    })
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'challenge.duplicate',
        entityType: 'challenge',
        entityId: String(created.id),
        after: { sourceChallengeId: challengeId, title },
      },
      context,
    )
    return created.id
  })
  refreshAdmin()
  return { ok: true, message: `تم إنشاء نسخة مسودة برقم ${newId}.` }
}

export async function changeChallengeLifecycle(
  challengeIdValue: number,
  lifecycleValue: string,
  reasonValue = '',
): Promise<Result> {
  const { actor, context } = await authorizeMutation('competitions:write')
  const challengeId = positiveId.parse(challengeIdValue)
  const next = lifecycle.parse(lifecycleValue)
  const reason = cleanText(reasonValue)
  if (['cancelled', 'ended'].includes(next) && reason.length < 5)
    throw new Error('أدخل سببًا واضحًا لإنهاء أو إلغاء التحدي.')
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(challengeSettings)
      .where(eq(challengeSettings.challengeId, challengeId))
      .limit(1)
    if (!before) throw new Error('إعدادات التحدي غير موجودة.')
    const [after] = await tx
      .update(challengeSettings)
      .set({ lifecycle: next, updatedBy: actor.id, updatedAt: new Date() })
      .where(eq(challengeSettings.challengeId, challengeId))
      .returning()
    await tx
      .update(challenges)
      .set({ isActive: ['scheduled', 'open', 'active'].includes(next), updatedAt: new Date() })
      .where(eq(challenges.id, challengeId))
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'challenge.lifecycle.update',
        entityType: 'challenge',
        entityId: String(challengeId),
        before: { lifecycle: before.lifecycle },
        after: { lifecycle: after?.lifecycle },
        reason: reason || null,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم تحديث حالة التحدي.' }
}

export async function excludeChallengeParticipant(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('competitions:write')
  const participantId = positiveId.parse(form.get('participantId'))
  const reason = z.string().trim().min(5).max(500).parse(form.get('reason'))
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(challengeParticipants)
      .where(eq(challengeParticipants.id, participantId))
      .limit(1)
    if (!before) throw new Error('المشارك غير موجود.')
    const [after] = await tx
      .update(challengeParticipants)
      .set({ status: 'disqualified' })
      .where(eq(challengeParticipants.id, participantId))
      .returning()
    await tx.insert(challengeModeration).values({
      participantId,
      action: 'exclude',
      reason,
      actorUserId: actor.id,
    })
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'challenge.participant.exclude',
        entityType: 'challengeParticipant',
        entityId: String(participantId),
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم استبعاد المشارك وتسجيل السبب.' }
}

export async function reinstateChallengeParticipant(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('competitions:write')
  const participantId = positiveId.parse(form.get('participantId'))
  const reason = z.string().trim().min(5).max(500).parse(form.get('reason'))
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(challengeParticipants)
      .where(eq(challengeParticipants.id, participantId))
      .limit(1)
    if (!before || before.status !== 'disqualified') throw new Error('المشارك غير مستبعد.')
    const [after] = await tx
      .update(challengeParticipants)
      .set({ status: 'active' })
      .where(eq(challengeParticipants.id, participantId))
      .returning()
    await tx
      .insert(challengeModeration)
      .values({ participantId, action: 'reinstate', reason, actorUserId: actor.id })
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'challenge.participant.reinstate',
        entityType: 'challengeParticipant',
        entityId: String(participantId),
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تمت إعادة المشارك وتسجيل القرار.' }
}

export async function approveChallengeWinners(
  challengeIdValue: number,
  reasonValue: string,
): Promise<Result> {
  const { actor, context } = await authorizeMutation('competitions:write')
  const challengeId = positiveId.parse(challengeIdValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  const approved = await db.transaction(async (tx) => {
    const [settings] = await tx
      .select()
      .from(challengeSettings)
      .where(eq(challengeSettings.challengeId, challengeId))
      .limit(1)
    if (!settings) throw new Error('إعدادات التحدي غير موجودة.')
    const [challenge] = await tx
      .select({ xpReward: challenges.xpReward, coinReward: challenges.coinReward })
      .from(challenges)
      .where(eq(challenges.id, challengeId))
      .limit(1)
    if (!challenge) throw new Error('التحدي غير موجود.')
    const [existing] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(challengeResults)
      .where(eq(challengeResults.challengeId, challengeId))
    if ((existing?.count ?? 0) > 0) return false
    const participants = await tx
      .select({
        id: challengeParticipants.id,
        userId: challengeParticipants.userId,
        progress: challengeParticipants.progress,
        joinedAt: challengeParticipants.joinedAt,
        completedAt: challengeParticipants.completedAt,
      })
      .from(challengeParticipants)
      .where(
        and(
          eq(challengeParticipants.challengeId, challengeId),
          eq(challengeParticipants.status, 'completed'),
        ),
      )
      .limit(10_000)
    if (!participants.length) throw new Error('لا توجد نتائج مكتملة لاعتمادها.')
    const multiplier =
      typeof settings.scoringRules?.multiplier === 'number' && settings.scoringRules.multiplier > 0
        ? settings.scoringRules.multiplier
        : 1
    const tieBreaker =
      typeof settings.winningRules?.tieBreaker === 'string'
        ? settings.winningRules.tieBreaker
        : 'earliest_completion'
    const rankedParticipants = participants
      .map((participant) => ({
        ...participant,
        score: Math.max(0, Math.round(participant.progress * multiplier)),
      }))
      .sort((first, second) => {
        if (second.score !== first.score) return second.score - first.score
        if (tieBreaker === 'earliest_join') return first.joinedAt.getTime() - second.joinedAt.getTime()
        if (tieBreaker === 'highest_progress') return second.progress - first.progress
        return (
          (first.completedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
          (second.completedAt?.getTime() ?? Number.MAX_SAFE_INTEGER)
        )
      })
    const now = new Date()
    const results = await tx
      .insert(challengeResults)
      .values(
        rankedParticipants.map((participant, index) => ({
          challengeId,
          participantId: participant.id,
          score: participant.score,
          rank: index + 1,
          isWinner: index < settings.winnerCount,
          approvedBy: actor.id,
          approvedAt: now,
          rewardGrantedAt: index < settings.winnerCount ? now : null,
        })),
      )
      .returning()
    if (settings.prizeBadgeId) {
      for (const [index, participant] of rankedParticipants.entries()) {
        if (index >= settings.winnerCount) break
        await grantBadgeTx(tx, {
          userId: participant.userId,
          badgeId: settings.prizeBadgeId,
          actorUserId: actor.id,
          reason: `الفوز في التحدي ${challengeId}`,
          sourceType: 'challenge-winner',
          sourceId: String(challengeId),
          repeatKey: `challenge:${challengeId}`,
        })
      }
    }
    for (const [index, participant] of rankedParticipants.entries()) {
      if (index >= settings.winnerCount) break
      const [ledger] = await tx
        .insert(rewardLedger)
        .values({
          userId: participant.userId,
          sourceType: 'challenge',
          sourceId: String(challengeId),
          xp: challenge.xpReward,
          coins: challenge.coinReward,
          metadata: { rank: index + 1 },
        })
        .onConflictDoNothing()
        .returning({ id: rewardLedger.id })
      if (ledger)
        await tx
          .insert(userProgress)
          .values({ userId: participant.userId, xp: challenge.xpReward, coins: challenge.coinReward })
          .onConflictDoUpdate({
            target: userProgress.userId,
            set: {
              xp: sql`${userProgress.xp} + ${challenge.xpReward}`,
              coins: sql`${userProgress.coins} + ${challenge.coinReward}`,
              updatedAt: now,
            },
          })
    }
    const winnerParticipantIds = rankedParticipants.slice(0, settings.winnerCount).map((item) => item.id)
    if (winnerParticipantIds.length)
      await tx
        .update(challengeParticipants)
        .set({ rewardedAt: now })
        .where(inArray(challengeParticipants.id, winnerParticipantIds))
    await tx
      .update(challengeSettings)
      .set({ lifecycle: 'ended', updatedBy: actor.id, updatedAt: now })
      .where(eq(challengeSettings.challengeId, challengeId))
    await tx.update(challenges).set({ isActive: false, updatedAt: now }).where(eq(challenges.id, challengeId))
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'challenge.results.approve',
        entityType: 'challenge',
        entityId: String(challengeId),
        after: { resultCount: results.length, winnerCount: settings.winnerCount },
        reason,
      },
      context,
    )
    return true
  })
  refreshAdmin()
  return approved
    ? { ok: true, message: 'تم اعتماد النتائج والفائزين دون تكرار.' }
    : { ok: false, message: 'تم اعتماد نتائج هذا التحدي مسبقًا.' }
}

export async function unapproveChallengeResults(
  challengeIdValue: number,
  reasonValue: string,
): Promise<Result> {
  const { actor, context } = await authorizeMutation('competitions:write')
  const challengeId = positiveId.parse(challengeIdValue)
  const reason = z.string().trim().min(10).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const resultRows = await tx
      .select({
        participantId: challengeResults.participantId,
        userId: challengeParticipants.userId,
        isWinner: challengeResults.isWinner,
      })
      .from(challengeResults)
      .innerJoin(challengeParticipants, eq(challengeParticipants.id, challengeResults.participantId))
      .where(eq(challengeResults.challengeId, challengeId))
    if (!resultRows.length) throw new Error('لا توجد نتائج معتمدة لإلغاء اعتمادها.')
    const ledgers = await tx
      .select()
      .from(rewardLedger)
      .where(and(eq(rewardLedger.sourceType, 'challenge'), eq(rewardLedger.sourceId, String(challengeId))))
    for (const ledger of ledgers) {
      const [progress] = await tx
        .select({ xp: userProgress.xp, coins: userProgress.coins })
        .from(userProgress)
        .where(eq(userProgress.userId, ledger.userId))
        .limit(1)
      if (!progress || progress.xp < ledger.xp || progress.coins < ledger.coins)
        throw new Error('لا يمكن إلغاء الاعتماد بأمان لأن إحدى المكافآت استُهلكت أو أصبح الرصيد أقل منها.')
      await tx
        .update(userProgress)
        .set({
          xp: sql`${userProgress.xp} - ${ledger.xp}`,
          coins: sql`${userProgress.coins} - ${ledger.coins}`,
          updatedAt: new Date(),
        })
        .where(eq(userProgress.userId, ledger.userId))
    }
    if (ledgers.length)
      await tx.delete(rewardLedger).where(
        inArray(
          rewardLedger.id,
          ledgers.map((item) => item.id),
        ),
      )
    await tx
      .delete(userBadges)
      .where(and(eq(userBadges.sourceType, 'challenge-winner'), eq(userBadges.sourceId, String(challengeId))))
    await tx
      .update(challengeParticipants)
      .set({ rewardedAt: null })
      .where(
        inArray(
          challengeParticipants.id,
          resultRows.map((item) => item.participantId),
        ),
      )
    await tx.delete(challengeResults).where(eq(challengeResults.challengeId, challengeId))
    await tx
      .update(challengeSettings)
      .set({ lifecycle: 'paused', updatedBy: actor.id, updatedAt: new Date() })
      .where(eq(challengeSettings.challengeId, challengeId))
    await tx
      .update(challenges)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(challenges.id, challengeId))
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'challenge.results.unapprove',
        entityType: 'challenge',
        entityId: String(challengeId),
        before: { resultCount: resultRows.length, rewardCount: ledgers.length },
        after: { lifecycle: 'paused', resultsRemoved: true },
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم إلغاء اعتماد النتائج وسحب المكافآت بأمان، وأصبح التحدي متوقفًا مؤقتًا.' }
}

async function assertActorStillAdministrator(tx: DbTransaction, actorId: string) {
  const [current] = await tx
    .select({
      role: user.role,
      emailVerified: user.emailVerified,
      banned: user.banned,
      deletedAt: user.deletedAt,
      managedStatus: userAdminProfiles.status,
      suspendedUntil: userAdminProfiles.suspendedUntil,
    })
    .from(user)
    .leftJoin(userAdminProfiles, eq(userAdminProfiles.userId, user.id))
    .where(eq(user.id, actorId))
    .limit(1)
  const currentlySuspended =
    current?.managedStatus === 'suspended' &&
    (!current.suspendedUntil || current.suspendedUntil.getTime() > Date.now())
  if (
    !current ||
    current.deletedAt ||
    current.role !== 'admin' ||
    !current.emailVerified ||
    current.banned ||
    current.managedStatus === 'disabled' ||
    current.managedStatus === 'banned' ||
    currentlySuspended
  ) {
    throw new ForbiddenError('انتهت صلاحيتك الإدارية قبل تنفيذ العملية. حدّث الصفحة وسجّل الدخول مجددًا.')
  }
}

async function assertNotLastActiveAdministrator(tx: DbTransaction, targetUserId: string) {
  const result = await tx.execute<{ count: number }>(sql`
    select count(*)::int as count
    from ${user} u
    left join ${userAdminProfiles} p on p.${userAdminProfiles.userId} = u.${user.id}
    where u.${user.role} = 'admin'
      and u.${user.emailVerified} = true
      and u.${user.banned} = false
      and u.${user.deletedAt} is null
      and (
        p.${userAdminProfiles.status} is null
        or p.${userAdminProfiles.status} = 'active'
        or (
          p.${userAdminProfiles.status} = 'suspended'
          and p.${userAdminProfiles.suspendedUntil} is not null
          and p.${userAdminProfiles.suspendedUntil} <= now()
        )
      )
      and u.${user.id} <> ${targetUserId}
  `)
  if ((result.rows[0]?.count ?? 0) < 1) {
    throw new Error('لا يمكن تعطيل أو تخفيض آخر مدير نشط في المنصة.')
  }
}

const accountStatus = z.enum(['active', 'disabled', 'suspended', 'banned'])

export async function updateManagedUserStatus(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('users:write')
  const userId = z.string().min(1).max(200).parse(form.get('userId'))
  const status = accountStatus.parse(form.get('status'))
  const reason = z.string().trim().min(5).max(500).parse(form.get('reason'))
  const suspendedUntil = status === 'suspended' ? nullableDate(form.get('suspendedUntil')) : null
  if (actor.id === userId) throw new Error('لا يمكنك تغيير حالة حساب المدير الرئيسي.')
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('lughati-admin-role-management'))`)
    await assertActorStillAdministrator(tx, actor.id)
    const [target] = await tx.select().from(user).where(eq(user.id, userId)).limit(1)
    if (!target || target.deletedAt) throw new Error('المستخدم غير موجود.')
    if (target.role === 'admin' && status !== 'active') {
      await assertNotLastActiveAdministrator(tx, userId)
    }
    const [before] = await tx
      .select()
      .from(userAdminProfiles)
      .where(eq(userAdminProfiles.userId, userId))
      .limit(1)
    await tx
      .insert(userAdminProfiles)
      .values({ userId, status, suspendedUntil, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: userAdminProfiles.userId,
        set: { status, suspendedUntil, updatedBy: actor.id, updatedAt: new Date() },
      })
    const banned = status === 'banned'
    await tx
      .update(user)
      .set({ banned, banReason: banned ? reason : null, updatedAt: new Date() })
      .where(eq(user.id, userId))
    if (status !== 'active') await tx.delete(session).where(eq(session.userId, userId))
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'user.status.update',
        entityType: 'user',
        entityId: userId,
        before: before ?? { status: 'active' },
        after: { status, suspendedUntil },
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم تحديث حالة الحساب.' }
}

export async function updateUserRole(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('users:write')
  const userId = z.string().min(1).max(200).parse(form.get('userId'))
  const role = z.enum(['user', 'admin']).parse(form.get('role'))
  const reason = z.string().trim().min(5).max(500).parse(form.get('reason'))
  if (actor.id === userId && role !== 'admin') {
    throw new Error('لا يمكنك إزالة صلاحيتك الإدارية بنفسك.')
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('lughati-admin-role-management'))`)
    await assertActorStillAdministrator(tx, actor.id)
    const [target] = await tx
      .select({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        banned: user.banned,
        deletedAt: user.deletedAt,
        managedStatus: userAdminProfiles.status,
      })
      .from(user)
      .leftJoin(userAdminProfiles, eq(userAdminProfiles.userId, user.id))
      .where(eq(user.id, userId))
      .limit(1)
    if (!target || target.deletedAt) throw new Error('المستخدم غير موجود.')
    if (
      role === 'admin' &&
      (!target.emailVerified || target.banned || (target.managedStatus && target.managedStatus !== 'active'))
    ) {
      throw new Error('لا يمكن منح الإدارة لحساب غير موثق أو موقوف أو محظور.')
    }
    if (target.role === 'admin' && role !== 'admin') {
      await assertNotLastActiveAdministrator(tx, userId)
    }

    const [updated] = await tx
      .update(user)
      .set({ role, updatedAt: new Date() })
      .where(and(eq(user.id, userId), isNull(user.deletedAt)))
      .returning({ id: user.id, role: user.role })
    if (!updated) throw new Error('تعذر تحديث صلاحية المستخدم.')

    // adminAllowlist is retained only as legacy bootstrap metadata. Database
    // user.role is the sole authorization source, but keep the legacy record
    // consistent so a demoted account is never represented as active there.
    await tx
      .update(adminAllowlist)
      .set({ isActive: role === 'admin', updatedAt: new Date() })
      .where(sql`lower(trim(${adminAllowlist.email})) = lower(trim(${target.email}))`)

    if (target.role !== role) await tx.delete(session).where(eq(session.userId, userId))
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'user.role.update',
        entityType: 'user',
        entityId: userId,
        before: { role: target.role },
        after: { role },
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: role === 'admin' ? 'تم منح صلاحية المدير.' : 'تمت إزالة صلاحية المدير.' }
}

export async function bulkUpdateManagedUsers(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('users:write')
  const userIds = z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(50)
    .transform((items) => [...new Set(items)])
    .parse(JSON.parse(z.string().max(20_000).parse(form.get('userIds'))))
  const operation = z.enum(['status', 'note']).parse(form.get('operation'))
  const reason = z.string().trim().min(5).max(1_000).parse(form.get('reason'))
  const status = operation === 'status' ? accountStatus.parse(form.get('status')) : null
  const severity =
    operation === 'note'
      ? z.enum(['info', 'warning', 'critical']).parse(form.get('severity') || 'info')
      : null
  if (userIds.includes(actor.id)) throw new Error('لا يمكن تضمين حساب المدير الرئيسي في عملية جماعية.')

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('lughati-admin-role-management'))`)
    await assertActorStillAdministrator(tx, actor.id)
    const targets = await tx
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(and(inArray(user.id, userIds), isNull(user.deletedAt)))
    if (targets.length !== userIds.length) throw new Error('تتضمن القائمة مستخدمًا غير موجود أو محذوفًا.')
    if (operation === 'status' && status !== 'active' && targets.some((target) => target.role === 'admin')) {
      throw new Error('لا يمكن تعطيل حسابات المديرين جماعيًا. استخدم صفحة المستخدم للتحقق من بقاء مدير نشط.')
    }

    if (operation === 'status' && status) {
      for (const target of targets) {
        const [before] = await tx
          .select()
          .from(userAdminProfiles)
          .where(eq(userAdminProfiles.userId, target.id))
          .limit(1)
        await tx
          .insert(userAdminProfiles)
          .values({ userId: target.id, status, updatedBy: actor.id })
          .onConflictDoUpdate({
            target: userAdminProfiles.userId,
            set: { status, suspendedUntil: null, updatedBy: actor.id, updatedAt: new Date() },
          })
        await tx
          .update(user)
          .set({
            banned: status === 'banned',
            banReason: status === 'banned' ? reason : null,
            updatedAt: new Date(),
          })
          .where(eq(user.id, target.id))
        if (status !== 'active') await tx.delete(session).where(eq(session.userId, target.id))
        await writeAdminAudit(
          tx,
          {
            actorUserId: actor.id,
            action: 'user.status.bulk-update',
            entityType: 'user',
            entityId: target.id,
            before: before ?? { status: 'active' },
            after: { status },
            reason,
          },
          context,
        )
      }
    } else if (operation === 'note' && severity) {
      await tx.insert(adminNotes).values(
        targets.map((target) => ({
          userId: target.id,
          note: reason,
          severity,
          createdBy: actor.id,
        })),
      )
      for (const target of targets)
        await writeAdminAudit(
          tx,
          {
            actorUserId: actor.id,
            action: 'user.note.bulk-create',
            entityType: 'user',
            entityId: target.id,
            after: { severity },
            reason,
          },
          context,
        )
    }
  })
  refreshAdmin()
  return { ok: true, message: `تم تطبيق العملية على ${userIds.length} مستخدمًا.` }
}

export async function adjustUserPoints(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const userId = z.string().min(1).max(200).parse(form.get('userId'))
  const delta = z.coerce
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0)
    .parse(form.get('delta'))
  const reason = z.string().trim().min(5).max(500).parse(form.get('reason'))
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ xp: userProgress.xp })
      .from(userProgress)
      .where(eq(userProgress.userId, userId))
      .limit(1)
    const currentXp = before?.xp ?? 0
    const nextXp = currentXp + delta
    if (nextXp < 0) throw new Error('لا يمكن أن تصبح نقاط المستخدم سالبة.')
    await tx
      .insert(userProgress)
      .values({ userId, xp: nextXp })
      .onConflictDoUpdate({ target: userProgress.userId, set: { xp: nextXp, updatedAt: new Date() } })
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'user.points.adjust',
        entityType: 'user',
        entityId: userId,
        before: { xp: currentXp },
        after: { xp: nextXp, delta },
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم تعديل النقاط وتسجيل السبب.' }
}

export async function setUserLevel(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('users:write')
  const userId = z.string().min(1).max(200).parse(form.get('userId'))
  const levelId = positiveId.parse(form.get('levelId'))
  const reason = z.string().trim().min(5).max(500).parse(form.get('reason'))
  const [validLevel] = await db.select({ id: levels.id }).from(levels).where(eq(levels.id, levelId)).limit(1)
  if (!validLevel) throw new Error('المستوى غير موجود.')
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ levelId: userAdminProfiles.levelId })
      .from(userAdminProfiles)
      .where(eq(userAdminProfiles.userId, userId))
      .limit(1)
    await tx
      .insert(userAdminProfiles)
      .values({ userId, levelId, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: userAdminProfiles.userId,
        set: { levelId, updatedBy: actor.id, updatedAt: new Date() },
      })
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'user.level.update',
        entityType: 'user',
        entityId: userId,
        before: before ?? { levelId: null },
        after: { levelId },
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم تحديث مستوى المستخدم.' }
}

export async function addUserAdminNote(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('users:write')
  const userId = z.string().min(1).max(200).parse(form.get('userId'))
  const note = z.string().trim().min(3).max(2_000).parse(form.get('note'))
  const severity = z.enum(['info', 'warning', 'critical']).parse(form.get('severity') || 'info')
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(adminNotes)
      .values({ userId, note, severity, createdBy: actor.id })
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'user.note.create',
        entityType: 'adminNote',
        entityId: created?.id,
        after: { userId, severity },
        reason: note,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تمت إضافة الملاحظة الإدارية.' }
}

export async function recordUserViolation(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('users:write')
  const userId = z.string().min(1).max(200).parse(form.get('userId'))
  const reason = z.string().trim().min(5).max(2_000).parse(form.get('reason'))
  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.id, userId), isNull(user.deletedAt)))
      .limit(1)
    if (!target) throw new Error('المستخدم غير موجود.')
    const [created] = await tx
      .insert(adminNotes)
      .values({ userId, note: reason, severity: 'warning', createdBy: actor.id })
      .returning()
    await tx
      .insert(userAdminProfiles)
      .values({ userId, violationCount: 1, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: userAdminProfiles.userId,
        set: {
          violationCount: sql`${userAdminProfiles.violationCount} + 1`,
          updatedBy: actor.id,
          updatedAt: new Date(),
        },
      })
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'user.violation.record',
        entityType: 'user',
        entityId: userId,
        after: { noteId: created?.id },
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم تسجيل المخالفة.' }
}

export async function resetUserProgress(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('users:write')
  const userId = z.string().min(1).max(200).parse(form.get('userId'))
  const contentId = cleanText(form.get('contentId'))
  const sectionId = cleanText(form.get('sectionId'))
  const reason = z.string().trim().min(5).max(500).parse(form.get('reason'))
  if (Boolean(contentId) === Boolean(sectionId))
    throw new Error('اختر محتوى واحدًا أو قسمًا واحدًا لإعادة التقدم.')
  if (contentId) uuid.parse(contentId)
  if (sectionId) uuid.parse(sectionId)
  const affected = await db.transaction(async (tx) => {
    const before = await tx.execute<{ count: number }>(sql`
      select count(*)::int as count from "userContentProgress" p
      inner join "sectionContents" c on c.id = p."contentId"
      where p."userId" = ${userId}
        and (${contentId || null}::uuid is null or p."contentId" = ${contentId || null}::uuid)
        and (${sectionId || null}::uuid is null or c."sectionId" = ${sectionId || null}::uuid)
    `)
    await tx.execute(sql`
      update "userContentProgress" p set status = 'not_started', progress = 0, score = null,
        attempts = 0, "completedAt" = null, "lastActivityAt" = now()
      from "sectionContents" c
      where c.id = p."contentId" and p."userId" = ${userId}
        and (${contentId || null}::uuid is null or p."contentId" = ${contentId || null}::uuid)
        and (${sectionId || null}::uuid is null or c."sectionId" = ${sectionId || null}::uuid)
    `)
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'user.progress.reset',
        entityType: 'user',
        entityId: userId,
        before: { affected: before.rows[0]?.count ?? 0 },
        after: { contentId: contentId || null, sectionId: sectionId || null },
        reason,
      },
      context,
    )
    return before.rows[0]?.count ?? 0
  })
  refreshAdmin()
  return { ok: true, message: `تمت إعادة تعيين ${affected} سجل تقدم.` }
}

export async function createBadge(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(120),
      slug,
      description: z.string().trim().min(3).max(2_000),
      rarity: z.enum(['common', 'uncommon', 'rare', 'epic', 'legendary']),
      color: z
        .string()
        .trim()
        .regex(/^#[0-9a-f]{6}$/i)
        .nullable(),
      sectionId: uuid.nullable(),
      mode: z.enum(['automatic', 'manual', 'both']),
      isPublished: z.boolean(),
      isRepeatable: z.boolean(),
      imageMediaId: uuid.nullable(),
      conditionType: z.enum([
        'points',
        'lessons_completed',
        'challenge_wins',
        'activity_streak',
        'achievements',
      ]),
      threshold: z.coerce.number().int().min(0).max(10_000_000),
    })
    .parse({
      name: form.get('name'),
      slug: form.get('slug'),
      description: form.get('description'),
      rarity: form.get('rarity') || 'common',
      color: cleanText(form.get('color')) || null,
      sectionId: cleanText(form.get('sectionId')) || null,
      mode: form.get('mode') || 'manual',
      isPublished: form.get('isPublished') === 'on',
      isRepeatable: form.get('isRepeatable') === 'on',
      imageMediaId: cleanText(form.get('imageMediaId')) || null,
      conditionType: form.get('conditionType') || 'points',
      threshold: form.get('threshold') || 0,
    })
  try {
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(badges)
        .values({
          name: parsed.name,
          slug: parsed.slug,
          description: parsed.description,
          rarity: parsed.rarity,
          color: parsed.color,
          sectionId: parsed.sectionId,
          mode: parsed.mode,
          isPublished: parsed.isPublished,
          isRepeatable: parsed.isRepeatable,
          imageMediaId: parsed.imageMediaId,
          criteria:
            parsed.mode === 'manual'
              ? null
              : { conditionType: parsed.conditionType, threshold: parsed.threshold },
        })
        .returning()
      if (!created) throw new Error('تعذر إنشاء الشارة.')
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'badge.create',
          entityType: 'badge',
          entityId: created.id,
          after: created,
        },
        context,
      )
    })
    refreshAdmin()
    return { ok: true, message: 'تم إنشاء الشارة.' }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'معرّف الشارة مستخدم بالفعل.' }
    throw error
  }
}

export async function updateBadge(badgeIdValue: string, form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const badgeId = uuid.parse(badgeIdValue)
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(120),
      slug,
      description: z.string().trim().min(3).max(2_000),
      rarity: z.enum(['common', 'uncommon', 'rare', 'epic', 'legendary']),
      color: z
        .string()
        .trim()
        .regex(/^#[0-9a-f]{6}$/i)
        .nullable(),
      sectionId: uuid.nullable(),
      imageMediaId: uuid.nullable(),
      mode: z.enum(['automatic', 'manual', 'both']),
      isPublished: z.boolean(),
      isRepeatable: z.boolean(),
      conditionType: z.enum([
        'points',
        'lessons_completed',
        'challenge_wins',
        'activity_streak',
        'achievements',
      ]),
      threshold: z.coerce.number().int().min(0).max(10_000_000),
      reason: z.string().trim().min(5).max(500),
    })
    .parse({
      name: form.get('name'),
      slug: form.get('slug'),
      description: form.get('description'),
      rarity: form.get('rarity'),
      color: cleanText(form.get('color')) || null,
      sectionId: cleanText(form.get('sectionId')) || null,
      imageMediaId: cleanText(form.get('imageMediaId')) || null,
      mode: form.get('mode'),
      isPublished: form.get('isPublished') === 'on',
      isRepeatable: form.get('isRepeatable') === 'on',
      conditionType: form.get('conditionType') || 'points',
      threshold: form.get('threshold') || 0,
      reason: form.get('reason'),
    })
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(badges).where(eq(badges.id, badgeId)).limit(1)
      if (!before || before.deletedAt) throw new Error('الشارة غير موجودة أو مؤرشفة.')
      const [after] = await tx
        .update(badges)
        .set({
          name: parsed.name,
          slug: parsed.slug,
          description: parsed.description,
          rarity: parsed.rarity,
          color: parsed.color,
          sectionId: parsed.sectionId,
          imageMediaId: parsed.imageMediaId,
          mode: parsed.mode,
          isPublished: parsed.isPublished,
          isRepeatable: parsed.isRepeatable,
          criteria:
            parsed.mode === 'manual'
              ? null
              : { conditionType: parsed.conditionType, threshold: parsed.threshold },
          updatedAt: new Date(),
        })
        .where(eq(badges.id, badgeId))
        .returning()
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'badge.update',
          entityType: 'badge',
          entityId: badgeId,
          before,
          after,
          reason: parsed.reason,
        },
        context,
      )
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'معرّف الشارة مستخدم بالفعل.' }
    throw error
  }
  refreshAdmin()
  return { ok: true, message: 'تم تحديث الشارة.' }
}

export async function archiveBadge(badgeIdValue: string, reasonValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const badgeId = uuid.parse(badgeIdValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(badges).where(eq(badges.id, badgeId)).limit(1)
    if (!before || before.deletedAt) throw new Error('الشارة غير موجودة أو مؤرشفة بالفعل.')
    const [after] = await tx
      .update(badges)
      .set({ deletedAt: new Date(), isPublished: false, updatedAt: new Date() })
      .where(eq(badges.id, badgeId))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'badge.archive',
        entityType: 'badge',
        entityId: badgeId,
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تمت أرشفة الشارة مع الحفاظ على سجلات الحاصلين عليها.' }
}

export async function restoreBadge(badgeIdValue: string, reasonValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const badgeId = uuid.parse(badgeIdValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(badges).where(eq(badges.id, badgeId)).limit(1)
    if (!before || !before.deletedAt) throw new Error('الشارة غير مؤرشفة.')
    const [after] = await tx
      .update(badges)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(badges.id, badgeId))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'badge.restore',
        entityType: 'badge',
        entityId: badgeId,
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تمت استعادة الشارة كمسودة.' }
}

export async function createAchievement(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(120),
      description: z.string().trim().min(3).max(2_000),
      icon: z.string().trim().max(120).nullable(),
      xpReward: z.coerce.number().int().min(0).max(1_000_000),
      coinReward: z.coerce.number().int().min(0).max(1_000_000),
      requirementType: z.enum(['points', 'lessons_completed', 'challenge_wins', 'activity_streak']),
      requirementValue: z.coerce.number().int().min(1).max(10_000_000),
      isActive: z.boolean(),
      sortOrder: z.coerce.number().int().min(0).max(100_000),
    })
    .parse({
      name: form.get('name'),
      description: form.get('description'),
      icon: cleanText(form.get('icon')) || null,
      xpReward: form.get('xpReward') || 0,
      coinReward: form.get('coinReward') || 0,
      requirementType: form.get('requirementType'),
      requirementValue: form.get('requirementValue'),
      isActive: form.get('isActive') === 'on',
      sortOrder: form.get('sortOrder') || 0,
    })
  try {
    await db.transaction(async (tx) => {
      const [created] = await tx.insert(achievements).values(parsed).returning()
      if (!created) throw new Error('تعذر إنشاء الإنجاز.')
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'achievement.create',
          entityType: 'achievement',
          entityId: String(created.id),
          after: created,
        },
        context,
      )
    })
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'يوجد إنجاز بالاسم نفسه.' }
    throw error
  }
  refreshAdmin()
  return { ok: true, message: 'تم إنشاء الإنجاز.' }
}

export async function toggleAchievement(achievementIdValue: number): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const achievementId = positiveId.parse(achievementIdValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(achievements).where(eq(achievements.id, achievementId)).limit(1)
    if (!before) throw new Error('الإنجاز غير موجود.')
    const [after] = await tx
      .update(achievements)
      .set({ isActive: !before.isActive, updatedAt: new Date() })
      .where(eq(achievements.id, achievementId))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'achievement.toggle',
        entityType: 'achievement',
        entityId: String(achievementId),
        before: { isActive: before.isActive },
        after: { isActive: after?.isActive },
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم تحديث حالة الإنجاز.' }
}

export async function grantUserAchievement(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const userId = z.string().min(1).max(200).parse(form.get('userId'))
  const achievementId = positiveId.parse(form.get('achievementId'))
  const reason = z.string().trim().min(5).max(500).parse(form.get('reason'))
  const granted = await db.transaction(async (tx) => {
    const [achievement] = await tx
      .select()
      .from(achievements)
      .where(eq(achievements.id, achievementId))
      .limit(1)
    if (!achievement || !achievement.isActive) throw new Error('الإنجاز غير موجود أو غير نشط.')
    const [record] = await tx
      .insert(userAchievements)
      .values({ userId, achievementId })
      .onConflictDoNothing()
      .returning()
    if (!record) return false
    const rewardGranted = await awardProgress(tx, {
      userId,
      sourceType: 'achievement',
      sourceId: String(achievementId),
      xp: achievement.xpReward,
      coins: achievement.coinReward,
      metadata: { grantedBy: actor.id },
    })
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'achievement.grant',
        entityType: 'achievement',
        entityId: String(achievementId),
        after: { userId, rewardGranted },
        reason,
      },
      context,
    )
    return true
  })
  refreshAdmin()
  return granted
    ? { ok: true, message: 'تم منح الإنجاز والمكافأة دون تكرار.' }
    : { ok: false, message: 'المستخدم حاصل على هذا الإنجاز بالفعل.' }
}

export async function grantUserBadge(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const userId = z.string().min(1).max(200).parse(form.get('userId'))
  const badgeId = uuid.parse(form.get('badgeId'))
  const reason = z.string().trim().min(5).max(500).parse(form.get('reason'))
  const repeatKey = cleanText(form.get('repeatKey')) || randomUUID()
  const granted = await db.transaction(async (tx) => {
    const record = await grantBadgeTx(tx, {
      userId,
      badgeId,
      actorUserId: actor.id,
      reason,
      sourceType: 'admin',
      sourceId: repeatKey,
      repeatKey,
    })
    if (record)
      await writeAdminAudit(
        tx,
        {
          actorUserId: actor.id,
          action: 'badge.grant',
          entityType: 'userBadge',
          entityId: record.id,
          after: { userId, badgeId },
          reason,
        },
        context,
      )
    return record
  })
  refreshAdmin()
  return granted
    ? { ok: true, message: 'تم منح الشارة.' }
    : { ok: false, message: 'لم تُمنح الشارة لأنها موجودة بالفعل.' }
}

export async function revokeUserBadge(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const userBadgeId = uuid.parse(form.get('userBadgeId'))
  const reason = z.string().trim().min(5).max(500).parse(form.get('reason'))
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(userBadges).where(eq(userBadges.id, userBadgeId)).limit(1)
    if (!before || before.revokedAt) throw new Error('منحة الشارة غير موجودة أو مسحوبة بالفعل.')
    const [after] = await tx
      .update(userBadges)
      .set({ revokedAt: new Date(), revokedBy: actor.id, revokeReason: reason })
      .where(eq(userBadges.id, userBadgeId))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'badge.revoke',
        entityType: 'userBadge',
        entityId: userBadgeId,
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم سحب الشارة وتسجيل السبب.' }
}

export async function createPromotionRule(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const conditionType = z.enum([
    'points',
    'section_completion',
    'lessons_completed',
    'challenge_wins',
    'activity_streak',
    'achievements',
  ])
  const conditions = [1, 2, 3].flatMap((index) => {
    const typeValue = cleanText(form.get(`conditionType${index}`))
    if (!typeValue) return []
    const condition = {
      type: conditionType.parse(typeValue),
      threshold: z.coerce
        .number()
        .min(0)
        .max(10_000_000)
        .parse(form.get(`threshold${index}`)),
      sectionId: cleanText(form.get(`sectionId${index}`)) || null,
    }
    if (condition.type === 'section_completion' && !condition.sectionId)
      throw new Error('شرط إكمال القسم يحتاج إلى قسم محدد.')
    if (condition.sectionId) uuid.parse(condition.sectionId)
    return [condition]
  })
  if (!conditions.length) throw new Error('أضف شرطًا واحدًا على الأقل.')

  const targetLevelId = cleanText(form.get('targetLevelId'))
    ? positiveId.parse(form.get('targetLevelId'))
    : null
  const grantBadgeId = cleanText(form.get('grantBadgeId')) || null
  if (grantBadgeId) uuid.parse(grantBadgeId)
  const grantAchievementId = cleanText(form.get('grantAchievementId'))
    ? positiveId.parse(form.get('grantAchievementId'))
    : null
  const xpAmount = z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .parse(form.get('xpAmount') || 0)
  const coinAmount = z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .parse(form.get('coinAmount') || 0)
  const actions = [
    ...(targetLevelId ? [{ type: 'promote_level' as const, levelId: targetLevelId }] : []),
    ...(grantBadgeId ? [{ type: 'grant_badge' as const, badgeId: grantBadgeId }] : []),
    ...(xpAmount ? [{ type: 'add_xp' as const, amount: xpAmount }] : []),
    ...(coinAmount ? [{ type: 'add_coins' as const, amount: coinAmount }] : []),
    ...(grantAchievementId
      ? [{ type: 'grant_achievement' as const, achievementId: grantAchievementId }]
      : []),
  ]
  if (!actions.length) throw new Error('أضف إجراءً واحدًا على الأقل للقاعدة.')
  const parsed = z
    .object({
      name: z.string().trim().min(3).max(160),
      description: z.string().trim().max(2_000).nullable(),
      logic: z.enum(['and', 'or']),
      startsAt: z.date().nullable(),
      endsAt: z.date().nullable(),
      applicationMode: z.enum(['new_only', 'all_matching']),
      isActive: z.boolean(),
      priority: z.coerce.number().int().min(1).max(10_000),
      retrospective: z.boolean(),
    })
    .parse({
      name: form.get('name'),
      description: cleanText(form.get('description')) || null,
      logic: form.get('logic') || 'and',
      startsAt: nullableDate(form.get('startsAt')),
      endsAt: nullableDate(form.get('endsAt')),
      applicationMode: form.get('applicationMode') || 'new_only',
      isActive: form.get('isActive') === 'on',
      priority: form.get('priority') || 100,
      retrospective: form.get('retrospective') === 'on',
    })
  if (parsed.startsAt && parsed.endsAt && parsed.endsAt <= parsed.startsAt)
    throw new Error('تاريخ نهاية القاعدة يجب أن يلي تاريخ بدايتها.')
  if (parsed.retrospective && parsed.applicationMode !== 'all_matching')
    throw new Error('التطبيق بأثر رجعي يتطلب اختيار كل المستخدمين المطابقين.')
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(promotionRules)
      .values({
        name: parsed.name,
        description: parsed.description,
        conditionType: conditions[0].type,
        conditionValue: { logic: parsed.logic, conditions, actions },
        sectionId: conditions[0].sectionId,
        actionType: 'composite',
        targetLevelId,
        startsAt: parsed.startsAt,
        endsAt: parsed.endsAt,
        applicationMode: parsed.applicationMode,
        isActive: parsed.isActive,
        priority: parsed.priority,
        retrospective: parsed.retrospective,
        createdBy: actor.id,
      })
      .returning()
    if (!created) throw new Error('تعذر إنشاء القاعدة.')
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'promotionRule.create',
        entityType: 'promotionRule',
        entityId: created.id,
        after: created,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم إنشاء قاعدة الإجراءات المركبة.' }
}

export async function dryRunPromotionRule(ruleIdValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const ruleId = uuid.parse(ruleIdValue)
  const summary = await db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: user.id })
      .from(user)
      .where(isNull(user.deletedAt))
      .orderBy(asc(user.createdAt))
      .limit(500)
    let matched = 0
    for (const candidate of candidates) {
      const preview = await previewPromotionRuleForUser(tx, ruleId, candidate.id)
      if (preview.matched) matched += 1
    }
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'promotionRule.dry-run',
        entityType: 'promotionRule',
        entityId: ruleId,
        after: { candidates: candidates.length, matched },
      },
      context,
    )
    return { candidates: candidates.length, matched }
  })
  return {
    ok: true,
    message: `المعاينة فقط: طابق ${summary.matched} من ${summary.candidates} مستخدمًا، دون أي تعديل.`,
  }
}

export async function executePromotionRuleBatch(ruleIdValue: string, reasonValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const ruleId = uuid.parse(ruleIdValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  const [rule] = await db.select().from(promotionRules).where(eq(promotionRules.id, ruleId)).limit(1)
  if (!rule || !rule.isActive || rule.archivedAt) throw new Error('القاعدة غير موجودة أو معطلة.')
  if (!rule.retrospective) throw new Error('هذه القاعدة غير مهيأة للتنفيذ بأثر رجعي.')
  if (rule.applicationMode !== 'all_matching')
    throw new Error('هذه القاعدة مخصصة للإنجازات الجديدة ولا تسمح بالتنفيذ الرجعي.')
  const sourceKey = 'retrospective'
  const candidates = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        isNull(user.deletedAt),
        sql`not exists(select 1 from "promotionRuleExecutions" e where e."ruleId" = ${ruleId}::uuid and e."userId" = ${user.id} and e."sourceKey" = ${sourceKey} and e.status = 'completed')`,
      ),
    )
    .orderBy(asc(user.createdAt))
    .limit(500)
  let applied = 0
  let failed = 0
  for (const candidate of candidates) {
    try {
      const execution = await db.transaction((tx) =>
        executeConfiguredPromotionRuleTx(tx, {
          ruleId,
          userId: candidate.id,
          sourceKey,
          actorUserId: actor.id,
        }),
      )
      if (execution) applied += 1
    } catch {
      failed += 1
      await db
        .insert(promotionRuleExecutions)
        .values({
          ruleId,
          userId: candidate.id,
          sourceKey,
          status: 'failed',
          errorMessage: 'تعذر تنفيذ إجراءات القاعدة داخل المعاملة؛ لم يُحفظ أي إجراء جزئي.',
        })
        .onConflictDoUpdate({
          target: [
            promotionRuleExecutions.ruleId,
            promotionRuleExecutions.userId,
            promotionRuleExecutions.sourceKey,
          ],
          set: {
            status: 'failed',
            attemptCount: sql`${promotionRuleExecutions.attemptCount} + 1`,
            errorMessage: 'تعذر تنفيذ إجراءات القاعدة داخل المعاملة؛ لم يُحفظ أي إجراء جزئي.',
            executedAt: new Date(),
            completedAt: null,
          },
        })
    }
  }
  await db.transaction((tx) =>
    writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'promotionRule.batch-execute',
        entityType: 'promotionRule',
        entityId: ruleId,
        after: { candidates: candidates.length, applied, failed, batchLimit: 500, sourceKey },
        reason,
      },
      context,
    ),
  )
  refreshAdmin()
  return {
    ok: true,
    message: `تم تطبيق القاعدة على ${applied} من ${candidates.length} مستخدمًا، وفشل ${failed} دون إجراءات جزئية.`,
  }
}

export async function togglePromotionRule(ruleIdValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const id = uuid.parse(ruleIdValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(promotionRules).where(eq(promotionRules.id, id)).limit(1)
    if (!before || before.archivedAt) throw new Error('القاعدة غير موجودة أو مؤرشفة.')
    const [after] = await tx
      .update(promotionRules)
      .set({ isActive: !before.isActive, updatedAt: new Date() })
      .where(eq(promotionRules.id, id))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'promotionRule.toggle',
        entityType: 'promotionRule',
        entityId: id,
        before: { isActive: before.isActive },
        after: { isActive: after?.isActive },
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم تحديث حالة القاعدة.' }
}

export async function updatePromotionRuleMetadata(ruleIdValue: string, form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const id = uuid.parse(ruleIdValue)
  const values = z
    .object({
      name: z.string().trim().min(3).max(160),
      description: z.string().trim().max(2_000).nullable(),
      startsAt: z.date().nullable(),
      endsAt: z.date().nullable(),
      applicationMode: z.enum(['new_only', 'all_matching']),
      priority: z.coerce.number().int().min(1).max(10_000),
      retrospective: z.boolean(),
      reason: z.string().trim().min(5).max(500),
    })
    .parse({
      name: form.get('name'),
      description: cleanText(form.get('description')) || null,
      startsAt: nullableDate(form.get('startsAt')),
      endsAt: nullableDate(form.get('endsAt')),
      applicationMode: form.get('applicationMode') || 'new_only',
      priority: form.get('priority') || 100,
      retrospective: form.get('retrospective') === 'on',
      reason: form.get('reason'),
    })
  if (values.startsAt && values.endsAt && values.endsAt <= values.startsAt)
    throw new Error('تاريخ نهاية القاعدة يجب أن يلي تاريخ بدايتها.')
  if (values.retrospective && values.applicationMode !== 'all_matching')
    throw new Error('التطبيق بأثر رجعي يتطلب اختيار كل المستخدمين المطابقين.')
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(promotionRules).where(eq(promotionRules.id, id)).limit(1)
    if (!before || before.archivedAt) throw new Error('القاعدة غير موجودة أو مؤرشفة.')
    const { reason, ...updates } = values
    const [after] = await tx
      .update(promotionRules)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(promotionRules.id, id))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'promotionRule.update',
        entityType: 'promotionRule',
        entityId: id,
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تم تحديث إعدادات القاعدة مع الحفاظ على شروطها وإجراءاتها.' }
}

export async function duplicatePromotionRule(ruleIdValue: string, reasonValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const id = uuid.parse(ruleIdValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  const created = await db.transaction(async (tx) => {
    const [source] = await tx.select().from(promotionRules).where(eq(promotionRules.id, id)).limit(1)
    if (!source) throw new Error('القاعدة غير موجودة.')
    const [copy] = await tx
      .insert(promotionRules)
      .values({
        name: `نسخة من ${source.name}`.slice(0, 160),
        description: source.description,
        conditionType: source.conditionType,
        conditionValue: source.conditionValue,
        sectionId: source.sectionId,
        actionType: source.actionType,
        targetLevelId: source.targetLevelId,
        startsAt: source.startsAt,
        endsAt: source.endsAt,
        applicationMode: source.applicationMode,
        isActive: false,
        priority: source.priority,
        retrospective: source.retrospective,
        createdBy: actor.id,
      })
      .returning()
    if (!copy) throw new Error('تعذر نسخ القاعدة.')
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'promotionRule.duplicate',
        entityType: 'promotionRule',
        entityId: copy.id,
        after: { sourceRuleId: id, rule: copy },
        reason,
      },
      context,
    )
    return copy
  })
  refreshAdmin()
  return { ok: true, message: `تم إنشاء نسخة معطلة: ${created.name}.` }
}

export async function archivePromotionRule(ruleIdValue: string, reasonValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const id = uuid.parse(ruleIdValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(promotionRules).where(eq(promotionRules.id, id)).limit(1)
    if (!before || before.archivedAt) throw new Error('القاعدة غير موجودة أو مؤرشفة بالفعل.')
    const [after] = await tx
      .update(promotionRules)
      .set({ archivedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(eq(promotionRules.id, id))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'promotionRule.archive',
        entityType: 'promotionRule',
        entityId: id,
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تمت أرشفة القاعدة وتعطيلها.' }
}

export async function restorePromotionRule(ruleIdValue: string, reasonValue: string): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const id = uuid.parse(ruleIdValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(promotionRules).where(eq(promotionRules.id, id)).limit(1)
    if (!before?.archivedAt) throw new Error('القاعدة غير مؤرشفة.')
    const [after] = await tx
      .update(promotionRules)
      .set({ archivedAt: null, isActive: false, updatedAt: new Date() })
      .where(eq(promotionRules.id, id))
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'promotionRule.restore',
        entityType: 'promotionRule',
        entityId: id,
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  return { ok: true, message: 'تمت استعادة القاعدة في حالة معطلة للمراجعة.' }
}

export async function retryPromotionRuleExecution(
  executionIdValue: string,
  reasonValue: string,
): Promise<Result> {
  const { actor, context } = await authorizeMutation('rewards:write')
  const executionId = uuid.parse(executionIdValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  const [failedExecution] = await db
    .select()
    .from(promotionRuleExecutions)
    .where(and(eq(promotionRuleExecutions.id, executionId), eq(promotionRuleExecutions.status, 'failed')))
    .limit(1)
  if (!failedExecution) throw new Error('سجل التنفيذ الفاشل غير موجود.')
  try {
    const completed = await db.transaction((tx) =>
      executeConfiguredPromotionRuleTx(tx, {
        ruleId: failedExecution.ruleId,
        userId: failedExecution.userId,
        sourceKey: failedExecution.sourceKey,
        actorUserId: actor.id,
      }),
    )
    if (!completed) throw new Error('لم تعد القاعدة نشطة أو لم يعد المستخدم مطابقًا.')
  } catch (error) {
    await db
      .update(promotionRuleExecutions)
      .set({
        status: 'failed',
        attemptCount: sql`${promotionRuleExecutions.attemptCount} + 1`,
        errorMessage:
          error instanceof Error && /لم تعد القاعدة/.test(error.message)
            ? error.message
            : 'فشلت إعادة المحاولة دون حفظ أي إجراء جزئي.',
        executedAt: new Date(),
      })
      .where(eq(promotionRuleExecutions.id, executionId))
    throw error
  }
  await db.transaction((tx) =>
    writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'promotionRule.execution.retry',
        entityType: 'promotionRuleExecution',
        entityId: executionId,
        before: failedExecution,
        after: { status: 'completed' },
        reason,
      },
      context,
    ),
  )
  refreshAdmin()
  return { ok: true, message: 'نجحت إعادة المحاولة واكتملت المعاملة.' }
}

export async function upsertSiteContent(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const parsed = z
    .object({
      key: slug,
      group: slug,
      title: z.string().trim().max(200).nullable(),
      status: publication,
      isVisible: z.boolean(),
      sortOrder: z.coerce.number().int().min(0).max(100_000),
    })
    .parse({
      key: form.get('key'),
      group: form.get('group') || 'general',
      title: cleanText(form.get('title')) || null,
      status: form.get('status') || 'draft',
      isVisible: form.get('isVisible') === 'on',
      sortOrder: form.get('sortOrder') || 0,
    })
  const cmsType = z.enum([
    'hero',
    'welcome',
    'banner',
    'announcement',
    'alert',
    'carousel',
    'faq',
    'contact',
    'social',
    'footer',
    'background',
    'section_image',
  ])
  const contentType = cmsType.parse(form.get('contentType'))
  const content = z
    .object({
      type: cmsType,
      heading: z.string().trim().max(200),
      text: z.string().trim().max(5_000),
      secondaryText: z.string().trim().max(2_000),
      buttonText: z.string().trim().max(100),
      buttonUrl: z.string().trim().max(500),
      secondaryButtonText: z.string().trim().max(100),
      secondaryButtonUrl: z.string().trim().max(500),
      styleVariant: z.enum(['default', 'primary', 'warning', 'danger', 'success', 'muted']),
      imageMediaId: z.string().uuid().nullable(),
    })
    .parse({
      type: contentType,
      heading: cleanText(form.get('heading')),
      text: cleanText(form.get('text')),
      secondaryText: cleanText(form.get('secondaryText')),
      buttonText: cleanText(form.get('buttonText')),
      buttonUrl: cleanText(form.get('buttonUrl')),
      secondaryButtonText: cleanText(form.get('secondaryButtonText')),
      secondaryButtonUrl: cleanText(form.get('secondaryButtonUrl')),
      styleVariant: form.get('styleVariant') || 'default',
      imageMediaId: cleanText(form.get('imageMediaId')) || null,
    })
  if (['hero', 'welcome', 'banner', 'announcement', 'alert', 'carousel'].includes(contentType)) {
    if (!content.heading || !content.text)
      throw new Error('العنوان والنص مطلوبان لهذا النوع من محتوى الموقع.')
  }
  if (contentType === 'faq' && (!content.heading || !content.text))
    throw new Error('عنصر الأسئلة الشائعة يحتاج إلى سؤال وإجابة.')
  if (['contact', 'social', 'footer'].includes(contentType) && !content.text)
    throw new Error('النص أو معلومات التواصل مطلوبة لهذا النوع.')
  if (
    content.buttonUrl &&
    !content.buttonUrl.startsWith('/') &&
    !/^https:\/\/[a-z0-9.-]+(?:\/|$)/i.test(content.buttonUrl)
  )
    throw new Error('رابط الزر يجب أن يكون مسارًا داخليًا يبدأ بـ /.')
  if (
    content.secondaryButtonUrl &&
    !content.secondaryButtonUrl.startsWith('/') &&
    !/^https:\/\/[a-z0-9.-]+(?:\/|$)/i.test(content.secondaryButtonUrl)
  )
    throw new Error('رابط الزر الإضافي يجب أن يكون داخليًا أو HTTPS صريحًا.')
  const startsAt = nullableDate(form.get('startsAt'))
  const endsAt = nullableDate(form.get('endsAt'))
  if (startsAt && endsAt && endsAt <= startsAt) throw new Error('تاريخ النهاية يجب أن يلي البداية.')
  if (parsed.status === 'scheduled' && (!startsAt || startsAt <= new Date()))
    throw new Error('المحتوى المجدول يحتاج إلى بداية ظهور مستقبلية.')
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(siteContent).where(eq(siteContent.key, parsed.key)).limit(1)
    const [after] = await tx
      .insert(siteContent)
      .values({ ...parsed, content, startsAt, endsAt, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: siteContent.key,
        set: {
          ...parsed,
          content,
          startsAt,
          endsAt,
          version: sql`${siteContent.version} + 1`,
          updatedBy: actor.id,
          updatedAt: new Date(),
        },
      })
      .returning()
    if (!after) throw new Error('تعذر حفظ محتوى الموقع.')
    await tx.insert(siteContentVersions).values({
      siteContentId: after.id,
      version: after.version,
      title: after.title,
      content: after.content,
      status: after.status,
      isVisible: after.isVisible,
      startsAt: after.startsAt,
      endsAt: after.endsAt,
      createdBy: actor.id,
    })
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: before ? 'siteContent.update' : 'siteContent.create',
        entityType: 'siteContent',
        entityId: after?.id,
        before,
        after,
      },
      context,
    )
  })
  refreshAdmin()
  revalidatePath('/')
  return { ok: true, message: 'تم حفظ محتوى الموقع.' }
}

export async function restoreSiteContentVersion(
  versionIdValue: string,
  reasonValue: string,
): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const versionId = uuid.parse(versionIdValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const [snapshot] = await tx
      .select()
      .from(siteContentVersions)
      .where(eq(siteContentVersions.id, versionId))
      .limit(1)
    if (!snapshot) throw new Error('نسخة CMS غير موجودة.')
    const [before] = await tx
      .select()
      .from(siteContent)
      .where(eq(siteContent.id, snapshot.siteContentId))
      .limit(1)
    if (!before) throw new Error('عنصر CMS الأصلي غير موجود.')
    const [after] = await tx
      .update(siteContent)
      .set({
        title: snapshot.title,
        content: snapshot.content,
        status: 'draft',
        isVisible: snapshot.isVisible,
        startsAt: snapshot.startsAt,
        endsAt: snapshot.endsAt,
        version: sql`${siteContent.version} + 1`,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(siteContent.id, snapshot.siteContentId))
      .returning()
    if (!after) throw new Error('تعذر استعادة نسخة CMS.')
    await tx.insert(siteContentVersions).values({
      siteContentId: after.id,
      version: after.version,
      title: after.title,
      content: after.content,
      status: after.status,
      isVisible: after.isVisible,
      startsAt: after.startsAt,
      endsAt: after.endsAt,
      createdBy: actor.id,
    })
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'siteContent.version.restore',
        entityType: 'siteContent',
        entityId: after.id,
        before,
        after: { ...after, restoredFromVersion: snapshot.version },
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  revalidatePath('/')
  return { ok: true, message: 'تمت استعادة النسخة كمسودة جديدة دون حذف التاريخ.' }
}

async function saveSiteContentVersion(tx: DbTransaction, item: typeof siteContent.$inferSelect, actorId: string) {
  await tx.insert(siteContentVersions).values({
    siteContentId: item.id,
    version: item.version,
    title: item.title,
    content: item.content,
    status: item.status,
    isVisible: item.isVisible,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    createdBy: actorId,
  })
}

export async function setSiteContentStatus(
  contentIdValue: string,
  statusValue: string,
  reasonValue: string,
): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const contentId = uuid.parse(contentIdValue)
  const status = publication.parse(statusValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(siteContent).where(eq(siteContent.id, contentId)).limit(1)
    if (!before) throw new Error('عنصر محتوى الموقع غير موجود.')
    if (status === 'scheduled' && (!before.startsAt || before.startsAt <= new Date()))
      throw new Error('حدد بداية عرض مستقبلية قبل جدولة المحتوى.')
    const [after] = await tx
      .update(siteContent)
      .set({
        status,
        isVisible: status === 'archived' ? false : before.isVisible,
        version: sql`${siteContent.version} + 1`,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(siteContent.id, contentId))
      .returning()
    if (!after) throw new Error('تعذر تحديث حالة المحتوى.')
    await saveSiteContentVersion(tx, after, actor.id)
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'siteContent.status',
        entityType: 'siteContent',
        entityId: contentId,
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  revalidatePath('/')
  return { ok: true, message: 'تم تحديث حالة محتوى الواجهة.' }
}

export async function toggleSiteContentVisibility(
  contentIdValue: string,
  reasonValue: string,
): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const contentId = uuid.parse(contentIdValue)
  const reason = z.string().trim().min(5).max(500).parse(reasonValue)
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(siteContent).where(eq(siteContent.id, contentId)).limit(1)
    if (!before) throw new Error('عنصر محتوى الموقع غير موجود.')
    const [after] = await tx
      .update(siteContent)
      .set({
        isVisible: !before.isVisible,
        version: sql`${siteContent.version} + 1`,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(siteContent.id, contentId))
      .returning()
    if (!after) throw new Error('تعذر تحديث ظهور المحتوى.')
    await saveSiteContentVersion(tx, after, actor.id)
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'siteContent.visibility',
        entityType: 'siteContent',
        entityId: contentId,
        before,
        after,
        reason,
      },
      context,
    )
  })
  refreshAdmin()
  revalidatePath('/')
  return { ok: true, message: 'تم تحديث ظهور محتوى الواجهة.' }
}


export async function updatePlatformSettings(form: FormData): Promise<Result> {
  const { actor, context } = await authorizeMutation('content:write')
  const value = z
    .object({
      siteName: z.string().trim().min(2).max(120),
      siteDescription: z.string().trim().max(500),
      timezone: z.enum(['Africa/Cairo', 'UTC', 'Asia/Riyadh']),
      defaultLanguage: z.enum(['ar', 'en']),
      arabicEnabled: z.boolean(),
      englishEnabled: z.boolean(),
      registrationEnabled: z.boolean(),
      maintenanceMode: z.boolean(),
      maxUploadMb: z.coerce.number().int().min(1).max(MAX_UPLOAD_MB),
    })
    .parse({
      siteName: form.get('siteName'),
      siteDescription: cleanText(form.get('siteDescription')),
      timezone: form.get('timezone') || 'Africa/Cairo',
      defaultLanguage: form.get('defaultLanguage') || 'ar',
      arabicEnabled: form.get('arabicEnabled') === 'on',
      englishEnabled: form.get('englishEnabled') === 'on',
      registrationEnabled: form.get('registrationEnabled') === 'on',
      maintenanceMode: form.get('maintenanceMode') === 'on',
      maxUploadMb: form.get('maxUploadMb') || 5,
    })
  if (!value.arabicEnabled && !value.englishEnabled) throw new Error('يجب تفعيل لغة واحدة على الأقل.')
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, 'general'))
      .limit(1)
    const [after] = await tx
      .insert(platformSettings)
      .values({ key: 'general', value, updatedBy: actor.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value, updatedBy: actor.id, updatedAt: new Date() },
      })
      .returning()
    await writeAdminAudit(
      tx,
      {
        actorUserId: actor.id,
        action: 'settings.general.update',
        entityType: 'platformSettings',
        entityId: 'general',
        before,
        after,
      },
      context,
    )
  })
  refreshAdmin()
  revalidatePath('/')
  revalidatePath('/sign-in')
  revalidatePath('/sign-up')
  revalidatePath('/maintenance')
  return { ok: true, message: 'تم حفظ إعدادات المنصة.' }
}
