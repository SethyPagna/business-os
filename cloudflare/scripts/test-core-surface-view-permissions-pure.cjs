// Real Hono routes + real permission helpers; forbidden reads must not open D1.
// Positive payload assertions execute against the complete production SQLite schema.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { Hono } = require('hono')
// Workers Cache API runtime boundary; producers and route logic remain real.
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }
const root = path.join(__dirname, '../src')
const modules = new Map()
let user, db, opens = 0, reads = 0, checks = 0
class Tripwire extends Error {}
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports
  const mod = { exports: {} }
  modules.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText
  new Function('require', 'module', 'exports', output)(name => {
    if (name === '../lib/auth') return { requireAuth: async (c, next) => {
      if (!user) return c.json({ error: 'Unauthenticated' }, 401)
      c.set('user', user)
      return next()
    } }
    if (name === '../lib/db' || name === './db') return { ...load(path.join(root, 'lib/db.ts')), getDb: () => { opens++; return db } }
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`))
    return require(name)
  }, mod, mod.exports)
  return mod.exports
}
const app = new Hono()
app.onError((error, c) => {
  if (error instanceof Tripwire) return c.json({ tripwire: true }, 598)
  throw error
})
for (const name of ['products', 'inventory', 'branches']) app.route(`/api/${name}`, load(path.join(root, `routes/${name}.ts`)).default)
app.route('/api', load(path.join(root, 'routes/compat.ts')).default)
const staff = (role = {}, overrides = {}) => ({ id: 17, name: 'Employee', username: 'employee', role_code: 'employee', role_permissions: JSON.stringify(role), permissions: JSON.stringify(overrides) })
const env = { CACHE: { get: async () => null, put: async () => {} } }
async function request(url, session, options = {}, fixture) {
  user = session; opens = reads = 0
  db = fixture || { prepare() {
    reads++
    const trip = async () => { throw new Tripwire('Data access reached') }
    return { get: trip, all: trip, run: trip }
  } }
  const waits = []
  const response = await app.request(`http://local.test/api${url}`, options, env, { waitUntil: p => waits.push(p), passThroughOnException() {} })
  await Promise.all(waits)
  checks++
  return response
}
async function denied(url, session, method = 'GET') {
  const response = await request(url, session, { method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}) })
  assert.equal(response.status, 403, `${method} ${url}`)
  assert.equal(opens, 0, `${method} ${url}: must deny before getDb`)
  assert.equal(reads, 0, `${method} ${url}: must deny before prepare`)
}
async function reachesData(url, session, method = 'GET') {
  const response = await request(url, session, { method })
  assert.notEqual(response.status, 403, `${method} ${url}: grant retained`)
  assert.ok(reads > 0, `${method} ${url}: real read handler reached (${response.status})`)
}
const catalog = ['/products', '/products/search', '/products/bootstrap']
const detail = ['/products/1/detail-report', '/products/1/sales-detail?period=2026-09-01', '/products/1/supplier-purchases?supplierKey=1', '/products/stock-in-sessions', '/products/stock-ledger', '/products/auto-merges/1']
const productReads = [...catalog, ...detail, '/products/stock-in-session-lines?key=invalid', '/products/filters', '/products/bulk-delete-jobs/job', '/products/lookups/usage']
const inventoryReads = ['/inventory/products/search', '/inventory/bootstrap', '/inventory/summary', '/inventory/stats', '/inventory/movements', '/inventory/reasons', '/inventory/reasons/impact?from=old&to=new', '/inventory/rfid/status', '/inventory/rfid/tags/search', '/inventory/rfid/sessions/1/review']
const branchReads = ['/branches/summary', '/branches/stock-integrity', '/branches/1/stock', '/branches/1/stock?page=1', '/transfers']
const revoked = { 'products:view': false, 'inventory:view': false, 'branches:view': false, 'sales:view': false, 'promotions:view': false }
async function main() {
  for (const [section, urls] of Object.entries({ products: productReads, inventory: inventoryReads, branches: branchReads })) {
    for (const tier of [true, 'review']) for (const url of urls) {
      await denied(url, staff({ [section]: tier }, revoked))
      await denied(url, staff({ [section]: tier }, revoked), 'HEAD')
    }
    for (const malformed of [false, 'view', 'true', 'false', 1, {}, [], null]) for (const url of urls) await denied(url, staff({ [section]: malformed }))
    for (const url of urls) await denied(url, staff({ [section]: true }, { [section]: false }))
  }
  for (const malformed of ['true', 'false', 'review', 'view', 1, {}, [], null, false]) {
    for (const url of ['/products', '/inventory/summary', '/branches/summary', '/branches/1/stock']) await denied(url, staff({ all: malformed }))
  }
  for (const raw of ['{bad', 'null', '[true]', 'true', '1']) await denied('/products', { ...staff(), permissions: raw, role_permissions: raw })
  for (const section of ['products', 'inventory', 'branches']) {
    const url = section === 'products' ? '/products' : `/${section}/summary`
    await reachesData(url, staff({ [section]: true, [`${section}:view`]: false }, { [`${section}:view`]: true }))
    for (const tier of [true, 'review']) await reachesData(url, staff({ [section]: tier }))
    // Non-false action values preserve the shared helper's established semantics.
    for (const value of ['false', 'review', 1, null]) await reachesData(url, staff({ [section]: true }, { [`${section}:view`]: value }))
  }
  for (const admin of [{ ...staff({}, revoked), username: ' ADMIN ' }, { ...staff({}, revoked), role_code: ' AdMiN ' }, staff({ all: true }, revoked)]) {
    for (const url of [...catalog, ...detail, '/inventory/summary', ...branchReads]) await reachesData(url, admin)
  }
  for (const url of catalog) {
    for (const surface of ['pos', 'inventory']) await denied(`${url}?surface=${surface}`, staff({ products: true }))
    for (const grant of [{ pos: true }, { sales: true }]) await reachesData(`${url}?surface=pos`, staff({ products: true, ...grant }, { 'products:view': false }))
    await denied(`${url}?surface=pos`, staff({ sales: 'view' }))
    await denied(`${url}?surface=pos`, staff({ sales: true }, { 'sales:view': false }))
    await reachesData(`${url}?surface=inventory`, staff({ inventory: 'review', products: true }, { 'products:view': false }))
    await denied(`${url}?surface=inventory`, staff({ inventory: true }, { 'inventory:view': false }))
    await reachesData(url, staff({ products: true, products_image_only: true }, revoked))
  }
  for (const url of detail) {
    await reachesData(url, staff({ products: true, inventory: 'review' }, { 'products:view': false }))
    await denied(url, staff({ products: true, products_image_only: true }, revoked))
  }
  await reachesData('/products/filters', staff({ promotions: 'view' }))
  await denied('/products/filters', staff({ promotions: true }, { 'promotions:view': false }))
  // Ordinary branch stock is shared Inventory data, not a transfer-only plan.
  for (const tier of [true, 'review']) for (const url of ['/branches/1/stock', '/branches/1/stock?page=1', '/transfers']) {
    await reachesData(url, staff({ inventory: tier, branches: true }, { 'branches:view': false, 'inventory:transfer': false }))
    await denied(url, staff({ inventory: tier }, { 'inventory:view': false }))
  }
  await denied('/branches/1/stock', staff({ inventory: 'view' }))
  for (const url of ['/branches/summary', '/branches/stock-integrity']) await denied(url, staff({ inventory: true }))
  for (const section of ['inventory', 'branches']) {
    for (const tier of ['review', 'view']) await denied(`/${section}/transfer`, staff({ [section]: tier }), 'POST')
    await denied(`/${section}/transfer`, staff({ [section]: true }, { [`${section}:transfer`]: false }), 'POST')
    const response = await request(`/${section}/transfer`, staff({ [section]: true }, revoked), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"transfer_provenance_version":1}' })
    assert.equal(response.status, 400, `${section}: view denial must not revoke independently authorized transfer`)
    assert.equal(opens, 0)
  }
  // Action-specific reads and product-only session entry must not inherit view denial.
  await reachesData('/products/merge-duplicates/preview', staff({ products: true }, revoked))
  await denied('/products/merge-duplicates/preview', staff({ products: true }, { 'products:merge_duplicates': false }))
  const sessionResponse = await request('/inventory/sessions', staff({ products: true }, revoked), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  assert.equal(sessionResponse.status, 400)
  assert.equal(opens, 0)
  await denied('/inventory/sessions', staff({ products: true }, { 'products:add': false }), 'POST')
  await denied('/inventory/summary', staff({ products: true }))

  const sqlite = new Database(':memory:')
  try {
    for (const file of fs.readdirSync(path.join(__dirname, '../migrations')).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
    sqlite.exec("INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1),(2,'Warehouse',1); INSERT INTO products(id,name,sku,barcode,stock_quantity,cost_price_usd,purchase_price_usd,selling_price_usd) VALUES(1,'Example','SKU1','BAR1',5,12,12,20); INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,5)")
    const fixture = { prepare(sql) {
      reads++
      const stmt = sqlite.prepare(sql)
      return Object.fromEntries(['all', 'get', 'run'].map(method => [method, async params => Array.isArray(params) ? stmt[method](...params) : stmt[method](params || {})]))
    } }
    const picker = await request('/branches', staff({}, revoked), {}, fixture)
    assert.equal(picker.status, 200)
    assert.deepEqual((await picker.json()).map(row => row.name).sort(), ['Shop', 'Warehouse'])
    const unauthenticated = await request('/branches', null, {}, fixture)
    assert.equal(unauthenticated.status, 401); assert.equal(opens, 0)
    for (const tier of [true, 'review']) for (const suffix of ['', '?page=1']) {
      const response = await request(`/branches/1/stock${suffix}`, staff({ inventory: tier }, { 'inventory:transfer': false }), {}, fixture)
      assert.equal(response.status, 200)
      const payload = await response.json()
      const rows = Array.isArray(payload) ? payload : payload.items
      assert.equal(rows[0].branch_quantity, 5)
      assert.equal(rows[0].barcode, 'BAR1')
    }
    for (const url of ['/products', '/products/search', '/products/bootstrap?metadata=skip']) {
      const imageOnly = await request(url, staff({ products: true, products_image_only: true }, revoked), {}, fixture)
      assert.equal(imageOnly.status, 200, url)
      const payload = await imageOnly.json()
      const row = Array.isArray(payload) ? payload[0] : payload.items[0]
      assert.equal(row.id, 1)
      for (const key of ['cost_price_usd', 'purchase_price_usd', 'selling_price_usd', 'stock_quantity', 'branch_stock']) assert.equal(key in row, false, `${url}: image-only must hide ${key}`)
    }
    const pos = await request('/products?surface=pos', staff({ pos: true, products_image_only: true, products: true }, revoked), {}, fixture)
    assert.equal(pos.status, 200)
    assert.equal((await pos.json())[0].selling_price_usd, 20)
    const before = sqlite.prepare('SELECT total_changes() n').get().n
    for (const url of [...productReads, ...inventoryReads, ...branchReads]) {
      const response = await request(url, staff({ products: true, inventory: true, branches: true }, revoked), {}, fixture)
      assert.equal(response.status, 403, url); assert.equal(opens, 0); assert.equal(reads, 0)
    }
    assert.equal(sqlite.prepare('SELECT total_changes() n').get().n, before)
  } finally { sqlite.close() }
  // Keep transfer/replay action authority independent of page view. This
  // sibling harness uses the real Hono transfer/history routes, server applier,
  // exact provenance helpers and production-schema SQLite transaction wrapper.
  const transfers = require('./test-transfer-operation-receipt-pure.cjs')
  transfers.apps.history = transfers.load('routes/actionHistory.ts').default
  for (const section of ['inventory', 'branches']) {
    transfers.fresh(1)
    transfers.setUser(staff({ [section]: true }, revoked))
    const forward = await transfers.request(section, '/transfer', transfers.intent(1, 1, `view_denied_${section}`, false))
    assert.equal(forward.status, 200, JSON.stringify(forward))
    for (const [direction, generation] of [['undo', 0], ['redo', 1]]) {
      const replay = await transfers.request('history', `/${forward.body.action_history_id}/${direction}`, { require_applied: true, expected_generation: generation })
      assert.equal(replay.status, 200, JSON.stringify(replay))
      assert.equal(replay.body.applied, true)
    }
    transfers.setUser(staff({ [section]: true }, { [`${section}:transfer`]: false }))
    const blocked = await transfers.request('history', `/${forward.body.action_history_id}/undo`, { require_applied: true, expected_generation: 2 })
    assert.equal(blocked.status, 403)
    assert.equal(transfers.getDb().prepare('SELECT generation FROM transfer_operation_receipts').get().generation, 2)
    transfers.getDb().close()
    checks += 4
  }
  console.log(`PASS ${checks} core surface requests: effective view DB tripwires, alternate authority, action isolation, production-schema payloads`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
