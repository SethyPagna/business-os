import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { ADMIN_ORIGIN, seedDeviceSettings } from './support/harness'
import { E2E_ACCOUNTS, signIn } from './support/session'

/**
 * install-band-layout.spec.ts -- the install band shares the screen with other things.
 *
 * WHAT THIS PROVES, by bounding boxes (class names prove nothing about where a box lands):
 *  - Sign-in on a phone, at 320x568, 375x667 and 390x844, in English and Khmer: the theme and language
 *    toggles never cover the brand title or the form, and the band never covers the title, either field,
 *    Login or "Forgot password?" once the page is scrolled to its end.
 *  - Desktop staff app: the band leaves the two scroll buttons at the bottom right uncovered and clickable.
 *
 * ERROR CLASS GUARDED: reserving room for a fixed band by shrinking the box the sign-in card is centred in
 * pushed the card up under the toggles at 320x568 (6.0.1051 review B1). Only a measurement sees that.
 */

type Language = 'en' | 'km'
type Box = { x: number; y: number; width: number; height: number }

const pack = (language: Language): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>

const PHONES = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
] as const

const FIRE_INSTALL_PROMPT = () => {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: async () => {},
    userChoice: Promise.resolve({ outcome: 'dismissed' }),
  })
  window.dispatchEvent(event)
}

async function boxOf(locator: Locator, what: string): Promise<Box> {
  await expect(locator, `${what} is on screen`).toBeVisible()
  const box = await locator.boundingBox()
  expect(box, `${what} has a box`).not.toBeNull()
  return box as Box
}

function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

const installBand = (page: Page, language: Language): Locator =>
  page.getByRole('status').filter({ has: page.getByRole('button', { name: pack(language).dismiss_notification, exact: true }) })

async function scrollToEnd(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

test.describe('sign-in with the install band', () => {
  test.describe.configure({ timeout: 120_000 })
  test.skip(({ browserName, isMobile }) => !isMobile && browserName === 'chromium', 'phone contracts: desktop has its own test below')

  for (const language of ['en', 'km'] as const) {
    for (const viewport of PHONES) {
      test(`${viewport.width}x${viewport.height} ${language}: toggles, title, form and band never overlap`, async ({ page, context }, info) => {
        await seedDeviceSettings(context, ADMIN_ORIGIN, { language })
        await page.setViewportSize(viewport)
        await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
        await expect(page.locator('#login-username')).toBeVisible({ timeout: 30_000 })
        // WebKit on an iPhone offers the Share steps by itself; Chromium on Android waits for the browser's prompt.
        if (info.project.name === 'android-chromium') await page.evaluate(FIRE_INSTALL_PROMPT)
        const band = installBand(page, language)
        await expect(band).toBeVisible()

        const toggles = page.locator('.auth-shell .absolute.z-20').first()
        const title = page.getByRole('heading', { level: 1 })
        const form = {
          'username field': page.locator('#login-username'),
          'password field': page.locator('#login-password'),
          'Login button': page.getByRole('button', { name: pack(language).login, exact: true }),
          'Forgot password': page.getByRole('button', { name: pack(language).reset_password_with_email, exact: true }),
        }

        await page.evaluate(() => window.scrollTo(0, 0))
        const togglesBox = await boxOf(toggles, 'the theme and language toggles')
        expect(overlapArea(togglesBox, await boxOf(title, 'the brand title')), 'toggles over the title').toBe(0)
        for (const [name, locator] of Object.entries(form)) {
          expect(overlapArea(togglesBox, await boxOf(locator, name)), `toggles over the ${name}`).toBe(0)
        }

        await scrollToEnd(page)
        const bandBox = await boxOf(band, 'the install band')
        expect(overlapArea(bandBox, await boxOf(title, 'the brand title')), 'band over the title').toBe(0)
        for (const [name, locator] of Object.entries(form)) {
          expect(overlapArea(bandBox, await boxOf(locator, name)), `band over the ${name}`).toBe(0)
        }
        const forgot = await boxOf(form['Forgot password'], 'Forgot password')
        expect(bandBox.y, 'the band starts below the last link of the form').toBeGreaterThanOrEqual(forgot.y + forgot.height)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll').toBe(true)
      })
    }
  }
})

test.describe('desktop staff app with the install band', () => {
  test.describe.configure({ timeout: 120_000 })
  test.skip(({ browserName, isMobile }) => isMobile || browserName !== 'chromium', 'a desktop contract')

  test('the band leaves the scroll buttons uncovered and clickable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await page.evaluate(FIRE_INSTALL_PROMPT)
    const band = installBand(page, 'en')
    const bandBox = await boxOf(band, 'the install band')

    for (const name of ['Scroll to top', 'Scroll to bottom']) {
      const button = page.getByRole('button', { name, exact: true })
      const buttonBox = await boxOf(button, name)
      expect(overlapArea(bandBox, buttonBox), `the band over "${name}"`).toBe(0)
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null, {
        x: buttonBox.x + buttonBox.width / 2,
        y: buttonBox.y + buttonBox.height / 2,
      })
      expect(hit, `"${name}" is what a click at its centre reaches`).toBe(name)
    }
    expect(bandBox.x + bandBox.width, 'the band stays inside the viewport').toBeLessThanOrEqual(1440)
  })
})
