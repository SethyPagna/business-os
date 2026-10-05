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
  await page.addInitScript(actor => { localStorage.setItem('businessos_device_id', `employee-save-device-${actor}`) }, actor)
  await page.goto(origin)
  await expect(page.locator('#login-username')).toBeVisible()
  await expect(page.locator('#login-username')).toBeFocused()
  if (language === 'km') {
    await page.getByRole('button', { name: 'Switch to Khmer', exact: true }).click()
    await expect(page.getByRole('button', { name: km.login, exact: true })).toBeVisible()
  }
  await page.locator('#login-username').fill(username)
  await page.locator('#login-password').fill('admin123')
  await expect(page.locator('#login-username')).toHaveValue(username)
  await expect(page.locator('#login-password')).toHaveValue('admin123')
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
  await openReceipt(page, sale)
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
    if (/^(cost_price_|purchase_price_|total_cost_|unit_cost_|received_cost_|batch_unit_cost_|stock_value_|cogs_|gross_profit_|margin_)/.test(key)) expect(child, `employee response ${key} must remain redacted`).toBeNull()
    else if (typeof child === 'string' && child.trim() && (key === 'items' || key.endsWith('_json') || ['details', 'old_value', 'new_value', 'undo_payload', 'redo_payload'].includes(key))) redacted(JSON.parse(child))
    else redacted(child)
  }
}
async function persistedReload(page: Page, sale: any, name: string) {
  await page.reload()
  await openReceipt(page, sale)
  await expect(page.locator('[data-sale-line-name]').getByText(name, { exact: true })).toBeVisible()
}
async function openReceipt(page: Page, sale: any) {
  const label = page.getByText(String(sale.receipt_number), { exact: true }).filter({ visible: true }).first()
  await expect(label).toBeVisible({ timeout: 60_000 })
  if ((page.viewportSize()?.width || 1440) < 768) {
    await page.locator('div.card').filter({ has: page.getByText(String(sale.receipt_number), { exact: true }) }).filter({ visible: true }).click({ position: { x: 8, y: 8 } })
  } else await label.click()
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
  expect(retry.body.sale).toEqual(saved.body.sale)
  const resolved = await api(page, `/api/sales/${sale.id}/line-receipt/add_items`, 'POST', saved.request)
  expect(resolved.status).toBe(200); expect(resolved.body.committed).toBe(true); redacted(resolved.body)
  expect(resolved.body.response.sale).toEqual(saved.body.sale)
  expect(await state(page, sale.id)).toEqual(after)
  const changed = await api(page, `/api/sales/${sale.id}/items`, 'POST', { ...saved.request, items: saved.request.items.map((r: any) => ({ ...r, quantity: 2 })) })
  expect(changed.status).toBe(409); expect(changed.body.code).toBe('idempotency_conflict')
  expect(await state(page, sale.id)).toEqual(after)
  const denied = await api(page, `/api/sales/${sale.id}/amendments`, 'POST', { kind: 'line_updated', sale_item_id: before.lines[0].id, quantity: 2, client_request_id: 'add-only-denied-amend', money_precision_version: 1 })
  expect(denied.status).toBe(403)
  expect(await state(page, sale.id)).toEqual(after)
  await persistedReload(page, sale, 'E2E Added Serum')
  await page.screenshot({ path: info.outputPath('employee-add-persisted.png'), fullPage: true })
  const recordsRead = page.waitForResponse(r => new URL(r.url()).pathname === `/api/sales/${sale.id}/records` && r.request().method() === 'GET')
  await page.locator('[data-sale-records-action]').click()
  const recordsResponse = await recordsRead, records = await recordsResponse.json()
  expect(recordsResponse.status()).toBe(200); expect(records.count).toBeGreaterThan(0); redacted(records)
  await expect(page.getByText('Product added', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: info.outputPath('employee-add-records.png'), fullPage: true })
  expect(await state(page, sale.id)).toEqual(after)
  expect(JSON.parse(after.receipts[0].response_json).sale.items[0].cost_price_usd).toBe(1.2345)
  await info.attach('native-add-before-after-and-request', { body: JSON.stringify({ before, after, request: saved.request, response: saved.body, retry, resolved, records, changedStatus: changed.status, deniedStatus: denied.status }, null, 2), contentType: 'application/json' })
})

