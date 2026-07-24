'use client'
import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { addBulk, addWord, deleteWord, toggleFavorite } from '@/app/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog'
import {
  BookOpen,
  ChevronLeft,
  Heart,
  Languages,
  Plus,
  Search,
  SlidersHorizontal,
  Speaker,
  Trash2,
  Volume1,
} from 'lucide-react'

type Word = {
  id: number
  language: string
  word: string
  meaning: string
  englishMeaning: string | null
  arabicExplanation: string | null
  englishExplanation: string | null
  synonyms: string[]
  antonyms: string[]
  arabicExample: string | null
  englishExample: string | null
  category: string
  level: string
  difficulty: string
  status: string
  isFavorite: boolean
  mistakeCount: number
  correctCount: number
  reviewCount: number
  createdAt: Date
}
export function LanguageHub({ language, words }: { language: 'en' | 'ar'; words: Word[] }) {
  const [query, setQuery] = useState(''),
    [level, setLevel] = useState('all'),
    [difficulty, setDifficulty] = useState('all'),
    [showAdd, setShowAdd] = useState(false),
    [bulk, setBulk] = useState(''),
    [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null),
    [pending, start] = useTransition()
  const isArabic = language === 'ar',
    label = isArabic ? 'العربية' : 'الإنجليزية',
    items = useMemo(
      () =>
        words
          .filter((w) => w.language === language)
          .filter((w) =>
            (w.word + w.meaning + (w.englishMeaning || '')).toLowerCase().includes(query.toLowerCase()),
          )
          .filter((w) => level === 'all' || w.level === level)
          .filter((w) => difficulty === 'all' || w.difficulty === difficulty),
      [words, language, query, level, difficulty],
    )
  return (
    <main>
      <section className={`language-hero ${isArabic ? 'arabic-content' : 'english-content'}`}>
        <div>
          <p className="eyebrow">
            <Languages /> مساحة تعلم {label}
          </p>
          <h1>{isArabic ? 'أبحر في ثراء العربية' : 'Master English, one word at a time'}</h1>
          <p>
            {isArabic
              ? 'معانٍ وشروح ومرادفات وأضداد وأمثلة في مساحة مستقلة.'
              : 'Build precise vocabulary with bilingual explanations, examples, pronunciation, and smart review.'}
          </p>
          <div className="hero-actions">
            <Button onClick={() => setShowAdd(!showAdd)}>
              <Plus /> إضافة كلمة
            </Button>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`/study?language=${language}`} />}
            >
              ابدأ الدراسة <ChevronLeft />
            </Button>
          </div>
        </div>
        <div className="language-score">
          <strong>{items.length}</strong>
          <span>كلمة في قسم {label}</span>
          <small>{items.filter((x) => x.status === 'mastered').length} متقنة</small>
        </div>
      </section>
      {showAdd && (
        <section className="language-add-grid">
          <Card>
            <CardHeader>
              <CardTitle>بطاقة كلمة متكاملة</CardTitle>
              <CardDescription>لن تُضاف الكلمة إذا كانت موجودة في هذا القسم.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                action={async (form) => {
                  const result = await addWord(form)
                  if (!result.ok)
                    setFeedback({ ok: false, message: `${result.message} يمكنك تعديلها من بنك الكلمات.` })
                  else setShowAdd(false)
                }}
                className="rich-word-form"
              >
                <input type="hidden" name="language" value={language} />
                <label>
                  الكلمة
                  <Input name="word" required dir={isArabic ? 'rtl' : 'ltr'} />
                </label>
                <label>
                  المعنى بالعربية
                  <Input name="meaning" required />
                </label>
                <label>
                  المعنى بالإنجليزية
                  <Input name="englishMeaning" dir="ltr" />
                </label>
                <label>
                  الشرح العربي
                  <Textarea name="arabicExplanation" />
                </label>
                <label>
                  English explanation
                  <Textarea name="englishExplanation" dir="ltr" />
                </label>
                <label>
                  مثال عربي
                  <Input name="arabicExample" />
                </label>
                <label>
                  English example
                  <Input name="englishExample" dir="ltr" />
                </label>
                <label>
                  المرادفات
                  <Input name="synonyms" placeholder="افصل بينها بفاصلة" />
                </label>
                <label>
                  الأضداد
                  <Input name="antonyms" placeholder="افصل بينها بفاصلة" />
                </label>
                <label>
                  المستوى
                  <select name="level">
                    <option>A1</option>
                    <option>A2</option>
                    <option>B1</option>
                    <option>B2</option>
                    <option>C1</option>
                    <option>C2</option>
                  </select>
                </label>
                <label>
                  الصعوبة
                  <select name="difficulty">
                    <option value="easy">سهلة</option>
                    <option value="medium">متوسطة</option>
                    <option value="hard">صعبة</option>
                  </select>
                </label>
                <Button type="submit">حفظ الكلمة الكاملة</Button>
              </form>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>استيراد مئات الكلمات</CardTitle>
              <CardDescription>كل سطر بصيغة: الكلمة - المعنى</CardDescription>
            </CardHeader>
            <CardContent className="form-stack">
              <Textarea aria-label="حقل نص"
                rows={12}
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                placeholder={isArabic ? 'فصيح - بليغ وواضح' : 'Protect - يحمي'}
              />
              <Button
                disabled={pending || !bulk.trim()}
                onClick={() =>
                  start(async () => {
                    const result = await addBulk(bulk, language)
                    setFeedback({
                      ok: true,
                      message: `تمت إضافة ${result.added} وتخطي ${result.skipped}.`,
                    })
                    setBulk('')
                  })
                }
              >
                إضافة المجموعة
              </Button>
            </CardContent>
          </Card>
        </section>
      )}
      {feedback && (
        <Alert variant={feedback.ok ? 'default' : 'destructive'}>
          <AlertDescription>{feedback.message}</AlertDescription>
        </Alert>
      )}
      <section className="filter-panel">
        <div className="search">
          <Search />
          <Input aria-label="بحث سريع في الكلمات والمعاني..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث سريع في الكلمات والمعاني..."
          />
        </div>
        <SlidersHorizontal />
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="المستوى">
          <option value="all">كل المستويات</option>
          {['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} aria-label="الصعوبة">
          <option value="all">كل الصعوبات</option>
          <option value="easy">سهلة</option>
          <option value="medium">متوسطة</option>
          <option value="hard">صعبة</option>
        </select>
      </section>
      <section className="word-card-grid">
        {items.map((word) => (
          <WordCard key={word.id} word={word} language={language} />
        ))}
      </section>
      {!items.length && (
        <Card>
          <CardContent className="empty-language">
            <BookOpen />
            <h2>لا توجد كلمات مطابقة</h2>
            <p>أضف أول كلمة أو غيّر مرشحات البحث.</p>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
function WordCard({ word, language }: { word: Word; language: 'en' | 'ar' }) {
  const [expanded, setExpanded] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, startDelete] = useTransition()
  function speak(rate = 1, accent: 'US' | 'GB' = 'US') {
    if (!('speechSynthesis' in window)) return
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(word.word)
    utterance.lang = language === 'ar' ? 'ar-SA' : accent === 'GB' ? 'en-GB' : 'en-US'
    utterance.rate = rate
    const voices = speechSynthesis.getVoices()
    utterance.voice =
      voices.find((v) => v.lang === utterance.lang) ||
      voices.find((v) => v.lang.startsWith(language === 'ar' ? 'ar' : 'en')) ||
      null
    speechSynthesis.speak(utterance)
  }
  return (
    <Card className="rich-word-card">
      <CardHeader>
        <div className="word-card-top">
          <div>
            <div className="word-meta">
              <Badge>{word.level}</Badge>
              <Badge variant="outline">
                {word.difficulty === 'hard' ? 'صعبة' : word.difficulty === 'medium' ? 'متوسطة' : 'سهلة'}
              </Badge>
            </div>
            <CardTitle dir={language === 'ar' ? 'rtl' : 'ltr'}>{word.word}</CardTitle>
            <CardDescription>{word.meaning}</CardDescription>
          </div>
          <button className="icon-button" aria-label="المفضلة" onClick={() => toggleFavorite(word.id)}>
            <Heart fill={word.isFavorite ? 'currentColor' : 'none'} />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="pronunciation">
          <Button size="sm" variant="outline" onClick={() => speak(1, 'US')}>
            <Speaker /> {language === 'en' ? 'US' : 'نطق'}
          </Button>
          {language === 'en' && (
            <Button size="sm" variant="outline" onClick={() => speak(1, 'GB')}>
              <Speaker /> UK
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => speak(0.65, 'US')}>
            <Volume1 /> بطيء
          </Button>
        </div>
        {word.englishMeaning && (
          <p className="definition" dir="ltr">
            <b>Definition</b>
            {word.englishMeaning}
          </p>
        )}
        {(expanded || word.englishExplanation || word.arabicExplanation) && (
          <div className="word-details">
            {word.englishExplanation && (
              <p dir="ltr">
                <b>English explanation</b>
                {word.englishExplanation}
              </p>
            )}
            {word.arabicExplanation && (
              <p>
                <b>الشرح العربي</b>
                {word.arabicExplanation}
              </p>
            )}
            {word.englishExample && <blockquote dir="ltr">{word.englishExample}</blockquote>}
            {word.arabicExample && <blockquote>{word.arabicExample}</blockquote>}
            {word.synonyms.length > 0 && (
              <div>
                <b>مرادفات: </b>
                {word.synonyms.join('، ')}
              </div>
            )}
            {word.antonyms.length > 0 && (
              <div>
                <b>أضداد: </b>
                {word.antonyms.join('، ')}
              </div>
            )}
          </div>
        )}
        <div className="word-card-footer">
          <button onClick={() => setExpanded(!expanded)}>{expanded ? 'عرض أقل' : 'كل التفاصيل'}</button>
          <span>
            {word.reviewCount} مراجعة · {word.correctCount} نجاح · {word.mistakeCount} خطأ
          </span>
          <button aria-label="حذف" disabled={deleting} onClick={() => setConfirmDelete(true)}>
            <Trash2 />
          </button>
        </div>
      </CardContent>
      <ConfirmationDialog
        open={confirmDelete}
        description="هل تريد حذف هذه الكلمة؟ لا يمكن التراجع عن العملية."
        pending={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          startDelete(async () => {
            await deleteWord(word.id)
            setConfirmDelete(false)
          })
        }
      />
    </Card>
  )
}
