import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const userRole = pgEnum('user_role', [
  'user',
  'content_editor',
  'user_manager',
  'competition_manager',
  'reward_manager',
  'report_viewer',
  'admin',
])
export const language = pgEnum('language', ['en', 'ar'])
export const categoryScope = pgEnum('category_scope', ['platform', 'user'])
export const attemptStatus = pgEnum('attempt_status', [
  'active',
  'grading',
  'completed',
  'expired',
  'cancelled',
])
export const participantStatus = pgEnum('participant_status', [
  'joined',
  'active',
  'grading',
  'submitted',
  'expired',
  'disqualified',
])
export const challengeStatus = pgEnum('challenge_participant_status', [
  'joined',
  'active',
  'completed',
  'expired',
  'disqualified',
])
export const challengeMetric = pgEnum('challenge_metric', ['words', 'sentences', 'reviews', 'streak'])
export const competitionScope = pgEnum('competition_scope', ['all', 'en', 'ar', 'math'])
export const competitionLifecycle = pgEnum('competition_lifecycle', [
  'draft',
  'scheduled',
  'active',
  'ended',
  'cancelled',
])
export const questionSource = pgEnum('question_source', ['en', 'ar', 'math'])
export const publicationStatus = pgEnum('publication_status', ['draft', 'scheduled', 'published', 'archived'])
export const sectionAccess = pgEnum('section_access', ['free', 'restricted'])
export const contentKind = pgEnum('content_kind', [
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
])
export const progressStatus = pgEnum('progress_status', ['not_started', 'in_progress', 'completed', 'failed'])
export const managedAccountStatus = pgEnum('managed_account_status', [
  'active',
  'disabled',
  'suspended',
  'banned',
])
export const challengeLifecycle = pgEnum('challenge_lifecycle', [
  'draft',
  'scheduled',
  'open',
  'active',
  'paused',
  'ended',
  'cancelled',
])
export const badgeRarity = pgEnum('badge_rarity', ['common', 'uncommon', 'rare', 'epic', 'legendary'])
export const grantMode = pgEnum('grant_mode', ['automatic', 'manual', 'both'])
export const promotionCondition = pgEnum('promotion_condition', [
  'points',
  'section_completion',
  'lessons_completed',
  'challenge_wins',
  'activity_streak',
  'achievements',
])

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('emailVerified').notNull().default(false),
    recoveryEmail: text('recoveryEmail'),
    recoveryEmailVerified: boolean('recoveryEmailVerified').notNull().default(false),
    image: text('image'),
    role: userRole('role').notNull().default('user'),
    banned: boolean('banned').notNull().default(false),
    banReason: text('banReason'),
    banExpires: utcTimestamp('banExpires'),
    deletedAt: utcTimestamp('deletedAt'),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('user_email_normalized_unique').on(sql`lower(trim(${table.email}))`),
    uniqueIndex('user_recovery_email_normalized_unique')
      .on(sql`lower(trim(${table.recoveryEmail}))`)
      .where(sql`${table.recoveryEmail} is not null`),
    index('user_role_idx').on(table.role),
    index('user_created_at_idx').on(table.createdAt),
  ],
)

export const adminAllowlist = pgTable(
  'adminAllowlist',
  {
    email: text('email').primaryKey(),
    role: text('role').notNull().default('SUPER_ADMIN'),
    isActive: boolean('isActive').notNull().default(true),
    createdBy: text('createdBy').references(() => user.id, { onDelete: 'set null' }),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('admin_allowlist_email_normalized_unique').on(sql`lower(trim(${table.email}))`),
    check('admin_allowlist_role_check', sql`${table.role} = 'SUPER_ADMIN'`),
  ],
)

export const levels = pgTable(
  'levels',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    rank: integer('rank').notNull(),
    minimumPoints: integer('minimumPoints').notNull().default(0),
    color: text('color'),
    isActive: boolean('isActive').notNull().default(true),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('levels_name_unique').on(sql`lower(trim(${table.name}))`),
    uniqueIndex('levels_rank_unique').on(table.rank),
    check('levels_rank_points_check', sql`${table.rank} > 0 and ${table.minimumPoints} >= 0`),
  ],
)

export const userAdminProfiles = pgTable(
  'userAdminProfiles',
  {
    userId: text('userId')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: managedAccountStatus('status').notNull().default('active'),
    levelId: integer('levelId').references(() => levels.id, { onDelete: 'set null' }),
    suspendedUntil: utcTimestamp('suspendedUntil'),
    lastLoginAt: utcTimestamp('lastLoginAt'),
    violationCount: integer('violationCount').notNull().default(0),
    updatedBy: text('updatedBy').references(() => user.id, { onDelete: 'set null' }),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    index('user_admin_profiles_status_level_idx').on(table.status, table.levelId),
    index('user_admin_profiles_last_login_idx').on(table.lastLoginAt),
    check('user_admin_profiles_violations_check', sql`${table.violationCount} >= 0`),
  ],
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: utcTimestamp('expiresAt').notNull(),
    token: text('token').notNull().unique(),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonatedBy').references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('session_user_id_idx').on(table.userId),
    index('session_expires_at_idx').on(table.expiresAt),
  ],
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: utcTimestamp('accessTokenExpiresAt'),
    refreshTokenExpiresAt: utcTimestamp('refreshTokenExpiresAt'),
    scope: text('scope'),
    password: text('password'),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('account_provider_account_unique').on(table.providerId, table.accountId),
    index('account_user_id_idx').on(table.userId),
  ],
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: utcTimestamp('expiresAt').notNull(),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    index('verification_identifier_idx').on(table.identifier),
    index('verification_expires_at_idx').on(table.expiresAt),
  ],
)

export const rateLimit = pgTable('rateLimit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('lastRequest', { mode: 'number' }).notNull(),
})