test('amend-only employee sequential quantity saves keep one detail open and advance confirmed versions', async ({ page }, info) => {
  await signIn(page, 912, 'e2e_employee_amend')
  const sale = await openFreshSale(page), before = await state(page, sale.id)
  const header = await page.locator('[data-sale-detail-header]').elementHandle()
  expect(header).not.toBeNull()
  await expect(page.getByText('Add items to this sale', { exact: true })).toHaveCount(0)
  const requestIds = new Set<string>()
  const evidence: any[] = []
  let latestVersion = String(sale.updated_at), previousQuantity = 1
  let previous = before
  expect(latestVersion).toBe(String(before.sales[0].updated_at))
  try {
    for (const quantity of [2, 3, 1]) {
      await expect(page.locator('[data-sale-detail-header]')).toBeVisible()
      expect(await header!.evaluate(element => element.isConnected), 'the original detail must remain open').toBe(true)
      const line = page.locator('tr').filter({ has: page.locator('[data-sale-line-name]').getByText('E2E Original Powder', { exact: true }) })
      await expect(line.getByRole('button', { name: /^Edit$/ })).toBeEnabled()
      await line.getByRole('button', { name: /^Edit$/ }).click()
      const input = page.locator('input[id="amend-qty-' + before.lines[0].id + '"]')
      await expect(input, 'the next editor must show the last committed quantity').toHaveValue(String(previousQuantity))
      await input.fill(String(quantity))
      await page.getByRole('button', { name: /^Apply$/ }).click()
      const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/sales/' + sale.id + '/amendments' && response.request().method() === 'POST')
      await page.getByRole('button', { name: /^Apply change$/ }).click()
      const response = await pending, body = await response.json(), request = response.request().postDataJSON()
      const after = await state(page, sale.id)
      evidence.push({ quantity, expectedVersion: latestVersion, status: response.status(), request, response: body, before: previous, after })
      redacted(body)
      expect(request.expected_updated_at, 'each new edit must use the latest confirmed version, without reopening').toBe(latestVersion)
      expect(typeof request.client_request_id).toBe('string')
      expect(request.client_request_id.length).toBeGreaterThan(0)
      expect(requestIds.has(request.client_request_id), 'separate edits need distinct request identities').toBe(false)
      requestIds.add(request.client_request_id)
      expect(response.status(), JSON.stringify(body)).toBe(200)
      expect(Number(body.sale.id)).toBe(Number(sale.id))
      expect(typeof body.updated_at).toBe('string')
      expect(body.updated_at).not.toBe(latestVersion)
      expect(after.sales[0].updated_at).toBe(body.updated_at)
      expect(after.lines.map((row: any) => [row.id, row.product_id, row.quantity])).toEqual([[before.lines[0].id, 201, quantity]])
      expect(after.allocations).toHaveLength(1)
      expect(after.allocations[0].id).toBe(before.allocations[0].id)
      expect(after.allocations[0].quantity).toBe(quantity)
      expect(stock(after, 201)).toBe(stock(before, 201) - (quantity - 1))
      expect(lot(after, 701)).toBe(lot(before, 701) - (quantity - 1))
      expect(after.sales[0].total_usd).toBe(quantity * 9.5)
      expect(after.sales[0].total_khr).toBe(quantity * 38000)
      expect(Number(after.sales[0].amount_paid_usd)).toBe(Number(before.sales[0].amount_paid_usd))
      expect(after.sales[0].sale_status).toBe(before.sales[0].sale_status)
      expect(after.receipts).toHaveLength(before.receipts.length + requestIds.size)
      expect(after.receipts.every((row: any) => row.actor_id === 912)).toBe(true)
      expect(after.amendments.length).toBeGreaterThan(previous.amendments.length)
      expect(after.amendments.every((row: any) => row.user_id === 912)).toBe(true)
      expect(after.audits.filter((row: any) => row.user_id === 912 && !previous.audits.some((old: any) => old.id === row.id)).length).toBeGreaterThan(0)
      expect(after.foreignKeyCheck).toEqual([])
      const receipt = await api(page, '/api/sales/' + sale.id + '/line-receipt/amendment', 'POST', request)
      expect(receipt.status).toBe(200)
      expect(receipt.body.committed).toBe(true)
      redacted(receipt.body)
      expect(receipt.body.response.sale).toEqual(body.sale)
      expect(await state(page, sale.id)).toEqual(after)
      await expect(page.getByRole('button', { name: /^Apply change$/ })).toHaveCount(0)
      await expect(input).toHaveCount(0)
      await expect(line.getByRole('button', { name: /^Edit$/ })).toBeEnabled()
      latestVersion = body.updated_at
      previousQuantity = quantity
      previous = after
    }
    expect(requestIds.size).toBe(3)
    expect(await header!.evaluate(element => element.isConnected)).toBe(true)
    await expect(page.locator('[data-sale-detail-header]').getByRole('button', { name: /^Close$/ })).toBeEnabled()
  } finally {
    await info.attach('same-open-detail-quantity-requests-and-effects', { body: JSON.stringify({ sale, before, steps: evidence }, null, 2), contentType: 'application/json' })
    await page.screenshot({ path: info.outputPath('employee-repeated-quantity-same-detail.png'), fullPage: true })
  }
})
const pendingSaleKeys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('businessos_pending_sale-')).map(key => [key, localStorage.getItem(key)]))

