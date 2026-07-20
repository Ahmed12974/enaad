'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, KeyRound, MailCheck, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { authClient } from '@/lib/auth-client'
import {
  consumePasswordReset,
  removeRecoveryEmail,
  requestPasswordReset,
  requestRecoveryEmailVerification,
  verifyRecoveryEmail,
} from '@/app/account/actions'

type Result = { ok: boolean; message: string } | null

function ResultAlert({ result }: { result: Result }) {
  if (!result) return null
  return (
    <Alert variant={result.ok ? 'default' : 'destructive'}>
      {result.ok ? <CheckCircle2 /> : <ShieldCheck />}
      <AlertTitle>{result.ok ? 'تمت العملية' : 'تعذر إكمال العملية'}</AlertTitle>
      <AlertDescription>{result.message}</AlertDescription>
    </Alert>
  )
}

export function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setResult(null)
    const identifier = String(new FormData(event.currentTarget).get('identifier') || '')
    try {
      setResult(await requestPasswordReset(identifier))
    } catch {
      setResult({ ok: false, message: 'تعذر إرسال الطلب الآن. حاول لاحقًا.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <RecoveryLayout
      icon={KeyRound}
      title="استعادة حسابك"
      description="أدخل بريدك الأساسي أو البريد الاحتياطي المؤكد."
    >
      <form onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="identifier">البريد الإلكتروني</FieldLabel>
            <Input
              id="identifier"
              name="identifier"
              type="email"
              required
              dir="ltr"
              placeholder="name@example.com"
              autoComplete="email"
            />
            <FieldDescription>لن نكشف ما إذا كان البريد مسجلًا حفاظًا على خصوصية الحساب.</FieldDescription>
          </Field>
          <ResultAlert result={result} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'جارٍ الإرسال...' : 'إرسال رابط الاسترداد'}
          </Button>
        </FieldGroup>
      </form>
    </RecoveryLayout>
  )
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result>(null)
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setResult(null)
    const data = new FormData(event.currentTarget),
      password = String(data.get('password') || ''),
      confirm = String(data.get('confirm') || '')
    if (password !== confirm) {
      setResult({ ok: false, message: 'كلمتا المرور غير متطابقتين.' })
      setBusy(false)
      return
    }
    try {
      const response = await consumePasswordReset(token, password)
      setResult(response)
      if (response.ok) setTimeout(() => router.push('/sign-in'), 1200)
    } catch {
      setResult({ ok: false, message: 'تعذر تغيير كلمة المرور الآن. حاول لاحقًا.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <RecoveryLayout
      icon={ShieldCheck}
      title="كلمة مرور جديدة"
      description="اختر كلمة مرور قوية ومختلفة عن كلمات مرورك السابقة."
    >
      <form onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="password">كلمة المرور الجديدة</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              minLength={10}
              maxLength={128}
              required
              dir="ltr"
              autoComplete="new-password"
            />
            <FieldDescription>من 10 إلى 128 حرفًا.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="confirm">تأكيد كلمة المرور</FieldLabel>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              minLength={10}
              maxLength={128}
              required
              dir="ltr"
              autoComplete="new-password"
            />
          </Field>
          <ResultAlert result={result} />
          <Button type="submit" disabled={busy || !token} className="w-full">
            {busy ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور'}
          </Button>
        </FieldGroup>
      </form>
    </RecoveryLayout>
  )
}

export function RecoveryEmailForm({
  primaryEmail,
  primaryVerified,
  verificationEnabled,
  initialEmail,
  verified,
}: {
  primaryEmail: string
  primaryVerified: boolean
  verificationEnabled: boolean
  initialEmail: string | null
  verified: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const [verificationBusy, setVerificationBusy] = useState(false)
  const [verificationResult, setVerificationResult] = useState<Result>(null)

  async function resendPrimaryVerification() {
    if (verificationBusy || primaryVerified || !verificationEnabled) return
    setVerificationBusy(true)
    setVerificationResult(null)
    try {
      const response = await authClient.sendVerificationEmail({
        email: primaryEmail,
        callbackURL: '/account',
      })
      setVerificationResult(
        response.error
          ? { ok: false, message: 'تعذر إرسال رسالة التأكيد الآن. حاول لاحقًا.' }
          : { ok: true, message: 'أرسلنا رسالة تأكيد جديدة إلى بريد تسجيل الدخول.' },
      )
    } catch {
      setVerificationResult({ ok: false, message: 'تعذر إرسال رسالة التأكيد الآن. حاول لاحقًا.' })
    } finally {
      setVerificationBusy(false)
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setResult(null)
    const email = String(new FormData(event.currentTarget).get('email') || '')
    try {
      const response = await requestRecoveryEmailVerification(email)
      setResult(response)
      router.refresh()
    } catch {
      setResult({ ok: false, message: 'تعذر إرسال رسالة التأكيد الآن.' })
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    setBusy(true)
    try {
      const response = await removeRecoveryEmail()
      setResult(response)
      router.refresh()
    } catch {
      setResult({ ok: false, message: 'تعذر حذف البريد الاحتياطي.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="account-page">
      <section className="account-intro">
        <p className="eyebrow">أمان الحساب</p>
        <h1 className="text-balance">أضف طريقًا آخر للعودة إلى حسابك</h1>
        <p>البريد الاحتياطي اختياري، ولا يمكن استخدامه في الاسترداد إلا بعد تأكيده.</p>
      </section>
      <Card className="account-card">
        <CardHeader>
          <div className="account-icon">
            <ShieldCheck />
          </div>
          <CardTitle>بريد تسجيل الدخول</CardTitle>
          <CardDescription dir="ltr">{primaryEmail}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <p>{primaryVerified ? 'البريد مؤكد.' : 'البريد غير مؤكد بعد.'}</p>
            {!primaryVerified && !verificationEnabled && (
              <FieldDescription>
                تأكيد البريد غير مطلوب حاليًا، وخدمة إرسال الرسائل غير مهيأة.
              </FieldDescription>
            )}
            <ResultAlert result={verificationResult} />
            {!primaryVerified && verificationEnabled && (
              <Button type="button" disabled={verificationBusy} onClick={resendPrimaryVerification}>
                {verificationBusy ? 'جارٍ الإرسال...' : 'إعادة إرسال رسالة التأكيد'}
              </Button>
            )}
          </FieldGroup>
        </CardContent>
      </Card>
      <Card className="account-card">
        <CardHeader>
          <div className="account-icon">
            <MailCheck />
          </div>
          <CardTitle>البريد الإلكتروني الاحتياطي</CardTitle>
          <CardDescription>
            {initialEmail
              ? verified
                ? 'هذا البريد مؤكد وجاهز للاسترداد.'
                : 'هذا البريد بانتظار التأكيد.'
              : 'أضف بريدًا مختلفًا عن بريد تسجيل الدخول.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="recovery-email">البريد الاحتياطي</FieldLabel>
                <Input
                  id="recovery-email"
                  name="email"
                  type="email"
                  required
                  dir="ltr"
                  defaultValue={initialEmail || ''}
                  placeholder="backup@example.com"
                  autoComplete="email"
                />
                <FieldDescription>سنرسل رابط تأكيد صالحًا لمدة 30 دقيقة.</FieldDescription>
              </Field>
              <ResultAlert result={result} />
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'جارٍ الإرسال...' : verified ? 'تغيير البريد وإعادة التأكيد' : 'إرسال رابط التأكيد'}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
        {initialEmail && (
          <CardFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={remove}>
              <Trash2 data-icon="inline-start" /> حذف البريد الاحتياطي
            </Button>
          </CardFooter>
        )}
      </Card>
    </main>
  )
}

export function VerifyRecoveryEmailForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result>(
    token ? null : { ok: false, message: 'رابط التأكيد غير مكتمل.' },
  )
  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!token || busy) return
    setBusy(true)
    setResult(null)
    try {
      setResult(await verifyRecoveryEmail(token))
    } catch {
      setResult({ ok: false, message: 'تعذر تأكيد البريد الآن. حاول مرة أخرى.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="verification-page">
      <Card className="recovery-card">
        <CardHeader>
          <div className="account-icon">
            <MailCheck />
          </div>
          <CardTitle>تأكيد البريد الاحتياطي</CardTitle>
          <CardDescription>
            اضغط الزر بنفسك لإتمام التأكيد؛ فتح الرابط وحده لا يغيّر بيانات حسابك.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={confirm} className="form-stack">
            <ResultAlert result={result} />
            <Button type="submit" disabled={busy || !token} className="w-full">
              {busy ? 'جارٍ التأكيد...' : 'تأكيد البريد الآن'}
            </Button>
          </form>
        </CardContent>
        <CardFooter>
          <a href="/account">العودة إلى إعدادات الحساب</a>
        </CardFooter>
      </Card>
    </main>
  )
}

function RecoveryLayout({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof KeyRound
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <main className="recovery-page">
      <section className="recovery-copy">
        <div className="brand-mark">لُ</div>
        <p className="eyebrow">لُغتي • حماية رحلتك التعليمية</p>
        <h1 className="text-balance">حسابك آمن، وطريق العودة واضح.</h1>
        <p>روابط قصيرة العمر، استخدام واحد، وخصوصية لا تكشف بيانات حسابك.</p>
      </section>
      <Card className="recovery-card">
        <CardHeader>
          <div className="account-icon">
            <Icon />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
        <CardFooter>
          <a href="/sign-in">العودة إلى تسجيل الدخول</a>
        </CardFooter>
      </Card>
    </main>
  )
}
