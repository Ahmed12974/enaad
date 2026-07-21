'use client'

import { FormEvent, ReactNode, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import NextImage from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Activity,
  Award,
  BarChart3,
  BookOpen,
  FileText,
  FolderTree,
  Gauge,
  Image as ImageIcon,
  LayoutDashboard,
  Medal,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  addUserAdminNote,
  adjustUserPoints,
  approveChallengeWinners,
  archivePromotionRule,
  archiveEducationalSection,
  archiveSectionContent,
  changeChallengeLifecycle,
  changeContentStatus,
  createAchievement,
  createBadge,
  createEducationalSection,
  createManagedChallenge,
  createPromotionRule,
  createSectionContent,
  duplicateSectionContent,
  excludeChallengeParticipant,
  dryRunPromotionRule,
  duplicatePromotionRule,
  executePromotionRuleBatch,
  grantUserBadge,
  reinstateChallengeParticipant,
  moveSectionContent,
  restoreEducationalSection,
  restorePromotionRule,
  restoreSiteContentVersion,
  restoreSectionContent,
  setUserLevel,
  retryPromotionRuleExecution,
  togglePromotionRule,
  toggleAchievement,
  updateEducationalSection,
  updatePromotionRuleMetadata,
  updatePlatformSettings,
  updateManagedUserStatus,
  upsertSiteContent,
} from '@/app/admin/actions'
import { createAndEmailBackup, createBackupDownload } from '@/app/admin/backup-actions'
import type { AdminSection, getAdminConsoleData } from '@/lib/admin-console'
import { SOLE_ADMIN_EMAIL } from '@/lib/admin-policy'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog'
import { BulkUserActions } from '@/components/admin/bulk-user-actions'

type Data = Awaited<ReturnType<typeof getAdminConsoleData>>
type Result = { ok: boolean; message: string }
type FormAction = (form: FormData) => Promise<Result>

const navigation = [
  ['overview', 'الرئيسية', LayoutDashboard],
  ['statistics', 'الإحصائيات', BarChart3],
  ['users', 'المستخدمون', Users],
  ['sections', 'الأقسام', FolderTree],
  ['content', 'المحتوى التعليمي', BookOpen],
  ['challenges', 'التحديات والمنافسات', Trophy],
  ['promotions', 'المستويات والترقيات', Sparkles],
  ['badges', 'الشارات والإنجازات', Award],
  ['cms', 'محتوى واجهة الموقع', FileText],
  ['media', 'الوسائط والصور', ImageIcon],
  ['audit', 'سجل العمليات', ShieldCheck],
  ['backup', 'النسخ الاحتياطي', RefreshCw],
  ['settings', 'الإعدادات', Settings],
] as const