test('a real concurrent edit refuses a staged employee edit once, releases it, and the redo saves on the latest version', async ({ page }, info) => {
  await signIn(page, 912, 'e2e_employee_amend')
  const sale = await openFreshSale(page), before = await state(page, sale.id)
  const line = page.locator('tr').filter({ has: page.locator('[data-sale-line-name]').getByText('E2E Original Powder', { exact: true }) })
  const input = page.locator('input[id="amend-qty-' + before.lines[0].id + '"]')
  await line.getByRole('button', { name: /^Edit$/ }).click()
  await input.fill('3')
  await page.getByRole('button', { name: /^Apply$/ }).click()
  await expect(page.getByRole('button', { name: /^Apply change$/ })).toBeVisible()
  const competingBody: any = { kind: 'line_updated', sale_item_id: before.lines[0].id, quantity: 2, money_precision_version: 1, expected_exchange_rate: 4000, client_request_id: `competitor-redo-${sale.id}`, expected_updated_at: sale.updated_at, pricing_quote: { gross_usd: 19, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 19, total_khr: 76000 } }
  const compete = async (body: any) => {
    const response = await page.request.post(origin + '/__fixture/admin-call', { data: { path: `/api/sales/${sale.id}/amendments`, method: 'POST', body } })
    expect(response.status()).toBe(200); return response.json()
  }
  const review = await compete(competingBody)
  expect(review.body.code).toBe('sale_header_quote_conflict')
  const committed = await compete({ ...competingBody, expected_header_quote: review.body.header_quote })
  expect(committed.status, JSON.stringify(committed.body)).toBe(200)
  const competing = await state(page, sale.id)
  const steps: any[] = []
  try {
    const refusedResponse = page.waitForResponse(r => new URL(r.url()).pathname === `/api/sales/${sale.id}/amendments` && r.request().method() === 'POST')
    await page.getByRole('button', { name: /^Apply change$/ }).click()
    const refused = await refusedResponse, refusedBody = await refused.json(), refusedRequest = refused.request().postDataJSON()
    steps.push({ step: 'stale', status: refused.status(), request: refusedRequest, response: refusedBody })
    expect(refused.status()).toBe(409)
    expect(refusedBody.code).toBe('write_conflict')
    expect(refusedRequest.expected_updated_at).toBe(String(sale.updated_at))
    expect(await state(page, sale.id), 'the refused edit wrote nothing').toEqual(competing)
    await expect.poll(() => pendingSaleKeys(page), { message: 'a refusal the server proved happened before any write must not keep a paused request' }).toEqual([])
    await expect(page.getByText(/other changes remain paused/)).toHaveCount(0)
    await page.screenshot({ path: info.outputPath('employee-refused-edit-released.png'), fullPage: true })
    steps.push({ step: 'notices', redoHint: await page.getByText('Open the edit again to change the latest version.', { exact: false }).count(), conflictDialog: await page.getByText('Sale changed on another device', { exact: true }).count() })
    const dismiss = page.getByRole('button', { name: /^Dismiss$/ })
    if (await dismiss.count()) await dismiss.click()
    await page.getByRole('button', { name: /^Cancel$/ }).first().click()
    await expect(input).toHaveCount(0)
    await line.getByRole('button', { name: /^Edit$/ }).click()
    await expect(input, 'the redo starts from the competitor’s committed quantity').toHaveValue('2')
    await input.fill('4')
    await page.getByRole('button', { name: /^Apply$/ }).click()
    const redoResponse = page.waitForResponse(r => new URL(r.url()).pathname === `/api/sales/${sale.id}/amendments` && r.request().method() === 'POST')
    await page.getByRole('button', { name: /^Apply change$/ }).click()
    const redo = await redoResponse, redoBody = await redo.json(), redoRequest = redo.request().postDataJSON()
    steps.push({ step: 'redo', status: redo.status(), request: redoRequest, response: redoBody })
    expect(redo.status(), JSON.stringify(redoBody)).toBe(200)
    expect(redoRequest.expected_updated_at).toBe(competing.sales[0].updated_at)
    expect(redoRequest.client_request_id).not.toBe(refusedRequest.client_request_id)
    const after = await state(page, sale.id)
    steps.push({ step: 'after', after })
    expect(after.lines.map((row: any) => [row.id, row.quantity])).toEqual([[before.lines[0].id, 4]])
    expect(after.receipts).toHaveLength(competing.receipts.length + 1)
    expect(after.receipts.at(-1).actor_id).toBe(912)
    expect(stock(after, 201)).toBe(stock(before, 201) - 3)
    expect(after.foreignKeyCheck).toEqual([])
    expect(await pendingSaleKeys(page)).toEqual([])
  } finally {
    await info.attach('concurrent-refusal-release-and-redo', { body: JSON.stringify({ sale, before, competing, steps }, null, 2), contentType: 'application/json' })
  }
})

