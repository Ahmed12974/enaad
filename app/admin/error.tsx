'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Admin route failed', { digest: error.digest })
  }, [error])
  return (
    <main className="admin-console" dir="rtl">
      <section className="admin-error-state" role="alert">
        <h1>تعذر تحميل لوحة التحكم</h1>
        <p>حدث خطأ غير متوقع. لم تُحفظ أي عملية غير مكتملة.</p>
        {error.digest && <small dir="ltr">Error ID: {error.digest}</small>}
        <Button onClick={reset}>إعادة المحاولة</Button>
      </section>
    </main>
  )
}
