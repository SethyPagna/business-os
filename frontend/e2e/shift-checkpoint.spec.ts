import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'
import { ADMIN_ORIGIN, collectPageHealth, seedDeviceSettings } from './support/harness'
import { APP_ROOT, E2E_ACCOUNTS, signIn } from './support/session'
import en from '../src/lang/en.json' with { type: 'json' }
import km from '../src/lang/km.json' with { type: 'json' }

// Built-browser UI/transport contract only. Synthetic count/clamp/permission
// responses do not certify D1 or backend authorization. No mutation reaches
// the fixture server: only the exact cancel route below is fulfilled locally.
test.use({ serviceWorkers: 'block' })
const shift = (id: number, name = `SHIFT-${id}`) => ({ id, shift_code: name,
  scope_mode: 'per_account', user_id: 11, user_name: 'Synthetic long operator name for compact Khmer and English layouts',
  branch_id: 1, branch_name: 'Synthetic branch', business_date: '2026-09-19', opened_at: '2026-09-19T01:00:00Z',
  closed_at: '2026-09-19T10:00:00Z', opening_float_usd: 20, opening_float_khr: 0,
  closing_counted_usd: 25, closing_counted_khr: 0, revision: 1, cancelled_at: null, parent_shift_id: null,
  capabilities: { can_edit: false, can_close: false, can_reopen: false, can_cancel: true }, figures: null, reconciliation: null })

async function fixture(context: BrowserContext) {
  const state = { total: 245, holdDetail: 0, heldDetails: [] as Route[], holdCancel: false,
    heldCancels: [] as Route[], reads: [] as URL[], writes: [] as string[], cancelled: new Set<number>() }
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== ADMIN_ORIGIN) return route.abort('blockedbyclient')
    const cancel = /^\/api\/shifts\/(\d+)\/cancel$/.exec(url.pathname)
    if (request.method() === 'POST' && cancel) {
      state.writes.push(url.pathname)
      if (state.holdCancel) { state.heldCancels.push(route); return }
      const id = Number(cancel[1]); state.cancelled.add(id)
      return route.fulfill({ json: { shift: { ...shift(id, `SAVED-${id}`), cancelled_at: '2026-09-20T00:00:00Z' } } })
    }
    if (request.method() !== 'GET') {
      if (!url.pathname.startsWith('/api/auth/')) throw new Error(`Unexpected mutation ${url.pathname}`)
      return route.continue()
    }
    state.reads.push(url)
    if (url.pathname === '/api/shifts') {
      const size = Number(url.searchParams.get('page_size') || 20)
      const page = Math.min(Math.max(1, Number(url.searchParams.get('page') || 1)), Math.max(1, Math.ceil(state.total / size)))
      const start = (page - 1) * size
      return route.fulfill({ json: { shifts: Array.from({ length: Math.min(size, state.total - start) }, (_, i) => shift(start + i + 1)),
        scope: 'all', page, page_size: size, total: state.total, has_more: start + size < state.total } })
    }
    const detail = /^\/api\/shifts\/(\d+)\/history$/.exec(url.pathname)
    if (detail) {
      const id = Number(detail[1])
      if (state.holdDetail === id) { state.heldDetails.push(route); return }
      const row = state.cancelled.has(id) ? { ...shift(id, `SAVED-${id}`), cancelled_at: '2026-09-20T00:00:00Z' } : shift(id)
      return route.fulfill({ json: { shift: row, amendments: [] } })
    }
    return route.continue()
  })
  return state
}

async function enter(page: Page, context?: BrowserContext, language = 'en') {
  await signIn(page, E2E_ACCOUNTS.cashierA)
  if (context) await seedDeviceSettings(context, ADMIN_ORIGIN, { language })
  await page.evaluate(() => localStorage.setItem('bos:reports:view', JSON.stringify('shift')))
  await page.goto(`${ADMIN_ORIGIN}/sales#hub:sales:reports`)
  await expect(page.locator('.report-shift-plain')).toContainText('SHIFT-1')
}
async function history(page: Page, label = en.shift_history) {
  await page.locator('button[aria-haspopup="dialog"]').filter({ hasText: label }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}
async function branch(page: Page, id: string) {
  await page.evaluate(id => { sessionStorage.setItem('pos_branch', id); window.dispatchEvent(new Event('business-os:pos-branch-changed')) }, id)
}
async function permission(page: Page, alternate: boolean) {
  await page.evaluate(alternate => window.dispatchEvent(new CustomEvent('user:updated', { detail: {
    id: 11, role_code: alternate ? 'cashier' : 'admin', permissions: alternate ? { sales: true, pos: true } : {},
    role_permissions: alternate ? {} : { all: true },
  } })), alternate)
}
const frames = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))

