#!/usr/bin/env node
// Lane 6.0.1045 (ic_fix_stock): a LOCAL stand-in for `wrangler dev` for a real-browser journey of the counts approval.
//
//   node scripts/journeys/ic-approval-bridge.cjs            (from cloudflare/)
//
// It boots the REAL Worker under Miniflare on the read-budget seed (the same world the budget tests use, Free plan), switches `ic_simple` and
// `ic_fix_stock` on, adds a counter (may count, may not approve) and a lead (may approve), puts two units of one product into the damaged stock,
// and serves the Worker on http://localhost:8787 so the Vite dev server (`frontend`, port 5173, which proxies /api there) can be driven in a browser.
// Nothing here touches a real database, a remote Cloudflare account or production. GET /__debug/stock?ids=1,2 answers the stock of those products
// straight from the local database, so a journey can check what the UI claims against the ledgers. Stop it with Ctrl+C (it removes its temporary copy).
'use strict'
process.env.READ_BUDGET_DEADLINE_MS = process.env.READ_BUDGET_DEADLINE_MS || '180000'
const http = require('node:http')
const bcrypt = require('bcryptjs')
const { bootWorld } = require('../read-budget/world.cjs')

const PORT = Number(process.env.BRIDGE_PORT || 8787)
const ORIGIN = 'http://127.0.0.1:4391'
const PASSWORD = 'budget-password-1'

async function main() {
  const world = await bootWorld({ tier: 'free' })
  const db = world.db
  await db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('read_switches', ?)").bind(JSON.stringify({ epoch: 1, set_at: '2026-11-03T00:00:00.000Z', set_by: 1, switches: { ic_simple: 'on', ic_fix_stock: 'on' } })).run()
  const counting = { inventory_checks: true, inventory_check_show_stock: true, inventory_check_show_barcode: true, inventory_check_show_brand: true, inventory_check_show_category: true, inventory_check_show_received: true }
  await db.prepare("INSERT INTO roles(id,name,code,permissions,is_system) VALUES(902,'Counter','employee',?,0),(903,'Lead','lead',?,0)")
    .bind(JSON.stringify(counting), JSON.stringify({ ...counting, inventory: true, inventory_check_approve: true })).run()
  for (const [id, username] of [[902, 'journey_counter'], [903, 'journey_lead']]) {
    await db.prepare("INSERT INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(?,?,?,?,?,'{}',1,?,0)")
      .bind(id, username, username, bcrypt.hashSync(PASSWORD, 4), id, world.orgId).run()
  }
  const rows = await world.all(`SELECT b.variant_product_id AS pid, p.name AS name, s.quantity AS qty FROM branch_batch_stock s JOIN product_batches b ON b.id = s.batch_id
    JOIN products p ON p.id = b.variant_product_id AND p.is_active = 1 AND (p.id - 1000) % 8 NOT IN (1, 2) WHERE s.branch_id = 1 AND s.quantity >= 6 ORDER BY b.id LIMIT 3 OFFSET 2400`)
  const broken = await world.send('POST', '/api/inventory/adjust', { productId: rows[1].pid, branchId: 1, quantity: 2, type: 'remove', reason: 'broken in store', conditionTag: 'damaged', client_request_id: 'journey-damage-0001' })
  if (broken.status !== 200) throw new Error('could not put 2 units of the second product into damaged stock: ' + broken.text.slice(0, 200))

  const stock = async ids => {
    const out = {}
    for (const pid of ids) out[pid] = {
      ordinary: (await world.all('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1', pid))[0]?.quantity,
      damaged: (await world.all('SELECT COALESCE(SUM(quantity_remaining),0) AS q FROM damaged_stock_lots WHERE product_id=? AND branch_id=1', pid))[0].q,
      product_cache: (await world.all('SELECT stock_quantity AS q FROM products WHERE id=?', pid))[0].q,
    }
    return out
  }
  // Non-administrators sign in from an approved device only. The journey stands in for the administrator who would approve the browser's device
  // on the Device approvals page: the first sign-in of a journey user from a device marks that device approved.
  const approveJourneyDevice = async text => {
    let body = null
    try { body = JSON.parse(text) } catch { return }
    const user = body && typeof body.username === 'string' && typeof body.deviceId === 'string' ? (await world.all('SELECT id FROM users WHERE username = ?', body.username))[0] : null
    if (!user || ![902, 903].includes(user.id)) return
    await world.db.prepare("INSERT OR IGNORE INTO trusted_devices(user_id, device_id, device_name, status, decided_at) VALUES(?, ?, 'journey browser', 'approved', datetime('now'))").bind(user.id, body.deviceId).run()
  }
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost')
      if (url.pathname === '/__debug/stock') {
        const ids = (url.searchParams.get('ids') || '').split(',').map(Number).filter(Number.isSafeInteger)
        response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(await stock(ids))); return
      }
      if (url.pathname === '/__debug/approvals') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(await world.all('SELECT session_id,status,lines,submitted_by,decided_by,decided_by_name,applied_json FROM inventory_check_approvals ORDER BY submitted_at'))); return
      }
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      if (request.method === 'POST' && url.pathname === '/api/auth/login') await approveJourneyDevice(Buffer.concat(chunks).toString('utf8'))
      const headers = {}
      for (const [name, value] of Object.entries(request.headers)) if (!['host', 'connection', 'content-length', 'origin', 'referer', 'accept-encoding'].includes(name) && typeof value === 'string') headers[name] = value
      headers.origin = ORIGIN; headers['sec-fetch-site'] = 'same-origin'
      const upstream = await world.mf.dispatchFetch(ORIGIN + request.url, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.concat(chunks) })
      response.statusCode = upstream.status
      upstream.headers.forEach((value, name) => { if (!['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(name)) response.setHeader(name, value) })
      const cookies = upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : []
      if (cookies.length) response.setHeader('set-cookie', cookies)
      response.end(Buffer.from(await upstream.arrayBuffer()))
    } catch (error) {
      response.statusCode = 502; response.end(String(error && error.stack || error))
    }
  })
  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve))
  console.log(JSON.stringify({ ready: true, port: PORT, password: PASSWORD, users: ['budget_admin (password budget-password-1, administrator)', 'journey_counter', 'journey_lead'],
    organizationId: world.orgId, products: rows.map(row => ({ id: row.pid, name: row.name, ordinary: row.qty })), damaged: { productId: rows[1].pid, units: 2 } }))
  const stop = async () => { server.close(); await world.dispose(); process.exit(0) }
  process.on('SIGINT', stop); process.on('SIGTERM', stop)
}
main().catch(error => { console.error(error); process.exit(1) })
