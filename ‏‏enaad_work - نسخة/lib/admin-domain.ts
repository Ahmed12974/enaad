import { and, eq, inArray, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db'
import {
  badges,
  achievements,
  challengeParticipants,
  challengeResults,
  contentPrerequisites,
  educationalSections,
  promotionRuleExecutions,
  promotionRules,
  rewardLedger,
  sectionContents,
  user,
  userAchievements,
  userAdminProfiles,
  userBadges,
  userContentProgress,
  userProgress,
} from '@/lib/db/schema'

export type SectionInput = typeof educationalSections.$inferInsert
export type ContentInput = typeof sectionContents.$inferInsert

export function meetsPromotionThreshold(currentValue: number, threshold: number) {
  return Number.isFinite(currentValue) && Number.isFinite(threshold) && currentValue >= threshold
}

export type PromotionRuleCondition = {
  type:
    | 'points'
    | 'section_completion'
    | 'lessons_completed'
    | 'challenge_wins'
    | 'activity_streak'
    | 'achievements'
  threshold: number
  sectionId?: string | null
}

export type PromotionRuleAction =
  | { type: 'promote_level'; levelId: number }
  | { type: 'grant_badge'; badgeId: string }
  | { type: 'add_xp'; amount: number }
  | { type: 'add_coins'; amount: number }
  | { type: 'grant_achievement'; achievementId: number }

export type PromotionRuleConfiguration = {
  logic: 'and' | 'or'
  conditions: PromotionRuleCondition[]
  actions: PromotionRuleAction[]
}

function asRuleConfiguration(value: Record<string, unknown>): PromotionRuleConfiguration | null {
  if (!Array.isArray(value.conditions) || !Array.isArray(value.actions)) return null
  const logic = value.logic === 'or' ? 'or' : 'and'
  const conditions = value.conditions.filter((item): item is PromotionRuleCondition =>
    Boolean(
      item &&
        typeof item === 'object' &&
        typeof (item as PromotionRuleCondition).type === 'string' &&
        Number.isFinite(Number((item as PromotionRuleCondition).threshold)),
    ),
  )
  const actions = value.actions.filter((item): item is PromotionRuleAction =>
    Boolean(item && typeof item === 'object' && typeof (item as PromotionRuleAction).type === 'string'),
  )
  return conditions.length && actions.length ? { logic, conditions, actions } : null
}

async function getPromotionMetrics(tx: DbTransaction, userId: string, sectionIds: string[]) {
  const [[progress], [lessons], [wins], [earnedAchievements], sectionRows] = await Promise.all([
    tx
      .select({ xp: userProgress.xp, streak: userProgress.streak })
      .from(userProgress)
      .where(eq(userProgress.userId, userId))
      .limit(1),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(userContentProgress)
      .innerJoin(sectionContents, eq(sectionContents.id, userContentProgress.contentId))
      .where(
        and(
          eq(userContentProgress.userId, userId),
          eq(userContentProgress.status, 'completed'),
          eq(sectionContents.kind, 'lesson'),
        ),
      ),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(challengeResults)
      .innerJoin(challengeParticipants, eq(challengeParticipants.id, challengeResults.participantId))
      .where(and(eq(challengeParticipants.userId, userId), eq(challengeResults.isWinner, true))),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId)),
    sectionIds.length
      ? tx.execute<{ sectionId: string; average: number }>(sql`
          select c."sectionId" as "sectionId", coalesce(round(avg(p.progress)), 0)::int as average
          from "userContentProgress" p inner join "sectionContents" c on c.id = p."contentId"
          where p."userId" = ${userId} and c."sectionId" in (${sql.join(
            sectionIds.map((sectionId) => sql`${sectionId}::uuid`),
            sql`, `,
          )})
          group by c."sectionId"
        `)
      : Promise.resolve({ rows: [] }),
  ])
  return {
    points: progress?.xp ?? 0,
    activity_streak: progress?.streak ?? 0,
    lessons_completed: lessons?.count ?? 0,
    challenge_wins: wins?.count ?? 0,
    achievements: earnedAchievements?.count ?? 0,
    sections: new Map(sectionRows.rows.map((row) => [row.sectionId, row.average])),
  }
}

