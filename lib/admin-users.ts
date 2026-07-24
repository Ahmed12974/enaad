import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth-session'
import { db } from '@/lib/db'
import {
  achievements,
  adminNotes,
  auditLogs,
  badges,
  challengeParticipants,
  challengeResults,
  challenges,
  educationalSections,
  levels,
  sectionContents,
  user,
  userAchievements,
  userAdminProfiles,
  userBadges,
  userContentProgress,
  userProgress,
} from '@/lib/db/schema'

export async function getAdminUserDetail(userId: string, progressPage = 1) {
  await requirePermission('users:read')
  const page = Math.max(1, Math.trunc(progressPage))
  const pageSize = 25
  const [profile] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      emailVerified: user.emailVerified,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      createdAt: user.createdAt,
      status: userAdminProfiles.status,
      suspendedUntil: userAdminProfiles.suspendedUntil,
      violationCount: userAdminProfiles.violationCount,
      levelId: userAdminProfiles.levelId,
      levelName: levels.name,
      xp: userProgress.xp,
      coins: userProgress.coins,
      streak: userProgress.streak,
      lastActiveAt: userProgress.lastActiveAt,
      lastLoginAt: sql<Date | null>`(select max(s."createdAt") from "session" s where s."userId" = ${user.id})`,
    })
    .from(user)
    .leftJoin(userAdminProfiles, eq(userAdminProfiles.userId, user.id))
    .leftJoin(levels, eq(levels.id, userAdminProfiles.levelId))
    .leftJoin(userProgress, eq(userProgress.userId, user.id))
    .where(and(eq(user.id, userId), isNull(user.deletedAt)))
    .limit(1)
  if (!profile) return null

  const [
    progress,
    progressTotal,
    participations,
    badgeGrants,
    userAchievementRows,
    notes,
    audits,
    levelRows,
    badgeRows,
    sectionRows,
    contentRows,
    availableAchievementRows,
  ] = await Promise.all([
    db
      .select({
        id: userContentProgress.id,
        contentId: sectionContents.id,
        contentTitle: sectionContents.title,
        contentKind: sectionContents.kind,
        sectionId: educationalSections.id,
        sectionName: educationalSections.name,
        status: userContentProgress.status,
        progress: userContentProgress.progress,
        score: userContentProgress.score,
        attempts: userContentProgress.attempts,
        lastActivityAt: userContentProgress.lastActivityAt,
        completedAt: userContentProgress.completedAt,
      })
      .from(userContentProgress)
      .innerJoin(sectionContents, eq(sectionContents.id, userContentProgress.contentId))
      .innerJoin(educationalSections, eq(educationalSections.id, sectionContents.sectionId))
      .where(eq(userContentProgress.userId, userId))
      .orderBy(desc(userContentProgress.lastActivityAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(userContentProgress)
      .where(eq(userContentProgress.userId, userId)),
    db
      .select({
        id: challengeParticipants.id,
        challengeId: challenges.id,
        title: challenges.title,
        status: challengeParticipants.status,
        progress: challengeParticipants.progress,
        joinedAt: challengeParticipants.joinedAt,
        completedAt: challengeParticipants.completedAt,
        score: challengeResults.score,
        rank: challengeResults.rank,
        isWinner: challengeResults.isWinner,
      })
      .from(challengeParticipants)
      .innerJoin(challenges, eq(challenges.id, challengeParticipants.challengeId))
      .leftJoin(challengeResults, eq(challengeResults.participantId, challengeParticipants.id))
      .where(eq(challengeParticipants.userId, userId))
      .orderBy(desc(challengeParticipants.joinedAt))
      .limit(100),
    db
      .select({
        id: userBadges.id,
        badgeId: badges.id,
        name: badges.name,
        sourceType: userBadges.sourceType,
        reason: userBadges.reason,
        grantedAt: userBadges.grantedAt,
        revokedAt: userBadges.revokedAt,
        revokeReason: userBadges.revokeReason,
      })
      .from(userBadges)
      .innerJoin(badges, eq(badges.id, userBadges.badgeId))
      .where(eq(userBadges.userId, userId))
      .orderBy(desc(userBadges.grantedAt))
      .limit(200),
    db
      .select({
        id: achievements.id,
        title: achievements.name,
        description: achievements.description,
        unlockedAt: userAchievements.earnedAt,
      })
      .from(userAchievements)
      .innerJoin(achievements, eq(achievements.id, userAchievements.achievementId))
      .where(eq(userAchievements.userId, userId))
      .orderBy(desc(userAchievements.earnedAt))
      .limit(200),
    db
      .select()
      .from(adminNotes)
      .where(eq(adminNotes.userId, userId))
      .orderBy(desc(adminNotes.createdAt))
      .limit(200),
    db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'user'), eq(auditLogs.entityId, userId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(200),
    db.select().from(levels).where(eq(levels.isActive, true)).orderBy(levels.rank).limit(100),
    db
      .select()
      .from(badges)
      .where(and(eq(badges.isPublished, true), isNull(badges.deletedAt)))
      .orderBy(badges.name)
      .limit(500),
    db
      .select({ id: educationalSections.id, name: educationalSections.name })
      .from(educationalSections)
      .where(isNull(educationalSections.deletedAt))
      .orderBy(educationalSections.sortOrder)
      .limit(500),
    db
      .select({ id: sectionContents.id, title: sectionContents.title, sectionId: sectionContents.sectionId })
      .from(sectionContents)
      .where(isNull(sectionContents.deletedAt))
      .orderBy(sectionContents.title)
      .limit(1_000),
    db
      .select({ id: achievements.id, name: achievements.name })
      .from(achievements)
      .where(eq(achievements.isActive, true))
      .orderBy(achievements.sortOrder, achievements.name)
      .limit(500),
  ])

  const total = progressTotal[0]?.total ?? 0
  return {
    profile,
    progress: { rows: progress, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) },
    participations,
    badgeGrants,
    achievements: userAchievementRows,
    notes,
    audits,
    levels: levelRows,
    badges: badgeRows,
    sections: sectionRows,
    contents: contentRows,
    availableAchievements: availableAchievementRows,
  }
}