export const recoveryTokens = pgTable(
  'recoveryTokens',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    tokenHash: text('tokenHash').notNull().unique(),
    targetEmail: text('targetEmail').notNull(),
    expiresAt: utcTimestamp('expiresAt').notNull(),
    usedAt: utcTimestamp('usedAt'),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
  },
  (table) => [
    index('recovery_tokens_user_purpose_idx').on(table.userId, table.purpose),
    index('recovery_tokens_expires_at_idx').on(table.expiresAt),
  ],
)

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pathname: text('pathname').notNull().unique(),
    originalName: text('originalName').notNull(),
    title: text('title'),
    description: text('description'),
    mediaType: text('mediaType').notNull(),
    sizeBytes: integer('sizeBytes').notNull(),
    altText: text('altText'),
    storageProvider: text('storageProvider').notNull().default('vercel-blob'),
    uploadedBy: text('uploadedBy').references(() => user.id, { onDelete: 'set null' }),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    deletedAt: utcTimestamp('deletedAt'),
  },
  (table) => [
    index('media_created_at_idx').on(table.createdAt),
    index('media_type_deleted_idx').on(table.mediaType, table.deletedAt),
    check('media_size_check', sql`${table.sizeBytes} > 0 and ${table.sizeBytes} <= 10485760`),
  ],
)

export const educationalSections = pgTable(
  'educationalSections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    nameEn: text('nameEn'),
    slug: text('slug').notNull().unique(),
    sectionType: text('sectionType').notNull().default('subject'),
    previousSectionId: uuid('previousSectionId').references(
      (): AnyPgColumn => educationalSections.id,
      { onDelete: 'set null', onUpdate: 'cascade' },
    ),
    shortDescription: text('shortDescription'),
    fullDescription: text('fullDescription'),
    iconMediaId: uuid('iconMediaId').references(() => media.id, { onDelete: 'set null' }),
    imageMediaId: uuid('imageMediaId').references(() => media.id, { onDelete: 'set null' }),
    color: text('color'),
    ageRange: text('ageRange'),
    targetLevel: text('targetLevel'),
    unlockRules: jsonb('unlockRules').$type<Record<string, unknown>>(),
    access: sectionAccess('access').notNull().default('free'),
    isPaid: boolean('isPaid').notNull().default(false),
    priceMinor: integer('priceMinor'),
    currency: text('currency').notNull().default('USD'),
    status: publicationStatus('status').notNull().default('draft'),
    isActive: boolean('isActive').notNull().default(true),
    sortOrder: integer('sortOrder').notNull().default(0),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
    deletedAt: utcTimestamp('deletedAt'),
  },
  (table) => [
    index('educational_sections_status_order_idx').on(table.status, table.isActive, table.sortOrder),
    index('educational_sections_previous_idx').on(table.previousSectionId),
    uniqueIndex('educational_sections_name_active_unique')
      .on(sql`lower(trim(${table.name}))`)
      .where(sql`${table.deletedAt} is null`),
    check('educational_sections_order_check', sql`${table.sortOrder} >= 0`),
    check(
      'educational_sections_type_check',
      sql`${table.sectionType} in ('subject', 'language', 'reading', 'math', 'skills', 'custom')`,
    ),
    check(
      'educational_sections_price_check',
      sql`(${table.isPaid} = false and (${table.priceMinor} is null or ${table.priceMinor} = 0)) or (${table.isPaid} = true and ${table.priceMinor} is not null and ${table.priceMinor} > 0)`,
    ),
    check('educational_sections_currency_check', sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
)

export const sectionContents = pgTable(
  'sectionContents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sectionId: uuid('sectionId')
      .notNull()
      .references(() => educationalSections.id, { onDelete: 'restrict' }),
    parentId: uuid('parentId').references((): AnyPgColumn => sectionContents.id, { onDelete: 'restrict' }),
    kind: contentKind('kind').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    summary: text('summary'),
    body: jsonb('body').$type<Record<string, unknown>>(),
    mediaId: uuid('mediaId').references(() => media.id, { onDelete: 'set null' }),
    targetLevel: text('targetLevel'),
    points: integer('points').notNull().default(0),
    passingScore: integer('passingScore'),
    status: publicationStatus('status').notNull().default('draft'),
    sortOrder: integer('sortOrder').notNull().default(0),
    publishedAt: utcTimestamp('publishedAt'),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
    deletedAt: utcTimestamp('deletedAt'),
  },
  (table) => [
    uniqueIndex('section_contents_section_slug_unique')
      .on(table.sectionId, table.slug)
      .where(sql`${table.deletedAt} is null`),
    index('section_contents_section_status_order_idx').on(table.sectionId, table.status, table.sortOrder),
    index('section_contents_parent_idx').on(table.parentId),
    check(
      'section_contents_score_points_check',
      sql`${table.points} >= 0 and (${table.passingScore} is null or ${table.passingScore} between 0 and 100)`,
    ),
  ],
)

export const contentPrerequisites = pgTable(
  'contentPrerequisites',
  {
    contentId: uuid('contentId')
      .notNull()
      .references(() => sectionContents.id, { onDelete: 'cascade' }),
    prerequisiteId: uuid('prerequisiteId')
      .notNull()
      .references(() => sectionContents.id, { onDelete: 'restrict' }),
  },
  (table) => [
    unique().on(table.contentId, table.prerequisiteId),
    index('content_prerequisites_prerequisite_idx').on(table.prerequisiteId),
    check('content_prerequisites_not_self_check', sql`${table.contentId} <> ${table.prerequisiteId}`),
  ],
)

