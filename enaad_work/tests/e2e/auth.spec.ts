import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { Pool } from 'pg'

test('sign-up, persistent login, authorization, logout and re-login', async ({ page }, testInfo) => {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the authentication E2E test.')
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  const suffix = randomUUID()
  const email = `e2e-${testInfo.project.name}-${suffix}@example.invalid`.toLowerCase()
  const password = `E2E-${suffix}-aA9!`

  try {
    await page.goto('/sign-up')
    await page.getByLabel('الاسم').fill('مستخدم اختبار')
    await page.getByLabel('البريد الإلكتروني').fill(`  ${email.toUpperCase()}  `)
    await page.getByLabel('كلمة المرور').fill(password)
    await page.getByRole('button', { name: 'إنشاء الحساب' }).click()
    await page.waitForURL((url) => url.pathname === '/')

    const cookies = await page.context().cookies()
    expect(cookies.some((cookie) => cookie.name.includes('lughati.session_token'))).toBe(true)
    expect(cookies.find((cookie) => cookie.name.includes('lughati.session_token'))?.secure).toBe(false)

    await page.reload()
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/words')
    await expect(page).toHaveURL(/\/words$/)

    await pool.query(`update "user" set role = 'admin', "updatedAt" = now() where email = $1`, [email])
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin$/)
    await expect(page.getByRole('heading', { name: /403 — الوصول مرفوض/ })).toBeVisible()
    expect((await page.request.get('/api/admin/reports/users')).status()).toBe(403)

    await pool.query(`update "user" set role = 'user', "updatedAt" = now() where email = $1`, [email])
    await page.goto('/admin')
    await page.waitForURL((url) => url.pathname === '/')

    await page.evaluate(async () => {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (!response.ok) throw new Error('Sign-out request failed')
    })
    await page.goto('/words')
    await page.waitForURL((url) => url.pathname === '/sign-in' && url.searchParams.get('next') === '/words')
    expect((await page.request.get('/api/admin/reports/users')).status()).toBe(401)

    await page.getByLabel('البريد الإلكتروني').fill(email)
    await page.getByLabel('كلمة المرور').fill(`${password}x`)
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click()
    await expect(page.getByRole('alert')).toContainText('البريد الإلكتروني أو كلمة المرور غير صحيحة')

    await page.getByLabel('كلمة المرور').fill(password)
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click()
    await page.waitForURL((url) => url.pathname === '/words')
    await page.reload()
    await expect(page).toHaveURL(/\/words$/)
  } finally {
    await pool.query('delete from "user" where email = $1', [email])
    await pool.end()
  }
})

test('the verified allowlisted sole administrator opens admin routes and APIs', async ({ page }) => {
  test.skip(
    process.env.E2E_ALLOW_ADMIN_FIXTURE !== '1',
    'Requires an isolated test database for the sole-admin fixture.',
  )
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required for the administrator E2E test.')
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  const email = 'enaad4786@gmail.com'
  const password = `E2E-${randomUUID()}-aA9!`
  try {
    await pool.query(`delete from "adminAllowlist" where email = $1`, [email])
    await pool.query(`delete from "user" where email = $1`, [email])
    await page.goto('/sign-up')
    await page.getByLabel('الاسم').fill('المدير الرئيسي')
    await page.getByLabel('البريد الإلكتروني').fill(email)
    await page.getByLabel('كلمة المرور').fill(password)
    await page.getByRole('button', { name: 'إنشاء الحساب' }).click()
    await page.waitForURL((url) => url.pathname === '/')
    const result = await pool.query(
      `update "user" set role = 'admin', "emailVerified" = true, "updatedAt" = now() where email = $1 returning id`,
      [email],
    )
    const adminId = result.rows[0]?.id
    if (!adminId) throw new Error('Sole administrator fixture was not created.')
    await pool.query(
      `insert into "adminAllowlist" (email, role, "isActive", "createdBy") values ($1, 'SUPER_ADMIN', true, $2)`,
      [email, adminId],
    )
    await page.goto('/admin/users')
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible()
    await expect(page.getByText('المستخدمون', { exact: true }).first()).toBeVisible()
    const response = await page.request.get('/api/admin/reports/users')
    expect(response.status()).toBe(200)

    await pool.query(`update "user" set "emailVerified" = false where id = $1`, [adminId])
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: /403 — الوصول مرفوض/ })).toBeVisible()
    await pool.query(`update "user" set "emailVerified" = true, banned = true where id = $1`, [adminId])
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: /403 — الوصول مرفوض/ })).toBeVisible()
    await pool.query(`update "user" set banned = false where id = $1`, [adminId])
    await pool.query(`update "adminAllowlist" set "isActive" = false where email = $1`, [email])
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: /403 — الوصول مرفوض/ })).toBeVisible()
    await pool.query(`update "adminAllowlist" set "isActive" = true where email = $1`, [email])
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'لوحة التحكم' })).toBeVisible()
  } finally {
    await pool.query(`delete from "adminAllowlist" where email = $1`, [email])
    await pool.query(`delete from "user" where email = $1`, [email])
    await pool.end()
  }
})
