'use client'

import Link from 'next/link'
import {
  approveChallengeWinners,
  changeChallengeLifecycle,
  duplicateManagedChallenge,
  excludeChallengeParticipant,
  reinstateChallengeParticipant,
  unapproveChallengeResults,
  updateManagedChallenge,
} from '@/app/admin/actions'
import { ManagedActionForm } from '@/components/admin/managed-action-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { getAdminChallengeDetail, getChallengeEditorOptions } from '@/lib/admin-challenges'

type Data = NonNullable<Awaited<ReturnType<typeof getAdminChallengeDetail>>>
type Options = Awaited<ReturnType<typeof getChallengeEditorOptions>>

export function AdminChallengeDetail({ data, options }: { data: Data; options: Options }) {
  const item = data.challenge
  const participation = item.participationRules ?? {}
  const scoring = item.scoringRules ?? {}
  const winning = item.winningRules ?? {}
  return (
    <main className="admin-console" dir="rtl">
      <nav className="admin-breadcrumb" aria-label="مسار التنقل">
        <Link href="/admin">لوحة التحكم</Link>
        <span>/</span>
        <Link href="/admin/challenges">التحديات</Link>
        <span>/</span>
        <b>{item.title}</b>
      </nav>
      <header className="admin-console-header">
        <div>
          <p className="eyebrow">تفاصيل التحدي</p>
          <h1>{item.title}</h1>
          <p>{item.description}</p>
        </div>
        <Badge>{item.lifecycle}</Badge>
      </header>

      <section className="admin-kpis" aria-label="مؤشرات التحدي">
        <Metric label="المشاركون" value={data.participants.total} />
        <Metric label="النتائج" value={data.results.length} />
        <Metric label="عدد الفائزين" value={item.winnerCount} />
        <Metric label="المكافأة" value={`${item.xpReward} XP / ${item.coinReward} عملة`} />
      </section>

      <section className="admin-two-column">
        <Card>
          <CardHeader>
            <CardTitle>تعديل التحدي</CardTitle>
            <CardDescription>يُمنع تعديل البيانات بعد اعتماد النتائج حفاظًا على السجل.</CardDescription>
          </CardHeader>
          <CardContent>
            <ManagedActionForm
              action={(form) => updateManagedChallenge(item.id, form)}
              label="حفظ التعديلات"
              confirm="هل تريد حفظ تغييرات التحدي؟"
            >
              <div className="admin-form-grid">
                <Input aria-label="اسم التحدي"
                  name="title"
                  required
                  minLength={3}
                  defaultValue={item.title}
                  placeholder="اسم التحدي"
                />
                <select name="sectionId" defaultValue={item.sectionId ?? ''} aria-label="القسم">
                  <option value="">كل الأقسام</option>
                  {options.sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))}
                </select>
                <select name="imageMediaId" defaultValue={item.imageMediaId ?? ''} aria-label="صورة التحدي">
                  <option value="">بلا صورة</option>
                  {options.media.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}
                    </option>
                  ))}
                </select>
                <select name="metric" defaultValue={item.metric} aria-label="مقياس التقدم">
                  <option value="words">الكلمات</option>
                  <option value="sentences">الجمل</option>
                  <option value="reviews">المراجعات</option>
                  <option value="streak">الاستمرار</option>
                </select>
                <Input aria-label="الهدف" name="target" type="number" min="1" required defaultValue={item.target} />
                <Input aria-label="مكافأة النقاط" name="xpReward" type="number" min="0" defaultValue={item.xpReward} />
                <Input aria-label="مكافأة العملات" name="coinReward" type="number" min="0" defaultValue={item.coinReward} />
                <label className="admin-field">
                  <span>نوع التحدي</span>
                  <select name="competitionType" required defaultValue={item.competitionType}>
                    <option value="progress">تحقيق هدف تدريجي</option>
                    <option value="speed">سرعة الإنجاز</option>
                    <option value="accuracy">دقة الإجابات</option>
                    <option value="streak">الاستمرارية</option>
                  </select>
                </label>
                <Input
                  name="startsAt"
                  type="datetime-local"
                  defaultValue={localDate(item.startsAt)}
                  aria-label="البداية"
                />
                <Input
                  name="endsAt"
                  type="datetime-local"
                  defaultValue={localDate(item.endsAt)}
                  aria-label="النهاية"
                />
                <Input
                  name="minimumParticipants"
                  type="number"
                  min="1"
                  defaultValue={item.minimumParticipants}
                  aria-label="الحد الأدنى للمشاركين"
                />
                <Input
                  name="maximumParticipants"
                  type="number"
                  min="1"
                  defaultValue={item.maximumParticipants ?? ''}
                  aria-label="الحد الأقصى للمشاركين"
                />
                <Input aria-label="عدد الفائزين" name="winnerCount" type="number" min="1" defaultValue={item.winnerCount} />
                <select name="prizeBadgeId" defaultValue={item.prizeBadgeId ?? ''} aria-label="شارة الجائزة">
                  <option value="">بدون شارة</option>
                  {options.badges.map((badge) => (
                    <option key={badge.id} value={badge.id}>
                      {badge.name}
                    </option>
                  ))}
                </select>
                <Input
                  name="minimumXp"
                  type="number"
                  min="0"
                  defaultValue={numberValue(participation.minimumXp, 0)}
                  aria-label="الحد الأدنى من XP"
                />
                <Input aria-label="الجمهور المستهدف"
                  name="targetAudience"
                  maxLength={120}
                  defaultValue={stringValue(participation.targetAudience, '')}
                  placeholder="الجمهور المستهدف"
                />
                <Input
                  name="scoreMultiplier"
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  defaultValue={numberValue(scoring.multiplier, 1)}
                  aria-label="معامل النقاط"
                />
                <select
                  name="tieBreaker"
                  defaultValue={stringValue(winning.tieBreaker, 'earliest_completion')}
                  aria-label="قاعدة كسر التعادل"
                >
                  <option value="earliest_completion">الأسبق في الإكمال</option>
                  <option value="highest_progress">أعلى تقدم</option>
                  <option value="earliest_join">الأسبق في الانضمام</option>
                </select>
                <label>
                  <input
                    type="checkbox"
                    name="requireVerifiedEmail"
                    defaultChecked={participation.requireVerifiedEmail !== false}
                  />{' '}
                  بريد موثق مطلوب
                </label>
              </div>
              <Textarea aria-label="الوصف" name="description" required minLength={5} defaultValue={item.description} />
              <Input aria-label="سبب التعديل" name="reason" required minLength={5} placeholder="سبب التعديل" />
            </ManagedActionForm>
          </CardContent>
        </Card>

        <div className="admin-stack">
          <Card>
            <CardHeader>
              <CardTitle>دورة الحياة</CardTitle>
            </CardHeader>
            <CardContent>
              <ManagedActionForm
                action={(form) =>
                  changeChallengeLifecycle(item.id, String(form.get('lifecycle')), String(form.get('reason')))
                }
                label="تحديث الحالة"
                confirm="سيتم تغيير حالة التحدي. هل تريد المتابعة؟"
              >
                <select name="lifecycle" defaultValue={item.lifecycle} aria-label="الحالة الجديدة">
                  <option value="draft">مسودة</option>
                  <option value="scheduled">مجدول</option>
                  <option value="open">مفتوح</option>
                  <option value="active">نشط</option>
                  <option value="paused">متوقف</option>
                  <option value="ended">منتهي</option>
                  <option value="cancelled">ملغي</option>
                </select>
                <Input aria-label="سبب الإنهاء أو الإلغاء" name="reason" minLength={5} placeholder="سبب الإنهاء أو الإلغاء" />
              </ManagedActionForm>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>نسخ واعتماد</CardTitle>
            </CardHeader>
            <CardContent className="admin-stack">
              <ManagedActionForm
                action={() => duplicateManagedChallenge(item.id)}
                label="إنشاء نسخة مسودة"
                confirm="سيتم إنشاء تحدٍ جديد مستقل في حالة المسودة."
              >
                <p>النسخ لا ينقل المشاركين أو النتائج.</p>
              </ManagedActionForm>
              <ManagedActionForm
                action={(form) => approveChallengeWinners(item.id, String(form.get('reason')))}
                label="اعتماد النتائج والمكافآت"
                confirm="سيتم تثبيت الترتيب ومنح المكافآت مرة واحدة."
              >
                <Input aria-label="سبب الاعتماد" name="reason" required minLength={5} placeholder="سبب الاعتماد" />
              </ManagedActionForm>
            </CardContent>
          </Card>
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>المشاركون ({data.participants.total})</CardTitle>
          <CardDescription>
            الصفحة {data.participants.page} من {data.participants.pages}
          </CardDescription>
        </CardHeader>
        <CardContent className="admin-list">
          {data.participants.rows.map((participant) => {
            const decisions = data.moderation.filter((entry) => entry.participantId === participant.id)
            return (
              <div className="admin-list-row" key={participant.id}>
                <div>
                  <b>{participant.userName}</b>
                  <span>
                    {participant.userEmail} · {participant.progress} · {participant.status}
                  </span>
                  {decisions.map((decision) => (
                    <small key={decision.id}>
                      {decision.action}: {decision.reason} · {formatDate(decision.createdAt)}
                    </small>
                  ))}
                </div>
                {participant.status === 'disqualified' ? (
                  <ManagedActionForm
                    action={(form) => {
                      form.set('participantId', String(participant.id))
                      return reinstateChallengeParticipant(form)
                    }}
                    label="إعادة المشارك"
                    confirm="هل تريد إعادة هذا المشارك؟"
                  >
                    <Input aria-label="سبب الإعادة" name="reason" required minLength={5} placeholder="سبب الإعادة" />
                  </ManagedActionForm>
                ) : (
                  <ManagedActionForm
                    action={(form) => {
                      form.set('participantId', String(participant.id))
                      return excludeChallengeParticipant(form)
                    }}
                    label="استبعاد"
                    confirm="هل تريد استبعاد هذا المشارك؟"
                  >
                    <Input aria-label="سبب الاستبعاد" name="reason" required minLength={5} placeholder="سبب الاستبعاد" />
                  </ManagedActionForm>
                )}
              </div>
            )
          })}
          {!data.participants.rows.length && <p className="admin-empty">لا يوجد مشاركون.</p>}
          <div className="admin-row">
            {data.participants.page > 1 && (
              <Button variant="outline" render={<Link href={`?page=${data.participants.page - 1}`} />}>
                السابق
              </Button>
            )}
            {data.participants.page < data.participants.pages && (
              <Button variant="outline" render={<Link href={`?page=${data.participants.page + 1}`} />}>
                التالي
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>معاينة إعادة احتساب النتائج</CardTitle>
          <CardDescription>
            معاينة غير مُعدِّلة تُطبّق معامل النقاط وقاعدة كسر التعادل الحالية قبل الاعتماد.
          </CardDescription>
        </CardHeader>
        <CardContent className="admin-table-wrap">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>الترتيب</th>
                <th>المستخدم</th>
                <th>التقدم الخام</th>
                <th>النتيجة المحسوبة</th>
                <th>الحكم</th>
              </tr>
            </thead>
            <tbody>
              {data.previewResults.map((result) => (
                <tr key={result.participantId}>
                  <td>{result.rank}</td>
                  <td>{result.userName}</td>
                  <td>{result.progress}</td>
                  <td>{result.score}</td>
                  <td>{result.isWinner ? 'فائز متوقع' : 'مشارك'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.previewResults.length && (
            <p className="admin-empty">لا توجد مشاركات مكتملة لإعادة احتسابها.</p>
          )}
        </CardContent>
      </Card>

      <section className="admin-two-column">
        <Card>
          <CardHeader>
            <CardTitle>النتائج المعتمدة</CardTitle>
          </CardHeader>
          <CardContent className="admin-table-wrap">
            <table className="admin-data-table">
              <thead>
                <tr>
                  <th>الترتيب</th>
                  <th>المستخدم</th>
                  <th>النتيجة</th>
                  <th>الجائزة</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((result) => (
                  <tr key={result.id}>
                    <td>{result.rank ?? '—'}</td>
                    <td>{result.userName}</td>
                    <td>{result.score}</td>
                    <td>{result.isWinner ? (result.rewardGrantedAt ? 'مُنحت' : 'فائز') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.results.length && <p className="admin-empty">لم تعتمد النتائج بعد.</p>}
            {data.results.length > 0 && (
              <ManagedActionForm
                action={(form) => unapproveChallengeResults(item.id, String(form.get('reason')))}
                label="إلغاء اعتماد النتائج بأمان"
                confirm="سيتم سحب المكافآت وحذف النتائج المعتمدة وإيقاف التحدي مؤقتًا. تستمر العملية فقط إذا أمكن عكس كل الأرصدة بأمان."
              >
                <Input aria-label="سبب تفصيلي لإلغاء الاعتماد" name="reason" required minLength={10} placeholder="سبب تفصيلي لإلغاء الاعتماد" />
              </ManagedActionForm>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>سجل القرارات</CardTitle>
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
            {!data.audits.length && <p className="admin-empty">لا توجد قرارات مسجلة.</p>}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="admin-metric">
        <span>{label}</span>
        <b>{value}</b>
      </CardContent>
    </Card>
  )
}

function localDate(value: Date | null) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
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