test('an employee edit with an unknown outcome stays frozen and Retry resends the exact request', async ({ page }, info) => {
  await signIn(page, 912, 'e2e_employee_amend')
  const sale = await openFreshSale(page), before = await state(page, sale.id)
  const line = page.locator('tr').filter({ has: page.locator('[data-sale-line-name]').getByText('E2E Original Powder', { exact: true }) })
  await line.getByRole('button', { name: /^Edit$/ }).click()
  await page.locator('input[id="amend-qty-' + before.lines[0].id + '"]').fill('2')
  await page.getByRole('button', { name: /^Apply$/ }).click()
  const path = `/api/sales/${sale.id}/amendments`
  const aborted: any[] = []
  const amendments = (url: URL) => url.pathname === path
  await page.route(amendments, route => { aborted.push(route.request().postDataJSON()); return route.abort('failed') })
  await page.getByRole('button', { name: /^Apply change$/ }).click()
  await expect(page.getByText(/other changes remain paused/)).toBeVisible({ timeout: 30_000 })
  expect(aborted).toHaveLength(1)
  const frozen = await pendingSaleKeys(page)
  expect(frozen).toHaveLength(1)
  expect(JSON.parse(String(frozen[0][1])).body).toEqual(aborted[0])
  expect(await state(page, sale.id), 'nothing reached the Worker').toEqual(before)
  await page.screenshot({ path: info.outputPath('employee-unknown-outcome-frozen.png'), fullPage: true })
  await page.unroute(amendments)
  await page.getByRole('button', { name: /^Cancel$/ }).last().click()
  const retried = page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === 'POST')
  await page.getByRole('button', { name: /^Retry$/ }).click()
  const response = await retried, body = await response.json()
  expect(response.status(), JSON.stringify(body)).toBe(200)
  expect(response.request().postDataJSON(), 'Retry resends the exact frozen request and identity').toEqual(aborted[0])
  const after = await state(page, sale.id)
  expect(after.lines[0].quantity).toBe(2)
  expect(after.receipts).toHaveLength(1)
  expect(await pendingSaleKeys(page)).toEqual([])
  await info.attach('unknown-outcome-frozen-and-exact-retry', { body: JSON.stringify({ sale, before, aborted, frozen, retry: { status: response.status(), body }, after }, null, 2), contentType: 'application/json' })
})


