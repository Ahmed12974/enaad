import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { describe, test } from 'node:test'

const root = resolve(process.cwd())

async function source(path: string) {
  return readFile(resolve(root, path), 'utf8')
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const pathname = join(directory, entry.name)
      if (entry.isDirectory() && ['node_modules', '.next', '.git'].includes(entry.name)) return []
      return entry.isDirectory() ? walk(pathname) : [pathname]
    }),
  )
  return files.flat()
}

describe('admin requirements source integrity', () => {
  test('exposes independent challenge and competition administration', async () => {
    const consoleSource = await source('components/admin/admin-console.tsx')
    const loaderSource = await source('lib/admin-console.ts')
    const actionsSource = await source('app/admin/actions.ts')

    assert.match(consoleSource, /\['challenges', 'التحديات'/)
    assert.match(consoleSource, /\['competitions', 'المنافسات'/)
    assert.match(consoleSource, /function CompetitionsPanel/)
    assert.match(loaderSource, /'competitions'/)
    assert.match(actionsSource, /export async function createManagedCompetition/)
    assert.match(actionsSource, /export async function updateManagedCompetition/)
    assert.match(actionsSource, /export async function setCompetitionParticipantStatus/)
    assert.match(actionsSource, /pg_advisory_xact_lock/)
  })

  test('keeps sections dynamic and exposes level, promotion, badge, and CMS controls', async () => {
    const consoleSource = await source('components/admin/admin-console.tsx')
    const actionsSource = await source('app/admin/actions.ts')
    const schemaSource = await source('lib/db/schema.ts')
    const homepageSource = await source('components/studio.tsx')

    assert.match(schemaSource, /export const educationalSections = pgTable/)
    assert.match(actionsSource, /export async function createEducationalSection/)
    assert.match(actionsSource, /export async function createLevel/)
    assert.match(actionsSource, /export async function createPromotionRule/)
    assert.match(actionsSource, /export async function createBadge/)
    assert.match(actionsSource, /export async function setSiteContentStatus/)
    assert.match(actionsSource, /export async function toggleSiteContentVisibility/)
    assert.match(consoleSource, /إدارة مستويات المستخدمين/)
    assert.match(consoleSource, /محتوى واجهة الموقع/)
    assert.match(consoleSource, /secondaryButtonText/)
    assert.match(consoleSource, /imageMediaId/)
    assert.match(homepageSource, /secondaryButtonUrl/)
    assert.match(homepageSource, /cms-hero-image/)
  })

  test('blocks invalid competition lifecycle states from quiz issuance', async () => {
    const competitionSource = await source('app/actions.ts')
    assert.match(competitionSource, /participant\.status === 'disqualified'/)
    assert.match(competitionSource, /participant\.status === 'expired'/)
    assert.match(competitionSource, /participant\.status === 'grading'/)
  })

  test('contains no Unicode replacement characters in source and documentation', async () => {
    const files = await walk(root)
    const textFiles = files.filter((file) => ['.ts', '.tsx', '.js', '.mjs', '.md', '.css'].includes(extname(file)))
    const corrupted: string[] = []

    for (const file of textFiles) {
      if ((await readFile(file, 'utf8')).includes('\uFFFD')) corrupted.push(file.replace(`${root}/`, ''))
    }

    assert.deepEqual(corrupted, [])
  })
})
