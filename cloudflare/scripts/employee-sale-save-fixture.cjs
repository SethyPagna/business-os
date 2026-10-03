'use strict'
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
const port = Number(process.env.EMPLOYEE_SAVE_PORT || 4349)
const origin = `http://127.0.0.1:${port}`
const dist = path.resolve(process.env.EMPLOYEE_SAVE_DIST || path.join(repo, 'frontend/dist'))
const evidencePath = process.env.EMPLOYEE_SAVE_SERVER_RECEIPT
const password = 'e2e-password'
const actors = [
  { id: 901, username: 'e2e_admin', code: 'admin', permissions: { all: true } },
  { id: 911, username: 'e2e_employee_add', code: 'employee', permissions: { sales: true, 'sales:add_items': true, 'sales:amend': false, pos: false, products: false, product_cost_view: false, product_cost_edit: false } },
  { id: 912, username: 'e2e_employee_amend', code: 'employee', permissions: { sales: true, 'sales:add_items': false, 'sales:amend': true, pos: false, products: false, product_cost_view: false, product_cost_edit: false } },
  { id: 913, username: 'e2e_employee_view', code: 'employee', permissions: { sales: 'view', 'sales:add_items': true, 'sales:amend': true, pos: false, products: false, product_cost_view: false, product_cost_edit: false } },
]
const products = [{ id: 201, name: 'E2E Original Powder', price: 9.5 }, { id: 202, name: 'E2E Added Serum', price: 7.25 }, { id: 203, name: 'E2E Replacement Balm', price: 3 }]
const receipt = { startedAtUTC: new Date().toISOString(), runtime: process.version, origin, dist, migrations: [], skippedEmptyAliasInsert: 0, requests: [], outboundRefusals: [], actors: actors.map(({ id, username, code, permissions }) => ({ id, username, code, permissions })), products, limits: ['Disposable ephemeral native workerd/D1/R2/KV only.', 'Fixture state queries are host-side observations; business API and session/grant enforcement are actual Worker.', 'Built assets served by local host; no external origins permitted.'] }
receipt.pid = process.pid
let mf, server, adminCookie, sequence = 0
const record = () => { if (evidencePath) fs.writeFileSync(evidencePath, JSON.stringify(receipt, null, 2) + '\n') }

