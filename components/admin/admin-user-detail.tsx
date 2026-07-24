'use client'

import type { FormEvent, ReactNode } from 'react'
import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  addUserAdminNote,
  adjustUserPoints,
  grantUserBadge,
  grantUserAchievement,
  recordUserViolation,
  resetUserProgress,
  revokeUserBadge,
  setUserLevel,
  updateManagedUserStatus,
  updateUserRole,
} from '@/app/admin/actions'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { getAdminUserDetail } from '@/lib/admin-users'
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog'
import { publicActionError } from '@/lib/public-error'

type Data = NonNullable<Awaited<ReturnType<typeof getAdminUserDetail>>>
type Result = { ok: boolean; message: string }

export function AdminUserDetail({ data }: { data: Data }) {
  const user = data.profile
  return (
    <main className="admin-console" dir="rtl">
      <nav className="admin-breadcrumb" aria-label="مسار التنقل">
        <Link href="/admin">لوحة التحكم</Link>
        <span>/</span>
        <Link href="/admin/users">المستخدمون</Link>
        <span>/</span>
        <b>{user.name}</b>
      </nav>
      <header className="admin-console-header">
        <div>
          <p className="eyebrow">ملف المستخدم</p>
          <h1>{user.name}</h1>
          <p dir="ltr">
            {user.email} · {user.id}
          </p>
        </div>
        <Badge>{user.status ?? (user.banned ? 'banned' : 'active')}</Badge>
      </header>

      <section className="admin-stack" aria-label="البيانات الأساسية">
        <Card>
          <CardHeader>
            <CardTitle>البيانات الأساسية</CardTitle>
          </CardHeader>
          <CardContent className="admin-metric-list">
            <Metric label="البريد" value={user.email} />
            <Metric label="موثق" value={user.emailVerified ? 'نعم' : 'لا'} />
            <Metric label="الصلاحية" value={user.role === 'admin' ? 'مدير' : 'مستخدم'} />
            <Metric label="التسجيل" value={date(user.createdAt)} />
            <Metric label="آخر دخول" value={date(user.lastLoginAt)} />
            <Metric label="آخر نشاط" value={date(user.lastActiveAt)} />
            <Metric label="المستوى" value={user.levelName ?? 'بلا مستوى'} />
            <Metric label="النقاط" value={user.xp ?? 0} />
            <Metric label="العملات" value={user.coins ?? 0} />
            <Metric label="الاستمرار" value={`${user.streak ?? 0} يوم`} />
            <Metric label="المخالفات" value={user.violationCount ?? 0} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>العمليات الإدارية</CardTitle>
            <CardDescription>كل عملية حساسة تتطلب سببًا وتُسجل في سجل التدقيق.</CardDescription>
          </CardHeader>
          <CardContent className="admin-operation-grid">
            <ActionForm
              action={updateUserRole}
              label="تحديث الصلاحية"
              confirmText="تغيير صلاحية هذا الحساب سيُنهي جلساته الحالية. متابعة؟"
            >
              <input type="hidden" name="userId" value={user.id} />
              <select name="role" defaultValue={user.role === 'admin' ? 'admin' : 'user'} aria-label="الصلاحية">
                <option value="user">مستخدم عادي</option>
                <option value="admin">مدير كامل</option>
              </select>
              <Input aria-label="سبب تغيير الصلاحية" name="reason" required minLength={5} placeholder="سبب تغيير الصلاحية" />
            </ActionForm>
            <ActionForm
              action={updateManagedUserStatus}
              label="تحديث الحالة"
              confirmText="تأكيد تغيير حالة الحساب؟"
            >
              <input type="hidden" name="userId" value={user.id} />
              <select name="status" defaultValue={user.status ?? 'active'} aria-label="الحالة">
                <option value="active">نشط</option>
                <option value="disabled">معطل</option>
                <option value="suspended">معلق</option>
                <option value="banned">محظور</option>
              </select>
              <Input name="suspendedUntil" type="datetime-local" aria-label="نهاية التعليق" />
              <Input aria-label="سبب إلزامي" name="reason" required minLength={5} placeholder="سبب إلزامي" />
            </ActionForm>
            <ActionForm action={adjustUserPoints} label="تعديل النقاط" confirmText="تأكيد تعديل النقاط؟">
              <input type="hidden" name="userId" value={user.id} />
              <Input aria-label="+100 أو -50" name="delta" type="number" required placeholder="+100 أو -50" />
              <Input aria-label="السبب" name="reason" required minLength={5} placeholder="السبب" />
            </ActionForm>
            <ActionForm action={setUserLevel} label="تغيير المستوى" confirmText="تأكيد تغيير المستوى؟">
              <input type="hidden" name="userId" value={user.id} />
              <select name="levelId" required defaultValue="" aria-label="المستوى">
                <option value="" disabled>
                  اختر المستوى
                </option>
                {data.levels.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <Input aria-label="السبب" name="reason" required minLength={5} placeholder="السبب" />
            </ActionForm>
            <ActionForm action={addUserAdminNote} label="إضافة ملاحظة">
              <input type="hidden" name="userId" value={user.id} />
              <select name="severity" defaultValue="info" aria-label="الأهمية">
                <option value="info">معلومة</option>
                <option value="warning">تحذير</option>
                <option value="critical">حرجة</option>
              </select>
              <Textarea aria-label="الملاحظة" name="note" required minLength={3} placeholder="الملاحظة" />
            </ActionForm>
            <ActionForm action={recordUserViolation} label="تسجيل مخالفة" confirmText="تأكيد تسجيل المخالفة؟">
              <input type="hidden" name="userId" value={user.id} />
              <Textarea aria-label="وصف المخالفة" name="reason" required minLength={5} placeholder="وصف المخالفة" />
            </ActionForm>
            <ActionForm action={grantUserBadge} label="منح شارة" confirmText="تأكيد منح الشارة؟">
              <input type="hidden" name="userId" value={user.id} />
              <select name="badgeId" required defaultValue="" aria-label="الشارة">
                <option value="" disabled>
                  اختر الشارة
                </option>
                {data.badges.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <Input aria-label="السبب" name="reason" required minLength={5} placeholder="السبب" />
            </ActionForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>التقدم التعليمي ({data.progress.total})</CardTitle>
            <CardDescription>
              صفحة {data.progress.page} من {data.progress.pages}
            </CardDescription>
          </CardHeader>
          <CardContent className="admin-table-wrap">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>القسم</th>
                  <th>المحتوى</th>
                  <th>الحالة</th>
                  <th>الإنجاز</th>
                  <th>النتيجة</th>
                  <th>آخر نشاط</th>
                </tr>
              </thead>
              <tbody>
                {data.progress.rows.map((item) => (
                  <tr key={item.id}>
                    <td>{item.sectionName}</td>
                    <td>{item.contentTitle}</td>
                    <td>{item.status}</td>
                    <td>{item.progress}%</td>
                    <td>{item.score ?? '—'}</td>
                    <td>{date(item.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.progress.rows.length && <p className="admin-empty">لا يوجد تقدم مسجل.</p>}
            <div className="admin-row">
              <Button
                variant="outline"
                disabled={data.progress.page <= 1}
                render={<Link href={`?progressPage=${Math.max(1, data.progress.page - 1)}`} />}
              >
                السابق
              </Button>
              <Button
                variant="outline"
                disabled={data.progress.page >= data.progress.pages}
                render={
                  <Link href={`?progressPage=${Math.min(data.progress.pages, data.progress.page + 1)}`} />
                }
              >
                التالي
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>إعادة تعيين تقدم محدد</CardTitle>
          </CardHeader>
          <CardContent className="admin-operation-grid">
            <ActionForm
              action={resetUserProgress}
              label="إعادة محتوى"
              confirmText="سيُعاد هذا المحتوى فقط. متابعة؟"
            >
              <input type="hidden" name="userId" value={user.id} />
              <select name="contentId" required defaultValue="" aria-label="المحتوى">
                <option value="" disabled>
                  اختر المحتوى
                </option>
                {data.contents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <Input aria-label="السبب" name="reason" required minLength={5} placeholder="السبب" />
            </ActionForm>
            <ActionForm
              action={resetUserProgress}
              label="إعادة قسم"
              confirmText="سيُعاد كل تقدم هذا القسم. متابعة؟"
            >
              <input type="hidden" name="userId" value={user.id} />
              <select name="sectionId" required defaultValue="" aria-label="القسم">
                <option value="" disabled>
                  اختر القسم
                </option>
                {data.sections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <Input aria-label="السبب" name="reason" required minLength={5} placeholder="السبب" />
            </ActionForm>
          </CardContent>
        </Card>

        <div className="admin-two-column">
          <Card>
            <CardHeader>
              <CardTitle>التحديات والمنافسات</CardTitle>
            </CardHeader>
            <CardContent className="admin-list">
              {data.participations.map((item) => (
                <div className="admin-list-row" key={item.id}>
                  <div>
                    <b>{item.title}</b>
                    <span>
                      {item.status} · نتيجة {item.score ?? item.progress} · ترتيب {item.rank ?? '—'}
                    </span>
                  </div>
                  {item.isWinner && <Badge>فائز</Badge>}
                </div>
              ))}
              {!data.participations.length && <p className="admin-empty">لا توجد مشاركات.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>الإنجازات</CardTitle>
            </CardHeader>
            <CardContent className="admin-list">
              <ActionForm
                action={(form) => {
                  form.set('userId', user.id)
                  return grantUserAchievement(form)
                }}
                label="منح إنجاز"
                confirmText="هل تريد منح هذا الإنجاز ومكافأته؟"
              >
                <select name="achievementId" required defaultValue="" aria-label="الإنجاز">
                  <option value="" disabled>
                    اختر الإنجاز
                  </option>
                  {data.availableAchievements.map((achievement) => (
                    <option key={achievement.id} value={achievement.id}>
                      {achievement.name}
                    </option>
                  ))}
                </select>
                <Input aria-label="سبب المنح" name="reason" required minLength={5} placeholder="سبب المنح" />
              </ActionForm>
              {data.achievements.map((item) => (
                <div className="admin-list-row" key={item.id}>
                  <div>
                    <b>{item.title}</b>
                    <span>
                      {item.description} · {date(item.unlockedAt)}
                    </span>
                  </div>
                </div>
              ))}
              {!data.achievements.length && <p className="admin-empty">لا توجد إنجازات.</p>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>الشارات وسجل السحب</CardTitle>
          </CardHeader>
          <CardContent className="admin-list">
            {data.badgeGrants.map((item) => (
              <div className="admin-list-row" key={item.id}>
                <div>
                  <b>{item.name}</b>
                  <span>
                    {item.sourceType ?? 'غير محدد'} · {date(item.grantedAt)}{' '}
                    {item.revokedAt ? `· مسحوبة ${date(item.revokedAt)}` : ''}
                  </span>
                </div>
                {!item.revokedAt && (
                  <ActionForm compact action={revokeUserBadge} label="سحب" confirmText="تأكيد سحب الشارة؟">
                    <input type="hidden" name="userBadgeId" value={item.id} />
                    <Input aria-label="سبب السحب" name="reason" required minLength={5} placeholder="سبب السحب" />
                  </ActionForm>
                )}
              </div>
            ))}
            {!data.badgeGrants.length && <p className="admin-empty">لا توجد شارات.</p>}
          </CardContent>
        </Card>

        <div className="admin-two-column">
          <Card>
            <CardHeader>
              <CardTitle>الملاحظات والمخالفات</CardTitle>
            </CardHeader>
            <CardContent className="admin-list">
              {data.notes.map((item) => (
                <div className="admin-list-row" key={item.id}>
                  <div>
                    <b>{item.severity}</b>
                    <span>
                      {item.note} · {date(item.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
              {!data.notes.length && <p className="admin-empty">لا توجد ملاحظات.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>النشاط الإداري</CardTitle>
            </CardHeader>
            <CardContent className="admin-list">
              {data.audits.map((item) => (
                <div className="admin-list-row" key={item.id}>
                  <div>
                    <b>{item.action}</b>
                    <span>
                      {item.reason || 'بلا سبب'} · {date(item.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
              {!data.audits.length && <p className="admin-empty">لا توجد عمليات.</p>}
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  )
}

function ActionForm({
  action,
  label,
  children,
  confirmText,
  compact = false,
}: {
  action: (form: FormData) => Promise<Result>
  label: string
  children: ReactNode
  confirmText?: string
  compact?: boolean
}) {
  const ref = useRef<HTMLFormElement>(null)
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<Result | null>(null)
  const [queuedPayload, setQueuedPayload] = useState<FormData | null>(null)
  function execute(form: FormData) {
    setResult(null)
    startTransition(async () => {
      try {
        const response = await action(form)
        setResult(response)
        if (response.ok) {
          ref.current?.reset()
          router.refresh()
        }
      } catch (error) {
        setResult({ ok: false, message: publicActionError(error, 'تعذر تنفيذ العملية.') })
      } finally {
        setQueuedPayload(null)
      }
    })
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    if (confirmText) {
      setQueuedPayload(form)
      return
    }
    execute(form)
  }
  return (
    <>
      <form ref={ref} onSubmit={submit} className={compact ? 'admin-form compact' : 'admin-form'}>
        {children}
        {result && (
          <Alert variant={result.ok ? 'default' : 'destructive'}>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        )}
        <Button disabled={pending} size={compact ? 'sm' : 'default'}>
          {pending ? 'جارٍ التنفيذ...' : label}
        </Button>
      </form>
      {confirmText && (
        <ConfirmationDialog
          open={Boolean(queuedPayload)}
          description={confirmText}
          pending={pending}
          onCancel={() => setQueuedPayload(null)}
          onConfirm={() => queuedPayload && execute(queuedPayload)}
        />
      )}
    </>
  )
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="admin-metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}
function date(value: Date | string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : 'غير متوفر'
}
