'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { addBulk, addSentence, addWord, deleteWord, toggleFavorite } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog'
import {
  BookOpen,
  BookText,
  Brain,
  Check,
  ChevronLeft,
  Download,
  Heart,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
  Trophy,
} from 'lucide-react'
import { AdvancedQuiz } from '@/components/advanced-quiz'
import { neutralizeSpreadsheetCell } from '@/lib/export-security'
type W = {
  id: number
  word: string
  meaning: string
  category: string
  status: string
  isFavorite: boolean
  mistakeCount: number
  correctCount: number
  createdAt: Date
}
type S = { id: number; sentence: string; translation: string; category: string; createdAt: Date }
type T = { id: number; score: number; correctAnswers: number; wrongAnswers: number; completedAt: Date }
type StudioData = {
  words: W[]
  sentences: S[]
  tests: T[]
  siteContent?: Record<string, Record<string, unknown>>
}
export function Studio({ view, data }: { view: string; data: StudioData }) {
  const [pending, start] = useTransition()
  if (view === 'dashboard') return <Dashboard data={data} />
  if (view === 'add') return <Add start={start} />
  if (view === 'quiz') return <AdvancedQuiz words={data.words} />
  if (view === 'results') return <Results data={data} />
  return <Bank kind={view} data={data} start={start} pending={pending} />
}
function PageTitle({
  kicker,
  title,
  desc,
  action,
}: {
  kicker: string
  title: string
  desc: string
  action?: React.ReactNode
}) {
  return (
    <div className="page-title">
      <div>
        <p>{kicker}</p>
        <h1>{title}</h1>
        <span>{desc}</span>
      </div>
      {action}
    </div>
  )
}
function Dashboard({ data }: { data: StudioData }) {
  const mistakes = data.words.filter((w) => w.mistakeCount > 0),
    mastered = data.words.filter((w) => w.status === 'mastered').length,
    last = data.tests[0],
    correct = data.tests.reduce((a, t) => a + t.correctAnswers, 0),
    total = data.tests.reduce((a, t) => a + t.correctAnswers + t.wrongAnswers, 0),
    rate = total ? Math.round((correct / total) * 100) : 0,
    managedHero = data.siteContent?.['home-hero']
  return (
    <main>
      {managedHero && <ManagedHero content={managedHero} />}
      <section className={`hero${managedHero ? ' cms-fallback-hidden' : ''}`}>
        <div>
          <p className="eyebrow">خطوتك اليومية نحو الطلاقة</p>
          <h1>
            ابنِ حصيلتك،
            <br />
            <em>كلمة بعد كلمة.</em>
          </h1>
          <p>لديك اليوم فرصة جديدة لإتقان ما تعلمته.</p>
          <div className="hero-actions">
            <Button render={<Link href="/add" />}>
              <Plus /> أضف كلمات اليوم
            </Button>
            <Button variant="outline" render={<Link href="/quiz" />}>
              <Brain /> ابدأ مراجعة سريعة
            </Button>
          </div>
        </div>
        <div className="daily-ring">
          <span>{data.words.length ? Math.min(100, (mastered / data.words.length) * 100) : 0 | 0}%</span>
          <small>نسبة الإتقان</small>
        </div>
      </section>
      <ManagedContentBlocks content={data.siteContent} />
      <section className="stats-grid">
        <Stat icon={<BookOpen />} n={data.words.length} label="إجمالي الكلمات" note="حصيلتك الحالية" />
        <Stat icon={<BookText />} n={data.sentences.length} label="إجمالي الجمل" note="جمل محفوظة" />
        <Stat icon={<Target />} n={mistakes.length} label="تحتاج مراجعة" note="ركز عليها اليوم" />
        <Stat
          icon={<Trophy />}
          n={`${rate}%`}
          label="النسبة التراكمية"
          note={`${data.tests.length} اختبارات`}
        />
      </section>
      <div className="dashboard-grid">
        <Card>
          <CardHeader>
            <CardTitle>آخر الكلمات المضافة</CardTitle>
            <CardDescription>أحدث ما أضفته إلى حصيلتك</CardDescription>
          </CardHeader>
          <CardContent>
            {data.words.slice(0, 5).map((w) => (
              <div className="mini-row" key={w.id}>
                <div>
                  <b dir="ltr">{w.word}</b>
                  <span>{w.meaning}</span>
                </div>
              </div>
            ))}
            {!data.words.length && <Empty text="ابدأ بإضافة أول كلمة إلى بنكك" />}
          </CardContent>
        </Card>
        <Card className="focus-card">
          <CardHeader>
            <CardTitle>مراجعة اليوم</CardTitle>
            <CardDescription>جلسة قصيرة تصنع فرقاً كبيراً</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="focus-number">
              {Math.min(10, data.words.length)}
              <small>كلمات جاهزة</small>
            </div>
            <Progress value={data.words.length ? 65 : 0} />
            <Button render={<Link href="/quiz" />}>
              ابدأ الآن <ChevronLeft />
            </Button>
            {last && (
              <p>
                آخر اختبار: <b>{last.score}%</b>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function ManagedContentBlocks({ content }: { content?: Record<string, Record<string, unknown>> }) {
  const entries = Object.entries(content ?? {}).filter(([key]) => key !== 'home-hero')
  if (!entries.length) return null
  return (
    <section className="admin-card-grid" aria-label="محتوى الموقع المنشور">
      {entries.map(([key, item]) => {
        const type = typeof item.type === 'string' ? item.type : 'welcome'
        const heading = typeof item.heading === 'string' ? item.heading : ''
        const text = typeof item.text === 'string' ? item.text : ''
        const mediaId = typeof item.imageMediaId === 'string' ? item.imageMediaId : null
        if (type === 'faq')
          return (
            <Card key={key}>
              <CardContent>
                <details>
                  <summary>{heading}</summary>
                  <p>{text}</p>
                </details>
              </CardContent>
            </Card>
          )
        return (
          <Card key={key} className={`cms-block cms-${type}`}>
            {mediaId && (
              <Image
                src={`/api/media/${encodeURIComponent(mediaId)}`}
                alt={heading || text.slice(0, 120)}
                width={960}
                height={540}
                loading="lazy"
                className="admin-media-preview"
              />
            )}
            <CardHeader>
              {heading && <CardTitle>{heading}</CardTitle>}
              {text && <CardDescription>{text}</CardDescription>}
            </CardHeader>
            {(typeof item.buttonText === 'string' || typeof item.secondaryText === 'string') && (
              <CardContent className="admin-row">
                {typeof item.buttonText === 'string' && item.buttonText && (
                  <Button render={<Link href={safeCmsHref(item.buttonUrl, '/')} />}>{item.buttonText}</Button>
                )}
                {typeof item.secondaryText === 'string' && item.secondaryText && <p>{item.secondaryText}</p>}
              </CardContent>
            )}
          </Card>
        )
      })}
    </section>
  )
}

function safeCmsHref(value: unknown, fallback: string) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : fallback
}

function ManagedHero({ content }: { content: Record<string, unknown> }) {
  const text = (key: string, fallback: string) =>
    typeof content[key] === 'string' && content[key].trim() ? content[key].trim() : fallback
  const href = (key: string, fallback: string) => {
    const value = text(key, fallback)
    return value.startsWith('/') && !value.startsWith('//') ? value : fallback
  }
  const preferred = (primary: string, legacy: string, fallback: string) =>
    text(primary, '') || text(legacy, fallback)
  return (
    <section className="hero cms-managed-hero">
      <div>
        <p className="eyebrow">{text('eyebrow', 'خطوتك اليومية نحو الإتقان')}</p>
        <h1>
          {preferred('heading', 'title', 'ابنِ مهاراتك')}
          <br />
          <em>{text('emphasis', 'خطوة بعد خطوة.')}</em>
        </h1>
        <p>{preferred('text', 'description', 'واصل التعلم وحقق أهدافك اليومية.')}</p>
        <div className="hero-actions">
          <Button render={<Link href={href('buttonUrl', href('primaryUrl', '/add'))} />}>
            <Plus /> {preferred('buttonText', 'primaryText', 'ابدأ الآن')}
          </Button>
          <Button variant="outline" render={<Link href={href('secondaryUrl', '/quiz')} />}>
            <Brain /> {text('secondaryText', 'مراجعة سريعة')}
          </Button>
        </div>
      </div>
    </section>
  )
}
function Stat({
  icon,
  n,
  label,
  note,
}: {
  icon: React.ReactNode
  n: number | string
  label: string
  note: string
}) {
  return (
    <Card className="stat">
      <CardContent>
        <div className="stat-icon">{icon}</div>
        <strong>{n}</strong>
        <b>{label}</b>
        <small>{note}</small>
      </CardContent>
    </Card>
  )
}
function Bank({
  kind,
  data,
  start,
  pending,
}: {
  kind: string
  data: { words: W[]; sentences: S[] }
  start: React.TransitionStartFunction
  pending: boolean
}) {
  const [q, setQ] = useState(''),
    [filter, setFilter] = useState('all'),
    [deleteId, setDeleteId] = useState<number | null>(null),
    [exportMessage, setExportMessage] = useState('')
  const isSentences = kind === 'sentences',
    mistakes = kind === 'mistakes'
  const list = isSentences
    ? data.sentences.filter((s) => (s.sentence + s.translation).toLowerCase().includes(q.toLowerCase()))
    : data.words.filter(
        (w) =>
          (!mistakes || w.mistakeCount > 0) &&
          (filter === 'all' ||
            (filter === 'favorite' && w.isFavorite) ||
            (filter === 'new' && w.status === 'new') ||
            (filter === 'learning' && w.mistakeCount > 0) ||
            (filter === 'mastered' && w.status === 'mastered')) &&
          (w.word + w.meaning).toLowerCase().includes(q.toLowerCase()),
      )
  return (
    <main>
      <PageTitle
        kicker="مكتبتك الشخصية"
        title={isSentences ? 'بنك الجمل' : mistakes ? 'كلمات أخطأت بها' : 'بنك الكلمات'}
        desc={
          isSentences
            ? 'احفظ العبارات التي تريد استخدامها كل يوم'
            : mistakes
              ? 'كل خطأ هنا فرصة جديدة للإتقان'
              : 'نظّم حصيلتك وراجع تقدم كل كلمة'
        }
        action={
          <Button render={<Link href="/add" />}>
            <Plus /> إضافة جديدة
          </Button>
        }
      />
      <div className="toolbar">
        <div className="search">
          <Search />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالإنجليزية أو العربية..."
          />
        </div>
        {!isSentences && (
          <select aria-label="تصفية الكلمات" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">جميع الكلمات</option>
            <option value="new">الكلمات الجديدة</option>
            <option value="learning">أخطأت بها</option>
            <option value="mastered">الكلمات المتقنة</option>
            <option value="favorite">المفضلة</option>
          </select>
        )}
        <Badge variant="outline">{list.length} عنصر</Badge>
        <Button
          variant="outline"
          onClick={() =>
            void exportData(list, isSentences, 'csv').then((ok) =>
              setExportMessage(ok ? '' : 'لا توجد بيانات لتصديرها'),
            )
          }
        >
          <Download /> CSV
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void exportData(list, isSentences, 'xlsx').then((ok) =>
              setExportMessage(ok ? '' : 'لا توجد بيانات لتصديرها'),
            )
          }
        >
          <Download /> Excel
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            void exportData(list, isSentences, 'pdf').then((ok) =>
              setExportMessage(ok ? '' : 'لا توجد بيانات لتصديرها'),
            )
          }
        >
          <Download /> PDF
        </Button>
      </div>
      {exportMessage && (
        <Alert variant="destructive">
          <AlertDescription>{exportMessage}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent className="bank-list">
          {isSentences
            ? (list as S[]).map((item) => (
                <div className="bank-row" key={item.id}>
                  <div className="word-avatar">Aa</div>
                  <div className="word-main">
                    <b dir="ltr">{item.sentence}</b>
                    <span>{item.translation}</span>
                  </div>
                  <Badge variant="secondary">{item.category}</Badge>
                  <small>{new Date(item.createdAt).toLocaleDateString('ar-EG')}</small>
                </div>
              ))
            : (list as W[]).map((item) => (
                <div className="bank-row" key={item.id}>
                  <div className="word-avatar">{item.word.slice(0, 1).toUpperCase()}</div>
                  <div className="word-main">
                    <b dir="ltr">{item.word}</b>
                    <span>{item.meaning}</span>
                  </div>
                  <Badge variant={item.status === 'mastered' ? 'default' : 'secondary'}>
                    {item.status === 'mastered' ? 'متقنة' : item.mistakeCount ? 'قيد المراجعة' : 'جديدة'}
                  </Badge>
                  {mistakes && (
                    <small>
                      {item.mistakeCount} أخطاء • {item.correctCount} صحيحة
                    </small>
                  )}
                  <button aria-label="المفضلة" onClick={() => start(() => toggleFavorite(item.id))}>
                    <Heart className={item.isFavorite ? 'filled' : ''} />
                  </button>
                  <button aria-label="حذف" disabled={pending} onClick={() => setDeleteId(item.id)}>
                    <Trash2 />
                  </button>
                </div>
              ))}
          {!list.length && <Empty text={q ? 'لا توجد نتائج مطابقة' : 'لا توجد عناصر هنا بعد'} />}
        </CardContent>
      </Card>
      <ConfirmationDialog
        open={deleteId !== null}
        description="هل تريد حذف هذه الكلمة؟ لا يمكن التراجع عن العملية."
        pending={pending}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId === null) return
          start(async () => {
            await deleteWord(deleteId)
            setDeleteId(null)
          })
        }}
      />
    </main>
  )
}
function Add({ start }: { start: React.TransitionStartFunction }) {
  const [tab, setTab] = useState('word'),
    [bulk, setBulk] = useState('')
  return (
    <main>
      <PageTitle
        kicker="مركز الإضافة اليومية"
        title="ماذا تعلّمت اليوم؟"
        desc="سجّل كلماتك وجملك الجديدة، وسنتولى تنظيمها وحفظ تاريخها"
      />
      <div className="segmented">
        <button onClick={() => setTab('word')} className={tab === 'word' ? 'active' : ''}>
          كلمة واحدة
        </button>
        <button onClick={() => setTab('bulk')} className={tab === 'bulk' ? 'active' : ''}>
          عدة كلمات
        </button>
        <button onClick={() => setTab('sentence')} className={tab === 'sentence' ? 'active' : ''}>
          جملة يومية
        </button>
      </div>
      <Card className="add-card">
        <CardHeader>
          <CardTitle>
            {tab === 'word' ? 'أضف كلمة جديدة' : tab === 'bulk' ? 'إضافة مجموعة كلمات' : 'أضف جملة جديدة'}
          </CardTitle>
          <CardDescription>
            {tab === 'bulk'
              ? 'اكتب كل كلمة ومعناها في سطر منفصل باستخدام الشرطة -'
              : 'سيتم تسجيل تاريخ الإضافة تلقائياً'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tab === 'word' && (
            <form
              action={async (form) => {
                await addWord(form)
              }}
              className="form-grid"
            >
              <label>
                الكلمة بالإنجليزية
                <Input name="word" required dir="ltr" placeholder="Protect" />
              </label>
              <label>
                المعنى بالعربية
                <Input name="meaning" required placeholder="يحمي" />
              </label>
              <Button type="submit">
                <Sparkles /> حفظ الكلمة
              </Button>
            </form>
          )}
          {tab === 'sentence' && (
            <form
              action={async (form) => {
                await addSentence(form)
              }}
              className="form-grid"
            >
              <label>
                الجملة بالإنجليزية
                <Input name="sentence" required dir="ltr" placeholder="How was your day?" />
              </label>
              <label>
                الترجمة بالعربية
                <Input name="translation" required placeholder="كيف كان يومك؟" />
              </label>
              <Button type="submit">حفظ الجملة</Button>
            </form>
          )}
          {tab === 'bulk' && (
            <div className="form-stack">
              <Textarea
                dir="ltr"
                rows={9}
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                placeholder={'Protect - يحمي\nChallenge - تحدٍ'}
              />
              <div className="bulk-note">
                <Check /> تم التعرف على {bulk.split('\n').filter((x) => /\s[-–—:]\s/.test(x)).length} كلمات
                جاهزة للإضافة
              </div>
              <Button
                onClick={() =>
                  start(async () => {
                    await addBulk(bulk)
                  })
                }
              >
                إضافة ال��ل إلى البنك
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
function Results({ data }: { data: { words: W[]; tests: T[] } }) {
  const total = data.tests.reduce((a, t) => a + t.correctAnswers + t.wrongAnswers, 0),
    correct = data.tests.reduce((a, t) => a + t.correctAnswers, 0),
    rate = total ? Math.round((correct / total) * 100) : 0
  return (
    <main>
      <PageTitle
        kicker="قسم الإحصائيات · أداؤك بوضوح"
        title="النتائج والإحصائيات"
        desc="راقب تطورك واعرف أين تركز في جلستك القادمة"
      />
      <section className="stats-grid">
        <Stat icon={<Trophy />} n={`${rate}%`} label="النسبة التراكمية" note="من جميع الإجابات" />
        <Stat icon={<Brain />} n={data.tests.length} label="الاختبارات" note="إجمالي المحاولات" />
        <Stat icon={<Check />} n={correct} label="إجابات صحيحة" note={`من ${total} سؤالاً`} />
        <Stat
          icon={<Target />}
          n={data.words.filter((w) => w.status === 'mastered').length}
          label="كلمات متقنة"
          note="تقدم ممتاز"
        />
      </section>
      <Card>
        <CardHeader>
          <CardTitle>سجل الاختبارات</CardTitle>
          <CardDescription>أحدث النتائج المسجلة</CardDescription>
        </CardHeader>
        <CardContent>
          {data.tests.map((t) => (
            <div className="test-row" key={t.id}>
              <div className="score-badge">{t.score}%</div>
              <div>
                <b>اختبار كلمات</b>
                <span>{new Date(t.completedAt).toLocaleDateString('ar-EG')}</span>
              </div>
              <small>
                {t.correctAnswers} صحيحة • {t.wrongAnswers} خاطئة
              </small>
            </div>
          ))}
          {!data.tests.length && <Empty text="ستظهر نتائج اختباراتك هنا" />}
        </CardContent>
      </Card>
    </main>
  )
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <BookOpen />
      <b>{text}</b>
      <Link href="/add">أضف الآن</Link>
    </div>
  )
}
async function exportData(list: Array<W | S>, sentences: boolean, format: 'csv' | 'xlsx' | 'pdf') {
  if (!list.length) {
    return false
  }
  const headers = sentences ? ['Sentence', 'الترجمة'] : ['Word', 'المعنى']
  const rows = sentences
    ? list.map((item) => ('sentence' in item ? [item.sentence, item.translation] : ['', '']))
    : list.map((item) => ('word' in item ? [item.word, item.meaning] : ['', '']))
  const safeRows = rows.map((row) => row.map(neutralizeSpreadsheetCell))
  const name = `lughati-${sentences ? 'sentences' : 'words'}-${new Date().toISOString().slice(0, 10)}`
  if (format === 'csv') {
    const csv =
      '\uFEFF' +
      [headers, ...safeRows].map((r) => r.map((x) => `"${x.replaceAll('"', '""')}"`).join(',')).join('\n')
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${name}.csv`)
    return true
  }
  if (format === 'xlsx') {
    const { default: writeXlsxFile } = await import('write-excel-file/browser')
    const sheet = [headers, ...safeRows].map((row, rowIndex) =>
      row.map((value) => ({
        type: String,
        value,
        fontWeight: rowIndex === 0 ? ('bold' as const) : undefined,
      })),
    )
    await writeXlsxFile(sheet, {
      columns: [{ width: 32 }, { width: 42 }],
      sheet: sentences ? 'Sentences' : 'Words',
    }).toFile(`${name}.xlsx`)
    return true
  }
  printArabicPdf(headers, rows, name)
  return true
}

function printArabicPdf(headers: string[], rows: unknown[][], name: string) {
  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.title = 'معاينة تصدير PDF'
  document.body.append(frame)
  const target = frame.contentDocument
  if (!target || !frame.contentWindow) throw new Error('تعذر فتح معاينة الطباعة في هذا المتصفح.')

  target.open()
  target.write(
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"></head><body></body></html>',
  )
  target.close()
  target.title = name
  const style = target.createElement('style')
  style.textContent =
    '@page{size:A4 landscape;margin:14mm}body{font-family:Tahoma,Arial,sans-serif;color:#173d34}h1{border-bottom:3px solid #d9a928;padding-bottom:12px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #dedbd0;padding:9px;text-align:right;overflow-wrap:anywhere}th{background:#123c32;color:#fff}tr:nth-child(even){background:#f5f2e9}'
  target.head.append(style)
  const heading = target.createElement('h1')
  heading.textContent = 'بنك التعلّم — لُغتي'
  target.body.append(heading)
  const table = target.createElement('table')
  const headRow = table.createTHead().insertRow()
  headers.forEach((value) => {
    const cell = target.createElement('th')
    cell.textContent = value
    headRow.append(cell)
  })
  const body = table.createTBody()
  rows.forEach((row) => {
    const tableRow = body.insertRow()
    row.forEach((value) => {
      const cell = tableRow.insertCell()
      cell.textContent = String(value ?? '')
    })
  })
  target.body.append(table)
  frame.contentWindow.focus()
  frame.contentWindow.print()
  setTimeout(() => frame.remove(), 1_000)
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