async function main() {
  const git = args => execFileSync('git', ['-c', 'safe.directory=' + repo.replaceAll('\\', '/'), '-C', repo, ...args], { encoding: 'utf8', windowsHide: true }).trim()
  receipt.sourceHead = git(['rev-parse', 'HEAD'])
  receipt.trackedChanges = git(['status', '--porcelain', '--untracked-files=no'])
  receipt.frontendBuild = JSON.parse(fs.readFileSync(path.join(dist, 'business-os-build.json'), 'utf8'))
  if (receipt.trackedChanges) throw Error('Native fixture requires clean committed tracked source')
  const bundle = await build({ entryPoints: [path.join(root, 'src/index.ts')], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', external: ['node:*', 'cloudflare:*'], logLevel: 'silent' })
  receipt.workerBundleSHA256 = createHash('sha256').update(bundle.outputFiles[0].text).digest('hex')
  mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], r2Buckets: ['ASSETS'], kvNamespaces: ['CACHE'],
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    bindings: { PLAN_TIER: 'paid', BUSINESS_OS_PUBLIC_URL: origin, BUSINESS_OS_ADMIN_URL: origin, BUSINESS_OS_ORGANIZATION_SLUG: 'leang-cosmetics', BUSINESS_OS_ORGANIZATION_NAME: 'Disposable E2E' },
    outboundService: request => { receipt.outboundRefusals.push({ method: request.method, url: request.url }); return new Response('External network refused by local fixture', { status: 503 }) }, log: new Log(LogLevel.ERROR) })
  const db = await mf.getD1Database('DB')
  const run = (sql, ...values) => db.prepare(sql).bind(...values).run()
  const all = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results
  receipt.foreignKeys = await all('PRAGMA foreign_keys')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
    for (const statement of splitSql(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))) {
      if (file === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) { receipt.skippedEmptyAliasInsert++; continue }
      try { await run(statement) } catch (error) { throw new Error(`Migration ${file}: ${error.message}`) }
    }
    receipt.migrations.push(file)
  }
  const org = (await all('SELECT id FROM organizations ORDER BY id LIMIT 1'))[0]
  const hash = bcrypt.hashSync(password, 10)
  for (const actor of actors) {
    await run('INSERT INTO roles(id,name,code,permissions,is_system) VALUES(?,?,?,?,0)', actor.id, `E2E ${actor.username}`, actor.code, JSON.stringify(actor.permissions))
    await run('INSERT INTO users(id,username,name,password,role_id,permissions,is_active,organization_id,must_change_password) VALUES(?,?,?,?,?,\'{}\',1,?,0)', actor.id, actor.username, `E2E ${actor.username}`, hash, actor.id, org.id)
    if (actor.code !== 'admin') await run("INSERT INTO trusted_devices(user_id,device_id,device_name,status,decided_at,decided_by_user_id,decided_by_name) VALUES(?,?,?,'approved',CURRENT_TIMESTAMP,901,'E2E Administrator')", actor.id, `employee-save-device-${actor.id}`, 'Disposable browser fixture')
  }
  await run("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)")
  await run("INSERT INTO branches(id,name,is_default,is_active) VALUES(2,'Warehouse',0,1)")
  for (const p of products) {
    await run('INSERT INTO products(id,name,barcode,sku,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active) VALUES(?,?,?,?,100,?,?,1.2345,4938,1)', p.id, p.name, `8850000000${p.id}`, `E2E-${p.id}`, p.price, p.price * 4000)
    await run('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,100)', p.id)
    await run("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number) VALUES(?,?,?,?,'2026-09-01',1,1)", p.id + 500, p.id, `e2e-batch-${p.id}`, `E2E-${p.id}`)
    await run('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,100)', p.id + 500)
  }
  await run("INSERT INTO settings(key,value) VALUES('exchange_rate','4000') ON CONFLICT(key) DO UPDATE SET value=excluded.value")
  async function dispatch(url, method, body, cookie) {
    const response = await mf.dispatchFetch(origin + url, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie') }
  }
  const login = await dispatch('/api/auth/login', 'POST', { username: 'e2e_admin', password, organizationId: org.id }, undefined)
  if (login.status !== 200 || !login.cookie) throw new Error(`Actual admin fixture login failed: ${login.status} ${JSON.stringify(login.body)}`)
  adminCookie = login.cookie.split(';')[0]
  receipt.foreignKeyCheck = await all('PRAGMA foreign_key_check')
  if (receipt.foreignKeys[0]?.foreign_keys !== 1 || receipt.foreignKeyCheck.length) throw Error('Native fixture foreign-key enforcement/check failed')
  async function state(saleId) {
    return { sales: await all('SELECT * FROM sales WHERE id=?', saleId), lines: await all('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id', saleId), allocations: await all('SELECT a.* FROM sale_item_batch_allocations a JOIN sale_items s ON s.id=a.sale_item_id WHERE s.sale_id=? ORDER BY a.id', saleId),
      stock: await all('SELECT * FROM branch_stock WHERE product_id IN(201,202,203) ORDER BY product_id,branch_id'), lots: await all('SELECT * FROM branch_batch_stock WHERE batch_id IN(701,702,703) ORDER BY batch_id,branch_id'),
      movements: await all('SELECT * FROM inventory_movements WHERE product_id IN(201,202,203) ORDER BY id'), amendments: await all('SELECT * FROM sale_amendments WHERE sale_id=? ORDER BY id', saleId),
      history: await all('SELECT * FROM action_history ORDER BY id'), audits: await all('SELECT id,action,entity,entity_id,user_id,user_name FROM audit_logs ORDER BY id'),
      receipts: await all('SELECT * FROM sale_mutation_receipts WHERE sale_id=? ORDER BY rowid', saleId),
      revision: await all('SELECT * FROM sale_write_revisions WHERE sale_id=?', saleId), foreignKeyCheck: await all('PRAGMA foreign_key_check') }
  }
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin)
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw Error('Non-loopback request')
      if (url.pathname === '/__fixture/shutdown' && req.method === 'POST') { res.end('Closing own disposable fixture'); setImmediate(() => close().then(() => process.exit(0))); return }
      if (url.pathname === '/__fixture/ready') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ready: true, sourceHead: receipt.sourceHead, frontendBuild: receipt.frontendBuild, migrations: receipt.migrations.length, products, actors: actors.filter(a => a.code !== 'admin') })) }
      if (url.pathname === '/__fixture/state' && req.method === 'GET') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(await state(Number(url.searchParams.get('sale'))))) }
      if (url.pathname === '/__fixture/admin-call' && req.method === 'POST') {
        const body = await new Promise((resolve, reject) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())) } catch (error) { reject(error) } }); req.on('error', reject) })
        if (!/^\/api\/sales\/\d+(\/(items|amendments))?$/.test(body.path) || !['GET', 'POST'].includes(body.method)) throw Error('Unsupported fixture competitor request')
        const result = await dispatch(body.path, body.method, body.body, adminCookie)
        res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ status: result.status, body: result.body }))
      }
      if (url.pathname === '/__fixture/create-sale' && req.method === 'POST') {
        const body = { branch_id: 1, money_precision_version: 1, sale_status: 'awaiting_payment', items: [{ product_id: 201, quantity: 1, branch_id: 1, batch_id: 701, client_line_key: 'initial', pricing_source: 'selling', pricing_quote: { gross_usd: 9.5, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 9.5, total_khr: 38000 } }], exchange_rate: 4000, payment_method: 'Cash', payment_currency: 'USD', amount_paid_usd: 0, client_request_id: `employee-fixture-${++sequence}`, offline_owner: { version: 1, actor_id: 901, organization_id: org.id, authority: origin, runtime: 'cloudflare-workers' } }
        const created = await dispatch('/api/sales', 'POST', body, adminCookie)
        if (created.status !== 200) throw Error(`Actual fixture sale create refused ${created.status}: ${JSON.stringify(created.body)}`)
        res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(created.body))
      }
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
        const body = await new Promise((resolve, reject) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject) })
        const response = await mf.dispatchFetch(url.href, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) })
        receipt.requests.push({ method: req.method, path: url.pathname, status: response.status }); record()
        res.statusCode = response.status
        for (const [name, value] of response.headers) res.setHeader(name, value)
        return res.end(Buffer.from(await response.arrayBuffer()))
      }
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const file = path.resolve(dist, relative || 'index.html')
      if (!file.startsWith(dist + path.sep) && file !== path.join(dist, 'index.html')) throw Error('Path escape')
      const candidate = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(dist, 'index.html')
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
      res.setHeader('content-type', mime[path.extname(candidate)] || 'application/octet-stream'); res.setHeader('cache-control', 'no-store'); fs.createReadStream(candidate).pipe(res)
    } catch (error) { res.statusCode = 500; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ error: error.message })); console.error(error) }
  })
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))
  receipt.readyAtUTC = new Date().toISOString(); record(); console.log(`EMPLOYEE_SAVE_READY ${origin} migrations=${receipt.migrations.length}`)
}
async function close() { if (server) await new Promise(resolve => server.close(resolve)); if (mf) await mf.dispose(); receipt.closedAtUTC = new Date().toISOString(); record() }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close().then(() => process.exit(0)))
main().catch(async error => { receipt.error = { name: error.name, message: error.message, stack: error.stack }; record(); console.error(error); await close(); process.exitCode = 1 })
