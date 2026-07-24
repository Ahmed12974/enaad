import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { publicActionError } from '../lib/public-error'

describe('public error messages', () => {
  test('preserves short expected Arabic business messages', () => {
    assert.equal(
      publicActionError(new Error('المنافسة لم تبدأ بعد.'), 'تعذر تنفيذ العملية.'),
      'المنافسة لم تبدأ بعد.',
    )
  })

  test('hides SQL, provider, stack and non-Arabic exception details', () => {
    const fallback = 'تعذر تنفيذ العملية.'
    assert.equal(publicActionError(new Error('relation user does not exist'), fallback), fallback)
    assert.equal(publicActionError(new Error('خطأ database token secret'), fallback), fallback)
    assert.equal(publicActionError(new Error('Error: failed\n at handler()'), fallback), fallback)
  })
})
