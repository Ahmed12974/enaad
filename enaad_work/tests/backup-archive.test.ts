import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createZipArchive } from '@/lib/zip-archive'

test('creates a valid ZIP envelope with UTF-8 filenames', () => {
  const archive = createZipArchive([
    { name: 'database.json', data: Buffer.from('{"ok":true}', 'utf8') },
    { name: 'blobs/شهادة.txt', data: Buffer.from('آمن', 'utf8') },
  ])
  assert.equal(archive.readUInt32LE(0), 0x04034b50)
  assert.equal(archive.readUInt32LE(archive.byteLength - 22), 0x06054b50)
  assert.ok(archive.includes(Buffer.from('database.json', 'utf8')))
  assert.ok(archive.includes(Buffer.from('blobs/شهادة.txt', 'utf8')))
})

test('rejects traversal paths and duplicate entries', () => {
  assert.throws(() => createZipArchive([{ name: '../secret.txt', data: Buffer.from('x') }]))
  assert.throws(() =>
    createZipArchive([
      { name: 'same.txt', data: Buffer.from('a') },
      { name: 'same.txt', data: Buffer.from('b') },
    ]),
  )
})