export const userContentProgress = pgTable(
  'userContentProgress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    contentId: uuid('contentId')
      .notNull()
      .references(() => sectionContents.id, { onDelete: 'restrict' }),
    status: progressStatus('status').notNull().default('not_started'),
    progress: integer('progress').notNull().default(0),
    score: integer('score'),
    attempts: integer('attempts').notNull().default(0),
    lastActivityAt: utcTimestamp('lastActivityAt').notNull().defaultNow(),
    completedAt: utcTimestamp('completedAt'),
  },
  (table) => [
    unique().on(table.userId, table.contentId),
    index('user_content_progress_content_status_idx').on(table.contentId, table.status),
    index('user_content_progress_user_activity_idx').on(table.userId, table.lastActivityAt),
    check(
      'user_content_progress_values_check',
      sql`${table.progress} between 0 and 100 and (${table.score} is null or ${table.score} between 0 and 100) and ${table.attempts} >= 0`,
    ),
  ],
)

export const categories = pgTable(
  'categories',
  {
    id: serial('id').primaryKey(),
    userId: text('userId').references(() => user.id, { onDelete: 'cascade' }),
    scope: categoryScope('scope').notNull().default('user'),
    name: text('name').notNull(),
    normalizedName: text('normalizedName').notNull(),
    slug: text('slug').notNull(),
    language: language('language').notNull().default('en'),
    description: text('description'),
    color: text('color'),
    sortOrder: integer('sortOrder').notNull().default(0),
    isActive: boolean('isActive').notNull().default(true),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('platform_category_language_slug_unique')
      .on(table.language, table.slug)
      .where(sql`${table.scope} = 'platform' and ${table.userId} is null`),
    uniqueIndex('user_category_language_name_unique')
      .on(table.userId, table.language, table.normalizedName)
      .where(sql`${table.scope} = 'user' and ${table.userId} is not null`),
    index('categories_scope_language_active_idx').on(
      table.scope,
      table.language,
      table.isActive,
      table.sortOrder,
    ),
  ],
)

export const words = pgTable(
  'words',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    language: language('language').notNull().default('en'),
    categoryId: integer('categoryId').references(() => categories.id, { onDelete: 'set null' }),
    word: text('word').notNull(),
    normalizedWord: text('normalizedWord').notNull(),
    meaning: text('meaning').notNull(),
    englishMeaning: text('englishMeaning'),
    arabicExplanation: text('arabicExplanation'),
    englishExplanation: text('englishExplanation'),
    synonyms: text('synonyms').array().notNull().default([]),
    antonyms: text('antonyms').array().notNull().default([]),
    arabicExample: text('arabicExample'),
    englishExample: text('englishExample'),
    category: text('category').notNull().default('عام'),
    topic: text('topic'),
    level: text('level').notNull().default('A1'),
    difficulty: text('difficulty').notNull().default('easy'),
    status: text('status').notNull().default('new'),
    isFavorite: boolean('isFavorite').notNull().default(false),
    mistakeCount: integer('mistakeCount').notNull().default(0),
    correctCount: integer('correctCount').notNull().default(0),
    correctStreak: integer('correctStreak').notNull().default(0),
    reviewCount: integer('reviewCount').notNull().default(0),
    intervalDays: integer('intervalDays').notNull().default(0),
    easeFactor: integer('easeFactor').notNull().default(250),
    nextReviewAt: utcTimestamp('nextReviewAt'),
    lastMistakeAt: utcTimestamp('lastMistakeAt'),
    lastReviewedAt: utcTimestamp('lastReviewedAt'),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
    deletedAt: utcTimestamp('deletedAt'),
  },
  (table) => [
    uniqueIndex('words_user_language_normalized_unique')
      .on(table.userId, table.language, table.normalizedWord)
      .where(sql`${table.deletedAt} is null`),
    index('words_user_language_category_idx').on(table.userId, table.language, table.categoryId),
    index('words_user_status_review_idx').on(table.userId, table.status, table.nextReviewAt),
    index('words_user_deleted_idx').on(table.userId, table.deletedAt),
    check(
      'words_non_negative_counts_check',
      sql`${table.mistakeCount} >= 0 and ${table.correctCount} >= 0 and ${table.correctStreak} >= 0 and ${table.reviewCount} >= 0`,
    ),
  ],
)

export const sentences = pgTable(
  'sentences',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sentence: text('sentence').notNull(),
    normalizedSentence: text('normalizedSentence').notNull(),
    translation: text('translation').notNull(),
    category: text('category').notNull().default('يومية'),
    isFavorite: boolean('isFavorite').notNull().default(false),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sentences_user_normalized_unique').on(table.userId, table.normalizedSentence),
    index('sentences_user_created_at_idx').on(table.userId, table.createdAt),
  ],
)

export const wordQuizAttempts = pgTable(
  'wordQuizAttempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    requestKey: text('requestKey').notNull(),
    mode: text('mode').notNull(),
    source: text('source').notNull(),
    language: language('language').notNull(),
    questionCount: integer('questionCount').notNull(),
    correctAnswers: integer('correctAnswers').notNull().default(0),
    wrongAnswers: integer('wrongAnswers').notNull().default(0),
    score: integer('score').notNull().default(0),
    status: attemptStatus('status').notNull().default('active'),
    startedAt: utcTimestamp('startedAt').notNull().defaultNow(),
    completedAt: utcTimestamp('completedAt'),
  },
  (table) => [
    uniqueIndex('word_quiz_attempt_user_request_unique').on(table.userId, table.requestKey),
    index('word_quiz_attempt_user_started_idx').on(table.userId, table.startedAt),
    check('word_quiz_question_count_check', sql`${table.questionCount} between 1 and 50`),
    check('word_quiz_score_check', sql`${table.score} between 0 and 100`),
  ],
)

