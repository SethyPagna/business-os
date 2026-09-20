import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

test('fixture preview supplies dashboard and POS boot reads without hiding missing routes', { timeout: 20_000 }, async () => {
  // Test the real HTTP handler, with only generated assets and copied fixtures.
  // No repository build, browser state, Worker or database is touched.
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'bos-fixture-test-'))
  let child
  try {
    const frontend = path.join(temporaryRoot, 'frontend')
    const serverDir = path.join(frontend, 'e2e', 'server')
    await mkdir(serverDir, { recursive: true })
    await mkdir(path.join(frontend, 'dist'))
    await writeFile(path.join(frontend, 'dist', 'index.html'), '<!doctype html><title>Synthetic fixture test</title>')
    await cp(fileURLToPath(new URL('./fixtureServer.mjs', import.meta.url)), path.join(serverDir, 'fixtureServer.mjs'))
    await cp(fileURLToPath(new URL('../fixtures/', import.meta.url)), path.join(frontend, 'e2e', 'fixtures'), { recursive: true })
    child = spawn(process.execPath, [path.join(serverDir, 'fixtureServer.mjs')], {
      env: { ...process.env, E2E_HOST: '127.0.0.1', E2E_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const origin = await new Promise((resolve, reject) => {
      let output = ''
      let errors = ''
      child.stderr.on('data', (chunk) => { errors += chunk })
      child.once('error', reject)
      child.once('exit', (code) => reject(new Error(`Fixture exited ${code}: ${errors}`)))
      child.stdout.on('data', (chunk) => {
        output += chunk
        const match = output.match(/listening on 127\.0\.0\.1:(\d+)/)
        if (match) resolve(`http://127.0.0.1:${match[1]}`)
      })
    })
    const routes = ['/api/dashboard', '/api/analytics', '/api/dashboard/startup', '/api/promotions/rules/active', '/api/inventory/tagged-lots', '/api/products/stock-in-sessions', '/api/sync/owner']
    for (const route of routes) {
      const response = await fetch(origin + route)
      assert.equal(response.status, 401, `${route} must require a session`)
      assert.equal((await response.json()).code, 'invalid_session')
    }
    const login = await fetch(origin + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'synthetic-only' }),
    })
    assert.equal(login.status, 200)
    const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] }
    for (const [account, id] of [['admin', 1], ['cashier_a', 11], ['cashier_b', 12]]) {
      const response = await fetch(origin + '/api/sync/owner?actor_id=999', { headers: { Cookie: `bos_session=${account}` } })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.deepEqual(await response.json(), { owner: { version: 1, actor_id: id,
        organization_id: 1, authority: origin, runtime: 'cloudflare-workers' } })
    }
    const signedOutOwner = await fetch(origin + '/api/sync/owner')
    assert.equal(signedOutOwner.status, 401)
    assert.equal(signedOutOwner.headers.get('cache-control'), 'private, no-store')
    const failedLogout = await fetch(origin + '/api/auth/logout', {
      method: 'POST', headers: { Cookie: 'bos_session=cashier_a; e2e_logout_failure=1' },
    })
    assert.equal(failedLogout.status, 503)
    assert.equal(failedLogout.headers.get('set-cookie'), null)
    const normalLogout = await fetch(origin + '/api/auth/logout', {
      method: 'POST', headers: { Cookie: 'bos_session=cashier_b' },
    })
    assert.equal(normalLogout.status, 200, 'One context fault must not affect another context')
    assert.match(normalLogout.headers.get('set-cookie'), /Max-Age=0/)
    const get = async (route) => {
      const response = await fetch(origin + route, { headers })
      assert.equal(response.status, 200, route)
      return response.json()
    }
    const summary = await get('/api/dashboard?startDate=2026-09-19&endDate=2026-09-19')
    const analytics = await get('/api/analytics?startDate=2026-09-19&endDate=2026-09-19')
    const startup = await get('/api/dashboard/startup?startDate=2026-09-19&endDate=2026-09-19')
    assert.deepEqual(startup, { summary, analytics })
    assert.equal(summary.today_count, 0)
    assert.equal(summary.today_total, 0)
    assert.ok(Number.isFinite(summary.product_count))
    assert.ok(Array.isArray(summary.recent_sales))
    assert.equal(summary.low_stock_preview_truncated, false)
    assert.equal(analytics.totals.revenue_usd, 0)
    assert.equal(analytics.totals.tx_count, 0)
    assert.equal(analytics.prevTotals.revenue_usd, 0)
    for (const key of ['periodData', 'byPayment', 'byBranch', 'topProducts', 'topProductsQty', 'topCustomers', 'hourlyDist']) {
      assert.deepEqual(analytics[key], [], key)
    }
    assert.deepEqual(analytics.periodReturns, { return_count: 0, refund_usd: 0, items_returned: 0 })
    assert.deepEqual(analytics.periodSupplierReturns, { return_count: 0, supplier_compensation_usd: 0, loss_usd: 0 })
    const promotions = await get('/api/promotions/rules/active')
    assert.deepEqual(promotions.rules, [])
    assert.ok(Number.isFinite(Date.parse(promotions.now)))
    assert.deepEqual(await get('/api/inventory/tagged-lots?productIds=1,2,3'), { items: [] })
    assert.deepEqual(await get('/api/inventory/tagged-lots'), { items: [] })
    assert.deepEqual(await get('/api/products/stock-in-sessions'), {
      sessions: [], total: 0, page: 1, pageSize: 30, totalPages: 1,
    })
    assert.deepEqual(await get('/api/products/stock-in-sessions?search=synthetic&page=2&pageSize=50'), {
      sessions: [], total: 0, page: 2, pageSize: 50, totalPages: 1,
    })
    assert.deepEqual(await get('/api/products/stock-in-sessions?page=-2&pageSize=999'), {
      sessions: [], total: 0, page: 1, pageSize: 100, totalPages: 1,
    })
    assert.deepEqual(await get('/api/products/stock-in-sessions?page=999999&pageSize=invalid'), {
      sessions: [], total: 0, page: 100000, pageSize: 30, totalPages: 1,
    })
    for (const route of routes) {
      for (const method of ['POST', 'PUT', 'DELETE']) {
        const response = await fetch(origin + route, { method, headers })
        assert.equal(response.status, 405, `${method} ${route} must not claim a successful write`)
        assert.equal(response.headers.get('allow'), 'GET')
      }
    }
    for (const method of ['GET', 'POST']) {
      const response = await fetch(origin + '/api/not-a-fixture', { method, headers })
      assert.equal(response.status, 404)
      assert.equal((await response.json()).code, 'e2e_unmocked')
    }
    for (const route of ['/api/inventory/tagged-lots/dispose', '/api/inventory/tagged-lots/restore']) {
      const response = await fetch(origin + route, { method: 'POST', headers })
      assert.equal(response.status, 404, 'Unimplemented stock mutations must stay visible')
      assert.equal((await response.json()).code, 'e2e_unmocked')
    }
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
