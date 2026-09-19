// Real projection, Hono middleware and routes. D1 tripwire proves unauthorized
// cost edits cannot read or write stored prices, including redacted-zero clients.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const root = path.join(__dirname, '../src')
const modules = new Map()
let user, dbOpens = 0, checks = 0
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports
  const mod = { exports: {} }; modules.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText
  new Function('require', 'module', 'exports', output)(name => {
    if (name === '../lib/auth') return { requireAuth: async (c, next) => {
      if (!user) return c.json({ error: 'Unauthenticated' }, 401)
      c.set('user', user); return next()
    } }
    if (name === '../lib/db' || name === './db') return { ...load(path.join(root, 'lib/db.ts')), getDb: () => {
      dbOpens++; throw new Error('D1 tripwire')
    } }
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`))
    return require(name)
  }, mod, mod.exports)
  return mod.exports
}
const { projectAcquisitionCosts, acquisitionCostResponses, hasCatalogCostWrite, hasAcquisitionCostInput } = load(path.join(root, 'lib/acquisitionCostAccess.ts'))
const actor = (role_code, permissions = {}, role_permissions = {}) => ({ id: 7, username: 'staff', role_code, permissions: JSON.stringify(permissions), role_permissions: JSON.stringify(role_permissions) })
const manager = actor('manager', { products: true, inventory: true, pos: true, sales: true })
const admins = [actor('admin'), { ...actor('staff'), username: ' ADMIN ' }, actor('manager', { all: true }), actor('staff', {}, { all: true })]
const staff = [manager, actor('cashier', { pos: true }), actor('staff', { products: true, inventory: true }), actor('manager', { all: false }, { all: true })]
const cached = {
  items: [{ id: 1, name: 'Product', quantity: 2, selling_price_usd: 15, wholesale_price_usd: 12,
    cost_price_usd: 7, cost_price_khr: 28000, purchase_price_usd: 7,
    batches: [{ unit_cost_usd: 6, received_cost_usd: 60, batch_unit_cost_usd: 6, total_qty: 10 }],
    stock_value_usd: 14, cogs_usd: 7, gross_profit_usd: 8, margin_pct: 53, revenue_after_losses_usd: 9,
    delivery_actual_cost_usd: 3, recognized_delivery_cost_usd: 3,
  }],
  undo_payload: { applier: 'product.update', before: { cost_price_usd: 7, selling_price_usd: 15 } },
  details: JSON.stringify({ before: { cost_price_usd: 7, name: 'Old' }, after: { purchase_price_usd: 8, name: 'New' } }),
  losing_json: JSON.stringify({ cost_price_khr: 28000, quantity: 1 }),
  changes: [{ field: 'cost_price_usd', before: 7, after: 8 }, { field: 'selling_price_usd', before: 15, after: 16 }],
  note: 'Customer requested this product',
}
const original = JSON.stringify(cached)
for (const actor of staff) {
  const redacted = projectAcquisitionCosts(cached, actor)
  assert.equal(JSON.stringify(cached), original)
  assert.deepEqual(redacted.items[0], { id: 1, name: 'Product', quantity: 2, selling_price_usd: 15, wholesale_price_usd: 12,
    batches: [{ total_qty: 10 }], delivery_actual_cost_usd: 3, recognized_delivery_cost_usd: 3 })
  assert.deepEqual(redacted.undo_payload, { applier: 'product.update', before: { selling_price_usd: 15 } })
  assert.deepEqual(JSON.parse(redacted.details), { before: { name: 'Old' }, after: { name: 'New' } })
  assert.deepEqual(JSON.parse(redacted.losing_json), { quantity: 1 })
  assert.deepEqual(redacted.changes[0], { field: 'cost_price_usd', redacted: true })
  assert.deepEqual(redacted.changes[1], cached.changes[1])
  assert.equal(redacted.note, cached.note)
  for (const field of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']) {
    for (const value of [0, null, '', 7]) assert.equal(hasCatalogCostWrite({ [field]: value }, actor), true)
  }
  assert.equal(hasCatalogCostWrite({ name: 'Renamed', selling_price_usd: 16 }, actor), false)
  checks++
}
for (const actor of admins) {
  assert.equal(projectAcquisitionCosts(cached, actor), cached)
  assert.equal(hasCatalogCostWrite({ cost_price_usd: 0 }, actor), false)
  checks++
}
assert.deepEqual(projectAcquisitionCosts({ details: '{broken', old_value: '7', new_value: JSON.stringify({ cost_price_usd: 8 }) }, manager),
  { details: null, old_value: null, new_value: '{}' })
assert.equal(projectAcquisitionCosts({ details: 'x'.repeat(2_000_001) }, manager).details, null)
const supplier = { line_total_usd: 70, total_usd: 70, paid_usd: 50, outstanding_usd: 20, units_received: 10 }
assert.deepEqual(projectAcquisitionCosts(supplier, manager, true), { units_received: 10 })
assert.equal(projectAcquisitionCosts(supplier, manager).total_usd, 70, 'customer/sales revenue is retained')
checks += 4

const app = new Hono()
app.onError((error, c) => error.message === 'D1 tripwire' ? c.json({ reached: true }, 598) : (() => { throw error })())
app.route('/api/products', load(path.join(root, 'routes/products.ts')).default)
app.route('/api/products', load(path.join(root, 'routes/productCost.ts')).default)
app.route('/api/batches', load(path.join(root, 'routes/batches.ts')).default)
app.route('/api/inventory', load(path.join(root, 'routes/inventory.ts')).default)
const { commitStockSession } = load(path.join(root, 'lib/stockSession.ts'))
const fixture = new Hono()
fixture.use('*', async (c, next) => { c.set('user', user); await next() })
fixture.use('*', acquisitionCostResponses)
fixture.get('/cached', c => c.json(cached, 201, { 'X-Fixture': 'preserved' }))
fixture.get('/supplier', c => c.json(supplier))
app.route('/fixture', fixture)
async function request(url, actor, method = 'GET', body) {
  user = actor; dbOpens = 0
  return app.request(`http://test${url}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) }, {})
}
async function main() {
  for (const actor of staff) {
    let res = await request('/api/products/1/cost-breakdown', actor)
    assert.equal(res.status, 403); assert.equal(dbOpens, 0)
    for (const [url, method, body] of [
      ['/api/products/1', 'PUT', { name: 'Product', cost_price_usd: 0 }],
      ['/api/products/1', 'PUT', { purchase_price_khr: null }],
      ['/api/products', 'POST', { name: 'Product', cost_price_usd: 0 }],
      ['/api/products/bulk-price-adjust', 'POST', { fields: ['cost_price_usd'], amount: 1 }],
      ['/api/inventory/adjust', 'POST', { type: 'add', productId: 1, quantity: 1, unitCostUsd: 0 }],
      ['/api/batches', 'POST', { product_id: 1, branch_id: 1, quantity: 1, unit_cost_usd: 0 }],
    ]) {
      res = await request(url, actor, method, body)
      assert.equal(res.status, 403, `${method} ${url}`); assert.equal(dbOpens, 0)
      checks++
    }
    res = await request('/fixture/cached', actor)
    assert.equal(res.status, 201); assert.equal(res.headers.get('X-Fixture'), 'preserved')
    assert.equal(res.headers.get('Cache-Control'), 'private, no-store')
    assert.equal((await res.json()).items[0].cost_price_usd, undefined)
    checks++
    await assert.rejects(() => commitStockSession({}, actor, {}), error => error.statusCode === 403 && error.code === 'catalog_cost_admin_required')
    assert.equal(dbOpens, 0)
    assert.equal(hasAcquisitionCostInput({ pricing: { cost_usd: 0 } }, actor), true)
    assert.equal(hasAcquisitionCostInput({ type: 'remove', quantity: 1 }, actor), false)
    checks++
  }
  for (const actor of admins) {
    const res = await request('/api/products/1/cost-breakdown', actor)
    assert.equal(res.status, 598); assert.equal(dbOpens, 1, 'admin reaches real calculation reader')
    const full = await request('/fixture/cached', actor)
    assert.equal((await full.json()).items[0].cost_price_usd, 7)
    checks++
  }
  assert.equal((await request('/api/products/1/cost-breakdown', null)).status, 401)
  assert.equal(JSON.stringify(cached), original, 'alternating authority never poisons shared cache')
  console.log(`${checks} acquisition-cost checks passed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
