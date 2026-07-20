import { notFound } from 'next/navigation'
import { AdminBadgeDetail } from '@/components/admin/admin-badge-detail'
import { getAdminBadgeDetail } from '@/lib/admin-badges'

export default async function AdminBadgePage({
  params,
  searchParams,
}: {
  params: Promise<{ badgeId: string }>
  searchParams: Promise<{ page?: string; search?: string; status?: 'all' | 'active' | 'revoked' }>
}) {
  const [{ badgeId }, query] = await Promise.all([params, searchParams])
  const data = await getAdminBadgeDetail(badgeId, {
    page: Number(query.page ?? 1),
    search: query.search,
    status: query.status ?? 'all',
  })
  if (!data) notFound()
  return <AdminBadgeDetail data={data} />
}
