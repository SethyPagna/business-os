'use strict'

const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
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

async function createBranch(baseUrl, authToken, overrides = {}) {
  const created = await fetchJson(baseUrl, '/api/branches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    authToken,
    body: JSON.stringify({
      name: overrides.name || `Branch ${Date.now()}`,
      location: overrides.location || 'QA Location',
      phone: overrides.phone || null,
      manager: overrides.manager || null,
      notes: overrides.notes || null,
      is_default: overrides.is_default ?? false,
      is_active: overrides.is_active ?? true,
    }),
  })
  assert.ok(created?.id, 'Expected branch id from create branch')
  return created.id
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

async function updateProduct(baseUrl, authToken, productId, payload = {}) {
  return fetchJson(baseUrl, `/api/products/${productId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    authToken,
    body: JSON.stringify(payload),
  })
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

async function getRoles(baseUrl, authToken) {
  const rows = await fetchJson(baseUrl, '/api/roles', { authToken })
  assert.ok(Array.isArray(rows), 'Expected roles list')
  return rows
}

async function getSettings(baseUrl, authToken) {
  return fetchJson(baseUrl, '/api/settings', { authToken })
}

async function getSettingsMeta(baseUrl, authToken) {
  return fetchJson(baseUrl, '/api/settings/meta', { authToken })
}

async function getCategories(baseUrl, authToken) {
  const rows = await fetchJson(baseUrl, '/api/categories', { authToken })
  assert.ok(Array.isArray(rows), 'Expected categories list')
  return rows
}

async function getUnits(baseUrl, authToken) {
  const rows = await fetchJson(baseUrl, '/api/units', { authToken })
  assert.ok(Array.isArray(rows), 'Expected units list')
  return rows
}

async function getAiProviders(baseUrl, authToken) {
  const result = await fetchJson(baseUrl, '/api/ai/providers', { authToken })
  const items = Array.isArray(result?.items) ? result.items : []
  return items
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

function findDbPath(rootDir) {
  const stack = [rootDir]
  while (stack.length) {
    const current = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch (_) {
      continue
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isFile() && entry.name === 'business.db') return fullPath
      if (entry.isDirectory()) stack.push(fullPath)
    }
  }
  return null
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

pendingTests.add('branch transfers move stock between branches without changing aggregate stock and enforce delete safety')
runTest('branch transfers move stock between branches without changing aggregate stock and enforce delete safety', async () => {
  const runtimeDir = makeTempRoot('bos-branch-transfer-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)
    const destinationBranch = await getDefaultBranch(server.baseUrl, authToken)
    const sourceBranchId = await createBranch(server.baseUrl, authToken, {
      name: 'Transfer Source Branch',
    })

    const productId = await createProduct(server.baseUrl, authToken, sourceBranchId, {
      name: 'Branch Transfer Product',
      sku: 'XFER-001',
      stock_quantity: 6,
      purchase_price_usd: 5,
      selling_price_usd: 12,
    })

    let deleteResponse = await fetch(`${server.baseUrl}/api/branches/${sourceBranchId}`, {
      method: 'DELETE',
      headers: {
        'x-auth-session': authToken,
      },
    })
    let deleteJson = JSON.parse(await deleteResponse.text())
    assert.equal(deleteResponse.status, 400)
    assert.match(deleteJson.error || '', /Transfer all stock to another branch first/i)

    await fetchJson(server.baseUrl, '/api/branches/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        fromBranchId: sourceBranchId,
        toBranchId: destinationBranch.id,
        productId,
        productName: 'Branch Transfer Product',
        quantity: 6,
        note: 'Move all stock before archive',
      }),
    })

    const product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 6)
    assert.equal(sumBranchStock(product), 6)
    const sourceRow = (product.branch_stock || []).find((row) => row.branch_id === sourceBranchId)
    const destinationRow = (product.branch_stock || []).find((row) => row.branch_id === destinationBranch.id)
    assert.equal(Number(sourceRow?.quantity || 0), 0)
    assert.equal(Number(destinationRow?.quantity || 0), 6)

    const movements = await getInventoryMovements(server.baseUrl, authToken)
    const transferOutPattern = new RegExp(`Transfer out to ${destinationBranch.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
    const transferInPattern = /Transfer in from Transfer Source Branch/i
    assert.ok(movements.some((row) => row.product_id === productId && row.branch_id === sourceBranchId && row.movement_type === 'transfer' && transferOutPattern.test(row.reason || '')))
    assert.ok(movements.some((row) => row.product_id === productId && row.branch_id === destinationBranch.id && row.movement_type === 'transfer' && transferInPattern.test(row.reason || '')))

    deleteResponse = await fetch(`${server.baseUrl}/api/branches/${sourceBranchId}`, {
      method: 'DELETE',
      headers: {
        'x-auth-session': authToken,
      },
    })
    deleteJson = JSON.parse(await deleteResponse.text())
    assert.equal(deleteResponse.status, 200)
    assert.equal(deleteJson.success, true)

    const branches = await fetchJson(server.baseUrl, '/api/branches', { authToken })
    assert.ok(Array.isArray(branches))
    assert.ok(!branches.some((row) => row.id === sourceBranchId))
    assert.ok(branches.some((row) => row.id === destinationBranch.id))
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

pendingTests.add('settings writes reject stale expectedUpdatedAt values')
runTest('settings writes reject stale expectedUpdatedAt values', async () => {
  const runtimeDir = makeTempRoot('bos-settings-conflict-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)
    const metaBefore = await getSettingsMeta(server.baseUrl, authToken)
    assert.ok(metaBefore.updatedAt, 'Expected settings updatedAt before write')
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const firstWrite = await fetchJson(server.baseUrl, '/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        expectedUpdatedAt: metaBefore.updatedAt,
        business_name: 'Conflict Test Business',
      }),
    })
    assert.ok(firstWrite.updatedAt, 'Expected updatedAt after first settings write')
    assert.notEqual(firstWrite.updatedAt, metaBefore.updatedAt)

    const staleResponse = await fetch(`${server.baseUrl}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-session': authToken,
      },
      body: JSON.stringify({
        expectedUpdatedAt: metaBefore.updatedAt,
        business_phone: '012345678',
      }),
    })
    const staleJson = JSON.parse(await staleResponse.text())
    assert.equal(staleResponse.status, 409)
    assert.equal(staleJson.code, 'write_conflict')
    assert.equal(staleJson.conflict, true)
    assert.equal(staleJson.entity, 'settings')

    const settings = await getSettings(server.baseUrl, authToken)
    assert.equal(settings.business_name, 'Conflict Test Business')
    assert.notEqual(settings.business_phone, '012345678')
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('user writes reject stale expectedUpdatedAt values')
runTest('user writes reject stale expectedUpdatedAt values', async () => {
  const runtimeDir = makeTempRoot('bos-user-conflict-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)

    const created = await fetchJson(server.baseUrl, '/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        username: 'stale-user',
        name: 'Stale User',
        password: 'password123',
        email: 'stale-user@example.com',
        role_id: null,
        is_active: 1,
      }),
    })
    assert.ok(created?.id, 'Expected created user id')

    const usersBefore = await getUsers(server.baseUrl, authToken)
    const userBefore = usersBefore.find((row) => Number(row.id) === Number(created.id))
    assert.ok(userBefore?.updated_at, 'Expected user updated_at before write')
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const firstWrite = await fetchJson(server.baseUrl, `/api/users/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        expectedUpdatedAt: userBefore.updated_at,
        username: userBefore.username,
        name: 'Conflict Safe User',
        phone: userBefore.phone || '',
        email: userBefore.email || '',
        avatar_path: userBefore.avatar_path || '',
        role_id: userBefore.role_id || null,
        is_active: userBefore.is_active,
      }),
    })
    assert.equal(firstWrite.name, 'Conflict Safe User')
    assert.ok(firstWrite.updated_at)
    assert.notEqual(firstWrite.updated_at, userBefore.updated_at)

    const staleResponse = await fetch(`${server.baseUrl}/api/users/${created.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-session': authToken,
      },
      body: JSON.stringify({
        expectedUpdatedAt: userBefore.updated_at,
        username: userBefore.username,
        name: 'Stale Overwrite',
        phone: '012345678',
        email: userBefore.email || '',
        avatar_path: userBefore.avatar_path || '',
        role_id: userBefore.role_id || null,
        is_active: userBefore.is_active,
      }),
    })
    const staleJson = JSON.parse(await staleResponse.text())
    assert.equal(staleResponse.status, 409)
    assert.equal(staleJson.code, 'write_conflict')
    assert.equal(staleJson.entity, 'user')

    const usersAfter = await getUsers(server.baseUrl, authToken)
    const userAfter = usersAfter.find((row) => Number(row.id) === Number(created.id))
    assert.equal(userAfter.name, 'Conflict Safe User')
    assert.notEqual(userAfter.phone, '012345678')
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('role writes reject stale expectedUpdatedAt values')
runTest('role writes reject stale expectedUpdatedAt values', async () => {
  const runtimeDir = makeTempRoot('bos-role-conflict-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)

    const created = await fetchJson(server.baseUrl, '/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        name: 'QA Conflict Role',
        permissions: { products: true },
      }),
    })
    assert.ok(created?.id, 'Expected created role id')

    const rolesBefore = await getRoles(server.baseUrl, authToken)
    const roleBefore = rolesBefore.find((row) => Number(row.id) === Number(created.id))
    assert.ok(roleBefore?.updated_at, 'Expected role updated_at before write')
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const firstWrite = await fetchJson(server.baseUrl, `/api/roles/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        expectedUpdatedAt: roleBefore.updated_at,
        name: 'QA Conflict Role Updated',
        permissions: { products: true, sales: true },
      }),
    })
    assert.equal(firstWrite.name, 'QA Conflict Role Updated')
    assert.ok(firstWrite.updated_at)
    assert.notEqual(firstWrite.updated_at, roleBefore.updated_at)

    const staleResponse = await fetch(`${server.baseUrl}/api/roles/${created.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-session': authToken,
      },
      body: JSON.stringify({
        expectedUpdatedAt: roleBefore.updated_at,
        name: 'QA Conflict Role Stale',
        permissions: { inventory: true },
      }),
    })
    const staleJson = JSON.parse(await staleResponse.text())
    assert.equal(staleResponse.status, 409)
    assert.equal(staleJson.code, 'write_conflict')
    assert.equal(staleJson.entity, 'role')

    const rolesAfter = await getRoles(server.baseUrl, authToken)
    const roleAfter = rolesAfter.find((row) => Number(row.id) === Number(created.id))
    assert.equal(roleAfter.name, 'QA Conflict Role Updated')
    assert.equal(JSON.parse(roleAfter.permissions || '{}').sales, true)
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('profile writes reject stale expectedUpdatedAt values')
runTest('profile writes reject stale expectedUpdatedAt values', async () => {
  const runtimeDir = makeTempRoot('bos-profile-conflict-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)
    const profileBefore = await fetchJson(server.baseUrl, '/api/users/1/profile', { authToken })
    assert.ok(profileBefore?.updated_at, 'Expected profile updated_at before write')
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const firstWrite = await fetchJson(server.baseUrl, '/api/users/1/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        expectedUpdatedAt: profileBefore.updated_at,
        username: 'admin',
        name: 'Administrator Conflict Safe',
        phone: profileBefore.phone || '',
        email: profileBefore.email || '',
        avatar_path: profileBefore.avatar_path || '',
        currentPassword: 'admin',
        adminOverride: false,
      }),
    })
    assert.equal(firstWrite.name, 'Administrator Conflict Safe')
    assert.ok(firstWrite.updated_at)
    assert.notEqual(firstWrite.updated_at, profileBefore.updated_at)

    const staleResponse = await fetch(`${server.baseUrl}/api/users/1/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-session': authToken,
      },
      body: JSON.stringify({
        expectedUpdatedAt: profileBefore.updated_at,
        username: 'admin',
        name: 'Administrator Stale',
        phone: '099999999',
        email: profileBefore.email || '',
        avatar_path: profileBefore.avatar_path || '',
        currentPassword: 'admin',
        adminOverride: false,
      }),
    })
    const staleJson = JSON.parse(await staleResponse.text())
    assert.equal(staleResponse.status, 409)
    assert.equal(staleJson.code, 'write_conflict')
    assert.equal(staleJson.entity, 'user')

    const profileAfter = await fetchJson(server.baseUrl, '/api/users/1/profile', { authToken })
    assert.equal(profileAfter.name, 'Administrator Conflict Safe')
    assert.notEqual(profileAfter.phone, '099999999')
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('category writes reject stale expectedUpdatedAt values')
runTest('category writes reject stale expectedUpdatedAt values', async () => {
  const runtimeDir = makeTempRoot('bos-category-conflict-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)

    const created = await fetchJson(server.baseUrl, '/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({ name: 'QA Conflict Category', color: '#123456' }),
    })
    assert.ok(created?.id, 'Expected created category id')
    assert.ok(created?.updated_at, 'Expected category updated_at after create')
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const firstWrite = await fetchJson(server.baseUrl, `/api/categories/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        expectedUpdatedAt: created.updated_at,
        name: 'QA Conflict Category Updated',
        color: '#654321',
      }),
    })
    assert.equal(firstWrite.name, 'QA Conflict Category Updated')
    assert.notEqual(firstWrite.updated_at, created.updated_at)

    const staleResponse = await fetch(`${server.baseUrl}/api/categories/${created.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-session': authToken,
      },
      body: JSON.stringify({
        expectedUpdatedAt: created.updated_at,
        name: 'QA Conflict Category Stale',
        color: '#999999',
      }),
    })
    const staleJson = JSON.parse(await staleResponse.text())
    assert.equal(staleResponse.status, 409)
    assert.equal(staleJson.code, 'write_conflict')
    assert.equal(staleJson.entity, 'category')

    const categories = await getCategories(server.baseUrl, authToken)
    const saved = categories.find((row) => Number(row.id) === Number(created.id))
    assert.equal(saved.name, 'QA Conflict Category Updated')
    assert.equal(saved.color, '#654321')
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('custom table row writes reject stale expectedUpdatedAt values')
runTest('custom table row writes reject stale expectedUpdatedAt values', async () => {
  const runtimeDir = makeTempRoot('bos-custom-table-conflict-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)

    const table = await fetchJson(server.baseUrl, '/api/custom-tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        name: 'QA Conflict Table',
        display_name: 'QA Conflict Table',
        schema: [{ name: 'title', type: 'text' }],
      }),
    })
    assert.ok(table?.name, 'Expected custom table name')

    const created = await fetchJson(server.baseUrl, `/api/custom-tables/${table.name}/rows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({ data: { title: 'Initial row' } }),
    })
    assert.ok(created?.id, 'Expected custom row id')
    assert.ok(created?.updated_at, 'Expected custom row updated_at after create')
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const firstWrite = await fetchJson(server.baseUrl, `/api/custom-tables/${table.name}/rows/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        data: {
          id: created.id,
          title: 'Updated row',
          expectedUpdatedAt: created.updated_at,
        },
      }),
    })
    assert.equal(firstWrite.title, 'Updated row')
    assert.notEqual(firstWrite.updated_at, created.updated_at)

    const secondWrite = await fetchJson(server.baseUrl, `/api/custom-tables/${table.name}/rows/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        data: {
          id: created.id,
          title: 'Updated row again',
        },
        expectedUpdatedAt: firstWrite.updated_at,
      }),
    })
    assert.equal(secondWrite.title, 'Updated row again')
    assert.notEqual(secondWrite.updated_at, firstWrite.updated_at)

    const staleResponse = await fetch(`${server.baseUrl}/api/custom-tables/${table.name}/rows/${created.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-session': authToken,
      },
      body: JSON.stringify({
        data: {
          id: created.id,
          title: 'Stale row overwrite',
          expectedUpdatedAt: created.updated_at,
        },
      }),
    })
    const staleJson = JSON.parse(await staleResponse.text())
    assert.equal(staleResponse.status, 409)
    assert.equal(staleJson.code, 'write_conflict')
    assert.equal(staleJson.entity, 'custom table row')

    const rows = await fetchJson(server.baseUrl, `/api/custom-tables/${table.name}/data`, { authToken })
    const saved = rows.find((row) => Number(row.id) === Number(created.id))
    assert.equal(saved.title, 'Updated row again')
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('product updates accept partial payloads and preserve required fields from the existing row')
runTest('product updates accept partial payloads and preserve required fields from the existing row', async () => {
  const runtimeDir = makeTempRoot('bos-stock-partial-product-')
  const server = await startServer(runtimeDir)
  try {
    const authToken = await loginAsAdmin(server.baseUrl)
    const branch = await getDefaultBranch(server.baseUrl, authToken)
    const productId = await createProduct(server.baseUrl, authToken, branch.id, {
      name: 'Partial Update Product',
      sku: 'PARTIAL-001',
      stock_quantity: 6,
      selling_price_usd: 12.5,
      purchase_price_usd: 7.25,
      brand: 'Baseline',
    })

    const before = await getProduct(server.baseUrl, authToken, productId)
    const updated = await updateProduct(server.baseUrl, authToken, productId, {
      stock_quantity: 0,
      brand: 'Updated Brand',
      userId: 1,
      userName: 'QA',
      expectedUpdatedAt: before.updated_at,
    })

    assert.equal(updated.success, true)

    const after = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(after.name, 'Partial Update Product')
    assert.equal(after.sku, 'PARTIAL-001')
    assert.equal(after.brand, 'Updated Brand')
    assert.equal(after.stock_quantity, 0)
    assert.equal(after.purchase_price_usd, 7.25)
  } finally {
    await stopServer(server.child)
    fs.rmSync(runtimeDir, { recursive: true, force: true })
  }
})

