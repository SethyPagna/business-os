import { expect, test, type Page, type Route } from '@playwright/test'
import { ADMIN_ORIGIN, collectPageHealth } from './support/harness'
import { APP_ROOT, E2E_ACCOUNTS, signIn } from './support/session'

// Built UI and request ownership only. Synthetic authenticated GET responses
// do not establish backend authorization, stock figures, or D1 correctness.
// SW is blocked for deterministic interception; native auth/SW has its own suite.
test.use({ serviceWorkers: 'block' })
const REPORT = '/api/suppliers/reports/stock-in-invoices'
const LINES = '/api/suppliers/reports/stock-in-invoice-lines'
const group = (name: string) => ({ supplier_key: 'id:101', supplier_name: name,
  received_day: '2026-09-20', line_count: 1, units_received: 2, cost_usd: 864.42,
  lines_without_cost: 0, credit_lines: 0, branch_ids: '1,2' })
const report = (name: string) => ({ invoices: [group(name)], total_invoices: 1,
  totals: { invoices: 1, lines: 1, units_received: 2, cost_usd: 864.42 },
  meta: { branches: [{ id: 1, name: 'Synthetic One' }, { id: 2, name: 'Synthetic Two' }], suppliers: [{ key: 'id:101', name }] } })
const lines = (name: string) => ({ lines: [{ id: 101, product_name: name, received_quantity: 2,
  unit_cost_usd: 432.21, line_total_usd: 864.42, remaining_quantity: 1,
  received_at: '2026-09-20T02:00:00Z', payment_status: 'paid' }], total_lines: 1 })

async function enter(page: Page) {
  await signIn(page, E2E_ACCOUNTS.cashierA)
  await page.goto(`${ADMIN_ORIGIN}/contacts#hub:contacts:suppliers`)
  await page.getByRole('button', { name: 'Invoices', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stock-In Invoices', exact: true })).toBeVisible()
}
async function open(page: Page, name: string) {
  await page.locator('[aria-haspopup="dialog"]:visible').filter({ hasText: name }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

for (const boundary of ['filter', 'permission'] as const) {
  test(`late stock-in detail cannot cross a ${boundary} change`, async ({ page, context }, testInfo) => {
    const health = collectPageHealth(page)
    let current = false
    const pending: Route[] = []
    let heldReport: Route | undefined
    const writes: string[] = []
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== ADMIN_ORIGIN) return route.abort('blockedbyclient')
      if (req.method() !== 'GET') {
        if (!url.pathname.startsWith('/api/auth/')) writes.push(url.pathname)
        return route.continue()
      }
      if (url.pathname === '/api/suppliers') return route.fulfill({ json: { rows: [], total: 0, page: 1, pageSize: 20 } })
      if (url.pathname === REPORT) {
        if (current) { heldReport = route; return }
        return route.fulfill({ json: report('Original Supplier') })
      }
      if (url.pathname === LINES) {
        if (!current) { pending.push(route); return }
        // Prices deliberately remain in the staff fixture: UI must redact them.
        return route.fulfill({ json: lines('Current Product') })
      }
      return route.continue()
    })
    await enter(page)
    await open(page, 'Original Supplier')
    await expect.poll(() => pending.length).toBe(1)
    current = true
    if (boundary === 'filter') {
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
      await page.getByRole('button', { name: 'Branch', exact: true }).click()
      await page.getByRole('option', { name: 'Synthetic Two', exact: true }).click()
    } else {
      // Exercise the existing same-actor profile/permission event while the
      // component remains mounted. This is not a real server permission edit.
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('user:updated', { detail: {
        id: 11, role_code: 'cashier', role_permissions: {}, permissions: {
          contacts: true, contacts_suppliers: true, product_cost_view: false,
        },
      } })))
    }
    await expect.poll(() => Boolean(heldReport)).toBe(true)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByText('Original Supplier', { exact: true })).toHaveCount(0)
    await heldReport!.fulfill({ json: report('Current Supplier') })
    await open(page, 'Current Supplier')
    await expect(page.getByRole('dialog')).toContainText('Current Product')
    const received = page.waitForResponse(response => new URL(response.url()).pathname === LINES
      && response.request().url() === pending[0].request().url())
    await pending[0].fulfill({ json: lines('STALE PRIVATE PRODUCT') })
    await received
    // Let the completed fetch's continuation and React commit run before assertions.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(page.getByText('STALE PRIVATE PRODUCT', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('dialog')).toContainText('Current Product')
    if (boundary === 'permission') {
      await expect(page.getByRole('dialog')).not.toContainText('432.21')
      await expect(page.getByRole('dialog')).not.toContainText('864.42')
    } else await expect(page.getByRole('dialog')).toContainText('432.21')
    await expect(page.locator(APP_ROOT)).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`stock-in-${boundary}.png`) })
    expect(health.pageErrors).toEqual([])
    expect(health.consoleErrors).toEqual([])
    expect(health.failedApiResponses.filter(item => item !== '401 /api/auth/bootstrap')).toEqual([])
    expect(writes).toEqual([])
  })
}
