import { notFound } from 'next/navigation'
import { AdminUserDetail } from '@/components/admin/admin-user-detail'
import { getAdminUserDetail } from '@/lib/admin-users'

export default async function AdminUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>
  searchParams: Promise<{ progressPage?: string }>
}) {
  const { userId } = await params
  const query = await searchParams
  const data = await getAdminUserDetail(userId, Number(query.progressPage || 1))
  if (!data) notFound()
  return <AdminUserDetail data={data} />
}
