import { expect, test, type Page } from '@playwright/test'
import km from '../../src/lang/km.json' with { type: 'json' }

const origin = process.env.E2E_SYSTEM_ORIGIN || 'http://127.0.0.1:4349'
test.describe.configure({ mode: 'serial', timeout: 120_000 })
test.beforeAll(async ({ request }) => {
  expect(new URL(origin).hostname).toBe('127.0.0.1')
  if (process.env.E2E_EXPECTED_BUILD_SHA) {
    const ready = await (await request.get(origin + '/__fixture/ready')).json()
    expect(ready.sourceHead).toBe(process.env.E2E_EXPECTED_BUILD_SHA)
    expect(ready.frontendBuild.revision).toBe(ready.sourceHead.slice(0, 12))
  }
})

async function signIn(page: Page, actor: number, username: string, language = 'en') {
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  await page.addInitScript(({ actor, language }) => { localStorage.setItem('businessos_device_id', `employee-save-device-${actor}`); localStorage.setItem('businessos_language', language) }, { actor, language })
  await page.goto(origin)
  await expect(page.locator('#login-username')).toBeVisible()
  await expect(page.locator('#login-username')).toBeFocused()
  await page.locator('#login-username').fill(username)
  await page.locator('#login-password').fill('e2e-password')
  await expect(page.locator('#login-username')).toHaveValue(username)
  await expect(page.locator('#login-password')).toHaveValue('e2e-password')
  const login = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST')
  await page.getByRole('button', { name: language === 'km' ? km.login : 'Login', exact: true }).click()
  expect((await login).status()).toBe(200)
  await expect(page.locator('#app-root')).toBeVisible({ timeout: 60_000 })
  const me = await page.evaluate(async () => {
    const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${localStorage.getItem('businessos_sync_token') || ''}` } })
    return { status: response.status, body: await response.json() }
  })
  expect(me.status).toBe(200)
  const body = me.body
  expect(Number((body.user || body).id)).toBe(actor)
  expect((body.user || body).role_code).toBe('employee')
}
async function openFreshSale(page: Page) {
  const created = await page.request.post(origin + '/__fixture/create-sale')
  expect(created.status()).toBe(200)
  const body = await created.json()
  const sale = body.sale
  expect(sale.id).toBeGreaterThan(0)
  await page.goto(origin + '/sales')
  await expect(page.getByText(String(sale.receipt_number), { exact: true }).first()).toBeVisible({ timeout: 60_000 })
  await page.getByText(String(sale.receipt_number), { exact: true }).first().click()
  await expect(page.locator('[data-sale-line-name]').getByText('E2E Original Powder', { exact: true })).toBeVisible()
  return sale
}

async function api(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, headers: { Authorization: `Bearer ${localStorage.getItem('businessos_sync_token') || ''}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json() }
  }, { path, method, body })
}
async function state(page: Page, saleId: number) {
  const response = await page.request.get(`${origin}/__fixture/state?sale=${saleId}`)
  expect(response.status()).toBe(200)
  return response.json()
}
const stock = (snapshot: any, product: number) => Number(snapshot.stock.find((r: any) => r.product_id === product && r.branch_id === 1).quantity)
const lot = (snapshot: any, batch: number) => Number(snapshot.lots.find((r: any) => r.batch_id === batch && r.branch_id === 1).quantity)
function redacted(value: any) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (/^(cost_price_|purchase_price_|total_cost_)/.test(key)) expect(child, `employee response ${key} must remain redacted`).toBeNull()
    else redacted(child)
  }
}
async function persistedReload(page: Page, sale: any, name: string) {
  await page.reload()
  await expect(page.getByText(String(sale.receipt_number), { exact: true }).first()).toBeVisible()
  await page.getByText(String(sale.receipt_number), { exact: true }).first().click()
  await expect(page.locator('[data-sale-line-name]').getByText(name, { exact: true })).toBeVisible()
}
async function submit(page: Page, path: string, trigger: () => Promise<unknown>) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === 'POST')
  await trigger()
  const actual = await response
  const body = await actual.json()
  expect(actual.status(), JSON.stringify(body)).toBe(200)
  redacted(body)
  return { body, request: actual.request().postDataJSON() }
}
async function stageAddedSerum(page: Page) {
  await page.getByPlaceholder('Search by name or barcode').fill('E2E Added')
  await page.getByText('E2E Added Serum', { exact: true }).first().click()
  await page.getByRole('button', { name: 'Choose a received date', exact: true }).click()
  await page.getByRole('button').filter({ has: page.locator('span.font-mono') }).last().click()
  await page.getByRole('button', { name: /^Add$/ }).click()
}

