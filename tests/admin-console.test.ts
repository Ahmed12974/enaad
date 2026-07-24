import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, describe, test } from 'node:test'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import {
  createEducationalSectionTx,
  createSectionContentTx,
  createSectionContentWithPrerequisitesTx,
  evaluateAutomaticBadgesForUser,
  executeConfiguredPromotionRuleTx,
  executePromotionRuleTx,
  grantBadgeTx,
  replaceContentPrerequisitesTx,
} from '@/lib/admin-domain'
import { matchesAdminIdentity } from '@/lib/admin-policy'
import type { DbTransaction } from '@/lib/db'
import {
  adminAllowlist,
  auditLogs,
  badges,
  challengeParticipants,
  challengeResults,
  challengeSettings,
  challenges,
  contentPrerequisites,
  educationalSections,
  levels,
  media,
  promotionRuleExecutions,
  promotionRules,
  platformSettings,
  sectionContents,
  siteContent,
  siteContentVersions,
  user,
  userAdminProfiles,
  userBadges,
  userContentProgress,
  userProgress,
  words,
} from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'

let client: PGlite
let database: ReturnType<typeof drizzle<typeof schema>>
const adminId = 'admin-test-id'
const adminEmail = 'admin@example.test'
const learnerId = 'learner-test-id'

