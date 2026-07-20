import { notFound } from 'next/navigation'
import { AdminChallengeDetail } from '@/components/admin/admin-challenge-detail'
import { getAdminChallengeDetail, getChallengeEditorOptions } from '@/lib/admin-challenges'

export default async function AdminChallengePage({
  params,
  searchParams,
}: {
  params: Promise<{ challengeId: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const [{ challengeId: value }, query] = await Promise.all([params, searchParams])
  const challengeId = Number(value)
  if (!Number.isInteger(challengeId) || challengeId <= 0) notFound()
  const [data, options] = await Promise.all([
    getAdminChallengeDetail(challengeId, Number(query.page ?? 1)),
    getChallengeEditorOptions(),
  ])
  if (!data) notFound()
  return <AdminChallengeDetail data={data} options={options} />
}
