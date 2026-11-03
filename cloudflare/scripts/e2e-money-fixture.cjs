'use strict'
/**
 * e2e-money-fixture.cjs -- the reusable SYSTEM fixture for browser specs that touch money.
 *
 * WHAT IT IS. One disposable, native Worker + D1 + R2 + KV (Miniflare/workerd) on loopback, serving the built
 * `frontend/dist`, seeded with the smallest realistic shop the money flows need. Nothing is stubbed: the real
 * bcrypt sign-in, the real device-approval gate, the real shift gate, the real `POST /api/sales`. It is the
 * sibling of employee-sale-save-fixture.cjs, which stays untouched (its 12 tests keep their own seed and port).
 *
 * LOCAL ONLY, structurally. Miniflare keeps all state in memory; the HTTP server binds 127.0.0.1; every request
 * with a non-loopback hostname is refused; every outbound fetch the Worker attempts (Telegram, Resend, Drive...)
 * is answered 503 and recorded in `outboundRefusals`. There is no wrangler `--remote`, no credential and no
 * network code in this file.
 *
 * RUN IT (from the repository root, after `npm run build` in frontend/ and a clean or committed tracked tree):
 *     node cloudflare/scripts/e2e-money-fixture.cjs
 *   env: E2E_MONEY_PORT (4351), E2E_MONEY_DIST (frontend/dist), E2E_MONEY_ALLOW_DIRTY=1 (serve a dirty tree;
 *   the provenance is then reported as dirty in /__fixture/ready and a spec can refuse it).
 * Stop it with POST /__fixture/shutdown or Ctrl-C.
 *
 * WHAT IT SEEDS (all of it in SEED below, exported, and served by /__fixture/ready so a spec never copies a
 * number): an administrator; a NON-admin cashier with an APPROVED device and the shift policy enforced (a
 * non-admin has no shift on first sign-in, so the POS shows the opening-cash gate until the cashier registers
 * one); two branches, Shop (sells) and Warehouse (stock only); four priced products with lots and stock in BOTH
 * branches; the exchange rate; one customer with a membership number and a points balance; one delivery courier.
 *
 * ENDPOINTS (loopback only)
 *   GET  /__fixture/ready       { ready, sourceHead, trackedChanges, frontendBuild, migrations, seed }
 *   GET  /__fixture/state       the money snapshot below; `?sale=<id>` restricts sales/lines/allocations to one sale
 *   POST /__fixture/select      { sql, params } -> { rows }; ONE read-only SELECT, so a later spec can assert any
 *                               table without anyone editing this file
 *   POST /__fixture/admin-call  { path, method, body } -> { status, body }; a real /api/* request as the administrator
 *                               (change the exchange rate, enable tax, read a report) through the real route
 *   POST /__fixture/shutdown
 *   /api/*, /uploads/*          the real Worker, proxied
 *   anything else               the built frontend, with SPA fallback
 *
 * STATE SHAPE (rows are the raw columns, so a spec asserts the database and not a view of it):
 *   saleIds, sales, lines (sale_items), allocations (sale_item_batch_allocations), stock (branch_stock of the seed
 *   products), lots (branch_batch_stock of the seed lots), movements (inventory_movements of the seed products),
 *   shifts (shift_sessions), settings (the keys a money spec reads), audits, foreignKeyCheck, outboundRefusals.
 */
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: splitSql } = require('wrangler')
const bcrypt = require('bcryptjs')

const root = path.resolve(__dirname, '..')
const repo = path.resolve(root, '..')

