import { VerifyRecoveryEmailForm } from '@/components/recovery-forms'

export default async function VerifyRecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token = '' } = await searchParams
  return <VerifyRecoveryEmailForm token={token} />
}
