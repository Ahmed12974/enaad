import { and, asc, count, desc, eq, inArray, like } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth-session'
import { db } from '@/lib/db'
import {
  auditLogs,
  badges,
  challengeModeration,
  challengeParticipants,
  challengeResults,
  challengeSettings,
  challenges,
  educationalSections,
  media,
  user,
} from '@/lib/db/schema'

export async function getAdminChallengeDetail(challengeId: number, requestedPage = 1) {
  await requirePermission('competitions:write')
  const page = Math.max(1, Math.trunc(requestedPage))
  const pageSize = 25
  const [challenge] = await db
    .select({
      id: challenges.id,
      title: challenges.title,
      description: challenges.description,
      metric: challenges.metric,
      target: challenges.target,
      xpReward: challenges.xpReward,
      coinReward: challenges.coinReward,
      startsAt: challenges.startsAt,
      endsAt: challenges.endsAt,
      createdAt: challenges.createdAt,
      sectionId: challengeSettings.sectionId,
      sectionName: educationalSections.name,
      imageMediaId: challengeSettings.imageMediaId,
      imageName: media.originalName,
      lifecycle: challengeSettings.lifecycle,
      competitionType: challengeSettings.competitionType,
      participationRules: challengeSettings.participationRules,
      minimumParticipants: challengeSettings.minimumParticipants,
      maximumParticipants: challengeSettings.maximumParticipants,
      scoringRules: challengeSettings.scoringRules,
      winningRules: challengeSettings.winningRules,
      prizeBadgeId: challengeSettings.prizeBadgeId,
      prizeBadgeName: badges.name,
      winnerCount: challengeSettings.winnerCount,
    })
    .from(challenges)
    .innerJoin(challengeSettings, eq(challengeSettings.challengeId, challenges.id))
    .leftJoin(educationalSections, eq(educationalSections.id, challengeSettings.sectionId))
    .leftJoin(media, eq(media.id, challengeSettings.imageMediaId))
    .leftJoin(badges, eq(badges.id, challengeSettings.prizeBadgeId))
    .where(eq(challenges.id, challengeId))
    .limit(1)
  if (!challenge) return null

  const [participantRows, totalRows, results, auditRows, completedRows] = await Promise.all([
    db
      .select({
        id: challengeParticipants.id,
        userId: challengeParticipants.userId,
        userName: user.name,
        userEmail: user.email,
        status: challengeParticipants.status,
        progress: challengeParticipants.progress,
        joinedAt: challengeParticipants.joinedAt,
        completedAt: challengeParticipants.completedAt,
        rewardedAt: challengeParticipants.rewardedAt,
      })
      .from(challengeParticipants)
      .innerJoin(user, eq(user.id, challengeParticipants.userId))
      .where(eq(challengeParticipants.challengeId, challengeId))
      .orderBy(desc(challengeParticipants.joinedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: count() })
      .from(challengeParticipants)
      .where(eq(challengeParticipants.challengeId, challengeId)),
    db
      .select({
        id: challengeResults.id,
        participantId: challengeResults.participantId,
        userName: user.name,
        score: challengeResults.score,
        rank: challengeResults.rank,
        isWinner: challengeResults.isWinner,
        approvedAt: challengeResults.approvedAt,
        rewardGrantedAt: challengeResults.rewardGrantedAt,
      })
      .from(challengeResults)
      .innerJoin(challengeParticipants, eq(challengeParticipants.id, challengeResults.participantId))
      .innerJoin(user, eq(user.id, challengeParticipants.userId))
      .where(eq(challengeResults.challengeId, challengeId))
      .orderBy(asc(challengeResults.rank)),
    db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, String(challengeId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100),
    db
      .select({
        participantId: challengeParticipants.id,
        userName: user.name,
        progress: challengeParticipants.progress,
        joinedAt: challengeParticipants.joinedAt,
        completedAt: challengeParticipants.completedAt,
      })
      .from(challengeParticipants)
      .innerJoin(user, eq(user.id, challengeParticipants.userId))
      .where(
        and(
          eq(challengeParticipants.challengeId, challengeId),
          eq(challengeParticipants.status, 'completed'),
        ),
      )
      .limit(10_000),
  ])
  const participantIds = participantRows.map((item) => item.id)
  const moderation = participantIds.length
    ? await db
        .select()
        .from(challengeModeration)
        .where(inArray(challengeModeration.participantId, participantIds))
        .orderBy(desc(challengeModeration.createdAt))
    : []
  const total = totalRows[0]?.total ?? 0
  const multiplier =
    typeof challenge.scoringRules?.multiplier === 'number' && challenge.scoringRules.multiplier > 0
      ? challenge.scoringRules.multiplier
      : 1
  const tieBreaker =
    typeof challenge.winningRules?.tieBreaker === 'string'
      ? challenge.winningRules.tieBreaker
      : 'earliest_completion'
  const previewResults = completedRows
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
    .map((participant, index) => ({
      ...participant,
      rank: index + 1,
      isWinner: index < challenge.winnerCount,
    }))
  return {
    challenge,
    participants: { rows: participantRows, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) },
    results,
    previewResults,
    moderation,
    audits: auditRows,
  }
}

export async function getChallengeEditorOptions() {
  await requirePermission('competitions:write')
  const [sections, badgeRows, mediaRows] = await Promise.all([
    db.select({ id: educationalSections.id, name: educationalSections.name }).from(educationalSections),
    db.select({ id: badges.id, name: badges.name }).from(badges),
    db.select({ id: media.id, name: media.originalName }).from(media).where(like(media.mediaType, 'image/%')),
  ])
  return { sections, badges: badgeRows, media: mediaRows }
}
