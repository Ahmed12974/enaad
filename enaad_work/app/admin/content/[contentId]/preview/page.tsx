import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdminContentEditorData } from '@/lib/admin-content'
export default async function PreviewContentPage({ params }: { params: Promise<{ contentId: string }> }) {
  const { contentId } = await params
  const data = await getAdminContentEditorData(contentId)
  const item = data.current
  if (!item) notFound()
  const body = item.body ?? {}
  const text = value(body.text)
  const instructions = value(body.instructions)
  const questionPrompt = value(body.questionPrompt)
  const correctAnswer = value(body.correctAnswer)
  const answerExplanation = value(body.answerExplanation)
  const answerOptions = Array.isArray(body.answerOptions)
    ? body.answerOptions.filter((option): option is string => typeof option === 'string')
    : []
  return (
    <main className="admin-console" dir="rtl">
      <nav className="admin-breadcrumb">
        <Link href="/admin/content">المحتوى</Link>
        <span>/</span>
        <b>المعاينة</b>
      </nav>
      <Card>
        <CardHeader>
          <div className="admin-row">
            <Badge>{item.kind}</Badge>
            <span>{item.points} نقطة</span>
          </div>
          <CardTitle>{item.title}</CardTitle>
          <CardDescription>{item.summary || 'بلا ملخص'}</CardDescription>
        </CardHeader>
        <CardContent className="admin-stack">
          <p>هذه معاينة آمنة للنسخة الحالية قبل النشر.</p>
          {instructions && (
            <section>
              <h2>التعليمات</h2>
              <p>{instructions}</p>
            </section>
          )}
          {text && (
            <section>
              <h2>المحتوى</h2>
              <p>{text}</p>
            </section>
          )}
          {questionPrompt && (
            <section>
              <h2>{questionPrompt}</h2>
              {answerOptions.length > 0 && (
                <ol>
                  {answerOptions.map((option) => (
                    <li key={option}>{option}</li>
                  ))}
                </ol>
              )}
              <details>
                <summary>الإجابة والشرح</summary>
                <p>{correctAnswer}</p>
                {answerExplanation && <p>{answerExplanation}</p>}
              </details>
            </section>
          )}
          {!text && !instructions && !questionPrompt && (
            <p className="admin-empty">لا يحتوي العنصر على نص بعد.</p>
          )}
          <Button variant="outline" render={<Link href={`/admin/content/${item.id}/edit`} />}>
            العودة إلى التحرير
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}

function value(input: unknown) {
  return typeof input === 'string' ? input : ''
}
