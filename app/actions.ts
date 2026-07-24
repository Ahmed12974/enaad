'use server'

import { randomBytes } from 'node:crypto'
import { del, put } from '@vercel/blob'
import { and, asc, desc, eq, getTableColumns, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { readSheet, type SheetData } from 'read-excel-file/node'
import { z } from 'zod'
import { getAuditRequestContext, writeAdminAudit } from '@/lib/admin-audit'
import { hasPermission, type Permission } from '@/lib/admin'
import { ForbiddenError } from '@/lib/admin-policy'
import { getCurrentUser, isAllowedAdministrator, requirePermission, requireUser } from '@/lib/auth-session'
import {
  getCompetitionAvailability,
  type CompetitionAudience,
} from '@/lib/competition-policy'
import { db, type DbTransaction } from '@/lib/db'
import {
  achievements,
  badges,
  banners,
  categories,
  certificates,
  challengeParticipants,
  challengeSettings,
  challenges,
  competitionCategories,
  competitionMathSections,
  competitionParticipants,
  competitionQuestions,
  competitions,
  encouragementMessages,
  mathAttemptQuestions,
  mathAttempts,
  mathQuestions,
  mathSections,
  sentences,
  session,
  siteContent,
  testAnswers,
  tests,
  user,
  userAchievements,
  userBadges,
  userProgress,
  wordQuizAttempts,
  wordQuizQuestions,
  words,
} from '@/lib/db/schema'
import {
  generateWordQuestions,
  shuffle,
  wordQuizModes,
  type QuizDirection,
  type QuizWord,
  type WordQuizMode,
} from '@/lib/quiz-engine'
import { awardProgress, reconcileChallengesForUser, touchUserActivity } from '@/lib/rewards'
import { detectSafeImageType, safeExternalUrl } from '@/lib/security'
import { cleanText, isUniqueViolation, normalizeText } from '@/lib/utils'
import { assertSafeWorkbookArchive } from '@/lib/xlsx-security'

const languageSchema = z.enum(['en', 'ar'])
const idSchema = z.number().int().positive()
const uuidSchema = z.string().uuid()
const quizModeSchema = z.enum(wordQuizModes)
const quizDirectionSchema = z.enum(['en-ar', 'en-en'])
const richWordSchema = z.object({
  word: z.string().trim().min(1).max(120),
  meaning: z.string().trim().min(1).max(300),
  language: languageSchema.default('en'),
  categoryId: z.number().int().positive().nullable().optional(),
  englishMeaning: z.string().trim().max(500).optional(),
  arabicExplanation: z.string().trim().max(1500).optional(),
  englishExplanation: z.string().trim().max(1500).optional(),
  arabicExample: z.string().trim().max(1000).optional(),
  englishExample: z.string().trim().max(1000).optional(),
  category: z.string().trim().max(80).default('عام'),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).default('A1'),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
  synonyms: z.array(z.string().trim().max(120)).max(30).default([]),
  antonyms: z.array(z.string().trim().max(120)).max(30).default([]),
})
const sentenceSchema = z.object({
  sentence: z.string().trim().min(1).max(500),
  translation: z.string().trim().min(1).max(500),
  category: z.string().trim().max(80).default('يومية'),
})

function refresh(...paths: string[]) {
  for (const path of [...new Set(paths)]) revalidatePath(path)
}

function parseWordForm(form: FormData) {
  const csv = (key: string) =>
    String(form.get(key) ?? '')
      .split(/[,،]/)
      .map(cleanText)
      .filter(Boolean)
  const rawCategoryId = Number(form.get('categoryId') ?? 0)
  return richWordSchema.safeParse({
    word: form.get('word'),
    meaning: form.get('meaning'),
    language: form.get('language') || 'en',
    categoryId: rawCategoryId > 0 ? rawCategoryId : null,
    englishMeaning: cleanText(form.get('englishMeaning')) || undefined,
    arabicExplanation: cleanText(form.get('arabicExplanation')) || undefined,
    englishExplanation: cleanText(form.get('englishExplanation')) || undefined,
    arabicExample: cleanText(form.get('arabicExample')) || undefined,
    englishExample: cleanText(form.get('englishExample')) || undefined,
    category: form.get('category') || 'عام',
    level: form.get('level') || 'A1',
    difficulty: form.get('difficulty') || 'easy',
    synonyms: csv('synonyms'),
    antonyms: csv('antonyms'),
  })
}

async function validateCategory(
  userId: string,
  categoryId: number | null | undefined,
  language: 'en' | 'ar',
) {
  if (!categoryId) return null
  const [record] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.id, categoryId),
        eq(categories.language, language),
        eq(categories.isActive, true),
        or(
          eq(categories.scope, 'platform'),
          and(eq(categories.scope, 'user'), eq(categories.userId, userId)),
        ),
      ),
    )
    .limit(1)
  if (!record) throw new Error('القسم المحدد غير متاح')
  return record.id
}

async function writeAudit(
  tx: DbTransaction,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null,
) {
  await writeAdminAudit(
    tx,
    { actorUserId, action, entityType, entityId, before, after },
    await getAuditRequestContext(),
  )
}

async function requireAdminArea(permission?: Permission) {
  const current = await requireUser()
  if (!(await isAllowedAdministrator(current))) throw new ForbiddenError()
  if (permission && !hasPermission(current.role, permission))
    throw new ForbiddenError('ليس لديك صلاحية تنفيذ هذه العملية.')
  return current
}

export async function isAdmin() {
  const current = await getCurrentUser()
  return Boolean(current && (await isAllowedAdministrator(current)))
}

export async function requireAdmin() {
  return requireAdminArea()
}

export async function getData() {
  const current = await requireUser()
  const [
    progressRows,
    challengeRows,
    certificateRows,
    achievementRows,
    earnedAchievementRows,
    badgeRows,
    earnedBadgeRows,
  ] = await Promise.all([
    db.select().from(userProgress).where(eq(userProgress.userId, current.id)).limit(1),
    db
      .select({
        ...getTableColumns(challenges),
        participationRules: challengeSettings.participationRules,
      })
      .from(challenges)
      .innerJoin(challengeSettings, eq(challengeSettings.challengeId, challenges.id))
      .where(
        and(
          eq(challenges.isActive, true),
          inArray(challengeSettings.lifecycle, ['open', 'active']),
          or(isNull(challenges.startsAt), sql`${challenges.startsAt} <= now()`),
          or(isNull(challenges.endsAt), sql`${challenges.endsAt} >= now()`),
        ),
      )
      .orderBy(desc(challenges.createdAt))
      .limit(100),
    db
      .select()
      .from(certificates)
      .where(eq(certificates.userId, current.id))
      .orderBy(desc(certificates.issuedAt))
      .limit(100),
    db
      .select()
      .from(achievements)
      .where(eq(achievements.isActive, true))
      .orderBy(asc(achievements.sortOrder), asc(achievements.id))
      .limit(200),
    db
      .select()
      .from(userAchievements)
      .where(eq(userAchievements.userId, current.id))
      .orderBy(desc(userAchievements.earnedAt))
      .limit(200),
    db
      .select()
      .from(badges)
      .where(and(eq(badges.isPublished, true), isNull(badges.deletedAt)))
      .orderBy(desc(badges.createdAt))
      .limit(200),
    db
      .select()
      .from(userBadges)
      .where(and(eq(userBadges.userId, current.id), isNull(userBadges.revokedAt)))
      .orderBy(desc(userBadges.grantedAt))
      .limit(500),
  ])

  const visibleChallengeRows = challengeRows.filter((challenge) => {
    const rules = challenge.participationRules ?? {}
    return rules.requireVerifiedEmail === false || current.emailVerified
  })
  const visibleChallengeIds = visibleChallengeRows.map((challenge) => challenge.id)
  const participantCountPromise = visibleChallengeIds.length
    ? db
        .select({ challengeId: challengeParticipants.challengeId, count: sql<number>`count(*)::int` })
        .from(challengeParticipants)
        .where(inArray(challengeParticipants.challengeId, visibleChallengeIds))
        .groupBy(challengeParticipants.challengeId)
    : Promise.resolve([] as Array<{ challengeId: number; count: number }>)
  const participationPromise = visibleChallengeIds.length
    ? db
        .select()
        .from(challengeParticipants)
        .where(
          and(
            eq(challengeParticipants.userId, current.id),
            inArray(challengeParticipants.challengeId, visibleChallengeIds),
          ),
        )
    : Promise.resolve([] as Array<typeof challengeParticipants.$inferSelect>)
  const [participantCountRows, participationRows] = await Promise.all([
    participantCountPromise,
    participationPromise,
  ])

  return {
    progress: progressRows[0] ?? null,
    challenges: visibleChallengeRows,
    participations: participationRows,
    participantCounts: Object.fromEntries(participantCountRows.map((row) => [row.challengeId, row.count])),
    certificates: certificateRows,
    achievements: achievementRows,
    earnedAchievements: earnedAchievementRows,
    badges: badgeRows,
    earnedBadges: earnedBadgeRows,
  }
}