export function AdminConsole({ data, section }: { data: Data; section: AdminSection }) {
  return (
    <main className="admin-console" dir="rtl">
      <header className="admin-console-header">
        <div>
          <p className="eyebrow">مركز إدارة أكاديمية زايد التعليمية</p>
          <h1>لوحة التحكم</h1>
          <p>إدارة المنصة والبيانات والصلاحيات من مساحة واحدة آمنة.</p>
        </div>
        <Badge>
          <ShieldCheck aria-hidden="true" /> SUPER ADMIN
        </Badge>
      </header>
      <div className="admin-console-grid">
        <aside className="admin-sidebar" aria-label="أقسام لوحة التحكم">
          {navigation.map(([id, label, Icon]) => (
            <Link
              key={id}
              className={section === id ? 'active' : ''}
              aria-current={section === id ? 'page' : undefined}
              href={id === 'overview' ? '/admin' : `/admin/${id}`}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </aside>
        <section className="admin-workspace" aria-live="polite">
          <Breadcrumb current={navigation.find(([id]) => id === section)?.[1] ?? 'الرئيسية'} />
          {section === 'overview' && <Overview data={data} />}
          {section === 'statistics' && <Statistics data={data} />}
          {section === 'users' && <UsersPanel data={data} />}
          {section === 'sections' && <SectionsPanel data={data} />}
          {section === 'content' && <ContentPanel data={data} />}
          {section === 'challenges' && <ChallengesPanel data={data} />}
          {section === 'promotions' && <PromotionsPanel data={data} />}
          {section === 'badges' && <BadgesPanel data={data} />}
          {section === 'cms' && <CmsPanel data={data} />}
          {section === 'media' && <MediaPanel data={data} />}
          {section === 'audit' && <AuditPanel data={data} />}
          {section === 'backup' && <BackupPanel />}
          {section === 'settings' && <SettingsPanel data={data} />}
        </section>
      </div>
    </main>
  )
}

function Breadcrumb({ current }: { current: string }) {
  return (
    <nav className="admin-breadcrumb" aria-label="مسار التنقل">
      <span>لوحة التحكم</span>
      <span aria-hidden="true">/</span>
      <b>{current}</b>
    </nav>
  )
}

function Overview({ data }: { data: Data }) {
  const stats = data.dashboard
  const change = percentageChange(data.comparison.current, data.comparison.previous)
  return (
    <div className="admin-stack">
      <div className="admin-kpis">
        <Kpi
          icon={<Users />}
          label="إجمالي المستخدمين"
          value={stats?.totalUsers ?? 0}
          hint={`${stats?.newToday ?? 0} اليوم`}
        />
        <Kpi
          icon={<Activity />}
          label="النشطون خلال 30 يومًا"
          value={stats?.activeUsers ?? 0}
          hint={`${stats?.recentlyOnline ?? 0} نشط مؤخرًا`}
        />
        <Kpi
          icon={<BookOpen />}
          label="العناصر المكتملة"
          value={stats?.completedContent ?? 0}
          hint={`متوسط الإنجاز ${stats?.averageProgress ?? 0}%`}
        />
        <Kpi
          icon={<Trophy />}
          label="التحديات النشطة"
          value={stats?.activeChallenges ?? 0}
          hint={`${stats?.participants ?? 0} مشاركة`}
        />
        <Kpi
          icon={<Award />}
          label="الشارات الممنوحة"
          value={stats?.badgesGranted ?? 0}
          hint={`${data.badges.length} شارة معرفة`}
        />
        <Kpi
          icon={<FolderTree />}
          label="الأقسام"
          value={stats?.sections ?? 0}
          hint={`${data.contents.length} عنصر محتوى`}
        />
      </div>
      <div className="admin-two-column">
        <Card>
          <CardHeader>
            <CardTitle>النمو والنشاط — آخر 30 يومًا</CardTitle>
            <CardDescription>
              التسجيلات مقارنة بالنشاط اليومي. التغير عن الفترة السابقة: {change > 0 ? '+' : ''}
              {change}%
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart data={data.trend} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>ملخص التسجيلات</CardTitle>
          </CardHeader>
          <CardContent className="admin-metric-list">
            <Metric label="اليوم" value={stats?.newToday ?? 0} />
            <Metric label="هذا الأسبوع" value={stats?.newWeek ?? 0} />
            <Metric label="هذا الشهر" value={stats?.newMonth ?? 0} />
            <Metric label="غير النشطين" value={stats?.inactiveUsers ?? 0} />
            <Metric label="التحديات المنتهية" value={stats?.endedChallenges ?? 0} />
          </CardContent>
        </Card>
      </div>
      <div className="admin-two-column">
        <SimpleList
          title="أحدث الإنجازات"
          empty="لا توجد شارات ممنوحة بعد."
          rows={data.latestBadgeGrants.slice(0, 8).map((item) => ({
            title: `${item.userName} — ${item.badgeName}`,
            meta: formatDate(item.grantedAt),
          }))}
        />
        <SimpleList
          title="أحدث نشاط على المنصة"
          empty="لا توجد أنشطة مسجلة بعد."
          rows={data.latestActivities.slice(0, 8).map((item) => ({
            title: item.activityType,
            meta: `${item.entityType ?? 'platform'} · ${formatDate(item.createdAt)}`,
          }))}
        />
      </div>
      <div className="admin-two-column">
        <SimpleList
          title="أحدث التسجيلات"
          empty="لا توجد تسجيلات ضمن الفلاتر الحالية."
          rows={data.users.rows.slice(0, 8).map((item) => ({
            title: item.name,
            meta: `${item.email} · ${formatDate(item.createdAt)}`,
          }))}
        />
        <SimpleList
          title="أحدث العمليات المهمة"
          empty="لا توجد عمليات إدارية مسجلة بعد."
          rows={data.audits.slice(0, 8).map((item) => ({
            title: item.action,
            meta: `${item.entityType}${item.entityId ? ` · ${item.entityId}` : ''} · ${formatDate(item.createdAt)}`,
          }))}
        />
      </div>
    </div>
  )
}

function Statistics({ data }: { data: Data }) {
  const params = useSearchParams()
  const summary = data.statistics.summary
  return (
    <div className="admin-stack">
      <Card>
        <CardHeader>
          <CardTitle>فترة التقرير</CardTitle>
          <CardDescription>اترك الحقول فارغة لعرض آخر 30 يومًا، أو حدد فترة مخصصة.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="admin-filter-form" method="get" action="/admin/statistics">
            <select name="range" defaultValue={params.get('range') ?? 'last30'} aria-label="الفترة">
              <option value="today">اليوم</option>
              <option value="yesterday">أمس</option>
              <option value="thisWeek">هذا الأسبوع</option>
              <option value="previousWeek">الأسبوع السابق</option>
              <option value="thisMonth">هذا الشهر</option>
              <option value="previousMonth">الشهر السابق</option>
              <option value="thisYear">هذه السنة</option>
              <option value="previousYear">السنة السابقة</option>
              <option value="last7">آخر 7 أيام</option>
              <option value="last30">آخر 30 يومًا</option>
              <option value="last90">آخر 90 يومًا</option>
            </select>
            <Input
              name="from"
              type="date"
              defaultValue={params.get('from') ?? ''}
              aria-label="من تاريخ مخصص"
            />
            <Input name="to" type="date" defaultValue={params.get('to') ?? ''} aria-label="إلى تاريخ مخصص" />
            <Button>تطبيق الفترة</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>تقرير النشاط والتسجيل</CardTitle>
          <CardDescription>الرسم مبني على البيانات الحقيقية المخزنة يوميًا.</CardDescription>
        </CardHeader>
        <CardContent>
          <TrendChart data={data.trend} />
        </CardContent>
      </Card>
      <div className="admin-kpis">
        <Kpi icon={<Users />} label="التسجيلات في الفترة" value={summary?.registrations ?? 0} />
        <Kpi icon={<Activity />} label="المستخدمون النشطون" value={summary?.activeUsers ?? 0} />
        <Kpi icon={<RefreshCw />} label="المستخدمون العائدون" value={summary?.returningUsers ?? 0} />
        <Kpi icon={<Gauge />} label="الجلسات" value={summary?.sessions ?? 0} />
        <Kpi
          icon={<Gauge />}
          label="متوسط وقت الاستخدام"
          value={`${summary?.averageUsageMinutes ?? 0} دقيقة`}
        />
        <Kpi icon={<Gauge />} label="متوسط الإنجاز" value={`${data.dashboard?.averageProgress ?? 0}%`} />
        <Kpi icon={<Medal />} label="الشارات الممنوحة" value={summary?.badgesGranted ?? 0} />
        <Kpi icon={<Trophy />} label="مشاركات التحديات" value={summary?.challengeParticipations ?? 0} />
        <Kpi icon={<Activity />} label="المحتوى المكتمل" value={summary?.completedContent ?? 0} />
        <Kpi icon={<Activity />} label="نتائج الإخفاق" value={summary?.failedContent ?? 0} />
        <Kpi icon={<Gauge />} label="متوسط النجاح" value={`${summary?.averageSuccess ?? 0}%`} />
        <Kpi icon={<Trophy />} label="XP المكتسبة" value={summary?.xpEarned ?? 0} />
        <Kpi icon={<Medal />} label="الترقيات" value={summary?.promotions ?? 0} />
      </div>
      <p className="admin-help">
        بيانات مدة الاستخدام تبدأ من تاريخ تفعيل متتبع النشاط، ولا تُنشأ بيانات تاريخية افتراضية.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>مقارنة التسجيلات بالفترة السابقة</CardTitle>
        </CardHeader>
        <CardContent>
          <b>{percentageChange(data.comparison.current, data.comparison.previous)}%</b>
          <p>
            الحالية: {data.comparison.current} · السابقة: {data.comparison.previous}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>استخدام الأقسام</CardTitle>
        </CardHeader>
        <CardContent className="admin-table-wrap">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>القسم</th>
                <th>مرات الإكمال</th>
                <th>المتعلمون</th>
                <th>متوسط الإنجاز</th>
              </tr>
            </thead>
            <tbody>
              {data.statistics.sections.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.completions}</td>
                  <td>{item.learners}</td>
                  <td>{item.averageProgress}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.statistics.sections.length && <Empty text="لا توجد أقسام لإظهار إحصاءاتها." />}
        </CardContent>
      </Card>
      <div className="admin-two-column">
        <Card>
          <CardHeader>
            <CardTitle>توزيع المستويات</CardTitle>
          </CardHeader>
          <CardContent className="admin-list">
            {data.statistics.levels.map((level) => (
              <div className="admin-list-row" key={level.id ?? 'none'}>
                <b>{level.name}</b>
                <span>{level.users} مستخدم</span>
              </div>
            ))}
            {!data.statistics.levels.length && <Empty text="لا توجد مستويات لعرضها." />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>أكثر المحتويات إكمالًا</CardTitle>
          </CardHeader>
          <CardContent className="admin-list">
            {data.statistics.contents.map((content) => (
              <div className="admin-list-row" key={content.id}>
                <div>
                  <b>{content.title}</b>
                  <span>{content.sectionName}</span>
                </div>
                <span>
                  {content.completions} إكمال · متوسط {content.averageScore}%
                </span>
              </div>
            ))}
            {!data.statistics.contents.length && <Empty text="لا توجد بيانات محتوى في الفترة." />}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function UsersPanel({ data }: { data: Data }) {
  const params = useSearchParams()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const reportQuery = params.toString()
  const exportSuffix = reportQuery ? `?${reportQuery}` : ''
  const visibleIds = data.users.rows.map((item) => item.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))
  function toggleUser(id: string, selected: boolean) {
    setSelectedIds((current) =>
      selected ? [...new Set([...current, id])] : current.filter((item) => item !== id),
    )
  }
  return (
    <div className="admin-stack">
      <Card>
        <CardHeader>
          <CardTitle>البحث والفلاتر</CardTitle>
          <CardDescription>
            ابحث بالاسم أو البريد أو رقم المستخدم، ثم صدّر التقرير عند الحاجة.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="admin-filter-form" method="get" action="/admin/users">
            <Input
              name="search"
              defaultValue={params.get('search') ?? ''}
              placeholder="الاسم أو البريد أو رقم المستخدم"
            />
            <select name="status" defaultValue={params.get('status') ?? 'all'} aria-label="حالة المستخدم">
              <option value="all">كل الحالات</option>
              <option value="active">نشط</option>
              <option value="disabled">معطل</option>
              <option value="suspended">موقوف مؤقتًا</option>
              <option value="banned">محظور</option>
            </select>
            <select name="levelId" defaultValue={params.get('levelId') ?? ''} aria-label="المستوى">
              <option value="">كل المستويات</option>
              {data.levels.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.name}
                </option>
              ))}
            </select>
            <select name="verified" defaultValue={params.get('verified') ?? 'all'} aria-label="توثيق البريد">
              <option value="all">كل حالات التوثيق</option>
              <option value="verified">موثق</option>
              <option value="unverified">غير موثق</option>
            </select>
            <select name="activity" defaultValue={params.get('activity') ?? 'all'} aria-label="النشاط">
              <option value="all">كل النشاط</option>
              <option value="active">نشط خلال 30 يومًا</option>
              <option value="inactive">غير نشط</option>
            </select>
            <select name="sectionId" defaultValue={params.get('sectionId') ?? ''} aria-label="القسم">
              <option value="">كل الأقسام</option>
              {data.sections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select name="badgeId" defaultValue={params.get('badgeId') ?? ''} aria-label="الشارة">
              <option value="">كل الشارات</option>
              {data.badges.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select name="challengeId" defaultValue={params.get('challengeId') ?? ''} aria-label="التحدي">
              <option value="">كل التحديات</option>
              {data.challenges.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <Input
              name="competitionId"
              type="number"
              min="1"
              defaultValue={params.get('competitionId') ?? ''}
              placeholder="رقم المنافسة"
              aria-label="المنافسة"
            />
            <select name="contentId" defaultValue={params.get('contentId') ?? ''} aria-label="المحتوى">
              <option value="">كل المحتوى</option>
              {data.contents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <select
              name="achievementId"
              defaultValue={params.get('achievementId') ?? ''}
              aria-label="الإنجاز"
            >
              <option value="">كل الإنجازات</option>
              {data.achievements.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              name="activityType"
              defaultValue={params.get('activityType') ?? 'all'}
              aria-label="نوع النشاط"
            >
              <option value="all">كل أنواع النشاط</option>
              <option value="platform.activity">نشاط المنصة</option>
              <option value="reward.earned">اكتساب مكافأة</option>
              <option value="page.active">وقت استخدام صفحة</option>
            </select>
            <select name="outcome" defaultValue={params.get('outcome') ?? 'all'} aria-label="النتيجة">
              <option value="all">النجاح والإخفاق</option>
              <option value="completed">نجاح / مكتمل</option>
              <option value="failed">إخفاق</option>
            </select>
            <select name="cohort" defaultValue={params.get('cohort') ?? 'all'} aria-label="عمر الحساب">
              <option value="all">الجدد والقدامى</option>
              <option value="new">جديد خلال 90 يومًا</option>
              <option value="existing">أقدم من 90 يومًا</option>
            </select>
            <label>
              <input
                type="checkbox"
                name="hasNotes"
                value="1"
                defaultChecked={params.get('hasNotes') === '1'}
              />{' '}
              لديه ملاحظات أو مخالفات
            </label>
            <select name="sort" defaultValue={params.get('sort') ?? 'newest'} aria-label="الترتيب">
              <option value="newest">الأحدث</option>
              <option value="oldest">الأقدم</option>
              <option value="name">الاسم</option>
              <option value="points">النقاط</option>
            </select>
            <Input name="from" type="date" defaultValue={params.get('from') ?? ''} aria-label="من تاريخ" />
            <Input name="to" type="date" defaultValue={params.get('to') ?? ''} aria-label="إلى تاريخ" />
            <Button>تطبيق</Button>
            <Button variant="outline" render={<Link href={`/api/admin/reports/users${exportSuffix}`} />}>
              تصدير CSV
            </Button>
            <Button variant="outline" render={<Link href={`/api/admin/reports/users.xlsx${exportSuffix}`} />}>
              تصدير Excel
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>المستخدمون ({data.users.total})</CardTitle>
          <CardDescription>
            الصفحة {data.users.page} من {data.users.pages}
          </CardDescription>
        </CardHeader>
        <CardContent className="admin-user-list">
          <div className="admin-bulk-toolbar">
            <label>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(event) => setSelectedIds(event.currentTarget.checked ? visibleIds : [])}
              />{' '}
              تحديد كل نتائج الصفحة الحالية
            </label>
            <BulkUserActions userIds={selectedIds} onComplete={() => setSelectedIds([])} />
          </div>
          {data.users.rows.map((item) => (
            <div key={item.id} className="admin-user-selection-card">
              <label className="admin-user-selector">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.id)}
                  onChange={(event) => toggleUser(item.id, event.currentTarget.checked)}
                />
                تحديد {item.name}
              </label>
              <details className="admin-user-card">
                <summary>
                  <div>
                    <b>{item.name}</b>
                    <span>{item.email}</span>
                  </div>
                  <div className="admin-user-summary">
                    <Status value={item.status ?? (item.banned ? 'banned' : 'active')} />
                    <span>{item.xp ?? 0} XP</span>
                    <span>{item.levelName ?? 'بلا مستوى'}</span>
                  </div>
                </summary>
                <div className="admin-user-details">
                  <dl>
                    <div>
                      <dt>رقم المستخدم</dt>
                      <dd dir="ltr">{item.id}</dd>
                    </div>
                    <div>
                      <dt>التسجيل</dt>
                      <dd>{formatDate(item.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>آخر تسجيل دخول</dt>
                      <dd>{item.lastLoginAt ? formatDate(item.lastLoginAt) : 'غير متوفر'}</dd>
                    </div>
                    <div>
                      <dt>آخر نشاط</dt>
                      <dd>{item.lastActiveAt ? formatDate(item.lastActiveAt) : 'غير متوفر'}</dd>
                    </div>
                    <div>
                      <dt>توثيق البريد</dt>
                      <dd>{item.emailVerified ? 'موثق' : 'غير موثق'}</dd>
                    </div>
                    <div>
                      <dt>النقاط والعملات</dt>
                      <dd>
                        {item.xp ?? 0} / {item.coins ?? 0}
                      </dd>
                    </div>
                    <div>
                      <dt>سلسلة النشاط</dt>
                      <dd>{item.streak ?? 0} يوم</dd>
                    </div>
                    <div>
                      <dt>الإنجازات والشارات</dt>
                      <dd>
                        {item.achievementCount} إنجاز · {item.badgeCount} شارة
                      </dd>
                    </div>
                    <div>
                      <dt>التحديات</dt>
                      <dd>{item.challengeCount} مشاركة</dd>
                    </div>
                    <div>
                      <dt>المحتوى المكتمل</dt>
                      <dd>
                        {item.completedContent} · متوسط {item.averageCompletion}%
                      </dd>
                    </div>
                    <div>
                      <dt>المخالفات</dt>
                      <dd>{item.violationCount ?? 0}</dd>
                    </div>
                  </dl>
                  <div className="admin-operation-grid">
                    <Button
                      variant="outline"
                      render={<Link href={`/admin/users/${encodeURIComponent(item.id)}`} />}
                    >
                      فتح الملف الكامل
                    </Button>
                    <ManagedForm
                      action={updateManagedUserStatus}
                      submitLabel="تحديث الحالة"
                      confirm="هل تريد تطبيق حالة الحساب الجديدة؟"
                    >
                      <input type="hidden" name="userId" value={item.id} />
                      <select
                        name="status"
                        defaultValue={item.status ?? 'active'}
                        aria-label="الحالة الجديدة"
                      >
                        <option value="active">نشط</option>
                        <option value="disabled">معطل</option>
                        <option value="suspended">موقوف مؤقتًا</option>
                        <option value="banned">محظور</option>
                      </select>
                      <Input name="suspendedUntil" type="datetime-local" aria-label="نهاية الإيقاف" />
                      <Input name="reason" required minLength={5} placeholder="سبب القرار" />
                    </ManagedForm>
                    <ManagedForm
                      action={adjustUserPoints}
                      submitLabel="تعديل النقاط"
                      confirm="هل تريد تعديل رصيد النقاط؟"
                    >
                      <input type="hidden" name="userId" value={item.id} />
                      <Input name="delta" type="number" required placeholder="+100 أو -50" />
                      <Input name="reason" required minLength={5} placeholder="سبب التعديل" />
                    </ManagedForm>
                    <ManagedForm
                      action={setUserLevel}
                      submitLabel="تغيير المستوى"
                      confirm="هل تريد تغيير مستوى المستخدم؟"
                    >
                      <input type="hidden" name="userId" value={item.id} />
                      <select name="levelId" required defaultValue="" aria-label="المستوى الجديد">
                        <option value="" disabled>
                          اختر المستوى
                        </option>
                        {data.levels.map((level) => (
                          <option key={level.id} value={level.id}>
                            {level.name}
                          </option>
                        ))}
                      </select>
                      <Input name="reason" required minLength={5} placeholder="سبب الترقية أو التخفيض" />
                    </ManagedForm>
                    <ManagedForm action={addUserAdminNote} submitLabel="إضافة ملاحظة">
                      <input type="hidden" name="userId" value={item.id} />
                      <select name="severity" defaultValue="info" aria-label="درجة الملاحظة">
                        <option value="info">معلومة</option>
                        <option value="warning">تحذير</option>
                        <option value="critical">حرجة</option>
                      </select>
                      <Textarea name="note" required minLength={3} placeholder="الملاحظة الإدارية" />
                    </ManagedForm>
                    <ManagedForm
                      action={grantUserBadge}
                      submitLabel="منح شارة"
                      confirm="هل تريد منح هذه الشارة؟"
                    >
                      <input type="hidden" name="userId" value={item.id} />
                      <select name="badgeId" required defaultValue="" aria-label="الشارة">
                        <option value="" disabled>
                          اختر الشارة
                        </option>
                        {data.badges.map((badge) => (
                          <option key={badge.id} value={badge.id}>
                            {badge.name}
                          </option>
                        ))}
                      </select>
                      <Input name="reason" required minLength={5} placeholder="سبب المنح" />
                    </ManagedForm>
                  </div>
                </div>
              </details>
            </div>
          ))}
          {!data.users.rows.length && <Empty text="لا توجد نتائج مطابقة للفلاتر." />}
          <Pagination current={data.users.page} pages={data.users.pages} />
        </CardContent>
      </Card>
    </div>
  )
}

function SectionsPanel({ data }: { data: Data }) {
  return (
    <div className="admin-stack">
      <Card>
        <CardHeader>
          <CardTitle>إضافة قسم تعليمي</CardTitle>
          <CardDescription>الأقسام ديناميكية ولا تعتمد على أسماء ثابتة في الواجهة.</CardDescription>
        </CardHeader>
        <CardContent>
          <SectionForm action={createEducationalSection} media={data.media} sections={data.sections} />
        </CardContent>
      </Card>
      <div className="admin-card-grid">
        {data.sections.map((section) => (
          <Card key={section.id} style={{ borderTopColor: section.color ?? undefined }}>
            {section.imageMediaId && (
              <NextImage
                unoptimized
                width={640}
                height={300}
                className="admin-media-preview"
                src={`/api/admin/media?id=${encodeURIComponent(section.imageMediaId)}`}
                alt={section.name}
              />
            )}
            <CardHeader>
              <CardTitle>{section.name}</CardTitle>
              <CardDescription>{section.shortDescription || 'بلا وصف مختصر'}</CardDescription>
            </CardHeader>
            <CardContent className="admin-stack-sm">
              <div className="admin-row">
                <Status value={section.status} />
                <span>{section.access === 'free' ? 'مجاني' : 'مقيد'}</span>
                <span>{section.contentCount} محتوى</span>
                <span>{section.learnerCount} متعلم</span>
                <Button size="sm" variant="outline" render={<Link href={`/admin/sections/${section.id}`} />}>
                  التفاصيل
                </Button>
              </div>
              <details>
                <summary>تعديل القسم</summary>
                <SectionForm
                  action={updateEducationalSection.bind(null, section.id)}
                  section={section}
                  media={data.media}
                  sections={data.sections}
                />
              </details>
              <ManagedForm
                action={(form) => archiveEducationalSection(section.id, String(form.get('reason') ?? ''))}
                submitLabel="أرشفة آمنة"
                confirm="سيختفي القسم من الإدارة النشطة مع بقاء بياناته. متابعة؟"
              >
                <Input name="reason" required minLength={5} placeholder="سبب الأرشفة" />
              </ManagedForm>
            </CardContent>
          </Card>
        ))}
      </div>
      {!data.sections.length && <Empty text="لا توجد أقسام بعد." />}
      {data.archivedSections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>الأقسام المؤرشفة</CardTitle>
          </CardHeader>
          <CardContent className="admin-list">
            {data.archivedSections.map((item) => (
              <div className="admin-list-row" key={item.id}>
                <div>
                  <b>{item.name}</b>
                  <span>{item.slug}</span>
                </div>
                <ManagedForm
                  compact
                  action={(form) => restoreEducationalSection(item.id, String(form.get('reason') ?? ''))}
                  submitLabel="استعادة"
                  confirm="استعادة القسم كمسودة؟"
                >
                  <Input name="reason" required minLength={5} placeholder="سبب الاستعادة" />
                </ManagedForm>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SectionForm({
  action,
  section,
  media,
  sections,
}: {
  action: FormAction
  section?: Data['sections'][number]
  media: Data['media']
  sections: Data['sections']
}) {
  const unlockRules = section?.unlockRules ?? {}
  return (
    <ManagedForm action={action} submitLabel={section ? 'حفظ التعديلات' : 'إضافة القسم'}>
      <div className="admin-form-grid">
        <Input name="name" required minLength={2} defaultValue={section?.name} placeholder="اسم القسم" />
        <Input
          name="slug"
          required
          dir="ltr"
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          defaultValue={section?.slug}
          placeholder="section-slug"
        />
        <Input
          name="shortDescription"
          defaultValue={section?.shortDescription ?? ''}
          placeholder="وصف مختصر"
        />
        <Input name="color" type="color" defaultValue={section?.color ?? '#2563eb'} aria-label="لون القسم" />
        <Input name="ageRange" defaultValue={section?.ageRange ?? ''} placeholder="الفئة العمرية: 8-12" />
        <Input name="targetLevel" defaultValue={section?.targetLevel ?? ''} placeholder="المستوى المستهدف" />
        <select name="iconMediaId" defaultValue={section?.iconMediaId ?? ''} aria-label="أيقونة القسم">
          <option value="">بدون أيقونة</option>
          {media
            .filter((item) => item.mediaType.startsWith('image/'))
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.originalName}
              </option>
            ))}
        </select>
        <select name="imageMediaId" defaultValue={section?.imageMediaId ?? ''} aria-label="صورة القسم">
          <option value="">بدون صورة</option>
          {media
            .filter((item) => item.mediaType.startsWith('image/'))
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.originalName}
              </option>
            ))}
        </select>
        <Input
          name="unlockMinimumXp"
          type="number"
          min="0"
          defaultValue={numberFromRecord(unlockRules, 'minimumXp', 0)}
          placeholder="الحد الأدنى من XP للفتح"
        />
        <select
          name="prerequisiteSectionId"
          defaultValue={stringFromRecord(unlockRules, 'prerequisiteSectionId')}
          aria-label="القسم السابق المطلوب"
        >
          <option value="">بدون قسم سابق</option>
          {sections
            .filter((item) => item.id !== section?.id)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
        <select name="access" defaultValue={section?.access ?? 'free'} aria-label="نوع الوصول">
          <option value="free">مجاني</option>
          <option value="restricted">مقيد</option>
        </select>
        <select name="status" defaultValue={section?.status ?? 'draft'} aria-label="حالة النشر">
          <option value="draft">مسودة</option>
          <option value="published">منشور</option>
          <option value="archived">مؤرشف</option>
        </select>
        <Input
          name="sortOrder"
          type="number"
          min="0"
          defaultValue={section?.sortOrder ?? 0}
          placeholder="الترتيب"
        />
      </div>
      <Textarea
        name="fullDescription"
        defaultValue={section?.fullDescription ?? ''}
        placeholder="الوصف الكامل"
      />
    </ManagedForm>
  )
}

function ContentPanel({ data }: { data: Data }) {
  return (
    <div className="admin-stack">
      <Card>
        <CardHeader>
          <CardTitle>إضافة محتوى</CardTitle>
          <CardDescription>وحدات ودروس واختبارات وأنشطة ومواد ضمن أي قسم.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" render={<Link href="/admin/content/new" />}>
            فتح محرر المحتوى الكامل
          </Button>
          <ManagedForm action={createSectionContent} submitLabel="حفظ المحتوى">
            <div className="admin-form-grid">
              <select name="sectionId" required defaultValue="" aria-label="القسم">
                <option value="" disabled>
                  اختر القسم
                </option>
                {data.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
              <select name="kind" defaultValue="lesson" aria-label="نوع المحتوى">
                <option value="unit">وحدة</option>
                <option value="level">مستوى</option>
                <option value="lesson">درس</option>
                <option value="quiz">اختبار</option>
                <option value="question">سؤال</option>
                <option value="activity">نشاط</option>
                <option value="story">قصة</option>
                <option value="file">ملف</option>
                <option value="image">صورة</option>
                <option value="video">فيديو</option>
                <option value="instruction">تعليمات</option>
              </select>
              <Input name="title" required minLength={2} placeholder="العنوان" />
              <Input
                name="slug"
                required
                dir="ltr"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder="content-slug"
              />
              <Input name="targetLevel" placeholder="المستوى المستهدف" />
              <Input name="points" type="number" min="0" defaultValue="0" placeholder="النقاط" />
              <Input name="passingScore" type="number" min="0" max="100" placeholder="نسبة النجاح" />
              <Input name="sortOrder" type="number" min="0" defaultValue="0" placeholder="الترتيب" />
              <select name="status" defaultValue="draft" aria-label="الحالة">
                <option value="draft">مسودة</option>
                <option value="scheduled">مجدول</option>
                <option value="published">منشور</option>
                <option value="archived">مؤرشف</option>
              </select>
              <Input name="scheduledAt" type="datetime-local" aria-label="موعد النشر المجدول" />
            </div>
            <Textarea name="summary" placeholder="ملخص المحتوى" />
            <Textarea name="contentText" placeholder="نص المحتوى" />
            <Textarea name="instructions" placeholder="تعليمات المتعلم" />
            <input type="hidden" name="questionType" value="multiple_choice" />
            <input type="hidden" name="estimatedMinutes" value="0" />
            <input type="hidden" name="maxAttempts" value="0" />
          </ManagedForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>مكتبة المحتوى</CardTitle>
        </CardHeader>
        <CardContent className="admin-table-wrap">
          <table className="admin-data-table">
            <thead>
              <tr>
                <th>العنوان</th>
                <th>النوع</th>
                <th>الحالة</th>
                <th>النقاط</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {data.contents.map((item) => (
                <tr key={item.id}>
                  <td>{item.title}</td>
                  <td>{item.kind}</td>
                  <td>
                    <Status value={item.status} />
                  </td>
                  <td>{item.points}</td>
                  <td className="admin-inline-actions">
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link href={`/admin/content/${item.id}/edit`} />}
                    >
                      تعديل
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link href={`/admin/content/${item.id}/preview`} />}
                    >
                      معاينة كاملة
                    </Button>
                    <details className="admin-preview">
                      <summary>معاينة</summary>
                      <strong>{item.title}</strong>
                      <p>{item.summary || 'بلا ملخص'}</p>
                      <p>{structuredContentSummary(item.body)}</p>
                    </details>
                    {item.status !== 'published' && (
                      <ActionButton action={() => changeContentStatus(item.id, 'published')} label="نشر" />
                    )}
                    {item.status === 'published' && (
                      <ActionButton
                        action={() => changeContentStatus(item.id, 'draft')}
                        label="إلغاء النشر"
                      />
                    )}
                    <ActionButton action={() => moveSectionContent(item.id, 'up')} label="لأعلى" />
                    <ActionButton action={() => moveSectionContent(item.id, 'down')} label="لأسفل" />
                    <ManagedForm
                      compact
                      action={(form) => duplicateSectionContent(item.id, String(form.get('reason') ?? ''))}
                      submitLabel="نسخ"
                      confirm="سيتم إنشاء نسخة مستقلة في حالة المسودة."
                    >
                      <Input name="reason" required minLength={5} placeholder="سبب النسخ" />
                    </ManagedForm>
                    <ManagedForm
                      compact
                      action={(form) => archiveSectionContent(item.id, String(form.get('reason') ?? ''))}
                      submitLabel="أرشفة"
                      confirm="هل تريد أرشفة هذا المحتوى؟"
                    >
                      <Input name="reason" required minLength={5} placeholder="السبب" />
                    </ManagedForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.contents.length && <Empty text="لا يوجد محتوى بعد." />}
        </CardContent>
      </Card>
      {data.archivedContents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>المحتوى المؤرشف</CardTitle>
          </CardHeader>
          <CardContent className="admin-list">
            {data.archivedContents.map((item) => (
              <div className="admin-list-row" key={item.id}>
                <div>
                  <b>{item.title}</b>
                  <span>
                    {item.kind} · {item.slug}
                  </span>
                </div>
                <ManagedForm
                  compact
                  action={(form) => restoreSectionContent(item.id, String(form.get('reason') ?? ''))}
                  submitLabel="استعادة"
                  confirm="استعادة المحتوى كمسودة؟"
                >
                  <Input name="reason" required minLength={5} placeholder="سبب الاستعادة" />
                </ManagedForm>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ChallengesPanel({ data }: { data: Data }) {
  return (
    <div className="admin-stack">
      <Card>
        <CardHeader>
          <CardTitle>إنشاء تحدٍ أو منافسة</CardTitle>
        </CardHeader>
        <CardContent>
          <ManagedForm action={createManagedChallenge} submitLabel="حفظ التحدي">
            <div className="admin-form-grid">
              <Input name="title" required minLength={3} placeholder="اسم التحدي" />
              <select name="sectionId" defaultValue="" aria-label="القسم">
                <option value="">كل الأقسام</option>
                {data.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
              <select name="imageMediaId" defaultValue="" aria-label="صورة التحدي">
                <option value="">بلا صورة</option>
                {data.media
                  .filter((item) => item.mediaType.startsWith('image/'))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title || item.originalName}
                    </option>
                  ))}
              </select>
              <select name="metric" defaultValue="words" aria-label="مقياس التقدم">
                <option value="words">الكلمات</option>
                <option value="sentences">الجمل</option>
                <option value="reviews">المراجعات</option>
                <option value="streak">الاستمرار</option>
              </select>
              <Input name="target" type="number" min="1" required placeholder="الهدف" />
              <Input name="xpReward" type="number" min="0" defaultValue="0" placeholder="مكافأة XP" />
              <Input name="coinReward" type="number" min="0" defaultValue="0" placeholder="العملات" />
              <Input name="competitionType" defaultValue="progress" placeholder="نوع المنافسة" />
              <select name="status" defaultValue="draft" aria-label="حالة التحدي">
                <option value="draft">مسودة</option>
                <option value="scheduled">مجدول</option>
                <option value="open">مفتوح</option>
                <option value="active">نشط</option>
                <option value="paused">متوقف</option>
              </select>
              <Input name="startsAt" type="datetime-local" aria-label="البداية" />
              <Input name="endsAt" type="datetime-local" aria-label="النهاية" />
              <Input
                name="minimumParticipants"
                type="number"
                min="1"
                defaultValue="1"
                placeholder="الحد الأدنى"
              />
              <Input name="maximumParticipants" type="number" min="1" placeholder="الحد الأقصى" />
              <Input name="winnerCount" type="number" min="1" defaultValue="1" placeholder="عدد الفائزين" />
            </div>
            <Textarea name="description" required minLength={5} placeholder="الوصف" />
            <div className="admin-form-grid">
              <Input
                name="minimumXp"
                type="number"
                min="0"
                defaultValue="0"
                placeholder="الحد الأدنى من XP"
              />
              <Input name="targetAudience" maxLength={120} placeholder="الجمهور المستهدف (اختياري)" />
              <Input
                name="scoreMultiplier"
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                defaultValue="1"
                placeholder="معامل احتساب النقاط"
              />
              <select name="tieBreaker" defaultValue="earliest_completion" aria-label="قاعدة كسر التعادل">
                <option value="earliest_completion">الأسبق في الإكمال</option>
                <option value="highest_progress">أعلى تقدم</option>
                <option value="earliest_join">الأسبق في الانضمام</option>
              </select>
              <label>
                <input type="checkbox" name="requireVerifiedEmail" defaultChecked /> بريد موثق مطلوب
              </label>
            </div>
          </ManagedForm>
        </CardContent>
      </Card>
      <div className="admin-card-grid">
        {data.challenges.map((item) => {
          const leaders = data.challengeLeaders.filter((leader) => leader.challengeId === item.id)
          const participants = data.challengeParticipants.filter(
            (participant) => participant.challengeId === item.id,
          )
          return (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle>{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent className="admin-stack-sm">
                <Button variant="outline" render={<Link href={`/admin/challenges/${item.id}`} />}>
                  فتح التفاصيل والتحرير
                </Button>
                <div className="admin-row">
                  <Status value={item.lifecycle ?? 'legacy'} />
                  <span>{item.participantCount} مشارك</span>
                  <span>{item.completedCount} مكتمل</span>
                </div>
                <ManagedForm
                  action={(form) =>
                    changeChallengeLifecycle(
                      item.id,
                      String(form.get('lifecycle') ?? ''),
                      String(form.get('reason') ?? ''),
                    )
                  }
                  submitLabel="تحديث الحالة"
                  confirm="هل تريد تغيير حالة التحدي؟"
                >
                  <select
                    name="lifecycle"
                    defaultValue={item.lifecycle ?? 'active'}
                    aria-label="الحالة الجديدة"
                  >
                    <option value="draft">مسودة</option>
                    <option value="scheduled">مجدول</option>
                    <option value="open">مفتوح</option>
                    <option value="active">نشط</option>
                    <option value="paused">متوقف</option>
                    <option value="ended">منتهٍ</option>
                    <option value="cancelled">ملغي</option>
                  </select>
                  <Input name="reason" placeholder="سبب الإنهاء أو الإلغاء" />
                </ManagedForm>
                <ManagedForm
                  action={(form) => approveChallengeWinners(item.id, String(form.get('reason') ?? ''))}
                  submitLabel="اعتماد النتائج والفائزين"
                  confirm="سيتم تثبيت الترتيب ومنح شارات الجوائز إن وُجدت. متابعة؟"
                >
                  <Input name="reason" required minLength={5} placeholder="سبب اعتماد النتائج" />
                </ManagedForm>
                {leaders.length > 0 && (
                  <ol className="admin-leaderboard">
                    {leaders.slice(0, 5).map((leader) => (
                      <li key={`${item.id}-${leader.rank}`}>
                        <span>
                          {leader.rank}. {leader.userName}
                        </span>
                        <b>{leader.score}</b>
                      </li>
                    ))}
                  </ol>
                )}
                {participants.length > 0 && (
                  <details>
                    <summary>المشاركون ({participants.length})</summary>
                    <div className="admin-list">
                      {participants.map((participant) => (
                        <div className="admin-list-row" key={participant.id}>
                          <div>
                            <b>{participant.userName}</b>
                            <span>
                              {participant.userEmail} · {participant.progress} · {participant.status}
                            </span>
                          </div>
                          {participant.status !== 'disqualified' && (
                            <ManagedForm
                              compact
                              action={(form) => {
                                form.set('participantId', String(participant.id))
                                return excludeChallengeParticipant(form)
                              }}
                              submitLabel="استبعاد"
                              confirm="هل تريد استبعاد هذا المشارك؟"
                            >
                              <Input name="reason" required minLength={5} placeholder="سبب الاستبعاد" />
                            </ManagedForm>
                          )}
                          {participant.status === 'disqualified' && (
                            <ManagedForm
                              compact
                              action={(form) => {
                                form.set('participantId', String(participant.id))
                                return reinstateChallengeParticipant(form)
                              }}
                              submitLabel="إعادة"
                              confirm="إعادة المشارك؟"
                            >
                              <Input name="reason" required minLength={5} placeholder="سبب الإعادة" />
                            </ManagedForm>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
      {!data.challenges.length && <Empty text="لا توجد تحديات بعد." />}
    </div>
  )
}

function PromotionsPanel({ data }: { data: Data }) {
  return (
    <div className="admin-stack">
      <div className="admin-kpis">
        {data.levels.map((level) => (
          <Kpi
            key={level.id}
            icon={<Gauge />}
            label={`${level.rank}. ${level.name}`}
            value={`${level.minimumPoints} XP`}
          />
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>إنشاء قاعدة ترقية</CardTitle>
          <CardDescription>التنفيذ مسجل بمفتاح فريد لمنع تكرار المكافأة.</CardDescription>
        </CardHeader>
        <CardContent>
          <ManagedForm action={createPromotionRule} submitLabel="إنشاء القاعدة">
            <div className="admin-form-grid">
              <Input name="name" required minLength={3} placeholder="اسم القاعدة" />
              <select name="logic" defaultValue="and" aria-label="منطق الشروط">
                <option value="and">يجب تحقق كل الشروط (AND)</option>
                <option value="or">يكفي تحقق شرط واحد (OR)</option>
              </select>
              <select name="conditionType1" defaultValue="points" aria-label="نوع الشرط الأول">
                <option value="points">النقاط</option>
                <option value="section_completion">إكمال قسم</option>
                <option value="lessons_completed">عدد الدروس</option>
                <option value="challenge_wins">الفوز بالتحديات</option>
                <option value="activity_streak">استمرار النشاط</option>
                <option value="achievements">الإنجازات</option>
              </select>
              <Input name="threshold1" type="number" min="0" required placeholder="قيمة الشرط الأول" />
              <select name="sectionId1" defaultValue="" aria-label="قسم الشرط الأول">
                <option value="">كل الأقسام</option>
                {data.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
              <select name="conditionType2" defaultValue="" aria-label="نوع الشرط الثاني">
                <option value="">بدون شرط ثانٍ</option>
                <option value="points">النقاط</option>
                <option value="section_completion">إكمال قسم</option>
                <option value="lessons_completed">عدد الدروس</option>
                <option value="challenge_wins">الفوز بالتحديات</option>
                <option value="activity_streak">استمرار النشاط</option>
                <option value="achievements">الإنجازات</option>
              </select>
              <Input
                name="threshold2"
                type="number"
                min="0"
                defaultValue="0"
                placeholder="قيمة الشرط الثاني"
              />
              <select name="sectionId2" defaultValue="" aria-label="قسم الشرط الثاني">
                <option value="">كل الأقسام</option>
                {data.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
              <select name="conditionType3" defaultValue="" aria-label="نوع الشرط الثالث">
                <option value="">بدون شرط ثالث</option>
                <option value="points">النقاط</option>
                <option value="section_completion">إكمال قسم</option>
                <option value="lessons_completed">عدد الدروس</option>
                <option value="challenge_wins">الفوز بالتحديات</option>
                <option value="activity_streak">استمرار النشاط</option>
                <option value="achievements">الإنجازات</option>
              </select>
              <Input
                name="threshold3"
                type="number"
                min="0"
                defaultValue="0"
                placeholder="قيمة الشرط الثالث"
              />
              <select name="sectionId3" defaultValue="" aria-label="قسم الشرط الثالث">
                <option value="">كل الأقسام</option>
                {data.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
              <select name="targetLevelId" defaultValue="" aria-label="المستوى الناتج">
                <option value="">لا تغير المستوى</option>
                {data.levels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.name}
                  </option>
                ))}
              </select>
              <select name="grantBadgeId" defaultValue="" aria-label="الشارة الناتجة">
                <option value="">لا تمنح شارة</option>
                {data.badges.map((badge) => (
                  <option key={badge.id} value={badge.id}>
                    {badge.name}
                  </option>
                ))}
              </select>
              <select name="grantAchievementId" defaultValue="" aria-label="الإنجاز الناتج">
                <option value="">لا تمنح إنجازًا</option>
                {data.achievements.map((achievement) => (
                  <option key={achievement.id} value={achievement.id}>
                    {achievement.name}
                  </option>
                ))}
              </select>
              <Input name="xpAmount" type="number" min="0" defaultValue="0" placeholder="إضافة XP" />
              <Input name="coinAmount" type="number" min="0" defaultValue="0" placeholder="إضافة عملات" />
              <Input name="startsAt" type="datetime-local" aria-label="تاريخ البداية" />
              <Input name="endsAt" type="datetime-local" aria-label="تاريخ النهاية" />
              <select name="applicationMode" defaultValue="new_only" aria-label="نطاق تطبيق القاعدة">
                <option value="new_only">الإنجازات الجديدة فقط</option>
                <option value="all_matching">كل المستخدمين المطابقين</option>
              </select>
              <Input name="priority" type="number" min="1" defaultValue="100" placeholder="الأولوية" />
              <label>
                <input type="checkbox" name="isActive" defaultChecked /> مفعلة
              </label>
              <label>
                <input type="checkbox" name="retrospective" /> أثر رجعي
              </label>
            </div>
            <Textarea name="description" placeholder="وصف القاعدة" />
          </ManagedForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>القواعد الحالية</CardTitle>
        </CardHeader>
        <CardContent className="admin-list">
          {data.rules.map((rule) => (
            <div className="admin-list-row" key={rule.id}>
              <div>
                <b>{rule.name}</b>
                <span>
                  {rule.conditionType} · أولوية {rule.priority} ·{' '}
                  {rule.applicationMode === 'new_only' ? 'الجديد فقط' : 'كل المطابقين'}
                </span>
              </div>
              <div>
                <Status value={rule.archivedAt ? 'archived' : rule.isActive ? 'active' : 'disabled'} />
                {!rule.archivedAt && (
                  <>
                    <ActionButton
                      action={() => togglePromotionRule(rule.id)}
                      label={rule.isActive ? 'تعطيل' : 'تفعيل'}
                    />
                    <ActionButton action={() => dryRunPromotionRule(rule.id)} label="معاينة Dry Run" />
                  </>
                )}
              </div>
              {!rule.archivedAt && (
                <details>
                  <summary>تعديل بيانات القاعدة</summary>
                  <ManagedForm
                    compact
                    action={(form) => updatePromotionRuleMetadata(rule.id, form)}
                    submitLabel="حفظ التعديل"
                    confirm="سيتم تعديل بيانات دورة حياة القاعدة مع بقاء الشروط والإجراءات الحالية."
                  >
                    <Input name="name" required minLength={3} defaultValue={rule.name} />
                    <Textarea name="description" defaultValue={rule.description ?? ''} />
                    <Input
                      name="startsAt"
                      type="datetime-local"
                      defaultValue={localInputDate(rule.startsAt)}
                    />
                    <Input name="endsAt" type="datetime-local" defaultValue={localInputDate(rule.endsAt)} />
                    <select name="applicationMode" defaultValue={rule.applicationMode}>
                      <option value="new_only">الإنجازات الجديدة فقط</option>
                      <option value="all_matching">كل المستخدمين المطابقين</option>
                    </select>
                    <Input name="priority" type="number" min="1" defaultValue={rule.priority} />
                    <label>
                      <input type="checkbox" name="retrospective" defaultChecked={rule.retrospective} /> أثر
                      رجعي
                    </label>
                    <Input name="reason" required minLength={5} placeholder="سبب التعديل" />
                  </ManagedForm>
                </details>
              )}
              {!rule.archivedAt && rule.retrospective && (
                <ManagedForm
                  compact
                  action={(form) => executePromotionRuleBatch(rule.id, String(form.get('reason')))}
                  submitLabel="تنفيذ دفعة رجعية"
                  confirm="سيتم تطبيق الإجراءات على دفعة من المستخدمين المطابقين مع منع التكرار."
                >
                  <Input name="reason" required minLength={5} placeholder="سبب التنفيذ الرجعي" />
                </ManagedForm>
              )}
              <ManagedForm
                compact
                action={(form) => duplicatePromotionRule(rule.id, String(form.get('reason')))}
                submitLabel="نسخ القاعدة"
                confirm="سيتم إنشاء نسخة معطلة مستقلة."
              >
                <Input name="reason" required minLength={5} placeholder="سبب النسخ" />
              </ManagedForm>
              <ManagedForm
                compact
                action={(form) =>
                  rule.archivedAt
                    ? restorePromotionRule(rule.id, String(form.get('reason')))
                    : archivePromotionRule(rule.id, String(form.get('reason')))
                }
                submitLabel={rule.archivedAt ? 'استعادة القاعدة' : 'أرشفة القاعدة'}
                confirm={rule.archivedAt ? 'ستُستعاد القاعدة معطلة للمراجعة.' : 'ستُعطل القاعدة وتؤرشف.'}
              >
                <Input name="reason" required minLength={5} placeholder="سبب العملية" />
              </ManagedForm>
            </div>
          ))}
          {!data.rules.length && <Empty text="لا توجد قواعد ترقية بعد." />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>سجل تنفيذ القواعد</CardTitle>
          <CardDescription>
            كل مستخدم يُنفذ داخل معاملة مستقلة، ويمكن إعادة محاولة الفشل بأمان.
          </CardDescription>
        </CardHeader>
        <CardContent className="admin-list">
          {data.ruleExecutions.map((execution) => (
            <div className="admin-list-row" key={execution.id}>
              <div>
                <b>{execution.ruleName}</b>
                <span>
                  {execution.userName} · {execution.status} · محاولة {execution.attemptCount}
                </span>
                {execution.errorMessage && <small>{execution.errorMessage}</small>}
              </div>
              {execution.status === 'failed' && (
                <ManagedForm
                  compact
                  action={(form) => retryPromotionRuleExecution(execution.id, String(form.get('reason')))}
                  submitLabel="إعادة المحاولة"
                  confirm="ستُعاد المحاولة داخل معاملة كاملة مع مفتاح منع التكرار نفسه."
                >
                  <Input name="reason" required minLength={5} placeholder="سبب إعادة المحاولة" />
                </ManagedForm>
              )}
            </div>
          ))}
          {!data.ruleExecutions.length && <Empty text="لا توجد عمليات تنفيذ بعد." />}
        </CardContent>
      </Card>
    </div>
  )
}

function BadgesPanel({ data }: { data: Data }) {
  return (
    <div className="admin-stack">
      <Card>
        <CardHeader>
          <CardTitle>إضافة شارة</CardTitle>
        </CardHeader>
        <CardContent>
          <ManagedForm action={createBadge} submitLabel="حفظ الشارة">
            <div className="admin-form-grid">
              <Input name="name" required minLength={2} placeholder="اسم الشارة" />
              <Input
                name="slug"
                required
                dir="ltr"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder="badge-slug"
              />
              <select name="rarity" defaultValue="common" aria-label="الندرة">
                <option value="common">عادية</option>
                <option value="uncommon">غير شائعة</option>
                <option value="rare">نادرة</option>
                <option value="epic">ملحمية</option>
                <option value="legendary">أسطورية</option>
              </select>
              <Input name="color" type="color" defaultValue="#f59e0b" aria-label="لون الشارة" />
              <select name="sectionId" defaultValue="" aria-label="القسم">
                <option value="">كل الأقسام</option>
                {data.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
              <select name="mode" defaultValue="manual" aria-label="طريقة المنح">
                <option value="manual">يدوي</option>
                <option value="automatic">تلقائي</option>
                <option value="both">كلاهما</option>
              </select>
              <select name="imageMediaId" defaultValue="" aria-label="صورة الشارة">
                <option value="">بدون صورة</option>
                {data.media.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.originalName}
                  </option>
                ))}
              </select>
              <select name="conditionType" defaultValue="points" aria-label="شرط المنح التلقائي">
                <option value="points">النقاط</option>
                <option value="lessons_completed">الدروس المكتملة</option>
                <option value="challenge_wins">الفوز بالتحديات</option>
                <option value="activity_streak">استمرار النشاط</option>
                <option value="achievements">عدد الإنجازات</option>
              </select>
              <Input name="threshold" type="number" min="0" defaultValue="0" placeholder="قيمة الشرط" />
              <label>
                <input type="checkbox" name="isPublished" /> منشورة
              </label>
              <label>
                <input type="checkbox" name="isRepeatable" /> قابلة للتكرار
              </label>
            </div>
            <Textarea name="description" required minLength={3} placeholder="الوصف" />
          </ManagedForm>
        </CardContent>
      </Card>
      <div className="admin-card-grid">
        {data.badges.map((badge) => (
          <Card key={badge.id}>
            <CardHeader>
              <CardTitle>{badge.name}</CardTitle>
              <CardDescription>{badge.slug}</CardDescription>
            </CardHeader>
            <CardContent className="admin-row">
              <Badge>{badge.rarity}</Badge>
              <span>{badge.holders} حاصل</span>
              <span>{badge.isRepeatable ? 'متكررة' : 'مرة واحدة'}</span>
              <Status value={badge.isPublished ? 'published' : 'draft'} />
              <Button variant="outline" render={<Link href={`/admin/badges/${badge.id}`} />}>
                التفاصيل والتحرير
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {!data.badges.length && <Empty text="لا توجد شارات بعد." />}
      <Card>
        <CardHeader>
          <CardTitle>إنشاء إنجاز</CardTitle>
          <CardDescription>الإنجاز يمنح مكافأته مرة واحدة لكل مستخدم.</CardDescription>
        </CardHeader>
        <CardContent>
          <ManagedForm action={createAchievement} submitLabel="حفظ الإنجاز">
            <div className="admin-form-grid">
              <Input name="name" required minLength={2} placeholder="اسم الإنجاز" />
              <Input name="icon" maxLength={120} placeholder="رمز أو اسم أيقونة" />
              <Input name="xpReward" type="number" min="0" defaultValue="0" placeholder="مكافأة XP" />
              <Input name="coinReward" type="number" min="0" defaultValue="0" placeholder="العملات" />
              <select name="requirementType" defaultValue="points" aria-label="نوع الشرط">
                <option value="points">النقاط</option>
                <option value="lessons_completed">الدروس المكتملة</option>
                <option value="challenge_wins">الفوز بالتحديات</option>
                <option value="activity_streak">استمرار النشاط</option>
              </select>
              <Input name="requirementValue" type="number" min="1" required placeholder="قيمة الشرط" />
              <Input name="sortOrder" type="number" min="0" defaultValue="0" placeholder="الترتيب" />
              <label>
                <input type="checkbox" name="isActive" defaultChecked /> نشط
              </label>
            </div>
            <Textarea name="description" required minLength={3} placeholder="وصف الإنجاز" />
          </ManagedForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>الإنجازات الحالية</CardTitle>
        </CardHeader>
        <CardContent className="admin-list">
          {data.achievements.map((achievement) => (
            <div className="admin-list-row" key={achievement.id}>
              <div>
                <b>{achievement.name}</b>
                <span>
                  {achievement.requirementType} ≥ {achievement.requirementValue} · {achievement.xpReward} XP
                </span>
              </div>
              <div className="admin-row">
                <Status value={achievement.isActive ? 'active' : 'disabled'} />
                <ActionButton
                  action={() => toggleAchievement(achievement.id)}
                  label={achievement.isActive ? 'تعطيل' : 'تفعيل'}
                />
              </div>
            </div>
          ))}
          {!data.achievements.length && <Empty text="لا توجد إنجازات بعد." />}
        </CardContent>
      </Card>
    </div>
  )
}

function CmsPanel({ data }: { data: Data }) {
  return (
    <div className="admin-stack">
      <Card>
        <CardHeader>
          <CardTitle>محرر محتوى الموقع</CardTitle>
          <CardDescription>يمكن حفظ مسودة ومعاينتها قبل تغيير الحالة إلى منشور.</CardDescription>
        </CardHeader>
        <CardContent>
          <ManagedForm action={upsertSiteContent} submitLabel="حفظ المحتوى">
            <div className="admin-form-grid">
              <select name="contentType" defaultValue="hero" aria-label="نوع المحتوى">
                <option value="hero">واجهة رئيسية</option>
                <option value="welcome">نص ترحيبي</option>
                <option value="banner">بانر</option>
                <option value="announcement">إعلان أو تنبيه</option>
                <option value="alert">رسالة عامة</option>
                <option value="carousel">شريحة متحركة</option>
                <option value="faq">سؤال شائع</option>
                <option value="contact">بيانات تواصل</option>
                <option value="social">رابط تواصل اجتماعي</option>
                <option value="footer">تذييل الموقع</option>
                <option value="background">خلفية</option>
                <option value="section_image">صورة قسم</option>
              </select>
              <Input name="key" required dir="ltr" defaultValue="home-hero" placeholder="home-hero" />
              <Input name="group" required dir="ltr" defaultValue="homepage" placeholder="homepage" />
              <Input name="title" placeholder="العنوان الإداري" />
              <Input name="heading" required placeholder="العنوان الظاهر" />
              <Input name="buttonText" placeholder="نص الزر" />
              <Input name="buttonUrl" dir="ltr" placeholder="/learn" />
              <Input name="secondaryButtonText" placeholder="نص الزر الإضافي" />
              <Input name="secondaryButtonUrl" dir="ltr" placeholder="/about أو https://..." />
              <select name="styleVariant" defaultValue="default" aria-label="نمط العرض">
                <option value="default">افتراضي</option>
                <option value="primary">رئيسي</option>
                <option value="warning">تحذير</option>
                <option value="danger">خطر</option>
                <option value="success">نجاح</option>
                <option value="muted">هادئ</option>
              </select>
              <select name="imageMediaId" defaultValue="" aria-label="صورة المحتوى">
                <option value="">بلا صورة</option>
                {data.media.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.originalName}
                  </option>
                ))}
              </select>
              <select name="status" defaultValue="draft" aria-label="الحالة">
                <option value="draft">مسودة</option>
                <option value="published">منشور</option>
                <option value="archived">مؤرشف</option>
              </select>
              <Input name="sortOrder" type="number" min="0" defaultValue="0" placeholder="الترتيب" />
              <Input name="startsAt" type="datetime-local" aria-label="بداية العرض" />
              <Input name="endsAt" type="datetime-local" aria-label="نهاية العرض" />
              <label>
                <input type="checkbox" name="isVisible" defaultChecked /> ظاهر
              </label>
            </div>
            <Textarea name="text" required maxLength={5000} placeholder="النص الظاهر للزائر" />
            <Textarea name="secondaryText" maxLength={2000} placeholder="نص إضافي أو تفاصيل" />
          </ManagedForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>العناصر المدارة</CardTitle>
        </CardHeader>
        <CardContent className="admin-list">
          {data.siteContent.map((item) => (
            <div className="admin-list-row" key={item.id}>
              <div>
                <b>{item.title || item.key}</b>
                <span dir="ltr">
                  {item.group} / {item.key} · v{item.version}
                </span>
              </div>
              <Status value={item.status} />
              <Button variant="outline" render={<Link href={`/admin/cms/${item.id}/preview`} />}>
                معاينة
              </Button>
            </div>
          ))}
          {!data.siteContent.length && <Empty text="لا يوجد محتوى عام مُدار بعد." />}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>سجل النسخ</CardTitle>
          <CardDescription>الاستعادة تنشئ مسودة جديدة ولا تمحو أي نسخة سابقة.</CardDescription>
        </CardHeader>
        <CardContent className="admin-list">
          {data.siteContentVersions.map((version) => {
            const contentItem = data.siteContent.find((item) => item.id === version.siteContentId)
            return (
              <div className="admin-list-row" key={version.id}>
                <div>
                  <b>{contentItem?.title || contentItem?.key || version.siteContentId}</b>
                  <span>
                    نسخة {version.version} · {version.status} · {formatDate(version.createdAt)}
                  </span>
                </div>
                <ManagedForm
                  compact
                  action={(form) => restoreSiteContentVersion(version.id, String(form.get('reason') ?? ''))}
                  submitLabel="استعادة"
                  confirm="سيتم إنشاء مسودة جديدة من هذه النسخة."
                >
                  <Input name="reason" required minLength={5} placeholder="سبب الاستعادة" />
                </ManagedForm>
              </div>
            )
          })}
          {!data.siteContentVersions.length && <Empty text="لا توجد نسخ محفوظة." />}
        </CardContent>
      </Card>
    </div>
  )
}

function MediaPanel({ data }: { data: Data }) {
  const router = useRouter()
  const params = useSearchParams()
  const view = params.get('view') === 'list' ? 'list' : 'grid'
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const configuredUploadLimit =
    typeof data.settings?.maxUploadMb === 'number' ? Math.min(10, data.settings.maxUploadMb) : 5
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fileInput = form.elements.namedItem('file')
    const files = fileInput instanceof HTMLInputElement ? Array.from(fileInput.files ?? []) : []
    if (!files.length) {
      setResult({ ok: false, message: 'اختر ملفًا واحدًا على الأقل.' })
      return
    }
    const oversized = files.find((file) => file.size > configuredUploadLimit * 1024 * 1024)
    if (oversized) {
      setResult({
        ok: false,
        message: `${oversized.name}: يتجاوز الحد الحالي (${configuredUploadLimit} ميجابايت).`,
      })
      return
    }
    setPending(true)
    setResult(null)
    try {
      const altText = String(new FormData(form).get('altText') ?? '')
      const title = String(new FormData(form).get('title') ?? '')
      const description = String(new FormData(form).get('description') ?? '')
      for (const [index, file] of files.entries()) {
        setResult({ ok: true, message: `جارٍ رفع الملف ${index + 1} من ${files.length}...` })
        const payload = new FormData()
        payload.set('file', file)
        payload.set('altText', altText)
        payload.set('title', title)
        payload.set('description', description)
        const response = await fetch('/api/admin/media', { method: 'POST', body: payload })
        const body = (await response.json()) as { error?: string }
        if (!response.ok) throw new Error(`${file.name}: ${body.error || 'تعذر الرفع.'}`)
      }
      setResult({ ok: true, message: `تم رفع ${files.length} ملف وسائط بأمان.` })
      form.reset()
      router.refresh()
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : 'تعذر الرفع.' })
    } finally {
      setPending(false)
    }
  }
  async function remove(id: string) {
    setPending(true)
    setResult(null)
    try {
      const response = await fetch(`/api/admin/media?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error || 'تعذر الحذف.')
      setResult({ ok: true, message: 'تم حذف الملف.' })
      setDeleteId(null)
      router.refresh()
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : 'تعذر الحذف.' })
    } finally {
      setPending(false)
    }
  }
  async function replace(id: string, file: File | undefined) {
    if (!file) return
    setPending(true)
    setResult(null)
    try {
      const payload = new FormData()
      payload.set('file', file)
      payload.set('replaceId', id)
      const response = await fetch('/api/admin/media', { method: 'POST', body: payload })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error || 'تعذر استبدال الملف.')
      setResult({ ok: true, message: 'تم استبدال الملف مع الحفاظ على كل ارتباطاته.' })
      router.refresh()
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : 'تعذر استبدال الملف.' })
    } finally {
      setPending(false)
    }
  }
  async function copyLink(id: string) {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/api/admin/media?id=${encodeURIComponent(id)}`,
      )
      setResult({ ok: true, message: 'تم نسخ رابط المعاينة الآمن.' })
    } catch {
      setResult({ ok: false, message: 'تعذر نسخ الرابط من هذا المتصفح.' })
    }
  }
  async function updateMetadata(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setPending(true)
    setResult(null)
    try {
      const response = await fetch('/api/admin/media', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          title: values.get('title'),
          description: values.get('description'),
          altText: values.get('altText'),
        }),
      })
      const body = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(body.error || 'تعذر حفظ بيانات الملف.')
      setResult({ ok: true, message: 'تم تحديث عنوان الملف ووصفه ونصه البديل.' })
      router.refresh()
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : 'تعذر حفظ بيانات الملف.' })
    } finally {
      setPending(false)
    }
  }
  const filterQuery = new URLSearchParams(params.toString())
  filterQuery.delete('page')
  return (
    <div className="admin-stack">
      <Card>
        <CardHeader>
          <CardTitle>البحث وعرض المكتبة</CardTitle>
          <CardDescription>
            {data.mediaPagination.total} ملفًا مطابقًا. تظهر بجوار كل مادة الوسائط جميع استخداماتها الحالية.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="admin-filter-form" method="get" action="/admin/media">
            <Input name="search" defaultValue={params.get('search') ?? ''} placeholder="اسم الملف أو وصفه" />
            <select name="mediaType" defaultValue={params.get('mediaType') ?? 'all'} aria-label="نوع الوسائط">
              <option value="all">كل الأنواع</option>
              <option value="image">صور</option>
              <option value="video">فيديو</option>
              <option value="audio">صوت</option>
              <option value="pdf">PDF</option>
            </select>
            <select
              name="pageSize"
              defaultValue={String(data.mediaPagination.pageSize)}
              aria-label="حجم الصفحة"
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
            <select name="view" defaultValue={view} aria-label="طريقة العرض">
              <option value="grid">شبكة</option>
              <option value="list">قائمة</option>
            </select>
            <Button>تطبيق</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>رفع وسائط آمنة</CardTitle>
          <CardDescription>
            صور أو MP4/WebM أو MP3/WAV أو PDF، بحد أقصى {configuredUploadLimit} ميجابايت وفق إعداد المنصة، مع
            فحص التوقيع الفعلي لكل ملف على الخادم.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={upload} className="admin-form">
            <Input
              type="file"
              name="file"
              required
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav,application/pdf"
            />
            <Input name="altText" maxLength={500} placeholder="النص البديل أو وصف الملف" />
            <Input name="title" maxLength={200} placeholder="عنوان الملف (اختياري)" />
            <Textarea name="description" maxLength={2000} placeholder="وصف الملف (اختياري)" />
            {result && <Feedback result={result} />}
            <Button disabled={pending}>{pending ? 'جارٍ التنفيذ...' : 'رفع الصورة'}</Button>
          </form>
        </CardContent>
      </Card>
      <div className={view === 'list' ? 'admin-media-list' : 'admin-card-grid'}>
        {data.media.map((item) => (
          <Card key={item.id}>
            <MediaPreview item={item} />
            <CardHeader>
              <CardTitle>{item.title || item.originalName}</CardTitle>
              <CardDescription>
                {item.mediaType} · {formatBytes(item.sizeBytes)}
              </CardDescription>
            </CardHeader>
            <CardContent className="admin-stack">
              <form className="admin-form" onSubmit={(event) => void updateMetadata(event, item.id)}>
                <Input name="title" maxLength={200} defaultValue={item.title ?? ''} placeholder="العنوان" />
                <Input
                  name="altText"
                  maxLength={500}
                  defaultValue={item.altText ?? ''}
                  placeholder="النص البديل"
                />
                <Textarea
                  name="description"
                  maxLength={2000}
                  defaultValue={item.description ?? ''}
                  placeholder="الوصف"
                />
                <Button size="sm" variant="outline" disabled={pending}>
                  حفظ البيانات
                </Button>
              </form>
              <small>مستخدم في {item.usageCount} موضع.</small>
              <div className="admin-inline-actions">
                <Button variant="outline" size="sm" disabled={pending} onClick={() => void copyLink(item.id)}>
                  نسخ الرابط
                </Button>
                <label className="admin-file-replace">
                  استبدال
                  <input
                    type="file"
                    disabled={pending}
                    accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav,application/pdf"
                    onChange={(event) => void replace(item.id, event.target.files?.[0])}
                  />
                </label>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pending}
                  onClick={() => setDeleteId(item.id)}
                >
                  حذف غير المستخدم
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {!data.media.length && <Empty text="لا توجد وسائط مرفوعة." />}
      {data.mediaPagination.pages > 1 && (
        <nav className="admin-pagination" aria-label="صفحات مكتبة الوسائط">
          <Button
            variant="outline"
            disabled={data.mediaPagination.page <= 1}
            render={
              <Link
                href={`/admin/media?${withPage(filterQuery, Math.max(1, data.mediaPagination.page - 1))}`}
              />
            }
          >
            السابق
          </Button>
          <span>
            {data.mediaPagination.page} / {data.mediaPagination.pages}
          </span>
          <Button
            variant="outline"
            disabled={data.mediaPagination.page >= data.mediaPagination.pages}
            render={
              <Link
                href={`/admin/media?${withPage(
                  filterQuery,
                  Math.min(data.mediaPagination.pages, data.mediaPagination.page + 1),
                )}`}
              />
            }
          >
            التالي
          </Button>
        </nav>
      )}
      <ConfirmationDialog
        open={Boolean(deleteId)}
        description="هل تريد حذف ملف الوسائط غير المستخدم؟ لا يمكن التراجع عن هذه العملية."
        pending={pending}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => deleteId && void remove(deleteId)}
      />
    </div>
  )
}

function MediaPreview({ item }: { item: Data['media'][number] }) {
  const source = `/api/admin/media?id=${encodeURIComponent(item.id)}`
  if (item.mediaType.startsWith('image/'))
    return (
      <NextImage
        unoptimized
        width={640}
        height={360}
        className="admin-media-preview"
        src={source}
        alt={item.altText || item.originalName}
      />
    )
  if (item.mediaType.startsWith('video/'))
    return <video className="admin-media-preview" controls preload="metadata" src={source} />
  if (item.mediaType.startsWith('audio/'))
    return <audio className="admin-media-audio" controls preload="metadata" src={source} />
  return (
    <Button variant="outline" render={<a href={source} target="_blank" rel="noreferrer" />}>
      معاينة PDF
    </Button>
  )
}

function AuditPanel({ data }: { data: Data }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>سجل العمليات الإدارية</CardTitle>
        <CardDescription>قراءة فقط؛ لا توجد واجهة لتعديل أو حذف السجل.</CardDescription>
      </CardHeader>
      <CardContent className="admin-table-wrap">
        <table className="admin-data-table">
          <thead>
            <tr>
              <th>العملية</th>
              <th>العنصر</th>
              <th>السبب</th>
              <th>الوقت</th>
            </tr>
          </thead>
          <tbody>
            {data.audits.map((item) => (
              <tr key={item.id}>
                <td>{item.action}</td>
                <td>
                  {item.entityType}
                  {item.entityId ? ` · ${item.entityId}` : ''}
                </td>
                <td>{item.reason || '—'}</td>
                <td>{formatDate(item.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.audits.length && <Empty text="لا توجد عمليات مسجلة بعد." />}
      </CardContent>
    </Card>
  )
}

function SettingsPanel({ data }: { data: Data }) {
  const settings = data.settings ?? {}
  const text = (key: string, fallback: string) =>
    typeof settings[key] === 'string' ? String(settings[key]) : fallback
  const checked = (key: string, fallback: boolean) =>
    typeof settings[key] === 'boolean' ? Boolean(settings[key]) : fallback
  const number = (key: string, fallback: number) =>
    typeof settings[key] === 'number' ? Number(settings[key]) : fallback
  return (
    <div className="admin-stack">
      <Card>
        <CardHeader>
          <CardTitle>إعدادات المنصة</CardTitle>
          <CardDescription>قيم عامة محفوظة في قاعدة البيانات، ولا تتضمن أي أسرار.</CardDescription>
        </CardHeader>
        <CardContent>
          <ManagedForm
            action={updatePlatformSettings}
            submitLabel="حفظ الإعدادات"
            confirm="هل تريد تطبيق إعدادات المنصة؟"
          >
            <div className="admin-form-grid">
              <Input
                name="siteName"
                required
                minLength={2}
                defaultValue={text('siteName', 'أكاديمية زايد التعليمية')}
                placeholder="اسم الموقع"
              />
              <Input
                name="siteDescription"
                defaultValue={text('siteDescription', '')}
                placeholder="وصف الموقع"
              />
              <select
                name="timezone"
                defaultValue={text('timezone', 'Africa/Cairo')}
                aria-label="المنطقة الزمنية"
              >
                <option value="Africa/Cairo">القاهرة</option>
                <option value="Asia/Riyadh">الرياض</option>
                <option value="UTC">UTC</option>
              </select>
              <select
                name="defaultLanguage"
                defaultValue={text('defaultLanguage', 'ar')}
                aria-label="اللغة الافتراضية"
              >
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
              <Input
                name="maxUploadMb"
                type="number"
                min="1"
                max="10"
                defaultValue={number('maxUploadMb', 5)}
                aria-label="حد رفع الملفات بالميجابايت"
              />
              <label>
                <input type="checkbox" name="arabicEnabled" defaultChecked={checked('arabicEnabled', true)} />{' '}
                العربية مفعلة
              </label>
              <label>
                <input
                  type="checkbox"
                  name="englishEnabled"
                  defaultChecked={checked('englishEnabled', true)}
                />{' '}
                الإنجليزية مفعلة
              </label>
              <label>
                <input
                  type="checkbox"
                  name="registrationEnabled"
                  defaultChecked={checked('registrationEnabled', true)}
                />{' '}
                التسجيل متاح
              </label>
              <label>
                <input
                  type="checkbox"
                  name="maintenanceMode"
                  defaultChecked={checked('maintenanceMode', false)}
                />{' '}
                وضع الصيانة
              </label>
            </div>
          </ManagedForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>سياسة الدخول الإداري</CardTitle>
        </CardHeader>
        <CardContent className="admin-metric-list">
          <Metric label="الحساب الوحيد" value={SOLE_ADMIN_EMAIL} />
          <Metric label="الدور المطلوب" value="SUPER_ADMIN / admin" />
          <Metric label="توثيق البريد" value="إلزامي" />
          <Metric label="Allowlist قاعدة البيانات" value="إلزامية ونشطة" />
        </CardContent>
      </Card>
      <Alert>
        <AlertDescription>
          تغيير البريد الإداري يتطلب تعديلًا مقصودًا للسياسة والترحيل، وليس قيمة يرسلها المتصفح. لا توجد
          صلاحية isAdmin قابلة للحقن من الواجهة.
        </AlertDescription>
      </Alert>
    </div>
  )
}

function BackupPanel() {
  return (
    <div className="admin-stack">
      <Alert>
        <AlertDescription>
          النسخة الكاملة تشمل بيانات المنصة وملفات Vercel Blob، وتستبعد كلمات المرور والجلسات والرموز السرية ومفاتيح البيئة.
        </AlertDescription>
      </Alert>
      <BackupActions />
    </div>
  )
}

function BackupActions() {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<Result | null>(null)
  function download() {
    startTransition(async () => {
      try {
        const response = await createBackupDownload()
        window.location.assign(response.downloadUrl)
        setResult({ ok: true, message: `${response.message} (${response.records} سجل)` })
      } catch (error) {
        setResult({ ok: false, message: error instanceof Error ? error.message : 'تعذر إنشاء النسخة.' })
      }
    })
  }
  function email() {
    startTransition(async () => {
      try {
        const response = await createAndEmailBackup()
        setResult(response)
      } catch (error) {
        setResult({ ok: false, message: error instanceof Error ? error.message : 'تعذر إرسال النسخة.' })
      }
    })
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>النسخة الاحتياطية الكاملة</CardTitle>
        <CardDescription>
          أنشئ نسخة ZIP قابلة للحفظ أو أرسلها مباشرة إلى enaad4786@gmail.com. إذا كان الحجم كبيرًا، تصل الرسالة برابط تنزيل آمن صالح 7 أيام.
        </CardDescription>
      </CardHeader>
      <CardContent className="admin-stack-sm">
        {result && <Feedback result={result} />}
        <div className="admin-row">
          <Button type="button" disabled={pending} onClick={download}>
            تنزيل نسخة ZIP كاملة
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={email}>
            إنشاء وإرسال إلى enaad4786@gmail.com
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ManagedForm({
  action,
  submitLabel,
  children,
  confirm,
  compact = false,
}: {
  action: FormAction
  submitLabel: string
  children: ReactNode
  confirm?: string
  compact?: boolean
}) {
  const ref = useRef<HTMLFormElement>(null)
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<Result | null>(null)
  const [queuedPayload, setQueuedPayload] = useState<FormData | null>(null)
  function execute(payload: FormData) {
    setResult(null)
    startTransition(async () => {
      try {
        const response = await action(payload)
        setResult(response)
        if (response.ok && !compact) ref.current?.reset()
        if (response.ok) router.refresh()
      } catch (error) {
        setResult({ ok: false, message: error instanceof Error ? error.message : 'تعذر تنفيذ العملية.' })
      } finally {
        setQueuedPayload(null)
      }
    })
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const payload = new FormData(form)
    if (confirm) {
      setQueuedPayload(payload)
      return
    }
    execute(payload)
  }
  return (
    <>
      <form ref={ref} onSubmit={submit} className={compact ? 'admin-form compact' : 'admin-form'}>
        {children}
        {result && <Feedback result={result} />}
        <Button size={compact ? 'sm' : 'default'} disabled={pending}>
          {pending ? 'جارٍ التنفيذ...' : submitLabel}
        </Button>
      </form>
      {confirm && (
        <ConfirmationDialog
          open={Boolean(queuedPayload)}
          description={confirm}
          pending={pending}
          onCancel={() => setQueuedPayload(null)}
          onConfirm={() => queuedPayload && execute(queuedPayload)}
        />
      )}
    </>
  )
}

function ActionButton({ action, label }: { action: () => Promise<Result>; label: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<Result | null>(null)
  return (
    <span className="admin-inline-action">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              const response = await action()
              setResult(response)
              if (response.ok) router.refresh()
            } catch (error) {
              setResult({
                ok: false,
                message: error instanceof Error ? error.message : 'تعذر تنفيذ العملية.',
              })
            }
          })
        }
      >
        {pending ? '...' : label}
      </Button>
      {result && <span role="status">{result.message}</span>}
    </span>
  )
}
function Feedback({ result }: { result: Result }) {
  return (
    <Alert variant={result.ok ? 'default' : 'destructive'}>
      <AlertDescription>{result.message}</AlertDescription>
    </Alert>
  )
}
function Kpi({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  hint?: string
}) {
  return (
    <Card className="admin-kpi">
      <CardContent>
        <span className="admin-kpi-icon">{icon}</span>
        <div>
          <span>{label}</span>
          <strong>{value}</strong>
          {hint && <small>{hint}</small>}
        </div>
      </CardContent>
    </Card>
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
function Status({ value }: { value: string }) {
  return (
    <Badge
      variant={
        ['active', 'published', 'open', 'scheduled'].includes(value)
          ? 'default'
          : ['banned', 'cancelled', 'archived'].includes(value)
            ? 'destructive'
            : 'secondary'
      }
    >
      {translateStatus(value)}
    </Badge>
  )
}
function Empty({ text }: { text: string }) {
  return (
    <div className="admin-empty">
      <FileText aria-hidden="true" />
      <p>{text}</p>
    </div>
  )
}
function SimpleList({
  title,
  rows,
  empty,
}: {
  title: string
  rows: Array<{ title: string; meta: string }>
  empty: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="admin-list">
        {rows.map((row, index) => (
          <div className="admin-list-row" key={`${row.title}-${index}`}>
            <div>
              <b>{row.title}</b>
              <span>{row.meta}</span>
            </div>
          </div>
        ))}
        {!rows.length && <Empty text={empty} />}
      </CardContent>
    </Card>
  )
}
function TrendChart({ data }: { data: Data['trend'] }) {
  if (!data.length) return <Empty text="لا توجد بيانات زمنية بعد." />
  return (
    <div className="admin-chart" role="img" aria-label="رسم التسجيلات والنشاط لآخر ثلاثين يومًا">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="registrations" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
              <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tickFormatter={(value) => String(value).slice(5)} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Area
            type="monotone"
            dataKey="registrations"
            name="التسجيلات"
            stroke="#2563eb"
            fill="url(#registrations)"
          />
          <Area type="monotone" dataKey="activities" name="الأنشطة" stroke="#14b8a6" fill="transparent" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
function Pagination({ current, pages }: { current: number; pages: number }) {
  const params = useSearchParams()
  if (pages <= 1) return null
  function href(page: number) {
    const next = new URLSearchParams(params.toString())
    next.set('page', String(page))
    return `/admin/users?${next}`
  }
  return (
    <nav className="admin-pagination" aria-label="صفحات المستخدمين">
      <Button
        variant="outline"
        disabled={current <= 1}
        render={<Link href={href(Math.max(1, current - 1))} />}
      >
        السابق
      </Button>
      <span>
        {current} / {pages}
      </span>
      <Button
        variant="outline"
        disabled={current >= pages}
        render={<Link href={href(Math.min(pages, current + 1))} />}
      >
        التالي
      </Button>
    </nav>
  )
}
function percentageChange(current: number, previous: number) {
  if (!previous) return current ? 100 : 0
  return Math.round(((current - previous) / previous) * 100)
}
function numberFromRecord(value: Record<string, unknown> | null, key: string, fallback = 0) {
  const candidate = value?.[key]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback
}
function withPage(params: URLSearchParams, page: number) {
  const next = new URLSearchParams(params)
  next.set('page', String(page))
  return next.toString()
}
function structuredContentSummary(value: Record<string, unknown> | null) {
  if (!value) return 'بلا نص منظم.'
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  const prompt = typeof value.questionPrompt === 'string' ? value.questionPrompt.trim() : ''
  const instructions = typeof value.instructions === 'string' ? value.instructions.trim() : ''
  const summary = text || prompt || instructions
  return summary ? `${summary.slice(0, 240)}${summary.length > 240 ? '…' : ''}` : 'بلا نص منظم.'
}
function stringFromRecord(value: Record<string, unknown> | null, key: string) {
  const candidate = value?.[key]
  return typeof candidate === 'string' ? candidate : ''
}
function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function localInputDate(value: Date | string | null) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
function formatBytes(value: number) {
  return value < 1024 * 1024 ? `${Math.ceil(value / 1024)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`
}
function translateStatus(value: string) {
  return (
    (
      {
        active: 'نشط',
        disabled: 'معطل',
        suspended: 'موقوف',
        banned: 'محظور',
        draft: 'مسودة',
        published: 'منشور',
        archived: 'مؤرشف',
        scheduled: 'مجدول',
        open: 'مفتوح',
        paused: 'متوقف',
        ended: 'منتهٍ',
        cancelled: 'ملغي',
        legacy: 'قديم',
      } as Record<string, string>
    )[value] ?? value
  )
}
