'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Crown, Medal, Timer, Users } from 'lucide-react'
import { getCompetitionQuiz, joinCompetition, submitCompetition } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { publicActionError } from '@/lib/public-error'

type Scope = 'all' | 'en' | 'ar' | 'math'
type Competition = {
  id: number
  title: string
  description: string
  scope: string
  questionCount: number
  xpReward: number
  coinReward: number
  lifecycle: 'active' | 'cancelled' | 'draft' | 'scheduled' | 'ended'
  rules: string | null
  startsAt: Date | null
  endsAt: Date | null
}
type Joined = { competitionId: number; score: number; correctAnswers: number; answers: unknown }
type Leader = { competitionId: number; userId: string; name: string; score: number; correctAnswers: number }
type Question = { id: string; source: 'en' | 'ar' | 'math'; prompt: string; options: string[] }
const scopeName: Record<Scope, string> = {
  all: 'كل الأقسام',
  en: 'اللغة الإنجليزية',
  ar: 'اللغة العربية',
  math: 'الرياضيات',
}
export function CompetitionsHub({
  data,
}: {
  data: { items: Competition[]; joined: Joined[]; leaders: Leader[] }
}) {
  const [joined, setJoined] = useState(data.joined)
  return (
    <main className="competitions-page">
      <header className="competition-hero">
        <div>
          <p className="eyebrow">نافس وتقدّم</p>
          <h1>ساحة المنافسات</h1>
          <p>منافسات العربية والإنجليزية والرياضيات في مكان واحد.</p>
        </div>
        <Crown />
      </header>
      <div className="competition-grid">
        {data.items.map((item) => (
          <CompetitionCard
            key={item.id}
            item={item}
            leaders={data.leaders.filter((leader) => leader.competitionId === item.id).slice(0, 5)}
            joined={joined.find((entry) => entry.competitionId === item.id)}
            onJoined={() =>
              setJoined((previous) => [
                ...previous,
                { competitionId: item.id, score: 0, correctAnswers: 0, answers: null },
              ])
            }
          />
        ))}
      </div>
      {!data.items.length && (
        <div className="challenge-empty">
          <Medal />
          <h2>المنافسات قادمة</h2>
          <p>سيضيف المشرف منافسات جديدة قريباً.</p>
        </div>
      )}
    </main>
  )
}
function CompetitionCard({
  item,
  leaders,
  joined,
  onJoined,
}: {
  item: Competition
  leaders: Leader[]
  joined?: Joined
  onJoined: () => void
}) {
  const [message, setMessage] = useState(''),
    [pending, start] = useTransition(),
    [questions, setQuestions] = useState<Question[]>([]),
    [answers, setAnswers] = useState<Record<string, string>>({}),
    [result, setResult] = useState(
      joined?.answers ? { score: joined.score, correct: joined.correctAnswers } : null,
    )
  const started = questions.length > 0
  function begin() {
    setMessage('')
    start(async () => {
      try {
        if (!joined) {
          const join = await joinCompetition(item.id)
          if (!join.ok) {
            setMessage(join.message || 'تعذر الانضمام')
            return
          }
          onJoined()
        }
        const quiz = await getCompetitionQuiz(item.id)
        if (quiz.completed) {
          setResult({ score: joined?.score || 0, correct: joined?.correctAnswers || 0 })
          return
        }
        setQuestions(quiz.questions)
      } catch (error) {
        setMessage(publicActionError(error, 'تعذر بدء المنافسة.'))
      }
    })
  }
  function submit() {
    if (Object.keys(answers).length !== questions.length) {
      setMessage('أجب عن جميع الأسئلة أولًا.')
      return
    }
    start(async () => {
      try {
        const response = await submitCompetition(
          item.id,
          Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer: String(answer) })),
        )
        setResult({ score: response.score, correct: response.correct })
        setQuestions([])
        setMessage(response.message || 'تم حفظ النتيجة.')
      } catch (error) {
        setMessage(publicActionError(error, 'تعذر حفظ النتيجة.'))
      }
    })
  }
  return (
    <Card className="competition-card">
      <CardHeader>
        <div className="competition-card-top">
          <Badge>
            <Timer /> {scopeName[(item.scope in scopeName ? item.scope : 'math') as Scope]}
          </Badge>
          <span dir="ltr">{item.xpReward} XP · {item.coinReward} عملة</span>
        </div>
        <CardTitle>{item.title}</CardTitle>
        <CardDescription>{item.description}</CardDescription>
        {item.rules && <p className="competition-rules">{item.rules}</p>}
      </CardHeader>
      <CardContent>
        {result ? (
          <div className="competition-result">
            <CheckCircle2 />
            <b>نتيجتك {result.score}%</b>
            <span>
              {result.correct} من {item.questionCount} إجابة صحيحة
            </span>
          </div>
        ) : started ? (
          <div className="competition-quiz">
            {questions.map((question, index) => (
              <fieldset
                key={question.id}
                className="competition-question"
                dir={question.source === 'en' ? 'ltr' : 'rtl'}
              >
                <legend>
                  <span>{index + 1}</span>
                  {question.prompt}
                </legend>
                {question.options.map((option) => (
                  <label key={option} className={answers[question.id] === option ? 'selected' : ''}>
                    <input
                      type="radio"
                      name={question.id}
                      value={option}
                      checked={answers[question.id] === option}
                      onChange={() => setAnswers((previous) => ({ ...previous, [question.id]: option }))}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            <Button onClick={submit} disabled={pending}>
              {pending ? 'جارٍ التصحيح...' : 'إنهاء المنافسة'}
            </Button>
          </div>
        ) : (
          <>
            <div className="competition-meta">
              <span>
                <Users /> {leaders.length} في لوحة الصدارة
              </span>
              <span>{item.questionCount} سؤال</span>
              {item.startsAt && <span>البداية: {new Date(item.startsAt).toLocaleString('ar-EG')}</span>}
            </div>
            <div className="leaderboard">
              <b>
                <Crown /> لوحة المتصدرين
              </b>
              {leaders.map((leader, index) => (
                <div key={leader.userId}>
                  <span>{index + 1}</span>
                  <strong>{leader.name}</strong>
                  <small>{leader.score}%</small>
                </div>
              ))}
              {!leaders.length && <p>كن أول المشاركين في هذه المنافسة.</p>}
            </div>
            <Button onClick={begin} disabled={pending}>
              {pending ? 'جارٍ تجهيز الأسئلة...' : joined ? 'ابدأ المنافسة' : 'انضم وابدأ'}
            </Button>
          </>
        )}
        {message && (
          <p className="inline-message" role="status">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
