import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth-session'
import { db } from '@/lib/db'
import {
  adminNotes,
  achievements,
  auditLogs,
  badges,
  categories,
  challengeParticipants,
  challengeResults,
  competitionCategories,
  competitionParticipants,
  competitions,
  educationalSections,
  levels,
  mathSections,
  media,
  platformSettings,
  promotionRules,
  promotionRuleExecutions,
  rewardLedger,
  sectionContents,
  session,
  siteContent,
  siteContentVersions,
  user,
  userActivities,
  userAdminProfiles,
  userBadges,
  userContentProgress,
  userProgress,
} from '@/lib/db/schema'

export type AdminFilters = {
  page?: number
  pageSize?: number
  search?: string
  status?: 'all' | 'active' | 'disabled' | 'suspended' | 'banned'
  levelId?: number
  verified?: 'all' | 'verified' | 'unverified'
  activity?: 'all' | 'active' | 'inactive'
  sectionId?: string
  badgeId?: string
  challengeId?: number
  competitionId?: number
  contentId?: string
  achievementId?: number
  activityType?: 'all' | 'platform.activity' | 'reward.earned' | 'page.active'
  outcome?: 'all' | 'completed' | 'failed'
  cohort?: 'all' | 'new' | 'existing'
  hasNotes?: boolean
  from?: string
  to?: string
  sort?: 'newest' | 'oldest' | 'name' | 'points'
  mediaType?: 'all' | 'image' | 'video' | 'audio' | 'pdf'
}

export const adminSections = [
  'overview',
  'statistics',
  'users',
  'sections',
  'content',
  'challenges',
  'competitions',
  'promotions',
  'badges',
  'cms',
  'media',
  'audit',
  'backup',
  'settings',
] as const
export type AdminSection = (typeof adminSections)[number]

async function executeWhen<T>(enabled: boolean, query: () => Promise<{ rows: T[] }>) {
  return enabled ? (await query()).rows : []
}

async function selectWhen<T>(enabled: boolean, query: () => Promise<T[]>) {
  return enabled ? query() : []
}

