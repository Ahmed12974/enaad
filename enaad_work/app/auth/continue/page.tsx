import { redirect } from 'next/navigation'
import { landingPathForRole } from '@/lib/admin'
import { getCurrentUser, isAllowedAdministrator } from '@/lib/auth-session'

export default async function ContinueAfterAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const current = await getCurrentUser()
  if (!current) redirect('/sign-in')
  if (current.banned) redirect('/account-suspended')
  const { next } = await searchParams
  const destinationRole = (await isAllowedAdministrator(current)) ? current.role : 'user'
  redirect(landingPathForRole(destinationRole, next))
}
