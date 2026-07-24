import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { forbidden, redirect } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { getCurrentUser, isAllowedAdministrator, logAdminAccessDenied } from '@/lib/auth-session'

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const current = await getCurrentUser()
  if (!current) redirect('/sign-in?next=/admin')
  if (!(await isAllowedAdministrator(current))) {
    await logAdminAccessDenied(current.id, 'admin-page')
    forbidden()
  }
  return (
    <AppShell name={current.name} isAdmin>
      {children}
    </AppShell>
  )
}