test('an employee edits a line and then records payment in the same open detail', async ({ page }, info) => {
  await signIn(page, 912, 'e2e_employee_amend')
  const sale = await openFreshSale(page), before = await state(page, sale.id)
  const line = page.locator('tr').filter({ has: page.locator('[data-sale-line-name]').getByText('E2E Original Powder', { exact: true }) })
  await line.getByRole('button', { name: /^Edit$/ }).click()
  await page.locator('input[id="amend-qty-' + before.lines[0].id + '"]').fill('2')
  await page.getByRole('button', { name: /^Apply$/ }).click()
  const amended = page.waitForResponse(r => new URL(r.url()).pathname === `/api/sales/${sale.id}/amendments` && r.request().method() === 'POST')
  await page.getByRole('button', { name: /^Apply change$/ }).click()
  const amendment = await amended, amendmentBody = await amendment.json()
  expect(amendment.status(), JSON.stringify(amendmentBody)).toBe(200)
  await expect(line.getByRole('button', { name: /^Edit$/ })).toBeEnabled()
  await page.getByRole('button', { name: /^Record payment$/ }).click()
  const paid = page.waitForResponse(r => new URL(r.url()).pathname === `/api/sales/${sale.id}/status` && r.request().method() === 'PATCH')
  await page.locator('[data-sale-status-review-actions]').getByRole('button', { name: /^Update$/ }).click()
  const payment = await paid, paymentBody = await payment.json(), paymentRequest = payment.request().postDataJSON()
  const after = await state(page, sale.id)
  await info.attach('amend-then-record-payment', { body: JSON.stringify({ sale, before, amendment: { request: amendment.request().postDataJSON(), response: amendmentBody }, payment: { status: payment.status(), request: paymentRequest, response: paymentBody }, after }, null, 2), contentType: 'application/json' })
  expect(paymentRequest.expected_updated_at, 'payment after an edit in the same detail uses the edit’s committed version').toBe(amendmentBody.updated_at)
  expect(payment.status(), JSON.stringify(paymentBody)).toBe(200)
  expect(after.sales[0].sale_status).toBe('completed')
  expect(Number(after.sales[0].amount_paid_usd)).toBe(19)
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
  expect(after.amendments.every((r: any) => r.user_id === 912)).toBe(true)
  expect(after.audits.some((r: any) => r.user_id === 912)).toBe(true)
  expect(after.amendments.some((r: any) => r.kind === 'line_removed' && r.product_id === 201)).toBe(true)
  expect(after.amendments.some((r: any) => r.kind === 'line_added' && r.product_id === 203)).toBe(true)
  expect(after.foreignKeyCheck).toEqual([])
  const replay = await api(page, `/api/sales/${sale.id}/amendments`, 'POST', replaced.request)
  expect(replay.status).toBe(200); redacted(replay.body); expect(replay.body.sale).toEqual(replaced.body.sale)
  const resolved = await api(page, `/api/sales/${sale.id}/line-receipt/amendment`, 'POST', replaced.request)
  expect(resolved.status).toBe(200); expect(resolved.body.committed).toBe(true); redacted(resolved.body)
  expect(resolved.body.response.sale).toEqual(replaced.body.sale)
  const records = await api(page, `/api/sales/${sale.id}/records`)
  const amendments = await api(page, `/api/sales/${sale.id}/amendments`)
  expect(records.status).toBe(200); expect(records.body.count).toBeGreaterThan(0); redacted(records.body)
  expect(amendments.status).toBe(200); expect(amendments.body.entries).toHaveLength(3); redacted(amendments.body)
  const nextAmendment = { kind: 'line_updated', sale_item_id: after.lines[0].id, quantity: 3, money_precision_version: 1,
    expected_exchange_rate: 4000, client_request_id: `amend-stale-${sale.id}`, expected_updated_at: sale.updated_at,
    pricing_quote: { gross_usd: 9, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9, total_khr: 36000 } }
  const stale = await api(page, `/api/sales/${sale.id}/amendments`, 'POST', nextAmendment)
  expect(stale.status).toBe(409); expect(stale.body.code).toBe('write_conflict'); redacted(stale.body)
  const quote = await api(page, `/api/sales/${sale.id}/amendments`, 'POST', { ...nextAmendment,
    client_request_id: `amend-review-${sale.id}`, expected_updated_at: replaced.body.updated_at })
  expect(quote.status).toBe(409); expect(quote.body.code).toBe('sale_header_quote_conflict'); redacted(quote.body)
  expect(quote.body.header_quote.total_usd).toBe(9)
  expect(await state(page, sale.id)).toEqual(after)
  const denied = await api(page, `/api/sales/${sale.id}/items`, 'POST', { client_request_id: 'amend-only-denied-add', money_precision_version: 1, items: [] })
  expect(denied.status).toBe(403); expect(await state(page, sale.id)).toEqual(after)
  await persistedReload(page, sale, 'E2E Replacement Balm')
  await page.screenshot({ path: info.outputPath('employee-replace-persisted.png'), fullPage: true })
  await info.attach('native-amend-before-after-and-requests', { body: JSON.stringify({ before, increased, after, quantity, replaced, replay, resolved, records, amendments, stale, quote, deniedStatus: denied.status }, null, 2), contentType: 'application/json' })
})

