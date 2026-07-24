'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function QuizError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[quiz:error]', { digest: error.digest ?? 'unclassified' })
  }, [error.digest])

  return (
    <main className="verification-page" dir="rtl">
      <section className="auth-card" role="alert">
        <h1>تعذر فتح الاختبار</h1>
        <p>لم نتمكن من تحميل بنك أسئلتك الآن. لم يتم إنشاء محاولة أو خصم أي مكافأة.</p>
        {error.digest && <small dir="ltr">Error ID: {error.digest}</small>}
        <div className="hero-actions">
          <Button type="button" onClick={reset}>
            إعادة المحاولة
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/words" />}>
            العودة إلى الكلمات
          </Button>
        </div>
      </section>
    </main>
  )
}
