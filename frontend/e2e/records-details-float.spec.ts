import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { collectPageHealth, expectNoRuntimeErrors } from './support/harness'
import { E2E_ACCOUNTS, gotoAdminPage, signIn } from './support/session'

/**
 * records-details-float.spec.ts -- a product's Records: the hint, before/after,
 * and the VIEW-ONLY "more details" float.
 *
 * Owner, 5 Oct 2026: keep the "tap a record to view details" hint; a record
 * shows before and after; a "more details" option opens another float that is
 * view only; the product's created date lives in its own Records.
 *
 * WHAT THIS PROVES, in the built app at 360x800 and 1280x800, in English and
 * Khmer:
 *  - the Records float paints its real rows at once, with the hint beside the
 *    count and the product's created date as its own line;
 *  - pressing a record shows before and after in place, changed fields only;
 *  - the icon on the open row opens a second float with the whole record, and
 *    that float holds no input, no select, no textarea and no button but the
 *    header close;
 *  - nothing overflows the viewport sideways, and the cost line is present for
 *    the admin who holds cost permission (the hidden case is a unit test,
 *    recordDetailFloat.test.ts -- this fixture has only full-role accounts).
 *
 * The audit endpoint is answered here with a fixed trail: the fixture server has
 * no audit rows. Screenshots go to RECORDS_FLOAT_SHOTS when it is set.
 */
test.use({ serviceWorkers: 'block' })

const SHOTS = process.env.RECORDS_FLOAT_SHOTS || ''
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const AUDIT_ITEMS = [
  {
    id: 7001,
    action: 'update',
    entity: 'product',
    table_name: 'products',
    user_name: 'sokha',
    created_at: '2026-09-22 10:15:00',
    details: JSON.stringify({ reason: 'Supplier raised the price' }),
    old_value: JSON.stringify({ id: 1000, name: 'E2E Product 001 Aurelia', selling_price_usd: 19.5, cost_price_usd: 12.25, barcode: '8800000001000' }),
    new_value: JSON.stringify({ id: 1000, name: 'E2E Product 001 Aurelia', selling_price_usd: 21.92, cost_price_usd: 13.15, barcode: '8800000001000' }),
  },
]

// The fixture products carry no created_at; the real list read does (products.ts
// selects p.created_at). Stamp one on every product the page reads so the product's
// own created date can be seen in its Records.
const CREATED_AT = '2026-08-01 09:30:00'
function stampCreatedAt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stampCreatedAt)
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(source)) next[key] = stampCreatedAt(child)
    if ('selling_price_usd' in next && !('created_at' in next)) next.created_at = CREATED_AT
    return next
  }
  return value
}

async function openProductRecords(page: Page, language: 'en' | 'km'): Promise<void> {
  await page.route('**/api/products**', async (route) => {
    const response = await route.fetch()
    const type = response.headers()['content-type'] || ''
    if (!type.includes('json')) return route.fulfill({ response })
    return route.fulfill({ response, json: stampCreatedAt(await response.json()) })
  })
  await page.route('**/api/system/audit-logs**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: AUDIT_ITEMS, hasMore: false, nextCursor: null }),
  }))
  await signIn(page, E2E_ACCOUNTS.cashierA, 'admin123')
  await gotoAdminPage(page, '/products')
  if (language === 'km') {
    // Switch the pack BEFORE any float opens: a float's backdrop covers the toggle.
    await page.locator('button:has(span:text-is("EN")), button:has(span:text-is("KM"))').filter({ visible: true }).first().click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'km')
  }
  // The phone and desktop layouts both render the name; press the one that is on screen.
  await page.getByText('E2E Product 001 Aurelia').filter({ visible: true }).first().click()
  await page.locator('[data-product-field-history]').click()
}

async function expectNoSidewaysOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'the page must not scroll sideways').toBeLessThanOrEqual(1)
  for (const dialog of await page.getByRole('dialog').all()) {
    const box = await dialog.boundingBox()
    const size = page.viewportSize()!
    expect(box!.x).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1)
  }
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

for (const size of [{ width: 360, height: 800, name: '360' }, { width: 1280, height: 800, name: '1280' }]) {
  for (const language of ['en', 'km'] as const) {
    test.describe(`${size.name}px, ${language}`, () => {
      test.use({ viewport: { width: size.width, height: size.height } })

      test('Records: hint, before/after, then the view-only details float', async ({ page }) => {
        const health = collectPageHealth(page)
        await openProductRecords(page, language)

        const records = page.getByRole('dialog').last()
        await expect(records.locator('[data-records-row]').first()).toBeVisible()
        await expect(records.locator('[data-records-hint]')).toBeVisible()
        await expect(records.locator('[data-records-hint]')).toHaveText(language === 'en' ? /Tap a record to view details\./ : /ចុចលើកំណត់ត្រា/)
        await shot(page, `records-list-${language}-${size.name}`)

        // Two lines: the product's own created date first (the audit trail has no create row here), then the edit.
        await expect(records.locator('[data-records-row]')).toHaveCount(2)
        await expect(records.locator('[data-records-row]').first()).toContainText('01/08/2026')
        const update = records.locator('[data-records-row]', { hasText: 'sokha' }).first()
        await update.click()
        await expect(records.locator('table')).toBeVisible()
        await expect(records.locator('table')).toContainText('$21.92')
        await expect(records.locator('table')).not.toContainText('8800000001000')
        await shot(page, `records-before-after-${language}-${size.name}`)

        await records.locator('[data-records-more-details]').click()
        const detail = page.locator('[data-record-detail]')
        await expect(detail).toBeVisible()
        const detailDialog = page.getByRole('dialog').last()
        await expect(detailDialog).toContainText('$19.50')
        await expect(detailDialog).toContainText('$21.92')
        await expect(detailDialog).toContainText('sokha')
        await expect(detailDialog).not.toContainText('8800000001000')
        // The typed reason has no old side: it shows the value alone, with no arrow from "unavailable".
        await expect(detailDialog.locator('[data-record-change]')).toHaveCount(3)
        await expect(detailDialog.locator('[data-record-before]')).toHaveCount(2)
        // View only: nothing editable and no action; the one button is the header close.
        await expect(detailDialog.locator('input, textarea, select, [contenteditable="true"]')).toHaveCount(0)
        await expect(detailDialog.locator('button')).toHaveCount(1)
        await shot(page, `record-details-${language}-${size.name}`)
        await expectNoSidewaysOverflow(page)

        // Closing the details float returns to the Records float, still open.
        await detailDialog.locator('button').click()
        await expect(page.locator('[data-record-detail]')).toHaveCount(0)
        await expect(records.locator('[data-records-row]').first()).toBeVisible()
        expectNoRuntimeErrors(health)
      })
    })
  }
}