export async function previewPromotionRuleForUser(tx: DbTransaction, ruleId: string, userId: string) {
  const [rule] = await tx.select().from(promotionRules).where(eq(promotionRules.id, ruleId)).limit(1)
  if (!rule) throw new Error('قاعدة الترقية غير موجودة.')
  const configured = asRuleConfiguration(rule.conditionValue)
  const conditions: PromotionRuleCondition[] = configured?.conditions ?? [
    {
      type: rule.conditionType,
      threshold: Number(rule.conditionValue.threshold),
      sectionId: rule.sectionId,
    },
  ]
  const metrics = await getPromotionMetrics(
    tx,
    userId,
    conditions.flatMap((condition) =>
      condition.type === 'section_completion' && condition.sectionId ? [condition.sectionId] : [],
    ),
  )
  const evaluations = conditions.map((condition) => {
    const current =
      condition.type === 'section_completion'
        ? condition.sectionId
          ? (metrics.sections.get(condition.sectionId) ?? 0)
          : 0
        : metrics[condition.type]
    return { ...condition, current, matched: meetsPromotionThreshold(current, condition.threshold) }
  })
  const logic = configured?.logic ?? 'and'
  const matched =
    logic === 'and' ? evaluations.every((item) => item.matched) : evaluations.some((item) => item.matched)
  return {
    rule,
    configuration: configured,
    logic,
    evaluations,
    actions:
      configured?.actions ??
      (rule.targetLevelId
        ? ([{ type: 'promote_level', levelId: rule.targetLevelId }] as PromotionRuleAction[])
        : []),
    matched,
  }
}

export async function executeConfiguredPromotionRuleTx(
  tx: DbTransaction,
  input: { ruleId: string; userId: string; sourceKey?: string; actorUserId?: string },
) {
  const preview = await previewPromotionRuleForUser(tx, input.ruleId, input.userId)
  if (!preview.rule.isActive || !preview.matched || !preview.actions.length) return null
  if (preview.rule.archivedAt) return null
  if (preview.rule.startsAt && preview.rule.startsAt.getTime() > Date.now()) return null
  if (preview.rule.endsAt && preview.rule.endsAt.getTime() < Date.now()) return null
  const [profile] = await tx
    .select({ levelId: userAdminProfiles.levelId })
    .from(userAdminProfiles)
    .where(eq(userAdminProfiles.userId, input.userId))
    .limit(1)
  const promotedLevel = preview.actions.find(
    (action): action is Extract<PromotionRuleAction, { type: 'promote_level' }> =>
      action.type === 'promote_level',
  )?.levelId
  const sourceKey = input.sourceKey ?? 'automatic'
  const [existingExecution] = await tx
    .select()
    .from(promotionRuleExecutions)
    .where(
      and(
        eq(promotionRuleExecutions.ruleId, preview.rule.id),
        eq(promotionRuleExecutions.userId, input.userId),
        eq(promotionRuleExecutions.sourceKey, sourceKey),
      ),
    )
    .limit(1)
  if (existingExecution?.status === 'completed' || existingExecution?.status === 'running') return null
  const [execution] = existingExecution
    ? await tx
        .update(promotionRuleExecutions)
        .set({
          status: 'running',
          attemptCount: sql`${promotionRuleExecutions.attemptCount} + 1`,
          errorMessage: null,
          beforeLevelId: profile?.levelId ?? null,
          afterLevelId: promotedLevel ?? profile?.levelId ?? null,
          executedAt: new Date(),
          completedAt: null,
        })
        .where(eq(promotionRuleExecutions.id, existingExecution.id))
        .returning()
    : await tx
        .insert(promotionRuleExecutions)
        .values({
          ruleId: preview.rule.id,
          userId: input.userId,
          sourceKey,
          beforeLevelId: profile?.levelId ?? null,
          afterLevelId: promotedLevel ?? profile?.levelId ?? null,
          status: 'running',
        })
        .returning()
  if (!execution) throw new Error('تعذر بدء سجل تنفيذ قاعدة الترقية.')

  for (const action of preview.actions) {
    if (action.type === 'promote_level') {
      await tx
        .insert(userAdminProfiles)
        .values({
          userId: input.userId,
          levelId: action.levelId,
          status: 'active',
          updatedBy: input.actorUserId,
        })
        .onConflictDoUpdate({
          target: userAdminProfiles.userId,
          set: { levelId: action.levelId, updatedBy: input.actorUserId, updatedAt: new Date() },
        })
    } else if (action.type === 'grant_badge') {
      await grantBadgeTx(tx, {
        userId: input.userId,
        badgeId: action.badgeId,
        actorUserId: input.actorUserId,
        reason: `Promotion rule ${preview.rule.id}`,
        sourceType: 'promotion-rule',
        sourceId: preview.rule.id,
        repeatKey: `rule:${preview.rule.id}`,
      })
    } else if (action.type === 'add_xp' || action.type === 'add_coins') {
      const xp = action.type === 'add_xp' ? action.amount : 0
      const coins = action.type === 'add_coins' ? action.amount : 0
      const [ledger] = await tx
        .insert(rewardLedger)
        .values({
          userId: input.userId,
          sourceType: `promotion-rule-${action.type}`,
          sourceId: preview.rule.id,
          xp,
          coins,
        })
        .onConflictDoNothing()
        .returning({ id: rewardLedger.id })
      if (ledger)
        await tx
          .insert(userProgress)
          .values({ userId: input.userId, xp, coins })
          .onConflictDoUpdate({
            target: userProgress.userId,
            set: {
              xp: sql`${userProgress.xp} + ${xp}`,
              coins: sql`${userProgress.coins} + ${coins}`,
              updatedAt: new Date(),
            },
          })
    } else if (action.type === 'grant_achievement') {
      const [achievement] = await tx
        .select({ id: achievements.id, xpReward: achievements.xpReward, coinReward: achievements.coinReward })
        .from(achievements)
        .where(and(eq(achievements.id, action.achievementId), eq(achievements.isActive, true)))
        .limit(1)
      if (!achievement) throw new Error('إنجاز قاعدة الترقية غير موجود أو معطل.')
      const [earned] = await tx
        .insert(userAchievements)
        .values({ userId: input.userId, achievementId: achievement.id })
        .onConflictDoNothing()
        .returning({ id: userAchievements.id })
      if (earned) {
        const [ledger] = await tx
          .insert(rewardLedger)
          .values({
            userId: input.userId,
            sourceType: 'promotion-rule-achievement',
            sourceId: preview.rule.id,
            xp: achievement.xpReward,
            coins: achievement.coinReward,
          })
          .onConflictDoNothing()
          .returning({ id: rewardLedger.id })
        if (ledger)
          await tx
            .insert(userProgress)
            .values({ userId: input.userId, xp: achievement.xpReward, coins: achievement.coinReward })
            .onConflictDoUpdate({
              target: userProgress.userId,
              set: {
                xp: sql`${userProgress.xp} + ${achievement.xpReward}`,
                coins: sql`${userProgress.coins} + ${achievement.coinReward}`,
                updatedAt: new Date(),
              },
            })
      }
    }
  }
  const [completed] = await tx
    .update(promotionRuleExecutions)
    .set({ status: 'completed', completedAt: new Date(), errorMessage: null })
    .where(eq(promotionRuleExecutions.id, execution.id))
    .returning()
  return completed ?? execution
}