export async function getStudioData(viewValue: string) {
  const current = await requireUser()
  const view = z
    .enum(['dashboard', 'add', 'quiz', 'results', 'words', 'sentences', 'mistakes'])
    .catch('dashboard')
    .parse(viewValue)
  const needsWords = ['dashboard', 'quiz', 'words', 'mistakes'].includes(view)
  const needsSentences = ['dashboard', 'sentences'].includes(view)
  const needsTests = ['dashboard', 'results'].includes(view)
  const needsSiteContent = view === 'dashboard'

  const [wordRows, sentenceRows, testRows, siteContentRows] = await Promise.all([
    needsWords
      ? db
          .select()
          .from(words)
          .where(and(eq(words.userId, current.id), isNull(words.deletedAt)))
          .orderBy(desc(words.createdAt))
          .limit(2_000)
      : Promise.resolve([]),
    needsSentences
      ? db
          .select()
          .from(sentences)
          .where(eq(sentences.userId, current.id))
          .orderBy(desc(sentences.createdAt))
          .limit(1_000)
      : Promise.resolve([]),
    needsTests
      ? db
          .select()
          .from(tests)
          .where(eq(tests.userId, current.id))
          .orderBy(desc(tests.completedAt))
          .limit(100)
      : Promise.resolve([]),
    needsSiteContent
      ? db
          .select({ key: siteContent.key, content: siteContent.content })
          .from(siteContent)
          .where(
            and(
              or(
                eq(siteContent.status, 'published'),
                and(eq(siteContent.status, 'scheduled'), lte(siteContent.startsAt, new Date())),
              ),
              eq(siteContent.isVisible, true),
              or(isNull(siteContent.startsAt), sql`${siteContent.startsAt} <= now()`),
              or(isNull(siteContent.endsAt), sql`${siteContent.endsAt} >= now()`),
            ),
          )
          .orderBy(asc(siteContent.sortOrder))
          .limit(100)
      : Promise.resolve([]),
  ])

  return {
    words: wordRows,
    sentences: sentenceRows,
    tests: testRows,
    siteContent: Object.fromEntries(siteContentRows.map((item) => [item.key, item.content])),
  }
}

export async function getLanguageWords(languageValue: 'en' | 'ar') {
  const current = await requireUser()
  const selectedLanguage = languageSchema.parse(languageValue)
  return db
    .select()
    .from(words)
    .where(and(eq(words.userId, current.id), eq(words.language, selectedLanguage), isNull(words.deletedAt)))
    .orderBy(desc(words.createdAt))
    .limit(2_000)
}

export async function addWord(form: FormData) {
  const current = await requireUser()
  const parsed = parseWordForm(form)
  if (!parsed.success) return { ok: false, message: 'تحقق من بيانات الكلمة والحدود المسموحة.' }
  const word = cleanText(parsed.data.word)
  const normalizedWord = normalizeText(word)
  const categoryId = await validateCategory(current.id, parsed.data.categoryId, parsed.data.language)

  try {
    const created = await db.transaction(async (tx) => {
      const [record] = await tx
        .insert(words)
        .values({ ...parsed.data, categoryId, userId: current.id, word, normalizedWord })
        .onConflictDoNothing()
        .returning()
      if (!record) return null
      await touchUserActivity(tx, current.id)
      await reconcileChallengesForUser(tx, current.id)
      return record
    })
    if (!created) return { ok: false, message: 'الكلمة موجودة بالفعل في حسابك.' }
    refresh('/', '/words', '/english', '/arabic', '/study', '/challenges')
    return { ok: true, word: created }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'الكلمة موجودة بالفعل في حسابك.' }
    throw error
  }
}

export async function updateWord(id: number, form: FormData) {
  const current = await requireUser()
  const wordId = idSchema.parse(id)
  const [existing] = await db
    .select()
    .from(words)
    .where(and(eq(words.id, wordId), eq(words.userId, current.id), isNull(words.deletedAt)))
    .limit(1)
  if (!existing) return { ok: false, message: 'الكلمة غير موجودة أو لا تملك صلاحية تعديلها.' }
  const parsed = parseWordForm(form)
  if (!parsed.success) return { ok: false, message: 'تحقق من بيانات الكلمة والحدود المسموحة.' }
  const categoryId = await validateCategory(current.id, parsed.data.categoryId, parsed.data.language)
  const word = cleanText(parsed.data.word)
  const optional = <K extends keyof typeof parsed.data>(key: K) =>
    form.has(String(key)) ? parsed.data[key] : existing[key as keyof typeof existing]
  const nextValues = {
    ...parsed.data,
    englishMeaning: optional('englishMeaning') as string | null | undefined,
    arabicExplanation: optional('arabicExplanation') as string | null | undefined,
    englishExplanation: optional('englishExplanation') as string | null | undefined,
    arabicExample: optional('arabicExample') as string | null | undefined,
    englishExample: optional('englishExample') as string | null | undefined,
    synonyms: form.has('synonyms') ? parsed.data.synonyms : existing.synonyms,
    antonyms: form.has('antonyms') ? parsed.data.antonyms : existing.antonyms,
    categoryId,
    word,
    normalizedWord: normalizeText(word),
    updatedAt: new Date(),
  }
  try {
    const [updated] = await db
      .update(words)
      .set(nextValues)
      .where(and(eq(words.id, wordId), eq(words.userId, current.id), isNull(words.deletedAt)))
      .returning({ id: words.id })
    if (!updated) return { ok: false, message: 'الكلمة غير موجودة أو لا تملك صلاحية تعديلها.' }
    refresh('/words', '/english', '/arabic', '/study')
    return { ok: true }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'توجد كلمة مطابقة بالفعل في حسابك.' }
    throw error
  }
}

export async function addBulk(text: string, language: 'en' | 'ar' = 'en') {
  const current = await requireUser()
  const parsedLanguage = languageSchema.parse(language)
  if (text.length > 100_000) throw new Error('النص أكبر من الحد المسموح.')
  const rows = text
    .split(/\r?\n/)
    .slice(0, 500)
    .map((line) => {
      const separator = line.search(/\s[-–—:]\s/)
      if (separator < 0) return null
      const word = cleanText(line.slice(0, separator))
      const meaning = cleanText(line.slice(separator).replace(/^\s*[-–—:]\s*/, ''))
      if (!word || !meaning || word.length > 120 || meaning.length > 300) return null
      return { word, meaning, normalizedWord: normalizeText(word) }
    })
    .filter((row): row is { word: string; meaning: string; normalizedWord: string } => Boolean(row))
  if (!rows.length) throw new Error('لا توجد أسطر صحيحة. استخدم الصيغة: Protect - يحمي')
  const uniqueRows = [...new Map(rows.map((row) => [row.normalizedWord, row])).values()]
  const inserted = await db.transaction(async (tx) => {
    const created = await tx
      .insert(words)
      .values(uniqueRows.map((row) => ({ userId: current.id, language: parsedLanguage, ...row })))
      .onConflictDoNothing()
      .returning({ normalizedWord: words.normalizedWord })
    await touchUserActivity(tx, current.id)
    await reconcileChallengesForUser(tx, current.id)
    return created
  })
  const insertedSet = new Set(inserted.map((row) => row.normalizedWord))
  refresh('/', '/words', '/english', '/arabic', '/study', '/challenges')
  return {
    added: inserted.length,
    skipped: rows.length - inserted.length,
    duplicates: uniqueRows.filter((row) => !insertedSet.has(row.normalizedWord)).map((row) => row.word),
  }
}

export async function addSentence(form: FormData) {
  const current = await requireUser()
  const parsed = sentenceSchema.safeParse({
    sentence: form.get('sentence'),
    translation: form.get('translation'),
    category: form.get('category') || 'يومية',
  })
  if (!parsed.success) return { ok: false, message: 'تحقق من بيانات الجملة.' }
  const sentence = cleanText(parsed.data.sentence)
  const [created] = await db.transaction(async (tx) => {
    const result = await tx
      .insert(sentences)
      .values({ userId: current.id, ...parsed.data, sentence, normalizedSentence: normalizeText(sentence) })
      .onConflictDoNothing()
      .returning()
    if (result[0]) {
      await touchUserActivity(tx, current.id)
      await reconcileChallengesForUser(tx, current.id)
    }
    return result
  })
  if (!created) return { ok: false, message: 'الجملة موجودة بالفعل في حسابك.' }
  refresh('/', '/sentences', '/challenges')
  return { ok: true }
}

export async function toggleFavorite(id: number) {
  const current = await requireUser()
  const [updated] = await db
    .update(words)
    .set({ isFavorite: sql`not ${words.isFavorite}`, updatedAt: new Date() })
    .where(and(eq(words.id, idSchema.parse(id)), eq(words.userId, current.id), isNull(words.deletedAt)))
    .returning({ id: words.id })
  if (!updated) throw new Error('الكلمة غير موجودة')
  refresh('/words', '/english', '/arabic')
}

export async function deleteWord(id: number) {
  const current = await requireUser()
  const deleted = await db.transaction(async (tx) => {
    const [record] = await tx
      .update(words)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(words.id, idSchema.parse(id)), eq(words.userId, current.id), isNull(words.deletedAt)))
      .returning({ id: words.id })
    if (record) await reconcileChallengesForUser(tx, current.id)
    return record
  })
  if (!deleted) throw new Error('الكلمة غير موجودة أو لا تملك صلاحية حذفها')
  refresh('/', '/words', '/english', '/arabic', '/study', '/challenges')
}

type SafeWordQuestion = {
  id: string
  prompt: string
  options: string[] | null
  example: string | null
  spokenText: string | null
}

