import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import pg from 'pg'
import { put } from '@vercel/blob'
import { decryptBackupPayload, type EncryptedBackupPayload } from '@/lib/backup-crypto'
import {
  BACKUP_DATABASE_TABLES,
  BACKUP_FORMAT_VERSION,
  BACKUP_SCHEMA_VERSION,
  verifyBackupArchive,
} from '@/lib/backup-verification'
import { readZipArchive } from '@/lib/zip-archive'

const { Pool } = pg
const args = new Set(process.argv.slice(2).filter((value) => value.startsWith('--')))
const archiveArgument = process.argv.slice(2).find((value) => !value.startsWith('--'))

if (!archiveArgument) {
  console.error('Usage: pnpm backup:restore -- <backup.zip> [--verify-only | --apply] [--restore-blobs]')
  process.exit(1)
}

const archivePath = resolve(process.cwd(), archiveArgument)
const apply = args.has('--apply')
const restoreBlobs = args.has('--restore-blobs')
if (!apply && !args.has('--verify-only')) args.add('--verify-only')
if (restoreBlobs && !apply) throw new Error('--restore-blobs requires --apply.')

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function parseJson<T>(files: Map<string, Buffer>, name: string): T {
  const file = files.get(name)
  if (!file) throw new Error(`Missing required backup entry: ${name}`)
  try {
    return JSON.parse(file.toString('utf8')) as T
  } catch {
    throw new Error(`Invalid JSON in backup entry: ${name}`)
  }
}

type Manifest = {
  formatVersion: number
  schemaVersion: string
  database: { filename: string; tableCounts: Record<string, number>; records: number; sha256: string }
  encryptedCredentials?: { filename: string; accountCount: number; sha256: string }
  blobs: {
    count: number
    totalBytes: number
    files: Array<{
      archivePath: string
      pathname: string
      sizeBytes: number
      contentType: string
      sha256: string
    }>
  }
  files: Array<{ path: string; sizeBytes: number; sha256: string }>
  integrity: { algorithm: string; expectedZipEntries: number }
}

type DatabaseBackup = {
  metadata: { schemaVersion: string; tableCounts: Record<string, number> }
  data: Record<string, Array<Record<string, unknown>>>
}

type CredentialBackup = {
  generatedAt: string
  accounts: Array<Record<string, unknown>>
}

const allowedTables = new Set<string>(BACKUP_DATABASE_TABLES)

function quoteIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`)
  return `"${value.replaceAll('"', '""')}"`
}


async function insertRows(
  client: pg.PoolClient,
  tableName: string,
  rows: Array<Record<string, unknown>>,
) {
  if (!allowedTables.has(tableName) && tableName !== 'account') throw new Error(`Backup contains a table that is not restorable: ${tableName}`)
  if (!rows.length) return
  const columns = Object.keys(rows[0]!)
  if (!columns.length) throw new Error(`Table ${tableName} contains an empty row.`)
  for (const row of rows) {
    if (Object.keys(row).join('\0') !== columns.join('\0'))
      throw new Error(`Inconsistent columns in table ${tableName}.`)
  }
  const chunkSize = 250
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize)
    const values: unknown[] = []
    const groups = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        const value = row[column]
        values.push(value !== null && typeof value === 'object' ? JSON.stringify(value) : value)
        return `$${values.length}`
      })
      return `(${placeholders.join(', ')})`
    })
    await client.query(
      `insert into ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(', ')}) values ${groups.join(', ')}`,
      values,
    )
  }
}

async function insertSelfReferentialRows(
  client: pg.PoolClient,
  tableName: 'educationalSections' | 'sectionContents',
  rows: Array<Record<string, unknown>>,
  parentColumn: 'previousSectionId' | 'parentId',
) {
  if (!rows.length) return
  const withoutParent = rows.map((row) => ({ ...row, [parentColumn]: null }))
  await insertRows(client, tableName, withoutParent)

  const links = rows
    .map((row) => ({ id: row.id, parentId: row[parentColumn] }))
    .filter(
      (row): row is { id: string; parentId: string } =>
        typeof row.id === 'string' && typeof row.parentId === 'string',
    )
  for (let start = 0; start < links.length; start += 250) {
    const chunk = links.slice(start, start + 250)
    const values: string[] = []
    const parameters: unknown[] = []
    for (const link of chunk) {
      parameters.push(link.id, link.parentId)
      values.push(`($${parameters.length - 1}::uuid, $${parameters.length}::uuid)`)
    }
    await client.query(
      `update ${quoteIdentifier(tableName)} as target
       set ${quoteIdentifier(parentColumn)} = patch.parent_id
       from (values ${values.join(', ')}) as patch(id, parent_id)
       where target.id = patch.id`,
      parameters,
    )
  }
}

async function resetSerialSequence(client: pg.PoolClient, tableName: string) {
  const sequence = await client.query<{ sequence_name: string | null }>(
    `select pg_get_serial_sequence($1, 'id') as sequence_name`,
    [quoteIdentifier(tableName)],
  )
  const name = sequence.rows[0]?.sequence_name
  if (!name) return
  await client.query(
    `select setval($1::regclass, coalesce((select max(id) from ${quoteIdentifier(tableName)}), 1), (select count(*) > 0 from ${quoteIdentifier(tableName)}))`,
    [name],
  )
}

const archive = await readFile(archivePath)
const archiveVerification = verifyBackupArchive(archive)
const parsed = readZipArchive(archive)
const manifest = parseJson<Manifest>(parsed.files, 'manifest.json')
if (manifest.formatVersion !== BACKUP_FORMAT_VERSION)
  throw new Error(`Unsupported backup format: ${manifest.formatVersion}`)