export const wordQuizQuestions = pgTable(
  'wordQuizQuestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attemptId: uuid('attemptId')
      .notNull()
      .references(() => wordQuizAttempts.id, { onDelete: 'cascade' }),
    wordId: integer('wordId').references(() => words.id, { onDelete: 'set null' }),
    ordinal: integer('ordinal').notNull(),
    prompt: text('prompt').notNull(),
    correctAnswer: text('correctAnswer').notNull(),
    options: jsonb('options').$type<string[]>(),
    example: text('example'),
    userAnswer: text('userAnswer'),
    isCorrect: boolean('isCorrect'),
    answeredAt: utcTimestamp('answeredAt'),
  },
  (table) => [
    uniqueIndex('word_quiz_question_attempt_ordinal_unique').on(table.attemptId, table.ordinal),
    uniqueIndex('word_quiz_question_attempt_word_unique').on(table.attemptId, table.wordId),
    index('word_quiz_question_attempt_idx').on(table.attemptId),
  ],
)

export const tests = pgTable(
  'tests',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    attemptId: uuid('attemptId').references(() => wordQuizAttempts.id, { onDelete: 'set null' }),
    source: text('source').notNull(),
    questionMode: text('questionMode').notNull(),
    questionCount: integer('questionCount').notNull(),
    correctAnswers: integer('correctAnswers').notNull().default(0),
    wrongAnswers: integer('wrongAnswers').notNull().default(0),
    score: integer('score').notNull().default(0),
    completedAt: utcTimestamp('completedAt').notNull().defaultNow(),
  },
  (table) => [
    index('tests_user_completed_at_idx').on(table.userId, table.completedAt),
    uniqueIndex('tests_attempt_unique').on(table.attemptId),
  ],
)

export const testAnswers = pgTable(
  'testAnswers',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    testId: integer('testId')
      .notNull()
      .references(() => tests.id, { onDelete: 'cascade' }),
    wordId: integer('wordId').references(() => words.id, { onDelete: 'set null' }),
    question: text('question').notNull(),
    correctAnswer: text('correctAnswer').notNull(),
    userAnswer: text('userAnswer'),
    isCorrect: boolean('isCorrect').notNull(),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
  },
  (table) => [
    index('test_answers_test_id_idx').on(table.testId),
    index('test_answers_user_id_idx').on(table.userId),
  ],
)

export const examples = pgTable(
  'examples',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    wordId: integer('wordId')
      .notNull()
      .references(() => words.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    translation: text('translation'),
    language: language('language').notNull(),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
  },
  (table) => [index('examples_word_id_idx').on(table.wordId), index('examples_user_id_idx').on(table.userId)],
)

export const userProgress = pgTable(
  'userProgress',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: 'cascade' }),
    xp: integer('xp').notNull().default(0),
    coins: integer('coins').notNull().default(0),
    streak: integer('streak').notNull().default(0),
    longestStreak: integer('longestStreak').notNull().default(0),
    dailyGoal: integer('dailyGoal').notNull().default(10),
    weeklyGoal: integer('weeklyGoal').notNull().default(70),
    monthlyGoal: integer('monthlyGoal').notNull().default(300),
    title: text('title').notNull().default('Beginner'),
    lastActiveAt: utcTimestamp('lastActiveAt'),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    check('user_progress_balances_non_negative_check', sql`${table.xp} >= 0 and ${table.coins} >= 0`),
    check(
      'user_progress_goals_positive_check',
      sql`${table.dailyGoal} > 0 and ${table.weeklyGoal} > 0 and ${table.monthlyGoal} > 0`,
    ),
  ],
)

export const rewardLedger = pgTable(
  'rewardLedger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sourceType: text('sourceType').notNull(),
    sourceId: text('sourceId').notNull(),
    xp: integer('xp').notNull().default(0),
    coins: integer('coins').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('reward_ledger_user_source_unique').on(table.userId, table.sourceType, table.sourceId),
    index('reward_ledger_user_created_idx').on(table.userId, table.createdAt),
    check('reward_ledger_non_negative_check', sql`${table.xp} >= 0 and ${table.coins} >= 0`),
  ],
)

export const achievements = pgTable(
  'achievements',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    icon: text('icon'),
    xpReward: integer('xpReward').notNull().default(0),
    coinReward: integer('coinReward').notNull().default(0),
    requirementType: text('requirementType').notNull(),
    requirementValue: integer('requirementValue').notNull(),
    isActive: boolean('isActive').notNull().default(true),
    sortOrder: integer('sortOrder').notNull().default(0),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('achievements_name_unique').on(table.name)],
)

export const userAchievements = pgTable(
  'userAchievements',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    achievementId: integer('achievementId')
      .notNull()
      .references(() => achievements.id, { onDelete: 'cascade' }),
    earnedAt: utcTimestamp('earnedAt').notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.userId, table.achievementId),
    index('user_achievements_user_idx').on(table.userId),
  ],
)

export const badges = pgTable(
  'badges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description').notNull(),
    imageMediaId: uuid('imageMediaId').references(() => media.id, { onDelete: 'set null' }),
    rarity: badgeRarity('rarity').notNull().default('common'),
    color: text('color'),
    sectionId: uuid('sectionId').references(() => educationalSections.id, { onDelete: 'set null' }),
    criteria: jsonb('criteria').$type<Record<string, unknown>>(),
    mode: grantMode('mode').notNull().default('manual'),
    isPublished: boolean('isPublished').notNull().default(false),
    isRepeatable: boolean('isRepeatable').notNull().default(false),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
    deletedAt: utcTimestamp('deletedAt'),
  },
  (table) => [index('badges_section_published_idx').on(table.sectionId, table.isPublished)],
)