test('amend-only employee replacement search discriminator', async ({ page }, info) => {
  await signIn(page, 912, 'e2e_employee_amend')
  await openFreshSale(page)
  const line = page.locator('tr').filter({ has: page.locator('[data-sale-line-name]').getByText('E2E Original Powder', { exact: true }) })
  await line.getByRole('button', { name: /^Edit$/ }).click()
  await page.getByRole('button', { name: /^Replace$/ }).click()
  await page.getByPlaceholder('Search by name or barcode').fill('E2E Replacement')
  await expect(page.getByText('E2E Replacement Balm', { exact: true }).first(), 'Actual Worker catalogue search must run for the independently granted Amend action').toBeVisible({ timeout: 12_000 })
  await page.screenshot({ path: info.outputPath('employee-amend-replacement-search.png'), fullPage: true })
})

test('add-only employee Save reload and exact retry preserve stock audit and grants', async ({ page }, info) => {
  await signIn(page, 911, 'e2e_employee_add')
  const sale = await openFreshSale(page), before = await state(page, sale.id)
  await expect(page.locator('[data-sale-line-edit] button')).toHaveCount(0)
  await stageAddedSerum(page)
  await expect(page.locator('input[id^="sale-add-qty-"]')).toHaveValue('1')
  await page.locator('input[id^="sale-add-qty-"]').fill('1000')
  await expect(page.getByRole('button', { name: /^Add to sale$/ })).toBeDisabled()
  expect(await state(page, sale.id)).toEqual(before)
  await page.locator('input[id^="sale-add-qty-"]').fill('1')
  await page.locator('[data-sale-detail-header]').getByRole('button', { name: /^Close$/ }).click()
  await expect(page.getByText('Discard unsaved changes?', { exact: true })).toBeVisible()
  await page.locator('[data-unsaved-actions]').getByRole('button', { name: /^Back$/ }).click()
  await expect(page.locator('input[id^="sale-add-qty-"]')).toHaveValue('1')
  expect(await state(page, sale.id)).toEqual(before)
  await page.getByRole('button', { name: /^Add to sale$/ }).click()
  const saved = await submit(page, `/api/sales/${sale.id}/items`, () => page.getByRole('button', { name: /^Add to sale$/ }).last().dblclick())
  const after = await state(page, sale.id)
  expect(after.lines.map((r: any) => [r.product_id, r.quantity])).toEqual([[201, 1], [202, 1]])
  expect(after.lines[0].id).toBe(before.lines[0].id)
  expect(stock(after, 202)).toBe(stock(before, 202) - 1)
  expect(lot(after, 702)).toBe(lot(before, 702) - 1)
  expect(after.allocations.find((r: any) => r.sale_item_id === after.lines[1].id).quantity).toBe(1)
  expect(after.sales[0].total_usd).toBe(16.75)
  expect(after.receipts).toHaveLength(1)
  expect(after.receipts[0].actor_id).toBe(911)
  expect(after.history.some((r: any) => r.created_by_id === 911)).toBe(true)
  expect(after.audits.some((r: any) => r.user_id === 911)).toBe(true)
  expect(after.foreignKeyCheck).toEqual([])
  const retry = await api(page, `/api/sales/${sale.id}/items`, 'POST', saved.request)
  expect(retry.status).toBe(200); redacted(retry.body)
  expect(await state(page, sale.id)).toEqual(after)
  const changed = await api(page, `/api/sales/${sale.id}/items`, 'POST', { ...saved.request, items: saved.request.items.map((r: any) => ({ ...r, quantity: 2 })) })
  expect(changed.status).toBe(409); expect(changed.body.code).toBe('idempotency_conflict')
  expect(await state(page, sale.id)).toEqual(after)
  const denied = await api(page, `/api/sales/${sale.id}/amendments`, 'POST', { kind: 'line_updated', sale_item_id: before.lines[0].id, quantity: 2, client_request_id: 'add-only-denied-amend', money_precision_version: 1 })
  expect(denied.status).toBe(403)
  expect(await state(page, sale.id)).toEqual(after)
  await persistedReload(page, sale, 'E2E Added Serum')
  await page.screenshot({ path: info.outputPath('employee-add-persisted.png'), fullPage: true })
  await info.attach('native-add-before-after-and-request', { body: JSON.stringify({ before, after, request: saved.request, response: saved.body, retryStatus: retry.status, changedStatus: changed.status, deniedStatus: denied.status }, null, 2), contentType: 'application/json' })
})

