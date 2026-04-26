'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { spawn, spawnSync } = require('child_process')

const BACKEND_DIR = path.resolve(__dirname, '..')
const SERVER_ENTRY = path.join(BACKEND_DIR, 'server.js')
const PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2p6xQAAAAASUVORK5CYII=',
  'base64',
)

let failed = 0

function runTest(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`)
    })
    .catch((error) => {
      failed += 1
      console.error(`FAIL ${name}`)
      console.error(error)
    })
    .finally(() => {
      if (pendingTests.delete(name) && pendingTests.size === 0 && failed > 0) {
        process.exitCode = 1
      }
    })
}

const pendingTests = new Set()

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = server.address()?.port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
    server.on('error', reject)
  })
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Server did not become healthy at ${baseUrl}`)
}

async function startServer(runtimeDir) {
  const port = await getFreePort()
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      BUSINESS_OS_RUNTIME_DIR: runtimeDir,
      SYNC_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  const baseUrl = `http://127.0.0.1:${port}`
  await waitForHealth(baseUrl)
  return { child, baseUrl, port }
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
  if (exited) return
  spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
}

async function fetchJson(baseUrl, pathname, options = {}) {
  const headers = {
    ...(options.headers || {}),
  }
  if (options.authToken) headers['x-auth-session'] = options.authToken
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers })
  const text = await response.text()
  const json = text ? JSON.parse(text) : {}
  if (!response.ok || json?.success === false) {
    throw new Error(json?.error || `Request failed: ${response.status}`)
  }
  return json
}

async function loginAsAdmin(baseUrl) {
  const result = await fetchJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: 'admin',
      sessionDuration: 'session',
      clientTime: new Date().toISOString(),
      deviceTz: 'UTC',
      deviceName: 'QA Browser',
    }),
  })
  assert.ok(result?.authToken, 'Expected auth token from admin login')
  return result.authToken
}

async function uploadPortalLogo(baseUrl, authToken) {
  const form = new FormData()
  form.append('file', new Blob([PNG_BUFFER], { type: 'image/png' }), 'portal-logo.png')
  form.append('userId', '1')
  form.append('userName', 'QA')
  form.append('deviceName', 'QA Browser')
  form.append('deviceTz', 'UTC')
  form.append('clientTime', new Date().toISOString())
  return fetchJson(baseUrl, '/api/files/upload', { method: 'POST', body: form, authToken })
}