for (const language of ['en', 'km']) for (const width of [1280, 360]) {
  test(`native employee replacement picker layout ${language} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 800 })
    await signIn(page, 912, 'e2e_employee_amend', language)
    const sale = await openFreshSale(page)
    const labels = language === 'km' ? { edit: km.edit, replace: km.amend_replace, search: km.add_items_search_placeholder } : { edit: 'Edit', replace: 'Replace', search: 'Search by name or barcode' }
    await page.locator('[data-sale-line-edit]').getByRole('button', { name: labels.edit, exact: true }).click()
    await page.getByRole('button', { name: labels.replace, exact: true }).click()
    await page.getByPlaceholder(labels.search, { exact: true }).fill('E2E Replacement')
    await expect(page.getByText('E2E Replacement Balm', { exact: true }).first()).toBeVisible()
    const bounds = await page.getByPlaceholder(labels.search, { exact: true }).evaluate(search => {
      const panel = search.closest('td')!
      const scroller = search.closest('table')!.parentElement!
      const initialScroll = scroller.scrollLeft
      const controls = [initialScroll, 0, scroller.scrollWidth - scroller.clientWidth].flatMap(scrollLeft => {
        scroller.scrollLeft = scrollLeft
        return [...panel.querySelectorAll('input, button, [role="button"]')].map(element => {
        const rect = element.getBoundingClientRect()
        let left = 0, right = innerWidth
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(parent).overflowX)) {
            const bounds = parent.getBoundingClientRect()
            left = Math.max(left, bounds.left + parent.clientLeft)
            right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth)
          }
        }
        return { label: element.getAttribute('placeholder') || element.textContent?.trim(), scrollLeft: scroller.scrollLeft, left: rect.left, right: rect.right, clipLeft: left, clipRight: right }
        })
      })
      scroller.scrollLeft = initialScroll
      return { viewport: innerWidth, document: document.documentElement.scrollWidth, controls }
    })
    expect(bounds.document).toBeLessThanOrEqual(bounds.viewport + 1)
    await page.screenshot({ path: info.outputPath(`employee-replacement-${language}-${width}.png`), fullPage: false })
    await info.attach('layout-bounds', { body: JSON.stringify(bounds), contentType: 'application/json' })
    expect(bounds.controls.length).toBeGreaterThanOrEqual(6)
    for (const control of bounds.controls) {
      expect(control.left, `${control.label} left edge is clipped`).toBeGreaterThanOrEqual(control.clipLeft - 1)
      expect(control.right, `${control.label} right edge is clipped`).toBeLessThanOrEqual(control.clipRight + 1)
    }
    await page.getByText('E2E Replacement Balm', { exact: true }).first().click()
    await page.getByRole('button', { name: labels.replace, exact: true }).last().click()
    await submit(page, `/api/sales/${sale.id}/amendments`, () => page.getByRole('button', { name: language === 'km' ? km.amend_confirm : 'Apply change', exact: true }).click())
    await persistedReload(page, sale, 'E2E Replacement Balm')
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
  const headerReview = await api(page, `/api/sales/${sale.id}/items`, 'POST', base)
  expect(headerReview.status).toBe(409); expect(headerReview.body.code).toBe('sale_header_quote_conflict'); redacted(headerReview.body)
  expect(headerReview.body.header_quote.total_usd).toBe(16.75)
  expect(await state(page, sale.id)).toEqual(before)
  controls.push({ name: 'header-review', ...headerReview })
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
  expect(rejected.status, JSON.stringify(rejected.body)).toBe(409)
  expect(String(rejected.body.error)).toMatch(/stock|quantity/i)
  expect(await state(page, sale.id)).toEqual(before)
  controls.push({ name: 'insufficient-stock', ...rejected })
  await info.attach('native-negative-controls', { body: JSON.stringify({ before, controls, after: await state(page, sale.id) }, null, 2), contentType: 'application/json' })
})

test('authorized cost viewer retains success replay and stale costs while employee Records and snapshots remain safe', async ({ page, browser }, info) => {
  await signIn(page, 914, 'e2e_employee_cost_view')
  const sale = await openFreshSale(page)
  const me = await api(page, '/api/auth/me'), actor = me.body.user || me.body
  const rolePermissions = typeof actor.role_permissions === 'string' ? JSON.parse(actor.role_permissions) : actor.role_permissions
  const userPermissions = typeof actor.permissions === 'string' ? JSON.parse(actor.permissions) : actor.permissions
  const permissions = { ...rolePermissions, ...userPermissions }
  expect(permissions.product_cost_view).toBe(true); expect(permissions.product_cost_edit).toBe(false)
  await stageAddedSerum(page)
  await page.getByRole('button', { name: /^Add to sale$/ }).click()
  const saved = await submitViewer(page, `/api/sales/${sale.id}/items`, () => page.getByRole('button', { name: /^Add to sale$/ }).last().click())
  expect(saved.body.sale.total_usd).toBe(16.75)
  expect(saved.body.sale.items.every((line: any) => line.cost_price_usd === 1.2345)).toBe(true)
  const persisted = await state(page, sale.id)
  const replay = await api(page, `/api/sales/${sale.id}/items`, 'POST', saved.request)
  const resolved = await api(page, `/api/sales/${sale.id}/line-receipt/add_items`, 'POST', saved.request)
  expect(replay.status).toBe(200); expect(replay.body.sale).toEqual(saved.body.sale)
  expect(resolved.status).toBe(200); expect(resolved.body.committed).toBe(true); expect(resolved.body.response.sale).toEqual(saved.body.sale)
  const stale = await api(page, `/api/sales/${sale.id}/items`, 'POST', { ...saved.request, client_request_id: `viewer-stale-${sale.id}`, expected_updated_at: sale.updated_at })
  expect(stale.status).toBe(409); expect(stale.body.code).toBe('write_conflict')
  expect(typeof stale.body.current.items).toBe('string')
  expect(JSON.parse(stale.body.current.items).every((line: any) => line.cost_price_usd === 1.2345)).toBe(true)
  expect(stale.body.current.total_usd).toBe(16.75)
  const quoteRequest = { ...saved.request, client_request_id: `viewer-review-${sale.id}`, expected_updated_at: saved.body.updated_at,
    items: saved.request.items.map((line: any) => ({ ...line, client_line_key: `viewer-review-line-${sale.id}` })) }
  delete quoteRequest.expected_header_quote
  const quote = await api(page, `/api/sales/${sale.id}/items`, 'POST', quoteRequest)
  expect(quote.status).toBe(409); expect(quote.body.code).toBe('sale_header_quote_conflict'); expect(quote.body.header_quote.total_usd).toBe(24)
  const viewerRecords = await api(page, `/api/sales/${sale.id}/records`)
  expect(viewerRecords.status).toBe(200); expect(viewerRecords.body.count).toBeGreaterThan(0)
  await persistedReload(page, sale, 'E2E Added Serum')
  const recordsRead = page.waitForResponse(r => new URL(r.url()).pathname === `/api/sales/${sale.id}/records` && r.request().method() === 'GET')
  await page.locator('[data-sale-records-action]').click()
  expect((await recordsRead).status()).toBe(200)
  await expect(page.getByText('Product added', { exact: true }).first()).toBeVisible()
  await page.screenshot({ path: info.outputPath('employee-cost-viewer-records.png'), fullPage: true })
  const context = await browser.newContext()
  try {
    const employeePage = await context.newPage()
    await signIn(employeePage, 911, 'e2e_employee_add')
    const employeeRecords = await api(employeePage, `/api/sales/${sale.id}/records`)
    expect(employeeRecords.status).toBe(200); redacted(employeeRecords.body)
    expect(employeeRecords.body).toEqual(viewerRecords.body)
    const otherActorReceipt = await api(employeePage, `/api/sales/${sale.id}/line-receipt/add_items`, 'POST', saved.request)
    expect(otherActorReceipt.status).toBe(200); expect(otherActorReceipt.body.committed).toBe(false); redacted(otherActorReceipt.body)
  } finally { await context.close() }
  expect(await state(page, sale.id)).toEqual(persisted)
  expect(JSON.parse(persisted.receipts[0].response_json).sale.items[0].cost_price_usd).toBe(1.2345)
  await info.attach('native-authorized-cost-viewer-paths', { body: JSON.stringify({ saved, replay, resolved, stale, quote, viewerRecords, persisted, afterReads: await state(page, sale.id) }, null, 2), contentType: 'application/json' })
})

async function submitViewer(page: Page, path: string, trigger: () => Promise<unknown>) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === 'POST')
  await trigger()
  const actual = await response, body = await actual.json()
  expect(actual.status(), JSON.stringify(body)).toBe(200)
  return { body, request: actual.request().postDataJSON() }
}
