'use client'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ArrowLeft, ArrowRight, Eye, RotateCcw, Speaker, Volume1 } from 'lucide-react'
type Word = {
  id: number
  language: string
  word: string
  meaning: string
  englishMeaning: string | null
  arabicExplanation: string | null
  englishExplanation: string | null
  arabicExample: string | null
  englishExample: string | null
  level: string
  category: string
  reviewCount: number
}
export function StudySession({ words, initialLanguage }: { words: Word[]; initialLanguage: 'en' | 'ar' }) {
  const language = initialLanguage
  const [mode, setMode] = useState<'translation' | 'definition'>('translation'),
    [index, setIndex] = useState(0),
    [revealed, setRevealed] = useState(false)
  const deck = useMemo(() => words.filter((w) => w.language === language), [words, language])
  const word = deck[index % Math.max(1, deck.length)]
  function speak(rate = 1, accent = 'US') {
    if (!word || !('speechSynthesis' in window)) return
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(word.word)
    u.lang = language === 'ar' ? 'ar-SA' : accent === 'GB' ? 'en-GB' : 'en-US'
    u.rate = rate
    speechSynthesis.speak(u)
  }
  function move(direction: number) {
    setIndex((i) => (i + direction + deck.length) % deck.length)
    setRevealed(false)
  }
  if (!deck.length)
    return (
      <main>
        <Card>
          <CardContent className="empty-language">
            <h1>لا توجد كلمات للدراسة</h1>
            <p>أضف كلمات إلى قسم {language === 'ar' ? 'العربية' : 'الإنجليزية'} أولاً.</p>
          </CardContent>
        </Card>
      </main>
    )
  return (
    <main className="study-page">
      <div className="study-header">
        <div>
          <p className="eyebrow">جلسة تعلم مركزة</p>
          <h1>بطاقات الدراسة</h1>
        </div>
        <div className="study-controls">
          {language === 'en' ? (
            <>
              <Button
                variant={mode === 'translation' ? 'default' : 'outline'}
                onClick={() => setMode('translation')}
              >
                English → Arabic
              </Button>
              <Button
                variant={mode === 'definition' ? 'default' : 'outline'}
                onClick={() => setMode('definition')}
              >
                English → English
              </Button>
            </>
          ) : (
            <Badge>العربية → المعنى والشرح</Badge>
          )}
        </div>
      </div>
      <Progress value={((index + 1) / deck.length) * 100} />
      <Card className="flashcard">
        <CardContent>
          <div className="flash-meta">
            <Badge>{word.level}</Badge>
            <span>
              {index + 1} / {deck.length}
            </span>
          </div>
          <h2 dir={language === 'ar' ? 'rtl' : 'ltr'}>{word.word}</h2>
          <div className="pronunciation">
            <Button variant="outline" onClick={() => speak(1, 'US')}>
              <Speaker /> {language === 'en' ? 'أمريكي' : 'استماع'}
            </Button>
            {language === 'en' && (
              <Button variant="outline" onClick={() => speak(1, 'GB')}>
                <Speaker /> بريطاني
              </Button>
            )}
            <Button variant="ghost" onClick={() => speak(0.65)}>
              <Volume1 /> بطيء
            </Button>
            <Button variant="ghost" onClick={() => speak()}>
              <RotateCcw /> إعادة
            </Button>
          </div>
          {revealed ? (
            <div className="revealed-answer">
              <strong>
                {mode === 'definition'
                  ? word.englishMeaning || word.englishExplanation || word.meaning
                  : word.meaning}
              </strong>
              {word.englishExample && <blockquote dir="ltr">{word.englishExample}</blockquote>}
              {word.arabicExample && <blockquote>{word.arabicExample}</blockquote>}
            </div>
          ) : (
            <Button className="reveal" onClick={() => setRevealed(true)}>
              <Eye /> إظهار الإجابة والمثال
            </Button>
          )}
        </CardContent>
      </Card>
      <div className="study-nav">
        <Button variant="outline" onClick={() => move(-1)}>
          <ArrowRight /> السابق
        </Button>
        <Button onClick={() => move(1)}>
          التالي <ArrowLeft />
        </Button>
      </div>
    </main>
  )
}