async function loadWordAttempt(attemptId: string, userId: string) {
  const [attempt] = await db
    .select()
    .from(wordQuizAttempts)
    .where(and(eq(wordQuizAttempts.id, attemptId), eq(wordQuizAttempts.userId, userId)))
    .limit(1)
  if (!attempt) throw new Error('محاولة الاختبار غير موجودة')
  const questionRows = await db
    .select({
      id: wordQuizQuestions.id,
      prompt: wordQuizQuestions.prompt,
      options: wordQuizQuestions.options,
      example: wordQuizQuestions.example,
    })
    .from(wordQuizQuestions)
    .where(eq(wordQuizQuestions.attemptId, attempt.id))
    .orderBy(asc(wordQuizQuestions.ordinal))
  return {
    attemptId: attempt.id,
    mode: attempt.mode as WordQuizMode,
    status: attempt.status,
    score: attempt.score,
    correctAnswers: attempt.correctAnswers,
    questionCount: attempt.questionCount,
    questions: questionRows.map((question) => ({
      ...question,
      spokenText: attempt.mode === 'audio' ? question.prompt : null,
    })) satisfies SafeWordQuestion[],
  }
}

export async function startWordQuiz(input: {
  requestKey: string
  mode: WordQuizMode
  language: 'en' | 'ar'
  direction: QuizDirection
  count: number
}) {
  const current = await requireUser()
  const parsed = z
    .object({
      requestKey: uuidSchema,
      mode: quizModeSchema,
      language: languageSchema,
      direction: quizDirectionSchema,
      count: z.number().int().min(1).max(50),
    })
    .parse(input)
  const [existing] = await db
    .select({ id: wordQuizAttempts.id })
    .from(wordQuizAttempts)
    .where(and(eq(wordQuizAttempts.userId, current.id), eq(wordQuizAttempts.requestKey, parsed.requestKey)))
    .limit(1)
  if (existing) return loadWordAttempt(existing.id, current.id)

  const conditions = [
    eq(words.userId, current.id),
    eq(words.language, parsed.language),
    isNull(words.deletedAt),
  ]
  if (parsed.mode === 'mistakes') conditions.push(sql`${words.mistakeCount} > 0`)
  if (parsed.mode === 'difficult') conditions.push(sql`${words.mistakeCount} >= 2`)
  const [{ count: total }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(words)
    .where(and(...conditions))
  if (!total) throw new Error('لا توجد كلمات متاحة لهذا الاختبار.')

  const sampleSize = Math.min(total, Math.max(parsed.count * 10, 100))
  const offset = Math.floor(Math.random() * Math.max(1, total - sampleSize + 1))
  const pool = await db
    .select({
      id: words.id,
      word: words.word,
      meaning: words.meaning,
      englishMeaning: words.englishMeaning,
      englishExample: words.englishExample,
      arabicExample: words.arabicExample,
      language: words.language,
    })
    .from(words)
    .where(and(...conditions))
    .orderBy(asc(words.id))
    .limit(sampleSize)
    .offset(offset)
  const deck = shuffle(pool).slice(0, Math.min(parsed.count, pool.length))
  const generated = generateWordQuestions({
    deck: deck as QuizWord[],
    pool: pool as QuizWord[],
    mode: parsed.mode,
    direction: parsed.direction,
  })

  const attemptId = await db.transaction(async (tx) => {
    const [attempt] = await tx
      .insert(wordQuizAttempts)
      .values({
        userId: current.id,
        requestKey: parsed.requestKey,
        mode: parsed.mode,
        source: parsed.language === 'ar' ? 'العربية' : 'الإنجليزية',
        language: parsed.language,
        questionCount: generated.length,
      })
      .onConflictDoNothing()
      .returning({ id: wordQuizAttempts.id })
    if (!attempt) return null
    await tx
      .insert(wordQuizQuestions)
      .values(generated.map((question, ordinal) => ({ attemptId: attempt.id, ordinal, ...question })))
    return attempt.id
  })

  if (!attemptId) {
    const [duplicate] = await db
      .select({ id: wordQuizAttempts.id })
      .from(wordQuizAttempts)
      .where(and(eq(wordQuizAttempts.userId, current.id), eq(wordQuizAttempts.requestKey, parsed.requestKey)))
      .limit(1)
    if (!duplicate) throw new Error('تعذر إنشاء محاولة الاختبار')
    return loadWordAttempt(duplicate.id, current.id)
  }
  return loadWordAttempt(attemptId, current.id)
}

export async function submitWordQuiz(
  attemptIdValue: string,
  answerValues: Array<{ questionId: string; answer: string }>,
) {
  const current = await requireUser()
  const attemptId = uuidSchema.parse(attemptIdValue)
  const answers = z
    .array(z.object({ questionId: uuidSchema, answer: z.string().max(1_500) }))
    .min(1)
    .max(50)
    .parse(answerValues)
  if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length)
    throw new Error('لا يمكن إرسال السؤال أكثر من مرة.')

  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(wordQuizAttempts)
      .set({ status: 'grading' })
      .where(
        and(
          eq(wordQuizAttempts.id, attemptId),
          eq(wordQuizAttempts.userId, current.id),
          eq(wordQuizAttempts.status, 'active'),
        ),
      )
      .returning()
    if (!claimed) {
      const [saved] = await tx
        .select({
          status: wordQuizAttempts.status,
          score: wordQuizAttempts.score,
          correctAnswers: wordQuizAttempts.correctAnswers,
          questionCount: wordQuizAttempts.questionCount,
        })
        .from(wordQuizAttempts)
        .where(and(eq(wordQuizAttempts.id, attemptId), eq(wordQuizAttempts.userId, current.id)))
        .limit(1)
      if (!saved) throw new Error('محاولة الاختبار غير موجودة')
      return { ok: false, message: 'تم تصحيح هذه المحاولة مسبقًا.', ...saved }
    }

    const issued = await tx
      .select()
      .from(wordQuizQuestions)
      .where(eq(wordQuizQuestions.attemptId, attemptId))
      .orderBy(asc(wordQuizQuestions.ordinal))
    const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.answer]))
    if (
      issued.length !== claimed.questionCount ||
      answers.length !== issued.length ||
      issued.some((question) => !answerMap.has(question.id))
    ) {
      throw new Error('يجب إرسال إجابة واحدة لكل سؤال صدر في هذه المحاولة.')
    }

    const verified = issued.map((question) => {
      const userAnswer = answerMap.get(question.id) ?? ''
      return {
        ...question,
        userAnswer,
        isCorrect: normalizeText(userAnswer) === normalizeText(question.correctAnswer),
      }
    })
    const correct = verified.filter((answer) => answer.isCorrect).length
    const score = Math.round((correct / verified.length) * 100)
    const now = new Date()

    for (const answer of verified) {
      await tx
        .update(wordQuizQuestions)
        .set({ userAnswer: answer.userAnswer, isCorrect: answer.isCorrect, answeredAt: now })
        .where(eq(wordQuizQuestions.id, answer.id))
      if (answer.wordId)
        await tx
          .update(words)
          .set(
            answer.isCorrect
              ? {
                  correctCount: sql`${words.correctCount} + 1`,
                  correctStreak: sql`${words.correctStreak} + 1`,
                  reviewCount: sql`${words.reviewCount} + 1`,
                  intervalDays: sql`CASE WHEN ${words.intervalDays} < 1 THEN 1 WHEN ${words.intervalDays} = 1 THEN 3 ELSE LEAST(365, round(${words.intervalDays} * ${words.easeFactor} / 100.0)::int) END`,
                  easeFactor: sql`LEAST(300, ${words.easeFactor} + 5)`,
                  nextReviewAt: sql`now() + (CASE WHEN ${words.intervalDays} < 1 THEN 1 WHEN ${words.intervalDays} = 1 THEN 3 ELSE LEAST(365, round(${words.intervalDays} * ${words.easeFactor} / 100.0)::int) END * interval '1 day')`,
                  lastReviewedAt: now,
                  status: sql`CASE WHEN ${words.correctStreak} + 1 >= 3 THEN 'mastered' ELSE 'learning' END`,
                  updatedAt: now,
                }
              : {
                  mistakeCount: sql`${words.mistakeCount} + 1`,
                  correctStreak: 0,
                  reviewCount: sql`${words.reviewCount} + 1`,
                  intervalDays: 1,
                  easeFactor: sql`GREATEST(130, ${words.easeFactor} - 20)`,
                  nextReviewAt: sql`now() + interval '1 day'`,
                  lastMistakeAt: now,
                  lastReviewedAt: now,
                  status: 'learning',
                  updatedAt: now,
                },
          )
          .where(and(eq(words.id, answer.wordId), eq(words.userId, current.id), isNull(words.deletedAt)))
    }

    const [test] = await tx
      .insert(tests)
      .values({
        userId: current.id,
        attemptId,
        source: claimed.source,
        questionMode: claimed.mode,
        questionCount: verified.length,
        correctAnswers: correct,
        wrongAnswers: verified.length - correct,
        score,
      })
      .returning()
    await tx.insert(testAnswers).values(
      verified.map((answer) => ({
        userId: current.id,
        testId: test.id,
        wordId: answer.wordId,
        question: answer.prompt,
        correctAnswer: answer.correctAnswer,
        userAnswer: answer.userAnswer,
        isCorrect: answer.isCorrect,
      })),
    )
    await awardProgress(tx, {
      userId: current.id,
      sourceType: 'word-quiz',
      sourceId: attemptId,
      xp: correct * 10,
      coins: correct * 2,
      metadata: { score, questionCount: verified.length },
    })
    await tx
      .update(wordQuizAttempts)
      .set({
        status: 'completed',
        correctAnswers: correct,
        wrongAnswers: verified.length - correct,
        score,
        completedAt: now,
      })
      .where(eq(wordQuizAttempts.id, attemptId))
    await reconcileChallengesForUser(tx, current.id)
    refresh('/', '/quiz', '/results', '/mistakes', '/words', '/challenges')
    return {
      ok: true,
      status: 'completed' as const,
      score,
      correctAnswers: correct,
      questionCount: verified.length,
    }
  })
}

