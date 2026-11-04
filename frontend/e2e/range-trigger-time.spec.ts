import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { ADMIN_ORIGIN, DEVICE_SETTINGS_KEY, collectPageHealth, expectNoRuntimeErrors } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * range-trigger-time.spec.ts -- the closed date-range button on the pages the
 * owner looks at every day.
 *
 * Owner, 4 Nov 2026: "i still see dashboard and other not showing time only
 * showing date." Every timed page (showTime) filters by hour, so the button
 * must print each endpoint as date AND time, on one line, and must not clip the
 * time or push the page sideways on a phone (owner, 15 Sep: "i want them same
 * compact one row").
 *
 * Runs on the BUILT app (the fixture server serves dist) on all three engines,
 * at the phone width and the desktop width. Set BUSINESS_OS_SCREENSHOTS_DIR to
 * also save a screenshot of each page's range row.
 */

const SIZES = [
  { label: '360x740', width: 360, height: 740 },
  { label: '1280x800', width: 1280, height: 800 },
] as const

const PAGES = [
  { name: 'dashboard', path: '/' },
  { name: 'sales', path: '/sales' },
] as const

interface TriggerReport {
  endpoints: Array<{ date: string; time: string; clipped: boolean; top: number; oneLine: boolean }>
  buttonRight: number
  buttonClipped: boolean
  pageScroll: number
  pageClient: number
}

async function readTrigger(page: Page): Promise<TriggerReport> {
  return page.evaluate(() => {
    const track = document.querySelector('[data-date-range-trigger-values]')
    if (!track) throw new Error('no range trigger on the page')
    const button = track.closest('button') as HTMLButtonElement
    const endpoints = [track.children[0], track.children[2]].map((node) => {
      const [date, time] = Array.from(node.children)
      const size = parseFloat(getComputedStyle(node).fontSize)
      const box = node.getBoundingClientRect()
      return {
        date: date?.textContent ?? '', time: time?.textContent ?? '',
        clipped: node.scrollWidth > node.clientWidth + 1, top: Math.round(box.top),
        oneLine: box.height <= size * 1.5 && !!time && Math.abs(date.getBoundingClientRect().top - time.getBoundingClientRect().top) < 1,
      }
    })
    return {
      endpoints, buttonRight: button.getBoundingClientRect().right, buttonClipped: button.scrollWidth > button.clientWidth + 1,
      pageScroll: document.documentElement.scrollWidth, pageClient: document.documentElement.clientWidth,
    }
  })
}

for (const pageSpec of PAGES) {
  for (const size of SIZES) {
    test(`${pageSpec.name} range button shows date and time on one line at ${size.label}`, async ({ page }, testInfo) => {
      const health = collectPageHealth(page)
      await page.setViewportSize({ width: size.width, height: size.height })
      await signIn(page, E2E_ACCOUNTS.cashierA)
      await gotoAdminPage(page, pageSpec.path)
      await expect(page.locator('[data-date-range-trigger-values]').first()).toBeVisible({ timeout: 30_000 })
      // The first paint can precede the layout the user sees; wait for the fonts the row is measured with.
      await page.evaluate(() => document.fonts.ready.then(() => true))

      const report = await readTrigger(page)
      for (const endpoint of report.endpoints) {
        expect(endpoint.date, `${pageSpec.name} ${size.label}: date`).toMatch(/^\d{2}\/\d{2}\/\d{4}$/)
        expect(endpoint.time, `${pageSpec.name} ${size.label}: time`).toMatch(/^\d{2}:\d{2}$/)
        expect(endpoint.clipped, `${pageSpec.name} ${size.label}: ${endpoint.date} ${endpoint.time} is clipped by its own box`).toBe(false)
        expect(endpoint.oneLine, `${pageSpec.name} ${size.label}: date and time share one line`).toBe(true)
      }
      expect(report.endpoints[0].top, 'Start and End share one row').toBe(report.endpoints[1].top)
      expect(report.buttonClipped, 'the button holds its content').toBe(false)
      expect(report.buttonRight, 'the button stays on screen').toBeLessThanOrEqual(size.width + 1)
      expect(report.pageScroll, 'the page does not scroll sideways').toBeLessThanOrEqual(report.pageClient)

      const directory = process.env.BUSINESS_OS_SCREENSHOTS_DIR
      if (directory) {
        fs.mkdirSync(directory, { recursive: true })
        const stem = `${pageSpec.name}-${size.label}-${testInfo.project.name}`
        await page.screenshot({ path: path.join(directory, `${stem}-page.png`) })
        const row = page.locator('[data-stats-range-controls]').first()
        if (await row.count()) await row.screenshot({ path: path.join(directory, `${stem}-range-row.png`) })
      }
      expectNoRuntimeErrors(health)
    })
  }
}

// P1.8b: the stock cards may be up to 5 minutes old, so the Dashboard prints the Worker's compute time under the range. The fixture server
// sends 2026-11-04T07:05:00Z, which is 14:05 in Phnom Penh whatever the browser's own time zone is.
for (const language of ['en', 'km'] as const) {
  for (const size of SIZES) {
    test(`dashboard prints when the stock figures were computed (${language}) at ${size.label}`, async ({ page }, testInfo) => {
      const health = collectPageHealth(page)
      await page.setViewportSize({ width: size.width, height: size.height })
      await signIn(page, E2E_ACCOUNTS.cashierA)
      // The sign-in form is English-only to the helper, so the language is chosen after it, the way the in-app toggle stores it.
      await page.evaluate(([key, value]) => window.localStorage.setItem(key, JSON.stringify(value)), [DEVICE_SETTINGS_KEY, { language }] as const)
      await gotoAdminPage(page, '/')
      await expect(page.locator('html')).toHaveAttribute('lang', language)
      const line = page.getByText(language === 'en' ? 'Stock as of 14:05' : 'ស្តុក ត្រឹម 14:05', { exact: true })
      await expect(line).toBeVisible({ timeout: 30_000 })
      await page.evaluate(() => document.fonts.ready.then(() => true))
      const box = await line.evaluate((node) => {
        const style = getComputedStyle(node)
        const size = parseFloat(style.fontSize)
        return {
          fontSize: size, lineHeight: style.lineHeight === 'normal' ? size * 1.6 : parseFloat(style.lineHeight),
          clippedAcross: node.scrollWidth > node.clientWidth + 1, clippedDown: node.scrollHeight > node.clientHeight + 1,
          right: node.getBoundingClientRect().right, pageScroll: document.documentElement.scrollWidth, pageClient: document.documentElement.clientWidth,
        }
      })
      expect(box.fontSize, 'not below the 11 px floor').toBeGreaterThanOrEqual(11)
      expect(box.lineHeight, 'a line box with room for the script').toBeGreaterThanOrEqual(box.fontSize * (language === 'km' ? 1.5 : 1.2))
      expect(box.clippedAcross, 'the sentence fits its row').toBe(false)
      expect(box.clippedDown, 'no glyph is cut off vertically').toBe(false)
      expect(box.right, 'on screen').toBeLessThanOrEqual(size.width + 1)
      expect(box.pageScroll, 'the page does not scroll sideways').toBeLessThanOrEqual(box.pageClient)

      const directory = process.env.BUSINESS_OS_SCREENSHOTS_DIR
      if (directory) {
        fs.mkdirSync(directory, { recursive: true })
        await page.screenshot({ path: path.join(directory, `dashboard-stock-as-of-${language}-${size.label}-${testInfo.project.name}.png`) })
      }
      expectNoRuntimeErrors(health)
    })
  }
}