export async function createEducationalSectionTx(tx: DbTransaction, input: SectionInput) {
  const [created] = await tx.insert(educationalSections).values(input).returning()
  if (!created) throw new Error('تعذر إنشاء القسم.')
  return created
}

export async function createSectionContentTx(tx: DbTransaction, input: ContentInput) {
  const [created] = await tx.insert(sectionContents).values(input).returning()
  if (!created) throw new Error('تعذر إنشاء المحتوى.')
  return created
}

export async function createSectionContentWithPrerequisitesTx(
  tx: DbTransaction,
  input: ContentInput,
  prerequisiteIds: string[],
) {
  const created = await createSectionContentTx(tx, input)
  await replaceContentPrerequisitesTx(tx, created.id, prerequisiteIds)
  return created
}

export async function replaceContentPrerequisitesTx(
  tx: DbTransaction,
  contentId: string,
  prerequisiteIds: string[],
) {
  if (new Set(prerequisiteIds).size !== prerequisiteIds.length)
    throw new Error('لا يجوز تكرار المحتوى نفسه ضمن المتطلبات السابقة.')
  if (prerequisiteIds.length) {
    const existing = await tx
      .select({ id: sectionContents.id })
      .from(sectionContents)
      .where(and(inArray(sectionContents.id, prerequisiteIds), sql`${sectionContents.deletedAt} is null`))
    if (existing.length !== prerequisiteIds.length)
      throw new Error('أحد المتطلبات السابقة غير موجود أو مؤرشف.')
  }
  for (const prerequisiteId of prerequisiteIds) {
    if (prerequisiteId === contentId) throw new Error('لا يمكن أن يكون المحتوى متطلبًا لنفسه.')
    const cycle = await tx.execute<{ found: boolean }>(sql`
      with recursive dependencies(id) as (
        select ${prerequisiteId}::uuid
        union
        select cp."prerequisiteId" from "contentPrerequisites" cp
        inner join dependencies d on cp."contentId" = d.id
      )
      select exists(select 1 from dependencies where id = ${contentId}::uuid) as found
    `)
    if (cycle.rows[0]?.found) throw new Error('لا يمكن حفظ المتطلبات لأنها تنشئ اعتمادًا دائريًا.')
  }
  await tx.delete(contentPrerequisites).where(eq(contentPrerequisites.contentId, contentId))
  if (prerequisiteIds.length)
    await tx
      .insert(contentPrerequisites)
      .values(prerequisiteIds.map((prerequisiteId) => ({ contentId, prerequisiteId })))
}

