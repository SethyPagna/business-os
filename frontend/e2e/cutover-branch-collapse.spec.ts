import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import path from 'node:path'
import { ADMIN_ORIGIN } from './support/harness'
import { APP_ROOT, E2E_ACCOUNTS, signIn } from './support/session'

// Branch cutover, readiness gap G-M: the branch UI collapses to one branch from
// DATA. The fixture server answers /api/branches; each scenario below replaces
// that one answer (and the dashboard's per-branch analytics) and nothing else,
// so the same built app is seen in three states:
//
//   today        Shop + Warehouse, both active      -> every branch control present
//   after        LC Store active + Old Shop retired -> pickers and comparisons gone,
//                                                      history filters still offer Old Shop (Inactive)
//   single       one branch row only                -> no branch filter at all
//
// Set LM_SHOTS to a directory to keep a screenshot of every state at 360 and
// 1280 px; the assertions run either way.
test.use({ serviceWorkers: 'block' })
// The viewport is chosen per state below, so one browser is enough.
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop-chromium', 'viewport is set per state below') })

const SHOTS = process.env.LM_SHOTS || ''
const VIEWPORTS = [{ width: 1280, height: 800 }, { width: 360, height: 800 }] as const

type BranchRow = { id: number; name: string; role: string; is_active: number; is_default: number }
const TODAY: BranchRow[] = [
  { id: 1, name: 'Shop', role: 'shop', is_active: 1, is_default: 1 },
  { id: 2, name: 'Warehouse', role: 'warehouse', is_active: 1, is_default: 0 },
]
const AFTER: BranchRow[] = [
  { id: 2, name: 'LC Store', role: 'shop', is_active: 1, is_default: 1 },
  { id: 1, name: 'Old Shop', role: 'shop', is_active: 0, is_default: 0 },
]
const SINGLE: BranchRow[] = [AFTER[0]]
const REVENUE = (rows: Array<[number, string]>) => rows.map(([id, name], index) => ({ branch_id: id, branch_name: name, revenue_usd: 120 - index * 40, count: 6 - index * 2 }))

async function arrange(context: BrowserContext, branches: BranchRow[], byBranch: Array<[number, string]>) {
  await context.route('**/api/branches', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(branches.map((row) => ({ ...row, edit_etag: `e${row.id}` }))) })
  })
  // Keep the fixture's own (validated) analytics and replace only the per-branch rows.
  await context.route(/\/api\/(?:dashboard\/startup|analytics)(?:\?.*)?$/, async (route) => {
    const response = await route.fetch()
    const json = await response.json() as { analytics?: Record<string, unknown>; byBranch?: unknown }
    if (json.analytics) json.analytics.byBranch = REVENUE(byBranch)
    else json.byBranch = REVENUE(byBranch)
    return route.fulfill({ response, json })
  })
  await context.route('**/api/branches/summary', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ branch_count: branches.filter((row) => row.is_active).length, total_products: 3, in_stock: 3, low_stock: 0, out_of_stock: 0, stock_value_usd: 10 }) }))
}

