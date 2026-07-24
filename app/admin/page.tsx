import { AdminConsole } from '@/components/admin/admin-console'
import { getAdminConsoleData } from '@/lib/admin-console'

export const maxDuration = 300

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams
  const status = single(query.status)
  const sort = single(query.sort)
  const data = await getAdminConsoleData(
    {
      page: Number(single(query.page) || 1),
      pageSize: Number(single(query.pageSize) || 20),
      search: single(query.search),
      status: ['all', 'active', 'disabled', 'suspended', 'banned'].includes(status ?? '')
        ? (status as 'all' | 'active' | 'disabled' | 'suspended' | 'banned')
        : 'all',
      levelId: Number(single(query.levelId) || 0) || undefined,
      from: single(query.from),
      to: single(query.to),
      sort: ['newest', 'oldest', 'name', 'points'].includes(sort ?? '')
        ? (sort as 'newest' | 'oldest' | 'name' | 'points')
        : 'newest',
    },
    'overview',
  )
  return <AdminConsole data={data} section="overview" />
}
