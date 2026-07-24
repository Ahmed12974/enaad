import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import writeXlsxFile from 'write-excel-file/node'
import { neutralizeSpreadsheetCell } from '@/lib/export-security'
import { normalizeEmail } from '@/lib/normalization'
import {
  detectSafeImageType,
  detectSafeMediaType,
  escapeRegExp,
  redactSensitive,
  safeExternalUrl,
  splitGraphemes,
} from '@/lib/security'
import { assertSafeWorkbookArchive } from '@/lib/xlsx-security'
import { MAX_UPLOAD_MB, parsePlatformSettings } from '@/lib/platform-settings'

describe('security helpers', () => {
  test('normalizes email without modifying passwords or inner characters', () => {
    assert.equal(normalizeEmail('  Person+Tag@EXAMPLE.COM  '), 'person+tag@example.com')
  })

  test('redacts passwords, tokens, authorization and cookies in nested logs', () => {
    const result = JSON.stringify(
      redactSensitive({
        password: 'private',
        nested: { token: 'private' },
        message: 'authorization=private',
      }),
    )
    assert.equal(result.includes('private'), false)
    assert.equal(result.includes('[REDACTED]'), true)
  })

  test('neutralizes spreadsheet formula prefixes', () => {
    for (const value of ['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)', '\tformula']) {
      assert.equal(neutralizeSpreadsheetCell(value).startsWith("'"), true)
    }
    assert.equal(neutralizeSpreadsheetCell('ordinary'), 'ordinary')
  })

  test('applies safe platform-setting fallbacks and the absolute upload cap', () => {
    const settings = parsePlatformSettings({
      siteName: '  منصتي  ',
      defaultLanguage: 'en',
      maintenanceMode: true,
      registrationEnabled: false,
      maxUploadMb: 999,
    })
    assert.equal(settings.siteName, 'منصتي')
    assert.equal(settings.defaultLanguage, 'en')
    assert.equal(settings.maintenanceMode, true)
    assert.equal(settings.registrationEnabled, false)
    assert.equal(settings.maxUploadMb, MAX_UPLOAD_MB)
  })

  test('accepts only safe HTTP links and magic-byte verified bitmap formats', () => {
    assert.equal(safeExternalUrl('javascript:alert(1)', 'https://lughati.example'), null)
    assert.equal(safeExternalUrl('/account', 'https://lughati.example'), '/account')
    assert.equal(detectSafeImageType(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png')
    assert.equal(detectSafeImageType(new TextEncoder().encode('<svg onload=alert(1)>')), null)
  })

  test('detects approved document, audio, and video signatures without trusting extensions', () => {
    assert.equal(detectSafeMediaType(new TextEncoder().encode('%PDF-1.7')), 'application/pdf')
    assert.equal(detectSafeMediaType(Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0, 0])), 'audio/mpeg')
    assert.equal(
      detectSafeMediaType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])),
      'audio/wav',
    )
    assert.equal(
      detectSafeMediaType(Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])),
      'video/mp4',
    )
    assert.equal(detectSafeMediaType(new TextEncoder().encode('<script>alert(1)</script>')), null)
  })

  test('escapes regular expressions and preserves Arabic grapheme clusters', () => {
    assert.equal(new RegExp(escapeRegExp('C++')).test('C++'), true)
    assert.equal(splitGraphemes('شَدّة', 'ar').join(''), 'شَدّة')
  })

  test('accepts a bounded XLSX archive and rejects corrupt or encrypted entries', async () => {
    const archive = await writeXlsxFile([
      ['question', 'option1'],
      ['1 + 1', '2'],
    ]).toBuffer()
    assert.doesNotThrow(() => assertSafeWorkbookArchive(archive))

    const corrupt = Buffer.from(archive)
    corrupt.writeUInt32LE(0, 0)
    assert.throws(() => assertSafeWorkbookArchive(corrupt))

    const encrypted = Buffer.from(archive)
    const centralDirectory = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    assert.notEqual(centralDirectory, -1)
    encrypted.writeUInt16LE(encrypted.readUInt16LE(centralDirectory + 8) | 1, centralDirectory + 8)
    assert.throws(() => assertSafeWorkbookArchive(encrypted))
  })
})