export async function grantBadgeTx(
  tx: DbTransaction,
  input: {
    userId: string
    badgeId: string
    actorUserId?: string
    reason: string
    sourceType?: string
    sourceId?: string
    repeatKey?: string
  },
) {
  const [badge] = await tx
    .select({ id: badges.id, isRepeatable: badges.isRepeatable, deletedAt: badges.deletedAt })
    .from(badges)
    .where(eq(badges.id, input.badgeId))
    .limit(1)
  if (!badge || badge.deletedAt) throw new Error('الشارة غير موجودة.')
  const [recipient] = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.id, input.userId), sql`${user.deletedAt} is null`))
    .limit(1)
  if (!recipient) throw new Error('المستخدم غير موجود.')

  const repeatKey = badge.isRepeatable ? input.repeatKey : 'singleton'
  if (badge.isRepeatable && !repeatKey) throw new Error('يلزم مفتاح مصدر فريد للشارة القابلة للتكرار.')
  const [granted] = await tx
    .insert(userBadges)
    .values({
      userId: input.userId,
      badgeId: input.badgeId,
      repeatKey,
      reason: input.reason,
      sourceType: input.sourceType ?? 'admin',
      sourceId: input.sourceId,
      grantedBy: input.actorUserId,
    })
    .onConflictDoNothing()
    .returning()
  return granted ?? null
}

export async function executePromotionRuleTx(
  tx: DbTransaction,
  input: {
    ruleId: string
    userId: string
    currentValue: number
    sourceKey?: string
    actorUserId?: string
  },
) {
  const [rule] = await tx
    .select()
    .from(promotionRules)
    .where(
      and(
        eq(promotionRules.id, input.ruleId),
        eq(promotionRules.isActive, true),
        sql`${promotionRules.archivedAt} is null`,
        sql`${promotionRules.endsAt} is null or ${promotionRules.endsAt} > now()`,
      ),
    )
    .limit(1)
  if (!rule) throw new Error('قاعدة الترقية غير موجودة أو معطلة.')
  if (rule.startsAt && rule.startsAt.getTime() > Date.now()) return null
  const threshold = Number(rule.conditionValue.threshold)
  if (!meetsPromotionThreshold(input.currentValue, threshold)) return null
  if (!rule.targetLevelId) throw new Error('قاعدة الترقية لا تحدد مستوى مستهدفًا.')

  const [profile] = await tx
    .select({ levelId: userAdminProfiles.levelId })
    .from(userAdminProfiles)
    .where(eq(userAdminProfiles.userId, input.userId))
    .limit(1)
  const sourceKey = input.sourceKey ?? 'once'
  const [execution] = await tx
    .insert(promotionRuleExecutions)
    .values({
      ruleId: rule.id,
      userId: input.userId,
      sourceKey,
      beforeLevelId: profile?.levelId ?? null,
      afterLevelId: rule.targetLevelId,
    })
    .onConflictDoNothing()
    .returning()
  if (!execution) return null

  await tx
    .insert(userAdminProfiles)
    .values({
      userId: input.userId,
      levelId: rule.targetLevelId,
      status: 'active',
      updatedBy: input.actorUserId,
    })
    .onConflictDoUpdate({
      target: userAdminProfiles.userId,
      set: {
        levelId: rule.targetLevelId,
        updatedBy: input.actorUserId,
        updatedAt: new Date(),
      },
    })
  return execution
}

