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

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
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
  const headers = { ...(options.headers || {}) }
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
      deviceName: 'Branch Stock QA',
    }),
  })
  assert.ok(result?.authToken, 'Expected admin auth token')
  return result.authToken
}

async function main() {
  await runTest('branch stock search counts sellable variants and excludes group-only parents', async () => {
    const runtimeDir = makeTempRoot('bos-branch-stock-search-')
    let server = null
    try {
      server = await startServer(runtimeDir)
      const authToken = await loginAsAdmin(server.baseUrl)
      const branches = await fetchJson(server.baseUrl, '/api/branches', { authToken })
      const branch = branches.find((item) => item.is_default) || branches[0]
      assert.ok(branch?.id, 'Expected default branch')

      const familyName = `Branch Search Family ${Date.now()}`
      const parent = await fetchJson(server.baseUrl, '/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        authToken,
        body: JSON.stringify({
          name: familyName,
          sku: `BS-P-${Date.now()}`,
          branch_id: branch.id,
          stock_quantity: 0,
          is_group: 1,
          purchase_price_usd: 2,
          selling_price_usd: 5,
        }),
      })
      const variant = await fetchJson(server.baseUrl, '/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        authToken,
        body: JSON.stringify({
          name: `${familyName} Variant A`,
          sku: `BS-V-${Date.now()}`,
          parent_id: parent.id,
          branch_id: branch.id,
          stock_quantity: 5,
          purchase_price_usd: 3,
          selling_price_usd: 7,
        }),
      })
      await fetchJson(server.baseUrl, '/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        authToken,
        body: JSON.stringify({
          name: `${familyName} Empty Standalone`,
          sku: `BS-Z-${Date.now()}`,
          branch_id: branch.id,
          stock_quantity: 0,
          purchase_price_usd: 1,
          selling_price_usd: 2,
        }),
      })

      const result = await fetchJson(server.baseUrl, `/api/branches/${branch.id}/stock?page=1&pageSize=20&stockState=positive&query=${encodeURIComponent(familyName)}`, { authToken })
      const ids = result.items.map((item) => Number(item.id))

      assert.ok(ids.includes(Number(variant.id)), 'Expected variant with positive stock in branch result')
      assert.equal(ids.includes(Number(parent.id)), false, 'Group-only parent should not be counted as sellable stock')
      assert.equal(Number(result.total), 1)
      assert.equal(Number(result.summary.in_stock_products), 1)
      assert.equal(Number(result.summary.out_of_stock_products), 1)
      assert.equal(Number(result.summary.total_products), 2)
    } finally {
      await stopServer(server?.child)
      fs.rmSync(runtimeDir, { recursive: true, force: true })
    }
  })

  await runTest('product and inventory search support parents-and-variants only filter', async () => {
    const runtimeDir = makeTempRoot('bos-parent-variant-filter-')
    let server = null
    try {
      server = await startServer(runtimeDir)
      const authToken = await loginAsAdmin(server.baseUrl)
      const branches = await fetchJson(server.baseUrl, '/api/branches', { authToken })
      const branch = branches.find((item) => item.is_default) || branches[0]
      assert.ok(branch?.id, 'Expected default branch')

      const familyName = `Grouped Filter Family ${Date.now()}`
      const parent = await fetchJson(server.baseUrl, '/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        authToken,
        body: JSON.stringify({
          name: familyName,
          sku: `GF-P-${Date.now()}`,
          branch_id: branch.id,
          stock_quantity: 0,
          is_group: 1,
          purchase_price_usd: 2,
          selling_price_usd: 5,
        }),
      })
      const variant = await fetchJson(server.baseUrl, '/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        authToken,
        body: JSON.stringify({
          name: `${familyName} Variant A`,
          sku: `GF-V-${Date.now()}`,
          parent_id: parent.id,
          branch_id: branch.id,
          stock_quantity: 3,
          purchase_price_usd: 3,
          selling_price_usd: 7,
        }),
      })
      const standalone = await fetchJson(server.baseUrl, '/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        authToken,
        body: JSON.stringify({
          name: `${familyName} Standalone`,
          sku: `GF-S-${Date.now()}`,
          branch_id: branch.id,
          stock_quantity: 3,
          purchase_price_usd: 1,
          selling_price_usd: 2,
        }),
      })

      const productResult = await fetchJson(server.baseUrl, `/api/products/search?page=1&pageSize=20&groupState=grouped&query=${encodeURIComponent(familyName)}`, { authToken })
      const productIds = productResult.items.map((item) => Number(item.id))
      assert.ok(productIds.includes(Number(parent.id)), 'Expected parent in grouped product filter')
      assert.ok(productIds.includes(Number(variant.id)), 'Expected variant in grouped product filter')
      assert.equal(productIds.includes(Number(standalone.id)), false, 'Standalone product should be excluded')

      const inventoryResult = await fetchJson(server.baseUrl, `/api/inventory/products/search?page=1&pageSize=20&groupState=grouped&query=${encodeURIComponent(familyName)}`, { authToken })
      const inventoryIds = inventoryResult.items.map((item) => Number(item.id))
      assert.ok(inventoryIds.includes(Number(parent.id)), 'Expected parent in grouped inventory filter')
      assert.ok(inventoryIds.includes(Number(variant.id)), 'Expected variant in grouped inventory filter')
      assert.equal(inventoryIds.includes(Number(standalone.id)), false, 'Standalone inventory product should be excluded')
    } finally {
      await stopServer(server?.child)
      fs.rmSync(runtimeDir, { recursive: true, force: true })
    }
  })

  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
