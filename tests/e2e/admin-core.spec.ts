import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { Pool } from 'pg'

async function submitManaged(page: Page, form: ReturnType<Page['locator']>, label: string, confirm = false) {
  await form.getByRole('button', { name: label, exact: true }).click()
  if (confirm) await page.getByRole('button', { name: 'تأكيد', exact: true }).click()
}

test('verified database administrator completes content, CMS, rules, reports, media validation and settings flows', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.E2E_ALLOW_ADMIN_FIXTURE !== '1',
    'Requires an isolated PostgreSQL test database and the administrator fixture flag.',
  )
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the administrator E2E test.')
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  const suffix = `${testInfo.project.name}-${randomUUID()}`.replaceAll(/[^a-z0-9-]/gi, '').toLowerCase()
  const email = `admin-e2e-${suffix}@example.test`
  const password = `E2E-${randomUUID()}-aA9!`
  const sectionSlug = `e2e-${suffix}`.slice(0, 110)
  const firstSlug = `intro-${suffix}`.slice(0, 110)
  const secondSlug = `advanced-${suffix}`.slice(0, 110)
  const cmsKey = `hero-${suffix}`.slice(0, 110)
  const ruleName = `Rule ${suffix}`.slice(0, 150)
  let originalSettings: Record<string, unknown> | null = null

  try {
    const settingsResult = await pool.query(`select value from "platformSettings" where key = 'general'`)
    originalSettings = settingsResult.rows[0]?.value ?? null
    await pool.query(
      `insert into "platformSettings" (key, value) values ('general', $1::jsonb)
       on conflict (key) do update set value = "platformSettings".value || excluded.value, "updatedAt" = now()`,
      [JSON.stringify({ registrationEnabled: true, maintenanceMode: false })],
    )
    await pool.query(`delete from "user" where email = $1`, [email])

    await page.goto('/sign-up')
    await page.getByLabel('الاسم').fill('المدير الرئيسي')
    await page.getByLabel('البريد الإلكتروني').fill(email)
    await page.getByLabel('كلمة المرور').fill(password)
    await page.getByRole('button', { name: 'إنشاء الحساب' }).click()
    await page.waitForURL((url) => url.pathname === '/')
    const promoted = await pool.query(
      `update "user" set role = 'admin', "emailVerified" = true, "updatedAt" = now() where email = $1 returning id`,
      [email],
    )
    const adminId = promoted.rows[0]?.id as string | undefined
    if (!adminId) throw new Error('Administrator fixture was not created.')

    await page.goto('/admin/sections')
    const sectionForm = page.locator('form').filter({ has: page.getByLabel('اسم القسم بالعربية') }).first()
    await sectionForm.getByLabel('اسم القسم بالعربية').fill(`قسم ${suffix}`)
    await sectionForm.getByLabel('المعرّف داخل الرابط').fill(sectionSlug)
    await sectionForm.locator('select[name="status"]').selectOption('published')
    await submitManaged(page, sectionForm, 'إضافة القسم')
    await expect(sectionForm).toContainText('تم إنشاء القسم')
    const sectionResult = await pool.query(`select id from "educationalSections" where slug = $1`, [
      sectionSlug,
    ])
    const sectionId = sectionResult.rows[0]?.id as string | undefined
    expect(sectionId).toBeTruthy()

    await page.goto('/admin/content/new')
    await page.getByLabel('القسم').selectOption(sectionId!)
    await page.getByPlaceholder('العنوان').fill(`تمهيد ${suffix}`)
    await page.getByPlaceholder('content-slug').fill(firstSlug)
    await page.getByRole('button', { name: 'حفظ المحتوى' }).click()
    await expect(page.getByRole('alert')).toContainText('حفظ متطلباته السابقة')
    const firstResult = await pool.query(`select id from "sectionContents" where slug = $1`, [firstSlug])
    const firstId = firstResult.rows[0]?.id as string | undefined
    expect(firstId).toBeTruthy()

    await page.goto('/admin/content/new')
    await page.getByLabel('القسم').selectOption(sectionId!)
    await page.getByPlaceholder('العنوان').fill(`متقدم ${suffix}`)
    await page.getByPlaceholder('content-slug').fill(secondSlug)
    await page.getByLabel('المتطلبات السابقة').selectOption(firstId!)
    await page.getByRole('button', { name: 'حفظ المحتوى' }).click()
    await expect(page.getByRole('alert')).toContainText('حفظ متطلباته السابقة')
    const secondResult = await pool.query(`select id from "sectionContents" where slug = $1`, [secondSlug])
    const secondId = secondResult.rows[0]?.id as string | undefined
    const linkResult = await pool.query(
      `select 1 from "contentPrerequisites" where "contentId" = $1 and "prerequisiteId" = $2`,
      [secondId, firstId],
    )
    expect(linkResult.rowCount).toBe(1)

    await page.goto(`/admin/content/${firstId}/edit`)
    await page.getByLabel('المتطلبات السابقة').selectOption(secondId!)
    await page.getByRole('button', { name: 'حفظ المحتوى' }).click()
    await expect(page.getByRole('alert')).toContainText('دائري')

    await page.goto('/admin/cms')
    const cmsForm = page
      .locator('form')
      .filter({ has: page.getByPlaceholder('home-hero') })
      .first()
    await cmsForm.locator('[name="key"]').fill(cmsKey)
    await cmsForm.locator('[name="heading"]').fill(`عنوان CMS ${suffix}`)
    await cmsForm.locator('[name="text"]').fill('نص منشور من قاعدة البيانات عبر محرر متخصص.')
    await cmsForm.locator('select[name="status"]').selectOption('published')
    await cmsForm.locator('[name="isVisible"]').check()
    await submitManaged(page, cmsForm, 'حفظ المحتوى')
    await expect(cmsForm).toContainText('تم حفظ محتوى الموقع')
    await page.goto('/')
    await expect(page.getByText(`عنوان CMS ${suffix}`, { exact: true })).toBeVisible()

    await page.goto('/admin/promotions')
    const ruleForm = page
      .locator('form')
      .filter({ has: page.getByPlaceholder('اسم القاعدة') })
      .first()
    await ruleForm.getByPlaceholder('اسم القاعدة').fill(ruleName)
    await ruleForm.locator('[name="threshold1"]').fill('0')
    await ruleForm.locator('[name="xpAmount"]').fill('5')
    await ruleForm.locator('[name="applicationMode"]').selectOption('all_matching')
    await ruleForm.locator('[name="retrospective"]').check()
    await submitManaged(page, ruleForm, 'إنشاء القاعدة')
    await expect(ruleForm).toContainText('تم إنشاء قاعدة الإجراءات المركبة')
    const ruleRow = page.locator('.admin-list-row').filter({ hasText: ruleName }).first()
    await ruleRow.getByRole('button', { name: 'معاينة Dry Run' }).click()
    await expect(ruleRow).toContainText('المعاينة فقط')

    await pool.query(`update "user" set name = '=1+1' where id = $1`, [adminId])
    const csv = await page.request.get('/api/admin/reports/users?verified=verified&activity=all')
    expect(csv.status()).toBe(200)
    expect(await csv.text()).toContain("'=1+1")

    const fakeExecutable = await page.request.post('/api/admin/media', {
      headers: { origin: process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000' },
      multipart: {
        file: { name: 'malware.png', mimeType: 'image/png', buffer: Buffer.from('MZ executable') },
      },
    })
    expect(fakeExecutable.status()).toBe(415)

    await page.goto('/admin/settings')
    const settingsForm = page
      .locator('form')
      .filter({ has: page.getByPlaceholder('اسم الموقع') })
      .first()
    await settingsForm.getByPlaceholder('اسم الموقع').fill(`أكاديمية زايد التعليمية E2E ${suffix}`)
    await settingsForm.locator('[name="registrationEnabled"]').uncheck()
    await settingsForm.locator('[name="maintenanceMode"]').check()
    await settingsForm.locator('[name="maxUploadMb"]').fill('1')
    await submitManaged(page, settingsForm, 'حفظ الإعدادات', true)
    await expect(settingsForm).toContainText('تم حفظ إعدادات المنصة')

    const blockedRegistration = await page.request.post('/api/auth/sign-up/email', {
      headers: {
        origin: process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000',
        'content-type': 'application/json',
      },
      data: {
        name: 'Blocked',
        email: `blocked-${suffix}@example.invalid`,
        password: `Blocked-${randomUUID()}-aA9!`,
      },
    })
    expect(blockedRegistration.status()).toBe(403)
    await page.goto('/')
    await expect(page).toHaveURL(/\/maintenance$/)
    await expect(page.getByText(/قيد الصيانة/)).toBeVisible()
    await page.goto('/admin/settings')
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible()
  } finally {
    await pool.query(`delete from "siteContent" where key = $1`, [cmsKey]).catch(() => undefined)
    await pool.query(`delete from "promotionRules" where name = $1`, [ruleName]).catch(() => undefined)
    await pool
      .query(
        `delete from "sectionContents" where "sectionId" in (select id from "educationalSections" where slug = $1)`,
        [sectionSlug],
      )
      .catch(() => undefined)
    await pool
      .query(`delete from "educationalSections" where slug = $1`, [sectionSlug])
      .catch(() => undefined)
    if (originalSettings)
      await pool
        .query(`update "platformSettings" set value = $1::jsonb, "updatedAt" = now() where key = 'general'`, [
          JSON.stringify(originalSettings),
        ])
        .catch(() => undefined)
    else await pool.query(`delete from "platformSettings" where key = 'general'`).catch(() => undefined)
    await pool.query(`delete from "user" where email = $1`, [email]).catch(() => undefined)
    await pool.end()
  }
})
