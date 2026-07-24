import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { generateWordQuestions, type QuizWord } from '@/lib/quiz-engine'

const pool: QuizWord[] = [
  {
    id: 1,
    word: 'C++',
    meaning: 'لغة برمجة',
    englishMeaning: 'programming language',
    englishExample: 'I use C++ daily.',
    arabicExample: null,
    language: 'en',
  },
  {
    id: 2,
    word: 'protect',
    meaning: 'يحمي',
    englishMeaning: 'keep safe',
    englishExample: null,
    arabicExample: null,
    language: 'en',
  },
  {
    id: 3,
    word: 'challenge',
    meaning: 'تحدٍ',
    englishMeaning: 'difficult task',
    englishExample: null,
    arabicExample: null,
    language: 'en',
  },
  {
    id: 4,
    word: 'learn',
    meaning: 'يتعلم',
    englishMeaning: 'gain knowledge',
    englishExample: null,
    arabicExample: null,
    language: 'en',
  },
  {
    id: 5,
    word: 'write',
    meaning: 'يكتب',
    englishMeaning: 'make text',
    englishExample: null,
    arabicExample: null,
    language: 'en',
  },
]

describe('server-issued word quiz questions', () => {
  test('always creates four unique choices with exactly one canonical answer', () => {
    const [question] = generateWordQuestions({
      deck: [pool[0]],
      pool,
      mode: 'meaning-choice',
      direction: 'en-ar',
      random: () => 0.4,
    })
    assert.equal(question.options?.length, 4)
    assert.equal(new Set(question.options).size, 4)
    assert.equal(question.options?.filter((value) => value === question.correctAnswer).length, 1)
  })

  test('escapes regex metacharacters in completion questions', () => {
    const [question] = generateWordQuestions({
      deck: [pool[0]],
      pool,
      mode: 'complete-example',
      direction: 'en-ar',
    })
    assert.equal(question.prompt, 'I use _____ daily.')
    assert.equal(question.correctAnswer, 'C++')
  })

  test('creates an explicit blank even when the stored example does not contain the word', () => {
    const [question] = generateWordQuestions({
      deck: [pool[1]],
      pool,
      mode: 'complete-example',
      direction: 'en-ar',
    })
    assert.equal(question.prompt.includes('_____'), true)
  })

  test('refuses ambiguous multiple-choice decks instead of issuing fewer than four choices', () => {
    assert.throws(
      () =>
        generateWordQuestions({
          deck: [pool[0]],
          pool: pool.slice(0, 3),
          mode: 'meaning-choice',
          direction: 'en-ar',
        }),
      /أربع إجابات مختلفة/,
    )
  })

  test('uses grapheme-aware Arabic letter splitting', () => {
    const arabic: QuizWord = {
      id: 9,
      word: 'شَدّة',
      meaning: 'قوة',
      englishMeaning: null,
      englishExample: null,
      arabicExample: null,
      language: 'ar',
    }
    const [question] = generateWordQuestions({
      deck: [arabic],
      pool: [arabic, ...pool],
      mode: 'letters',
      direction: 'en-ar',
      random: () => 0,
    })
    assert.equal(question.correctAnswer, 'شَدّة')
    assert.equal(question.prompt.replaceAll(' · ', '').length >= arabic.word.length, true)
  })
})