export const userBadges = pgTable(
  'userBadges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    badgeId: uuid('badgeId')
      .notNull()
      .references(() => badges.id, { onDelete: 'restrict' }),
    repeatKey: text('repeatKey').notNull().default('singleton'),
    reason: text('reason'),
    sourceType: text('sourceType'),
    sourceId: text('sourceId'),
    grantedBy: text('grantedBy').references(() => user.id, { onDelete: 'set null' }),
    grantedAt: utcTimestamp('grantedAt').notNull().defaultNow(),
    revokedAt: utcTimestamp('revokedAt'),
    revokedBy: text('revokedBy').references(() => user.id, { onDelete: 'set null' }),
    revokeReason: text('revokeReason'),
  },
  (table) => [
    uniqueIndex('user_badges_user_badge_repeat_unique').on(table.userId, table.badgeId, table.repeatKey),
    index('user_badges_badge_active_idx').on(table.badgeId, table.revokedAt),
    index('user_badges_user_granted_idx').on(table.userId, table.grantedAt),
  ],
)

export const promotionRules = pgTable(
  'promotionRules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    conditionType: promotionCondition('conditionType').notNull(),
    conditionValue: jsonb('conditionValue').$type<Record<string, unknown>>().notNull(),
    sectionId: uuid('sectionId').references(() => educationalSections.id, { onDelete: 'set null' }),
    actionType: text('actionType').notNull().default('promote_level'),
    targetLevelId: integer('targetLevelId').references(() => levels.id, { onDelete: 'restrict' }),
    startsAt: utcTimestamp('startsAt'),
    endsAt: utcTimestamp('endsAt'),
    applicationMode: text('applicationMode').notNull().default('new_only'),
    isActive: boolean('isActive').notNull().default(true),
    priority: integer('priority').notNull().default(100),
    retrospective: boolean('retrospective').notNull().default(false),
    archivedAt: utcTimestamp('archivedAt'),
    createdBy: text('createdBy').references(() => user.id, { onDelete: 'set null' }),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    index('promotion_rules_active_priority_idx').on(table.isActive, table.priority),
    check('promotion_rules_priority_check', sql`${table.priority} between 1 and 10000`),
    check(
      'promotion_rules_dates_check',
      sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
    check('promotion_rules_mode_check', sql`${table.applicationMode} in ('new_only', 'all_matching')`),
  ],
)

