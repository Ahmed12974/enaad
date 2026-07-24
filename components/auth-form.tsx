'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { getArabicAuthError } from '@/lib/auth-messages'
import { normalizeEmail } from '@/lib/normalization'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SITE_NAME } from '@/lib/brand'

export function AuthForm({
  signup = false,
  nextPath,
  registrationEnabled = true,
  siteName = SITE_NAME,
}: {
  signup?: boolean
  nextPath?: string
  registrationEnabled?: boolean
  siteName?: string
}) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const form = event.currentTarget
    const data = new FormData(form)
    const email = normalizeEmail(String(data.get('email') ?? ''))
    const password = String(data.get('password') ?? '')
    const name = String(data.get('name') ?? '').trim()

    setBusy(true)
    setError('')
    try {
      const response = signup
        ? await authClient.signUp.email({ email, password, name })
        : await authClient.signIn.email({ email, password, rememberMe: true })

      if (response.error) {
        setError(getArabicAuthError(response.error, signup ? 'sign-up' : 'sign-in'))
        return
      }

      const next = nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''
      router.replace(`/auth/continue${next}`)
      router.refresh()
    } catch {
      setError('تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت ثم حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-copy">
        <div className="brand-mark">ز</div>
        <p className="eyebrow">{siteName} • حصيلتك بين يديك</p>
        <h1>
          كل كلمة تتعلمها
          <br />
          تفتح لك بابًا جديدًا.
        </h1>
        <p>احفظ كلماتك، راجعها بذكاء، واختبر تقدمك في مكان واحد صُمم للعربية.</p>
      </section>
      <Card className="auth-card">
        <CardHeader>
          <CardTitle>{signup ? 'أنشئ حسابك' : 'مرحبًا بعودتك'}</CardTitle>
          <CardDescription>
            {signup ? 'ابدأ في بناء حصيلتك اليوم' : 'أكمل رحلة التعلّم من حيث توقفت'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {signup && !registrationEnabled ? (
            <div className="form-stack" role="status">
              <p className="error">إنشاء الحسابات الجديدة متوقف مؤقتًا بواسطة إدارة المنصة.</p>
              <a href="/sign-in">لديك حساب بالفعل؟ سجّل الدخول</a>
            </div>
          ) : (
            <form
              onSubmit={submit}
              className="form-stack"
              aria-describedby={error ? 'auth-error' : undefined}
            >
              {signup && (
                <label htmlFor="name">
                  الاسم
                  <Input
                    id="name"
                    name="name"
                    required
                    minLength={2}
                    maxLength={100}
                    autoComplete="name"
                    placeholder="اسمك"
                    disabled={busy}
                  />
                </label>
              )}
              <label htmlFor="email">
                البريد الإلكتروني
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  maxLength={320}
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="name@example.com"
                  dir="ltr"
                  disabled={busy}
                />
              </label>
              <label htmlFor="password">
                كلمة المرور
                <Input
                  id="password"
                  name="password"
                  type="password"
                  minLength={10}
                  maxLength={128}
                  required
                  autoComplete={signup ? 'new-password' : 'current-password'}
                  placeholder="••••••••••"
                  dir="ltr"
                  disabled={busy}
                />
              </label>
              {!signup && (
                <a href="/forgot-password" className="forgot-link">
                  نسيت كلمة المرور؟
                </a>
              )}
              {error && (
                <p id="auth-error" className="error" role="alert" aria-live="assertive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={busy} aria-busy={busy} className="w-full">
                {busy ? 'جارٍ التحقق...' : signup ? 'إنشاء الحساب' : 'تسجيل الدخول'}
              </Button>
              {(signup || registrationEnabled) && (
                <a href={signup ? '/sign-in' : '/sign-up'}>
                  {signup ? 'لديك حساب؟ سجّل الدخول' : 'ليس لديك حساب؟ أنشئ حسابًا'}
                </a>
              )}
              {!signup && !registrationEnabled && (
                <p>التسجيل الجديد متوقف حاليًا، ويمكن للمستخدمين الحاليين تسجيل الدخول بصورة طبيعية.</p>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