describe('secure administrative console domain', { concurrency: 1 }, () => {
  before(async () => {
    client = new PGlite()
    const migrations = await Promise.all(
      [
        'drizzle/0000_ordinary_spitfire.sql',
        'drizzle/0001_productive_red_ghost.sql',
        'drizzle/0002_glamorous_rhodey.sql',
        'drizzle/0003_puzzling_black_tarantula.sql',
        'drizzle/0004_chief_archangel.sql',
        'drizzle/0005_admin_completion.sql',
        'drizzle/0006_scheduled_content.sql',
        'drizzle/0007_media_metadata.sql',
        'drizzle/0008_rules_lifecycle.sql',
        'drizzle/0009_soft_delete_words.sql',
        'drizzle/0010_audit_outcomes.sql',
        'drizzle/0011_rate_limit_repair.sql',
        'drizzle/0012_academy_brand.sql',
        'drizzle/0013_backup_jobs.sql',
        'drizzle/0014_section_metadata.sql',
        'drizzle/0015_competition_lifecycle.sql',
        'drizzle/0016_challenge_type.sql',
        'drizzle/0017_branch_compatibility.sql',
      ].map((file) => readFile(resolve(process.cwd(), file), 'utf8')),
    )
    await client.exec(migrations.join('\n'))
    database = drizzle(client, { schema })
    await database.insert(user).values([
      {
        id: adminId,
        name: 'Administrator',
        email: adminEmail,
        emailVerified: true,
        role: 'admin',
      },
      {
        id: learnerId,
        name: 'Ordinary learner',
        email: 'learner@example.invalid',
        emailVerified: true,
        role: 'user',
      },
    ])
    await database.insert(adminAllowlist).values({ email: adminEmail })
  })

  after(async () => client.close())

  test('allows verified active database administrators only', () => {
    assert.equal(
      matchesAdminIdentity({
        email: adminEmail.toUpperCase(),
        emailVerified: true,
        role: 'admin',
        banned: false,
      }),
      true,
    )
    assert.equal(
      matchesAdminIdentity({
        email: 'other-admin@example.invalid',
        emailVerified: true,
        role: 'admin',
      }),
      true,
    )
    assert.equal(
      matchesAdminIdentity({
        email: adminEmail,
        emailVerified: false,
        role: 'admin',
      }),
      false,
    )
    assert.equal(
      matchesAdminIdentity({
        email: adminEmail,
        emailVerified: true,
        role: 'user',
      }),
      false,
    )
  })

  test('creates and updates an educational section without hard-coded names', async () => {
    const created = await database.transaction((tx) =>
      createEducationalSectionTx(tx as unknown as DbTransaction, {
        name: 'البرمجة',
        slug: 'programming',
        status: 'draft',
        access: 'restricted',
        sortOrder: 60,
      }),
    )
    assert.equal(created.slug, 'programming')
    const [updated] = await database
      .update(educationalSections)
      .set({ name: 'البرمجة للأطفال', status: 'published' })
      .where(eq(educationalSections.id, created.id))
      .returning()
    assert.equal(updated?.name, 'البرمجة للأطفال')
    assert.equal(updated?.status, 'published')
  })

  test('persists scheduled content and structured media metadata through cumulative migrations', async () => {
    const [section] = await database
      .insert(educationalSections)
      .values({ name: 'Scheduled content', slug: 'scheduled-content' })
      .returning()
    assert.ok(section)
    const publishAt = new Date(Date.now() + 60_000)
    const [content] = await database
      .insert(sectionContents)
      .values({
        sectionId: section.id,
        kind: 'lesson',
        title: 'Scheduled lesson',
        slug: 'scheduled-lesson',
        status: 'scheduled',
        publishedAt: publishAt,
      })
      .returning()
    const [asset] = await database
      .insert(media)
      .values({
        pathname: 'media/test.png',
        originalName: 'test.png',
        title: 'Cover image',
        description: 'A structured description',
        mediaType: 'image/png',
        sizeBytes: 128,
      })
      .returning()
    assert.equal(content?.status, 'scheduled')
    assert.equal(content?.publishedAt?.getTime(), publishAt.getTime())
    assert.equal(asset?.title, 'Cover image')
    assert.equal(asset?.description, 'A structured description')
  })

  test('creates a challenge, prevents duplicate participation, and counts a result once', async () => {
    const [challenge] = await database
      .insert(challenges)
      .values({
        title: 'اختبار تحدي الإدارة',
        normalizedTitle: 'اختبار تحدي الإدارة',
        description: 'تحدٍ اختباري متكامل',
        metric: 'words',
        target: 5,
      })
      .returning()
    assert.ok(challenge)
    await database.insert(challengeSettings).values({
      challengeId: challenge.id,
      lifecycle: 'active',
      winnerCount: 1,
    })
    const [participant] = await database
      .insert(challengeParticipants)
      .values({ userId: learnerId, challengeId: challenge.id, status: 'completed', progress: 5 })
      .returning()
    assert.ok(participant)
    await assert.rejects(() =>
      database.insert(challengeParticipants).values({ userId: learnerId, challengeId: challenge.id }),
    )
    await database.insert(challengeResults).values({
      challengeId: challenge.id,
      participantId: participant.id,
      score: 100,
      rank: 1,
      isWinner: true,
    })
    await assert.rejects(() =>
      database
        .insert(challengeResults)
        .values({ challengeId: challenge.id, participantId: participant.id, score: 100 }),
    )
    const [counted] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(challengeResults)
      .where(eq(challengeResults.participantId, participant.id))
    assert.equal(counted?.count, 1)
  })

  test('grants a non-repeatable badge once even with different source keys', async () => {
    const [badge] = await database
      .insert(badges)
      .values({
        name: 'أول إنجاز إداري',
        slug: 'first-admin-achievement',
        description: 'شارة اختبار عدم التكرار',
        isPublished: true,
        isRepeatable: false,
      })
      .returning()
    assert.ok(badge)
    const first = await database.transaction((tx) =>
      grantBadgeTx(tx as unknown as DbTransaction, {
        userId: learnerId,
        badgeId: badge.id,
        actorUserId: adminId,
        reason: 'استحقاق اختباري',
        repeatKey: 'source-one',
      }),
    )
    const duplicate = await database.transaction((tx) =>
      grantBadgeTx(tx as unknown as DbTransaction, {
        userId: learnerId,
        badgeId: badge.id,
        actorUserId: adminId,
        reason: 'محاولة مكررة',
        repeatKey: 'source-two',
      }),
    )
    assert.ok(first)
    assert.equal(duplicate, null)
    const grants = await database.select().from(userBadges).where(eq(userBadges.badgeId, badge.id))
    assert.equal(grants.length, 1)
  })

  test('automatically grants a configured badge once when its criterion is met', async () => {
    const [badge] = await database
      .insert(badges)
      .values({
        name: 'مائة نقطة',
        slug: 'one-hundred-points',
        description: 'تُمنح تلقائيًا عند بلوغ مائة نقطة',
        mode: 'automatic',
        criteria: { conditionType: 'points', threshold: 100 },
        isPublished: true,
      })
      .returning()
    assert.ok(badge)
    await database
      .insert(userProgress)
      .values({ userId: learnerId, xp: 100 })
      .onConflictDoUpdate({ target: userProgress.userId, set: { xp: 100 } })
    const first = await database.transaction((tx) =>
      evaluateAutomaticBadgesForUser(tx as unknown as DbTransaction, learnerId),
    )
    const second = await database.transaction((tx) =>
      evaluateAutomaticBadgesForUser(tx as unknown as DbTransaction, learnerId),
    )
    assert.equal(first.length, 1)
    assert.equal(second.length, 0)
    const grants = await database
      .select()
      .from(userBadges)
      .where(and(eq(userBadges.userId, learnerId), eq(userBadges.badgeId, badge.id)))
    assert.equal(grants.length, 1)
  })

  test('applies a promotion rule only after its threshold and only once', async () => {
    const [firstLevel, promotedLevel] = await database
      .insert(levels)
      .values([
        { name: 'اختبار مبتدئ', rank: 50, minimumPoints: 0 },
        { name: 'اختبار متقدم', rank: 51, minimumPoints: 100 },
      ])
      .returning()
    assert.ok(firstLevel && promotedLevel)
    await database.insert(userAdminProfiles).values({ userId: learnerId, levelId: firstLevel.id })
    const [rule] = await database
      .insert(promotionRules)
      .values({
        name: 'ترقية عند مائة نقطة',
        conditionType: 'points',
        conditionValue: { threshold: 100 },
        targetLevelId: promotedLevel.id,
        createdBy: adminId,
      })
      .returning()
    assert.ok(rule)
    const below = await database.transaction((tx) =>
      executePromotionRuleTx(tx as unknown as DbTransaction, {
        ruleId: rule.id,
        userId: learnerId,
        currentValue: 99,
      }),
    )
    const applied = await database.transaction((tx) =>
      executePromotionRuleTx(tx as unknown as DbTransaction, {
        ruleId: rule.id,
        userId: learnerId,
        currentValue: 100,
      }),
    )
    const duplicate = await database.transaction((tx) =>
      executePromotionRuleTx(tx as unknown as DbTransaction, {
        ruleId: rule.id,
        userId: learnerId,
        currentValue: 500,
      }),
    )
    assert.equal(below, null)
    assert.ok(applied)
    assert.equal(duplicate, null)
    const [profile] = await database
      .select({ levelId: userAdminProfiles.levelId })
      .from(userAdminProfiles)
      .where(eq(userAdminProfiles.userId, learnerId))
    assert.equal(profile?.levelId, promotedLevel.id)
    const executions = await database
      .select()
      .from(promotionRuleExecutions)
      .where(eq(promotionRuleExecutions.ruleId, rule.id))
    assert.equal(executions.length, 1)
  })

  test('evaluates composite AND/OR rules and applies every configured reward once', async () => {
    await database
      .insert(userProgress)
      .values({ userId: learnerId, xp: 100, coins: 0 })
      .onConflictDoUpdate({ target: userProgress.userId, set: { xp: 100, coins: 0 } })
    const [orRule, andRule] = await database
      .insert(promotionRules)
      .values([
        {
          name: 'Composite OR reward',
          conditionType: 'points' as const,
          conditionValue: {
            logic: 'or',
            conditions: [
              { type: 'points', threshold: 100 },
              { type: 'challenge_wins', threshold: 999 },
            ],
            actions: [
              { type: 'add_xp', amount: 7 },
              { type: 'add_coins', amount: 3 },
            ],
          },
          actionType: 'composite',
          createdBy: adminId,
        },
        {
          name: 'Composite AND does not match',
          conditionType: 'points' as const,
          conditionValue: {
            logic: 'and',
            conditions: [
              { type: 'points', threshold: 100 },
              { type: 'challenge_wins', threshold: 999 },
            ],
            actions: [{ type: 'add_xp', amount: 50 }],
          },
          actionType: 'composite',
          createdBy: adminId,
        },
      ])
      .returning()
    assert.ok(orRule && andRule)

    const first = await database.transaction((tx) =>
      executeConfiguredPromotionRuleTx(tx as unknown as DbTransaction, {
        ruleId: orRule.id,
        userId: learnerId,
        sourceKey: 'test-once',
      }),
    )
    const duplicate = await database.transaction((tx) =>
      executeConfiguredPromotionRuleTx(tx as unknown as DbTransaction, {
        ruleId: orRule.id,
        userId: learnerId,
        sourceKey: 'test-once',
      }),
    )
    const unmatched = await database.transaction((tx) =>
      executeConfiguredPromotionRuleTx(tx as unknown as DbTransaction, {
        ruleId: andRule.id,
        userId: learnerId,
        sourceKey: 'test-once',
      }),
    )
    assert.ok(first)
    assert.equal(duplicate, null)
    assert.equal(unmatched, null)
    const [progress] = await database
      .select({ xp: userProgress.xp, coins: userProgress.coins })
      .from(userProgress)
      .where(eq(userProgress.userId, learnerId))
    assert.deepEqual(progress, { xp: 107, coins: 3 })
  })

  test('rolls back every rule action when a later action fails', async () => {
    const [before] = await database
      .select({ xp: userProgress.xp })
      .from(userProgress)
      .where(eq(userProgress.userId, learnerId))
    const [rule] = await database
      .insert(promotionRules)
      .values({
        name: 'Atomic composite failure',
        conditionType: 'points',
        conditionValue: {
          logic: 'and',
          conditions: [{ type: 'points', threshold: 0 }],
          actions: [
            { type: 'add_xp', amount: 25 },
            { type: 'grant_achievement', achievementId: 999999 },
          ],
        },
        actionType: 'composite',
        createdBy: adminId,
      })
      .returning()
    assert.ok(rule)
    await assert.rejects(() =>
      database.transaction((tx) =>
        executeConfiguredPromotionRuleTx(tx as unknown as DbTransaction, {
          ruleId: rule.id,
          userId: learnerId,
          sourceKey: 'atomic-failure',
        }),
      ),
    )
    const [after] = await database
      .select({ xp: userProgress.xp })
      .from(userProgress)
      .where(eq(userProgress.userId, learnerId))
    assert.equal(after?.xp, before?.xp)
    const executions = await database
      .select()
      .from(promotionRuleExecutions)
      .where(eq(promotionRuleExecutions.ruleId, rule.id))
    assert.equal(executions.length, 0)
  })

  test('retries a failed rule execution with the same idempotency key once', async () => {
    const [rule] = await database
      .insert(promotionRules)
      .values({
        name: 'Safe retry',
        conditionType: 'points',
        conditionValue: {
          logic: 'and',
          conditions: [{ type: 'points', threshold: 0 }],
          actions: [{ type: 'add_coins', amount: 4 }],
        },
        actionType: 'composite',
        createdBy: adminId,
      })
      .returning()
    assert.ok(rule)
    await database.insert(promotionRuleExecutions).values({
      ruleId: rule.id,
      userId: learnerId,
      sourceKey: 'retry-key',
      status: 'failed',
      errorMessage: 'expected test failure',
    })
    const first = await database.transaction((tx) =>
      executeConfiguredPromotionRuleTx(tx as unknown as DbTransaction, {
        ruleId: rule.id,
        userId: learnerId,
        sourceKey: 'retry-key',
      }),
    )
    const duplicate = await database.transaction((tx) =>
      executeConfiguredPromotionRuleTx(tx as unknown as DbTransaction, {
        ruleId: rule.id,
        userId: learnerId,
        sourceKey: 'retry-key',
      }),
    )
    assert.equal(first?.status, 'completed')
    assert.equal(first?.attemptCount, 2)
    assert.equal(duplicate, null)
  })

  test('does not execute an expired or archived promotion rule', async () => {
    const [expired, archived] = await database
      .insert(promotionRules)
      .values([
        {
          name: 'Expired rule',
          conditionType: 'points' as const,
          conditionValue: {
            logic: 'and',
            conditions: [{ type: 'points', threshold: 0 }],
            actions: [{ type: 'add_coins', amount: 100 }],
          },
          actionType: 'composite',
          endsAt: new Date(Date.now() - 60_000),
          createdBy: adminId,
        },
        {
          name: 'Archived rule',
          conditionType: 'points' as const,
          conditionValue: {
            logic: 'and',
            conditions: [{ type: 'points', threshold: 0 }],
            actions: [{ type: 'add_coins', amount: 100 }],
          },
          actionType: 'composite',
          archivedAt: new Date(),
          createdBy: adminId,
        },
      ])
      .returning()
    assert.ok(expired && archived)
    for (const rule of [expired, archived]) {
      const result = await database.transaction((tx) =>
        executeConfiguredPromotionRuleTx(tx as unknown as DbTransaction, {
          ruleId: rule.id,
          userId: learnerId,
          sourceKey: 'must-not-run',
        }),
      )
      assert.equal(result, null)
    }
  })

  test('supports status filters/statistical aggregation and immutable audit inserts', async () => {
    await database
      .update(userAdminProfiles)
      .set({ status: 'suspended', suspendedUntil: new Date(Date.now() + 60_000) })
      .where(eq(userAdminProfiles.userId, learnerId))
    const suspended = await database
      .select({ id: user.id })
      .from(user)
      .innerJoin(userAdminProfiles, eq(userAdminProfiles.userId, user.id))
      .where(and(eq(userAdminProfiles.status, 'suspended'), eq(user.id, learnerId)))
    assert.equal(suspended.length, 1)
    const [content] = await database
      .transaction((tx) =>
        Promise.all([
          createSectionContentTx(tx as unknown as DbTransaction, {
            sectionId: '00000000-0000-0000-0000-000000000001',
            kind: 'lesson',
            title: 'لن يكتمل',
            slug: 'will-rollback',
          }),
        ]),
      )
      .catch(() => [null])
    assert.equal(content, null)
    const rolledBack = await database
      .select()
      .from(sectionContents)
      .where(eq(sectionContents.slug, 'will-rollback'))
    assert.equal(rolledBack.length, 0)

    const [audit] = await database
      .insert(auditLogs)
      .values({
        actorUserId: adminId,
        action: 'test.audit',
        entityType: 'test',
        reason: 'transaction verification',
        before: { value: 1 },
        after: { value: 2 },
      })
      .returning()
    assert.equal(audit?.reason, 'transaction verification')
    assert.equal(audit?.outcome, 'success')
    const [aggregate] = await database
      .select({
        completed: sql<number>`count(*) filter (where ${userContentProgress.status} = 'completed')::int`,
      })
      .from(userContentProgress)
    assert.equal(aggregate?.completed, 0)
  })

  test('rejects circular content prerequisites transactionally', async () => {
    const [section] = await database
      .insert(educationalSections)
      .values({ name: 'اعتماديات', slug: 'dependency-tests' })
      .returning()
    assert.ok(section)
    const [first, second] = await database
      .insert(sectionContents)
      .values([
        { sectionId: section.id, kind: 'lesson', title: 'الأول', slug: 'first' },
        { sectionId: section.id, kind: 'lesson', title: 'الثاني', slug: 'second' },
      ])
      .returning()
    assert.ok(first && second)
    await database.transaction((tx) =>
      replaceContentPrerequisitesTx(tx as unknown as DbTransaction, second.id, [first.id]),
    )
    await assert.rejects(() =>
      database.transaction((tx) =>
        replaceContentPrerequisitesTx(tx as unknown as DbTransaction, first.id, [second.id]),
      ),
    )
  })

  test('creates content and its prerequisites atomically', async () => {
    const [section] = await database
      .insert(educationalSections)
      .values({ name: 'إنشاء اعتماديات', slug: 'create-dependencies' })
      .returning()
    assert.ok(section)
    const [prerequisite] = await database
      .insert(sectionContents)
      .values({ sectionId: section.id, kind: 'lesson', title: 'التمهيد', slug: 'dependency-intro' })
      .returning()
    assert.ok(prerequisite)
    const created = await database.transaction((tx) =>
      createSectionContentWithPrerequisitesTx(
        tx as unknown as DbTransaction,
        { sectionId: section.id, kind: 'lesson', title: 'المتقدم', slug: 'dependency-advanced' },
        [prerequisite.id],
      ),
    )
    const links = await database
      .select()
      .from(contentPrerequisites)
      .where(eq(contentPrerequisites.contentId, created.id))
    assert.deepEqual(
      links.map((item) => item.prerequisiteId),
      [prerequisite.id],
    )
  })

  test('rolls back content creation when a prerequisite is invalid', async () => {
    const [section] = await database
      .insert(educationalSections)
      .values({ name: 'تراجع اعتماديات', slug: 'dependency-rollback-section' })
      .returning()
    assert.ok(section)
    await assert.rejects(() =>
      database.transaction((tx) =>
        createSectionContentWithPrerequisitesTx(
          tx as unknown as DbTransaction,
          {
            sectionId: section.id,
            kind: 'lesson',
            title: 'عملية يجب أن تتراجع',
            slug: 'create-dependency-rollback',
          },
          ['00000000-0000-0000-0000-000000000002'],
        ),
      ),
    )
    const rows = await database
      .select()
      .from(sectionContents)
      .where(eq(sectionContents.slug, 'create-dependency-rollback'))
    assert.equal(rows.length, 0)
  })

  test('persists validated platform settings and immutable CMS versions', async () => {
    const [setting] = await database
      .insert(platformSettings)
      .values({ key: 'general', value: { siteName: 'أكاديمية زايد التعليمية', defaultLanguage: 'ar' }, updatedBy: adminId })
      .returning()
    assert.equal(setting?.value.siteName, 'أكاديمية زايد التعليمية')
    const [content] = await database
      .insert(siteContent)
      .values({
        key: 'test-hero',
        group: 'homepage',
        content: { type: 'hero', heading: 'مرحبًا' },
        updatedBy: adminId,
      })
      .returning()
    assert.ok(content)
    await database.insert(siteContentVersions).values({
      siteContentId: content.id,
      version: 1,
      content: content.content,
      status: content.status,
      isVisible: content.isVisible,
      createdBy: adminId,
    })
    await assert.rejects(() =>
      database.insert(siteContentVersions).values({
        siteContentId: content.id,
        version: 1,
        content: content.content,
        status: content.status,
        isVisible: content.isVisible,
      }),
    )
  })

  test('archives user words without hard deletion and permits a later replacement', async () => {
    const [first] = await database
      .insert(words)
      .values({
        userId: learnerId,
        word: 'Recoverable',
        normalizedWord: 'recoverable',
        meaning: 'قابل للاسترداد',
      })
      .returning()
    assert.ok(first)
    await database.update(words).set({ deletedAt: new Date() }).where(eq(words.id, first.id))
    const [replacement] = await database
      .insert(words)
      .values({
        userId: learnerId,
        word: 'Recoverable',
        normalizedWord: 'recoverable',
        meaning: 'نسخة جديدة',
      })
      .returning()
    assert.ok(replacement)
    const rows = await database.select().from(words).where(eq(words.normalizedWord, 'recoverable'))
    assert.equal(rows.length, 2)
    assert.equal(rows.filter((row) => row.deletedAt === null).length, 1)
  })
})