if (manifest.schemaVersion !== BACKUP_SCHEMA_VERSION)
  throw new Error(`Unsupported backup schema: ${manifest.schemaVersion}`)
if (manifest.integrity.algorithm !== 'SHA-256') throw new Error('Unsupported checksum algorithm.')
if (parsed.entryCount !== manifest.integrity.expectedZipEntries)
  throw new Error('ZIP entry count does not match manifest.')

for (const expected of manifest.files) {
  const file = parsed.files.get(expected.path)
  if (!file) throw new Error(`Manifest references a missing file: ${expected.path}`)
  if (file.byteLength !== expected.sizeBytes) throw new Error(`Size mismatch: ${expected.path}`)
  if (sha256(file) !== expected.sha256) throw new Error(`SHA-256 mismatch: ${expected.path}`)
}

const database = parseJson<DatabaseBackup>(parsed.files, manifest.database.filename)
if (database.metadata.schemaVersion !== manifest.schemaVersion)
  throw new Error('Database schema version does not match manifest.')
let recordCount = 0
for (const [table, rows] of Object.entries(database.data)) {
  if (!allowedTables.has(table)) throw new Error(`Unexpected database table in backup: ${table}`)
  const expected = manifest.database.tableCounts[table]
  if (expected !== rows.length) throw new Error(`Record count mismatch for ${table}.`)
  recordCount += rows.length
}
if (recordCount !== manifest.database.records) throw new Error('Total database record count mismatch.')
if (manifest.blobs.files.length !== manifest.blobs.count) throw new Error('Blob count mismatch.')
for (const blob of manifest.blobs.files) {
  const file = parsed.files.get(blob.archivePath)
  if (!file || file.byteLength !== blob.sizeBytes || sha256(file) !== blob.sha256)
    throw new Error(`Blob integrity check failed: ${blob.pathname}`)
}

let credentials: CredentialBackup | null = null
if (manifest.encryptedCredentials) {
  const encrypted = parsed.files.get(manifest.encryptedCredentials.filename)
  if (!encrypted || sha256(encrypted) !== manifest.encryptedCredentials.sha256)
    throw new Error('Encrypted credential file integrity check failed.')
  const secret = process.env.BACKUP_ENCRYPTION_SECRET?.trim()
  if (apply && (!secret || secret.length < 32))
    throw new Error('BACKUP_ENCRYPTION_SECRET is required to restore password credentials.')
  if (secret) {
    const decryptedCredentials = decryptBackupPayload<CredentialBackup>(
      JSON.parse(encrypted.toString('utf8')) as EncryptedBackupPayload,
      secret,
    )
    if (decryptedCredentials.accounts.length !== manifest.encryptedCredentials.accountCount)
      throw new Error('Encrypted account count does not match manifest.')
    credentials = decryptedCredentials
  }
}

console.info(
  `Verified ${basename(archivePath)}: ${archiveVerification.records} database records, ${archiveVerification.blobCount} blobs, ${archiveVerification.entryCount} ZIP entries.`,
)

if (!apply) process.exit(0)
if (process.env.ALLOW_BACKUP_RESTORE !== 'EMPTY_TEST_DATABASE')
  throw new Error('Set ALLOW_BACKUP_RESTORE=EMPTY_TEST_DATABASE to confirm this is an isolated empty target.')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for --apply.')
if (manifest.encryptedCredentials && !credentials)
  throw new Error('Credentials could not be decrypted; refusing a partial authentication restore.')

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, options: '-c timezone=UTC' })
const client = await pool.connect()
try {
  await client.query('begin')
  await client.query(`select pg_advisory_xact_lock(hashtext('lughati-backup-restore'))`)
  for (const table of [...BACKUP_DATABASE_TABLES, 'account']) {
    const existing = await client.query<{ count: string }>(
      `select count(*)::text as count from ${quoteIdentifier(table)}`,
    )
    if (Number(existing.rows[0]?.count ?? 0) !== 0) {
      throw new Error(
        `Restore target is not empty (${table}). Refusing to merge backup data into an existing database.`,
      )
    }
  }

  for (const [table, rows] of Object.entries(database.data)) {
    if (table === 'educationalSections') {
      await insertSelfReferentialRows(client, table, rows, 'previousSectionId')
    } else if (table === 'sectionContents') {
      await insertSelfReferentialRows(client, table, rows, 'parentId')
    } else {
      await insertRows(client, table, rows)
    }
  }
  if (credentials?.accounts.length) await insertRows(client, 'account', credentials.accounts)
  for (const table of [...Object.keys(database.data), 'account']) await resetSerialSequence(client, table)

  for (const [table, expected] of Object.entries(manifest.database.tableCounts)) {
    const count = await client.query<{ count: string }>(
      `select count(*)::text as count from ${quoteIdentifier(table)}`,
    )
    if (Number(count.rows[0]?.count ?? -1) !== expected)
      throw new Error(`Post-restore count mismatch for ${table}.`)
  }
  if (credentials) {
    const count = await client.query<{ count: string }>('select count(*)::text as count from account')
    if (Number(count.rows[0]?.count ?? -1) !== credentials.accounts.length)
      throw new Error('Post-restore account count mismatch.')
  }
  await client.query('commit')
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
  await pool.end()
}

if (restoreBlobs) {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim()
  if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is required for --restore-blobs.')
  for (const blob of manifest.blobs.files) {
    const file = parsed.files.get(blob.archivePath)
    if (!file) throw new Error(`Missing blob after database restore: ${blob.pathname}`)
    await put(blob.pathname, file, {
      access: 'private',
      addRandomSuffix: false,
      contentType: blob.contentType,
      token,
    })
  }
}

console.info(`Restore completed and verified for ${recordCount} records and ${restoreBlobs ? manifest.blobs.count : 0} blobs.`)
