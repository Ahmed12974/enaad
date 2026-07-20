import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdminSiteContent } from '@/lib/admin-cms'

export default async function AdminCmsPreviewPage({ params }: { params: Promise<{ contentId: string }> }) {
  const { contentId } = await params
  const data = await getAdminSiteContent(contentId)
  if (!data) notFound()
  const content = data.item.content
  const heading = text(content.heading)
  const body = text(content.text)
  const secondaryText = text(content.secondaryText)
  const imageMediaId = text(content.imageMediaId)
  const buttonText = text(content.buttonText)
  const buttonUrl = safeHref(text(content.buttonUrl))
  const secondaryButtonText = text(content.secondaryButtonText)
  const secondaryButtonUrl = safeHref(text(content.secondaryButtonUrl))
  return (
    <main className="admin-console" dir="rtl">
      <nav className="admin-breadcrumb" aria-label="مسار التنقل">
        <Link href="/admin/cms">CMS</Link>
        <span>/</span>
        <b>معاينة {data.item.title || data.item.key}</b>
      </nav>
      <header className="admin-console-header">
        <div>
          <p className="eyebrow">معاينة قبل النشر</p>
          <h1>{data.item.title || data.item.key}</h1>
          <p>
            النوع: {text(content.type) || 'general'} · النسخة {data.item.version} · {data.item.status}
          </p>
        </div>
      </header>
      <Card className={`cms-preview cms-preview-${text(content.styleVariant) || 'default'}`}>
        {imageMediaId && (
          <Image
            unoptimized
            width={1200}
            height={500}
            src={`/api/admin/media?id=${encodeURIComponent(imageMediaId)}`}
            alt={heading || data.item.title || 'صورة المحتوى'}
            className="admin-media-preview"
          />
        )}
        <CardHeader>
          <CardTitle>{heading || 'بدون عنوان ظاهر'}</CardTitle>
          <CardDescription>{secondaryText}</CardDescription>
        </CardHeader>
        <CardContent className="admin-stack">
          <p>{body}</p>
          <div className="admin-row">
            {buttonText && buttonUrl && <Button render={<Link href={buttonUrl} />}>{buttonText}</Button>}
            {secondaryButtonText && secondaryButtonUrl && (
              <Button variant="outline" render={<Link href={secondaryButtonUrl} />}>
                {secondaryButtonText}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function safeHref(value: string) {
  return value.startsWith('/') || /^https:\/\/[a-z0-9.-]+(?:\/|$)/i.test(value) ? value : ''
}