export async function joinChallenge(
  challengeId: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const current = await requireUser()
  const now = new Date()
  const challengeKey = idSchema.parse(challengeId)
  const joined = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${challengeKey})`)
    const [record] = await tx
      .select({ challenge: challenges, settings: challengeSettings })
      .from(challenges)
      .innerJoin(challengeSettings, eq(challengeSettings.challengeId, challenges.id))
      .where(eq(challenges.id, challengeKey))
      .limit(1)
    if (!record || !['open', 'active'].includes(record.settings.lifecycle))
      throw new Error('هذا التحدي غير متاح للانضمام حاليًا.')
    if (record.challenge.startsAt && record.challenge.startsAt > now)
      throw new Error('لم يبدأ هذا التحدي بعد.')
    if (record.challenge.endsAt && record.challenge.endsAt < now) throw new Error('انتهى هذا التحدي.')
    const rules = record.settings.participationRules ?? {}
    if (rules.requireVerifiedEmail !== false && !current.emailVerified)
      throw new Error('يجب توثيق البريد الإلكتروني قبل الانضمام إلى هذا التحدي.')
    const minimumXp = typeof rules.minimumXp === 'number' ? rules.minimumXp : 0
    if (minimumXp > 0) {
      const [progress] = await tx
        .select({ xp: userProgress.xp })
        .from(userProgress)
        .where(eq(userProgress.userId, current.id))
        .limit(1)
      if ((progress?.xp ?? 0) < minimumXp)
        throw new Error(`يلزم ${minimumXp} XP على الأقل للانضمام إلى هذا التحدي.`)
    }
    const [existing] = await tx
      .select({ id: challengeParticipants.id })
      .from(challengeParticipants)
      .where(
        and(
          eq(challengeParticipants.userId, current.id),
          eq(challengeParticipants.challengeId, challengeKey),
        ),
      )
      .limit(1)
    if (existing) return false
    if (record.settings.maximumParticipants) {
      const [capacity] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(challengeParticipants)
        .where(eq(challengeParticipants.challengeId, challengeKey))
      if ((capacity?.count ?? 0) >= record.settings.maximumParticipants)
        throw new Error('اكتمل الحد الأقصى للمشاركين في هذا التحدي.')
    }
    await tx.insert(challengeParticipants).values({ userId: current.id, challengeId: challengeKey })
    await reconcileChallengesForUser(tx, current.id)
    return true
  })
  refresh('/challenges')
  return joined ? { ok: true } : { ok: false, message: 'أنت مشارك في هذا التحدي بالفعل.' }
}

export async function issueCertificate(challengeId: number) {
  const current = await requireUser()
  const challengeKey = idSchema.parse(challengeId)
  return db.transaction(async (tx) => {
    const [eligible] = await tx
      .select({ challenge: challenges, participation: challengeParticipants })
      .from(challengeParticipants)
      .innerJoin(challenges, eq(challengeParticipants.challengeId, challenges.id))
      .where(
        and(
          eq(challengeParticipants.userId, current.id),
          eq(challengeParticipants.challengeId, challengeKey),
          eq(challengeParticipants.status, 'completed'),
        ),
      )
      .limit(1)
    if (!eligible) throw new Error('لم يكتمل التحدي بعد')
    const [existing] = await tx
      .select()
      .from(certificates)
      .where(and(eq(certificates.userId, current.id), eq(certificates.challengeId, challengeKey)))
      .limit(1)
    if (existing) return existing

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const certificateNumber = `LGT-${new Date().getUTCFullYear()}-${randomBytes(12).toString('hex').toUpperCase()}`
      try {
        const [created] = await tx
          .insert(certificates)
          .values({
            userId: current.id,
            challengeId: challengeKey,
            title: eligible.challenge.title,
            certificateNumber,
          })
          .onConflictDoNothing()
          .returning()
        if (created) {
          refresh('/challenges', '/account')
          return created
        }
        const [duplicate] = await tx
          .select()
          .from(certificates)
          .where(and(eq(certificates.userId, current.id), eq(certificates.challengeId, challengeKey)))
          .limit(1)
        if (duplicate) return duplicate
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 2) throw error
      }
    }
    throw new Error('تعذر إصدار الشهادة. حاول مرة أخرى.')
  })
}

export async function getMathSections() {
  await requireUser()
  return db
    .select()
    .from(mathSections)
    .where(eq(mathSections.isActive, true))
    .orderBy(asc(mathSections.sortOrder), asc(mathSections.id))
}

async function loadMathAttempt(attemptId: number, userId: string) {
  const [attempt] = await db
    .select()
    .from(mathAttempts)
    .where(and(eq(mathAttempts.id, attemptId), eq(mathAttempts.userId, userId)))
    .limit(1)
  if (!attempt) throw new Error('محاولة الرياضيات غير موجودة')
  const questions = await db
    .select({
      id: mathQuestions.id,
      question: mathQuestions.question,
      option1: mathQuestions.option1,
      option2: mathQuestions.option2,
      option3: mathQuestions.option3,
      option4: mathQuestions.option4,
    })
    .from(mathAttemptQuestions)
    .innerJoin(mathQuestions, eq(mathAttemptQuestions.questionId, mathQuestions.id))
    .where(eq(mathAttemptQuestions.attemptId, attempt.id))
    .orderBy(asc(mathAttemptQuestions.ordinal))
  return { attemptId: attempt.id, status: attempt.status, questions, attempt }
}

export async function getMathQuiz(sectionSlug: string, count = 10, requestKeyValue?: string) {
  const current = await requireUser()
  const slug = z.string().trim().min(1).max(100).parse(sectionSlug)
  const safeCount = z.number().int().min(1).max(30).parse(count)
  const requestKey = uuidSchema.parse(requestKeyValue ?? crypto.randomUUID())
  const [section] = await db
    .select()
    .from(mathSections)
    .where(and(eq(mathSections.slug, slug), eq(mathSections.isActive, true)))
    .limit(1)
  if (!section) throw new Error('القسم غير موجود')
  const [existing] = await db
    .select({ id: mathAttempts.id })
    .from(mathAttempts)
    .where(and(eq(mathAttempts.userId, current.id), eq(mathAttempts.requestKey, requestKey)))
    .limit(1)
  if (existing)
    return { ok: true as const, section, ...(await loadMathAttempt(existing.id, current.id)) }

  const [{ count: total }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mathQuestions)
    .where(and(eq(mathQuestions.sectionId, section.id), eq(mathQuestions.isActive, true)))
  if (total < safeCount)
    return {
      ok: false as const,
      availableCount: total,
      error:
        total === 0
          ? 'لا توجد أسئلة منشورة في هذا القسم حاليًا. أضف أسئلة من لوحة التحكم ثم أعد المحاولة.'
          : `يتوفر ${total} سؤالًا فقط في هذا القسم. اختر عددًا أقل.`,
    }
  const sampleSize = Math.min(total, Math.max(safeCount * 5, 100))
  const offset = Math.floor(Math.random() * Math.max(1, total - sampleSize + 1))
  const candidates = await db
    .select({ id: mathQuestions.id })
    .from(mathQuestions)
    .where(and(eq(mathQuestions.sectionId, section.id), eq(mathQuestions.isActive, true)))
    .orderBy(asc(mathQuestions.id))
    .limit(sampleSize)
    .offset(offset)
  const selected = shuffle(candidates).slice(0, safeCount)

  const createdId = await db.transaction(async (tx) => {
    const [attempt] = await tx
      .insert(mathAttempts)
      .values({ userId: current.id, sectionId: section.id, requestKey, questionCount: selected.length })
      .onConflictDoNothing()
      .returning({ id: mathAttempts.id })
    if (!attempt) return null
    await tx
      .insert(mathAttemptQuestions)
      .values(
        selected.map((question, ordinal) => ({ attemptId: attempt.id, questionId: question.id, ordinal })),
      )
    return attempt.id
  })
  if (!createdId) {
    const [duplicate] = await db
      .select({ id: mathAttempts.id })
      .from(mathAttempts)
      .where(and(eq(mathAttempts.userId, current.id), eq(mathAttempts.requestKey, requestKey)))
      .limit(1)
    if (!duplicate) throw new Error('تعذر إنشاء محاولة الرياضيات')
    return { ok: true as const, section, ...(await loadMathAttempt(duplicate.id, current.id)) }
  }
  return { ok: true as const, section, ...(await loadMathAttempt(createdId, current.id)) }
}

export async function submitMathQuiz(
  attemptIdValue: number,
  answerValues: Array<{ questionId: number; answer: number }>,
) {
  const current = await requireUser()
  const attemptId = idSchema.parse(attemptIdValue)
  const answers = z
    .array(z.object({ questionId: idSchema, answer: z.number().int().min(1).max(4) }))
    .min(1)
    .max(30)
    .parse(answerValues)
  if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length)
    throw new Error('لا يمكن إرسال السؤال أكثر من مرة.')

  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .update(mathAttempts)
      .set({ status: 'grading' })
      .where(
        and(
          eq(mathAttempts.id, attemptId),
          eq(mathAttempts.userId, current.id),
          eq(mathAttempts.status, 'active'),
        ),
      )
      .returning()
    if (!attempt) {
      const [saved] = await tx
        .select()
        .from(mathAttempts)
        .where(and(eq(mathAttempts.id, attemptId), eq(mathAttempts.userId, current.id)))
        .limit(1)
      if (!saved) throw new Error('محاولة الرياضيات غير موجودة')
      return { ok: false, message: 'تم حفظ هذه المحاولة مسبقًا.', attempt: saved }
    }
    const issued = await tx
      .select({ id: mathQuestions.id, correctOption: mathQuestions.correctOption })
      .from(mathAttemptQuestions)
      .innerJoin(mathQuestions, eq(mathAttemptQuestions.questionId, mathQuestions.id))
      .where(eq(mathAttemptQuestions.attemptId, attempt.id))
    const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.answer]))
    if (
      issued.length !== attempt.questionCount ||
      answers.length !== issued.length ||
      issued.some((question) => !answerMap.has(question.id))
    ) {
      throw new Error('يجب إرسال إجابة واحدة لكل سؤال صدر في هذه المحاولة.')
    }
    const verified = issued.map((question) => ({
      questionId: question.id,
      answer: answerMap.get(question.id)!,
      isCorrect: question.correctOption === answerMap.get(question.id),
    }))
    const correct = verified.filter((answer) => answer.isCorrect).length
    const score = Math.round((correct / verified.length) * 100)
    const [saved] = await tx
      .update(mathAttempts)
      .set({
        status: 'completed',
        correctAnswers: correct,
        score,
        answers: verified,
        completedAt: new Date(),
      })
      .where(eq(mathAttempts.id, attempt.id))
      .returning()
    await awardProgress(tx, {
      userId: current.id,
      sourceType: 'math-quiz',
      sourceId: String(attempt.id),
      xp: correct * 10,
      coins: correct * 2,
      metadata: { score, questionCount: verified.length },
    })
    await reconcileChallengesForUser(tx, current.id)
    refresh(`/math`, `/math/${attempt.sectionId}`, '/challenges')
    return { ok: true, attempt: saved }
  })
}

export type MathImportRow = {
  question: string
  option1: string
  option2: string
  option3: string
  option4: string
  correctOption: number
  explanation?: string
}

const mathWorkbookAliases: Record<string, keyof MathImportRow> = {
  question: 'question',
  السؤال: 'question',
  option1: 'option1',
  'اختيار 1': 'option1',
  option2: 'option2',
  'اختيار 2': 'option2',
  option3: 'option3',
  'اختيار 3': 'option3',
  option4: 'option4',
  'اختيار 4': 'option4',
  correctoption: 'correctOption',
  'الإجابة الصحيحة': 'correctOption',
  explanation: 'explanation',
  الشرح: 'explanation',
}

export async function importMathWorkbook(sectionSlug: string, form: FormData) {
  await requirePermission('content:write')
  const files = form.getAll('files').filter((value): value is File => value instanceof File)
  if (!files.length || files.length > 2) throw new Error('اختر ملف XLSX واحدًا أو ملفين فقط.')
  const combined: MathImportRow[] = []

  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.xlsx')) throw new Error('يُسمح بملفات XLSX فقط.')
    if (!file.size || file.size > 2 * 1024 * 1024) throw new Error('حجم كل ملف يجب ألا يتجاوز 2MB.')
    const bytes = Buffer.from(await file.arrayBuffer())
    assertSafeWorkbookArchive(bytes)
    let workbookRows: SheetData
    try {
      workbookRows = await readSheet(bytes)
    } catch {
      throw new Error('تعذر قراءة الملف. تأكد أنه XLSX صالح ويستخدم القالب المحدد.')
    }
    if (workbookRows.length < 2 || workbookRows.length > 2_001)
      throw new Error('يجب أن يحتوي كل ملف على عنوان الأعمدة و1 إلى 2000 سؤال.')
    const header: Array<keyof MathImportRow | undefined> = workbookRows[0].map((cell) => {
      const value = String(cell ?? '').trim()
      return mathWorkbookAliases[value.toLowerCase()] ?? mathWorkbookAliases[value]
    })
    const required: Array<keyof MathImportRow> = [
      'question',
      'option1',
      'option2',
      'option3',
      'option4',
      'correctOption',
    ]
    if (required.some((column) => !header.includes(column)))
      throw new Error('عناوين أعمدة ملف XLSX لا تطابق القالب المطلوب.')

    for (const row of workbookRows.slice(1)) {
      if (row.every((cell) => String(cell ?? '').trim() === '')) continue
      const mapped: Partial<Record<keyof MathImportRow, unknown>> = {}
      row.forEach((cell, index) => {
        const key = header[index]
        if (key) mapped[key] = cell
      })
      combined.push({
        question: String(mapped.question ?? ''),
        option1: String(mapped.option1 ?? ''),
        option2: String(mapped.option2 ?? ''),
        option3: String(mapped.option3 ?? ''),
        option4: String(mapped.option4 ?? ''),
        correctOption: Number(mapped.correctOption),
        explanation: String(mapped.explanation ?? ''),
      })
      if (combined.length > 2_000) throw new Error('الحد الأقصى للدفعة الواحدة هو 2000 سؤال.')
    }
  }
  if (!combined.length) throw new Error('لا توجد صفوف أسئلة صالحة في الملفات.')
  return importMathQuestions(sectionSlug, combined)
}

export async function importMathQuestions(sectionSlug: string, rows: MathImportRow[]) {
  const actor = await requirePermission('content:write')
  const [section] = await db
    .select()
    .from(mathSections)
    .where(and(eq(mathSections.slug, sectionSlug), eq(mathSections.isActive, true)))
    .limit(1)
  if (!section) throw new Error('قسم الرياضيات غير موجود')
  if (!rows.length || rows.length > 2_000) throw new Error('يجب أن يحتوي الملف على 1 إلى 2000 سؤال')
  const normalizedRows = rows.map((row, index) => ({
    rowNumber: index + 2,
    question: cleanText(row.question),
    normalizedQuestion: normalizeText(row.question),
    option1: cleanText(row.option1),
    option2: cleanText(row.option2),
    option3: cleanText(row.option3),
    option4: cleanText(row.option4),
    correctOption: Number(row.correctOption),
    explanation: cleanText(row.explanation) || null,
  }))
  const invalid = normalizedRows.filter((row) => {
    const options = [row.option1, row.option2, row.option3, row.option4]
    return (
      !row.question ||
      options.some((option) => !option) ||
      new Set(options.map(normalizeText)).size !== 4 ||
      ![1, 2, 3, 4].includes(row.correctOption)
    )
  })
  if (invalid.length)
    throw new Error(
      `بيانات غير صحيحة أو اختيارات مكررة في الصفوف: ${invalid
        .slice(0, 10)
        .map((row) => row.rowNumber)
        .join('، ')}`,
    )
  const uniqueRows = [...new Map(normalizedRows.map((row) => [row.normalizedQuestion, row])).values()]
  const inserted = await db.transaction(async (tx) => {
    const created = await tx
      .insert(mathQuestions)
      .values(
        uniqueRows.map(({ rowNumber, ...row }) => {
          void rowNumber
          return { sectionId: section.id, ...row }
        }),
      )
      .onConflictDoNothing()
      .returning({ normalizedQuestion: mathQuestions.normalizedQuestion })
    await writeAudit(tx, actor.id, 'math.questions.import', 'mathSection', String(section.id), null, {
      requested: rows.length,
      inserted: created.length,
    })
    return created
  })
  const insertedSet = new Set(inserted.map((row) => row.normalizedQuestion))
  refresh('/admin', '/math', `/math/${sectionSlug}`)
  return {
    ok: true,
    added: inserted.length,
    skipped: rows.length - inserted.length,
    duplicates: uniqueRows
      .filter((row) => !insertedSet.has(row.normalizedQuestion))
      .map((row) => row.question)
      .slice(0, 100),
  }
}

type CompetitionAnswer = { questionId: string; answer: string }
type CompetitionQuestion = { id: string; source: 'en' | 'ar' | 'math'; prompt: string; options: string[] }

function competitionWindow(
  competition: typeof competitions.$inferSelect,
  current?: Awaited<ReturnType<typeof requireUser>>,
) {
  const availability = getCompetitionAvailability(
    {
      ...competition,
      audience: competition.audience as CompetitionAudience,
    },
    current ?? undefined,
  )
  if (!availability.ok) throw new Error(availability.message)
}


export async function joinCompetition(competitionId: number) {
  const current = await requireUser()
  const [competition] = await db
    .select()
    .from(competitions)
    .where(eq(competitions.id, idSchema.parse(competitionId)))
    .limit(1)
  if (!competition) throw new Error('المنافسة غير متاحة')
  competitionWindow(competition, current)
  const [participant] = await db
    .insert(competitionParticipants)
    .values({ userId: current.id, competitionId: competition.id })
    .onConflictDoNothing()
    .returning()
  refresh('/competitions')
  return {
    ok: true,
    message: participant ? 'تم انضمامك إلى المنافسة بنجاح.' : 'أنت منضم إلى هذه المنافسة بالفعل.',
  }
}

async function existingCompetitionQuestions(participantId: number): Promise<CompetitionQuestion[]> {
  const rows = await db
    .select({
      id: competitionQuestions.id,
      source: competitionQuestions.source,
      prompt: competitionQuestions.prompt,
      options: competitionQuestions.options,
    })
    .from(competitionQuestions)
    .where(eq(competitionQuestions.participantId, participantId))
    .orderBy(asc(competitionQuestions.ordinal))
  return rows
}

export async function getCompetitionQuiz(competitionId: number) {
  const current = await requireUser()
  const id = idSchema.parse(competitionId)
  const [competition] = await db.select().from(competitions).where(eq(competitions.id, id)).limit(1)
  if (!competition) throw new Error('المنافسة غير متاحة')
  competitionWindow(competition, current)
  const [participant] = await db
    .select()
    .from(competitionParticipants)
    .where(and(eq(competitionParticipants.userId, current.id), eq(competitionParticipants.competitionId, id)))
    .limit(1)
  if (!participant) throw new Error('انضم إلى المنافسة أولًا')
  if (participant.status === 'submitted')
    return { competition, questions: [] as CompetitionQuestion[], completed: true }
  if (participant.status === 'disqualified') throw new Error('تم استبعادك من هذه المنافسة.')
  if (participant.status === 'expired') throw new Error('انتهت صلاحية مشاركتك في هذه المنافسة.')
  if (participant.status === 'grading') throw new Error('يجري تصحيح مشاركتك الآن.')
  const saved = await existingCompetitionQuestions(participant.id)
  if (saved.length) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${participant.id})`)
      const [state] = await tx
        .select()
        .from(competitionParticipants)
        .where(eq(competitionParticipants.id, participant.id))
        .limit(1)
      if (!state) throw new Error('تعذر قراءة المشاركة.')
      if (state.status === 'disqualified') throw new Error('تم استبعادك من هذه المنافسة.')
      if (state.status === 'expired') throw new Error('انتهت صلاحية مشاركتك في هذه المنافسة.')
      if (state.status === 'grading') throw new Error('يجري تصحيح مشاركتك الآن.')
      if (state.status === 'joined')
        await tx
          .update(competitionParticipants)
          .set({ status: 'active', startedAt: state.startedAt ?? new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(competitionParticipants.id, participant.id),
              eq(competitionParticipants.status, 'joined'),
            ),
          )
    })
    return { competition, questions: saved, completed: false }
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${participant.id})`)
    const [state] = await tx
      .select()
      .from(competitionParticipants)
      .where(eq(competitionParticipants.id, participant.id))
      .limit(1)
    if (!state || state.status === 'submitted') return
    if (state.status === 'disqualified' || state.status === 'expired' || state.status === 'grading')
      throw new Error('هذه المشاركة غير متاحة للبدء.')
    const [{ count: issuedCount }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(competitionQuestions)
      .where(eq(competitionQuestions.participantId, participant.id))
    if (issuedCount) return

    const selectedCategories = await tx
      .select({ id: competitionCategories.categoryId })
      .from(competitionCategories)
      .where(eq(competitionCategories.competitionId, competition.id))
    const categoryIds = selectedCategories.map((row) => row.id)
    const scope = competition.scope
    const wordCondition = and(
      eq(words.userId, current.id),
      isNull(words.deletedAt),
      scope === 'all'
        ? inArray(words.language, ['en', 'ar'])
        : scope === 'math'
          ? sql`false`
          : eq(words.language, scope),
      categoryIds.length ? inArray(words.categoryId, categoryIds) : sql`true`,
    )
    const languageRows =
      scope === 'math'
        ? []
        : await tx
            .select({ id: words.id, language: words.language, word: words.word, meaning: words.meaning })
            .from(words)
            .where(wordCondition)
            .orderBy(desc(words.id))
            .limit(Math.max(competition.questionCount * 20, 100))
    const selectedMathSections = await tx
      .select({ id: competitionMathSections.sectionId })
      .from(competitionMathSections)
      .where(eq(competitionMathSections.competitionId, competition.id))
    const mathSectionIds = selectedMathSections.map((row) => row.id)
    const mathRows =
      scope === 'en' || scope === 'ar'
        ? []
        : await tx
            .select({
              id: mathQuestions.id,
              question: mathQuestions.question,
              option1: mathQuestions.option1,
              option2: mathQuestions.option2,
              option3: mathQuestions.option3,
              option4: mathQuestions.option4,
              correctOption: mathQuestions.correctOption,
            })
            .from(mathQuestions)
            .where(
              mathSectionIds.length
                ? and(eq(mathQuestions.isActive, true), inArray(mathQuestions.sectionId, mathSectionIds))
                : competition.sectionId
                  ? and(eq(mathQuestions.isActive, true), eq(mathQuestions.sectionId, competition.sectionId))
                  : eq(mathQuestions.isActive, true),
            )
            .orderBy(desc(mathQuestions.id))
            .limit(Math.max(competition.questionCount * 10, 100))

    const languagePool = languageRows.flatMap((row) => {
      const meanings = [
        ...new Set(
          languageRows
            .filter((item) => item.language === row.language && item.id !== row.id)
            .map((item) => item.meaning),
        ),
      ].filter((meaning) => normalizeText(meaning) !== normalizeText(row.meaning))
      if (meanings.length < 3) return []
      return [
        {
          source: row.language,
          wordId: row.id,
          mathQuestionId: null,
          prompt: row.word,
          options: shuffle([row.meaning, ...shuffle(meanings).slice(0, 3)]),
          correctAnswer: row.meaning,
        },
      ]
    })
    const mathPool = mathRows.map((row) => {
      const options = [row.option1, row.option2, row.option3, row.option4]
      return {
        source: 'math' as const,
        wordId: null,
        mathQuestionId: row.id,
        prompt: row.question,
        options: shuffle(options),
        correctAnswer: options[row.correctOption - 1],
      }
    })
    const selected = shuffle([...languagePool, ...mathPool]).slice(0, competition.questionCount)
    if (selected.length !== competition.questionCount)
      throw new Error(
        `لا يمكن تكوين ${competition.questionCount} سؤالًا آمنًا من محتوى حسابك والمحتوى المنشور.`,
      )
    await tx
      .insert(competitionQuestions)
      .values(selected.map((question, ordinal) => ({ participantId: participant.id, ordinal, ...question })))
    await tx
      .update(competitionParticipants)
      .set({ status: 'active', startedAt: state.startedAt ?? new Date(), updatedAt: new Date() })
      .where(eq(competitionParticipants.id, participant.id))
  })

  const questions = await existingCompetitionQuestions(participant.id)
  return { competition, questions, completed: false }
}

export async function submitCompetition(competitionId: number, answerValues: CompetitionAnswer[]) {
  const current = await requireUser()
  const id = idSchema.parse(competitionId)
  const answers = z
    .array(z.object({ questionId: uuidSchema, answer: z.string().max(2_000) }))
    .min(1)
    .max(30)
    .parse(answerValues)
  if (new Set(answers.map((answer) => answer.questionId)).size !== answers.length)
    throw new Error('لا يمكن إرسال السؤال أكثر من مرة.')

  return db.transaction(async (tx) => {
    const [competition] = await tx.select().from(competitions).where(eq(competitions.id, id)).limit(1)
    if (!competition) throw new Error('المنافسة غير موجودة')
    const [participant] = await tx
      .select()
      .from(competitionParticipants)
      .where(
        and(eq(competitionParticipants.userId, current.id), eq(competitionParticipants.competitionId, id)),
      )
      .limit(1)
    if (!participant) throw new Error('لم تنضم إلى المنافسة')
    await tx.execute(sql`select pg_advisory_xact_lock(${participant.id})`)
    const [state] = await tx
      .select()
      .from(competitionParticipants)
      .where(eq(competitionParticipants.id, participant.id))
      .limit(1)
    if (!state) throw new Error('تعذر قراءة المشاركة')
    if (state.status === 'submitted')
      return {
        ok: false,
        message: 'تم حفظ نتيجتك مسبقًا.',
        score: state.score,
        correct: state.correctAnswers,
      }
    const now = new Date()
    const availability = getCompetitionAvailability(
      {
        ...competition,
        audience: competition.audience as CompetitionAudience,
      },
      current,
      now,
    )
    if (!availability.ok) {
      if (availability.code === 'ENDED') {
        await tx
          .update(competitionParticipants)
          .set({ status: 'expired', updatedAt: now })
          .where(eq(competitionParticipants.id, state.id))
      }
      throw new Error(
        availability.code === 'ENDED' ? 'انتهت مهلة تسليم هذه المنافسة.' : availability.message,
      )
    }
    if (state.status !== 'active') throw new Error('ابدأ المنافسة واحصل على أسئلتك قبل التسليم.')
    const issued = await tx
      .select()
      .from(competitionQuestions)
      .where(eq(competitionQuestions.participantId, state.id))
      .orderBy(asc(competitionQuestions.ordinal))
    const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.answer]))
    if (
      issued.length !== competition.questionCount ||
      answers.length !== issued.length ||
      issued.some((question) => !answerMap.has(question.id))
    ) {
      throw new Error('يجب إرسال إجابة واحدة لكل سؤال صدر لك في هذه المنافسة.')
    }
    const [claimed] = await tx
      .update(competitionParticipants)
      .set({ status: 'grading', updatedAt: now })
      .where(and(eq(competitionParticipants.id, state.id), eq(competitionParticipants.status, 'active')))
      .returning({ id: competitionParticipants.id })
    if (!claimed) throw new Error('يجري تصحيح هذه المشاركة بالفعل.')
    const verified = issued.map((question) => {
      const answer = answerMap.get(question.id) ?? ''
      return {
        questionId: question.id,
        answer,
        isCorrect: normalizeText(answer) === normalizeText(question.correctAnswer),
      }
    })
    const correct = verified.filter((answer) => answer.isCorrect).length
    const score = Math.round((correct / issued.length) * 100)
    const awarded = await awardProgress(tx, {
      userId: current.id,
      sourceType: 'competition',
      sourceId: String(state.id),
      xp: Math.round((competition.xpReward * score) / 100),
      coins: Math.round((competition.coinReward * score) / 100),
      metadata: { competitionId: competition.id, score },
    })
    await tx
      .update(competitionParticipants)
      .set({
        status: 'submitted',
        answers: verified,
        correctAnswers: correct,
        score,
        xpAwarded: awarded,
        submittedAt: now,
        rewardedAt: awarded ? now : state.rewardedAt,
        updatedAt: now,
      })
      .where(eq(competitionParticipants.id, state.id))
    refresh('/competitions')
    return { ok: true, message: 'تم حفظ نتيجتك.', score, correct }
  })
}

type LeaderRow = {
  competitionId: number
  userId: string
  score: number
  correctAnswers: number
  name: string
}

export async function getCompetitions() {
  const current = await requireUser()
  const accountIsNew = current.createdAt.getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000
  const eligibleAudiences = [
    'all',
    ...(current.emailVerified ? ['verified'] : []),
    accountIsNew ? 'new_users' : 'existing_users',
  ] as Array<'all' | 'verified' | 'new_users' | 'existing_users'>
  const [items, joined, leaderResult] = await Promise.all([
    db
      .select()
      .from(competitions)
      .where(
        and(
          eq(competitions.isActive, true),
          inArray(competitions.lifecycle, ['scheduled', 'active']),
          inArray(competitions.audience, eligibleAudiences),
          current.emailVerified ? sql`true` : eq(competitions.requiresVerifiedEmail, false),
        ),
      )
      .orderBy(asc(competitions.priority), desc(competitions.createdAt))
      .limit(100),
    db.select().from(competitionParticipants).where(eq(competitionParticipants.userId, current.id)),
    db.execute<LeaderRow>(sql`
      select ranked."competitionId", ranked."userId", ranked.score, ranked."correctAnswers", ranked.name
      from (
        select cp."competitionId", cp."userId", cp.score, cp."correctAnswers", u.name,
          row_number() over (partition by cp."competitionId" order by cp.score desc, cp."correctAnswers" desc, cp."submittedAt" asc) as rank
        from "competitionParticipants" cp
        inner join "user" u on u.id = cp."userId"
        where cp.status = 'submitted'
      ) ranked
      where ranked.rank <= 5
      order by ranked."competitionId", ranked.rank
    `),
  ])
  return { items, joined, leaders: leaderResult.rows }
}

export async function getAdminData() {
  await requireAdminArea()
  const [
    countRows,
    users,
    wordRows,
    challengeRows,
    participantRows,
    bannerRows,
    messageRows,
    achievementRows,
    categoryRows,
    categoryCounts,
    sectionRows,
    questionCounts,
    competitionRows,
    competitionParticipantRows,
  ] = await Promise.all([
    db.execute<{ users: number; words: number; challenges: number; participants: number }>(sql`
      select
        (select count(*)::int from "user" where "deletedAt" is null) as users,
        (select count(*)::int from words where "deletedAt" is null) as words,
        (select count(*)::int from challenges where "isActive" = true) as challenges,
        (select count(*)::int from "challengeParticipants") as participants
    `),
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        role: user.role,
        banned: user.banned,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(isNull(user.deletedAt))
      .orderBy(desc(user.createdAt))
      .limit(50),
    db
      .select({
        id: words.id,
        userId: words.userId,
        word: words.word,
        meaning: words.meaning,
        language: words.language,
        level: words.level,
        categoryId: words.categoryId,
        createdAt: words.createdAt,
      })
      .from(words)
      .where(isNull(words.deletedAt))
      .orderBy(desc(words.createdAt))
      .limit(50),
    db.select().from(challenges).orderBy(desc(challenges.createdAt)).limit(100),
    db.select().from(challengeParticipants).orderBy(desc(challengeParticipants.joinedAt)).limit(100),
    db.select().from(banners).orderBy(asc(banners.sortOrder), desc(banners.createdAt)).limit(100),
    db.select().from(encouragementMessages).orderBy(asc(encouragementMessages.sortOrder)).limit(100),
    db.select().from(achievements).orderBy(asc(achievements.sortOrder)).limit(100),
    db.select().from(categories).orderBy(asc(categories.sortOrder)).limit(200),
    db
      .select({ categoryId: words.categoryId, count: sql<number>`count(*)::int` })
      .from(words)
      .where(and(sql`${words.categoryId} is not null`, isNull(words.deletedAt)))
      .groupBy(words.categoryId),
    db.select().from(mathSections).orderBy(asc(mathSections.sortOrder), asc(mathSections.id)).limit(100),
    db
      .select({ sectionId: mathQuestions.sectionId, count: sql<number>`count(*)::int` })
      .from(mathQuestions)
      .groupBy(mathQuestions.sectionId),
    db.select().from(competitions).orderBy(desc(competitions.createdAt)).limit(100),
    db.select().from(competitionParticipants).orderBy(desc(competitionParticipants.joinedAt)).limit(100),
  ])
  return {
    counts: countRows.rows[0] ?? { users: 0, words: 0, challenges: 0, participants: 0 },
    users,
    words: wordRows,
    challenges: challengeRows,
    participants: participantRows,
    banners: bannerRows,
    messages: messageRows,
    achievements: achievementRows,
    categories: categoryRows,
    categoryCounts: Object.fromEntries(
      categoryCounts
        .filter((row): row is { categoryId: number; count: number } => row.categoryId !== null)
        .map((row) => [row.categoryId, row.count]),
    ),
    mathSections: sectionRows,
    questionCounts: Object.fromEntries(questionCounts.map((row) => [row.sectionId, row.count])),
    competitions: competitionRows,
    competitionParticipants: competitionParticipantRows,
  }
}

const platformCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(100),
  language: languageSchema,
  description: z.string().trim().max(1_000).nullable(),
  sortOrder: z.number().int().min(0).max(100_000),
})

function parsePlatformCategory(form: FormData) {
  return platformCategorySchema.parse({
    name: cleanText(form.get('name')),
    slug: cleanText(form.get('slug')),
    language: form.get('language'),
    description: cleanText(form.get('description')) || null,
    sortOrder: Number(form.get('sortOrder') || 0),
  })
}

export async function createPlatformCategory(form: FormData) {
  const actor = await requirePermission('content:write')
  const parsed = parsePlatformCategory(form)
  try {
    const [created] = await db.transaction(async (tx) => {
      const records = await tx
        .insert(categories)
        .values({
          ...parsed,
          normalizedName: normalizeText(parsed.name),
          scope: 'platform',
          userId: null,
        })
        .returning()
      if (records[0])
        await writeAudit(tx, actor.id, 'category.create', 'category', String(records[0].id), null, {
          name: records[0].name,
          language: records[0].language,
          slug: records[0].slug,
        })
      return records
    })
    refresh('/admin', '/add', '/arabic', '/english')
    return { ok: true, message: 'تم إنشاء القسم.', category: created }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'يوجد قسم بالاسم أو المعرّف نفسه.' }
    throw error
  }
}

export async function updatePlatformCategory(categoryId: number, form: FormData) {
  const actor = await requirePermission('content:write')
  const id = idSchema.parse(categoryId)
  const parsed = parsePlatformCategory(form)
  try {
    const result = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(categories)
        .where(and(eq(categories.id, id), eq(categories.scope, 'platform'), isNull(categories.userId)))
        .limit(1)
      if (!before) throw new Error('قسم المنصة غير موجود')
      const [updated] = await tx
        .update(categories)
        .set({ ...parsed, normalizedName: normalizeText(parsed.name), updatedAt: new Date() })
        .where(eq(categories.id, id))
        .returning()
      await writeAudit(tx, actor.id, 'category.update', 'category', String(id), before, updated)
      return updated
    })
    refresh('/admin', '/add', '/arabic', '/english')
    return { ok: true, message: 'تم تعديل القسم.', category: result }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'يوجد قسم بالاسم أو المعرّف نفسه.' }
    throw error
  }
}

export async function togglePlatformCategory(categoryId: number) {
  const actor = await requirePermission('content:write')
  const id = idSchema.parse(categoryId)
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ isActive: categories.isActive })
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.scope, 'platform'), isNull(categories.userId)))
      .limit(1)
    if (!before) throw new Error('قسم المنصة غير موجود')
    const [after] = await tx
      .update(categories)
      .set({ isActive: !before.isActive, updatedAt: new Date() })
      .where(eq(categories.id, id))
      .returning({ isActive: categories.isActive })
    await writeAudit(tx, actor.id, 'category.toggle', 'category', String(id), before, after)
  })
  refresh('/admin', '/add', '/arabic', '/english')
}

export async function deletePlatformCategory(categoryId: number) {
  const actor = await requirePermission('content:write')
  const id = idSchema.parse(categoryId)
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.scope, 'platform'), isNull(categories.userId)))
      .limit(1)
    if (!before) throw new Error('قسم المنصة غير موجود')
    const [[wordLinks], [competitionLinks]] = await Promise.all([
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(words)
        .where(and(eq(words.categoryId, id), isNull(words.deletedAt))),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(competitionCategories)
        .where(eq(competitionCategories.categoryId, id)),
    ])
    if ((wordLinks?.count ?? 0) > 0 || (competitionLinks?.count ?? 0) > 0)
      throw new Error('لا يمكن حذف قسم مرتبط بكلمات أو منافسات. أوقفه أو انقل المحتوى أولًا.')
    await tx.delete(categories).where(eq(categories.id, id))
    await writeAudit(tx, actor.id, 'category.delete', 'category', String(id), before, null)
  })
  refresh('/admin', '/add', '/arabic', '/english')
}

export async function toggleUserBan(targetUserId: string) {
  const actor = await requirePermission('users:write')
  const targetId = z.string().min(1).max(200).parse(targetUserId)
  if (actor.id === targetId) throw new Error('لا يمكنك إيقاف حسابك الإداري بنفسك.')
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ banned: user.banned })
      .from(user)
      .where(and(eq(user.id, targetId), isNull(user.deletedAt)))
      .limit(1)
    if (!before) throw new Error('المستخدم غير موجود')
    const next = !before.banned
    await tx
      .update(user)
      .set({ banned: next, banReason: next ? 'إيقاف إداري' : null, updatedAt: new Date() })
      .where(eq(user.id, targetId))
    if (next) await tx.delete(session).where(eq(session.userId, targetId))
    await writeAudit(tx, actor.id, 'user.ban.toggle', 'user', targetId, before, { banned: next })
  })
  refresh('/admin')
}

export async function adminDeleteWord(wordId: number) {
  const actor = await requirePermission('content:write')
  const id = idSchema.parse(wordId)
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ id: words.id, userId: words.userId, word: words.word })
      .from(words)
      .where(and(eq(words.id, id), isNull(words.deletedAt)))
      .limit(1)
    if (!before) throw new Error('الكلمة غير موجودة')
    const [after] = await tx
      .update(words)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(words.id, id))
      .returning({ id: words.id, deletedAt: words.deletedAt })
    await writeAudit(tx, actor.id, 'word.archive', 'word', String(id), before, after)
  })
  refresh('/admin')
}

export async function createMathSection(form: FormData) {
  const actor = await requirePermission('content:write')
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(120),
      slug: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .max(100),
      description: z.string().trim().max(1_000).nullable(),
      sortOrder: z.number().int().min(0).max(100_000),
    })
    .parse({
      name: cleanText(form.get('name')),
      slug: cleanText(form.get('slug')),
      description: cleanText(form.get('description')) || null,
      sortOrder: Number(form.get('sortOrder') || 0),
    })
  try {
    const [created] = await db.transaction(async (tx) => {
      const records = await tx
        .insert(mathSections)
        .values({ ...parsed, normalizedName: normalizeText(parsed.name) })
        .returning()
      if (records[0])
        await writeAudit(tx, actor.id, 'math.section.create', 'mathSection', String(records[0].id), null, {
          name: records[0].name,
          slug: records[0].slug,
        })
      return records
    })
    refresh('/admin', '/math')
    return { ok: true, message: 'تم إنشاء قسم الرياضيات.', section: created }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'يوجد قسم رياضيات بهذا الاسم أو المعرّف.' }
    throw error
  }
}

export async function toggleMathSection(sectionId: number) {
  const actor = await requirePermission('content:write')
  const id = idSchema.parse(sectionId)
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ isActive: mathSections.isActive })
      .from(mathSections)
      .where(eq(mathSections.id, id))
      .limit(1)
    if (!before) throw new Error('قسم الرياضيات غير موجود')
    const [after] = await tx
      .update(mathSections)
      .set({ isActive: !before.isActive, updatedAt: new Date() })
      .where(eq(mathSections.id, id))
      .returning({ isActive: mathSections.isActive })
    await writeAudit(tx, actor.id, 'math.section.toggle', 'mathSection', String(id), before, after)
  })
  refresh('/admin', '/math')
}

export async function createChallenge(form: FormData) {
  const actor = await requirePermission('rewards:write')
  const parsed = z
    .object({
      title: z.string().trim().min(2).max(160),
      description: z.string().trim().min(2).max(2_000),
      metric: z.enum(['words', 'sentences', 'reviews', 'streak']),
      target: z.number().int().min(1).max(1_000_000),
      xpReward: z.number().int().min(0).max(100_000),
      coinReward: z.number().int().min(0).max(100_000),
      badgeName: z.string().trim().max(120).nullable(),
      startsAt: z.date().nullable(),
      endsAt: z.date().nullable(),
    })
    .parse({
      title: cleanText(form.get('title')),
      description: cleanText(form.get('description')),
      metric: form.get('metric') || 'words',
      target: Number(form.get('target') || 10),
      xpReward: Number(form.get('xpReward') || 100),
      coinReward: Number(form.get('coinReward') || 20),
      badgeName: cleanText(form.get('badgeName')) || null,
      startsAt: form.get('startsAt') ? new Date(String(form.get('startsAt'))) : null,
      endsAt: form.get('endsAt') ? new Date(String(form.get('endsAt'))) : null,
    })
  if (parsed.startsAt && parsed.endsAt && parsed.endsAt <= parsed.startsAt)
    throw new Error('يجب أن يكون وقت النهاية بعد وقت البداية')
  try {
    const [created] = await db.transaction(async (tx) => {
      const records = await tx
        .insert(challenges)
        .values({ ...parsed, normalizedTitle: normalizeText(parsed.title) })
        .returning()
      if (records[0])
        await writeAudit(tx, actor.id, 'challenge.create', 'challenge', String(records[0].id), null, {
          title: records[0].title,
        })
      return records
    })
    refresh('/admin', '/challenges')
    return { ok: true, challenge: created }
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, message: 'يوجد تحدٍ بهذا العنوان بالفعل.' }
    throw error
  }
}

export async function toggleChallenge(challengeId: number) {
  const actor = await requirePermission('rewards:write')
  const id = idSchema.parse(challengeId)
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ isActive: challenges.isActive })
      .from(challenges)
      .where(eq(challenges.id, id))
      .limit(1)
    if (!before) throw new Error('التحدي غير موجود')
    await tx
      .update(challenges)
      .set({ isActive: !before.isActive, updatedAt: new Date() })
      .where(eq(challenges.id, id))
    await writeAudit(tx, actor.id, 'challenge.toggle', 'challenge', String(id), before, {
      isActive: !before.isActive,
    })
  })
  refresh('/admin', '/challenges')
}

export async function deleteChallenge(challengeId: number) {
  const actor = await requirePermission('rewards:write')
  const id = idSchema.parse(challengeId)
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ id: challenges.id, title: challenges.title })
      .from(challenges)
      .where(eq(challenges.id, id))
      .limit(1)
    if (!before) throw new Error('التحدي غير موجود')
    const [certificate] = await tx
      .select({ id: certificates.id })
      .from(certificates)
      .where(eq(certificates.challengeId, id))
      .limit(1)
    if (certificate) throw new Error('لا يمكن حذف تحدٍ صدرت له شهادات. أوقفه بدلًا من حذفه.')
    await tx.delete(challenges).where(eq(challenges.id, id))
    await writeAudit(tx, actor.id, 'challenge.delete', 'challenge', String(id), before, null)
  })
  refresh('/admin', '/challenges')
}

export async function createMessage(form: FormData) {
  const actor = await requirePermission('content:write')
  const parsed = z
    .object({
      message: z.string().trim().min(2).max(500),
      minProgress: z.number().int().min(0).max(100),
      maxProgress: z.number().int().min(0).max(100),
    })
    .parse({
      message: cleanText(form.get('message')),
      minProgress: Number(form.get('minProgress') || 0),
      maxProgress: Number(form.get('maxProgress') || 100),
    })
  if (parsed.maxProgress < parsed.minProgress)
    throw new Error('الحد الأقصى يجب أن يساوي الحد الأدنى أو يزيد عليه.')
  const [created] = await db.transaction(async (tx) => {
    const records = await tx.insert(encouragementMessages).values(parsed).returning()
    if (records[0])
      await writeAudit(tx, actor.id, 'message.create', 'encouragementMessage', String(records[0].id), null, {
        message: records[0].message,
      })
    return records
  })
  refresh('/admin', '/')
  return { ok: true, message: 'تم حفظ الرسالة.', item: created }
}

export async function createBanner(form: FormData) {
  const actor = await requirePermission('content:write')
  const title = z
    .string()
    .trim()
    .min(2)
    .max(160)
    .parse(cleanText(form.get('title')))
  const description = z
    .string()
    .max(2_000)
    .parse(cleanText(form.get('description')))
  const buttonText = z
    .string()
    .max(120)
    .parse(cleanText(form.get('buttonText')))
  const rawButtonUrl = cleanText(form.get('buttonUrl'))
  const appOrigin = new URL(
    process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  ).origin
  const buttonUrl = rawButtonUrl ? safeExternalUrl(rawButtonUrl, appOrigin) : null
  if (rawButtonUrl && !buttonUrl) throw new Error('رابط الزر غير آمن. استخدم رابط HTTPS أو مسارًا داخليًا.')
  const image = form.get('image')
  let imagePathname: string | null = null
  let imageMediaType: string | null = null
  try {
    if (image instanceof File && image.size) {
      if (image.size > 5 * 1024 * 1024) throw new Error('حجم الصورة يجب ألا يتجاوز 5MB')
      const bytes = new Uint8Array(await image.arrayBuffer())
      const detected = detectSafeImageType(bytes)
      if (!detected) throw new Error('نوع الصورة غير مدعوم. استخدم PNG أو JPEG أو WebP أو GIF صالحًا.')
      const extension: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      }
      const blob = await put(`banners/${crypto.randomUUID()}.${extension[detected]}`, Buffer.from(bytes), {
        access: 'private',
        contentType: detected,
      })
      imagePathname = blob.pathname
      imageMediaType = detected
    }
    const [created] = await db.transaction(async (tx) => {
      const records = await tx
        .insert(banners)
        .values({ title, description, buttonText, buttonUrl, imagePathname, imageMediaType })
        .returning()
      if (records[0])
        await writeAudit(tx, actor.id, 'banner.create', 'banner', String(records[0].id), null, {
          title: records[0].title,
          imageMediaType,
        })
      return records
    })
    refresh('/admin', '/')
    return { ok: true, banner: created }
  } catch (error) {
    if (imagePathname) await del(imagePathname).catch(() => undefined)
    throw error
  }
}
