import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { ADMIN_ORIGIN, collectPageHealth } from './support/harness'
import { E2E_ACCOUNTS, signIn, APP_ROOT } from './support/session'

// The sale corner tag, measured in a real browser (owner, 6 Oct 2026).
//
//   * the Sales list shows a partial-return sale as Not Paid / Completed (its
//     payment state) with a corner ribbon for the return;
//   * the ribbon moves NOTHING: the same sale rendered with no tag has the
//     identical card height and the identical receipt-id and chip boxes;
//   * the ribbon takes no taps, and the detail float paints over it.
//
// UI/transport contract only: GET /api/sales is answered from here so the list
// holds a returned sale. The Worker's own columns are covered by the pure tests.
// Two device pixels per CSS pixel so the close-up shots show what a phone shows.
test.use({ serviceWorkers: 'block', deviceScaleFactor: 2 })
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'viewports are set by the spec itself; one browser is enough')
})

const SHOT_DIR = process.env.SALE_TAG_SHOTS || ''
/** The receipt id as drawn in the layout that is showing (the table and the phone cards both exist in the DOM). */
const receipt = (page: Page, id: string) => page.locator(`:text-is("${id}")`).locator('visible=true').first()
const sales = JSON.parse(fs.readFileSync(path.resolve('e2e/fixtures/admin-sales.json'), 'utf8')) as Array<Record<string, unknown>>

type Variant = 'tagged' | 'plain'
const PARTIAL = '20260910-105539'
const RETURNED = '20260909-181013'

function listFor(variant: Variant): Array<Record<string, unknown>> {
  const base = sales[0]
  const make = (id: number, receipt: string, createdAt: string, extra: Record<string, unknown>) =>
    ({ ...base, id, receipt_number: receipt, created_at: createdAt, items: [], ...extra })
  const tagged = variant === 'tagged'
  return [
    make(9101, '20261002-080547', '2026-10-02T01:05:00.000Z', { sale_status: 'completed', customer_name: 'DD Smart', customer_phone: '093466649' }),
    // Not Paid, then partly returned: the chip must still say Not Paid.
    make(9102, PARTIAL, '2026-09-10T03:55:00.000Z', { sale_status: tagged ? 'partial_return' : 'awaiting_payment', status_before_return: 'awaiting_payment', payment_method: 'Cash' }),
    // Paid, then fully returned: the chip must say Completed.
    make(9103, RETURNED, '2026-09-09T11:10:00.000Z', { sale_status: tagged ? 'returned' : 'completed', status_before_return: 'completed', payment_method: 'ACLEDA', customer_name: 'amom zei', customer_phone: '016 926 331' }),
    make(9104, '20260907-090000', '2026-09-07T02:00:00.000Z', { sale_status: 'awaiting_payment', status_before_return: null }),
  ]
}

async function openSales(page: Page, language: 'en' | 'km', variant: { current: Variant }) {
  await page.route(`${ADMIN_ORIGIN}/api/sales*`, async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() !== 'GET' || url.pathname !== '/api/sales') return route.fallback()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(listFor(variant.current)) })
  })
  await page.goto(`${ADMIN_ORIGIN}/`, { waitUntil: 'load' })
  await signIn(page, E2E_ACCOUNTS.cashierA)
  if (language === 'km') {
    // The sign-in form is driven by English names, so choose Khmer the way the device remembers it.
    await page.evaluate(() => localStorage.setItem('businessos_device_settings', JSON.stringify({ language: 'km' })))
  }
  await page.goto(`${ADMIN_ORIGIN}/sales`)
  await expect(page.locator(APP_ROOT)).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-ui-language', language)
  await expect(receipt(page, PARTIAL)).toBeVisible({ timeout: 30_000 })
}