test('amend-only employee quantity and line Replace Save reload preserve both stock ledgers', async ({ page }, info) => {
  await signIn(page, 912, 'e2e_employee_amend')
  const sale = await openFreshSale(page), before = await state(page, sale.id)
  await expect(page.getByText('Add items to this sale', { exact: true })).toHaveCount(0)
  const line = page.locator('tr').filter({ has: page.locator('[data-sale-line-name]').getByText('E2E Original Powder', { exact: true }) })
  await line.getByRole('button', { name: /^Edit$/ }).click()
  await page.locator(`input[id="amend-qty-${before.lines[0].id}"]`).fill('2')
  await page.getByRole('button', { name: /^Apply$/ }).click()
  const quantity = await submit(page, `/api/sales/${sale.id}/amendments`, () => page.getByRole('button', { name: /^Apply change$/ }).click())
  const increased = await state(page, sale.id)
  expect(increased.lines[0].id).toBe(before.lines[0].id)
  expect(increased.lines[0].quantity).toBe(2)
  expect(increased.allocations).toHaveLength(1)
  expect(increased.allocations[0].id).toBe(before.allocations[0].id)
  expect(increased.allocations[0].quantity).toBe(2)
  expect(stock(increased, 201)).toBe(stock(before, 201) - 1)
  expect(lot(increased, 701)).toBe(lot(before, 701) - 1)
  expect(increased.sales[0].total_usd).toBe(19)
  await persistedReload(page, sale, 'E2E Original Powder')
  await page.locator('[data-sale-line-edit]').getByRole('button', { name: /^Edit$/ }).click()
  await page.getByRole('button', { name: /^Replace$/ }).click()
  await page.getByPlaceholder('Search by name or barcode').fill('E2E Replacement')
  await page.getByText('E2E Replacement Balm', { exact: true }).first().click()
  await page.getByRole('button', { name: /^Replace$/ }).last().click()
  const replaced = await submit(page, `/api/sales/${sale.id}/amendments`, () => page.getByRole('button', { name: /^Apply change$/ }).click())
  const after = await state(page, sale.id)
  expect(after.lines.map((r: any) => [r.product_id, r.quantity])).toEqual([[203, 2]])
  expect(stock(after, 201)).toBe(stock(increased, 201) + 2)
  expect(lot(after, 701)).toBe(lot(increased, 701) + 2)
  expect(stock(after, 203)).toBe(stock(increased, 203) - 2)
  expect(lot(after, 703)).toBe(lot(increased, 703) - 2)
  expect(after.sales[0].total_usd).toBe(6)
  expect(after.receipts).toHaveLength(2)
  expect(after.receipts.every((r: any) => r.actor_id === 912)).toBe(true)
  expect(after.history.some((r: any) => r.created_by_id === 912)).toBe(true)
  expect(after.audits.some((r: any) => r.user_id === 912)).toBe(true)
  expect(after.amendments.some((r: any) => r.kind === 'line_removed' && r.product_id === 201)).toBe(true)
  expect(after.amendments.some((r: any) => r.kind === 'line_added' && r.product_id === 203)).toBe(true)
  expect(after.foreignKeyCheck).toEqual([])
  expect((await api(page, `/api/sales/${sale.id}/amendments`, 'POST', replaced.request)).status).toBe(200)
  expect(await state(page, sale.id)).toEqual(after)
  const denied = await api(page, `/api/sales/${sale.id}/items`, 'POST', { client_request_id: 'amend-only-denied-add', money_precision_version: 1, items: [] })
  expect(denied.status).toBe(403); expect(await state(page, sale.id)).toEqual(after)
  await persistedReload(page, sale, 'E2E Replacement Balm')
  await page.screenshot({ path: info.outputPath('employee-replace-persisted.png'), fullPage: true })
  await info.attach('native-amend-before-after-and-requests', { body: JSON.stringify({ before, increased, after, quantity, replaced, deniedStatus: denied.status }, null, 2), contentType: 'application/json' })
})