pendingTests.add('product grouping updates preserve special prices and parent-child invariants')
runTest('product grouping updates preserve special prices and parent-child invariants', async () => {
  const runtimeDir = makeTempRoot('bos-stock-grouped-product-')
  const server = await startServer(runtimeDir)
  try {
    const authToken = await loginAsAdmin(server.baseUrl)
    const branch = await getDefaultBranch(server.baseUrl, authToken)
    const parentId = await createProduct(server.baseUrl, authToken, branch.id, {
      name: 'Grouped Parent Product',
      sku: 'GROUP-PARENT-001',
      stock_quantity: 3,
      selling_price_usd: 30,
      special_price_usd: 27.5,
      is_group: 0,
    })
    const childId = await createProduct(server.baseUrl, authToken, branch.id, {
      name: 'Loose Child Product',
      sku: 'GROUP-CHILD-001',
      stock_quantity: 1,
      selling_price_usd: 14.25,
      special_price_usd: 12.75,
      is_group: 1,
    })

    const before = await getProduct(server.baseUrl, authToken, childId)
    const updated = await updateProduct(server.baseUrl, authToken, childId, {
      parent_id: parentId,
      special_price_usd: 11.5,
      userId: 1,
      userName: 'QA',
      expectedUpdatedAt: before.updated_at,
    })
    assert.equal(updated.success, true)

    const parentAfter = await getProduct(server.baseUrl, authToken, parentId)
    const childAfter = await getProduct(server.baseUrl, authToken, childId)
    assert.equal(parentAfter.is_group, 1)
    assert.equal(childAfter.parent_id, parentId)
    assert.equal(childAfter.is_group, 0)
    assert.equal(childAfter.special_price_usd, 11.5)
    assert.equal(childAfter.name, 'Loose Child Product')
    assert.equal(childAfter.sku, 'GROUP-CHILD-001')
  } finally {
    await stopServer(server.child)
    fs.rmSync(runtimeDir, { recursive: true, force: true })
  }
})

