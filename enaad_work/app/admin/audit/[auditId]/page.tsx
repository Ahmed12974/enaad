import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdminAuditDetail } from '@/lib/admin-audit-query'
export default async function AuditDetailPage({ params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params
  const data = await getAdminAuditDetail(auditId)
  if (!data) notFound()
  const item = data.audit
  return (
    <main className="admin-console" dir="rtl">
      <nav className="admin-breadcrumb">
        <Link href="/admin/audit">سجل العمليات</Link>
        <span>/</span>
        <b>{item.action}</b>
      </nav>
      <Card>
        <CardHeader>
          <CardTitle>{item.action}</CardTitle>
          <CardDescription>
            {item.entityType}
            {item.entityId ? ` · ${item.entityId}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="admin-stack">
          <dl className="admin-metric-list">
            <div className="admin-metric">
              <span>المدير</span>
              <b>{data.actorName || data.actorEmail || 'نظام'}</b>
            </div>
            <div className="admin-metric">
              <span>السبب</span>
              <b>{item.reason || '—'}</b>
            </div>
            <div className="admin-metric">
              <span>Request ID</span>
              <b dir="ltr">{item.requestId || '—'}</b>
            </div>
            <div className="admin-metric">
              <span>IP Hash</span>
              <b dir="ltr">{item.ipHash || '—'}</b>
            </div>
            <div className="admin-metric">
              <span>User Agent</span>
              <b dir="ltr">{item.userAgent || '—'}</b>
            </div>
          </dl>
          <div className="admin-two-column">
            <section>
              <h2>قبل</h2>
              <pre dir="ltr">{JSON.stringify(item.before ?? {}, null, 2)}</pre>
            </section>
            <section>
              <h2>بعد</h2>
              <pre dir="ltr">{JSON.stringify(item.after ?? {}, null, 2)}</pre>
            </section>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
