'use client'

import Link from 'next/link'
import { archiveBadge, grantUserBadge, restoreBadge, revokeUserBadge, updateBadge } from '@/app/admin/actions'
import { ManagedActionForm } from '@/components/admin/managed-action-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { getAdminBadgeDetail } from '@/lib/admin-badges'

type Data = NonNullable<Awaited<ReturnType<typeof getAdminBadgeDetail>>>

export function AdminBadgeDetail({ data }: { data: Data }) {
  const item = data.badge
  const criteria = item.criteria ?? {}
  return (
    <main className="admin-console" dir="rtl">
      <nav className="admin-breadcrumb" aria-label="مسار التنقل">
        <Link href="/admin">لوحة التحكم</Link>
        <span>/</span>
        <Link href="/admin/badges">الشارات والإنجازات</Link>
        <span>/</span>
        <b>{item.name}</b>
      </nav>
      <header className="admin-console-header">
        <div>
          <p className="eyebrow">تفاصيل الشارة</p>
          <h1>{item.name}</h1>
          <p>{item.description}</p>
        </div>
        <div className="admin-row">
          <Badge>{item.rarity}</Badge>
          <Badge>{item.deletedAt ? 'archived' : item.isPublished ? 'published' : 'draft'}</Badge>
        </div>
      </header>

      <section className="admin-two-column">
        <Card>
          <CardHeader>
            <CardTitle>تعديل الشارة</CardTitle>
          </CardHeader>
          <CardContent>
            <ManagedActionForm
              action={(form) => updateBadge(item.id, form)}
              label="حفظ التعديلات"
              confirm="هل تريد حفظ تغييرات الشارة؟"
            >
              <div className="admin-form-grid">
                <Input name="name" required minLength={2} defaultValue={item.name} />
                <Input
                  name="slug"
                  required
                  dir="ltr"
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  defaultValue={item.slug}
                />
                <select name="rarity" defaultValue={item.rarity} aria-label="الندرة">
                  <option value="common">عادية</option>
                  <option value="uncommon">غير شائعة</option>
                  <option value="rare">نادرة</option>
                  <option value="epic">ملحمية</option>
                  <option value="legendary">أسطورية</option>
                </select>
                <Input name="color" type="color" defaultValue={item.color ?? '#f59e0b'} aria-label="اللون" />
                <select name="sectionId" defaultValue={item.sectionId ?? ''} aria-label="القسم">
                  <option value="">كل الأقسام</option>
                  {data.options.sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))}
                </select>
                <select name="imageMediaId" defaultValue={item.imageMediaId ?? ''} aria-label="صورة الشارة">
                  <option value="">بدون صورة</option>
                  {data.options.media.map((media) => (
                    <option key={media.id} value={media.id}>
                      {media.name}
                    </option>
                  ))}
                </select>
                <select name="mode" defaultValue={item.mode} aria-label="طريقة المنح">
                  <option value="manual">يدوي</option>
                  <option value="automatic">تلقائي</option>
                  <option value="both">يدوي وتلقائي</option>
                </select>
                <select
                  name="conditionType"
                  defaultValue={stringValue(criteria.conditionType, 'points')}
                  aria-label="شرط المنح التلقائي"
                >
                  <option value="points">النقاط</option>
                  <option value="lessons_completed">الدروس المكتملة</option>
                  <option value="challenge_wins">الفوز بالتحديات</option>
                  <option value="activity_streak">استمرار النشاط</option>
                  <option value="achievements">الإنجازات</option>
                </select>
                <Input
                  name="threshold"
                  type="number"
                  min="0"
                  defaultValue={numberValue(criteria.threshold, 0)}
                  aria-label="قيمة الشرط"
                />
                <label>
                  <input type="checkbox" name="isPublished" defaultChecked={item.isPublished} /> منشورة
                </label>
                <label>
                  <input type="checkbox" name="isRepeatable" defaultChecked={item.isRepeatable} /> قابلة
                  للتكرار
                </label>
              </div>
              <Textarea name="description" required minLength={3} defaultValue={item.description} />
              <Input name="reason" required minLength={5} placeholder="سبب التعديل" />
            </ManagedActionForm>
          </CardContent>
        </Card>
        <div className="admin-stack">
          <Card>
            <CardHeader>
              <CardTitle>منح يدوي</CardTitle>
            </CardHeader>
            <CardContent>
              <ManagedActionForm
                action={grantUserBadge}
                label="منح الشارة"
                confirm="هل تريد منح الشارة لهذا المستخدم؟"
              >
                <Input name="userId" required placeholder="رقم المستخدم" />
                <input type="hidden" name="badgeId" value={item.id} />
                {item.isRepeatable && <Input name="repeatKey" required placeholder="مفتاح التكرار" />}
                <Input name="reason" required minLength={5} placeholder="سبب المنح" />
              </ManagedActionForm>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{item.deletedAt ? 'استعادة الشارة' : 'أرشفة الشارة'}</CardTitle>
              <CardDescription>الأرشفة لا تحذف سجلات الحاصلين على الشارة.</CardDescription>
            </CardHeader>
            <CardContent>
              <ManagedActionForm
                action={(form) =>
                  item.deletedAt
                    ? restoreBadge(item.id, String(form.get('reason')))
                    : archiveBadge(item.id, String(form.get('reason')))
                }
                label={item.deletedAt ? 'استعادة' : 'أرشفة'}
                confirm={item.deletedAt ? 'هل تريد استعادة الشارة كمسودة؟' : 'هل تريد أرشفة الشارة؟'}
              >
                <Input name="reason" required minLength={5} placeholder="السبب" />
              </ManagedActionForm>
            </CardContent>
          </Card>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>الحاصلون عليها ({data.holders.total})</CardTitle>
          <CardDescription>يشمل السجل المنح النشط والمسحوب.</CardDescription>
        </CardHeader>
        <CardContent className="admin-stack">
          <form method="get" className="admin-filter-form">
            <Input name="search" placeholder="اسم المستخدم أو البريد" />
            <select name="status" defaultValue="all" aria-label="حالة المنح">
              <option value="all">الكل</option>
              <option value="active">نشط</option>
              <option value="revoked">مسحوب</option>
            </select>
            <Button>تطبيق</Button>
          </form>
          <div className="admin-list">
            {data.holders.rows.map((holder) => (
              <div className="admin-list-row" key={holder.id}>
                <div>
                  <b>{holder.userName}</b>
                  <span>
                    {holder.userEmail} · {holder.sourceType || 'manual'} · {formatDate(holder.grantedAt)}
                  </span>
                  {holder.revokedAt && (
                    <small>
                      مسحوبة: {holder.revokeReason} · {formatDate(holder.revokedAt)}
                    </small>
                  )}
                </div>
                {!holder.revokedAt && (
                  <ManagedActionForm action={revokeUserBadge} label="سحب" confirm="هل تريد سحب هذه الشارة؟">
                    <input type="hidden" name="userBadgeId" value={holder.id} />
                    <Input name="reason" required minLength={5} placeholder="سبب السحب" />
                  </ManagedActionForm>
                )}
              </div>
            ))}
            {!data.holders.rows.length && <p className="admin-empty">لا توجد نتائج.</p>}
          </div>
          <div className="admin-row">
            {data.holders.page > 1 && (
              <Button variant="outline" render={<Link href={`?page=${data.holders.page - 1}`} />}>
                السابق
              </Button>
            )}
            {data.holders.page < data.holders.pages && (
              <Button variant="outline" render={<Link href={`?page=${data.holders.page + 1}`} />}>
                التالي
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>سجل تغييرات الشارة</CardTitle>
        </CardHeader>
        <CardContent className="admin-list">
          {data.audits.map((entry) => (
            <div className="admin-list-row" key={entry.id}>
              <div>
                <b>{entry.action}</b>
                <span>
                  {entry.reason || 'بلا سبب'} · {formatDate(entry.createdAt)}
                </span>
              </div>
            </div>
          ))}
          {!data.audits.length && <p className="admin-empty">لا توجد تغييرات مسجلة.</p>}
        </CardContent>
      </Card>
    </main>
  )
}

function numberValue(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