for (const language of ['en', 'km']) for (const width of [1440, 390]) {
  test(`native employee replacement picker layout ${language} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await signIn(page, 912, 'e2e_employee_amend', language)
    await openFreshSale(page)
    const labels = language === 'km' ? { edit: km.edit, replace: km.amend_replace, search: km.add_items_search_placeholder } : { edit: 'Edit', replace: 'Replace', search: 'Search by name or barcode' }
    await page.locator('[data-sale-line-edit]').getByRole('button', { name: labels.edit, exact: true }).click()
    await page.getByRole('button', { name: labels.replace, exact: true }).click()
    await page.getByPlaceholder(labels.search, { exact: true }).fill('E2E Replacement')
    await expect(page.getByText('E2E Replacement Balm', { exact: true }).first()).toBeVisible()
    const bounds = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
    expect(bounds.document).toBeLessThanOrEqual(bounds.viewport + 1)
    await page.screenshot({ path: info.outputPath(`employee-replacement-${language}-${width}.png`), fullPage: true })
    await info.attach('layout-bounds', { body: JSON.stringify(bounds), contentType: 'application/json' })
  })
}

test('view-only Sales cannot gain writes from true action flags', async ({ page }, info) => {
  await signIn(page, 913, 'e2e_employee_view')
  const sale = await openFreshSale(page), before = await state(page, sale.id)
  await expect(page.locator('[data-sale-line-edit] button')).toHaveCount(0)
  await expect(page.getByText('Add items to this sale', { exact: true })).toHaveCount(0)
  for (const path of ['items', 'amendments']) {
    const denied = await api(page, `/api/sales/${sale.id}/${path}`, 'POST', { client_request_id: `view-denied-${path}`, money_precision_version: 1, items: [], kind: 'line_updated', sale_item_id: before.lines[0].id, quantity: 2 })
    expect(denied.status).toBe(403)
  }
  expect(await state(page, sale.id)).toEqual(before)
  await page.screenshot({ path: info.outputPath('employee-view-denied-controls.png'), fullPage: true })
})

test('competing real amendment makes Add Save stale and preserves the unsaved draft', async ({ page }, info) => {
  await signIn(page, 911, 'e2e_employee_add')
  const sale = await openFreshSale(page), before = await state(page, sale.id)
  await stageAddedSerum(page)
  const competingBody: any = { kind: 'line_updated', sale_item_id: before.lines[0].id, quantity: 2, money_precision_version: 1, expected_exchange_rate: 4000, client_request_id: `competitor-${sale.id}`, expected_updated_at: sale.updated_at, pricing_quote: { gross_usd: 19, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 19, total_khr: 76000 } }
  const compete = async (body: any) => {
    const response = await page.request.post(origin + '/__fixture/admin-call', { data: { path: `/api/sales/${sale.id}/amendments`, method: 'POST', body } })
    expect(response.status()).toBe(200); return response.json()
  }
  const review = await compete(competingBody)
  expect(review.status).toBe(409); expect(review.body.code).toBe('sale_header_quote_conflict')
  const committed = await compete({ ...competingBody, expected_header_quote: review.body.header_quote })
  expect(committed.status, JSON.stringify(committed.body)).toBe(200)
  const competing = await state(page, sale.id)
  expect(competing.lines[0].quantity).toBe(2)
  await page.getByRole('button', { name: /^Add to sale$/ }).click()
  const refused = page.waitForResponse(r => new URL(r.url()).pathname === `/api/sales/${sale.id}/items` && r.request().method() === 'POST')
  await page.getByRole('button', { name: /^Add to sale$/ }).last().click()
  const actual = await refused, body = await actual.json()
  expect(actual.status()).toBe(409); expect(body.code).toBe('write_conflict'); redacted(body)
  await expect(page.locator('input[id^="sale-add-qty-"]')).toHaveValue('1')
  expect(await state(page, sale.id)).toEqual(competing)
  await page.screenshot({ path: info.outputPath('employee-stale-draft-preserved.png'), fullPage: true })
  await info.attach('native-competing-and-stale-effects', { body: JSON.stringify({ before, competing, refusal: body }, null, 2), contentType: 'application/json' })
})

test('actual Worker refuses stale FX bad pricing missing identity and insufficient stock atomically', async ({ page }, info) => {
  await signIn(page, 911, 'e2e_employee_add')
  const sale = await openFreshSale(page), before = await state(page, sale.id)
  const base: any = { money_precision_version: 1, expected_exchange_rate: 4000, expected_updated_at: sale.updated_at, client_request_id: `native-controls-${sale.id}`, items: [{ product_id: 202, quantity: 1, branch_id: 1, batch_id: 702, client_line_key: 'negative-control', pricing_source: 'selling', pricing_quote: { gross_usd: 7.25, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 7.25, total_khr: 29000 } }] }
  const controls: any[] = []
  for (const [name, body, status, code] of [
    ['missing-id', { ...base, client_request_id: null }, 400, 'client_request_id_required'],
    ['stale-fx', { ...base, client_request_id: `native-fx-${sale.id}`, expected_exchange_rate: 4100 }, 409, 'exchange_rate_changed'],
    ['bad-price', { ...base, client_request_id: `native-price-${sale.id}`, items: [{ ...base.items[0], pricing_quote: { ...base.items[0].pricing_quote, gross_usd: 8 } }] }, 409, 'sale_pricing_quote_conflict'],
  ] as const) {
    const actual = await api(page, `/api/sales/${sale.id}/items`, 'POST', body)
    expect(actual.status, name).toBe(status); expect(actual.body.code, name).toBe(code); redacted(actual.body)
    expect(await state(page, sale.id)).toEqual(before); controls.push({ name, ...actual })
  }
  const oversell: any = { ...base, client_request_id: `native-oversell-${sale.id}`, items: [{ ...base.items[0], quantity: 1000, pricing_quote: { gross_usd: 7250, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 7250, total_khr: 29000000 } }] }
  let rejected = await api(page, `/api/sales/${sale.id}/items`, 'POST', oversell)
  if (rejected.status === 409 && rejected.body.code === 'sale_header_quote_conflict') {
    expect(await state(page, sale.id)).toEqual(before)
    rejected = await api(page, `/api/sales/${sale.id}/items`, 'POST', { ...oversell, expected_header_quote: rejected.body.header_quote })
  }
  expect(rejected.status, JSON.stringify(rejected.body)).toBe(400)
  expect(String(rejected.body.error)).toMatch(/stock|quantity/i)
  expect(await state(page, sale.id)).toEqual(before)
  controls.push({ name: 'insufficient-stock', ...rejected })
  await info.attach('native-negative-controls', { body: JSON.stringify({ before, controls, after: await state(page, sale.id) }, null, 2), contentType: 'application/json' })
})
