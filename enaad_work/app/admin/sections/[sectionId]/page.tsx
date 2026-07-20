import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdminSectionDetail } from '@/lib/admin-content'
export default async function AdminSectionDetailPage({ params }: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await params
  const data = await getAdminSectionDetail(sectionId)
  if (!data) notFound()
  return (
    <main className="admin-console" dir="rtl">
      <nav className="admin-breadcrumb">
        <Link href="/admin/sections">الأقسام</Link>
        <span>/</span>
        <b>{data.section.name}</b>
      </nav>
      <header className="admin-console-header">
        <div>
          <p className="eyebrow">تفاصيل القسم</p>
          <h1>{data.section.name}</h1>
          <p>{data.section.fullDescription || data.section.shortDescription || 'بلا وصف'}</p>
        </div>
        <Badge>{data.section.status}</Badge>
      </header>
      {data.section.imageMediaId && (
        <Image
          unoptimized
          width={1280}
          height={720}
          className="admin-media-preview"
          src={`/api/admin/media?id=${encodeURIComponent(data.section.imageMediaId)}`}
          alt={data.section.name}
        />
      )}
      <section className="admin-kpis" aria-label="إحصاءات القسم">
        <Metric label="المتعلمون" value={data.statistics.learners} />
        <Metric label="مرات الإكمال" value={data.statistics.completed} />
        <Metric label="قيد التقدم" value={data.statistics.inProgress} />
        <Metric label="متوسط الإنجاز" value={`${data.statistics.averageProgress}%`} />
        <Metric label="متوسط النجاح" value={`${data.statistics.averageScore}%`} />
        <Metric label="نشاط 30 يومًا" value={data.statistics.recentActivity} />
      </section>
      <div className="admin-card-grid">
        {data.contents.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle>{item.title}</CardTitle>
              <CardDescription>
                {item.kind} · {item.status}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="admin-row">
                <Button variant="outline" render={<Link href={`/admin/content/${item.id}/edit`} />}>
                  تعديل
                </Button>
                <Button variant="outline" render={<Link href={`/admin/content/${item.id}/preview`} />}>
                  معاينة
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {!data.contents.length && <p className="admin-empty">لا يوجد محتوى في هذا القسم.</p>}
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="admin-metric">
        <span>{label}</span>
        <b>{value}</b>
      </CardContent>
    </Card>
  )
}
