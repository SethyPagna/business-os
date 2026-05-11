/* eslint-disable no-console */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { FULL_AUDIT_ROUTES } from './audit-manifest.mjs'
import { loginWithFetch } from './audit-auth.mjs'
import { writeFullAuditHtmlReport } from './audit-report-html.mjs'

const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const REPORT_DIR = process.env.BOS_AUDIT_REPORT_DIR
  ? path.resolve(process.env.BOS_AUDIT_REPORT_DIR)
  : path.join(ROOT_DIR, 'ops/runtime/reports', `full-app-audit-${TIMESTAMP}`)
const SMOKE_PREFIX = process.env.BOS_AUDIT_PREFIX || `QA Audit ${Date.now()}`
const REQUEST_TIMEOUT_MS = Number(process.env.BOS_AUDIT_REQUEST_TIMEOUT_MS || 45_000)
const JOB_TIMEOUT_MS = Number(process.env.BOS_AUDIT_JOB_TIMEOUT_MS || 60_000)

const ROUTES = FULL_AUDIT_ROUTES

const summary = {
  audit: {
    baseUrl: BASE_URL,
    reportDir: REPORT_DIR,
    smokePrefix: SMOKE_PREFIX,
    startedAt: new Date().toISOString(),
  },
  health: {},
  routes: [],
  api: [],
  writeFlows: {},
  findings: [],
  artifacts: {},
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pushFinding(priority, area, message, extra = {}) {
  summary.findings.push({
    priority,
    area,
    message,
    ...extra,
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isJsonResponse(response) {
  return String(response.headers.get('content-type') || '').toLowerCase().includes('application/json')
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function request(state, method, pathname, body = null, extraHeaders = {}, options = {}) {
  const started = performance.now()
  const headers = {
    ...(state?.cookie ? { cookie: state.cookie } : {}),
    ...extraHeaders,
  }
  if (body != null && !(body instanceof FormData) && !headers['content-type']) {
    headers['content-type'] = 'application/json'
  }
  let response
  let payload
  try {
    response = await fetchWithTimeout(`${BASE_URL}${pathname}`, {
      method,
      headers,
      body: body == null
        ? undefined
        : (body instanceof FormData ? body : JSON.stringify(body)),
    }, options.timeoutMs || REQUEST_TIMEOUT_MS)
    payload = isJsonResponse(response)
      ? await response.json()
      : await response.text()
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Math.round(performance.now() - started),
      payload: null,
      error: error?.message || String(error),
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    ms: Math.round(performance.now() - started),
    payload,
  }
}

function recordApi(name, result, critical = true) {
  const entry = {
    name,
    status: result.status,
    ok: !!result.ok,
    ms: result.ms,
    error: result.error || (result.ok ? '' : String(result.payload?.error || result.payload || 'Request failed').slice(0, 300)),
  }
  summary.api.push(entry)
  if (!result.ok && critical) {
    throw new Error(`${name} failed (${result.status}): ${entry.error}`)
  }
  if (!result.ok) {
    pushFinding(2, 'api', `${name} returned ${result.status}`, entry)
  }
  return result.payload
}

async function login() {
  const started = performance.now()
  const session = await loginWithFetch({
    baseUrl: BASE_URL,
    username: USERNAME,
    password: PASSWORD,
    timeoutMs: REQUEST_TIMEOUT_MS,
  })
  const ms = Math.round(performance.now() - started)
  summary.api.push({ name: 'auth login', status: session.response.status, ok: session.response.ok, ms })
  return { cookie: session.cookieHeader }
}

async function captureHealth(state, phase) {
  const response = await request(state, 'GET', '/health')
  const health = recordApi(`health ${phase}`, response)
  assert(health.status === 'ok', `Health check is not ok during ${phase}`)
  summary.health[phase] = {
    status: health.status,
    frontendHash: health?.runtime?.frontend?.hash || null,
    frontendBuiltAt: health?.runtime?.frontend?.builtAt || null,
    sourceHash: health?.runtime?.sourceHash || null,
    drivers: health?.drivers || {},
  }
  return health
}

async function auditHtmlRoutes(state, health) {
  const serverHash = health?.runtime?.frontend?.hash || ''
  for (const route of ROUTES) {
    const started = performance.now()
    const urlPath = route.path === '/'
      ? `/?__bos_server_build=${encodeURIComponent(serverHash)}&__bos_audit=${Date.now()}`
      : `${route.path}?__bos_server_build=${encodeURIComponent(serverHash)}&__bos_audit=${Date.now()}`
    const result = await request(state, 'GET', urlPath, null, {}, { timeoutMs: REQUEST_TIMEOUT_MS })
    const html = typeof result.payload === 'string' ? result.payload : ''
    const entry = {
      name: route.name,
      path: route.path,
      status: result.status,
      ok: !!result.ok,
      ms: Math.round(performance.now() - started),
      containsAppRoot: html.includes('id="root"') || html.includes('id="app"'),
      containsServerHash: serverHash ? html.includes(serverHash) : null,
      error: result.error || '',
    }
    summary.routes.push(entry)
    if (!entry.ok) throw new Error(`Route ${route.name} failed (${entry.status})`)
    if (!entry.containsAppRoot) {
      pushFinding(1, 'route', `Route ${route.name} did not return an app shell root`, entry)
    }
  }
}

async function auditReadEndpoints(state) {
  for (const route of ROUTES) {
    for (const endpoint of route.api) {
      const payload = recordApi(`${route.name} ${endpoint}`, await request(state, 'GET', endpoint))
      if (endpoint.includes('/api/dashboard')) {
        assert(payload && typeof payload === 'object', 'Dashboard returned no object payload')
        assert(Object.keys(payload).length >= 3, 'Dashboard summary returned incomplete data')
      }
      if (endpoint.includes('/api/inventory/movements')) {
        const rows = Array.isArray(payload?.items) ? payload.items : []
        if (rows.length) {
          if (rows.some((row) => !String(row.created_at || row.date || '').trim())) {
            pushFinding(1, 'inventory', 'Inventory movements include blank dates', { endpoint })
          }
          if (rows.some((row) => String(row.product_name || '').trim().toLowerCase() === 'undefined')) {
            pushFinding(1, 'inventory', 'Inventory movements include undefined product names', { endpoint })
          }
        }
      }
      if (endpoint.includes('/api/system/drive-sync/status')) {
        const item = payload?.item || {}
        if (Number(item.syncIntervalSeconds || 0) !== 21_600) {
          pushFinding(2, 'backup', 'Google Drive sync interval is not the requested 6 hours', {
            currentSeconds: Number(item.syncIntervalSeconds || 0),
            expectedSeconds: 21_600,
          })
        }
      }
    }
  }
  const analytics = recordApi('dashboard analytics', await request(state, 'GET', '/api/analytics?startDate=2026-05-01&endDate=2026-05-07&granularity=day'))
  assert(Array.isArray(analytics.periodData), 'Analytics periodData missing')
}

async function getActiveBranches(state) {
  const branches = recordApi('branches for write flow', await request(state, 'GET', '/api/branches'))
  const activeBranches = (Array.isArray(branches) ? branches : []).filter((branch) => Number(branch?.is_active ?? 1) === 1)
  const branchId = Number(activeBranches?.[0]?.id || 0)
  const secondaryBranchId = Number(activeBranches?.[1]?.id || 0)
  assert(branchId > 0, 'No active branch found')
  return { branchId, secondaryBranchId }
}

async function runFefoWriteFlow(state) {
  const { branchId, secondaryBranchId } = await getActiveBranches(state)
  const seed = SMOKE_PREFIX
  const artifacts = {}
  const parent = recordApi('create product family', await request(state, 'POST', '/api/products', {
    name: `${seed} Family`,
    category: 'QA Audit',
    brand: 'QA Audit',
    unit: 'pcs',
    is_group: 1,
    stock_quantity: 0,
    branch_id: branchId,
  }))
  artifacts.parentId = parent.id

  const barcodeSeed = Date.now()
  const variantA = recordApi('create variant A', await request(state, 'POST', '/api/products/variant', {
    parent_id: parent.id,
    name: `${seed} Variant A`,
    category: 'QA Audit',
    brand: 'QA Audit',
    unit: 'pcs',
    barcode: `QA${barcodeSeed}A`,
    stock_quantity: 0,
    branch_id: branchId,
    selling_price_usd: 9,
    purchase_price_usd: 4,
  }))
  const variantB = recordApi('create variant B', await request(state, 'POST', '/api/products/variant', {
    parent_id: parent.id,
    name: `${seed} Variant B`,
    category: 'QA Audit',
    brand: 'QA Audit',
    unit: 'pcs',
    barcode: `QA${barcodeSeed}B`,
    stock_quantity: 0,
    branch_id: branchId,
    selling_price_usd: 12,
    purchase_price_usd: 5,
  }))
  artifacts.variantAId = variantA.id
  artifacts.variantBId = variantB.id

  for (const batch of [
    ['batch A early', variantA.id, 5, 'LOT-A1', '2026-10-01'],
    ['batch A late', variantA.id, 4, 'LOT-A2', '2026-12-15'],
    ['batch B', variantB.id, 3, 'LOT-B1', '2027-01-10'],
  ]) {
    const [label, productId, quantity, lotCode, expiryDate] = batch
    recordApi(label, await request(state, 'POST', '/api/inventory/adjust', {
      productId,
      type: 'add',
      quantity,
      branchId,
      reason: `${seed} ${label}`,
      lotCode,
      expiryDate,
    }))
  }

  const before = recordApi('inventory grouped search before sale', await request(state, 'GET', `/api/inventory/products/search?query=${encodeURIComponent(seed)}&group=1&page=1&pageSize=20`))
  assert(Number(before.total || 0) >= 2, 'Inventory grouped search did not return audit variants')

  const sale = recordApi('create FEFO sale', await request(state, 'POST', '/api/sales', {
    branch_id: branchId,
    sale_status: 'completed',
    payment_method: 'Cash',
    payment_currency: 'USD',
    subtotal_usd: 24,
    total_usd: 24,
    items: [{
      product_id: variantA.id,
      name: `${seed} Variant A`,
      quantity: 6,
      applied_price_usd: 4,
    }],
  }))
  artifacts.saleReceipt = sale.receiptNumber || ''

  const saleRows = recordApi('sales search after sale', await request(state, 'GET', `/api/sales?page=1&pageSize=20&search=${encodeURIComponent(sale.receiptNumber || seed)}`))
  const saleList = Array.isArray(saleRows) ? saleRows : (saleRows.items || [])
  const createdSale = saleList[0]
  const createdSaleId = Number(createdSale?.id || sale.id || 0)
  assert(createdSaleId > 0, 'Created sale was not searchable')
  assert(Array.isArray(createdSale?.items) && createdSale.items.length > 0, 'Created sale detail items missing')
  const createdSaleItemId = Number(createdSale.items[0]?.id || 0)
  assert(createdSaleItemId > 0, 'Created sale item id missing')
  artifacts.saleId = createdSaleId

  const customerReturn = recordApi('create return to original allocation', await request(state, 'POST', '/api/returns', {
    sale_id: createdSaleId,
    branch_id: branchId,
    reason: `${seed} customer return`,
    total_refund_usd: 24,
    items: [{
      sale_item_id: createdSaleItemId,
      product_id: variantA.id,
      product_name: `${seed} Variant A`,
      quantity: 6,
      total_usd: 24,
      return_to_stock: 1,
    }],
  }))
  artifacts.returnId = customerReturn.id

  if (secondaryBranchId > 0 && secondaryBranchId !== branchId) {
    const transfer = recordApi('transfer batch-backed stock', await request(state, 'POST', '/api/inventory/transfer', {
      productId: variantB.id,
      fromBranchId: branchId,
      toBranchId: secondaryBranchId,
      quantity: 1,
      reason: `${seed} transfer`,
    }))
    artifacts.transferId = transfer.transferId || transfer.id || null
  } else {
    pushFinding(3, 'inventory', 'Transfer branch sync check skipped because only one active branch is available')
  }

  const postInventory = recordApi('inventory grouped search after return', await request(state, 'GET', `/api/inventory/products/search?query=${encodeURIComponent(seed)}&group=1&page=1&pageSize=20`))
  const restored = (postInventory.items || []).find((item) => Number(item.id) === Number(variantA.id))
  assert(restored, 'Variant A missing from post-return inventory search')
  assert(Number(restored.stock_quantity || 0) >= 9, 'Returned quantity did not restore variant stock')

  const productSearch = recordApi('products search after product create', await request(state, 'GET', `/api/products/search?query=${encodeURIComponent(seed)}&page=1&pageSize=20&include=branch_stock,images,batches,family`))
  assert(Number(productSearch.total || 0) >= 2, 'Products search did not include audit variants')

  const posSearch = recordApi('POS variant search after stock changes', await request(state, 'GET', `/api/products/search?query=${encodeURIComponent(seed)}&page=1&pageSize=20&include=branch_stock,images,batches,family`))
  assert((posSearch.items || []).some((item) => Number(item.id) === Number(variantA.id)), 'POS search surface did not include audit variant')

  const movements = recordApi('movement search after flow', await request(state, 'GET', `/api/inventory/movements?page=1&pageSize=20&search=${encodeURIComponent(seed)}`))
  assert(Array.isArray(movements.items) && movements.items.length >= 3, 'Movement search returned too few audit records')
  assert(movements.items.every((item) => String(item.created_at || item.date || '').trim()), 'Movement search returned blank dates')
  assert(!movements.items.some((item) => String(item.product_name || '').trim().toLowerCase() === 'undefined'), 'Movement search returned undefined product names')

  const stats = recordApi('filtered inventory stats after flow', await request(state, 'GET', `/api/inventory/stats?query=${encodeURIComponent(seed)}&group=1`))
  assert(Number(stats?.item?.total_products || 0) >= 2, 'Filtered inventory stats did not include audit products')

  const dashboard = recordApi('dashboard after write flow', await request(state, 'GET', '/api/dashboard'))
  assert(dashboard && Object.keys(dashboard).length >= 3, 'Dashboard summary returned incomplete data after write flow')

  const analytics = recordApi('analytics after write flow', await request(state, 'GET', '/api/analytics?startDate=2026-05-01&endDate=2026-05-07&granularity=day'))
  assert(Array.isArray(analytics.periodData), 'Analytics periodData missing after write flow')

  const history = recordApi('action history after write flow', await request(state, 'GET', '/api/action-history?scope=global&limit=10&all=1'))
  const historyLabels = (history.items || []).map((item) => String(item.label || ''))
  assert(historyLabels.some((label) => label.includes('Create product') && label.includes(seed)), 'Action history missing product creation entry')
  assert(historyLabels.some((label) => label.includes('Add stock') && label.includes(seed)), 'Action history missing stock add entry')
  assert(historyLabels.some((label) => label.includes('Create sale')), 'Action history missing sale entry')
  assert(historyLabels.some((label) => label.includes('Create return')), 'Action history missing return entry')

  summary.writeFlows.fefo = { ok: true, ...artifacts }
  summary.artifacts = { ...summary.artifacts, ...artifacts }
  return { branchId, variantA, variantB, seed, artifacts }
}

async function runImportFlow(state, seed) {
  const tmpCsv = path.join(os.tmpdir(), `business-os-full-audit-${Date.now()}.csv`)
  const importedName = `${seed} Imported`
  const barcode = `QAIMP${Date.now()}`
  await fs.writeFile(tmpCsv, [
    'name,category,brand,unit,barcode,selling_price_usd,purchase_price_usd,stock_quantity,lot_code,expiry_date',
    `"${importedName}",QA Audit,QA Audit,pcs,${barcode},7,3,2,LOT-IMPORT-A,2027-03-01`,
    `"${importedName}",QA Audit,QA Audit,pcs,${barcode},7,3,1,LOT-IMPORT-A,2027-03-01`,
  ].join('\n'), 'utf8')
  try {
    const createJob = recordApi('create import job', await request(state, 'POST', '/api/import-jobs', { type: 'products' }))
    const importJobId = createJob?.job?.id || createJob?.id
    assert(importJobId, 'Import job id missing from create response')
    const formData = new FormData()
    formData.append('file', new Blob([await fs.readFile(tmpCsv)], { type: 'text/csv' }), path.basename(tmpCsv))
    recordApi('upload import csv', await request(state, 'POST', `/api/import-jobs/${importJobId}/csv`, formData, {}, { timeoutMs: 60_000 }))
    recordApi('start import job', await request(state, 'POST', `/api/import-jobs/${importJobId}/start`, { decision: 'create' }))

    let jobState = null
    const reviewDeadline = Date.now() + JOB_TIMEOUT_MS
    while (Date.now() < reviewDeadline) {
      jobState = recordApi('poll import review/completion', await request(state, 'GET', `/api/import-jobs/${importJobId}`))
      const status = String(jobState.job?.status || '').toLowerCase()
      if (status === 'awaiting_review' || status === 'completed' || status === 'failed' || status === 'cancelled') break
      await wait(500)
    }
    if (String(jobState?.job?.status || '').toLowerCase() === 'awaiting_review') {
      recordApi('approve import job', await request(state, 'POST', `/api/import-jobs/${importJobId}/approve`, {}))
    }
    const completeDeadline = Date.now() + JOB_TIMEOUT_MS
    while (Date.now() < completeDeadline) {
      jobState = recordApi('poll import completion', await request(state, 'GET', `/api/import-jobs/${importJobId}`))
      const status = String(jobState.job?.status || '').toLowerCase()
      if (status === 'completed' || status === 'failed' || status === 'cancelled') break
      await wait(500)
    }
    assert(String(jobState?.job?.status || '').toLowerCase() === 'completed', `Import job did not complete successfully (status=${jobState?.job?.status || 'unknown'})`)

    const importSearch = recordApi('search imported product', await request(state, 'GET', `/api/products/search?query=${encodeURIComponent(importedName)}&page=1&pageSize=10&include=batches,family`))
    assert(Number(importSearch.total || 0) >= 1, 'Imported audit product was not searchable')
    const inventorySearch = recordApi('search imported product in inventory', await request(state, 'GET', `/api/inventory/products/search?query=${encodeURIComponent(importedName)}&group=1&page=1&pageSize=20`))
    assert(Number(inventorySearch.total || 0) >= 1, 'Imported audit product was not visible in inventory')

    summary.writeFlows.import = { ok: true, importJobId, importedName }
    summary.artifacts.importJobId = importJobId
  } finally {
    await fs.rm(tmpCsv, { force: true })
  }
}

function tinyPngBytes() {
  return Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64',
  ))
}

async function runFilesFlow(state, seed) {
  const fileName = `${seed.replace(/[^A-Za-z0-9_-]+/g, '-')}.png`.slice(0, 90)
  const formData = new FormData()
  formData.append('file', new Blob([tinyPngBytes()], { type: 'image/png' }), fileName)
  const uploaded = recordApi('upload audit file asset', await request(state, 'POST', '/api/files/upload', formData, {}, { timeoutMs: 60_000 }))
  assert(Number(uploaded.id || 0) > 0, 'Uploaded file id missing')
  const listed = recordApi('search uploaded file asset', await request(state, 'GET', `/api/files?mediaType=image&search=${encodeURIComponent(fileName)}`))
  assert((listed.items || []).some((item) => Number(item.id) === Number(uploaded.id)), 'Uploaded file did not appear in Library search')
  const deleted = recordApi('delete uploaded file asset', await request(state, 'DELETE', `/api/files/${uploaded.id}`, { expected_updated_at: uploaded.updated_at }))
  assert(Number(deleted.id || 0) === Number(uploaded.id), 'Deleted file response did not match uploaded asset')
  const after = recordApi('verify deleted file asset is gone', await request(state, 'GET', `/api/files?mediaType=image&search=${encodeURIComponent(fileName)}`))
  assert(!(after.items || []).some((item) => Number(item.id) === Number(uploaded.id)), 'Deleted file still appears in Library search')
  summary.writeFlows.files = { ok: true, uploadedId: uploaded.id, fileName }
}

async function runBackupFlow(state) {
  const status = recordApi('drive sync status before queue', await request(state, 'GET', '/api/system/drive-sync/status'))
  const item = status?.item || {}
  const versionsBefore = recordApi('backup versions before queue', await request(state, 'GET', '/api/system/backups/versions?limit=5'))
  const backupJob = recordApi('queue backup export job', await request(state, 'POST', '/api/backups', { type: 'export-folder' }, {}, { timeoutMs: 60_000 }))
  const backupJobId = backupJob.job_id || backupJob.item?.id
  assert(backupJobId, 'Backup job id missing')
  const polled = await pollSystemJob(state, backupJobId, 'backup export')
  assert(['completed', 'running', 'queued'].includes(String(polled?.status || '').toLowerCase()), `Backup job failed with status ${polled?.status || 'unknown'}`)

  let driveJobId = null
  let driveJob = null
  if (item.ready && item.connected) {
    const queued = recordApi('queue Google Drive sync job', await request(state, 'POST', '/api/system/drive-sync/jobs', {}, {}, { timeoutMs: 60_000 }))
    driveJobId = queued.job_id || queued.item?.id
    if (driveJobId) {
      driveJob = await pollSystemJob(state, driveJobId, 'Google Drive sync', { allowLongRunning: true })
      if (!['completed', 'running', 'queued'].includes(String(driveJob?.status || '').toLowerCase())) {
        pushFinding(1, 'backup', `Google Drive sync job ended in ${driveJob?.status || 'unknown'}`, { jobId: driveJobId })
      }
    }
  } else {
    pushFinding(2, 'backup', 'Google Drive sync job skipped because Drive is not connected/ready', { connected: item.connected, ready: item.ready })
  }

  const versionsAfter = recordApi('backup versions after queue', await request(state, 'GET', '/api/system/backups/versions?limit=5'))
  summary.writeFlows.backup = {
    ok: true,
    backupJobId,
    driveJobId,
    backupStatus: polled?.status || '',
    driveStatus: driveJob?.status || '',
    versionsBefore: Array.isArray(versionsBefore.items) ? versionsBefore.items.length : null,
    versionsAfter: Array.isArray(versionsAfter.items) ? versionsAfter.items.length : null,
  }
}

async function pollSystemJob(state, jobId, label, options = {}) {
  const deadline = Date.now() + (options.allowLongRunning ? 20_000 : JOB_TIMEOUT_MS)
  let latest = null
  while (Date.now() < deadline) {
    const payload = recordApi(`poll ${label} job`, await request(state, 'GET', `/api/system/jobs/${encodeURIComponent(jobId)}`))
    latest = payload.item || payload
    const status = String(latest?.status || '').toLowerCase()
    if (['completed', 'failed', 'cancelled'].includes(status)) break
    await wait(750)
  }
  return latest
}

async function auditRemotePublic() {
  const checks = [
    { name: 'remote public website', url: 'https://leangcosmetics.dpdns.org/public', redirect: 'follow' },
    { name: 'remote admin entry', url: 'https://admin.leangcosmetics.dpdns.org/', redirect: 'manual' },
  ]
  for (const check of checks) {
    const started = performance.now()
    try {
      const response = await fetchWithTimeout(check.url, { redirect: check.redirect }, 20_000)
      const entry = {
        name: check.name,
        url: check.url,
        status: response.status,
        ok: check.name.includes('admin') ? [200, 302, 401, 403].includes(response.status) : response.status === 200,
        ms: Math.round(performance.now() - started),
        location: response.headers.get('location') || '',
        finalUrl: response.url || check.url,
      }
      summary.api.push(entry)
      if (!entry.ok) pushFinding(1, 'remote', `${check.name} returned unexpected status ${response.status}`, entry)
    } catch (error) {
      const entry = {
        name: check.name,
        url: check.url,
        status: 0,
        ok: false,
        ms: Math.round(performance.now() - started),
        error: error?.message || String(error),
      }
      summary.api.push(entry)
      pushFinding(1, 'remote', `${check.name} could not be reached`, entry)
    }
  }
}

async function writeSummary() {
  summary.audit.finishedAt = new Date().toISOString()
  summary.audit.durationMs = Math.round(performance.now() - startMs)
  summary.audit.ok = !summary.findings.some((finding) => Number(finding.priority || 0) <= 1)
  summary.artifacts.htmlReport = path.join(REPORT_DIR, 'summary.html')
  await fs.mkdir(REPORT_DIR, { recursive: true })
  await fs.writeFile(path.join(REPORT_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
}

const startMs = performance.now()

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true })
  const state = await login()
  const healthBefore = await captureHealth(state, 'before')
  await auditHtmlRoutes(state, healthBefore)
  await auditReadEndpoints(state)
  const flow = await runFefoWriteFlow(state)
  await runImportFlow(state, flow.seed)
  await runFilesFlow(state, flow.seed)
  await runBackupFlow(state)
  await auditRemotePublic()
  await captureHealth(state, 'after')
  await writeSummary()
  await writeFullAuditHtmlReport({
    reportDir: REPORT_DIR,
    summary,
  })
  console.log(JSON.stringify({
    ok: summary.audit.ok,
    reportDir: REPORT_DIR,
    frontendHash: summary.health.after?.frontendHash || summary.health.before?.frontendHash || null,
    findings: summary.findings,
  }, null, 2))
  if (!summary.audit.ok) {
    process.exitCode = 1
  }
}

main().catch(async (error) => {
  pushFinding(0, 'audit', error?.message || String(error), {
    stack: error?.stack || '',
  })
  await writeSummary().catch(() => {})
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
