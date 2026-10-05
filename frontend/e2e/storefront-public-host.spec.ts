import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { STOREFRONT_ORIGIN, collectPageHealth, expectNoRuntimeErrors, seedStorefrontLanguage } from './support/harness'

/**
 * storefront-public-host.spec.ts -- G38 P0, owner 27 Sep 2026: "the public
 * site never shows admin".
 *
 * On the shop host (the 127.0.0.2 storefront origin stands in for
 * leangbeauty.com), /login is the CUSTOMER sign-in and staff paths show the
 * shop; the sign-up reminder is the shared review dialog, not window.confirm.
 *
 * CATCHES: the pre-G38 host-blind router, which mounted the staff app at
 * leangbeauty.com/login and /pos; a sign-up that posts before the reminder is
 * answered; a native confirm() (Playwright would see a 'dialog' event).
 *
 * G38_SHOTS_DIR=<dir> also saves 360 px and 1280 px screenshots in EN and KM.
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-public-host
 */

const SHOTS = process.env.G38_SHOTS_DIR || ''
const COPY = {
  en: { signUp: 'Sign up', create: 'Create account', reminderTitle: 'Before you create an account', back: 'Back' },
  km: { signUp: 'ចុះឈ្មោះ', create: 'បង្កើតគណនី', reminderTitle: 'មុនពេលបង្កើតគណនី', back: 'ត្រឡប់' },
} as const

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false })
}

async function expectStorefrontRoot(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-business-os-initial-route', 'public')
  await expect(page).not.toHaveTitle(/Admin/)
}

for (const language of ['en', 'km'] as const) {
  test.describe(`shop host, ${language}`, () => {
    test.beforeEach(async ({ context }) => {
      await seedStorefrontLanguage(context, STOREFRONT_ORIGIN, language)
    })

    test('/login is the customer sign-in, never the staff app', async ({ page }) => {
      const health = collectPageHealth(page)
      await page.goto(`${STOREFRONT_ORIGIN}/login`, { waitUntil: 'load' })
      await expectStorefrontRoot(page)
      const drawer = page.getByRole('dialog').first()
      await expect(drawer).toBeVisible()
      await expect(drawer.getByRole('button', { name: COPY[language].signUp })).toBeVisible()
      await expect(drawer.locator('input[autocomplete="current-password"]')).toBeVisible()
      expect(health.requests.filter((url) => /\/api\/auth\//.test(url)), 'no staff auth call on the shop host').toEqual([])
      expectNoRuntimeErrors(health)
    })

    test('staff paths show the shop', async ({ page }) => {
      for (const pathname of ['/pos', '/admin', '/products']) {
        await page.goto(`${STOREFRONT_ORIGIN}${pathname}`, { waitUntil: 'load' })
        await expectStorefrontRoot(page)
      }
    })

    test('the sign-up reminder is the shared dialog and Back sends nothing', async ({ page }) => {
      const nativeDialogs: string[] = []
      page.on('dialog', (dialog) => { nativeDialogs.push(dialog.message()); void dialog.dismiss() })
      const signups: string[] = []
      page.on('request', (request) => { if (request.url().includes('/api/portal/auth/signup')) signups.push(request.method()) })
      await page.goto(`${STOREFRONT_ORIGIN}/login`, { waitUntil: 'load' })
      const drawer = page.getByRole('dialog').first()
      await drawer.getByRole('button', { name: COPY[language].signUp }).click()
      await drawer.locator('input[name="name"]').fill('Dara')
      await drawer.locator('input[name="tel"]').fill('012 345 678')
      await drawer.locator('input[autocomplete="new-password"]').fill('secret-pass')
      await drawer.getByRole('checkbox').check()
      await drawer.getByRole('button', { name: COPY[language].create }).click()
      const reminder = page.getByText(COPY[language].reminderTitle, { exact: true })
      await expect(reminder).toBeVisible()
      expect(nativeDialogs, 'no native confirm()').toEqual([])
      expect(signups, 'nothing is posted before the reminder is answered').toEqual([])
      await page.getByRole('button', { name: COPY[language].back, exact: true }).click()
      await expect(reminder).toBeHidden()
      expect(signups).toEqual([])
      await expect(drawer).toBeVisible()
    })
  })
}

test.describe('G38 P0 screenshots', () => {
  test.skip(!SHOTS, 'set G38_SHOTS_DIR to save screenshots')
  for (const language of ['en', 'km'] as const) {
    for (const width of [360, 1280]) {
      test(`${language} ${width}px`, async ({ page, context }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop-chromium', 'screenshots once, on desktop Chromium at explicit widths')
        await seedStorefrontLanguage(context, STOREFRONT_ORIGIN, language)
        await page.setViewportSize({ width, height: 800 })
        const tag = `${language}-${width}`
        await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
        await expectStorefrontRoot(page)
        await page.waitForTimeout(800)
        await shot(page, `${tag}-01-home`)
        await page.goto(`${STOREFRONT_ORIGIN}/login`, { waitUntil: 'load' })
        const drawer = page.getByRole('dialog').first()
        await expect(drawer).toBeVisible()
        await shot(page, `${tag}-02-login-is-customer-signin`)
        await drawer.getByRole('button', { name: COPY[language].signUp }).click()
        await shot(page, `${tag}-03-signup-form`)
        await drawer.locator('input[name="name"]').fill('Dara')
        await drawer.locator('input[name="tel"]').fill('012 345 678')
        await drawer.locator('input[autocomplete="new-password"]').fill('secret-pass')
        await drawer.getByRole('checkbox').check()
        await drawer.getByRole('button', { name: COPY[language].create }).click()
        await expect(page.getByText(COPY[language].reminderTitle, { exact: true })).toBeVisible()
        await shot(page, `${tag}-04-signup-reminder-dialog`)
        await page.goto(`${STOREFRONT_ORIGIN}/pos`, { waitUntil: 'load' })
        await expectStorefrontRoot(page)
        await page.waitForTimeout(500)
        await shot(page, `${tag}-05-pos-path-shows-shop`)
        await page.goto(`${STOREFRONT_ORIGIN}/?legal=privacy`, { waitUntil: 'load' })
        await page.waitForTimeout(800)
        await shot(page, `${tag}-06-privacy`)
        await page.goto(`${STOREFRONT_ORIGIN}/?legal=terms`, { waitUntil: 'load' })
        await page.waitForTimeout(800)
        await shot(page, `${tag}-07-terms`)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(overflow, 'no horizontal page scroll').toBeLessThanOrEqual(0)
      })
    }
  }
})
