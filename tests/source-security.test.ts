import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { describe, test } from 'node:test'

const root = resolve(process.cwd())

async function source(pathname: string) {
  return readFile(resolve(root, pathname), 'utf8')
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      if (['.git', '.next', 'node_modules'].includes(entry.name)) return []
      const pathname = join(directory, entry.name)
      return entry.isDirectory() ? walk(pathname) : [pathname]
    }),
  )
  return nested.flat()
}

describe('release source security checks', () => {
  test('contains no personal account address or committed runtime environment file', async () => {
    const files = await walk(root)
    const textFiles = files.filter((file) =>
      ['.ts', '.tsx', '.js', '.mjs', '.md', '.txt', '.json', '.yaml', '.yml'].includes(extname(file)),
    )
    const leaks: string[] = []
    for (const file of textFiles) {
      const text = await readFile(file, 'utf8')
      const personalMarkers = [ ['enaad', '4786'].join(''), ['enaad', 'x'].join('') ]
      if (personalMarkers.some((marker) => text.toLowerCase().includes(marker)))
        leaks.push(relative(root, file))
    }
    assert.deepEqual(leaks, [])

    const rootEntries = await readdir(root)
    assert.equal(rootEntries.some((name) => /^\.env(?:\.|$)/.test(name) && name !== '.env.example'), false)
  })

  test('keeps permanent administrator access role-based and bootstrap verification-safe', async () => {
    const policy = await source('lib/admin-policy.ts')
    const bootstrap = await source('lib/admin-bootstrap.ts')
    const session = await source('lib/auth-session.ts')
    const seed = await source('scripts/seed.ts')

    assert.match(policy, /identity\.role === 'admin'/)
    assert.match(policy, /identity\.emailVerified/)
    assert.match(policy, /!identity\.banned/)
    assert.match(bootstrap, /INITIAL_ADMIN_BOOTSTRAP_KEY/)
    assert.match(bootstrap, /onConflictDoNothing/)
    assert.match(bootstrap, /!record\.emailVerified/)
    assert.doesNotMatch(bootstrap, /set\(\{[^}]*emailVerified:\s*true/s)
    assert.doesNotMatch(session, /ensureInitialAdminTx|INITIAL_ADMIN_EMAIL|admin-bootstrap/)
    assert.match(seed, /ensureInitialAdminTx\(tx, adminAccount/)
    assert.doesNotMatch(seed, /set\(\{[^}]*emailVerified:\s*true/s)
  })

  test('protects private certificates while serving only active scheduled banners publicly', async () => {
    const filesRoute = await source('app/api/files/route.ts')
    const mediaRoute = await source('app/api/media/[mediaId]/route.ts')
    const proxy = await source('proxy.ts')

    assert.match(filesRoute, /pathname\.startsWith\('banners\/'\)/)
    assert.match(filesRoute, /eq\(banners\.isActive, true\)/)
    assert.match(filesRoute, /banners\.startsAt/)
    assert.match(filesRoute, /banners\.endsAt/)
    assert.match(filesRoute, /public-banner:/)
    assert.match(filesRoute, /consumeRateLimit\(rateLimitKey/)
    assert.match(filesRoute, /Cross-Origin-Resource-Policy/)
    assert.match(filesRoute, /const session = isPublicBanner \? null : await auth\.api\.getSession/)
    assert.match(filesRoute, /record\.userId !== currentUserId && !isAdministrator/)
    assert.match(mediaRoute, /s\.status = 'published'/)
    assert.match(mediaRoute, /s\."isActive" = true/)
    assert.match(proxy, /path === '\/api\/files'/)
  })

  test('keeps signed backup downloads private and rejects path ambiguity', async () => {
    const route = await source('app/api/backup-download/route.ts')
    assert.match(route, /createHmac\('sha256'/)
    assert.match(route, /timingSafeEqual/)
    assert.match(route, /pathname\.includes\('\.\.'\)/)
    assert.match(route, /pathname\.includes\('\/\/'\)/)
    assert.equal(route.includes("pathname.includes('\\\\')"), true)
    assert.match(route, /access: 'private'/)
    assert.match(route, /Cache-Control': 'private, no-store'/)
  })

  test('keeps mobile navigation and RTL content from hiding administrative controls', async () => {
    const css = await source('app/globals.css')
    assert.match(css, /@media \(max-width: 760px\)/)
    assert.match(css, /@media \(max-width: 430px\)/)
    assert.match(css, /\.admin-sidebar \{[\s\S]{0,180}overflow-x: auto/)
    assert.match(css, /\.app-frame > aside \{[\s\S]{0,80}display: none/)
    assert.doesNotMatch(css, /@media[^}]+\baside\s*\{\s*display:\s*none/)
    assert.match(css, /padding-bottom: max\(104px, calc\(84px \+ env\(safe-area-inset-bottom\)\)\)/)
    assert.match(css, /overflow-x: clip/)
  })

  test('renders real achievement and badge data on the achievements route', async () => {
    const actions = await source('app/actions.ts')
    const growth = await source('components/growth-center.tsx')
    const page = await source('app/achievements/page.tsx')

    assert.match(actions, /earnedAchievements: earnedAchievementRows/)
    assert.match(actions, /earnedBadges: earnedBadgeRows/)
    assert.match(growth, /function AchievementsCenter/)
    assert.match(growth, /data\.achievements\.map/)
    assert.match(growth, /data\.badges\.map/)
    assert.match(page, /view="achievements"/)
  })

  test('keeps the challenge and achievement pages from over-fetching unrelated study data', async () => {
    const actions = await source('app/actions.ts')
    const start = actions.indexOf('export async function getData()')
    const end = actions.indexOf('export async function getStudioData', start)
    const growthQuery = actions.slice(start, end)

    assert.ok(start >= 0 && end > start)
    assert.doesNotMatch(growthQuery, /\.from\(words\)|\.from\(sentences\)|\.from\(tests\)/)
    assert.doesNotMatch(growthQuery, /\.from\(banners\)|\.from\(siteContent\)/)
    assert.match(growthQuery, /\.from\(challengeParticipants\)/)
    assert.match(growthQuery, /\.from\(certificates\)/)
  })

  test('fails closed on missing production origins instead of publishing placeholder metadata', async () => {
    const layout = await source('app/layout.tsx')
    const sitemap = await source('app/sitemap.ts')
    const release = await source('scripts/verify-release.ts')

    assert.match(layout, /new URL\(getPublicAppUrl\(\)\)/)
    assert.doesNotMatch(layout, /example\.invalid/)
    assert.match(sitemap, /const base = getPublicAppUrl\(\)/)
    assert.doesNotMatch(sitemap, /academy-zayed\.example/)
    assert.match(release, /validateRuntimeEnvironment\(\)/)
  })

  test('marks the entire administrator tree as non-indexable', async () => {
    const layout = await source('app/admin/layout.tsx')
    assert.match(layout, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false,\s*nocache:\s*true\s*\}/s)
  })

  test('wires editing, speech, certificates and real backup actions into user interfaces', async () => {
    const studio = await source('components/studio.tsx')
    const growth = await source('components/growth-center.tsx')
    const admin = await source('components/admin/admin-console.tsx')

    assert.match(studio, /await updateWord\(editing\.id, form\)/)
    assert.match(studio, /SpeechSynthesisUtterance/)
    assert.match(growth, /await issueCertificate\(challenge\.id\)/)
    assert.match(admin, /await createBackupDownload\(\)/)
    assert.match(admin, /await createAndEmailBackup\(\)/)
  })

  test('redacts unexpected server-action errors before displaying them in quiz clients', async () => {
    const wordQuiz = await source('components/advanced-quiz.tsx')
    const mathQuiz = await source('components/math-hub.tsx')

    assert.match(wordQuiz, /publicActionError\(caught/)
    assert.match(mathQuiz, /publicActionError\(caught/)
    assert.doesNotMatch(wordQuiz, /caught instanceof Error \? caught\.message/)
    assert.doesNotMatch(mathQuiz, /caught instanceof Error \? caught\.message/)
  })

  test('reports private Blob cleanup failures instead of silently swallowing them', async () => {
    const route = await source('app/api/admin/media/route.ts')
    assert.doesNotMatch(route, /catch\(\(\) => undefined\)/)
    assert.match(route, /logBlobCleanupFailure/)
    assert.match(route, /media\.blob\.cleanup\.failed/)
    assert.match(route, /cleanupPending/)
  })

  test('backup source requires real data, blob integrity, encrypted credentials and provider confirmation', async () => {
    const backup = await source('app/admin/backup-actions.ts')
    const restore = await source('scripts/restore-backup.ts')

    assert.match(backup, /loadDatabaseData\(\)/)
    assert.match(backup, /await listSiteBlobs\(token\)/)
    assert.match(backup, /content\.byteLength !== blob\.size/)
    assert.match(backup, /encryptBackupPayload/)
    assert.match(backup, /verifyBackupArchive\(archive\)/)
    assert.match(backup, /if \(error \|\| !data\?\.id\)/)
    assert.match(backup, /await del\(pathname, \{ token \}\)/)
    assert.match(backup, /backup:storage-cleanup/)
    assert.match(backup, /Resend already accepted the message/)
    assert.match(backup, /backup:email-bookkeeping/)
    assert.match(restore, /SHA-256 mismatch/)
    assert.match(restore, /Restore target is not empty/)
    assert.match(restore, /insertSelfReferentialRows/)
    assert.match(restore, /previousSectionId/)
    assert.match(restore, /parentId/)
    assert.match(restore, /Post-restore count mismatch/)
  })
})