export const promotionRuleExecutions = pgTable(
  'promotionRuleExecutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleId: uuid('ruleId')
      .notNull()
      .references(() => promotionRules.id, { onDelete: 'restrict' }),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sourceKey: text('sourceKey').notNull().default('once'),
    beforeLevelId: integer('beforeLevelId').references(() => levels.id, { onDelete: 'set null' }),
    afterLevelId: integer('afterLevelId').references(() => levels.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('completed'),
    attemptCount: integer('attemptCount').notNull().default(1),
    errorMessage: text('errorMessage'),
    completedAt: utcTimestamp('completedAt'),
    executedAt: utcTimestamp('executedAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('promotion_rule_executions_once_unique').on(table.ruleId, table.userId, table.sourceKey),
    index('promotion_rule_executions_user_idx').on(table.userId, table.executedAt),
    index('promotion_rule_executions_status_idx').on(table.status, table.executedAt),
    check(
      'promotion_rule_executions_status_check',
      sql`${table.status} in ('running', 'completed', 'failed')`,
    ),
    check('promotion_rule_executions_attempts_check', sql`${table.attemptCount} > 0`),
  ],
)

export const challenges = pgTable(
  'challenges',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    normalizedTitle: text('normalizedTitle').notNull(),
    description: text('description').notNull(),
    metric: challengeMetric('metric').notNull(),
    target: integer('target').notNull(),
    xpReward: integer('xpReward').notNull().default(0),
    coinReward: integer('coinReward').notNull().default(0),
    badgeName: text('badgeName'),
    startsAt: utcTimestamp('startsAt'),
    endsAt: utcTimestamp('endsAt'),
    isActive: boolean('isActive').notNull().default(true),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('challenges_normalized_title_unique').on(table.normalizedTitle),
    index('challenges_active_dates_idx').on(table.isActive, table.startsAt, table.endsAt),
    check(
      'challenges_rewards_target_check',
      sql`${table.target} > 0 and ${table.xpReward} >= 0 and ${table.coinReward} >= 0`,
    ),
    check(
      'challenges_dates_check',
      sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
)

export const challengeParticipants = pgTable(
  'challengeParticipants',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    challengeId: integer('challengeId')
      .notNull()
      .references(() => challenges.id, { onDelete: 'cascade' }),
    progress: integer('progress').notNull().default(0),
    status: challengeStatus('status').notNull().default('joined'),
    joinedAt: utcTimestamp('joinedAt').notNull().defaultNow(),
    completedAt: utcTimestamp('completedAt'),
    rewardedAt: utcTimestamp('rewardedAt'),
  },
  (table) => [
    unique().on(table.userId, table.challengeId),
    index('challenge_participants_challenge_status_idx').on(table.challengeId, table.status),
    check('challenge_participants_progress_check', sql`${table.progress} >= 0`),
  ],
)

export const challengeSettings = pgTable(
  'challengeSettings',
  {
    challengeId: integer('challengeId')
      .primaryKey()
      .references(() => challenges.id, { onDelete: 'cascade' }),
    sectionId: uuid('sectionId').references(() => educationalSections.id, { onDelete: 'set null' }),
    imageMediaId: uuid('imageMediaId').references(() => media.id, { onDelete: 'set null' }),
    lifecycle: challengeLifecycle('lifecycle').notNull().default('draft'),
    competitionType: text('competitionType').notNull().default('progress'),
    participationRules: jsonb('participationRules').$type<Record<string, unknown>>(),
    minimumParticipants: integer('minimumParticipants').notNull().default(1),
    maximumParticipants: integer('maximumParticipants'),
    scoringRules: jsonb('scoringRules').$type<Record<string, unknown>>(),
    winningRules: jsonb('winningRules').$type<Record<string, unknown>>(),
    prizeBadgeId: uuid('prizeBadgeId').references(() => badges.id, { onDelete: 'set null' }),
    winnerCount: integer('winnerCount').notNull().default(1),
    updatedBy: text('updatedBy').references(() => user.id, { onDelete: 'set null' }),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    index('challenge_settings_lifecycle_section_idx').on(table.lifecycle, table.sectionId),
    check(
      'challenge_settings_competition_type_check',
      sql`${table.competitionType} in ('progress', 'speed', 'accuracy', 'streak')`,
    ),
    check(
      'challenge_settings_participants_winners_check',
      sql`${table.minimumParticipants} > 0 and (${table.maximumParticipants} is null or ${table.maximumParticipants} >= ${table.minimumParticipants}) and ${table.winnerCount} > 0`,
    ),
  ],
)

export const challengeResults = pgTable(
  'challengeResults',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    challengeId: integer('challengeId')
      .notNull()
      .references(() => challenges.id, { onDelete: 'cascade' }),
    participantId: integer('participantId')
      .notNull()
      .references(() => challengeParticipants.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    rank: integer('rank'),
    isWinner: boolean('isWinner').notNull().default(false),
    approvedBy: text('approvedBy').references(() => user.id, { onDelete: 'set null' }),
    approvedAt: utcTimestamp('approvedAt'),
    rewardGrantedAt: utcTimestamp('rewardGrantedAt'),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('challenge_results_participant_unique').on(table.participantId),
    uniqueIndex('challenge_results_rank_unique')
      .on(table.challengeId, table.rank)
      .where(sql`${table.rank} is not null`),
    index('challenge_results_leaderboard_idx').on(table.challengeId, table.score),
    check(
      'challenge_results_score_rank_check',
      sql`${table.score} >= 0 and (${table.rank} is null or ${table.rank} > 0)`,
    ),
  ],
)

export const challengeModeration = pgTable(
  'challengeModeration',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    participantId: integer('participantId')
      .notNull()
      .references(() => challengeParticipants.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    actorUserId: text('actorUserId').references(() => user.id, { onDelete: 'set null' }),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
  },
  (table) => [index('challenge_moderation_participant_idx').on(table.participantId, table.createdAt)],
)

export const certificates = pgTable(
  'certificates',
  {
    id: serial('id').primaryKey(),
    publicId: uuid('publicId').notNull().defaultRandom().unique(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    challengeId: integer('challengeId').references(() => challenges.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    certificateNumber: text('certificateNumber').notNull().unique(),
    blobPathname: text('blobPathname'),
    issuedAt: utcTimestamp('issuedAt').notNull().defaultNow(),
    revokedAt: utcTimestamp('revokedAt'),
    revokeReason: text('revokeReason'),
  },
  (table) => [
    uniqueIndex('certificates_user_challenge_unique').on(table.userId, table.challengeId),
    index('certificates_public_id_idx').on(table.publicId),
  ],
)

export const banners = pgTable(
  'banners',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    buttonText: text('buttonText'),
    buttonUrl: text('buttonUrl'),
    imagePathname: text('imagePathname'),
    imageMediaType: text('imageMediaType'),
    isActive: boolean('isActive').notNull().default(true),
    sortOrder: integer('sortOrder').notNull().default(0),
    startsAt: utcTimestamp('startsAt'),
    endsAt: utcTimestamp('endsAt'),
    clickCount: integer('clickCount').notNull().default(0),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    index('banners_active_order_idx').on(table.isActive, table.sortOrder),
    check(
      'banners_dates_check',
      sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
    check('banners_click_count_check', sql`${table.clickCount} >= 0`),
  ],
)

export const encouragementMessages = pgTable(
  'encouragementMessages',
  {
    id: serial('id').primaryKey(),
    message: text('message').notNull(),
    minProgress: integer('minProgress').notNull().default(0),
    maxProgress: integer('maxProgress').notNull().default(100),
    isActive: boolean('isActive').notNull().default(true),
    sortOrder: integer('sortOrder').notNull().default(0),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('encouragement_messages_message_unique').on(table.message),
    check(
      'encouragement_progress_range_check',
      sql`${table.minProgress} between 0 and 100 and ${table.maxProgress} between ${table.minProgress} and 100`,
    ),
  ],
)

export const mathSections = pgTable(
  'mathSections',
  {
    id: serial('id').primaryKey(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    normalizedName: text('normalizedName').notNull().unique(),
    description: text('description'),
    isActive: boolean('isActive').notNull().default(true),
    sortOrder: integer('sortOrder').notNull().default(0),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [index('math_sections_active_order_idx').on(table.isActive, table.sortOrder)],
)

export const mathQuestions = pgTable(
  'mathQuestions',
  {
    id: serial('id').primaryKey(),
    sectionId: integer('sectionId')
      .notNull()
      .references(() => mathSections.id, { onDelete: 'restrict' }),
    question: text('question').notNull(),
    normalizedQuestion: text('normalizedQuestion').notNull(),
    option1: text('option1').notNull(),
    option2: text('option2').notNull(),
    option3: text('option3').notNull(),
    option4: text('option4').notNull(),
    correctOption: integer('correctOption').notNull(),
    explanation: text('explanation'),
    isActive: boolean('isActive').notNull().default(true),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('math_questions_section_question_unique').on(table.sectionId, table.normalizedQuestion),
    index('math_questions_section_active_idx').on(table.sectionId, table.isActive),
    check('math_questions_correct_option_check', sql`${table.correctOption} between 1 and 4`),
    check(
      'math_questions_distinct_options_check',
      sql`${table.option1} <> ${table.option2} and ${table.option1} <> ${table.option3} and ${table.option1} <> ${table.option4} and ${table.option2} <> ${table.option3} and ${table.option2} <> ${table.option4} and ${table.option3} <> ${table.option4}`,
    ),
  ],
)

export const mathAttempts = pgTable(
  'mathAttempts',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sectionId: integer('sectionId')
      .notNull()
      .references(() => mathSections.id, { onDelete: 'restrict' }),
    requestKey: text('requestKey').notNull(),
    status: attemptStatus('status').notNull().default('active'),
    questionCount: integer('questionCount').notNull(),
    correctAnswers: integer('correctAnswers').notNull().default(0),
    score: integer('score').notNull().default(0),
    answers: jsonb('answers').$type<Array<{ questionId: number; answer: number; isCorrect: boolean }>>(),
    startedAt: utcTimestamp('startedAt').notNull().defaultNow(),
    completedAt: utcTimestamp('completedAt'),
  },
  (table) => [
    uniqueIndex('math_attempts_user_request_unique').on(table.userId, table.requestKey),
    index('math_attempts_user_started_idx').on(table.userId, table.startedAt),
    check('math_attempts_question_count_check', sql`${table.questionCount} between 1 and 30`),
    check('math_attempts_score_check', sql`${table.score} between 0 and 100`),
  ],
)

export const mathAttemptQuestions = pgTable(
  'mathAttemptQuestions',
  {
    id: serial('id').primaryKey(),
    attemptId: integer('attemptId')
      .notNull()
      .references(() => mathAttempts.id, { onDelete: 'cascade' }),
    questionId: integer('questionId')
      .notNull()
      .references(() => mathQuestions.id, { onDelete: 'restrict' }),
    ordinal: integer('ordinal').notNull(),
  },
  (table) => [
    uniqueIndex('math_attempt_question_unique').on(table.attemptId, table.questionId),
    uniqueIndex('math_attempt_ordinal_unique').on(table.attemptId, table.ordinal),
  ],
)

export const competitions = pgTable(
  'competitions',
  {
    id: serial('id').primaryKey(),
    title: text('title').notNull(),
    normalizedTitle: text('normalizedTitle').notNull().unique(),
    description: text('description').notNull(),
    scope: competitionScope('scope').notNull().default('math'),
    sectionId: integer('sectionId').references(() => mathSections.id, { onDelete: 'restrict' }),
    lifecycle: competitionLifecycle('lifecycle').notNull().default('draft'),
    rules: text('rules'),
    audience: text('audience').notNull().default('all'),
    priority: integer('priority').notNull().default(100),
    requiresVerifiedEmail: boolean('requiresVerifiedEmail').notNull().default(false),
    questionCount: integer('questionCount').notNull().default(10),
    xpReward: integer('xpReward').notNull().default(100),
    coinReward: integer('coinReward').notNull().default(0),
    startsAt: utcTimestamp('startsAt'),
    endsAt: utcTimestamp('endsAt'),
    isActive: boolean('isActive').notNull().default(false),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    index('competitions_active_dates_idx').on(table.lifecycle, table.isActive, table.startsAt, table.endsAt),
    index('competitions_priority_idx').on(table.priority, table.createdAt),
    check(
      'competitions_question_reward_check',
      sql`${table.questionCount} between 1 and 30 and ${table.xpReward} >= 0 and ${table.coinReward} >= 0`,
    ),
    check('competitions_priority_check', sql`${table.priority} > 0`),
    check(
      'competitions_audience_check',
      sql`${table.audience} in ('all','verified','new_users','existing_users')`,
    ),
    check(
      'competitions_dates_check',
      sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
)

export const competitionCategories = pgTable(
  'competitionCategories',
  {
    competitionId: integer('competitionId')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    categoryId: integer('categoryId')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
  },
  (table) => [
    unique().on(table.competitionId, table.categoryId),
    index('competition_categories_category_idx').on(table.categoryId),
  ],
)

export const competitionMathSections = pgTable(
  'competitionMathSections',
  {
    competitionId: integer('competitionId')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    sectionId: integer('sectionId')
      .notNull()
      .references(() => mathSections.id, { onDelete: 'restrict' }),
  },
  (table) => [
    unique().on(table.competitionId, table.sectionId),
    index('competition_math_sections_section_idx').on(table.sectionId),
  ],
)

export const competitionParticipants = pgTable(
  'competitionParticipants',
  {
    id: serial('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    competitionId: integer('competitionId')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    status: participantStatus('status').notNull().default('joined'),
    score: integer('score').notNull().default(0),
    correctAnswers: integer('correctAnswers').notNull().default(0),
    answers: jsonb('answers').$type<Array<{ questionId: string; answer: string; isCorrect: boolean }>>(),
    xpAwarded: boolean('xpAwarded').notNull().default(false),
    joinedAt: utcTimestamp('joinedAt').notNull().defaultNow(),
    startedAt: utcTimestamp('startedAt'),
    submittedAt: utcTimestamp('submittedAt'),
    rewardedAt: utcTimestamp('rewardedAt'),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.userId, table.competitionId),
    index('competition_participants_competition_score_idx').on(
      table.competitionId,
      table.score,
      table.correctAnswers,
    ),
    check(
      'competition_participants_score_check',
      sql`${table.score} between 0 and 100 and ${table.correctAnswers} >= 0`,
    ),
  ],
)

export const competitionQuestions = pgTable(
  'competitionQuestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    participantId: integer('participantId')
      .notNull()
      .references(() => competitionParticipants.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    source: questionSource('source').notNull(),
    wordId: integer('wordId').references(() => words.id, { onDelete: 'restrict' }),
    mathQuestionId: integer('mathQuestionId').references(() => mathQuestions.id, { onDelete: 'restrict' }),
    prompt: text('prompt').notNull(),
    options: jsonb('options').$type<string[]>().notNull(),
    correctAnswer: text('correctAnswer').notNull(),
  },
  (table) => [
    uniqueIndex('competition_questions_participant_ordinal_unique').on(table.participantId, table.ordinal),
    index('competition_questions_participant_idx').on(table.participantId),
    check(
      'competition_questions_source_fk_check',
      sql`(${table.source} = 'math' and ${table.mathQuestionId} is not null and ${table.wordId} is null) or (${table.source} in ('en','ar') and ${table.wordId} is not null and ${table.mathQuestionId} is null)`,
    ),
  ],
)

export const siteContent = pgTable(
  'siteContent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    group: text('group').notNull().default('general'),
    title: text('title'),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    status: publicationStatus('status').notNull().default('draft'),
    isVisible: boolean('isVisible').notNull().default(true),
    sortOrder: integer('sortOrder').notNull().default(0),
    startsAt: utcTimestamp('startsAt'),
    endsAt: utcTimestamp('endsAt'),
    version: integer('version').notNull().default(1),
    updatedBy: text('updatedBy').references(() => user.id, { onDelete: 'set null' }),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [
    index('site_content_group_status_order_idx').on(table.group, table.status, table.sortOrder),
    check('site_content_version_check', sql`${table.version} > 0`),
    check(
      'site_content_dates_check',
      sql`${table.endsAt} is null or ${table.startsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
  ],
)

export const siteContentVersions = pgTable(
  'siteContentVersions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    siteContentId: uuid('siteContentId')
      .notNull()
      .references(() => siteContent.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title'),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    status: publicationStatus('status').notNull(),
    isVisible: boolean('isVisible').notNull(),
    startsAt: utcTimestamp('startsAt'),
    endsAt: utcTimestamp('endsAt'),
    createdBy: text('createdBy').references(() => user.id, { onDelete: 'set null' }),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('site_content_versions_item_version_unique').on(table.siteContentId, table.version),
    index('site_content_versions_item_created_idx').on(table.siteContentId, table.createdAt),
  ],
)

export const platformSettings = pgTable(
  'platformSettings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').$type<Record<string, unknown>>().notNull(),
    updatedBy: text('updatedBy').references(() => user.id, { onDelete: 'set null' }),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    updatedAt: utcTimestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => [index('platform_settings_updated_idx').on(table.updatedAt)],
)

export const userActivities = pgTable(
  'userActivities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    activityType: text('activityType').notNull(),
    entityType: text('entityType'),
    entityId: text('entityId'),
    durationSeconds: integer('durationSeconds'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
  },
  (table) => [
    index('user_activities_user_created_idx').on(table.userId, table.createdAt),
    index('user_activities_type_created_idx').on(table.activityType, table.createdAt),
    check(
      'user_activities_duration_check',
      sql`${table.durationSeconds} is null or ${table.durationSeconds} >= 0`,
    ),
  ],
)

export const adminNotes = pgTable(
  'adminNotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    note: text('note').notNull(),
    severity: text('severity').notNull().default('info'),
    createdBy: text('createdBy').references(() => user.id, { onDelete: 'set null' }),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
  },
  (table) => [index('admin_notes_user_created_idx').on(table.userId, table.createdAt)],
)

export const backupJobs = pgTable(
  'backupJobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestedBy: text('requestedBy')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('running'),
    delivery: text('delivery').notNull(),
    recipient: text('recipient'),
    filename: text('filename'),
    blobPathname: text('blobPathname'),
    recordCount: integer('recordCount').notNull().default(0),
    blobCount: integer('blobCount').notNull().default(0),
    sizeBytes: bigint('sizeBytes', { mode: 'number' }).notNull().default(0),
    manifest: jsonb('manifest').$type<Record<string, unknown>>(),
    errorMessage: text('errorMessage'),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
    startedAt: utcTimestamp('startedAt').notNull().defaultNow(),
    completedAt: utcTimestamp('completedAt'),
  },
  (table) => [
    uniqueIndex('backup_jobs_one_active_per_admin_unique')
      .on(table.requestedBy)
      .where(sql`${table.status} in ('queued', 'running')`),
    index('backup_jobs_status_created_idx').on(table.status, table.createdAt),
    index('backup_jobs_requester_created_idx').on(table.requestedBy, table.createdAt),
    check(
      'backup_jobs_status_check',
      sql`${table.status} in ('queued', 'running', 'completed', 'failed')`,
    ),
    check(
      'backup_jobs_delivery_check',
      sql`${table.delivery} in ('download', 'email-attachment', 'email-link')`,
    ),
    check(
      'backup_jobs_counts_size_check',
      sql`${table.recordCount} >= 0 and ${table.blobCount} >= 0 and ${table.sizeBytes} >= 0`,
    ),
  ],
)

export const auditLogs = pgTable(
  'auditLogs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: text('actorUserId').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entityType').notNull(),
    entityId: text('entityId'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    ipHash: text('ipHash'),
    userAgent: text('userAgent'),
    reason: text('reason'),
    requestId: text('requestId'),
    outcome: text('outcome').notNull().default('success'),
    errorCode: text('errorCode'),
    createdAt: utcTimestamp('createdAt').notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_actor_created_idx').on(table.actorUserId, table.createdAt),
    index('audit_logs_entity_idx').on(table.entityType, table.entityId),
    index('audit_logs_action_created_idx').on(table.action, table.createdAt),
    index('audit_logs_outcome_created_idx').on(table.outcome, table.createdAt),
    check('audit_logs_outcome_check', sql`${table.outcome} in ('success', 'failure', 'denied')`),
  ],
)
