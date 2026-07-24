import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { verifyBackupArchive } from '@/lib/backup-verification'

const input = process.argv[2]
if (!input) throw new Error('Usage: pnpm backup:verify -- /absolute/path/to/backup.zip')

const archivePath = resolve(input)
const archive = await readFile(archivePath)
const result = verifyBackupArchive(archive)
console.info(JSON.stringify({ ok: true, archivePath, sizeBytes: archive.byteLength, ...result }, null, 2))