/** The host row/card of a receipt id, plus the boxes that must not move. */
async function measure(page: Page, receipt: string) {
  return page.evaluate((id) => {
    const visible = (el: Element) => !!(el as HTMLElement).offsetParent || getComputedStyle(el).position === 'fixed'
    const idEl = Array.from(document.querySelectorAll('[data-copyable-id], button, td, span'))
      .filter((el) => el.children.length === 0 && el.textContent?.trim() === id && visible(el))[0]
    if (!idEl) return null
    const host = idEl.closest('.card, tr') as HTMLElement
    const hostBox = host.getBoundingClientRect()
    const idBox = idEl.getBoundingClientRect()
    const chipBox = Array.from(host.querySelectorAll('span')).filter((el) => /rounded-full/.test(el.className))[0]?.getBoundingClientRect()
    const ribbon = host.querySelector('[data-sale-tag-ribbon]') as HTMLElement | null
    const style = ribbon ? getComputedStyle(ribbon) : null
    const rb = ribbon?.getBoundingClientRect()
    const chipText = Array.from(host.querySelectorAll('span')).filter((el) => /rounded-full/.test(el.className))[0]?.textContent?.trim() || ''
    return {
      hostHeight: hostBox.height, hostWidth: hostBox.width,
      id: { x: idBox.x - hostBox.x, y: idBox.y - hostBox.y, w: idBox.width, h: idBox.height },
      chip: chipBox ? { x: chipBox.x - hostBox.x, y: chipBox.y - hostBox.y, w: chipBox.width, h: chipBox.height } : null,
      chipText,
      ribbon: ribbon ? { position: style!.position, pointerEvents: style!.pointerEvents, zIndex: style!.zIndex, overflow: style!.overflow, text: ribbon.textContent?.trim(), label: ribbon.getAttribute('aria-label'), x: rb!.x - hostBox.x, y: rb!.y - hostBox.y, w: rb!.width, h: rb!.height, cx: rb!.x + rb!.width / 2, cy: rb!.y + rb!.height / 2 } : null,
      // The id text's left-middle point, relative to the host's top-left corner: the band's far edge is x + y = 33.
      idLeftMiddleSum: (idBox.x - hostBox.x) + (idBox.y - hostBox.y + idBox.height / 2),
    }
  }, receipt)
}

async function shot(page: Page, name: string, testInfo: { outputPath: (n: string) => string }) {
  await page.screenshot({ path: SHOT_DIR ? path.join(SHOT_DIR, name) : testInfo.outputPath(name) })
}

