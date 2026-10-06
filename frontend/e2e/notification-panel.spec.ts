import { expect, test, type Page } from '@playwright/test'
import { collectPageHealth, DEVICE_SETTINGS_KEY, expectNoRuntimeErrors } from './support/harness'
import { E2E_ACCOUNTS, signIn } from './support/session'

/**
 * notification-panel.spec.ts -- NOTIF-V2: the bell shows sale-driven stock events as compact one-line
 * rows with a kind icon, folds repeats, and every row goes where it lives.
 *
 * WHAT THIS PROVES, against the built app and the fixture server (the summary payload is the Worker's
 * contract, handed over verbatim by page.route):
 *  - rows are one compact line each (a title line and a meta line, not a paragraph) with a per-kind icon;
 *  - the time on a row is dd/mm/yyyy HH:mm, and the meta reads from the language packs (EN and KM);
 *  - five low-stock events fold into ONE collapsible group row that opens to its five rows;
 *  - clicking an out-of-stock row closes the panel and lands on the Dashboard's Out of stock card.
 *
 * ERROR CLASS GUARDED: the bell as a wall of English paragraphs whose links did nothing (retired page ids).
 *
 * RUN ONLY THIS FILE:  cd frontend && npx playwright test notification-panel
 */
test.use({ serviceWorkers: 'block' })

const NOW = '2026-10-06 07:32:00'
const lowRow = (index: number) => ({
  id: `stock-${100 + index}`, tone: 'warning', label: `Low product ${index}`, meta: 'Low stock (8)',
  metaKey: 'notification_stock_low', metaParams: { quantity: 8, receipt: `R-10${index}`, branch: 'Main' },
  at: NOW, kind: 'inventory_low_stock', pageId: 'dashboard', anchor: 'low-stock', saleId: 100 + index,
})

const SUMMARY = {
  unreadCount: 8,
  unread: 8,
  generatedAt: '2026-10-06T07:40:00.000Z',
  preferences: { realertMinutes: 10 },
  sections: [
    {
      id: 'inventory', label: 'Inventory', pageId: 'dashboard', count: 6, summary: '1 out of stock - 5 low stock',
      summaryKey: 'notification_inventory_summary', summaryParams: { outCount: 1, lowCount: 5 }, enabledKey: 'notifications_inventory_enabled',
      items: [
        {
          id: 'stock-99', tone: 'danger', label: 'Out product', meta: 'Out of stock', metaKey: 'notification_stock_out',
          metaParams: { quantity: 0, receipt: 'R-099', branch: 'Main' }, at: NOW, kind: 'inventory_out_of_stock',
          pageId: 'dashboard', anchor: 'out-of-stock', saleId: 99,
        },
        ...[1, 2, 3, 4, 5].map(lowRow),
      ],
    },
    {
      id: 'expiry', label: 'Product expiry', pageId: 'products', count: 1, summary: '1 expired', enabledKey: 'notifications_expiry_enabled',
      items: [{
        id: 'expiry-7', tone: 'danger', label: 'Old Cream', meta: 'Expired 3d ago', metaKey: 'notification_product_expired',
        metaParams: { days: 3, expiryDate: '2026-10-03' }, kind: 'product_expired', pageId: 'products', search: 'Old Cream',
      }],
    },
  ],
}

async function openBell(page: Page): Promise<void> {
  await page.route('**/api/notifications/summary', (route) => route.fulfill({ json: SUMMARY }))
  await signIn(page, E2E_ACCOUNTS.cashierA)
  await page.getByRole('button', { name: /^Notifications$|^ការជូនដំណឹង$/ }).first().click()
  await expect(page.locator('[data-notification-row]').first()).toBeVisible()
}

test('stock events are compact one-line rows, repeats fold, and a click lands on the Dashboard card', async ({ page }) => {
  const health = collectPageHealth(page)
  await openBell(page)

  // The out-of-stock row: kind icon, title, one meta line carrying the receipt, branch and the time.
  const outRow = page.locator('[data-notification-row="inventory_out_of_stock"]')
  await expect(outRow).toHaveCount(1)
  await expect(outRow.locator('[data-notification-kind="inventory_out_of_stock"]')).toBeVisible()
  await expect(outRow).toContainText('Out product')
  await expect(outRow).toContainText('R-099')
  await expect(outRow).toContainText('06/10/2026 14:32') // 07:32 UTC is 14:32 in Cambodia (UTC+7)
  const box = await outRow.boundingBox()
  expect(box, 'the row is rendered').not.toBeNull()
  expect(box!.height, 'a notification row is two short lines, not a paragraph').toBeLessThan(48)

  // Five lows fold into one group; opening it shows the five rows.
  const group = page.locator('[data-notification-group="inventory_low_stock"]')
  await expect(group).toContainText('5')
  await expect(page.locator('[data-notification-row="inventory_low_stock"]')).toHaveCount(0)
  await group.click()
  await expect(page.locator('[data-notification-row="inventory_low_stock"]')).toHaveCount(5)

  // Click the out-of-stock row: panel closes, the Dashboard's Out of stock card is in view and marked.
  await outRow.click()
  await expect(page.locator('[data-notification-row]')).toHaveCount(0)
  await expect(page).toHaveURL(/#out-of-stock$/)
  await expect(page.locator('#dashboard-out-of-stock')).toHaveClass(/ring-red-400/, { timeout: 10_000 })

  expectNoRuntimeErrors(health)
})

test('the same rows read from the Khmer pack', async ({ page }) => {
  await openBell(page)
  // The sign-in form is English; the language the in-app toggle persists is written to the device
  // settings, and a reload restores it -- the same path a returning Khmer user takes. (The header
  // toggle is not on screen at phone width, so the stored preference is the portable way in.)
  await page.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({ language: 'km' })), DEVICE_SETTINGS_KEY)
  await page.reload()
  await page.getByRole('button', { name: /^Notifications$|^ការជូនដំណឹង$/ }).first().click()
  await expect(page.locator('[data-notification-row]').first()).toBeVisible()
  const outRow = page.locator('[data-notification-row="inventory_out_of_stock"]')
  await expect(outRow).toContainText('អស់ស្តុក')
  await expect(outRow).toContainText('06/10/2026 14:32')
  // Khmer needs vertical room: the meta line may not be cut to a Latin line box.
  const lineHeight = await outRow.locator('.detail-scroll-text').nth(1).evaluate((node) => parseFloat(getComputedStyle(node).lineHeight) / parseFloat(getComputedStyle(node).fontSize))
  expect(lineHeight).toBeGreaterThanOrEqual(1.5)
})
