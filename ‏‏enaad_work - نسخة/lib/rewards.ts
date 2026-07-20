import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { DbTransaction } from '@/lib/db'
import { evaluateAutomaticBadgesForUser, evaluatePromotionRulesForUser } from '@/lib/admin-domain'
import {
  challenges,
  challengeParticipants,
  rewardLedger,
  sentences,
  userActivities,
  userProgress,
  words,
} from '@/lib/db/schema'

const titleForXp = (xp: number | ReturnType<typeof sql>) => sql`CASE
  WHEN ${xp} >= 10000 THEN 'Legend'
  WHEN ${xp} >= 5000 THEN 'Master'
  WHEN ${xp} >= 2500 THEN 'Expert'
  WHEN ${xp} >= 1000 THEN 'Advanced'
  WHEN ${xp} >= 500 THEN 'Skilled'
  WHEN ${xp} >= 200 THEN 'Explorer'
  WHEN ${xp} >= 50 THEN 'Learner'
  ELSE 'Beginner'
END`

export async function ensureProgress(tx: DbTransaction, userId: string) {
  await tx.insert(userProgress).values({ userId }).onConflictDoNothing()
}

export async function touchUserActivity(tx: DbTransaction, userId: string) {
  await ensureProgress(tx, userId)
  const nextStreak = sql<number>`CASE
    WHEN ${userProgress.lastActiveAt}::date = CURRENT_DATE THEN ${userProgress.streak}
    WHEN ${userProgress.lastActiveAt}::date = CURRENT_DATE - 1 THEN ${userProgress.streak} + 1
    ELSE 1
  END`
  await tx
    .update(userProgress)
    .set({
      streak: nextStreak,
      longestStreak: sql`GREATEST(${userProgress.longestStreak}, ${nextStreak})`,
      lastActiveAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userProgress.userId, userId))
  await tx.insert(userActivities).values({
    userId,
    activityType: 'platform.activity',
  })
  await evaluatePromotionRulesForUser(tx, userId)
  await evaluateAutomaticBadgesForUser(tx, userId)
}

export async function awardProgress(
  tx: DbTransaction,
  input: {
    userId: string
    sourceType: string
    sourceId: string
    xp: number
    coins: number
    metadata?: Record<string, unknown>
  },
) {
  const xp = Math.max(0, Math.trunc(input.xp))
  const coins = Math.max(0, Math.trunc(input.coins))
  const [created] = await tx
    .insert(rewardLedger)
    .values({ ...input, xp, coins })
    .onConflictDoNothing()
    .returning({ id: rewardLedger.id })

  if (!created) return false
  await ensureProgress(tx, input.userId)
  const nextXp = sql<number>`${userProgress.xp} + ${xp}`
  await tx
    .update(userProgress)
    .set({
      xp: nextXp,
      coins: sql`${userProgress.coins} + ${coins}`,
      title: titleForXp(nextXp),
      lastActiveAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(userProgress.userId, input.userId))
  await tx.insert(userActivities).values({
    userId: input.userId,
    activityType: 'reward.earned',
    entityType: input.sourceType,
    entityId: input.sourceId,
    metadata: { xp, coins },
  })
  await evaluatePromotionRulesForUser(tx, input.userId)
  await evaluateAutomaticBadgesForUser(tx, input.userId)
  return true
}

export async function reconcileChallengesForUser(tx: DbTransaction, userId: string) {
  const now = new Date()
  const participations = await tx
    .select({ participant: challengeParticipants, challenge: challenges })
    .from(challengeParticipants)
    .innerJoin(challenges, eq(challengeParticipants.challengeId, challenges.id))
    .where(
      and(
        eq(challengeParticipants.userId, userId),
        inArray(challengeParticipants.status, ['joined', 'active']),
        eq(challenges.isActive, true),
      ),
    )

  if (!participations.length) return
  const [[wordStats], [sentenceStats], [progress]] = await Promise.all([
    tx
      .select({
        count: sql<number>`count(*)::int`,
        reviews: sql<number>`coalesce(sum(${words.reviewCount}), 0)::int`,
      })
      .from(words)
      .where(and(eq(words.userId, userId), isNull(words.deletedAt))),
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(sentences)
      .where(eq(sentences.userId, userId)),
    tx
      .select({ streak: userProgress.streak })
      .from(userProgress)
      .where(eq(userProgress.userId, userId))
      .limit(1),
  ])

  for (const { participant, challenge } of participations) {
    if ((challenge.startsAt && challenge.startsAt > now) || (challenge.endsAt && challenge.endsAt < now)) {
      if (challenge.endsAt && challenge.endsAt < now) {
        await tx
          .update(challengeParticipants)
          .set({ status: 'expired' })
          .where(
            and(
              eq(challengeParticipants.id, participant.id),
              inArray(challengeParticipants.status, ['joined', 'active']),
            ),
          )
      }
      continue
    }

    const measured =
      challenge.metric === 'words'
        ? (wordStats?.count ?? 0)
        : challenge.metric === 'sentences'
          ? (sentenceStats?.count ?? 0)
          : challenge.metric === 'streak'
            ? (progress?.streak ?? 0)
            : (wordStats?.reviews ?? 0)
    const nextProgress = Math.min(challenge.target, measured)

    if (nextProgress < challenge.target) {
      await tx
        .update(challengeParticipants)
        .set({ progress: nextProgress, status: 'active' })
        .where(
          and(
            eq(challengeParticipants.id, participant.id),
            inArray(challengeParticipants.status, ['joined', 'active']),
          ),
        )
      continue
    }

    const [completed] = await tx
      .update(challengeParticipants)
      .set({ progress: challenge.target, status: 'completed', completedAt: now })
      .where(
        and(
          eq(challengeParticipants.id, participant.id),
          inArray(challengeParticipants.status, ['joined', 'active']),
        ),
      )
      .returning({ id: challengeParticipants.id })
    if (!completed) continue

    const awarded = await awardProgress(tx, {
      userId,
      sourceType: 'challenge',
      sourceId: String(challenge.id),
      xp: challenge.xpReward,
      coins: challenge.coinReward,
      metadata: { participantId: participant.id },
    })
    if (awarded) {
      await tx
        .update(challengeParticipants)
        .set({ rewardedAt: now })
        .where(eq(challengeParticipants.id, participant.id))
    }
  }
}
