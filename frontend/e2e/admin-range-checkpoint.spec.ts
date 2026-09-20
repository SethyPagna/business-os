import { expect, test, type Page } from '@playwright/test'
import { ADMIN_ORIGIN, collectPageHealth } from './support/harness'
import { APP_ROOT, E2E_ACCOUNTS, signIn } from './support/session'

// Synthetic GET contracts test built UI/query dispatch, not backend filtering or
// authorization. Auth safety is separately tested with the native SW enabled.
test.use({ serviceWorkers: 'block' })

async function selectView(page: Page, name: string) {
  await page.getByRole('button', { name: /^View:/ }).click()
  await page.getByRole('option', { name, exact: true }).click()
}

async function overnight(page: Page) {
  await page.getByRole('button', { name: 'Date & time range', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Date & time range', exact: true })
  for (const [label, value] of [['End Date', '20/09/2026'], ['Start Date', '19/09/2026'], ['Start time', '22:00'], ['End time', '02:00']]) {
    await panel.getByLabel(label, { exact: true }).fill(value)
    await panel.getByLabel(label, { exact: true }).press('Enter')
  }
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
}

test('Dashboard sends continuous overnight endpoints through the real range UI', async ({ page, context }) => {
  const health = collectPageHealth(page)
  const reads: URL[] = []
  await context.route('**/*', route => new URL(route.request().url()).origin === ADMIN_ORIGIN ? route.continue() : route.abort('blockedbyclient'))
  page.on('request', request => { if (request.method() === 'GET') reads.push(new URL(request.url())) })
  await signIn(page, E2E_ACCOUNTS.cashierA)
  await page.goto(ADMIN_ORIGIN)
  await expect(page.locator(APP_ROOT)).toBeVisible()
  await overnight(page)
  for (const path of ['/api/dashboard', '/api/analytics']) {
    await expect.poll(() => reads.some(url => url.pathname === path
      && url.searchParams.get('createdFrom') === '2026-09-19 15:00:00'
      && url.searchParams.get('createdTo') === '2026-09-19 19:01:00')).toBe(true)
  }
  expect(health.pageErrors).toEqual([])
  expect(health.consoleErrors).toEqual([])
})

for (const staff of [false, true]) {
  test(`Reports all-time restoration and selected dated shift (${staff ? 'staff' : 'admin'} synthetic response)`, async ({ page, context }) => {
    const health = collectPageHealth(page)
    const reads: URL[] = []
    let narrowIdentity = false
    // Shape follows ShiftFigures in shiftTransport.ts, including counted money.
    const figures = { opening: { usd: 20, khr: 0 }, closing: { usd: 25, khr: 0 },
      sales_usd: 9876.54, cogs_usd: 1, profit_usd: 9875.54, delivery_fee_usd: 0,
      delivery_cost: { usd: 0, khr: 0 }, other_expenses: { usd: 0, khr: 0 }, refunds_usd: 0, credit_usd: 0 }
    const shift = { id: 901, shift_code: 'SYNTHETIC-901', scope_mode: 'per_account', user_id: 11, user_name: 'Synthetic Operator',
      branch_id: 1, branch_name: 'Synthetic Branch', business_date: '2026-09-19', opened_at: '2026-09-19T01:00:00Z',
      closed_at: '2026-09-19T10:00:00Z', opening_float_usd: 20, opening_float_khr: 0, closing_counted_usd: 25,
      closing_counted_khr: 0, revision: 1, capabilities: {}, cancelled_at: null, parent_shift_id: null }
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url())
      if (url.origin !== ADMIN_ORIGIN) return route.abort('blockedbyclient')
      if (req.method() !== 'GET') return route.continue()
      reads.push(url)
      if (staff && narrowIdentity && url.pathname === '/api/auth/bootstrap') {
        const response = await route.fetch(), body = await response.json()
        body.user = { ...body.user, role_code: 'cashier', permissions: { sales: true, pos: true, dashboard: true }, role_permissions: {} }
        return route.fulfill({ response, json: body })
      }
      if (url.pathname === '/api/reports/business-summary/sales') return route.fulfill({ json: { rows: [], has_more: false, next_cursor: null } })
      if (url.pathname === '/api/shifts') return route.fulfill({ json: { shifts: [shift], scope: staff ? 'own' : 'all' } })
      if (url.pathname === '/api/shifts/901/history') return route.fulfill({ json: { shift: { ...shift, figures: staff ? null : figures, reconciliation: null }, amendments: [] } })
      return route.continue()
    })
    // Existing cashier fixture inherits the admin role; staff is narrowed on
    // authenticated bootstrap below, without faking the real login exchange.
    await signIn(page, E2E_ACCOUNTS.cashierA)
    await page.evaluate(() => localStorage.setItem('bos:reports:view', JSON.stringify('sales')))
    narrowIdentity = true
    await page.goto(`${ADMIN_ORIGIN}/sales#hub:sales:reports`)
    await expect(page.getByRole('button', { name: /^View:/ })).toBeVisible()
    await page.getByRole('button', { name: 'All time', exact: true }).click()
    await selectView(page, 'Shift Report')
    await expect(page.locator('.report-shift-plain')).toContainText('SYNTHETIC-901')
    await expect.poll(() => reads.some(url => url.pathname === '/api/shifts' && !url.searchParams.has('from') && !url.searchParams.has('to'))).toBe(true)
    if (staff) await expect(page.locator('.report-shift-plain')).not.toContainText('9,876.54')
    else await expect(page.locator('.report-shift-plain')).toContainText('9,876.54')
    await selectView(page, 'Each receipt')
    await expect(page.getByRole('button', { name: 'View: Each receipt', exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect.poll(() => reads.some(url => url.pathname === '/api/reports/business-summary/sales'
      && !url.searchParams.has('startDate') && !url.searchParams.has('endDate') && !url.searchParams.has('createdFrom'))).toBe(true)
    await selectView(page, 'Shift Report')
    await page.getByRole('button', { name: 'Date & time range', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Date & time range', exact: true })
    await expect(panel.getByLabel('Start time', { exact: true })).toHaveCount(0)
    for (const label of ['End Date', 'Start Date']) {
      await panel.getByLabel(label, { exact: true }).fill('19/09/2026')
      await panel.getByLabel(label, { exact: true }).press('Enter')
    }
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(() => reads.some(url => url.pathname === '/api/shifts'
      && url.searchParams.get('from') === '2026-09-19' && url.searchParams.get('to') === '2026-09-19'
      && !url.searchParams.has('createdFrom'))).toBe(true)
    await expect(page.locator('.report-shift-plain')).toContainText('SYNTHETIC-901')
    expect(health.pageErrors).toEqual([])
    expect(health.consoleErrors).toEqual([])
  })
}
