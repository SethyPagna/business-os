import { expect, test, type Page } from '@playwright/test'
import { STOREFRONT_ORIGIN, collectPageHealth, expectNoRuntimeErrors, seedStorefrontLanguage } from './support/harness'
import { stubStorefrontConfig } from './support/storefrontStub'

/**
 * storefront-announcement.spec.ts -- the announcement bar (owner ask, 2 Nov 2026).
 *
 *  - One line above the storefront header, English and Khmer, an optional link, an on/off switch and an optional
 *    first and last day (both included, in the shop's Cambodia day).
 *  - A visitor can close it; it stays closed for that message and comes back when the message or link changes.
 *  - The text is shown as typed, never read as markup; a link is only ever http(s).
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test storefront-announcement
 *
 * Each test names the wrong implementation it catches. Messages are synthetic: the repository is public.
 */

test.use({ serviceWorkers: 'block' })

const ENGLISH = 'Sample sale this week only'
const KHMER = 'ការលក់ពិសេសសប្តាហ៍នេះប៉ុណ្ណោះ'
const BAR = {
  announcementEnabled: true,
  announcementTextEn: ENGLISH,
  announcementTextKm: KHMER,
  announcementLink: '',
  announcementStart: '',
  announcementEnd: '',
  announcementVersion: 'v1',
}

// 01:30 on 10 Nov in Phnom Penh is still 9 Nov (18:30) in UTC.
const NOW_PHNOM_PENH_10_NOV = new Date('2026-11-09T18:30:00Z')

type Options = { width?: number; language?: 'en' | 'km'; now?: Date }

async function openStorefront(page: Page, patch: Record<string, unknown>, { width = 390, language = 'en', now }: Options = {}): Promise<void> {
  await page.setViewportSize({ width, height: width < 700 ? 760 : 900 })
  await seedStorefrontLanguage(page.context(), STOREFRONT_ORIGIN, language)
  if (now) await page.clock.setFixedTime(now)
  await stubStorefrontConfig(page, patch)
  await page.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
  await expect(page.locator('footer[data-portal-footer="true"]')).toBeVisible()
}

const bar = (page: Page) => page.locator('[data-portal-announcement="true"]')

