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

async function getSale(baseUrl, authToken, saleId) {
  const sales = await fetchJson(baseUrl, '/api/sales?limit=100', { authToken })
  const sale = Array.isArray(sales) ? sales.find((row) => row.id === saleId) : null
  assert.ok(sale, `Expected sale ${saleId}`)
  return sale
}

async function getInventoryMovements(baseUrl, authToken, branchId = null) {
  const suffix = branchId ? `?branchId=${branchId}` : ''
  const rows = await fetchJson(baseUrl, `/api/inventory/movements${suffix}`, { authToken })
  assert.ok(Array.isArray(rows), 'Expected inventory movements list')
  return rows
}

async function getFiles(baseUrl, authToken) {
  const result = await fetchJson(baseUrl, '/api/files', { authToken })
  return Array.isArray(result?.items) ? result.items : []
}

async function getUsers(baseUrl, authToken) {
  const rows = await fetchJson(baseUrl, '/api/users', { authToken })
  assert.ok(Array.isArray(rows), 'Expected users list')
  return rows
}

async function getSettings(baseUrl, authToken) {
  return fetchJson(baseUrl, '/api/settings', { authToken })
}

async function uploadTinyPng(baseUrl, authToken, filename = 'factory-reset-proof.png') {
  const form = new FormData()
  form.append('file', new Blob([PNG_BUFFER], { type: 'image/png' }), filename)
  const result = await fetchJson(baseUrl, '/api/files/upload', {
    method: 'POST',
    body: form,
    authToken,
  })
  return result
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

    const saleDetails = await getSale(server.baseUrl, authToken, sale.id)
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

pendingTests.add('sale status transitions deduct and restore stock only when business status requires it')
runTest('sale status transitions deduct and restore stock only when business status requires it', async () => {
  const runtimeDir = makeTempRoot('bos-stock-sale-status-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)
    const branch = await getDefaultBranch(server.baseUrl, authToken)
    const productId = await createProduct(server.baseUrl, authToken, branch.id, {
      name: 'Awaiting Payment Status Product',
      sku: 'APS-001',
      stock_quantity: 7,
      purchase_price_usd: 3,
      selling_price_usd: 9,
    })

    const sale = await fetchJson(server.baseUrl, '/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        branch_id: branch.id,
        subtotal_usd: 18,
        total_usd: 18,
        amount_paid_usd: 0,
        payment_method: 'Cash',
        payment_currency: 'USD',
        exchange_rate: 4100,
        sale_status: 'awaiting_payment',
        items: [
          {
            id: productId,
            name: 'Awaiting Payment Status Product',
            quantity: 2,
            applied_price_usd: 9,
            branch_id: branch.id,
          },
        ],
      }),
    })

    let product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 7)
    assert.equal(sumBranchStock(product), 7)

    const awaitingPaymentUpdate = await fetchJson(server.baseUrl, `/api/sales/${sale.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        sale_status: 'completed',
      }),
    })
    assert.equal(awaitingPaymentUpdate.sale_status, 'completed')

    product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 5)
    assert.equal(sumBranchStock(product), 5)

    let movements = await getInventoryMovements(server.baseUrl, authToken, branch.id)
    assert.ok(movements.some((row) => row.reference_id === sale.id && row.reason === 'Sale status changed from awaiting_payment to completed'))

    const completedUpdate = await fetchJson(server.baseUrl, `/api/sales/${sale.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        sale_status: 'cancelled',
      }),
    })
    assert.equal(completedUpdate.sale_status, 'cancelled')

    product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 7)
    assert.equal(sumBranchStock(product), 7)

    movements = await getInventoryMovements(server.baseUrl, authToken, branch.id)
    assert.ok(movements.some((row) => row.reference_id === sale.id && row.reason === 'Sale status changed from completed to cancelled'))
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('sales reset clears transactions and stock while keeping products and contacts')
runTest('sales reset clears transactions and stock while keeping products and contacts', async () => {
  const runtimeDir = makeTempRoot('bos-stock-reset-sales-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)
    const branch = await getDefaultBranch(server.baseUrl, authToken)
    const productId = await createProduct(server.baseUrl, authToken, branch.id, {
      name: 'Reset Data Product',
      sku: 'RST-001',
      stock_quantity: 4,
      purchase_price_usd: 2,
      selling_price_usd: 8,
    })

    const customer = await fetchJson(server.baseUrl, '/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        name: 'Reset Customer',
        membership_number: 'RESET-001',
      }),
    })

    await fetchJson(server.baseUrl, '/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        customer_id: customer.id,
        customer_name: 'Reset Customer',
        branch_id: branch.id,
        subtotal_usd: 8,
        total_usd: 8,
        amount_paid_usd: 8,
        payment_method: 'Cash',
        payment_currency: 'USD',
        exchange_rate: 4100,
        items: [
          {
            id: productId,
            name: 'Reset Data Product',
            quantity: 1,
            applied_price_usd: 8,
            branch_id: branch.id,
          },
        ],
      }),
    })

    await fetchJson(server.baseUrl, '/api/system/reset-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        mode: 'sales',
      }),
    })

    const sales = await fetchJson(server.baseUrl, '/api/sales?limit=20', { authToken })
    const returns = await fetchJson(server.baseUrl, '/api/returns?limit=20', { authToken })
    const customers = await fetchJson(server.baseUrl, '/api/customers', { authToken })
    const movements = await getInventoryMovements(server.baseUrl, authToken, branch.id)
    const product = await getProduct(server.baseUrl, authToken, productId)

    assert.equal(Array.isArray(sales) ? sales.length : -1, 0)
    assert.equal(Array.isArray(returns) ? returns.length : -1, 0)
    assert.ok(Array.isArray(customers) && customers.some((row) => row.id === customer.id))
    assert.equal(movements.length, 0)
    assert.equal(Number(product.stock_quantity), 0)
    assert.equal(sumBranchStock(product), 0)
    const branchRow = (product.branch_stock || []).find((row) => row.branch_id === branch.id)
    assert.equal(Number(branchRow?.quantity || 0), 0)
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('inventory adjustments keep branch stock, aggregate stock, and movement logs aligned')
runTest('inventory adjustments keep branch stock, aggregate stock, and movement logs aligned', async () => {
  const runtimeDir = makeTempRoot('bos-stock-adjustments-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)
    const branch = await getDefaultBranch(server.baseUrl, authToken)
    const productId = await createProduct(server.baseUrl, authToken, branch.id, {
      name: 'Inventory Adjustment Product',
      sku: 'ADJ-001',
      stock_quantity: 5,
      purchase_price_usd: 4,
      selling_price_usd: 10,
    })

    await fetchJson(server.baseUrl, '/api/inventory/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        productId,
        productName: 'Inventory Adjustment Product',
        type: 'add',
        quantity: 3,
        reason: 'Restock',
        branchId: branch.id,
        unitCostUsd: 4,
      }),
    })

    let product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 8)
    assert.equal(sumBranchStock(product), 8)

    await fetchJson(server.baseUrl, '/api/inventory/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        productId,
        productName: 'Inventory Adjustment Product',
        type: 'remove',
        quantity: 2,
        reason: 'Damaged items',
        branchId: branch.id,
        unitCostUsd: 4,
      }),
    })

    product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 6)
    assert.equal(sumBranchStock(product), 6)

    await fetchJson(server.baseUrl, '/api/inventory/adjust', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        productId,
        productName: 'Inventory Adjustment Product',
        type: 'set',
        quantity: 4,
        reason: 'Cycle count',
        branchId: branch.id,
        unitCostUsd: 4,
      }),
    })

    product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 4)
    assert.equal(sumBranchStock(product), 4)
    const branchRow = (product.branch_stock || []).find((row) => row.branch_id === branch.id)
    assert.equal(Number(branchRow?.quantity || 0), 4)

    const movements = await getInventoryMovements(server.baseUrl, authToken, branch.id)
    assert.ok(movements.some((row) => row.product_id === productId && row.movement_type === 'add' && Number(row.quantity) === 3))
    assert.ok(movements.some((row) => row.product_id === productId && row.movement_type === 'remove' && Number(row.quantity) === 2))
    assert.ok(movements.some((row) => row.product_id === productId && row.movement_type === 'set' && Number(row.quantity) === 2))
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('factory reset restores admin defaults while clearing business data and uploads')
runTest('factory reset restores admin defaults while clearing business data and uploads', async () => {
  const runtimeDir = makeTempRoot('bos-factory-reset-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    let authToken = await loginAsAdmin(server.baseUrl)
    const branch = await getDefaultBranch(server.baseUrl, authToken)

    await createProduct(server.baseUrl, authToken, branch.id, {
      name: 'Factory Reset Product',
      sku: 'FR-001',
      stock_quantity: 2,
      purchase_price_usd: 5,
      selling_price_usd: 12,
    })

    await fetchJson(server.baseUrl, '/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        name: 'Factory Reset Customer',
        membership_number: 'FR-CUST-001',
      }),
    })

    const upload = await uploadTinyPng(server.baseUrl, authToken)
    assert.ok(upload.public_path, 'Expected uploaded public path before factory reset')

    await fetchJson(server.baseUrl, '/api/system/factory-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({}),
    })

    authToken = await loginAsAdmin(server.baseUrl)

    const products = await fetchJson(server.baseUrl, '/api/products', { authToken })
    const customers = await fetchJson(server.baseUrl, '/api/customers', { authToken })
    const files = await getFiles(server.baseUrl, authToken)
    const users = await getUsers(server.baseUrl, authToken)
    const branches = await fetchJson(server.baseUrl, '/api/branches', { authToken })
    const settings = await getSettings(server.baseUrl, authToken)

    assert.equal(Array.isArray(products) ? products.length : -1, 0)
    assert.equal(Array.isArray(customers) ? customers.length : -1, 0)
    assert.equal(files.length, 0)
    assert.ok(Array.isArray(branches) && branches.length >= 1)
    assert.ok(branches.some((row) => row.is_default))
    assert.ok(Array.isArray(users) && users.some((row) => row.username === 'admin' && row.is_active))
    assert.equal(settings.business_name, 'My Business')
    assert.equal(settings.exchange_rate, '4100')
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
