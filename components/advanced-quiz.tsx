'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { startWordQuiz, submitWordQuiz } from '@/app/actions'
import type { QuizDirection, WordQuizMode } from '@/lib/quiz-engine'
import { publicActionError } from '@/lib/public-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  AudioLines,
  Check,
  ChevronLeft,
  Clock,
  Keyboard,
  Languages,
  ListChecks,
  RotateCw,
  Shuffle,
  Target,
  X,
} from 'lucide-react'

type WordSummary = { id: number }
type SafeQuestion = {
  id: string
  prompt: string
  options: string[] | null
  example: string | null
  spokenText: string | null
}
type QuizSession = {
  attemptId: string
  mode: WordQuizMode
  status: string
  questions: SafeQuestion[]
}
type QuizResult = { score: number; correctAnswers: number; questionCount: number }
type Answer = { questionId: string; answer: string }

const modes: Array<{ id: WordQuizMode; title: string; desc: string; icon: typeof ListChecks }> = [
  { id: 'meaning-choice', title: 'اختيار المعنى', desc: 'الكلمة مع أربع معانٍ', icon: ListChecks },
  { id: 'word-choice', title: 'اختيار الكلمة', desc: 'المعنى مع أربع كلمات', icon: Languages },
  { id: 'type-word', title: 'كتابة الكلمة', desc: 'اكتب الكلمة من معناها', icon: Keyboard },
  { id: 'type-meaning', title: 'كتابة المعنى', desc: 'اكتب معنى الكلمة', icon: Keyboard },
  { id: 'letters', title: 'ترتيب الحروف', desc: 'أعد بناء الكلمة', icon: Shuffle },
  { id: 'true-false', title: 'صح أو خطأ', desc: 'تحقق من المعنى', icon: Check },
  { id: 'complete-example', title: 'أكمل المثال', desc: 'الكلمة الناقصة في السياق', icon: RotateCw },
  { id: 'audio', title: 'اختبار صوتي', desc: 'استمع ثم اختر المعنى', icon: AudioLines },
  { id: 'speed', title: 'اختبار سرعة', desc: '15 ثانية لكل سؤال', icon: Clock },
  { id: 'review', title: 'اختبار مراجعة', desc: 'من كل ما تعلمته', icon: Target },
  { id: 'difficult', title: 'الكلمات الصعبة', desc: 'الكلمات عالية الصعوبة', icon: Target },
  { id: 'mistakes', title: 'كلمات الأخطاء', desc: 'ما أخطأت به سابقًا', icon: X },
]