test.describe('Announcement bar', () => {
  test('shows the English message above the header, full width, at the very top of the page', async ({ page }) => {
    // CATCHES: a bar drawn inside the padded page (not full width), below the header, or over it (the header
    // would start under the bar), and the wrong language's text.
    const health = collectPageHealth(page)
    await openStorefront(page, BAR, { width: 1280 })
    await expect(bar(page)).toContainText(ENGLISH)
    await expect(bar(page)).not.toContainText(KHMER)
    const geometry = await page.evaluate(() => {
      const strip = document.querySelector('[data-portal-announcement="true"]')!.getBoundingClientRect()
      const header = document.querySelector('header.portal-header-shell')!.getBoundingClientRect()
      return { top: strip.top, left: strip.left, width: strip.width, bottom: strip.bottom, headerTop: header.top, viewport: document.documentElement.clientWidth }
    })
    expect(geometry.top).toBe(0)
    expect(geometry.left).toBe(0)
    expect(geometry.width).toBe(geometry.viewport)
    expect(geometry.headerTop).toBeGreaterThanOrEqual(geometry.bottom)
    expectNoRuntimeErrors(health)
  })

  test('a Khmer page shows the Khmer message, typeset as Khmer', async ({ page }) => {
    // CATCHES: showing English to a Khmer visitor, and Khmer text without the Khmer line-height class (clipped marks).
    await openStorefront(page, BAR, { language: 'km' })
    await expect(bar(page)).toContainText(KHMER)
    await expect(bar(page)).not.toContainText(ENGLISH)
    await expect(bar(page).locator('.khmer-text')).toHaveCount(1)
  })

  test('only one language written: the other page falls back to it instead of an empty bar', async ({ page }) => {
    // CATCHES: a Khmer visitor seeing nothing because only the English box was filled in.
    await openStorefront(page, { ...BAR, announcementTextKm: '' }, { language: 'km' })
    await expect(bar(page)).toContainText(ENGLISH)
  })

  test('off, or on with no text: there is no bar and no gap at the top', async ({ page }) => {
    // CATCHES: an empty coloured strip, and the page keeping a hole where the bar would be.
    await openStorefront(page, { ...BAR, announcementEnabled: false })
    await expect(bar(page)).toHaveCount(0)
    expect(await page.evaluate(() => document.querySelector('header.portal-header-shell')!.getBoundingClientRect().top)).toBeLessThan(40)
  })

  test('on with no text at all draws nothing', async ({ page }) => {
    await openStorefront(page, { ...BAR, announcementTextEn: '', announcementTextKm: '', announcementVersion: '' })
    await expect(bar(page)).toHaveCount(0)
  })

  const WINDOWS: ReadonlyArray<readonly [name: string, start: string, end: string, visible: boolean]> = [
    ['no days at all', '', '', true],
    ['the start day is today', '2026-11-10', '', true],
    ['starts tomorrow', '2026-11-11', '', false],
    ['the end day is today', '', '2026-11-10', true],
    ['ended yesterday (it is still the 9th in UTC)', '', '2026-11-09', false],
    ['inside a window', '2026-11-08', '2026-11-12', true],
    ['after a window', '2026-11-01', '2026-11-09', false],
    ['before a window', '2026-11-11', '2026-11-20', false],
  ]
  for (const [name, start, end, visible] of WINDOWS) {
    test(`days: ${name} -> ${visible ? 'shown' : 'hidden'} at 01:30 on 10 Nov in Phnom Penh`, async ({ page }) => {
      // CATCHES: the day read from UTC (9 Nov) or from the device zone, an end day that hides the message on its
      // last day, a start day that shows it a day early, and a time-keyed server cache standing in for the clock.
      await openStorefront(page, { ...BAR, announcementStart: start, announcementEnd: end }, { now: NOW_PHNOM_PENH_10_NOV })
      await expect(bar(page)).toHaveCount(visible ? 1 : 0)
    })
  }

  test('closing the bar keeps it closed for that message, and an edited message comes back', async ({ page, context }) => {
    // CATCHES: a close that only lasts until the next render, a dismissal not stored per browser, one that survives
    // an edited message, and one tied to the dates so extending a sale shows the bar again to everyone.
    await openStorefront(page, BAR)
    await bar(page).locator('[data-portal-announcement-dismiss="true"]').click()
    await expect(bar(page)).toHaveCount(0)
    await page.reload({ waitUntil: 'load' })
    await expect(page.locator('footer[data-portal-footer="true"]')).toBeVisible()
    await expect(bar(page), 'closed stays closed after a reload').toHaveCount(0)

    const extended = await context.newPage()
    await stubStorefrontConfig(extended, { ...BAR, announcementEnd: '2099-12-31' })
    await extended.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
    await expect(extended.locator('footer[data-portal-footer="true"]')).toBeVisible()
    await expect(bar(extended), 'only the end day changed: same message, still closed').toHaveCount(0)

    const edited = await context.newPage()
    await stubStorefrontConfig(edited, { ...BAR, announcementVersion: 'v2', announcementTextEn: 'Sample sale extended' })
    await edited.goto(`${STOREFRONT_ORIGIN}/`, { waitUntil: 'load' })
    await expect(edited.locator('footer[data-portal-footer="true"]')).toBeVisible()
    await expect(bar(edited), 'a new message is shown to everyone again').toContainText('Sample sale extended')
  })

  test('a visitor whose browser blocks storage can still close it for the page view', async ({ page }) => {
    // CATCHES: a throwing localStorage breaking the page or leaving a bar that cannot be closed.
    const health = collectPageHealth(page)
    await page.addInitScript(() => {
      const blocked = () => { throw new DOMException('blocked', 'SecurityError') }
      try {
        Object.defineProperty(window, 'localStorage', { get: blocked, configurable: true })
      } catch { /* already locked down */ }
    })
    await openStorefront(page, BAR)
    await bar(page).locator('[data-portal-announcement-dismiss="true"]').click()
    await expect(bar(page)).toHaveCount(0)
    expect(health.pageErrors.filter((message) => /blocked|SecurityError/i.test(message)), 'the page did not crash').toEqual([])
  })

  test('the message is shown as typed: markup never runs, and a bad link is not a link', async ({ page }) => {
    // CATCHES: innerHTML rendering (the <img> would exist and its onerror run), a javascript: link becoming a
    // clickable anchor, and the whole bar vanishing because its link was refused.
    await openStorefront(page, { ...BAR, announcementTextEn: '<img src=x onerror="window.__xss=1"> <b>bold</b> & "quotes"', announcementLink: 'javascript:window.__xss=1' })
    await expect(bar(page)).toContainText('<img src=x onerror="window.__xss=1"> <b>bold</b> & "quotes"')
    await expect(bar(page).locator('img, b')).toHaveCount(0)
    await expect(bar(page).locator('a')).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  })

  test('a link wraps the message and opens that page in a new tab', async ({ page, context }) => {
    // CATCHES: a link that navigates the storefront away, a missing rel=noopener, and a link that is not the message.
    await context.route('https://example.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>news</title>' }))
    await openStorefront(page, { ...BAR, announcementLink: 'https://example.test/news' })
    const link = bar(page).locator('a[data-portal-announcement-link="true"]')
    await expect(link).toHaveText(ENGLISH)
    await expect(link).toHaveAttribute('rel', /noopener/)
    const popup = context.waitForEvent('page')
    await link.click()
    expect((await popup).url()).toBe('https://example.test/news')
    expect(page.url()).toContain(STOREFRONT_ORIGIN)
  })

  test('accessible names are translated, and the close button is a 44 px target', async ({ page }) => {
    // CATCHES: an unnamed icon button, English labels on a Khmer page, and a target below the touch size.
    await openStorefront(page, BAR, { language: 'km' })
    const region = page.getByRole('region', { name: 'សេចក្តីជូនដំណឹង' })
    await expect(region).toHaveCount(1)
    const close = region.getByRole('button', { name: 'បិទសេចក្តីជូនដំណឹង' })
    await expect(close).toHaveAttribute('title', 'បិទសេចក្តីជូនដំណឹង')
    const box = await close.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })

  for (const width of [360, 390, 768, 1280, 1600]) {
    test(`at ${width}px a long two-language message wraps inside the screen and nothing scrolls sideways`, async ({ page }) => {
      // CATCHES: a one-line bar that runs off the screen, a close button pushed out of view, and a bar so tall it
      // pushes the page down.
      const long = 'Sample long announcement text that goes on for a while to prove that it wraps instead of running off the edge. '.repeat(2).trim().slice(0, 200)
      await openStorefront(page, { ...BAR, announcementTextEn: long, announcementLink: 'https://example.test/a/very/long/path/that/keeps/going/and/going/and/going' }, { width })
      const report = await page.evaluate(() => {
        const strip = document.querySelector('[data-portal-announcement="true"]')!
        const close = strip.querySelector('[data-portal-announcement-dismiss="true"]')!.getBoundingClientRect()
        const rect = strip.getBoundingClientRect()
        return { height: rect.height, closeInside: close.right <= window.innerWidth && close.left >= 0, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }
      })
      expect(report.overflow).toBeLessThanOrEqual(0)
      expect(report.closeInside).toBe(true)
      expect(report.height).toBeLessThan(width < 700 ? 140 : 90)
    })
  }

  test('the bar scrolls away with the page and does not hide the sticky section tabs', async ({ page }) => {
    // CATCHES: a fixed bar that stays on screen and covers the tabs, or tabs that stick underneath it.
    await openStorefront(page, BAR, { width: 1280 })
    await page.evaluate(() => window.scrollTo(0, 600))
    const report = await page.evaluate(() => {
      const strip = document.querySelector('[data-portal-announcement="true"]')!.getBoundingClientRect()
      const tabs = document.querySelector('nav[aria-label="Section navigation"]')!.getBoundingClientRect()
      return { stripBottom: strip.bottom, tabsTop: tabs.top }
    })
    expect(report.stripBottom).toBeLessThanOrEqual(0)
    expect(report.tabsTop).toBeGreaterThanOrEqual(0)
  })
})
