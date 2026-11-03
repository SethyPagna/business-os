import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { ADMIN_ORIGIN, seedDeviceSettings } from './support/harness'
import { E2E_ACCOUNTS, signIn } from './support/session'

/**
 * install-band-layout.spec.ts -- the install band shares the screen with other things.
 *
 * WHAT THIS PROVES, by bounding boxes (class names prove nothing about where a box lands):
 *  - Sign-in on a phone, in English and Khmer: the theme and language toggles never cover the brand title
 *    or the form; the band never covers the title or a form control, on the FIRST screen (portrait phones,
 *    320x568 up) and at the end of the page (every size, landscape and a short desktop window included);
 *    under 360 px the band is one short row.
 *  - Desktop sign-in: the band sits in the normal corner and moves nothing. Desktop staff app: the band
 *    leaves the two scroll buttons at the bottom right uncovered and clickable; so does a signed-in phone
 *    (390x844, 360x800), where a tap at a button's centre must reach the button, not the band.
 *
 * ERRORS GUARDED: reserving room for a fixed band by shrinking the box the sign-in card is centred in pushed
 * the card up under the toggles at 320x568 (6.0.1051 review B1); a 106 px band hid "Forgot password?" on the
 * first screen at 320x568; a corner band covered the lower form of a landscape phone (844x390). Only a
 * measurement sees these.
 */

type Language = 'en' | 'km'
type Box = { x: number; y: number; width: number; height: number }

const pack = (language: Language): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../src/lang/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>