for (const language of ['en', 'km'] as const) {
  test(`Shift list pagination and compact layout ${language}`, async ({ page, context }, info) => {
    const t = language === 'en' ? en : km
    const health = collectPageHealth(page), state = await fixture(context)
    await enter(page, context, language)
    await expect(page.getByText('1-20 / 245', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: t.next, exact: true }).click()
    await expect(page.locator('.report-shift-plain')).toContainText('SHIFT-21')
    await page.getByRole('main').getByRole('button', { name: t.back, exact: true }).click()
    await expect(page.getByText('1-20 / 245', { exact: true })).toBeVisible()
    for (let p = 2; p <= 13; p++) {
      await page.getByRole('button', { name: t.next, exact: true }).click()
      await expect(page.getByText(`${(p - 1) * 20 + 1}-${Math.min(p * 20, 245)} / 245`, { exact: true })).toBeVisible()
    }
    await expect(page.getByText('241-245 / 245', { exact: true })).toBeVisible()
    await expect(page.locator('.report-shift-plain')).toContainText('SHIFT-241')
    // S1 (87563d491): the shift picker is a "Search cashier or ID" combobox,
    // not a listbox button. Opening it lists the current page's shifts.
    await page.getByRole('combobox', { name: t.shift_search_placeholder }).click()
    await expect(page.getByRole('option')).toHaveCount(5)
    await page.getByRole('option').filter({ hasText: 'SHIFT-245' }).click()
    await expect(page.locator('.report-shift-plain')).toContainText('SHIFT-245')
    state.total = 21
    // Separate push-invalidation scenario, not a Refresh-button assertion.
    // The dedicated test below requires Refresh itself to bypass fresh cache.
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'shifts' } }))
      window.dispatchEvent(new Event('business-os:shift-state-changed'))
    })
    await expect(page.getByText('21-21 / 21', { exact: true })).toBeVisible()
    state.total = 245
    await history(page, t.shift_history)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('1-20 / 245', { exact: true })).toBeVisible()
    if (info.project.name === 'ios-webkit') {
      // The real iOS install notice overlaps the lower pager in this viewport.
      // Dismiss its visible control, not a forced click through an overlay.
      const installNotice = page.getByRole('status').filter({ hasText: t.ios_install_hint })
      await expect(installNotice).toBeVisible()
      await installNotice.getByRole('button', { name: t.dismiss_notification, exact: true }).click()
      await expect(installNotice).toBeHidden()
    }
    await dialog.getByRole('button', { name: t.next, exact: true }).click()
    await expect(dialog.getByText('21-40 / 245', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: t.back, exact: true }).click()
    await expect(dialog.getByText('1-20 / 245', { exact: true })).toBeVisible()
    for (let p = 2; p <= 13; p++) {
      await dialog.getByRole('button', { name: t.next, exact: true }).click()
      await expect(dialog.getByText(`${(p - 1) * 20 + 1}-${Math.min(p * 20, 245)} / 245`, { exact: true })).toBeVisible()
    }
    await expect(dialog.getByText('241-245 / 245', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: t.next, exact: true })).toBeDisabled()
    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: 900 })
      const rect = await dialog.boundingBox()
      expect(rect!.x).toBeGreaterThanOrEqual(0)
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width + 1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      for (const name of [t.back, t.next]) {
        const box = await dialog.getByRole('button', { name, exact: true }).boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
      }
      await page.screenshot({ path: info.outputPath(`shift-${language}-${width}.png`) })
    }
    state.total = 1
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('sync:update', { detail: { channel: 'shifts' } })))
    await dialog.getByRole('button', { name: t.refresh, exact: true }).click()
    await expect(dialog.getByText('1-1 / 1', { exact: true })).toBeVisible()
    expect(state.reads.some(url => url.pathname === '/api/shifts' && url.searchParams.get('page') === '13' && url.searchParams.get('page_size') === '20')).toBe(true)
    expect(health.pageErrors).toEqual([]); expect(health.consoleErrors).toEqual([])
    expect(state.writes).toEqual([])
  })
}