test('upgrades the previous schema through corrective migrations without data loss', async () => {
  const previous = new PGlite()
  try {
    const baseFiles = [
      'drizzle/0000_ordinary_spitfire.sql',
      'drizzle/0001_productive_red_ghost.sql',
      'drizzle/0002_glamorous_rhodey.sql',
      'drizzle/0003_puzzling_black_tarantula.sql',
      'drizzle/0004_chief_archangel.sql',
      'drizzle/0005_admin_completion.sql',
      'drizzle/0006_scheduled_content.sql',
      'drizzle/0007_media_metadata.sql',
      'drizzle/0008_rules_lifecycle.sql',
    ]
    const baseSql = await Promise.all(baseFiles.map((file) => readFile(resolve(process.cwd(), file), 'utf8')))
    await previous.exec(baseSql.join('\n'))
    await previous.query(
      `insert into "user" (id, name, email, "emailVerified") values ('upgrade-user', 'Upgrade', 'upgrade@example.invalid', true)`,
    )
    await previous.query(
      `insert into words ("userId", word, "normalizedWord", meaning) values ('upgrade-user', 'Preserved', 'preserved', 'محفوظ')`,
    )
    await previous.query(
      `insert into "auditLogs" (action, "entityType", reason) values ('upgrade.test', 'test', 'preserved')`,
    )
    const corrective = await Promise.all(
      ['drizzle/0009_soft_delete_words.sql', 'drizzle/0010_audit_outcomes.sql'].map((file) =>
        readFile(resolve(process.cwd(), file), 'utf8'),
      ),
    )
    await previous.exec(corrective.join('\n'))
    const preservedWord = await previous.query<{ word: string; deletedAt: Date | null }>(
      `select word, "deletedAt" from words where "userId" = 'upgrade-user'`,
    )
    const preservedAudit = await previous.query<{ outcome: string }>(
      `select outcome from "auditLogs" where action = 'upgrade.test'`,
    )
    assert.equal(preservedWord.rows[0]?.word, 'Preserved')
    assert.equal(preservedWord.rows[0]?.deletedAt, null)
    assert.equal(preservedAudit.rows[0]?.outcome, 'success')
  } finally {
    await previous.close()
  }
})
