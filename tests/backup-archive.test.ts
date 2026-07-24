import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, test } from 'node:test'
import { decryptBackupPayload, encryptBackupPayload } from '../lib/backup-crypto'
import {
  BACKUP_DATABASE_TABLES,
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  verifyBackupArchive,
} from '../lib/backup-verification'
import { createZipArchive, inspectZipArchive, readZipArchive } from '../lib/zip-archive'

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function makeVerifiedBackup(options?: {
  wrongCount?: boolean
  forbiddenTable?: boolean
  unknownTable?: boolean
}) {
  const data: Record<string, unknown[]> = Object.fromEntries(
    BACKUP_DATABASE_TABLES.map((table) => [table, []]),
  )
  data.user = [{ id: 'u1' }]
  data.educationalSections = [{ id: 's1' }]
  if (options?.forbiddenTable) data.session = [{ id: 'secret' }]
  if (options?.unknownTable) data.unexpected = [{ id: 'unknown' }]
  const counts = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, rows.length]))
  const databaseFile = Buffer.from(
    JSON.stringify({ metadata: { schemaVersion: BACKUP_SCHEMA_VERSION, tableCounts: counts }, data }, null, 2),
    'utf8',
  )
  const credentialFile = Buffer.from(
    JSON.stringify(
      encryptBackupPayload(
        { generatedAt: new Date(0).toISOString(), accounts: [] },
        'a-secure-test-secret-that-is-longer-than-32-characters',
      ),
    ),
    'utf8',
  )
  const guide = Buffer.from('# استعادة', 'utf8')
  const blob = Buffer.from('example', 'utf8')
  const files = [
    { path: 'database.json', sizeBytes: databaseFile.byteLength, sha256: sha256(databaseFile) },
    {
      path: 'auth-credentials.enc.json',
      sizeBytes: credentialFile.byteLength,
      sha256: sha256(credentialFile),
    },
    { path: 'RESTORE_AR.md', sizeBytes: guide.byteLength, sha256: sha256(guide) },
    {
      path: 'blobs/media/example.txt',
      sizeBytes: blob.byteLength,
      sha256: sha256(blob),
    },
  ]
  const records = Object.values(counts).reduce((sum, count) => sum + count, 0)
  const manifest = Buffer.from(
    JSON.stringify({
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      database: {
        filename: 'database.json',
        tableCounts: counts,
        records: options?.wrongCount ? records + 1 : records,
        sizeBytes: databaseFile.byteLength,
        sha256: sha256(databaseFile),
      },
      encryptedCredentials: {
        filename: 'auth-credentials.enc.json',
        accountCount: 0,
        algorithm: 'AES-256-GCM',
        sha256: sha256(credentialFile),
      },
      blobs: {
        count: 1,
        totalBytes: blob.byteLength,
        files: [
          {
            path: 'blobs/media/example.txt',
            archivePath: 'blobs/media/example.txt',
            pathname: 'media/example.txt',
            sizeBytes: blob.byteLength,
            sha256: sha256(blob),
          },
        ],
      },
      files,
      integrity: {
        algorithm: 'SHA-256',
        zipEntriesVerified: true,
        expectedZipEntries: 5,
      },
    }),
    'utf8',
  )
  return createZipArchive([
    { name: 'database.json', data: databaseFile },
    { name: 'manifest.json', data: manifest },
    { name: 'auth-credentials.enc.json', data: credentialFile },
    { name: 'RESTORE_AR.md', data: guide },
    { name: 'blobs/media/example.txt', data: blob },
  ])
}

describe('backup archive integrity and encryption', () => {
  test('creates, reads and verifies every ZIP entry', () => {
    const archive = createZipArchive([
      { name: 'database.json', data: Buffer.from('{"ok":true}') },
      { name: 'blobs/media/example.txt', data: Buffer.from('example') },
    ])
    const inspection = inspectZipArchive(archive)
    assert.equal(inspection.entryCount, 2)
    const read = readZipArchive(archive)
    assert.equal(read.files.get('database.json')?.toString('utf8'), '{"ok":true}')
    assert.equal(read.files.get('blobs/media/example.txt')?.toString('utf8'), 'example')
  })

  test('verifies manifest hashes, table counts, blob counts and security exclusions', () => {
    const result = verifyBackupArchive(makeVerifiedBackup())
    assert.equal(result.entryCount, 5)
    assert.equal(result.records, 2)
    assert.equal(result.blobCount, 1)
    assert.equal(result.tableCounts.user, 1)
    assert.equal(result.tableCounts.educationalSections, 1)
    assert.equal(Object.keys(result.tableCounts).length, BACKUP_DATABASE_TABLES.length)
  })

  test('rejects false manifest counts and forbidden live-session exports', () => {
    assert.throws(() => verifyBackupArchive(makeVerifiedBackup({ wrongCount: true })))
    assert.throws(() => verifyBackupArchive(makeVerifiedBackup({ forbiddenTable: true })))
    assert.throws(() => verifyBackupArchive(makeVerifiedBackup({ unknownTable: true })))
  })

  test('rejects a corrupted compressed payload', () => {
    const archive = createZipArchive([{ name: 'database.json', data: Buffer.from('important') }])
    const corrupted = Buffer.from(archive)
    corrupted[corrupted.indexOf(Buffer.from('database.json')) + 'database.json'.length + 2] ^= 0xff
    assert.throws(() => inspectZipArchive(corrupted))
  })

  test('rejects a central-directory entry that disagrees with the local entry', () => {
    const archive = createZipArchive([{ name: 'database.json', data: Buffer.from('important') }])
    const corrupted = Buffer.from(archive)
    const central = corrupted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    assert.notEqual(central, -1)
    corrupted.writeUInt32LE(corrupted.readUInt32LE(central + 16) ^ 0xffffffff, central + 16)
    assert.throws(() => inspectZipArchive(corrupted))
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

  test('encrypts restorable credentials and rejects a wrong secret', () => {
    const secret = 'a-secure-test-secret-that-is-longer-than-32-characters'
    const encrypted = encryptBackupPayload({ accounts: [{ id: 'a', password: 'hash' }] }, secret)
    assert.deepEqual(decryptBackupPayload(encrypted, secret), {
      accounts: [{ id: 'a', password: 'hash' }],
    })
    assert.throws(() =>
      decryptBackupPayload(encrypted, 'a-different-test-secret-that-is-also-long-enough'),
    )
    assert.equal(JSON.stringify(encrypted).includes('hash'), false)
  })
})