/** Synthetic data only: the repository is public, so no real name, phone or id appears here. */
const SEED = {
  password: 'money-pass-123',
  exchangeRate: 4000,
  branches: [
    { id: 1, name: 'Shop', isDefault: 1 },
    { id: 2, name: 'Warehouse', isDefault: 0 },
  ],
  actors: {
    admin: { id: 801, username: 'm1_admin', name: 'M1 Administrator', roleCode: 'admin', permissions: { all: true } },
    // A cashier is NOT an administrator, so lib/deviceTrust.ts requires an approved device (seeded below, id
    // `deviceId`; the browser must present it as localStorage `businessos_device_id`) and routes/shifts.ts
    // requires a registered shift before the POS lets the till ring a sale (shift_admin_exempt only spares admins).
    cashier: { id: 811, username: 'm1_cashier', name: 'M1 Cashier', roleCode: 'employee', deviceId: 'm1-cashier-device', permissions: { pos: true, sales: true } },
  },
  // Prices are exact cents and costs differ from prices, so a spec can tell a price from a cost.
  // `lots`: one product_batches row each, with its quantity in ONE branch (a product's stock in a branch is the
  // sum of its lots there, and branch_stock agrees with that sum at seed time).
  products: [
    { id: 301, name: 'M1 Rose Serum', barcode: '8852000000301', priceUsd: 12.5, costUsd: 5.1, lots: [
      { id: 3011, branchId: 1, code: 'M1-ROSE-AUG', receivedAt: '2026-08-01', quantity: 30 },
      { id: 3012, branchId: 1, code: 'M1-ROSE-OCT', receivedAt: '2026-10-01', quantity: 30 },
      { id: 3013, branchId: 2, code: 'M1-ROSE-WH', receivedAt: '2026-09-01', quantity: 20 },
    ] },
    { id: 302, name: 'M1 Mint Balm', barcode: '8852000000302', priceUsd: 4.75, costUsd: 2.05, lots: [
      { id: 3021, branchId: 1, code: 'M1-MINT-SEP', receivedAt: '2026-09-01', quantity: 50 },
      { id: 3022, branchId: 2, code: 'M1-MINT-WH', receivedAt: '2026-09-01', quantity: 10 },
    ] },
    { id: 303, name: 'M1 Clay Mask', barcode: '8852000000303', priceUsd: 3.68, costUsd: 1.4, lots: [
      { id: 3031, branchId: 1, code: 'M1-CLAY-SEP', receivedAt: '2026-09-01', quantity: 50 },
      { id: 3032, branchId: 2, code: 'M1-CLAY-WH', receivedAt: '2026-09-01', quantity: 5 },
    ] },
    { id: 304, name: 'M1 Oat Soap', barcode: '8852000000304', priceUsd: 2.2, costUsd: 0.8, lots: [
      { id: 3041, branchId: 1, code: 'M1-OAT-SEP', receivedAt: '2026-09-01', quantity: 40 },
      { id: 3042, branchId: 2, code: 'M1-OAT-WH', receivedAt: '2026-09-01', quantity: 8 },
    ] },
  ],
  // Membership 100 points = $1.00 (the Worker default), 300 points on the books => 3 redeemable units.
  customer: { id: 701, name: 'M1 Dara Sok', phone: '012000111', membershipNumber: 'M1-0001', points: 300 },
  courier: { id: 711, name: 'M1 Courier Vibol', phone: '012000222', area: 'Phnom Penh' },
  // Everything else is the Worker's default. Tax starts OFF (a spec that needs it switches it on through
  // /__fixture/admin-call and the real Settings route); the rate is stored so that is one key.
  settings: {
    exchange_rate: '4000',
    pos_payment_methods: JSON.stringify(['Cash', 'Bank']),
    tax_enabled: 'false',
    tax_rate: '10',
    shift_scope_mode: 'per_account',
    shift_admin_exempt: 'true',
    loyalty_points_enabled: 'true',
  },
}

const STATE_SETTING_KEYS = ['exchange_rate', 'change_exchange_rate', 'tax_enabled', 'tax_rate', 'pos_payment_methods', 'shift_scope_mode', 'shift_admin_exempt', 'loyalty_points_enabled']
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.map': 'application/json' }