const VIEWPORTS = [
  { width: 320, height: 568, firstScreen: true },
  { width: 375, height: 667, firstScreen: true },
  { width: 390, height: 844, firstScreen: true },
  // A phone turned sideways has no room for the form and a band at once: only the end of the page can be clear.
  { width: 667, height: 375, firstScreen: false },
  { width: 844, height: 390, firstScreen: false },
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

// A wide window also shows the hero's own h1, so the card's title is picked by its name.
const brandTitle = (page: Page): Locator => page.getByRole('heading', { level: 1, name: 'Leang Beauty', exact: true })

const formControls = (page: Page, language: Language) => ({
  'username field': page.locator('#login-username'),
  'password field': page.locator('#login-password'),
  'Login button': page.getByRole('button', { name: pack(language).login, exact: true }),
  'Forgot password': page.getByRole('button', { name: pack(language).reset_password_with_email, exact: true }),
})

async function scrollToEnd(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

/** The band touches neither the brand title nor any control of the form, as the page is scrolled right now. */
async function expectBandClearOfForm(page: Page, language: Language, when: string): Promise<Box> {
  const bandBox = await boxOf(installBand(page, language), 'the install band')
  expect(overlapArea(bandBox, await boxOf(brandTitle(page), 'the brand title')), `${when}: band over the title`).toBe(0)
  for (const [name, locator] of Object.entries(formControls(page, language))) {
    expect(overlapArea(bandBox, await boxOf(locator, name)), `${when}: band over the ${name}`).toBe(0)
  }
  return bandBox
}

/** Neither scroll button is under the band, and a tap at the centre of each reaches that button. */
async function expectScrollButtonsReachable(page: Page, bandBox: Box): Promise<void> {
  for (const name of ['Scroll to top', 'Scroll to bottom']) {
    const buttonBox = await boxOf(page.getByRole('button', { name, exact: true }), name)
    expect(overlapArea(bandBox, buttonBox), `the band over "${name}"`).toBe(0)
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null, {
      x: buttonBox.x + buttonBox.width / 2,
      y: buttonBox.y + buttonBox.height / 2,
    })
    expect(hit, `"${name}" is what a tap at its centre reaches`).toBe(name)
  }
}

test.describe('sign-in with the install band', () => {
  test.describe.configure({ timeout: 120_000 })
  test.skip(({ browserName, isMobile }) => !isMobile && browserName === 'chromium', 'phone contracts: desktop has its own tests below')

  for (const language of ['en', 'km'] as const) {
    for (const viewport of VIEWPORTS) {
      test(`${viewport.width}x${viewport.height} ${language}: toggles, title, form and band never overlap`, async ({ page, context }, info) => {
        await seedDeviceSettings(context, ADMIN_ORIGIN, { language })
        await page.setViewportSize(viewport)
        await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
        await expect(page.locator('#login-username')).toBeVisible({ timeout: 30_000 })
        // WebKit on an iPhone offers the Share steps by itself; Chromium on Android waits for the browser's prompt.
        if (info.project.name === 'android-chromium') await page.evaluate(FIRE_INSTALL_PROMPT)
        await expect(installBand(page, language)).toBeVisible()

        await page.evaluate(() => window.scrollTo(0, 0))
        const togglesBox = await boxOf(page.locator('.auth-shell .absolute.z-20').first(), 'the theme and language toggles')
        expect(overlapArea(togglesBox, await boxOf(brandTitle(page), 'the brand title')), 'toggles over the title').toBe(0)
        for (const [name, locator] of Object.entries(formControls(page, language))) {
          expect(overlapArea(togglesBox, await boxOf(locator, name)), `toggles over the ${name}`).toBe(0)
        }
        if (viewport.firstScreen) await expectBandClearOfForm(page, language, 'first screen')

        await scrollToEnd(page)
        const bandBox = await expectBandClearOfForm(page, language, 'end of the page')
        const forgot = await boxOf(formControls(page, language)['Forgot password'], 'Forgot password')
        expect(bandBox.y, 'the band starts below the last link of the form').toBeGreaterThanOrEqual(forgot.y + forgot.height)
        if (viewport.width < 360) expect(bandBox.height, 'under 360 px the band is one short row').toBeLessThanOrEqual(58)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll').toBe(true)
      })
    }
  }
})

test.describe('desktop with the install band', () => {
  test.describe.configure({ timeout: 120_000 })
  test.skip(({ browserName, isMobile }) => isMobile || browserName !== 'chromium', 'a desktop contract')

  test('sign-in: the band sits in the normal corner and moves nothing', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator('#login-username')).toBeVisible({ timeout: 30_000 })
    const titleBefore = await boxOf(brandTitle(page), 'the brand title')
    await page.evaluate(FIRE_INSTALL_PROMPT)
    const bandBox = await boxOf(installBand(page, 'en'), 'the install band')
    expect(1440 - (bandBox.x + bandBox.width), 'the band is 16 px from the right edge: no scroll buttons share this corner').toBeCloseTo(16, 0)
    expect(await boxOf(brandTitle(page), 'the brand title'), 'a tall desktop screen keeps its centring').toEqual(titleBefore)
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight), 'and does not start to scroll').toBe(true)
  })

  test('sign-in on a short 768x500 window: the page scrolls clear of the corner band', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 500 })
    await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
    await expect(page.locator('#login-username')).toBeVisible({ timeout: 30_000 })
    await page.evaluate(FIRE_INSTALL_PROMPT)
    await expect(installBand(page, 'en')).toBeVisible()
    await scrollToEnd(page)
    await expectBandClearOfForm(page, 'en', 'end of the page')
  })

  test('staff app: the band leaves the scroll buttons uncovered and clickable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await page.evaluate(FIRE_INSTALL_PROMPT)
    const bandBox = await boxOf(installBand(page, 'en'), 'the install band')
    await expectScrollButtonsReachable(page, bandBox)
    expect(bandBox.x + bandBox.width, 'the band stays inside the viewport').toBeLessThanOrEqual(1440)
  })
})

test.describe('signed-in app on a phone with the install band', () => {
  test.describe.configure({ timeout: 120_000 })
  test.skip(({ browserName, isMobile }) => !isMobile && browserName === 'chromium', 'phone contracts: desktop has its own test above')

  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
    test(`${viewport.width}x${viewport.height}: the band leaves the scroll buttons uncovered and tappable`, async ({ page }, info) => {
      await page.setViewportSize(viewport)
      await signIn(page, E2E_ACCOUNTS.cashierA)
      if (info.project.name === 'android-chromium') await page.evaluate(FIRE_INSTALL_PROMPT)
      const bandBox = await boxOf(installBand(page, 'en'), 'the install band')
      await expectScrollButtonsReachable(page, bandBox)
      expect(bandBox.x + bandBox.width, 'the band stays inside the viewport').toBeLessThanOrEqual(viewport.width)
    })
  }
})
