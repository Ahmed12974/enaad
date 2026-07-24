'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Calculator, RotateCcw, Sparkles } from 'lucide-react'
import { getMathQuiz, submitMathQuiz } from '@/app/actions'
import { publicActionError } from '@/lib/public-error'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

type Section = { id: number; slug: string; name: string; description: string | null }
type Question = {
  id: number
  question: string
  option1: string
  option2: string
  option3: string
  option4: string
}
type Result = { score: number; correctAnswers: number; questionCount: number }

export function MathSections({ sections }: { sections: Section[] }) {
  return (
    <main className="math-page">
      <header className="math-hero">
        <div>
          <p className="eyebrow">تعلّم · اختبر · تقدّم</p>
          <h1>اختر مستوى الرياضيات</h1>
          <p>كل محاولة تحفظ مجموعة أسئلتها على الخادم وتُصحح مرة واحدة.</p>
        </div>
        <Calculator />
      </header>
      <section className="math-section-grid">
        {sections.map((section, index) => (
          <Link href={`/math/${section.slug}`} key={section.id} className="math-section-card">
            <span>0{index + 1}</span>
            <Calculator />
            <h2>{section.name}</h2>
            <p>{section.description}</p>
            <b>
              ابدأ اختبارًا <ArrowLeft />
            </b>
          </Link>
        ))}
      </section>
    </main>
  )
}

export function MathQuiz({ slug, name }: { slug: string; name: string }) {
  const [count, setCount] = useState(10)
  const [attemptId, setAttemptId] = useState<number | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Array<{ questionId: number; answer: number }>>([])
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)

  async function begin() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const data = await getMathQuiz(slug, count, crypto.randomUUID())
      if (!data.ok) {
        setError(data.error)
        return
      }
      if (!data.questions.length) {
        setError('لا توجد أسئلة منشورة في هذا القسم بعد.')
        return
      }
      setAttemptId(data.attemptId)
      setQuestions(data.questions)
      setIndex(0)
      setAnswers([])
      setResult(null)
    } catch (caught) {
      setError(publicActionError(caught, 'تعذر بدء الاختبار'))
    } finally {
      setBusy(false)
    }
  }

  async function answer(value: number) {
    if (locked.current || busy || attemptId === null) return
    locked.current = true
    const next = [...answers, { questionId: questions[index].id, answer: value }]
    setAnswers(next)
    if (index < questions.length - 1) {
      setIndex((current) => current + 1)
      locked.current = false
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await submitMathQuiz(attemptId, next)
      setResult(response.attempt)
    } catch (caught) {
      setError(publicActionError(caught, 'تعذر حفظ النتيجة. أعد المحاولة.'))
      locked.current = false
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <main className="math-page result-center">
        <div className="score-ring">
          <strong>{result.score}%</strong>
          <span>نتيجتك</span>
        </div>
        <h1>{result.score >= 80 ? 'إتقان رائع' : 'محاولة جيدة'}</h1>
        <p>
          {result.correctAnswers} إجابة صحيحة من {result.questionCount}
        </p>
        <div className="hero-actions">
          <Button
            onClick={() => {
              setQuestions([])
              setResult(null)
              setAttemptId(null)
              locked.current = false
            }}
          >
            <RotateCcw /> اختبار جديد
          </Button>
          <Button variant="outline" render={<Link href="/math" />}>
            كل الأقسام
          </Button>
        </div>
      </main>
    )
  }

  if (!questions.length) {
    return (
      <main className="math-page">
        <div className="page-title">
          <div>
            <p>بنك الأسئلة</p>
            <h1>{name}</h1>
            <span>اختر عدد الأسئلة لتكوين محاولة محفوظة وآمنة.</span>
          </div>
        </div>
        <Card className="quiz-setup">
          <CardHeader>
            <CardTitle>جهّز اختبارك</CardTitle>
            <CardDescription>التصحيح والمكافأة يتمان داخل معاملة واحدة على الخادم.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="count-options">
              {[5, 10, 20, 30].map((value) => (
                <button
                  key={value}
                  onClick={() => setCount(value)}
                  className={count === value ? 'active' : ''}
                  disabled={busy}
                >
                  {value}
                  <small>أسئلة</small>
                </button>
              ))}
            </div>
            {error && (
              <p className="form-message error" role="alert">
                {error}
              </p>
            )}
            <Button onClick={() => void begin()} disabled={busy}>
              <Sparkles />
              {busy ? 'جارٍ تجهيز الأسئلة...' : 'ابدأ الاختبار'}
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const question = questions[index]
  const options = [question.option1, question.option2, question.option3, question.option4]
  return (
    <main className="math-page math-quiz">
      <div className="quiz-progress">
        <span>
          السؤال {index + 1} من {questions.length}
        </span>
        <b>{Math.round(((index + 1) / questions.length) * 100)}%</b>
      </div>
      <Progress value={((index + 1) / questions.length) * 100} />
      <Card>
        <CardHeader>
          <span className="question-number">
            <BookOpen /> {name}
          </span>
          <CardTitle>{question.question}</CardTitle>
        </CardHeader>
        <CardContent className="math-options">
          {options.map((option, optionIndex) => (
            <button
              key={`${optionIndex}-${option}`}
              onClick={() => void answer(optionIndex + 1)}
              disabled={busy}
            >
              <span>{String.fromCharCode(65 + optionIndex)}</span>
              {option}
            </button>
          ))}
        </CardContent>
      </Card>
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
    </main>
  )
}