for (const language of ['en', 'km'] as const) {
  for (const width of [360, 1280]) {
    test(`${language} ${width}px: payment chip + overlay ribbon, nothing moves, the float covers it`, async ({ page }, testInfo) => {
      if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true })
      const health = collectPageHealth(page)
      await page.setViewportSize({ width, height: 900 })
      const variant = { current: 'plain' as Variant }
      await openSales(page, language, variant)

      // Plain: the same sales without any return state.
      const plain = { partial: await measure(page, PARTIAL), returned: await measure(page, RETURNED) }
      expect(plain.partial?.ribbon, 'no tag, no ribbon').toBeNull()

      // Tagged: reload with the returned states.
      variant.current = 'tagged'
      await page.reload()
      await expect(receipt(page, PARTIAL)).toBeVisible({ timeout: 30_000 })
      const tagged = { partial: await measure(page, PARTIAL), returned: await measure(page, RETURNED) }
      await shot(page, `sales-${language}-${width}-tagged.png`, testInfo)
      for (const [key, id] of [['partial', PARTIAL], ['returned', RETURNED]] as const) {
        const host = receipt(page, id).locator('xpath=ancestor::*[self::tr or (self::div and contains(@class,"card"))][1]')
        await host.screenshot({ path: SHOT_DIR ? path.join(SHOT_DIR, `closeup-${language}-${width}-${key}.png`) : testInfo.outputPath(`closeup-${key}.png`) })
      }

      for (const key of ['partial', 'returned'] as const) {
        const before = plain[key]!, after = tagged[key]!
        // ZERO LAYOUT SHIFT: same host height and width, same id box, same chip box.
        expect(after.hostHeight, `${key}: card height with and without the ribbon`).toBe(before.hostHeight)
        expect(after.hostWidth).toBe(before.hostWidth)
        expect(after.id, `${key}: the receipt id box does not move`).toEqual(before.id)
        expect(after.chip, `${key}: the chip box does not move`).toEqual(before.chip)
        // The ribbon: an absolute, click-through, bottom-layer overlay clipped to its own box.
        expect(after.ribbon).not.toBeNull()
        expect(after.ribbon!.position).toBe('absolute')
        expect(after.ribbon!.pointerEvents).toBe('none')
        expect(after.ribbon!.overflow).toBe('hidden')
        expect(['auto', '0']).toContain(after.ribbon!.zIndex)
        expect(after.ribbon!.x).toBeLessThanOrEqual(1)
        expect(after.ribbon!.y).toBeLessThanOrEqual(1)
        expect(after.ribbon!.w).toBeLessThanOrEqual(34)
        // The band stays off the receipt id's readable start.
        expect(after.idLeftMiddleSum, `${key}: the id's left-middle point is outside the band`).toBeGreaterThanOrEqual(33)
      }
      // The chip is the PAYMENT state, never a return word.
      const notPaid = language === 'en' ? 'Not Paid' : 'ប្រាក់ជំពាក់'
      const completed = language === 'en' ? 'Completed' : 'បានបញ្ចប់'
      expect(tagged.partial!.chipText).toBe(notPaid)
      expect(tagged.returned!.chipText).toBe(completed)
      const words = language === 'en' ? ['Partial', 'Returned'] : ['ប្រគល់ខ្លះ', 'បានប្រគល់']
      expect(tagged.partial!.ribbon!.text).toBe(words[0])
      expect(tagged.returned!.ribbon!.text).toBe(words[1])

      // Click-through: the point under the ribbon's centre is the card, not the ribbon.
      const hit = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        return { insideRibbon: !!el?.closest('[data-sale-tag-ribbon]'), tag: el?.tagName || '' }
      }, { x: tagged.partial!.ribbon!.cx, y: tagged.partial!.ribbon!.cy })
      expect(hit.insideRibbon, 'a tap on the ribbon reaches the card under it').toBe(false)

      // Open the sale: the float is its own layer and covers the ribbon.
      if (width < 768) {
        // The phone card opens on a tap anywhere that is not a link: the total, at the card's right edge.
        const card = receipt(page, PARTIAL).locator('xpath=ancestor::div[contains(@class,"card")][1]')
        const box = (await card.boundingBox())!
        await card.click({ position: { x: box.width - 40, y: 18 } })
      } else {
        await receipt(page, PARTIAL).click()
      }
      const dialog = page.locator('[role="dialog"]').first()
      await expect(dialog).toBeVisible({ timeout: 15_000 })
      await page.waitForTimeout(400)
      const covered = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        return { insideRibbon: !!el?.closest('[data-sale-tag-ribbon]'), insideFloat: !!el?.closest('[role="dialog"], .fixed') }
      }, { x: tagged.partial!.ribbon!.cx, y: tagged.partial!.ribbon!.cy })
      await shot(page, `sale-detail-${language}-${width}.png`, testInfo)
      // On a wide viewport the float is centred and may not reach the list's corner: then the point is the dimmed
      // backdrop (a fixed layer), which is also above the ribbon. Either way the ribbon is not what is hit.
      expect(covered.insideRibbon, 'the ribbon never shows through or blocks the float layer').toBe(false)
      expect(covered.insideFloat, 'the point is covered by the float or its backdrop').toBe(true)

      // The float's own header wears the same ribbon and the same chip.
      const headerRibbon = dialog.locator('[data-sale-tag-ribbon]')
      await expect(headerRibbon).toHaveCount(1)
      await expect(headerRibbon).toHaveText(words[0])
      await expect(dialog.getByText(notPaid, { exact: true }).first()).toBeVisible()
      expect(health.pageErrors).toEqual([])
    })
  }
}
