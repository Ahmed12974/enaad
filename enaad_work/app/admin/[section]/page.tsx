import { notFound } from 'next/navigation'
import { AdminConsole } from '@/components/admin/admin-console'
import { adminSections, getAdminConsoleData, type AdminSection } from '@/lib/admin-console'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function presetRange(value: string | undefined) {
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = 86400000
  if (value === 'today') return { from: startToday, to: now }
  if (value === 'yesterday')
    return { from: new Date(startToday.getTime() - day), to: new Date(startToday.getTime() - 1) }
  if (value === 'last7') return { from: new Date(now.getTime() - 6 * day), to: now }
  if (value === 'last30') return { from: new Date(now.getTime() - 29 * day), to: now }
  if (value === 'last90') return { from: new Date(now.getTime() - 89 * day), to: now }
  const weekStart = new Date(startToday.getTime() - ((startToday.getDay() + 6) % 7) * day)
  if (value === 'thisWeek') return { from: weekStart, to: now }
  if (value === 'previousWeek')
    return { from: new Date(weekStart.getTime() - 7 * day), to: new Date(weekStart.getTime() - 1) }
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  if (value === 'thisMonth') return { from: monthStart, to: now }
  if (value === 'previousMonth')
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to: new Date(monthStart.getTime() - 1),
    }
  const yearStart = new Date(now.getFullYear(), 0, 1)
  if (value === 'thisYear') return { from: yearStart, to: now }
  if (value === 'previousYear')
    return { from: new Date(now.getFullYear() - 1, 0, 1), to: new Date(yearStart.getTime() - 1) }
  return null
}

export default async function AdminSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>
  searchParams: SearchParams
}) {
  const { section: rawSection } = await params
  if (rawSection === 'overview' || !adminSections.includes(rawSection as AdminSection)) notFound()
  const section = rawSection as AdminSection
  const query = await searchParams
  const status = single(query.status)
  const sort = single(query.sort)
  const range = presetRange(single(query.range))
  const mediaType = single(query.mediaType)
  const data = await getAdminConsoleData(
    {
      page: Number(single(query.page) || 1),
      pageSize: Number(single(query.pageSize) || 20),
      search: single(query.search),
      status: ['all', 'active', 'disabled', 'suspended', 'banned'].includes(status ?? '')
        ? (status as 'all' | 'active' | 'disabled' | 'suspended' | 'banned')
        : 'all',
      levelId: Number(single(query.levelId) || 0) || undefined,
      verified: ['all', 'verified', 'unverified'].includes(single(query.verified) ?? '')
        ? (single(query.verified) as 'all' | 'verified' | 'unverified')
        : 'all',
      activity: ['all', 'active', 'inactive'].includes(single(query.activity) ?? '')
        ? (single(query.activity) as 'all' | 'active' | 'inactive')
        : 'all',
      sectionId: /^[0-9a-f-]{36}$/i.test(single(query.sectionId) ?? '') ? single(query.sectionId) : undefined,
      badgeId: /^[0-9a-f-]{36}$/i.test(single(query.badgeId) ?? '') ? single(query.badgeId) : undefined,
      challengeId: Number(single(query.challengeId) || 0) || undefined,
      competitionId: Number(single(query.competitionId) || 0) || undefined,
      contentId: /^[0-9a-f-]{36}$/i.test(single(query.contentId) ?? '') ? single(query.contentId) : undefined,
      achievementId: Number(single(query.achievementId) || 0) || undefined,
      activityType: ['all', 'platform.activity', 'reward.earned', 'page.active'].includes(
        single(query.activityType) ?? '',
      )
        ? (single(query.activityType) as 'all' | 'platform.activity' | 'reward.earned' | 'page.active')
        : 'all',
      outcome: ['all', 'completed', 'failed'].includes(single(query.outcome) ?? '')
        ? (single(query.outcome) as 'all' | 'completed' | 'failed')
        : 'all',
      cohort: ['all', 'new', 'existing'].includes(single(query.cohort) ?? '')
        ? (single(query.cohort) as 'all' | 'new' | 'existing')
        : 'all',
      hasNotes: single(query.hasNotes) === '1',
      from: single(query.from) || range?.from.toISOString(),
      to: single(query.to) || range?.to.toISOString(),
      sort: ['newest', 'oldest', 'name', 'points'].includes(sort ?? '')
        ? (sort as 'newest' | 'oldest' | 'name' | 'points')
        : 'newest',
      mediaType: ['all', 'image', 'video', 'audio', 'pdf'].includes(mediaType ?? '')
        ? (mediaType as 'all' | 'image' | 'video' | 'audio' | 'pdf')
        : 'all',
    },
    section,
  )
  return <AdminConsole data={data} section={section} />
}
