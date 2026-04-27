'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { spawn, spawnSync } = require('child_process')

const BACKEND_DIR = path.resolve(__dirname, '..')
const SERVER_ENTRY = path.join(BACKEND_DIR, 'server.js')

let failed = 0
const pendingTests = new Set()

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
  return { child, baseUrl }
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

async function getDefaultBranch(baseUrl, authToken) {
  const branches = await fetchJson(baseUrl, '/api/branches', { authToken })
  const branch = Array.isArray(branches) ? branches.find((item) => item.is_default) || branches[0] : null
  assert.ok(branch?.id, 'Expected an active default branch')
  return branch
}

async function createProduct(baseUrl, authToken, branchId, overrides = {}) {
  const payload = {
    name: overrides.name || `Stock Test ${Date.now()}`,
    sku: overrides.sku || `STK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    stock_quantity: overrides.stock_quantity ?? 0,
    branch_id: branchId,
    selling_price_usd: overrides.selling_price_usd ?? 12,
    purchase_price_usd: overrides.purchase_price_usd ?? 7,
    userId: 1,
    userName: 'QA',
    ...overrides,
  }
  const created = await fetchJson(baseUrl, '/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    authToken,
    body: JSON.stringify(payload),
  })
  return created.id
}

async function getProduct(baseUrl, authToken, productId) {
  const products = await fetchJson(baseUrl, '/api/products', { authToken })
  const product = Array.isArray(products) ? products.find((row) => row.id === productId) : null
  assert.ok(product, `Expected product ${productId}`)
  return product
}

function sumBranchStock(product) {
  return (product.branch_stock || []).reduce((sum, row) => sum + (Number(row.quantity) || 0), 0)
}

pendingTests.add('customer return keeps aggregate stock equal to branch stock and marks sale returned')
runTest('customer return keeps aggregate stock equal to branch stock and marks sale returned', async () => {
  const runtimeDir = makeTempRoot('bos-stock-customer-return-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)
    const branch = await getDefaultBranch(server.baseUrl, authToken)
    const productId = await createProduct(server.baseUrl, authToken, branch.id, {
      name: 'Customer Return Stock Product',
      sku: 'CRT-001',
      stock_quantity: 5,
      purchase_price_usd: 4,
      selling_price_usd: 10,
    })

    const customer = await fetchJson(server.baseUrl, '/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        name: 'Stock Return Customer',
        membership_number: 'STOCK-RET-001',
      }),
    })

    const sale = await fetchJson(server.baseUrl, '/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        customer_id: customer.id,
        customer_name: 'Stock Return Customer',
        branch_id: branch.id,
        subtotal_usd: 20,
        total_usd: 20,
        amount_paid_usd: 20,
        payment_method: 'Cash',
        payment_currency: 'USD',
        exchange_rate: 4100,
        items: [
          {
            id: productId,
            name: 'Customer Return Stock Product',
            quantity: 2,
            applied_price_usd: 10,
            branch_id: branch.id,
          },
        ],
      }),
    })

    let product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 3)
    assert.equal(sumBranchStock(product), 3)
    const branchRowAfterSale = (product.branch_stock || []).find((row) => row.branch_id === branch.id)
    assert.equal(Number(branchRowAfterSale?.quantity || 0), 3)

    await fetchJson(server.baseUrl, '/api/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        sale_id: sale.id,
        branch_id: branch.id,
        reason: 'Customer changed mind',
        total_refund_usd: 20,
        items: [
          {
            product_id: productId,
            product_name: 'Customer Return Stock Product',
            quantity: 2,
            applied_price_usd: 10,
            branch_id: branch.id,
            return_to_stock: true,
          },
        ],
      }),
    })

    product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 5)
    assert.equal(sumBranchStock(product), 5)
    const branchRowAfterReturn = (product.branch_stock || []).find((row) => row.branch_id === branch.id)
    assert.equal(Number(branchRowAfterReturn?.quantity || 0), 5)

    const sales = await fetchJson(server.baseUrl, '/api/sales?limit=20', { authToken })
    const saleDetails = Array.isArray(sales) ? sales.find((row) => row.id === sale.id) : null
    assert.ok(saleDetails, 'Expected returned sale in sales list')
    assert.equal(saleDetails.sale_status, 'returned')
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('supplier return keeps aggregate stock equal to branch stock after deduction')
runTest('supplier return keeps aggregate stock equal to branch stock after deduction', async () => {
  const runtimeDir = makeTempRoot('bos-stock-supplier-return-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)
    const branch = await getDefaultBranch(server.baseUrl, authToken)
    const productId = await createProduct(server.baseUrl, authToken, branch.id, {
      name: 'Supplier Return Stock Product',
      sku: 'SRT-001',
      stock_quantity: 9,
      purchase_price_usd: 5,
      selling_price_usd: 11,
    })

    await fetchJson(server.baseUrl, '/api/returns/supplier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        branch_id: branch.id,
        supplier_name: 'QA Supplier',
        reason: 'Damaged batch',
        settlement: 'refund',
        items: [
          {
            product_id: productId,
            product_name: 'Supplier Return Stock Product',
            quantity: 4,
            cost_price_usd: 5,
            cost_price_khr: 20500,
            branch_id: branch.id,
          },
        ],
      }),
    })

    const product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 5)
    assert.equal(sumBranchStock(product), 5)
    const branchRow = (product.branch_stock || []).find((row) => row.branch_id === branch.id)
    assert.equal(Number(branchRow?.quantity || 0), 5)
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('bulk import override_replace with zero stock clears branch stock and aggregate stock together')
runTest('bulk import override_replace with zero stock clears branch stock and aggregate stock together', async () => {
  const runtimeDir = makeTempRoot('bos-stock-import-replace-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)
    const branch = await getDefaultBranch(server.baseUrl, authToken)
    const productId = await createProduct(server.baseUrl, authToken, branch.id, {
      name: 'CSV Replace Stock Product',
      sku: 'CSV-001',
      stock_quantity: 8,
      purchase_price_usd: 6,
      selling_price_usd: 13,
    })

    await fetchJson(server.baseUrl, '/api/products/bulk-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        products: [
          {
            _action: 'override_replace',
            name: 'CSV Replace Stock Product',
            sku: 'CSV-001',
            branch: branch.name,
            stock_quantity: 0,
            purchase_price_usd: 6,
            selling_price_usd: 13,
          },
        ],
      }),
    })

    const product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 0)
    assert.equal(sumBranchStock(product), 0)
    const branchRow = (product.branch_stock || []).find((row) => row.branch_id === branch.id)
    assert.equal(Number(branchRow?.quantity || 0), 0)
  } finally {
    await stopServer(server?.child)
  }
})
