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
  // One read carries both halves: since 6.0.879 (20 Oct 2026, "one dashboard read") the Dashboard loads its summary
  // and analytics from GET /api/dashboard/startup, where it used to send /api/dashboard and /api/analytics. The
  // continuous overnight pair (22:00 to 02:00 Phnom Penh as UTC bounds, end minute inclusive) must ride on it.
  await expect.poll(() => reads.some(url => url.pathname === '/api/dashboard/startup'
    && url.searchParams.get('startDate') === '2026-09-19'
    && url.searchParams.get('endDate') === '2026-09-20'
    && url.searchParams.get('createdFrom') === '2026-09-19 15:00:00'
    && url.searchParams.get('createdTo') === '2026-09-19 19:01:00')).toBe(true)
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
    // Inverted 3 Nov 2026. This used to assert NO "Start time" field, because the Shift Report was a date-only view.
    // Since 6e81cfa2e (1 Oct 2026, "select complete shifts by latest opening time") it selects shifts by their opening
    // time, reportModel's 'shift' view has supportsTime: true, and the picker shows both clocks.
    await expect(panel.getByLabel('Start time', { exact: true })).toHaveCount(1)
    await expect(panel.getByLabel('End time', { exact: true })).toHaveCount(1)
    for (const label of ['End Date', 'Start Date']) {
      await panel.getByLabel(label, { exact: true }).fill('19/09/2026')
      await panel.getByLabel(label, { exact: true }).press('Enter')
    }
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    // Dates alone select complete shift records by business date: no opening-time bounds are sent. The list now names
    // those bounds openedFrom/openedTo (it never sent createdFrom), so the absence is asserted on the real names.
    await expect.poll(() => reads.some(url => url.pathname === '/api/shifts'
      && url.searchParams.get('from') === '2026-09-19' && url.searchParams.get('to') === '2026-09-19'
      && !url.searchParams.has('openedFrom') && !url.searchParams.has('openedTo') && !url.searchParams.has('createdFrom'))).toBe(true)
    await expect(page.locator('.report-shift-plain')).toContainText('SYNTHETIC-901')
    // The new rule, positively: a typed Start time becomes an opening-time window (22:00 to the end of the day in
    // Phnom Penh is 15:00 to 17:00 UTC) on the shift list.
    await page.getByRole('button', { name: 'Date & time range', exact: true }).click()
    await panel.getByLabel('Start time', { exact: true }).fill('22:00')
    await panel.getByLabel('Start time', { exact: true }).press('Enter')
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(() => reads.some(url => url.pathname === '/api/shifts'
      && url.searchParams.get('from') === '2026-09-19' && url.searchParams.get('to') === '2026-09-19'
      && url.searchParams.get('openedFrom') === '2026-09-19 15:00:00'
      && url.searchParams.get('openedTo') === '2026-09-19 17:00:00')).toBe(true)
    expect(health.pageErrors).toEqual([])
    expect(health.consoleErrors).toEqual([])
  })
}
