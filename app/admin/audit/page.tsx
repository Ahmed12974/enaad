import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getAdminAuditPage } from '@/lib/admin-audit-query'

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const query = await searchParams
  const outcome = ['success', 'failure', 'denied'].includes(query.outcome ?? '')
    ? (query.outcome as 'success' | 'failure' | 'denied')
    : undefined
  const data = await getAdminAuditPage({ ...query, outcome, page: Number(query.page || 1) })
  const href = (page: number) => {
    const params = new URLSearchParams(
      Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])),
    )
    params.set('page', String(page))
    return `/admin/audit?${params}`
  }
  return (
    <main className="admin-console" dir="rtl">
      <nav className="admin-breadcrumb">
        <Link href="/admin">لوحة التحكم</Link>
        <span>/</span>
        <b>سجل العمليات</b>
      </nav>
      <Card>
        <CardHeader>
          <CardTitle>سجل العمليات الإدارية</CardTitle>
          <CardDescription>قراءة فقط، مع فلاتر وبحث وصفحة تفاصيل للبيانات قبل وبعد.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="admin-filter-form">
            <Input aria-label="العملية أو العنصر أو السبب" name="search" defaultValue={query.search} placeholder="العملية أو العنصر أو السبب" />
            <Input aria-label="نوع العملية" name="action" defaultValue={query.action} placeholder="نوع العملية" />
            <Input aria-label="نوع العنصر" name="entityType" defaultValue={query.entityType} placeholder="نوع العنصر" />
            <select name="outcome" defaultValue={query.outcome ?? ''} aria-label="نتيجة العملية">
              <option value="">كل النتائج</option>
              <option value="success">نجاح</option>
              <option value="failure">فشل</option>
              <option value="denied">وصول مرفوض</option>
            </select>
            <Input name="from" type="date" defaultValue={query.from} aria-label="من" />
            <Input name="to" type="date" defaultValue={query.to} aria-label="إلى" />
            <Button>تطبيق</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>النتائج ({data.total})</CardTitle>
        </CardHeader>
        <CardContent className="admin-table-wrap">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>العملية</th>
                <th>المدير</th>
                <th>العنصر</th>
                <th>السبب</th>
                <th>Request ID</th>
                <th>النتيجة</th>
                <th>الوقت</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link href={`/admin/audit/${item.id}`}>{item.action}</Link>
                  </td>
                  <td>{item.actorName || item.actorEmail || 'نظام'}</td>
                  <td>
                    {item.entityType}
                    {item.entityId ? ` · ${item.entityId}` : ''}
                  </td>
                  <td>{item.reason || '—'}</td>
                  <td dir="ltr">{item.requestId || '—'}</td>
                  <td>{item.outcome}</td>
                  <td>
                    {new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(
                      item.createdAt,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.rows.length && <p className="admin-empty">لا توجد سجلات مطابقة.</p>}
          <div className="admin-row">
            <Button
              variant="outline"
              disabled={data.page <= 1}
              render={<Link href={href(Math.max(1, data.page - 1))} />}
            >
              السابق
            </Button>
            <span>
              {data.page} / {data.pages}
            </span>
            <Button
              variant="outline"
              disabled={data.page >= data.pages}
              render={<Link href={href(Math.min(data.pages, data.page + 1))} />}
            >
              التالي
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
