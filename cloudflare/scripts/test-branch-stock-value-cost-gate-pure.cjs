// Branch stock value is quantity x acquisition cost. GET /api/branches/:id/stock?page=1 returned it as
// summary.positive_value_usd / total_value_usd, key names the cost filter did not match, so a role holding
// Inventory View without product_cost_view could search ONE product and divide the value by that product's
// branch_quantity to read its unit cost (security review a77883c78, should-fix 1).
//
// Real Hono route + real cost projection over the production SQLite schema (every migration). RED on a77883c78.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { Hono } = require('hono')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }
const root = path.join(__dirname, '../src')
const modules = new Map()
let user, db
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports
  const mod = { exports: {} }
  modules.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  }).outputText
  new Function('require', 'module', 'exports', output)(name => {
    if (name === '../lib/auth') return { requireAuth: async (c, next) => { c.set('user', user); return next() } }
    if (name === '../lib/db' || name === './db') return { ...load(path.join(root, 'lib/db.ts')), getDb: () => db }
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`))
    return require(name)
  }, mod, mod.exports)
  return mod.exports
}
const access = load(path.join(root, 'lib/acquisitionCostAccess.ts'))
const app = new Hono()
app.route('/api/branches', load(path.join(root, 'routes/branches.ts')).default)
const env = { CACHE: { get: async () => null, put: async () => {} } }
const actor = (role = {}, overrides = {}) => ({ id: 17, name: 'Employee', username: 'employee', role_code: 'employee', role_permissions: JSON.stringify(role), permissions: JSON.stringify(overrides) })
const keysOf = (value, found = new Set()) => {
  if (Array.isArray(value)) value.forEach(item => keysOf(item, found))
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { found.add(key); keysOf(child, found) }
  return found
}
const VALUE_KEYS = ['positive_value_usd', 'total_value_usd', 'stock_value_unknown_products', 'stock_value_unknown_quantity', 'positive_stock_value_unknown_products']

let checks = 0

// The key rule itself: cost-derived totals are private, legitimate non-cost money is not.
function keyRule() {
  for (const key of ['positive_value_usd', 'total_value_usd', 'positive_value_khr', 'total_value_khr', 'positiveValueUsd', 'totalValueKhr', 'branch_total_value_usd', 'positive_stock_value_unknown_products']) {
    assert.equal(access.isAcquisitionCostKey(key), true, `${key} is derived from acquisition cost`)
    checks++
  }
  for (const key of ['value_usd', 'redeem_value_usd', 'customer_portal_redeem_value_usd', 'redeemValueKhr', 'total_usd', 'total_khr', 'line_total_usd',
    'total_products', 'total_amount_usd', 'selling_price_usd', 'discount_amount_usd', 'positive_products', 'delivery_cost_usd', 'actual_cost_usd']) {
    assert.equal(access.isAcquisitionCostKey(key), false, `${key} is not cost-derived`)
    checks++
  }
  assert.ok(access.ACQUISITION_COST_TEXT_PATTERNS.some(p => /positive/.test(p)) && access.ACQUISITION_COST_TEXT_PATTERNS.some(p => /total/.test(p)),
    'stored text carrying the new private keys is excluded from a hidden-field search')
  checks++
}

// The route, on real rows: product cost 12, five on hand, so the value is 60.
async function routeRule() {
  const sqlite = new Database(':memory:')
  try {
    for (const file of fs.readdirSync(path.join(__dirname, '../migrations')).filter(f => f.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
    seedStockFixture(sqlite, () => sqlite.exec(`INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1);
      INSERT INTO products(id,name,sku,barcode,stock_quantity,cost_price_usd,purchase_price_usd,selling_price_usd) VALUES(1,'Example Cream','SKU1','BAR1',5,12,12,20),(2,'Unknown Cost','SKU2','BAR2',3,NULL,0,9);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,5),(2,1,3)`))
    db = {
      prepare(sql) {
        const stmt = sqlite.prepare(sql)
        return Object.fromEntries(['all', 'get', 'run'].map(method => [method, async params => Array.isArray(params) ? stmt[method](...params) : stmt[method](params || {})]))
      },
      async batch(items) {
        return items.map(item => {
          const stmt = sqlite.prepare(item.sql)
          return { results: Array.isArray(item.params) ? stmt.all(...item.params) : stmt.all(item.params || {}) }
        })
      },
    }
    async function stock(who, query) {
      user = who
      const response = await app.request(`http://local.test/api/branches/1/stock?${query}`, {}, env, { waitUntil() {}, passThroughOnException() {} })
      assert.equal(response.status, 200, query)
      return response.json()
    }

    for (const query of ['page=1&q=Example', 'page=1&q=BAR1&pageSize=20', 'page=1']) {
      for (const [label, who] of [
        ['Inventory View without cost', actor({ inventory: true })],
        ['Branches View without cost', actor({ branches: true })],
        ['cost explicitly off', actor({ inventory: true }, { product_cost_view: false })],
        ['cost EDIT only', actor({ inventory: true }, { product_cost_edit: true })],
      ]) {
        const body = await stock(who, query)
        const found = [...keysOf(body)]
        for (const key of VALUE_KEYS) assert.equal(key in body.summary, false, `${label} / ${query}: summary.${key} would reveal cost`)
        assert.deepEqual(found.filter(key => /value|cost|purchase|profit|margin/i.test(key)), [], `${label} / ${query}: no cost-bearing key anywhere in the payload`)
        assert.ok(body.items.length > 0 && body.items[0].branch_quantity > 0, `${label} / ${query}: ordinary stock rows still delivered`)
        assert.equal(body.items[0].selling_price_usd !== undefined, true, `${label} / ${query}: selling price is not a cost`)
        assert.equal(typeof body.summary.in_stock_products, 'number', 'counts remain for a non-cost caller')
        checks++
      }
    }

    // Controls: viewers of cost keep every figure (a filter that strips everything would pass the loop above).
    for (const [label, who] of [
      ['cost viewer', actor({ inventory: true }, { product_cost_view: true })],
      ['administrator', { ...actor(), role_code: 'admin' }],
    ]) {
      const body = await stock(who, 'page=1&q=Example')
      assert.equal(body.summary.positive_value_usd, 60, `${label}: positive_value_usd = 5 x 12`)
      assert.equal(body.summary.total_value_usd, 60, `${label}: total_value_usd = 5 x 12`)
      assert.equal(typeof body.summary.positive_stock_value_unknown_products, 'number', `${label}: unknown-cost count kept`)
      assert.equal(body.items[0].cost_price_usd, 12, `${label}: item cost kept`)
      checks++
    }
    const unknown = await stock(actor({ inventory: true }, { product_cost_view: true }), 'page=1')
    assert.equal(unknown.summary.positive_stock_value_unknown_products, 1, 'the NULL-cost product is counted unknown, for a viewer')
    assert.equal(unknown.summary.positive_value_usd, 60)
    checks++
  } finally { sqlite.close() }
}

// Both run so a red base shows every failing half, not only the first.
async function main() {
  const failures = []
  for (const [name, rule] of [['route', routeRule], ['key rule', keyRule]]) {
    try { await rule() } catch (error) { failures.push(`${name}: ${String(error.message).split('\n')[0]}`) }
  }
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; return }
  console.log(`PASS ${checks} branch stock value cost-gate checks`)
}
main()