pendingTests.add('custom table schema rejects duplicate or invalid column definitions')
runTest('custom table schema rejects duplicate or invalid column definitions', async () => {
  const runtimeDir = makeTempRoot('bos-custom-table-schema-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)

    const duplicateResponse = await fetch(`${server.baseUrl}/api/custom-tables`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-session': authToken,
      },
      body: JSON.stringify({
        name: 'QA Duplicate Columns',
        schema: [
          { name: 'Label', type: 'text' },
          { name: 'label', type: 'number' },
        ],
      }),
    })
    const duplicateJson = JSON.parse(await duplicateResponse.text())
    assert.equal(duplicateResponse.status, 400)
    assert.match(String(duplicateJson.error || ''), /Duplicate column name/i)

    const invalidTypeResponse = await fetch(`${server.baseUrl}/api/custom-tables`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-session': authToken,
      },
      body: JSON.stringify({
        name: 'QA Invalid Type',
        schema: [
          { name: 'Label', type: 'script' },
        ],
      }),
    })
    const invalidTypeJson = JSON.parse(await invalidTypeResponse.text())
    assert.equal(invalidTypeResponse.status, 400)
    assert.match(String(invalidTypeJson.error || ''), /Unsupported column type/i)
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('ai provider writes reject stale expectedUpdatedAt values')
runTest('ai provider writes reject stale expectedUpdatedAt values', async () => {
  const runtimeDir = makeTempRoot('bos-ai-provider-conflict-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)

    const createdResult = await fetchJson(server.baseUrl, '/api/ai/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        name: 'QA Provider',
        provider: 'groq',
        provider_type: 'chat',
        api_key: 'test-key-123',
        default_model: 'llama-3.1-8b-instant',
        enabled: true,
        priority: 20,
        requests_per_minute: 5,
        max_input_chars: 800,
        max_completion_tokens: 512,
        timeout_ms: 5000,
        cooldown_seconds: 10,
      }),
    })
    const created = createdResult?.item
    assert.ok(created?.id, 'Expected AI provider id')
    assert.ok(created?.updated_at, 'Expected AI provider updated_at after create')
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const firstWrite = await fetchJson(server.baseUrl, `/api/ai/providers/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        expectedUpdatedAt: created.updated_at,
        name: 'QA Provider Updated',
        provider: created.provider,
        provider_type: created.provider_type,
        default_model: created.default_model,
        enabled: created.enabled,
        priority: 10,
        requests_per_minute: created.requests_per_minute,
        max_input_chars: created.max_input_chars,
        max_completion_tokens: created.max_completion_tokens,
        timeout_ms: created.timeout_ms,
        cooldown_seconds: created.cooldown_seconds,
      }),
    })
    assert.equal(firstWrite.item.name, 'QA Provider Updated')
    assert.notEqual(firstWrite.item.updated_at, created.updated_at)

    const staleResponse = await fetch(`${server.baseUrl}/api/ai/providers/${created.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-session': authToken,
      },
      body: JSON.stringify({
        expectedUpdatedAt: created.updated_at,
        name: 'QA Provider Stale',
        provider: created.provider,
        provider_type: created.provider_type,
        default_model: created.default_model,
        enabled: created.enabled,
        priority: 99,
        requests_per_minute: created.requests_per_minute,
        max_input_chars: created.max_input_chars,
        max_completion_tokens: created.max_completion_tokens,
        timeout_ms: created.timeout_ms,
        cooldown_seconds: created.cooldown_seconds,
      }),
    })
    const staleJson = JSON.parse(await staleResponse.text())
    assert.equal(staleResponse.status, 409)
    assert.equal(staleJson.code, 'write_conflict')
    assert.equal(staleJson.entity, 'ai_provider_config')

    const providers = await getAiProviders(server.baseUrl, authToken)
    const saved = providers.find((row) => Number(row.id) === Number(created.id))
    assert.equal(saved.name, 'QA Provider Updated')
    assert.equal(saved.priority, 10)
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('unit writes reject stale expectedUpdatedAt values')
runTest('unit writes reject stale expectedUpdatedAt values', async () => {
  const runtimeDir = makeTempRoot('bos-unit-conflict-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)

    const created = await fetchJson(server.baseUrl, '/api/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({ name: 'QA Conflict Unit', color: '#123456' }),
    })
    assert.ok(created?.id, 'Expected created unit id')
    assert.ok(created?.updated_at, 'Expected unit updated_at after create')
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const firstWrite = await fetchJson(server.baseUrl, `/api/units/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        expectedUpdatedAt: created.updated_at,
        name: 'QA Conflict Unit Updated',
        color: '#654321',
      }),
    })
    assert.equal(firstWrite.name, 'QA Conflict Unit Updated')
    assert.notEqual(firstWrite.updated_at, created.updated_at)

    const staleResponse = await fetch(`${server.baseUrl}/api/units/${created.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-session': authToken,
      },
      body: JSON.stringify({
        expectedUpdatedAt: created.updated_at,
        name: 'QA Conflict Unit Stale',
        color: '#999999',
      }),
    })
    const staleJson = JSON.parse(await staleResponse.text())
    assert.equal(staleResponse.status, 409)
    assert.equal(staleJson.code, 'write_conflict')
    assert.equal(staleJson.entity, 'unit')

    const units = await getUnits(server.baseUrl, authToken)
    const saved = units.find((row) => Number(row.id) === Number(created.id))
    assert.equal(saved.name, 'QA Conflict Unit Updated')
    assert.equal(saved.color, '#654321')
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('file asset deletes reject stale expectedUpdatedAt values')
runTest('file asset deletes reject stale expectedUpdatedAt values', async () => {
  const runtimeDir = makeTempRoot('bos-file-conflict-')
  let server = null
  let externalDb = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)

    const uploaded = await uploadTinyPng(server.baseUrl, authToken, 'qa-file-conflict.png')
    assert.ok(uploaded?.id, 'Expected uploaded file id')
    assert.ok(uploaded?.updated_at, 'Expected file updated_at after upload')

    const dbPath = findDbPath(runtimeDir)
    assert.ok(dbPath, 'Expected business.db to exist for file conflict test')
    externalDb = new Database(dbPath)
    const bumpedUpdatedAt = new Date(Date.now() + 2000).toISOString()
    externalDb.prepare('UPDATE file_assets SET updated_at = ? WHERE id = ?').run(bumpedUpdatedAt, uploaded.id)

    const staleResponse = await fetch(`${server.baseUrl}/api/files/${uploaded.id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-auth-session': authToken,
      },
      body: JSON.stringify({
        expectedUpdatedAt: uploaded.updated_at,
      }),
    })
    const staleJson = JSON.parse(await staleResponse.text())
    assert.equal(staleResponse.status, 409)
    assert.equal(staleJson.code, 'write_conflict')
    assert.equal(staleJson.entity, 'file asset')

    const files = await getFiles(server.baseUrl, authToken)
    const saved = files.find((row) => Number(row.id) === Number(uploaded.id))
    assert.ok(saved, 'Expected file to remain after stale delete attempt')
    assert.equal(saved.updated_at, bumpedUpdatedAt)
  } finally {
    try { externalDb?.close() } catch (_) {}
    await stopServer(server?.child)
  }
})

pendingTests.add('verify-integrity reports inconsistencies without mutating data while repair-integrity fixes them')
runTest('verify-integrity reports inconsistencies without mutating data while repair-integrity fixes them', async () => {
  const runtimeDir = makeTempRoot('bos-verify-integrity-')
  let server = null
  let externalDb = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)
    const branch = await getDefaultBranch(server.baseUrl, authToken)
    const productId = await createProduct(server.baseUrl, authToken, branch.id, {
      name: 'Integrity Drift Product',
      sku: 'INT-001',
      stock_quantity: 6,
      purchase_price_usd: 3,
      selling_price_usd: 7,
    })

    const dbPath = findDbPath(runtimeDir)
    assert.ok(dbPath, 'Expected to find temp business.db path')
    externalDb = new Database(dbPath)
    externalDb.pragma('journal_mode = WAL')
    externalDb.prepare('UPDATE products SET stock_quantity = 999 WHERE id = ?').run(productId)

    let product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 999)
    assert.equal(sumBranchStock(product), 6)

    const verifyResult = await fetchJson(server.baseUrl, '/api/system/verify-integrity', { authToken })
    assert.equal(verifyResult.action, 'verify-only')
    assert.equal(verifyResult.success, true)

    product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 999, 'Verify-only route must not mutate live data')
    assert.equal(sumBranchStock(product), 6)

    const repairResult = await fetchJson(server.baseUrl, '/api/system/repair-integrity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({}),
    })
    assert.equal(repairResult.action, 'repair-and-verify')
    assert.equal(repairResult.success, true)

    product = await getProduct(server.baseUrl, authToken, productId)
    assert.equal(Number(product.stock_quantity), 6)
    assert.equal(sumBranchStock(product), 6)
  } finally {
    try { externalDb?.close() } catch (_) {}
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

pendingTests.add('bulk import auto-creates missing product metadata and preserves stock placement')
runTest('bulk import auto-creates missing product metadata and preserves stock placement', async () => {
  const runtimeDir = makeTempRoot('bos-import-metadata-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await loginAsAdmin(server.baseUrl)

    const importBranchName = `QA Import Branch ${Date.now()}`
    const importCategory = `QA Import Category ${Date.now()}`
    const importUnit = `QA Import Unit ${Date.now()}`
    const importBrand = `QA Import Brand ${Date.now()}`
    const importSupplier = `QA Import Supplier ${Date.now()}`

    const result = await fetchJson(server.baseUrl, '/api/products/bulk-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken,
      body: JSON.stringify({
        products: [
          {
            _action: 'new',
            name: 'Metadata Import Product',
            sku: 'META-001',
            branch: importBranchName,
            category: importCategory,
            unit: importUnit,
            brand: importBrand,
            supplier: importSupplier,
            stock_quantity: 5,
            purchase_price_usd: 3.5,
            selling_price_usd: 8.25,
            low_stock_threshold: 2,
          },
        ],
      }),
    })

    assert.equal(result.imported, 1)
    assert.equal(result.updated, 0)
    assert.deepEqual(result.errors, [])

    const categories = await getCategories(server.baseUrl, authToken)
    assert.ok(categories.some((row) => row.name === importCategory), 'Expected imported category to be created')

    const units = await getUnits(server.baseUrl, authToken)
    assert.ok(units.some((row) => row.name === importUnit), 'Expected imported unit to be created')

    const settings = await getSettings(server.baseUrl, authToken)
    const brandOptions = JSON.parse(settings.product_brand_options || '[]')
    assert.ok(Array.isArray(brandOptions) && brandOptions.includes(importBrand), 'Expected imported brand to be added to settings')

    const branches = await fetchJson(server.baseUrl, '/api/branches', { authToken })
    const branch = Array.isArray(branches) ? branches.find((row) => row.name === importBranchName) : null
    assert.ok(branch?.id, 'Expected imported branch to be created')

    const suppliers = await fetchJson(server.baseUrl, '/api/suppliers', { authToken })
    assert.ok(Array.isArray(suppliers) && suppliers.some((row) => row.name === importSupplier), 'Expected imported supplier to be created')

    const products = await fetchJson(server.baseUrl, '/api/products', { authToken })
    const product = Array.isArray(products) ? products.find((row) => row.sku === 'META-001') : null
    assert.ok(product, 'Expected imported product to exist')
    assert.equal(product.category, importCategory)
    assert.equal(product.unit, importUnit)
    assert.equal(product.brand, importBrand)
    assert.equal(product.supplier, importSupplier)
    assert.equal(Number(product.stock_quantity), 5)
    assert.equal(sumBranchStock(product), 5)
    const branchRow = (product.branch_stock || []).find((row) => row.branch_id === branch.id)
    assert.equal(Number(branchRow?.quantity || 0), 5)
  } finally {
    await stopServer(server?.child)
  }
})