function validDate(value?: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function getAdminConsoleData(filters: AdminFilters = {}, section: AdminSection = 'overview') {
  await requirePermission('reports:read')
  const needsDashboard = section === 'overview' || section === 'statistics'
  const needsUsers = section === 'overview' || section === 'users'
  const needsSections = [
    'overview',
    'statistics',
    'users',
    'sections',
    'content',
    'promotions',
    'badges',
  ].includes(section)
  const needsContent = section === 'overview' || section === 'content' || section === 'users'
  const needsChallenges = section === 'challenges' || section === 'users' || section === 'statistics'
  const needsCompetitions = section === 'competitions' || section === 'users' || section === 'statistics'
  const needsLevels = section === 'users' || section === 'promotions' || section === 'statistics'
  const needsBadges =
    section === 'overview' ||
    section === 'users' ||
    section === 'badges' ||
    section === 'challenges' ||
    section === 'promotions' ||
    section === 'statistics'
  const page = Math.max(1, Math.trunc(filters.page ?? 1))
  const pageSize = Math.min(100, Math.max(10, Math.trunc(filters.pageSize ?? 20)))
  const search = filters.search?.trim().slice(0, 120) ?? ''
  const from = validDate(filters.from)
  const to = validDate(filters.to)
  const trendTo = to ?? new Date()
  const maximumTrendRange = 366 * 24 * 60 * 60 * 1_000
  const requestedTrendFrom = from ?? new Date(trendTo.getTime() - 29 * 24 * 60 * 60 * 1_000)
  const trendFrom =
    requestedTrendFrom > trendTo
      ? new Date(trendTo.getTime() - 29 * 24 * 60 * 60 * 1_000)
      : trendTo.getTime() - requestedTrendFrom.getTime() > maximumTrendRange
        ? new Date(trendTo.getTime() - maximumTrendRange)
        : requestedTrendFrom
  const rangeDuration = Math.max(24 * 60 * 60 * 1_000, trendTo.getTime() - trendFrom.getTime())
  const previousFrom = new Date(trendFrom.getTime() - rangeDuration)
  const previousTo = new Date(trendTo.getTime() - rangeDuration)
  const userConditions: SQL[] = [isNull(user.deletedAt)]
  if (search) {
    const pattern = `%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    userConditions.push(or(ilike(user.name, pattern), ilike(user.email, pattern), ilike(user.id, pattern))!)
  }
  if (filters.status && filters.status !== 'all') {
    if (filters.status === 'active')
      userConditions.push(or(isNull(userAdminProfiles.status), eq(userAdminProfiles.status, 'active'))!)
    else userConditions.push(eq(userAdminProfiles.status, filters.status))
  }
  if (filters.levelId) userConditions.push(eq(userAdminProfiles.levelId, filters.levelId))
  if (filters.verified === 'verified') userConditions.push(eq(user.emailVerified, true))
  if (filters.verified === 'unverified') userConditions.push(eq(user.emailVerified, false))
  if (filters.activity === 'active')
    userConditions.push(gte(userProgress.lastActiveAt, new Date(Date.now() - 30 * 86400000)))
  if (filters.activity === 'inactive')
    userConditions.push(
      or(
        isNull(userProgress.lastActiveAt),
        lte(userProgress.lastActiveAt, new Date(Date.now() - 30 * 86400000)),
      )!,
    )
  if (filters.sectionId)
    userConditions.push(
      sql`exists(select 1 from "userContentProgress" fp inner join "sectionContents" fc on fc.id = fp."contentId" where fp."userId" = ${user.id} and fc."sectionId" = ${filters.sectionId}::uuid)`,
    )
  if (filters.badgeId)
    userConditions.push(
      sql`exists(select 1 from "userBadges" fb where fb."userId" = ${user.id} and fb."badgeId" = ${filters.badgeId}::uuid and fb."revokedAt" is null)`,
    )
  if (filters.challengeId)
    userConditions.push(
      sql`exists(select 1 from "challengeParticipants" fcp where fcp."userId" = ${user.id} and fcp."challengeId" = ${filters.challengeId})`,
    )
  if (filters.competitionId)
    userConditions.push(
      sql`exists(select 1 from "competitionParticipants" fco where fco."userId" = ${user.id} and fco."competitionId" = ${filters.competitionId})`,
    )
  if (filters.contentId)
    userConditions.push(
      sql`exists(select 1 from "userContentProgress" fcontent where fcontent."userId" = ${user.id} and fcontent."contentId" = ${filters.contentId}::uuid)`,
    )
  if (filters.achievementId)
    userConditions.push(
      sql`exists(select 1 from "userAchievements" fa where fa."userId" = ${user.id} and fa."achievementId" = ${filters.achievementId})`,
    )
  if (filters.activityType && filters.activityType !== 'all')
    userConditions.push(
      sql`exists(select 1 from "userActivities" fat where fat."userId" = ${user.id} and fat."activityType" = ${filters.activityType})`,
    )
  if (filters.outcome && filters.outcome !== 'all')
    userConditions.push(
      sql`exists(select 1 from "userContentProgress" fo where fo."userId" = ${user.id} and fo.status = ${filters.outcome})`,
    )
  if (filters.cohort === 'new') userConditions.push(gte(user.createdAt, new Date(Date.now() - 90 * 86400000)))
  if (filters.cohort === 'existing')
    userConditions.push(lte(user.createdAt, new Date(Date.now() - 90 * 86400000)))
  if (filters.hasNotes)
    userConditions.push(sql`exists(select 1 from "adminNotes" fn where fn."userId" = ${user.id})`)
  if (from) userConditions.push(gte(user.createdAt, from))
  if (to) userConditions.push(lte(user.createdAt, to))
  const whereUsers = and(...userConditions)
  const mediaConditions: SQL[] = [isNull(media.deletedAt)]
  if (section === 'media' && search) {
    const pattern = `%${search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    mediaConditions.push(or(ilike(media.originalName, pattern), ilike(media.altText, pattern))!)
  }
  if (section === 'media' && filters.mediaType && filters.mediaType !== 'all') {
    mediaConditions.push(
      filters.mediaType === 'pdf'
        ? eq(media.mediaType, 'application/pdf')
        : sql`${media.mediaType} like ${`${filters.mediaType}/%`}`,
    )
  }
  const whereMedia = and(...mediaConditions)
  const orderBy =
    filters.sort === 'oldest'
      ? asc(user.createdAt)
      : filters.sort === 'name'
        ? asc(user.name)
        : filters.sort === 'points'
          ? desc(userProgress.xp)
          : desc(user.createdAt)

  const [dashboardResult, trendResult, comparisonResult, userRows, totalRows] = await Promise.all([
    executeWhen(needsDashboard, () =>
      db.execute<{
        totalUsers: number
        newToday: number
        newWeek: number
        newMonth: number
        activeUsers: number
        inactiveUsers: number
        recentlyOnline: number
        sections: number
        completedContent: number
        averageProgress: number
        activeChallenges: number
        endedChallenges: number
        participants: number
        badgesGranted: number
      }>(sql`
      select
        (select count(*)::int from "user" where "deletedAt" is null) as "totalUsers",
        (select count(*)::int from "user" where "deletedAt" is null and "createdAt" >= date_trunc('day', now())) as "newToday",
        (select count(*)::int from "user" where "deletedAt" is null and "createdAt" >= date_trunc('week', now())) as "newWeek",
        (select count(*)::int from "user" where "deletedAt" is null and "createdAt" >= date_trunc('month', now())) as "newMonth",
        (select count(*)::int from "userProgress" where "lastActiveAt" >= now() - interval '30 days') as "activeUsers",
        (select count(*)::int from "user" u where u."deletedAt" is null and not exists (
          select 1 from "userProgress" p where p."userId" = u.id and p."lastActiveAt" >= now() - interval '30 days'
        )) as "inactiveUsers",
        (select count(*)::int from "userProgress" where "lastActiveAt" >= now() - interval '15 minutes') as "recentlyOnline",
        (select count(*)::int from "educationalSections" where "deletedAt" is null) as sections,
        (select count(*)::int from "userContentProgress" where status = 'completed') as "completedContent",
        coalesce((select round(avg(progress))::int from "userContentProgress"), 0) as "averageProgress",
        (select count(*)::int from "challengeSettings" where lifecycle in ('open','active','scheduled')) as "activeChallenges",
        (select count(*)::int from "challengeSettings" where lifecycle in ('ended','cancelled')) as "endedChallenges",
        (select count(*)::int from "challengeParticipants") as participants,
        (select count(*)::int from "userBadges" where "revokedAt" is null) as "badgesGranted"
    `),
    ),
    executeWhen(needsDashboard, () =>
      db.execute<{ day: string; registrations: number; activities: number }>(sql`
      with days as (
        select generate_series(${trendFrom}::timestamptz, ${trendTo}::timestamptz, interval '1 day')::date as day
      )
      select days.day::text,
        coalesce(registrations.count, 0)::int as registrations,
        coalesce(activities.count, 0)::int as activities
      from days
      left join (
        select "createdAt"::date as day, count(*)::int as count from "user"
        where "createdAt" >= ${trendFrom} and "createdAt" <= ${trendTo} group by 1
      ) registrations using (day)
      left join (
        select "createdAt"::date as day, count(*)::int as count from "userActivities"
        where "createdAt" >= ${trendFrom} and "createdAt" <= ${trendTo} group by 1
      ) activities using (day)
      order by days.day
    `),
    ),
    executeWhen(needsDashboard, () =>
      db.execute<{ current: number; previous: number }>(sql`
      select
        count(*) filter (where "createdAt" >= ${trendFrom} and "createdAt" <= ${trendTo})::int as current,
        count(*) filter (where "createdAt" >= ${previousFrom} and "createdAt" < ${previousTo})::int as previous
      from "user" where "deletedAt" is null
    `),
    ),
    selectWhen(needsUsers, () =>
      db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          role: user.role,
          banned: user.banned,
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
          lastLoginAt: sql<Date | null>`(
          select max(s."createdAt") from "session" s where s."userId" = ${user.id}
        )`,
          badgeCount: sql<number>`(
          select count(*)::int from "userBadges" ub where ub."userId" = ${user.id} and ub."revokedAt" is null
        )`,
          achievementCount: sql<number>`(
          select count(*)::int from "userAchievements" ua where ua."userId" = ${user.id}
        )`,
          challengeCount: sql<number>`(
          select count(*)::int from "challengeParticipants" cp where cp."userId" = ${user.id}
        )`,
          completedContent: sql<number>`(
          select count(*)::int from "userContentProgress" ucp where ucp."userId" = ${user.id} and ucp.status = 'completed'
        )`,
          averageCompletion: sql<number>`(
          select coalesce(round(avg(ucp.progress)), 0)::int from "userContentProgress" ucp where ucp."userId" = ${user.id}
        )`,
        })
        .from(user)
        .leftJoin(userAdminProfiles, eq(userAdminProfiles.userId, user.id))
        .leftJoin(levels, eq(levels.id, userAdminProfiles.levelId))
        .leftJoin(userProgress, eq(userProgress.userId, user.id))
        .where(whereUsers)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ),
    selectWhen(needsUsers, () =>
      db
        .select({ total: count() })
        .from(user)
        .leftJoin(userAdminProfiles, eq(userAdminProfiles.userId, user.id))
        .leftJoin(userProgress, eq(userProgress.userId, user.id))
        .where(whereUsers),
    ),
  ])

  const [
    sectionRows,
    contentRows,
    challengeRows,
    levelRows,
    ruleRows,
    badgeRows,
    siteRows,
    siteVersionRows,
    mediaRows,
    auditRows,
    noteRows,
    latestActivities,
    latestBadgeGrants,
    challengeLeaders,
    achievementRows,
    challengeParticipantRows,
  ] = await Promise.all([
    executeWhen(needsSections, () =>
      db.execute<{
        id: string
        name: string
        slug: string
        shortDescription: string | null
        fullDescription: string | null
        iconMediaId: string | null
        imageMediaId: string | null
        color: string | null
        ageRange: string | null
        targetLevel: string | null
        unlockRules: Record<string, unknown> | null
        access: 'free' | 'restricted'
        status: 'draft' | 'published' | 'archived'
        sortOrder: number
        contentCount: number
        learnerCount: number
      }>(sql`
      select s.id, s.name, s.slug, s."shortDescription", s."fullDescription", s."iconMediaId",
        s."imageMediaId", s.color, s."ageRange", s."targetLevel", s."unlockRules", s.access, s.status, s."sortOrder",
        count(distinct c.id)::int as "contentCount",
        count(distinct p."userId")::int as "learnerCount"
      from "educationalSections" s
      left join "sectionContents" c on c."sectionId" = s.id and c."deletedAt" is null
      left join "userContentProgress" p on p."contentId" = c.id
      where s."deletedAt" is null
      group by s.id order by s."sortOrder", s.name
    `),
    ),
    selectWhen(needsContent, () =>
      db
        .select()
        .from(sectionContents)
        .where(isNull(sectionContents.deletedAt))
        .orderBy(asc(sectionContents.sectionId), asc(sectionContents.sortOrder))
        .limit(500),
    ),
    executeWhen(needsChallenges, () =>
      db.execute<{
        id: number
        title: string
        description: string
        startsAt: Date | null
        endsAt: Date | null
        lifecycle: string | null
        sectionId: string | null
        participantCount: number
        completedCount: number
      }>(sql`
      select c.id, c.title, c.description, c."startsAt", c."endsAt", s.lifecycle, s."sectionId",
        count(p.id)::int as "participantCount",
        count(p.id) filter (where p.status = 'completed')::int as "completedCount"
      from challenges c
      left join "challengeSettings" s on s."challengeId" = c.id
      left join "challengeParticipants" p on p."challengeId" = c.id
      group by c.id, s.lifecycle, s."sectionId" order by c."createdAt" desc limit 200
    `),
    ),
    selectWhen(needsLevels, () => db.select().from(levels).orderBy(asc(levels.rank)).limit(100)),
    selectWhen(section === 'promotions', () =>
      db.select().from(promotionRules).orderBy(asc(promotionRules.priority)).limit(200),
    ),
    executeWhen(needsBadges, () =>
      db.execute<{
        id: string
        name: string
        slug: string
        rarity: string
        mode: string
        isPublished: boolean
        isRepeatable: boolean
        holders: number
      }>(sql`
      select b.id, b.name, b.slug, b.rarity, b.mode, b."isPublished", b."isRepeatable",
        count(ub.id) filter (where ub."revokedAt" is null)::int as holders
      from badges b left join "userBadges" ub on ub."badgeId" = b.id
      where b."deletedAt" is null group by b.id order by b."createdAt" desc limit 200
    `),
    ),
    selectWhen(section === 'cms', () =>
      db.select().from(siteContent).orderBy(asc(siteContent.group), asc(siteContent.sortOrder)).limit(200),
    ),
    selectWhen(section === 'cms', () =>
      db.select().from(siteContentVersions).orderBy(desc(siteContentVersions.createdAt)).limit(200),
    ),
    selectWhen(['media', 'sections', 'content', 'badges', 'cms', 'challenges'].includes(section), () =>
      db
        .select({
          id: media.id,
          pathname: media.pathname,
          originalName: media.originalName,
          title: media.title,
          description: media.description,
          mediaType: media.mediaType,
          sizeBytes: media.sizeBytes,
          altText: media.altText,
          storageProvider: media.storageProvider,
          uploadedBy: media.uploadedBy,
          createdAt: media.createdAt,
          deletedAt: media.deletedAt,
          usageCount: sql<number>`(
            (select count(*) from "educationalSections" where "iconMediaId" = ${media.id} or "imageMediaId" = ${media.id}) +
            (select count(*) from "sectionContents" where "mediaId" = ${media.id} and "deletedAt" is null) +
            (select count(*) from badges where "imageMediaId" = ${media.id} and "deletedAt" is null) +
            (select count(*) from "challengeSettings" where "imageMediaId" = ${media.id})
          )::int`,
        })
        .from(media)
        .where(section === 'media' ? whereMedia : isNull(media.deletedAt))
        .orderBy(desc(media.createdAt))
        .limit(section === 'media' ? pageSize : 100)
        .offset(section === 'media' ? (page - 1) * pageSize : 0),
    ),
    selectWhen(section === 'overview' || section === 'audit', () =>
      db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100),
    ),
    selectWhen(section === 'users', () =>
      db.select().from(adminNotes).orderBy(desc(adminNotes.createdAt)).limit(100),
    ),
    selectWhen(section === 'overview' || section === 'statistics', () =>
      db.select().from(userActivities).orderBy(desc(userActivities.createdAt)).limit(50),
    ),
    selectWhen(section === 'overview' || section === 'badges', () =>
      db
        .select({
          id: userBadges.id,
          userName: user.name,
          badgeName: badges.name,
          grantedAt: userBadges.grantedAt,
        })
        .from(userBadges)
        .innerJoin(user, eq(user.id, userBadges.userId))
        .innerJoin(badges, eq(badges.id, userBadges.badgeId))
        .where(isNull(userBadges.revokedAt))
        .orderBy(desc(userBadges.grantedAt))
        .limit(20),
    ),
    selectWhen(needsChallenges, () =>
      db
        .select({
          challengeId: challengeResults.challengeId,
          userName: user.name,
          score: challengeResults.score,
          rank: challengeResults.rank,
          isWinner: challengeResults.isWinner,
        })
        .from(challengeResults)
        .innerJoin(challengeParticipants, eq(challengeParticipants.id, challengeResults.participantId))
        .innerJoin(user, eq(user.id, challengeParticipants.userId))
        .orderBy(asc(challengeResults.challengeId), asc(challengeResults.rank))
        .limit(1_000),
    ),
    selectWhen(section === 'badges' || section === 'promotions' || section === 'users', () =>
      db.select().from(achievements).orderBy(asc(achievements.sortOrder), asc(achievements.name)).limit(200),
    ),
    selectWhen(needsChallenges, () =>
      db
        .select({
          id: challengeParticipants.id,
          challengeId: challengeParticipants.challengeId,
          userName: user.name,
          userEmail: user.email,
          status: challengeParticipants.status,
          progress: challengeParticipants.progress,
          joinedAt: challengeParticipants.joinedAt,
        })
        .from(challengeParticipants)
        .innerJoin(user, eq(user.id, challengeParticipants.userId))
        .orderBy(desc(challengeParticipants.joinedAt))
        .limit(1_000),
    ),
  ])

  const [competitionRows, competitionCategoryRows, competitionParticipantRows, platformCategoryRows, mathSectionRows] =
    await Promise.all([
      executeWhen(needsCompetitions, () =>
        db.execute<{
          id: number
          title: string
          description: string
          scope: 'all' | 'en' | 'ar' | 'math'
          sectionId: number | null
          questionCount: number
          xpReward: number
          startsAt: Date | null
          endsAt: Date | null
          isActive: boolean
          createdAt: Date
          updatedAt: Date
          participantCount: number
          submittedCount: number
        }>(sql`
          select c.id, c.title, c.description, c.scope, c."sectionId", c."questionCount", c."xpReward",
            c."startsAt", c."endsAt", c."isActive", c."createdAt", c."updatedAt",
            count(p.id)::int as "participantCount",
            count(p.id) filter (where p.status = 'submitted')::int as "submittedCount"
          from competitions c
          left join "competitionParticipants" p on p."competitionId" = c.id
          group by c.id
          order by c."createdAt" desc
          limit 200
        `),
      ),
      selectWhen(section === 'competitions', () =>
        db.select().from(competitionCategories).orderBy(asc(competitionCategories.competitionId)),
      ),
      selectWhen(section === 'competitions', () =>
        db
          .select({
            id: competitionParticipants.id,
            competitionId: competitionParticipants.competitionId,
            userId: competitionParticipants.userId,
            userName: user.name,
            userEmail: user.email,
            status: competitionParticipants.status,
            score: competitionParticipants.score,
            correctAnswers: competitionParticipants.correctAnswers,
            joinedAt: competitionParticipants.joinedAt,
            submittedAt: competitionParticipants.submittedAt,
          })
          .from(competitionParticipants)
          .innerJoin(user, eq(user.id, competitionParticipants.userId))
          .orderBy(desc(competitionParticipants.joinedAt))
          .limit(1_000),
      ),
      selectWhen(section === 'competitions', () =>
        db
          .select()
          .from(categories)
          .where(and(eq(categories.scope, 'platform'), isNull(categories.userId)))
          .orderBy(asc(categories.language), asc(categories.sortOrder), asc(categories.name))
          .limit(500),
      ),
      selectWhen(section === 'competitions', () =>
        db.select().from(mathSections).orderBy(asc(mathSections.sortOrder), asc(mathSections.name)).limit(200),
      ),
    ])

  const [settingRows, mediaTotalRows, ruleExecutionRows] = await Promise.all([
    selectWhen(section === 'settings' || section === 'media', () =>
      db.select().from(platformSettings).where(eq(platformSettings.key, 'general')).limit(1),
    ),
    selectWhen(section === 'media', () => db.select({ total: count() }).from(media).where(whereMedia)),
    selectWhen(section === 'promotions', () =>
      db
        .select({
          id: promotionRuleExecutions.id,
          ruleId: promotionRuleExecutions.ruleId,
          ruleName: promotionRules.name,
          userId: promotionRuleExecutions.userId,
          userName: user.name,
          sourceKey: promotionRuleExecutions.sourceKey,
          status: promotionRuleExecutions.status,
          attemptCount: promotionRuleExecutions.attemptCount,
          errorMessage: promotionRuleExecutions.errorMessage,
          executedAt: promotionRuleExecutions.executedAt,
          completedAt: promotionRuleExecutions.completedAt,
        })
        .from(promotionRuleExecutions)
        .innerJoin(promotionRules, eq(promotionRules.id, promotionRuleExecutions.ruleId))
        .innerJoin(user, eq(user.id, promotionRuleExecutions.userId))
        .orderBy(desc(promotionRuleExecutions.executedAt))
        .limit(200),
    ),
  ])
  const [statisticsSummaryRows, sectionStatisticRows, levelDistributionRows, contentStatisticRows] =
    await Promise.all([
      executeWhen(section === 'statistics', () =>
        db.execute<{
          registrations: number
          activeUsers: number
          returningUsers: number
          sessions: number
          completedContent: number
          failedContent: number
          averageSuccess: number
          challengeParticipations: number
          xpEarned: number
          badgesGranted: number
          promotions: number
          averageUsageMinutes: number
        }>(sql`
          select
            (select count(*)::int from "user" where "deletedAt" is null and "createdAt" between ${trendFrom} and ${trendTo}) as registrations,
            (select count(distinct "userId")::int from "userActivities" where "createdAt" between ${trendFrom} and ${trendTo}) as "activeUsers",
            (select count(*)::int from "user" u where exists (
              select 1 from "userActivities" a where a."userId" = u.id and a."createdAt" between ${trendFrom} and ${trendTo}
            ) and exists (
              select 1 from "userActivities" a where a."userId" = u.id and a."createdAt" < ${trendFrom}
            )) as "returningUsers",
            (select count(*)::int from ${session} where ${session.createdAt} between ${trendFrom} and ${trendTo}) as sessions,
            (select count(*)::int from ${userContentProgress} where ${userContentProgress.status} = 'completed' and ${userContentProgress.lastActivityAt} between ${trendFrom} and ${trendTo}) as "completedContent",
            (select count(*)::int from ${userContentProgress} where ${userContentProgress.status} = 'failed' and ${userContentProgress.lastActivityAt} between ${trendFrom} and ${trendTo}) as "failedContent",
            coalesce((select round(avg(${userContentProgress.score}))::int from ${userContentProgress} where ${userContentProgress.score} is not null and ${userContentProgress.lastActivityAt} between ${trendFrom} and ${trendTo}), 0) as "averageSuccess",
            (select count(*)::int from ${challengeParticipants} where ${challengeParticipants.joinedAt} between ${trendFrom} and ${trendTo}) as "challengeParticipations",
            coalesce((select sum(${rewardLedger.xp})::int from ${rewardLedger} where ${rewardLedger.createdAt} between ${trendFrom} and ${trendTo}), 0) as "xpEarned",
            (select count(*)::int from ${userBadges} where ${userBadges.grantedAt} between ${trendFrom} and ${trendTo} and ${userBadges.revokedAt} is null) as "badgesGranted",
            (select count(*)::int from ${promotionRuleExecutions} where ${promotionRuleExecutions.executedAt} between ${trendFrom} and ${trendTo}) as promotions
            ,coalesce((select round(sum(coalesce(${userActivities.durationSeconds}, 0))::numeric / nullif(count(distinct ${userActivities.userId}), 0) / 60, 1) from ${userActivities} where ${userActivities.createdAt} between ${trendFrom} and ${trendTo}), 0)::float as "averageUsageMinutes"
        `),
      ),
      executeWhen(section === 'statistics', () =>
        db.execute<{
          id: string
          name: string
          learners: number
          completions: number
          averageProgress: number
        }>(sql`
          select s.id, s.name,
            count(distinct p."userId")::int as learners,
            count(*) filter (where p.status = 'completed')::int as completions,
            coalesce(round(avg(p.progress)), 0)::int as "averageProgress"
          from "educationalSections" s
          left join "sectionContents" c on c."sectionId" = s.id and c."deletedAt" is null
          left join "userContentProgress" p on p."contentId" = c.id and p."lastActivityAt" between ${trendFrom} and ${trendTo}
          where s."deletedAt" is null
          group by s.id order by learners desc, completions desc limit 20
        `),
      ),
      executeWhen(section === 'statistics', () =>
        db.execute<{ id: number | null; name: string; users: number }>(sql`
          select l.id, coalesce(l.name, 'بلا مستوى') as name, count(u.id)::int as users
          from "user" u left join "userAdminProfiles" p on p."userId" = u.id
          left join levels l on l.id = p."levelId"
          where u."deletedAt" is null
          group by l.id, l.name order by users desc
        `),
      ),
      executeWhen(section === 'statistics', () =>
        db.execute<{
          id: string
          title: string
          sectionName: string
          completions: number
          averageScore: number
        }>(sql`
          select c.id, c.title, s.name as "sectionName",
            count(*) filter (where p.status = 'completed')::int as completions,
            coalesce(round(avg(p.score)), 0)::int as "averageScore"
          from "sectionContents" c inner join "educationalSections" s on s.id = c."sectionId"
          left join "userContentProgress" p on p."contentId" = c.id and p."lastActivityAt" between ${trendFrom} and ${trendTo}
          where c."deletedAt" is null
          group by c.id, s.name order by completions desc limit 20
        `),
      ),
    ])
  const [archivedSections, archivedContents] = await Promise.all([
    selectWhen(section === 'sections', () =>
      db
        .select()
        .from(educationalSections)
        .where(sql`${educationalSections.deletedAt} is not null`)
        .orderBy(desc(educationalSections.updatedAt))
        .limit(200),
    ),
    selectWhen(section === 'content', () =>
      db
        .select()
        .from(sectionContents)
        .where(sql`${sectionContents.deletedAt} is not null`)
        .orderBy(desc(sectionContents.updatedAt))
        .limit(500),
    ),
  ])

  return {
    dashboard: dashboardResult[0],
    trend: trendResult,
    comparison: comparisonResult[0] ?? { current: 0, previous: 0 },
    users: {
      rows: userRows,
      total: totalRows[0]?.total ?? 0,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil((totalRows[0]?.total ?? 0) / pageSize)),
    },
    sections: sectionRows,
    contents: contentRows,
    challenges: challengeRows,
    competitions: competitionRows,
    competitionCategories: competitionCategoryRows,
    competitionParticipants: competitionParticipantRows,
    platformCategories: platformCategoryRows,
    mathSections: mathSectionRows,
    levels: levelRows,
    rules: ruleRows,
    ruleExecutions: ruleExecutionRows,
    badges: badgeRows,
    siteContent: siteRows,
    siteContentVersions: siteVersionRows,
    media: mediaRows,
    mediaPagination: {
      total: mediaTotalRows[0]?.total ?? mediaRows.length,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil((mediaTotalRows[0]?.total ?? mediaRows.length) / pageSize)),
    },
    statistics: {
      summary: statisticsSummaryRows[0] ?? null,
      sections: sectionStatisticRows,
      levels: levelDistributionRows,
      contents: contentStatisticRows,
      from: trendFrom,
      to: trendTo,
    },
    audits: auditRows,
    notes: noteRows,
    latestActivities,
    latestBadgeGrants,
    challengeLeaders,
    challengeParticipants: challengeParticipantRows,
    achievements: achievementRows,
    settings: settingRows[0]?.value ?? null,
    archivedSections,
    archivedContents,
  }
}