test('History rejects late detail after branch A-B-A', async ({ page, context }) => {
  const health = collectPageHealth(page), state = await fixture(context)
  await enter(page); await branch(page, '1'); await history(page)
  const dialog = page.getByRole('dialog')
  state.holdDetail = 2
  await dialog.getByRole('button').filter({ has: page.getByText('SHIFT-2', { exact: true }) }).click()
  await expect.poll(() => state.heldDetails.length).toBe(1)
  await branch(page, '2')
  await expect(dialog.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible()
  await branch(page, '1')
  await dialog.getByRole('button').filter({ has: page.getByText('SHIFT-3', { exact: true }) }).click()
  await expect(dialog).toContainText('SHIFT-3')
  await state.heldDetails[0].fulfill({ json: { shift: shift(2, 'STALE-DETAIL'), amendments: [] } })
  await frames(page)
  await expect(dialog).not.toContainText('STALE-DETAIL')
  await expect(dialog).toContainText('SHIFT-3')
  expect(health.pageErrors).toEqual([]); expect(health.consoleErrors).toEqual([])
})

test('History Refresh observes changed server count without a synthetic push', async ({ page, context }) => {
  const state = await fixture(context)
  await enter(page); await history(page)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('1-20 / 245', { exact: true })).toBeVisible()
  const before = state.reads.filter(url => url.pathname === '/api/shifts' && !url.searchParams.has('from')).length
  state.total = 1
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect.poll(() => state.reads.filter(url => url.pathname === '/api/shifts' && !url.searchParams.has('from')).length,
    { timeout: 3000, message: 'Explicit Refresh must issue a new list read, not return the fresh cached list' }).toBeGreaterThan(before)
  await expect(dialog.getByText('1-1 / 1', { exact: true })).toBeVisible()
})

test('History fences late mutation after permission A-B-A and accepts current success', async ({ page, context }) => {
  const health = collectPageHealth(page), state = await fixture(context)
  await enter(page); await history(page)
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button').filter({ has: page.getByText('SHIFT-2', { exact: true }) }).click()
  await dialog.getByRole('button', { name: 'Cancel shift', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Cancellation reason (required)', exact: true }).fill('Synthetic local test only')
  state.holdCancel = true
  await dialog.getByRole('button', { name: 'Cancel shift', exact: true }).last().click()
  await expect.poll(() => state.heldCancels.length).toBe(1)
  await permission(page, true)
  await expect(dialog.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible()
  await permission(page, false)
  await dialog.getByRole('button').filter({ has: page.getByText('SHIFT-3', { exact: true }) }).click()
  await expect(dialog.getByRole('button', { name: 'Cancel shift', exact: true })).toBeEnabled()
  await state.heldCancels[0].fulfill({ json: { shift: { ...shift(2, 'STALE-MUTATION'), cancelled_at: '2026-09-20T00:00:00Z' } } })
  await frames(page)
  await expect(dialog).not.toContainText('STALE-MUTATION')
  await expect(dialog).toContainText('SHIFT-3')
  state.holdCancel = false
  await dialog.getByRole('button', { name: 'Cancel shift', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Cancellation reason (required)', exact: true }).fill('Current synthetic success')
  await dialog.getByRole('button', { name: 'Cancel shift', exact: true }).last().click()
  await expect(dialog).toContainText('SAVED-3')
  await expect(page.locator(APP_ROOT)).toBeVisible()
  expect(health.pageErrors).toEqual([]); expect(health.consoleErrors).toEqual([])
  expect(state.writes).toEqual(['/api/shifts/2/cancel', '/api/shifts/3/cancel'])
})
