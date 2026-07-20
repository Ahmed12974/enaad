'use client'

import type { FormEvent } from 'react'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { createSectionContent, updateSectionContent } from '@/app/admin/actions'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { getAdminContentEditorData } from '@/lib/admin-content'

type Data = Awaited<ReturnType<typeof getAdminContentEditorData>>

export function ContentEditor({ data }: { data: Data }) {
  const item = data.current
  const body = item?.body ?? {}
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    startTransition(async () => {
      try {
        setResult(item ? await updateSectionContent(item.id, form) : await createSectionContent(form))
      } catch (error) {
        setResult({ ok: false, message: error instanceof Error ? error.message : 'تعذر حفظ المحتوى.' })
      }
    })
  }
  return (
    <main className="admin-console" dir="rtl">
      <nav className="admin-breadcrumb">
        <Link href="/admin/content">المحتوى</Link>
        <span>/</span>
        <b>{item ? 'تعديل' : 'جديد'}</b>
      </nav>
      <Card>
        <CardHeader>
          <CardTitle>{item ? `تعديل ${item.title}` : 'إنشاء محتوى'}</CardTitle>
          <CardDescription>المتطلبات المتعددة تُفحص على الخادم لمنع الربط بالنفس أو الدورات.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="admin-form" onSubmit={submit}>
            <div className="admin-form-grid">
              <select name="sectionId" required defaultValue={item?.sectionId ?? ''} aria-label="القسم">
                <option value="" disabled>
                  اختر القسم
                </option>
                {data.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
              <select name="parentId" defaultValue={item?.parentId ?? ''} aria-label="العنصر الأب">
                <option value="">بلا عنصر أب</option>
                {data.contents
                  .filter((content) => content.id !== item?.id)
                  .map((content) => (
                    <option key={content.id} value={content.id}>
                      {content.title}
                    </option>
                  ))}
              </select>
              <select name="kind" defaultValue={item?.kind ?? 'lesson'} aria-label="النوع">
                {[
                  'unit',
                  'level',
                  'lesson',
                  'quiz',
                  'question',
                  'activity',
                  'story',
                  'file',
                  'image',
                  'video',
                  'instruction',
                ].map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
              <select name="mediaId" defaultValue={item?.mediaId ?? ''} aria-label="ملف الوسائط">
                <option value="">بدون ملف</option>
                {data.media.map((media) => (
                  <option key={media.id} value={media.id}>
                    {media.name} ({media.mediaType})
                  </option>
                ))}
              </select>
              <Input name="title" required minLength={2} defaultValue={item?.title} placeholder="العنوان" />
              <Input
                name="slug"
                required
                dir="ltr"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                defaultValue={item?.slug}
                placeholder="content-slug"
              />
              <Input
                name="targetLevel"
                defaultValue={item?.targetLevel ?? ''}
                placeholder="المستوى المستهدف"
              />
              <Input
                name="points"
                type="number"
                min="0"
                defaultValue={item?.points ?? 0}
                placeholder="النقاط"
              />
              <Input
                name="passingScore"
                type="number"
                min="0"
                max="100"
                defaultValue={item?.passingScore ?? ''}
                placeholder="نسبة النجاح"
              />
              <Input
                name="sortOrder"
                type="number"
                min="0"
                defaultValue={item?.sortOrder ?? 0}
                placeholder="الترتيب"
              />
              <select name="status" defaultValue={item?.status ?? 'draft'} aria-label="الحالة">
                <option value="draft">مسودة</option>
                <option value="scheduled">مجدول</option>
                <option value="published">منشور</option>
                <option value="archived">مؤرشف</option>
              </select>
              <Input
                name="scheduledAt"
                type="datetime-local"
                defaultValue={item?.status === 'scheduled' ? localDate(item.publishedAt) : ''}
                aria-label="موعد النشر المجدول"
              />
            </div>
            <Textarea name="summary" defaultValue={item?.summary ?? ''} placeholder="الملخص" />
            <Textarea
              name="contentText"
              defaultValue={bodyText(body.text)}
              placeholder="نص الدرس أو القصة أو المادة التعليمية"
            />
            <Textarea
              name="instructions"
              defaultValue={bodyText(body.instructions)}
              placeholder="تعليمات المتعلم"
            />
            <div className="admin-form-grid">
              <Input
                name="estimatedMinutes"
                type="number"
                min="0"
                defaultValue={bodyNumber(body.estimatedMinutes, 0)}
                placeholder="المدة التقديرية بالدقائق"
              />
              <Input
                name="maxAttempts"
                type="number"
                min="0"
                defaultValue={bodyNumber(body.maxAttempts, 0)}
                placeholder="الحد الأقصى للمحاولات (0 بلا حد)"
              />
              <select
                name="questionType"
                defaultValue={bodyText(body.questionType) || 'multiple_choice'}
                aria-label="نوع السؤال"
              >
                <option value="multiple_choice">اختيار متعدد</option>
                <option value="true_false">صحيح أو خطأ</option>
                <option value="short_answer">إجابة قصيرة</option>
              </select>
              <Input
                name="correctAnswer"
                defaultValue={bodyText(body.correctAnswer)}
                placeholder="الإجابة الصحيحة"
              />
            </div>
            <Textarea
              name="questionPrompt"
              defaultValue={bodyText(body.questionPrompt)}
              placeholder="نص السؤال — مطلوب عندما يكون النوع Question"
            />
            <Textarea
              name="answerOptions"
              defaultValue={bodyArray(body.answerOptions).join('\n')}
              placeholder="خيارات الإجابة، خيار واحد في كل سطر"
            />
            <Textarea
              name="answerExplanation"
              defaultValue={bodyText(body.answerExplanation)}
              placeholder="شرح الإجابة"
            />
            <label>
              المتطلبات السابقة
              <select
                name="prerequisiteIds"
                multiple
                defaultValue={data.prerequisiteIds}
                size={Math.min(8, Math.max(3, data.contents.length))}
              >
                {data.contents
                  .filter((content) => content.id !== item?.id)
                  .map((content) => (
                    <option key={content.id} value={content.id}>
                      {content.title}
                    </option>
                  ))}
              </select>
            </label>
            {result && (
              <Alert variant={result.ok ? 'default' : 'destructive'}>
                <AlertDescription>{result.message}</AlertDescription>
              </Alert>
            )}
            <div className="admin-row">
              <Button disabled={pending}>{pending ? 'جارٍ الحفظ...' : 'حفظ المحتوى'}</Button>
              {item && (
                <Button variant="outline" render={<Link href={`/admin/content/${item.id}/preview`} />}>
                  معاينة
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

function bodyText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function localDate(value: Date | null) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function bodyNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bodyArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
