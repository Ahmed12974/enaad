'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[ui:error]', error.digest ?? 'unclassified')
  }, [error.digest])

  return (
    <main className="verification-page" dir="rtl">
      <section className="auth-card" role="alert">
        <h1>تعذر إكمال الطلب</h1>
        <p>حدث خطأ غير متوقع. لم تُعرض أي تفاصيل تقنية حفاظًا على أمان بياناتك.</p>
        <button type="button" onClick={reset}>
          إعادة المحاولة
        </button>
      </section>
    </main>
  )
}