export async function evaluatePromotionRulesForUser(tx: DbTransaction, userId: string) {
  const rules = await tx
    .select()
    .from(promotionRules)
    .where(
      and(
        eq(promotionRules.isActive, true),
        sql`${promotionRules.archivedAt} is null`,
        sql`${promotionRules.startsAt} is null or ${promotionRules.startsAt} <= now()`,
        sql`${promotionRules.endsAt} is null or ${promotionRules.endsAt} > now()`,
      ),
    )
    .orderBy(promotionRules.priority)
    .limit(200)
  if (!rules.length) return []
  const [[progress], [lessons], [wins], [earnedAchievements]] = await Promise.all([
    tx
      .select({ xp: userProgress.xp, streak: userProgress.streak })
      .from(userProgress)
      .where(eq(userProgress.userId, userId))
      .limit(1),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(userContentProgress)
      .innerJoin(sectionContents, eq(sectionContents.id, userContentProgress.contentId))
      .where(
        and(
          eq(userContentProgress.userId, userId),
          eq(userContentProgress.status, 'completed'),
          eq(sectionContents.kind, 'lesson'),
        ),
      ),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(challengeResults)
      .innerJoin(challengeParticipants, eq(challengeParticipants.id, challengeResults.participantId))
      .where(and(eq(challengeParticipants.userId, userId), eq(challengeResults.isWinner, true))),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId)),
  ])
  const applied = []
  for (const rule of rules) {
    if (asRuleConfiguration(rule.conditionValue)) {
      const execution = await executeConfiguredPromotionRuleTx(tx, {
        ruleId: rule.id,
        userId,
        sourceKey: 'once',
      })
      if (execution) applied.push(execution)
      continue
    }
    let currentValue = 0
    if (rule.conditionType === 'points') currentValue = progress?.xp ?? 0
    else if (rule.conditionType === 'activity_streak') currentValue = progress?.streak ?? 0
    else if (rule.conditionType === 'lessons_completed') currentValue = lessons?.count ?? 0
    else if (rule.conditionType === 'challenge_wins') currentValue = wins?.count ?? 0
    else if (rule.conditionType === 'achievements') currentValue = earnedAchievements?.count ?? 0
    else if (rule.conditionType === 'section_completion' && rule.sectionId) {
      const [completion] = await tx
        .select({ average: sql<number>`coalesce(round(avg(${userContentProgress.progress})), 0)::int` })
        .from(userContentProgress)
        .innerJoin(sectionContents, eq(sectionContents.id, userContentProgress.contentId))
        .where(and(eq(userContentProgress.userId, userId), eq(sectionContents.sectionId, rule.sectionId)))
      currentValue = completion?.average ?? 0
    }
    const execution = await executePromotionRuleTx(tx, {
      ruleId: rule.id,
      userId,
      currentValue,
      sourceKey: 'automatic',
    })
    if (execution) applied.push(execution)
  }
  return applied
}

export async function evaluateAutomaticBadgesForUser(tx: DbTransaction, userId: string) {
  const automaticBadges = await tx
    .select()
    .from(badges)
    .where(
      and(
        eq(badges.isPublished, true),
        sql`${badges.deletedAt} is null`,
        sql`${badges.mode} in ('automatic', 'both')`,
      ),
    )
    .limit(200)
  if (!automaticBadges.length) return []
  const [[progress], [lessons], [wins], [earnedAchievements]] = await Promise.all([
    tx
      .select({ xp: userProgress.xp, streak: userProgress.streak })
      .from(userProgress)
      .where(eq(userProgress.userId, userId))
      .limit(1),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(userContentProgress)
      .innerJoin(sectionContents, eq(sectionContents.id, userContentProgress.contentId))
      .where(
        and(
          eq(userContentProgress.userId, userId),
          eq(userContentProgress.status, 'completed'),
          eq(sectionContents.kind, 'lesson'),
        ),
      ),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(challengeResults)
      .innerJoin(challengeParticipants, eq(challengeParticipants.id, challengeResults.participantId))
      .where(and(eq(challengeParticipants.userId, userId), eq(challengeResults.isWinner, true))),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId)),
  ])
  const granted = []
  for (const badge of automaticBadges) {
    const conditionType = String(badge.criteria?.conditionType ?? '')
    const threshold = Number(badge.criteria?.threshold)
    if (!Number.isFinite(threshold)) continue
    let currentValue = 0
    if (conditionType === 'points') currentValue = progress?.xp ?? 0
    else if (conditionType === 'activity_streak') currentValue = progress?.streak ?? 0
    else if (conditionType === 'lessons_completed') currentValue = lessons?.count ?? 0
    else if (conditionType === 'challenge_wins') currentValue = wins?.count ?? 0
    else if (conditionType === 'achievements') currentValue = earnedAchievements?.count ?? 0
    else continue
    if (!meetsPromotionThreshold(currentValue, threshold)) continue
    const record = await grantBadgeTx(tx, {
      userId,
      badgeId: badge.id,
      reason: `Automatic badge criterion met: ${conditionType} >= ${threshold}`,
      sourceType: 'automatic-rule',
      sourceId: badge.id,
      repeatKey: badge.isRepeatable ? `threshold:${threshold}` : undefined,
    })
    if (record) granted.push(record)
  }
  return granted
}
