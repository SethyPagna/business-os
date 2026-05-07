/* eslint-disable no-console */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(state, method, pathname, body = null, extraHeaders = {}) {
  const started = performance.now()
  const headers = {
    ...(state.cookie ? { cookie: state.cookie } : {}),
    ...extraHeaders,
  }
  if (body != null && !(body instanceof FormData) && !headers['content-type']) {
    headers['content-type'] = 'application/json'
  }
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers,
    body: body == null
      ? undefined
      : (body instanceof FormData ? body : JSON.stringify(body)),
  })
  const ms = Math.round(performance.now() - started)
  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text()
  return {
    ok: response.ok,
    status: response.status,
    ms,
    payload,
  }
}

async function login() {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  })
  const payload = await response.json().catch(() => ({}))
  assert(response.ok, `Login failed (${response.status}): ${payload?.error || 'unknown error'}`)
  const cookie = String(response.headers.get('set-cookie') || '').split(';')[0]
  assert(cookie.startsWith('bos_session='), 'Login did not return a session cookie')
  return { cookie }
}

async function main() {
  const state = await login()
  const seed = `QA Smoke ${Date.now()}`
  const timings = []
  const record = (name, result) => {
    timings.push({ name, status: result.status, ms: result.ms })
    assert(result.ok, `${name} failed (${result.status})`)
    return result.payload
  }

  const health = await fetch(`${BASE_URL}/health`).then((res) => res.json())
  assert(health.status === 'ok', 'Health check is not ok')

  const branches = record('branches', await request(state, 'GET', '/api/branches'))
  const activeBranches = (Array.isArray(branches) ? branches : []).filter((branch) => Number(branch?.is_active ?? 1) === 1)
  const branchId = Number(activeBranches?.[0]?.id || 0)
  const secondaryBranchId = Number(activeBranches?.[1]?.id || 0)
  assert(branchId > 0, 'No active branch found')

  const parent = record('create parent', await request(state, 'POST', '/api/products', {
    name: `${seed} Family`,
    category: 'Smoke',
    brand: 'Smoke',
    unit: 'pcs',
    is_group: 1,
    stock_quantity: 0,
    branch_id: branchId,
  }))

  const variantA = record('create variant A', await request(state, 'POST', '/api/products/variant', {
    parent_id: parent.id,
    name: `${seed} Variant A`,
    category: 'Smoke',
    brand: 'Smoke',
    unit: 'pcs',
    barcode: `SMK${Date.now()}A`,
    stock_quantity: 0,
    branch_id: branchId,
    selling_price_usd: 9,
    purchase_price_usd: 4,
  }))

  const variantB = record('create variant B', await request(state, 'POST', '/api/products/variant', {
    parent_id: parent.id,
    name: `${seed} Variant B`,
    category: 'Smoke',
    brand: 'Smoke',
    unit: 'pcs',
    barcode: `SMK${Date.now()}B`,
    stock_quantity: 0,
    branch_id: branchId,
    selling_price_usd: 12,
    purchase_price_usd: 5,
  }))

  record('adjust batch A1', await request(state, 'POST', '/api/inventory/adjust', {
    productId: variantA.id,
    type: 'add',
    quantity: 5,
    branchId,
    reason: 'Smoke batch A1',
    lotCode: 'LOT-A1',
    expiryDate: '2026-10-01',
  }))
  record('adjust batch A2', await request(state, 'POST', '/api/inventory/adjust', {
    productId: variantA.id,
    type: 'add',
    quantity: 4,
    branchId,
    reason: 'Smoke batch A2',
    lotCode: 'LOT-A2',
    expiryDate: '2026-12-15',
  }))
  record('adjust batch B1', await request(state, 'POST', '/api/inventory/adjust', {
    productId: variantB.id,
    type: 'add',
    quantity: 3,
    branchId,
    reason: 'Smoke batch B1',
    lotCode: 'LOT-B1',
    expiryDate: '2027-01-10',
  }))

  const beforeSearch = record('inventory grouped search before sale', await request(state, 'GET', `/api/inventory/products/search?query=${encodeURIComponent(seed)}&group=1&page=1&pageSize=20`))
  assert(beforeSearch.total >= 2, 'Grouped inventory search did not return the smoke variants')

  const sale = record('create sale', await request(state, 'POST', '/api/sales', {
    branch_id: branchId,
    sale_status: 'completed',
    payment_method: 'Cash',
    payment_currency: 'USD',
    subtotal_usd: 24,
    total_usd: 24,
    items: [
      {
        product_id: variantA.id,
        name: `${seed} Variant A`,
        quantity: 6,
        applied_price_usd: 4,
      },
    ],
  }))

  const saleRows = record('sales lookup', await request(state, 'GET', `/api/sales?page=1&pageSize=20&search=${encodeURIComponent(sale.receiptNumber)}`))
  const saleRowList = Array.isArray(saleRows) ? saleRows : []
  const createdSale = saleRowList[0]
  const createdSaleId = Number(createdSale?.id || sale.id || 0)
  assert(createdSaleId > 0, 'Created sale was not returned in sale search')
  assert(Array.isArray(createdSale?.items) && createdSale.items.length === 1, 'Created sale row did not include the expected item payload')

  const createdSaleItemId = Number(createdSale.items[0]?.id || 0)
  assert(createdSaleItemId > 0, 'Created sale item id missing from sale detail')

  const customerReturn = record('create return', await request(state, 'POST', '/api/returns', {
    sale_id: createdSaleId,
    branch_id: branchId,
    reason: 'Smoke customer return',
    total_refund_usd: 24,
    items: [
      {
        sale_item_id: createdSaleItemId,
        product_id: variantA.id,
        product_name: `${seed} Variant A`,
        quantity: 6,
        total_usd: 24,
        return_to_stock: 1,
      },
    ],
  }))

  if (secondaryBranchId > 0 && secondaryBranchId !== branchId) {
    const transfer = record('transfer stock', await request(state, 'POST', '/api/inventory/transfer', {
      productId: variantB.id,
      fromBranchId: branchId,
      toBranchId: secondaryBranchId,
      quantity: 1,
      reason: 'Smoke transfer',
    }))
    assert(transfer.idempotent === false || Number(transfer.transferId || 0) > 0, 'Transfer did not return a transfer id')
  }

  const dashboard = record('dashboard', await request(state, 'GET', '/api/dashboard'))
  const analytics = record('analytics', await request(state, 'GET', '/api/analytics?startDate=2026-05-01&endDate=2026-05-07&granularity=day'))
  assert(Array.isArray(analytics.periodData), 'Analytics periodData missing')

  const movements = record('movement search', await request(state, 'GET', `/api/inventory/movements?page=1&pageSize=20&search=${encodeURIComponent(seed)}`))
  assert(Array.isArray(movements.items) && movements.items.length > 0, 'Movement search returned no smoke records')
  assert(movements.items.some((item) => String(item.created_at || '').trim()), 'Movement search is still returning blank dates')
  assert(!movements.items.some((item) => String(item.product_name || '').trim().toLowerCase() === 'undefined'), 'Movement search still returns undefined product names')

  const inventorySearchAfter = record('inventory grouped search after return', await request(state, 'GET', `/api/inventory/products/search?query=${encodeURIComponent(seed)}&group=1&page=1&pageSize=20`))
  const firstVariant = (inventorySearchAfter.items || []).find((item) => Number(item.id) === Number(variantA.id))
  assert(firstVariant, 'Variant A missing from post-return inventory search')
  assert(Number(firstVariant.stock_quantity || 0) >= 9, 'Variant A stock did not restore after return')

  const stats = record('filtered inventory stats', await request(state, 'GET', `/api/inventory/stats?query=${encodeURIComponent(seed)}&group=1`))
  assert(Number(stats?.item?.total_products || 0) >= 2, 'Filtered inventory stats did not include the smoke products')

  const history = record('action history', await request(state, 'GET', '/api/action-history?scope=global&limit=10'))
  const historyLabels = (history.items || []).map((item) => String(item.label || ''))
  assert(historyLabels.some((label) => label.includes('Create product') && label.includes(seed)), 'Action history missing product creation entry')
  assert(historyLabels.some((label) => label.includes('Add stock') && label.includes(seed)), 'Action history missing inventory adjustment entry')
  assert(historyLabels.some((label) => label.includes('Create sale')), 'Action history missing sale entry')
  assert(historyLabels.some((label) => label.includes('Create return')), 'Action history missing return entry')

  const tmpCsv = path.join(os.tmpdir(), `business-os-live-smoke-${Date.now()}.csv`)
  await fs.writeFile(tmpCsv, 'name,category,brand,unit,selling_price_usd,purchase_price_usd,stock_quantity\n' +
    `"${seed} Imported",Smoke,Smoke,pcs,7,3,1\n`, 'utf8')
  const createJob = record('create import job', await request(state, 'POST', '/api/import-jobs', { type: 'products' }))
  const importJobId = createJob?.job?.id || createJob?.id
  assert(importJobId, 'Import job id missing from create response')
  const formData = new FormData()
  formData.append('file', new Blob([await fs.readFile(tmpCsv)], { type: 'text/csv' }), path.basename(tmpCsv))
  record('upload import csv', await request(state, 'POST', `/api/import-jobs/${importJobId}/csv`, formData))
  record('start import job', await request(state, 'POST', `/api/import-jobs/${importJobId}/start`, { decision: 'create' }))
  let jobState = null
  const approvalDeadline = Date.now() + 15_000
  while (Date.now() < approvalDeadline) {
    jobState = record('poll import job', await request(state, 'GET', `/api/import-jobs/${importJobId}`))
    if (jobState.job?.status === 'awaiting_review') break
    if (['failed', 'completed', 'cancelled'].includes(String(jobState.job?.status || '').toLowerCase())) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (jobState?.job?.status === 'awaiting_review') {
    record('approve import job', await request(state, 'POST', `/api/import-jobs/${importJobId}/approve`, {}))
  }
  const completeDeadline = Date.now() + 20_000
  while (Date.now() < completeDeadline) {
    jobState = record('poll import completion', await request(state, 'GET', `/api/import-jobs/${importJobId}`))
    if (String(jobState.job?.status || '').toLowerCase() === 'completed') break
    if (String(jobState.job?.status || '').toLowerCase() === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  assert(String(jobState?.job?.status || '').toLowerCase() === 'completed', `Import job did not complete successfully (status=${jobState?.job?.status || 'unknown'})`)
  await fs.rm(tmpCsv, { force: true })

  const importSearch = record('search imported product', await request(state, 'GET', `/api/products/search?query=${encodeURIComponent(`${seed} Imported`)}&page=1&pageSize=10`))
  assert(Number(importSearch.total || 0) >= 1, 'Imported smoke product was not searchable after job completion')

  const report = {
    baseUrl: BASE_URL,
    health: {
      frontendHash: health?.runtime?.frontend?.hash || null,
      sourceHash: health?.runtime?.sourceHash || null,
    },
    smokeSeed: seed,
    artifacts: {
      parentId: parent.id,
      variantAId: variantA.id,
      variantBId: variantB.id,
      saleId: createdSaleId,
      returnId: customerReturn.id,
      importJobId,
    },
    timings,
    dashboard: {
      todayCount: dashboard.today_count,
      allTotal: dashboard.all_total,
    },
  }
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