async function startMoneyFixture(options = {}) {
  const port = Number(options.port || process.env.E2E_MONEY_PORT || 4351)
  const origin = `http://127.0.0.1:${port}`
  const dist = path.resolve(options.dist || process.env.E2E_MONEY_DIST || path.join(repo, 'frontend/dist'))
  const allowDirty = options.allowDirty ?? process.env.E2E_MONEY_ALLOW_DIRTY === '1'
  const info = { startedAtUTC: new Date().toISOString(), runtime: process.version, origin, dist, migrations: [], skippedEmptyAliasInsert: 0, outboundRefusals: [] }

  const git = args => execFileSync('git', ['-c', 'safe.directory=' + repo.replaceAll('\\', '/'), '-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  info.sourceHead = git(['rev-parse', 'HEAD'])
  info.trackedChanges = git(['status', '--porcelain', '--untracked-files=no'])
  info.frontendBuild = JSON.parse(fs.readFileSync(path.join(dist, 'business-os-build.json'), 'utf8'))
  if (info.trackedChanges && !allowDirty) throw new Error('The money fixture serves a built app and a bundled Worker: commit tracked changes first, or set E2E_MONEY_ALLOW_DIRTY=1 to accept an unprovable build.')

  const bundle = await build({ entryPoints: [path.join(root, 'src/index.ts')], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:*'], logLevel: 'silent' })
  info.workerBundleSHA256 = createHash('sha256').update(bundle.outputFiles[0].text).digest('hex')
  const mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], r2Buckets: ['ASSETS'], kvNamespaces: ['CACHE'],
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    bindings: { PLAN_TIER: 'paid', BUSINESS_OS_LOCAL_DEV: '1', BUSINESS_OS_PUBLIC_URL: origin, BUSINESS_OS_ADMIN_URL: origin, BUSINESS_OS_ORGANIZATION_SLUG: 'leang-cosmetics', BUSINESS_OS_ORGANIZATION_NAME: 'Disposable E2E' },
    outboundService: request => { info.outboundRefusals.push({ method: request.method, url: request.url }); return new Response('External network refused by local fixture', { status: 503 }) },
    log: new Log(LogLevel.ERROR),
  })
  const db = await mf.getD1Database('DB')
  const run = (sql, ...values) => db.prepare(sql).bind(...values).run()
  const all = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results

  let server
  async function close() {
    if (server) await new Promise(resolve => server.close(resolve))
    server = undefined
    await mf.dispose()
  }

  try {
    info.foreignKeys = await all('PRAGMA foreign_keys')
    for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
      for (const statement of splitSql(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))) {
        // The same single skip the sibling fixture makes: an alias insert that resolves no user on an empty database.
        if (file === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) { info.skippedEmptyAliasInsert++; continue }
        try { await run(statement) } catch (error) { throw new Error(`Migration ${file}: ${error.message}`) }
      }
      info.migrations.push(file)
    }

    const org = (await all('SELECT id FROM organizations ORDER BY id LIMIT 1'))[0]
    const hash = bcrypt.hashSync(SEED.password, 10)
    for (const actor of Object.values(SEED.actors)) {
      await run('INSERT INTO roles(id,name,code,permissions,is_system) VALUES(?,?,?,?,0)', actor.id, `M1 ${actor.username}`, actor.roleCode, JSON.stringify(actor.permissions))
      await run('INSERT INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(?,?,?,?,?,\'{}\',1,?,0)', actor.id, actor.username, actor.name, hash, actor.id, org.id)
      if (actor.deviceId) await run("INSERT INTO trusted_devices(user_id,device_id,device_name,status,decided_at,decided_by_user_id,decided_by_name) VALUES(?,?,?,'approved',CURRENT_TIMESTAMP,?,?)", actor.id, actor.deviceId, 'Disposable cashier till', SEED.actors.admin.id, SEED.actors.admin.name)
    }
    for (const branch of SEED.branches) await run('INSERT INTO branches(id,name,is_default,is_active) VALUES(?,?,?,1)', branch.id, branch.name, branch.isDefault)
    for (const product of SEED.products) {
      const totals = new Map()
      for (const lot of product.lots) totals.set(lot.branchId, (totals.get(lot.branchId) || 0) + lot.quantity)
      const total = [...totals.values()].reduce((a, b) => a + b, 0)
      await run('INSERT INTO products(id,name,barcode,sku,category,unit,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)',
        product.id, product.name, product.barcode, `M1-${product.id}`, 'M1 Skin', 'pcs', total, product.priceUsd, product.priceUsd * SEED.exchangeRate, product.costUsd, product.costUsd * SEED.exchangeRate)
      for (const [branchId, quantity] of totals) await run('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)', product.id, branchId, quantity)
      for (const lot of product.lots) {
        await run("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,received_quantity,received_branch_id,is_active,batch_number) VALUES(?,?,?,?,?,?,?,1,?)",
          lot.id, product.id, `m1-batch-${lot.id}`, lot.code, lot.receivedAt, lot.quantity, lot.branchId, product.lots.indexOf(lot) + 1)
        await run('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)', lot.id, lot.branchId, lot.quantity)
      }
    }
    const { customer, courier } = SEED
    await run('INSERT INTO customers(id,name,phone,membership_number) VALUES(?,?,?,?)', customer.id, customer.name, customer.phone, customer.membershipNumber)
    await run("INSERT INTO loyalty_point_adjustments(customer_id,points,note,created_by_id,created_by_name) VALUES(?,?,'M1 fixture opening points',?,?)", customer.id, customer.points, SEED.actors.admin.id, SEED.actors.admin.name)
    await run('INSERT INTO delivery_contacts(id,name,phone,area) VALUES(?,?,?,?)', courier.id, courier.name, courier.phone, courier.area)
    for (const [key, value] of Object.entries(SEED.settings)) await run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value)

    async function dispatch(url, method, body, cookie) {
      // Stands in for the admin page: same-origin JSON, as routes/auth.ts's credential guard requires of /login.
      const response = await mf.dispatchFetch(origin + url, { method, headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      const text = await response.text()
      let parsed = text
      try { parsed = text ? JSON.parse(text) : null } catch { /* a non-JSON answer is returned as text */ }
      return { status: response.status, body: parsed, cookie: response.headers.get('set-cookie') }
    }
    const login = await dispatch('/api/auth/login', 'POST', { username: SEED.actors.admin.username, password: SEED.password, organizationId: org.id }, undefined)
    if (login.status !== 200 || !login.cookie) throw new Error(`Actual admin fixture login failed: ${login.status} ${JSON.stringify(login.body)}`)
    const adminCookie = login.cookie.split(';')[0]
    info.foreignKeyCheck = await all('PRAGMA foreign_key_check')
    if (info.foreignKeys[0]?.foreign_keys !== 1 || info.foreignKeyCheck.length) throw new Error('Native fixture foreign-key enforcement/check failed')

    const productIds = SEED.products.map(p => p.id).join(',')
    const lotIds = SEED.products.flatMap(p => p.lots.map(l => l.id)).join(',')
    async function state(saleId) {
      const scoped = Number.isFinite(saleId) && saleId > 0
      return {
        saleIds: (await all('SELECT id FROM sales ORDER BY id')).map(r => r.id),
        sales: scoped ? await all('SELECT * FROM sales WHERE id=?', saleId) : await all('SELECT * FROM sales ORDER BY id'),
        lines: scoped ? await all('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id', saleId) : await all('SELECT * FROM sale_items ORDER BY id'),
        allocations: scoped
          ? await all('SELECT a.* FROM sale_item_batch_allocations a JOIN sale_items s ON s.id=a.sale_item_id WHERE s.sale_id=? ORDER BY a.id', saleId)
          : await all('SELECT * FROM sale_item_batch_allocations ORDER BY id'),
        stock: await all(`SELECT * FROM branch_stock WHERE product_id IN(${productIds}) ORDER BY product_id,branch_id`),
        lots: await all(`SELECT * FROM branch_batch_stock WHERE batch_id IN(${lotIds}) ORDER BY batch_id,branch_id`),
        movements: await all(`SELECT * FROM inventory_movements WHERE product_id IN(${productIds}) ORDER BY id`),
        shifts: await all('SELECT * FROM shift_sessions ORDER BY id'),
        settings: await all(`SELECT key,value FROM settings WHERE key IN(${STATE_SETTING_KEYS.map(() => '?').join(',')}) ORDER BY key`, ...STATE_SETTING_KEYS),
        audits: await all('SELECT id,action,entity,entity_id,user_id,user_name FROM audit_logs ORDER BY id'),
        foreignKeyCheck: await all('PRAGMA foreign_key_check'),
        outboundRefusals: info.outboundRefusals,
      }
    }
    const readBody = req => new Promise((resolve, reject) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject) })
    const json = (res, value, status = 200) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)) }

    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, origin)
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Non-loopback request')
        if (url.pathname === '/__fixture/shutdown' && req.method === 'POST') { res.end('Closing own disposable fixture'); setImmediate(() => close().then(() => process.exit(0))); return }
        if (url.pathname === '/__fixture/ready') return json(res, { ready: true, sourceHead: info.sourceHead, trackedChanges: info.trackedChanges, frontendBuild: info.frontendBuild, migrations: info.migrations.length, organizationId: org.id, seed: SEED })
        if (url.pathname === '/__fixture/state' && req.method === 'GET') return json(res, await state(Number(url.searchParams.get('sale'))))
        if (url.pathname === '/__fixture/select' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)).toString() || '{}')
          const sql = String(body.sql || '').trim().replace(/;\s*$/, '')
          if (!/^select\b/i.test(sql) || sql.includes(';')) throw new Error('select accepts exactly one read-only SELECT statement')
          return json(res, { rows: await all(sql, ...(Array.isArray(body.params) ? body.params : [])) })
        }
        if (url.pathname === '/__fixture/admin-call' && req.method === 'POST') {
          const body = JSON.parse((await readBody(req)).toString() || '{}')
          if (!/^\/api\//.test(String(body.path)) || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(body.method)) throw new Error('Unsupported fixture administrator request')
          const result = await dispatch(body.path, body.method, body.body, adminCookie)
          return json(res, { status: result.status, body: result.body })
        }
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
          const body = await readBody(req)
          const response = await mf.dispatchFetch(url.href, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) })
          res.statusCode = response.status
          for (const [name, value] of response.headers) res.setHeader(name, value)
          return res.end(Buffer.from(await response.arrayBuffer()))
        }
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
        const file = path.resolve(dist, relative || 'index.html')
        if (!file.startsWith(dist + path.sep) && file !== path.join(dist, 'index.html')) throw new Error('Path escape')
        const candidate = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html')
        res.setHeader('content-type', MIME[path.extname(candidate)] || 'application/octet-stream'); res.setHeader('cache-control', 'no-store'); fs.createReadStream(candidate).pipe(res)
      } catch (error) { json(res, { error: error.message }, 500); console.error(error) }
    })
    await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  } catch (error) {
    await close().catch(() => undefined)
    throw error
  }
  return { origin, info, seed: SEED, mf, db, close }
}

module.exports = { startMoneyFixture, SEED }

if (require.main === module) {
  let fixture
  const stop = () => (fixture ? fixture.close() : Promise.resolve()).then(() => process.exit(0))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop)
  startMoneyFixture().then(started => { fixture = started; console.log(`E2E_MONEY_READY ${started.origin} migrations=${started.info.migrations.length}`) })
    .catch(error => { console.error(error); process.exitCode = 1 })
}