// The dashboard cards sit below the first screen, so its shots are full-page.
async function shot(page: Page, name: string, width: number) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}-${width}.png`), fullPage: name.startsWith('dashboard') })
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport })

    test('Dashboard: the branch performance card follows the branch rows and the data', async ({ page, context }) => {
      await arrange(context, TODAY, [[1, 'Shop']])
      await signIn(page, E2E_ACCOUNTS.cashierA)
      await page.setViewportSize(viewport)
      await page.goto(`${ADMIN_ORIGIN}/`)
      await expect(page.locator(APP_ROOT)).toBeVisible()
      // today, one branch with sales in range: still shown, exactly as before
      await showBranchSection(page, viewport.width)
      await expect(page.getByRole('heading', { name: 'Branch Performance' })).toBeVisible()
      await shot(page, 'dashboard-today', viewport.width)
    })

    test('Dashboard after the cutover: one branch with sales hides the card, a range spanning the cutover keeps it', async ({ page, context }) => {
      await arrange(context, AFTER, [[2, 'LC Store']])
      await signIn(page, E2E_ACCOUNTS.cashierA)
      await page.setViewportSize(viewport)
      await page.goto(`${ADMIN_ORIGIN}/`)
      await expect(page.locator(APP_ROOT)).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Sales', exact: true }).first()).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Branch Performance' })).toHaveCount(0)
      await shot(page, 'dashboard-after-one-branch-with-sales', viewport.width)

      await context.unrouteAll()
      await arrange(context, AFTER, [[2, 'LC Store'], [1, 'Old Shop']])
      await page.reload()
      await showBranchSection(page, viewport.width)
      await expect(page.getByRole('heading', { name: 'Branch Performance' })).toBeVisible()
      await expect(page.getByText('Old Shop').first()).toBeVisible()
      await shot(page, 'dashboard-after-range-spans-cutover', viewport.width)
    })

    test('Reports: branch filter and Branches view across the three states', async ({ page, context }) => {
      await arrange(context, TODAY, [])
      await signIn(page, E2E_ACCOUNTS.cashierA)
      await page.setViewportSize(viewport)
      await page.goto(`${ADMIN_ORIGIN}/sales#hub:sales:reports`)
      await expect(page.locator(APP_ROOT)).toBeVisible()
      await openReportFilters(page)
      const branchSelect = page.getByRole('button', { name: 'Branch', exact: true })
      await expect(branchSelect).toBeVisible()
      await branchSelect.click()
      await expect(page.getByRole('option', { name: 'Shop', exact: true })).toBeVisible()
      await expect(page.getByRole('option', { name: 'Warehouse', exact: true })).toBeVisible()
      await expect(page.getByRole('option', { name: /Inactive/ })).toHaveCount(0)
      await shot(page, 'reports-filter-today', viewport.width)
      await page.keyboard.press('Escape')
      await openViewPicker(page)
      await expect(page.getByRole('option', { name: 'Branches', exact: true })).toBeVisible()

      // after the cutover: the retired branch is still a history filter, labelled
      await context.unrouteAll()
      await arrange(context, AFTER, [])
      await page.goto(`${ADMIN_ORIGIN}/sales#hub:sales:reports`)
      await page.reload()
      await openReportFilters(page)
      await page.getByRole('button', { name: 'Branch', exact: true }).click()
      await expect(page.getByRole('option', { name: 'LC Store', exact: true })).toBeVisible()
      await expect(page.getByRole('option', { name: 'Old Shop (Inactive)', exact: true })).toBeVisible()
      await shot(page, 'reports-filter-after', viewport.width)
      await page.keyboard.press('Escape')
      await openViewPicker(page)
      await expect(page.getByRole('option', { name: 'Branches', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')

      // a business with one branch row in total: no branch filter, no Branches view
      await context.unrouteAll()
      await arrange(context, SINGLE, [])
      await page.reload()
      await openReportFilters(page)
      await expect(page.getByRole('button', { name: 'Branch', exact: true })).toHaveCount(0)
      await shot(page, 'reports-filter-single', viewport.width)
      await page.keyboard.press('Escape')
      await openViewPicker(page)
      await expect(page.getByRole('option', { name: 'Branches', exact: true })).toHaveCount(0)
      await expect(page.getByRole('option', { name: 'Products', exact: true })).toBeVisible()
    })

    test('Khmer: the retired branch is labelled in the Khmer pack word', async ({ page, context }) => {
      await arrange(context, AFTER, [])
      await signIn(page, E2E_ACCOUNTS.cashierA)
      await page.setViewportSize(viewport)
      await page.goto(`${ADMIN_ORIGIN}/sales#hub:sales:reports`)
      await expect(page.locator(APP_ROOT)).toBeVisible()
      await page.getByRole('button', { name: 'Switch to Khmer' }).first().click()
      await expect(page.locator('html')).toHaveAttribute('lang', 'km')
      // lang/km.json `inactive` and `branch`
      await page.getByRole('button', { name: /^តម្រង/ }).first().click()
      // the select, not the sidebar item that carries the same Khmer word
      await page.locator('button[data-app-select-button][aria-label="សាខា"]').click()
      await expect(page.getByRole('option', { name: 'Old Shop (អសកម្ម)', exact: true })).toBeVisible()
      await shot(page, 'reports-filter-after-km', viewport.width)
    })

    test('Branches hub (Sidebar destination): transfer entry points explain themselves, history keeps Old Shop', async ({ page, context }) => {
      await arrange(context, TODAY, [])
      await signIn(page, E2E_ACCOUNTS.cashierA)
      await page.setViewportSize(viewport)
      await page.goto(`${ADMIN_ORIGIN}/branches`)
      await expect(page.locator(APP_ROOT)).toBeVisible()
      // aria-label picks the header button; the hub section pill is also named Transfer.
      const transfer = page.locator('button[aria-label="Transfer"]')
      await expect(transfer).toBeEnabled()
      await shot(page, 'branches-today', viewport.width)

      await context.unrouteAll()
      await arrange(context, AFTER, [])
      await page.reload()
      await expect(page.getByText('Old Shop').first()).toBeVisible()
      await expect(page.locator('button[aria-label="Transfer"]')).toBeDisabled()
      await expect(page.getByTitle('Only one active branch, so there is nothing to transfer.').first()).toBeVisible()
      await shot(page, 'branches-after', viewport.width)
    })
  })
}

// Below lg the dashboard shows one card group at a time; the branch card is in the third.
async function showBranchSection(page: Page, width: number) {
  if (width < 1024) await page.getByRole('tab').nth(2).click()
}

// The Filters control lives in the report header; its panel holds the branch select.
async function openReportFilters(page: Page) {
  const filters = page.getByRole('button', { name: /^Filters/ }).first()
  await expect(filters).toBeVisible({ timeout: 30_000 })
  await filters.click()
}

async function openViewPicker(page: Page) {
  await page.getByRole('button', { name: /^View:/ }).first().click()
}
