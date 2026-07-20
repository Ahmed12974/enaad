import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { levels, user, userAdminProfiles, userProgress } from '@/lib/db/schema'

export function sanitizedReportName(value: string | null) {
  return (value || 'users').replace(/[^a-z0-9_-]/gi, '-').slice(0, 60) || 'users'
}

export async function queryUsersForExport(params: URLSearchParams) {
  const conditions: SQL[] = [isNull(user.deletedAt)]
  const search = (params.get('search') || '').trim().slice(0, 120)
  if (search) {
    const pattern = `%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    conditions.push(or(ilike(user.name, pattern), ilike(user.email, pattern), ilike(user.id, pattern))!)
  }
  const status = params.get('status')
  if (status && ['active', 'disabled', 'suspended', 'banned'].includes(status)) {
    if (status === 'active')
      conditions.push(or(isNull(userAdminProfiles.status), eq(userAdminProfiles.status, 'active'))!)
    else conditions.push(eq(userAdminProfiles.status, status as 'disabled' | 'suspended' | 'banned'))
  }
  const levelId = Number(params.get('levelId') || 0)
  if (Number.isInteger(levelId) && levelId > 0) conditions.push(eq(userAdminProfiles.levelId, levelId))
  if (params.get('verified') === 'verified') conditions.push(eq(user.emailVerified, true))
  if (params.get('verified') === 'unverified') conditions.push(eq(user.emailVerified, false))
  const activityCutoff = new Date(Date.now() - 30 * 86400000)
  if (params.get('activity') === 'active') conditions.push(gte(userProgress.lastActiveAt, activityCutoff))
  if (params.get('activity') === 'inactive')
    conditions.push(or(isNull(userProgress.lastActiveAt), lte(userProgress.lastActiveAt, activityCutoff))!)
  const sectionId = params.get('sectionId')
  if (sectionId && /^[0-9a-f-]{36}$/i.test(sectionId))
    conditions.push(
      sql`exists(select 1 from "userContentProgress" fp inner join "sectionContents" fc on fc.id = fp."contentId" where fp."userId" = ${user.id} and fc."sectionId" = ${sectionId}::uuid)`,
    )
  const badgeId = params.get('badgeId')
  if (badgeId && /^[0-9a-f-]{36}$/i.test(badgeId))
    conditions.push(
      sql`exists(select 1 from "userBadges" fb where fb."userId" = ${user.id} and fb."badgeId" = ${badgeId}::uuid and fb."revokedAt" is null)`,
    )
  const challengeId = Number(params.get('challengeId') || 0)
  if (Number.isInteger(challengeId) && challengeId > 0)
    conditions.push(
      sql`exists(select 1 from "challengeParticipants" fcp where fcp."userId" = ${user.id} and fcp."challengeId" = ${challengeId})`,
    )
  const competitionId = Number(params.get('competitionId') || 0)
  if (Number.isInteger(competitionId) && competitionId > 0)
    conditions.push(
      sql`exists(select 1 from "competitionParticipants" fco where fco."userId" = ${user.id} and fco."competitionId" = ${competitionId})`,
    )
  const contentId = params.get('contentId')
  if (contentId && /^[0-9a-f-]{36}$/i.test(contentId))
    conditions.push(
      sql`exists(select 1 from "userContentProgress" fc where fc."userId" = ${user.id} and fc."contentId" = ${contentId}::uuid)`,
    )
  const achievementId = Number(params.get('achievementId') || 0)
  if (Number.isInteger(achievementId) && achievementId > 0)
    conditions.push(
      sql`exists(select 1 from "userAchievements" fa where fa."userId" = ${user.id} and fa."achievementId" = ${achievementId})`,
    )
  const activityType = params.get('activityType')
  if (activityType && ['platform.activity', 'reward.earned', 'page.active'].includes(activityType))
    conditions.push(
      sql`exists(select 1 from "userActivities" fat where fat."userId" = ${user.id} and fat."activityType" = ${activityType})`,
    )
  const outcome = params.get('outcome')
  if (outcome && ['completed', 'failed'].includes(outcome))
    conditions.push(
      sql`exists(select 1 from "userContentProgress" fo where fo."userId" = ${user.id} and fo.status = ${outcome})`,
    )
  const cohort = params.get('cohort')
  if (cohort === 'new') conditions.push(gte(user.createdAt, new Date(Date.now() - 90 * 86400000)))
  if (cohort === 'existing') conditions.push(lte(user.createdAt, new Date(Date.now() - 90 * 86400000)))
  if (params.get('hasNotes') === '1')
    conditions.push(sql`exists(select 1 from "adminNotes" fn where fn."userId" = ${user.id})`)
  for (const [key, column] of [
    ['from', gte],
    ['to', lte],
  ] as const) {
    const raw = params.get(key)
    if (!raw) continue
    const value = new Date(raw)
    if (!Number.isNaN(value.getTime())) conditions.push(column(user.createdAt, value))
  }
  const sort = params.get('sort')
  const order =
    sort === 'oldest'
      ? asc(user.createdAt)
      : sort === 'name'
        ? asc(user.name)
        : sort === 'points'
          ? desc(userProgress.xp)
          : desc(user.createdAt)
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      status: userAdminProfiles.status,
      level: levels.name,
      points: userProgress.xp,
      coins: userProgress.coins,
      streak: userProgress.streak,
      lastActiveAt: userProgress.lastActiveAt,
    })
    .from(user)
    .leftJoin(userAdminProfiles, eq(userAdminProfiles.userId, user.id))
    .leftJoin(levels, eq(levels.id, userAdminProfiles.levelId))
    .leftJoin(userProgress, eq(userProgress.userId, user.id))
    .where(and(...conditions))
    .orderBy(order)
    .limit(10_000)
}