async function seedSourceServer(baseUrl) {
  const authToken = await loginAsAdmin(baseUrl)
  const branches = await fetchJson(baseUrl, '/api/branches', { authToken })
  const branch = Array.isArray(branches) ? branches.find((item) => item.is_default) || branches[0] : null
  assert.ok(branch?.id, 'Expected an active default branch')

  const product = await fetchJson(baseUrl, '/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    authToken,
    body: JSON.stringify({
      name: 'Roundtrip Product',
      sku: 'RT-001',
      stock_quantity: 5,
      branch_id: branch.id,
      selling_price_usd: 12,
      purchase_price_usd: 7,
      userId: 1,
      userName: 'QA',
    }),
  })

  const customer = await fetchJson(baseUrl, '/api/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    authToken,
    body: JSON.stringify({
      name: 'Roundtrip Customer',
      membership_number: 'MEM-001',
      phone: '012345678',
      userId: 1,
      userName: 'QA',
    }),
  })

  const sale = await fetchJson(baseUrl, '/api/sales', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    authToken,
    body: JSON.stringify({
      cashier_id: 1,
      cashier_name: 'QA',
      customer_id: customer.id,
      customer_name: 'Roundtrip Customer',
      branch_id: branch.id,
      subtotal_usd: 12,
      total_usd: 12,
      amount_paid_usd: 12,
      payment_method: 'Cash',
      payment_currency: 'USD',
      exchange_rate: 4100,
      items: [
        {
          id: product.id,
          name: 'Roundtrip Product',
          quantity: 1,
          applied_price_usd: 12,
          branch_id: branch.id,
        },
      ],
    }),
  })

  const upload = await uploadPortalLogo(baseUrl, authToken)

  await fetchJson(baseUrl, '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    authToken,
    body: JSON.stringify({
      business_name: 'Roundtrip Business',
      customer_portal_logo_image: upload.public_path,
      customer_portal_google_maps_embed: 'https://maps.google.com/?q=Phnom+Penh',
      customer_portal_public_url: 'https://customers.example.com',
    }),
  })

  const customTable = await fetchJson(baseUrl, '/api/custom-tables', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    authToken,
    body: JSON.stringify({
      name: 'qa_notes',
      display_name: 'QA Notes',
      schema: [
        { name: 'status', type: 'text' },
        { name: 'count', type: 'number' },
      ],
    }),
  })

  await fetchJson(baseUrl, `/api/custom-tables/${customTable.name}/rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    authToken,
    body: JSON.stringify({
      data: {
        status: 'ready',
        count: 3,
      },
    }),
  })

  return { authToken, productId: product.id, customerId: customer.id, saleId: sale.id, uploadPath: upload.public_path, customTableName: customTable.name }
}

async function exportBackup(baseUrl, authToken) {
  const response = await fetch(`${baseUrl}/api/system/backup/export`, {
    headers: { 'x-auth-session': authToken },
  })
  assert.equal(response.ok, true, 'Backup export failed')
  return JSON.parse(await response.text())
}

async function assertRoundtripState(baseUrl, expected, authToken) {
  const products = await fetchJson(baseUrl, '/api/products', { authToken })
  const customers = await fetchJson(baseUrl, '/api/customers', { authToken })
  const settings = await fetchJson(baseUrl, '/api/settings', { authToken })
  const filesResponse = await fetchJson(baseUrl, '/api/files', { authToken })
  const customTables = await fetchJson(baseUrl, '/api/custom-tables', { authToken })
  const auditLogs = await fetchJson(baseUrl, '/api/system/audit-logs', { authToken })

  const files = Array.isArray(filesResponse?.items) ? filesResponse.items : []
  const qaTable = Array.isArray(customTables) ? customTables.find((row) => row.name === expected.customTableName) : null
  assert.ok(qaTable, 'Expected custom table metadata after import')

  const qaRows = await fetchJson(baseUrl, `/api/custom-tables/${expected.customTableName}/data`, { authToken })
  const uploadedFile = files.find((item) => item.public_path === expected.uploadPath)

  assert.equal(Array.isArray(products), true)
  assert.equal(Array.isArray(customers), true)
  assert.ok(products.some((row) => row.name === 'Roundtrip Product'))
  assert.ok(customers.some((row) => row.membership_number === 'MEM-001'))
  assert.equal(settings.business_name, 'Roundtrip Business')
  assert.equal(settings.customer_portal_logo_image, expected.uploadPath)
  assert.equal(settings.customer_portal_google_maps_embed, 'https://maps.google.com/?q=Phnom+Penh')
  assert.ok(uploadedFile, 'Expected uploaded file metadata after import')
  assert.ok(Array.isArray(qaRows) && qaRows.some((row) => row.status === 'ready'), 'Expected custom table row after import')
  assert.ok(Array.isArray(auditLogs) && auditLogs.some((row) => row.action === 'upload' && row.table_name === 'file_asset'), 'Expected audit log upload row after import')

  const uploadResponse = await fetch(`${baseUrl}${expected.uploadPath}`)
  assert.equal(uploadResponse.ok, true, 'Expected uploaded file to be served after import')
  assert.equal((await uploadResponse.arrayBuffer()).byteLength > 0, true)
}

pendingTests.add('backup export/import roundtrip keeps current data, uploads, custom tables, settings, and audit rows')
runTest('backup export/import roundtrip keeps current data, uploads, custom tables, settings, and audit rows', async () => {
  const sourceRuntime = makeTempRoot('bos-backup-source-')
  const targetRuntime = makeTempRoot('bos-backup-target-')

  let sourceServer = null
  let targetServer = null

  try {
    sourceServer = await startServer(sourceRuntime)
    const seeded = await seedSourceServer(sourceServer.baseUrl)
    const backup = await exportBackup(sourceServer.baseUrl, seeded.authToken)

    assert.equal(Number(backup?.summary?.tables?.products || 0) >= 1, true)
    assert.equal(Number(backup?.summary?.tables?.sales || 0) >= 1, true)
    assert.equal(Number(backup?.summary?.tables?.file_assets || 0) >= 1, true)
    assert.equal(Number(backup?.summary?.tables?.audit_logs || 0) >= 1, true)
    assert.equal(Number(backup?.summary?.totals?.uploadCount || 0) >= 1, true)

    targetServer = await startServer(targetRuntime)
    const targetAuthToken = await loginAsAdmin(targetServer.baseUrl)
    await fetchJson(targetServer.baseUrl, '/api/system/backup/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken: targetAuthToken,
      body: JSON.stringify(backup),
    })

    const refreshedTargetAuthToken = await loginAsAdmin(targetServer.baseUrl)
    await assertRoundtripState(targetServer.baseUrl, seeded, refreshedTargetAuthToken)
  } finally {
    await stopServer(sourceServer?.child)
    await stopServer(targetServer?.child)
  }
})
