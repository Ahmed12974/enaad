import { escapeRegExp, splitGraphemes } from '@/lib/security'
import { normalizeText } from '@/lib/utils'

export const wordQuizModes = [
  'meaning-choice',
  'word-choice',
  'type-word',
  'type-meaning',
  'letters',
  'true-false',
  'complete-example',
  'audio',
  'speed',
  'review',
  'difficult',
  'mistakes',
] as const

export type WordQuizMode = (typeof wordQuizModes)[number]
export type QuizDirection = 'en-ar' | 'en-en'

export type QuizWord = {
  id: number
  word: string
  meaning: string
  englishMeaning: string | null
  englishExample: string | null
  arabicExample: string | null
  language: 'en' | 'ar'
}

export type GeneratedWordQuestion = {
  wordId: number
  prompt: string
  correctAnswer: string
  options: string[] | null
  example: string | null
}

export function shuffle<T>(items: readonly T[], random: () => number = Math.random) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1))
    ;[result[index], result[swapWith]] = [result[swapWith], result[index]]
  }
  return result
}

function uniqueValues(values: string[]) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const normalized = normalizeText(value)
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

function definition(word: QuizWord, direction: QuizDirection) {
  return direction === 'en-en' && word.englishMeaning ? word.englishMeaning : word.meaning
}

function choices(correct: string, candidates: string[], random: () => number) {
  const distractors = uniqueValues(candidates).filter(
    (value) => normalizeText(value) !== normalizeText(correct),
  )
  if (distractors.length < 3)
    throw new Error('هذا النمط يحتاج إلى أربع إجابات مختلفة على الأقل في بنك كلماتك.')
  return shuffle([correct, ...shuffle(distractors, random).slice(0, 3)], random)
}

export function generateWordQuestions({
  deck,
  pool,
  mode,
  direction,
  random = Math.random,
}: {
  deck: QuizWord[]
  pool: QuizWord[]
  mode: WordQuizMode
  direction: QuizDirection
  random?: () => number
}): GeneratedWordQuestion[] {
  return deck.map((word) => {
    const example = word.language === 'ar' ? word.arabicExample : word.englishExample
    const allDefinitions = pool
      .filter((item) => item.id !== word.id)
      .map((item) => definition(item, direction))
    const allWords = pool.filter((item) => item.id !== word.id).map((item) => item.word)

    if (['meaning-choice', 'audio', 'speed', 'review', 'difficult', 'mistakes'].includes(mode)) {
      const correctAnswer = definition(word, direction)
      return {
        wordId: word.id,
        prompt: word.word,
        correctAnswer,
        options: choices(correctAnswer, allDefinitions, random),
        example,
      }
    }
    if (mode === 'word-choice') {
      return {
        wordId: word.id,
        prompt: word.meaning,
        correctAnswer: word.word,
        options: choices(word.word, allWords, random),
        example,
      }
    }
    if (mode === 'type-word')
      return { wordId: word.id, prompt: word.meaning, correctAnswer: word.word, options: null, example }
    if (mode === 'type-meaning')
      return { wordId: word.id, prompt: word.word, correctAnswer: word.meaning, options: null, example }
    if (mode === 'letters') {
      const graphemes = splitGraphemes(word.word, word.language)
      let shuffled = shuffle(graphemes, random)
      if (graphemes.length > 1 && shuffled.join('') === graphemes.join(''))
        shuffled = [...shuffled.slice(1), shuffled[0]]
      return {
        wordId: word.id,
        prompt: shuffled.join(' · '),
        correctAnswer: word.word,
        options: null,
        example,
      }
    }
    if (mode === 'complete-example') {
      const source = example || word.meaning
      const pattern = new RegExp(escapeRegExp(word.word), 'iu')
      const prompt = pattern.test(source)
        ? source.replace(pattern, '_____')
        : `${source} — اكتب الكلمة المناسبة: _____`
      return { wordId: word.id, prompt, correctAnswer: word.word, options: null, example: null }
    }

    const alternative = uniqueValues(allDefinitions).find(
      (value) => normalizeText(value) !== normalizeText(word.meaning),
    )
    if (!alternative) throw new Error('اختبار الصح والخطأ يحتاج إلى معنيين مختلفين على الأقل.')
    const valid = random() >= 0.5
    return {
      wordId: word.id,
      prompt: `${word.word} = ${valid ? word.meaning : alternative}`,
      correctAnswer: valid ? 'صح' : 'خطأ',
      options: ['صح', 'خطأ'],
      example,
    }
  })
}
