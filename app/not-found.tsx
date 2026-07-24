import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="verification-page" dir="rtl">
      <section className="auth-card">
        <h1>الصفحة غير موجودة</h1>
        <p>قد يكون الرابط قديمًا أو لا تملك صلاحية فتح المورد المطلوب.</p>
        <Link href="/">العودة إلى الصفحة الرئيسية</Link>
      </section>
    </main>
  )
}