export function AdvancedQuiz({ words }: { words: WordSummary[] }) {
  const [language, setLanguage] = useState<'en' | 'ar'>('en')
  const [direction, setDirection] = useState<QuizDirection>('en-ar')
  const [count, setCount] = useState(10)
  const [session, setSession] = useState<QuizSession | null>(null)
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [input, setInput] = useState('')
  const [result, setResult] = useState<QuizResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [remaining, setRemaining] = useState(15)
  const [retryAnswers, setRetryAnswers] = useState<Answer[] | null>(null)
  const locked = useRef(false)

  async function begin(mode: WordQuizMode) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const created = await startWordQuiz({
        requestKey: crypto.randomUUID(),
        mode,
        language,
        direction,
        count,
      })
      if (created.status !== 'active' || !created.questions.length) throw new Error('تعذر بدء محاولة جديدة.')
      setSession(created)
      setIndex(0)
      setAnswers([])
      setResult(null)
      setRetryAnswers(null)
      setRemaining(15)
    } catch (caught) {
      setError(publicActionError(caught, 'تعذر بدء الاختبار.'))
    } finally {
      setBusy(false)
    }
  }

  const finish = useCallback(
    async (finalAnswers: Answer[]) => {
      if (!session) return
      setBusy(true)
      setError('')
      try {
        const response = await submitWordQuiz(session.attemptId, finalAnswers)
        setResult({
          score: response.score,
          correctAnswers: response.correctAnswers,
          questionCount: response.questionCount,
        })
        setRetryAnswers(null)
      } catch (caught) {
        setRetryAnswers(finalAnswers)
        setError(publicActionError(caught, 'تعذر حفظ النتيجة. يمكنك إعادة المحاولة بأمان.'))
      } finally {
        locked.current = false
        setBusy(false)
      }
    },
    [session],
  )

  const submitAnswer = useCallback(
    (value: string) => {
      if (!session || locked.current || busy) return
      locked.current = true
      const question = session.questions[index]
      const next = [...answers, { questionId: question.id, answer: value }]
      setAnswers(next)
      setInput('')
      if (index === session.questions.length - 1) {
        void finish(next)
        return
      }
      setIndex((current) => current + 1)
      setRemaining(15)
      locked.current = false
    },
    [answers, busy, finish, index, session],
  )

  useEffect(() => {
    if (session?.mode !== 'speed' || result || busy) return
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          window.clearInterval(timer)
          queueMicrotask(() => submitAnswer(''))
          return 0
        }
        return value - 1
      })
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [session?.attemptId, session?.mode, index, result, busy, submitAnswer])

  if (result) {
    return (
      <main className="result-center">
        <div className="score-ring">
          <strong>{result.score}%</strong>
          <span>نتيجتك</span>
        </div>
        <h1>{result.score >= 80 ? 'أداء متقن' : 'المراجعة تصنع الإتقان'}</h1>
        <p>
          {result.correctAnswers} إجابة صحيحة من {result.questionCount}
        </p>
        <div className="hero-actions">
          <Button
            onClick={() => {
              setSession(null)
              setResult(null)
              setAnswers([])
            }}
          >
            اختبار جديد
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/mistakes" />}>
            راجع أخطاءك
          </Button>
        </div>
      </main>
    )
  }

  if (!session) {
    return (
      <main>
        <div className="quiz-heading">
          <div>
            <p className="eyebrow">قسم الاختبارات · 12 نمطًا للتقييم</p>
            <h1>اختر نوع الاختبار</h1>
            <p>الأسئلة تصدر من الخادم، وتُصحح وتُكافأ مرة واحدة فقط.</p>
          </div>
          <div className="study-controls">
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as 'en' | 'ar')}
              disabled={busy}
              aria-label="لغة الاختبار"
            >
              <option value="en">الإنجليزية</option>
              <option value="ar">العربية</option>
            </select>
            {language === 'en' && (
              <select
                value={direction}
                onChange={(event) => setDirection(event.target.value as QuizDirection)}
                disabled={busy}
                aria-label="اتجاه الترجمة"
              >
                <option value="en-ar">English → Arabic</option>
                <option value="en-en">English → English</option>
              </select>
            )}
            <select
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              disabled={busy}
              aria-label="عدد الأسئلة"
            >
              <option value="5">5 أسئلة</option>
              <option value="10">10 أسئلة</option>
              <option value="20">20 سؤالًا</option>
              <option value="50">50 سؤالًا</option>
            </select>
          </div>
        </div>
        {error && (
          <p className="form-message error" role="alert">
            {error}
          </p>
        )}
        <section className="quiz-mode-grid">
          {modes.map(({ id, title, desc, icon: Icon }) => (
            <button key={id} onClick={() => void begin(id)} disabled={busy || !words.length}>
              <span>
                <Icon />
              </span>
              <b>{title}</b>
              <small>{busy ? 'جارٍ التجهيز...' : desc}</small>
            </button>
          ))}
        </section>
      </main>
    )
  }

  if (retryAnswers) {
    return (
      <main>
        <Card>
          <CardContent className="empty-language">
            <h1>تعذر حفظ النتيجة</h1>
            <p role="alert">{error}</p>
            <Button onClick={() => void finish(retryAnswers)} disabled={busy}>
              {busy ? 'جارٍ إعادة المحاولة...' : 'إعادة إرسال النتيجة بأمان'}
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const question = session.questions[index]
  const choiceMode = Boolean(question.options?.length)
  return (
    <main className="quiz-play">
      <div className="quiz-top">
        <Badge>{modes.find((mode) => mode.id === session.mode)?.title}</Badge>
        <span>
          {index + 1} من {session.questions.length}
        </span>
        {session.mode === 'speed' && <strong aria-live="polite">{remaining} ث</strong>}
      </div>
      <Progress value={((index + 1) / session.questions.length) * 100} />
      <Card className="quiz-question">
        <CardContent>
          {session.mode === 'audio' ? (
            <>
              <button
                className="audio-prompt"
                onClick={() => speak(question.spokenText ?? '', language, setError)}
                aria-label="تشغيل الكلمة"
              >
                <AudioLines />
              </button>
              <p>استمع جيدًا ثم اختر المعنى الصحيح</p>
            </>
          ) : (
            <>
              <small>السؤال</small>
              <h2 dir={language === 'ar' ? 'rtl' : 'ltr'}>{question.prompt}</h2>
            </>
          )}
          {question.example && <p className="quiz-example">{question.example}</p>}
        </CardContent>
      </Card>
      {choiceMode ? (
        <div className="answers">
          {question.options!.map((option) => (
            <button key={option} onClick={() => submitAnswer(option)} disabled={busy}>
              {option}
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submitAnswer(input)
          }}
          className="typing-answer"
        >
          <Input aria-label="اكتب إجابتك هنا"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            autoFocus
            dir={language === 'ar' ? 'rtl' : 'ltr'}
            placeholder="اكتب إجابتك هنا"
            disabled={busy}
          />
          <Button disabled={busy || !input.trim()}>
            تأكيد الإجابة <ChevronLeft />
          </Button>
        </form>
      )}
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
    </main>
  )
}

function speak(text: string, language: 'en' | 'ar', onError: (message: string) => void) {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    onError('ميزة النطق غير مدعومة في هذا المتصفح. استخدم متصفحًا حديثًا أو اختر نمطًا آخر.')
    return
  }
  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = language === 'ar' ? 'ar-SA' : 'en-US'
    utterance.onerror = () => onError('تعذر تشغيل الصوت على هذا الجهاز.')
    window.speechSynthesis.speak(utterance)
  } catch {
    onError('تعذر تشغيل الصوت على هذا الجهاز.')
  }
}
