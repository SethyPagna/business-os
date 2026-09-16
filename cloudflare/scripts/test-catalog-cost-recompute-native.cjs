// P10-4 (owner ruling, 2026-09-16, verbatim): "check and make sure all the
// actions add, edit, remove, set, etc... sessions, make sure if different
// costs it adds and divide by number of different costs (excluding zero and
// empty costs)". This pins that products.cost_price_usd/khr is actually
// RE-DERIVED from the DISTINCT non-zero active-lot costs after every writer
// that records a new lot cost -- not left pinned to whichever receipt wrote
// the scalar column last.
//
// Real Hono /adjust handler, real lib/catalogCostRecompute.ts, real
// resolveMergedCostDetail, transactional in-memory SQLite over the actual
// migrations. Only auth/broadcast/cache/telegram are stubbed.
//
// Run (from cloudflare/): node scripts/test-catalog-cost-recompute-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')

let sqlite
let waits = []
let user = { id: 7, name: 'Operator', permissions: JSON.stringify({ inventory: true }) }
const modules = new Map()

function wrapDb() {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      return Object.fromEntries(['get', 'all', 'run'].map((method) => [method, async (params) => Array.isArray(params) ? statement[method](...params) : statement[method](params || {})]))
    },
    async batch(statements) {
      return sqlite.transaction(() => statements.map(({ sql, params }) => sqlite.prepare(sql).run(params || {})))()
    },
  }
}

// Everything under lib/ is loaded for real (transpiled from source); only
// the small set of side-effecting externals below are stubbed.
function load(relative) {
  if (modules.has(relative)) return modules.get(relative)
  const module = { exports: {} }
  modules.set(relative, module.exports)
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('exports', 'require', 'module', code)(module.exports, (id) => {
    if (id === 'hono') return require('hono')
    const name = id.split('/').at(-1)
    if (name === 'db') return { ...load('lib/db.ts'), getDb: wrapDb }
    if (name === 'auth') return { requireAuth: async (c, next) => { c.set('user', user); return next() } }
    if (name === 'broadcastHub') return { broadcast: async () => {} }
    if (name === 'cache') return { bumpVersion: async () => {} }
    if (name === 'telegram') return { formatStockChangeTelegramLines: () => [], formatTransferTelegramLines: () => [], sendTelegramEvent: async () => {} }
    if (id.startsWith('../lib/') || id.startsWith('./')) {
      const resolved = id.startsWith('../lib/') ? `lib/${name}.ts` : `lib/${name}.ts`
      if (fs.existsSync(path.join(__dirname, '../src', resolved))) return load(resolved)
    }
    return new Proxy({}, { get: (_target, property) => () => { throw new Error(`Unexpected dependency ${id}.${String(property)}`) } })
  }, module)
  modules.set(relative, module.exports)
  return module.exports
}

const inventory = load('routes/inventory.ts').default
inventory.onError((error, c) => c.json({ error: error.message }, 500))

function fresh() {
  sqlite = new Database(':memory:')
  const migrations = fs.readdirSync(path.join(__dirname, '../migrations')).filter((file) => file.endsWith('.sql')).sort()
  for (const file of migrations) sqlite.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
  sqlite.exec("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)")
  sqlite.exec("INSERT INTO products(id,name,stock_quantity,cost_price_usd,cost_price_khr) VALUES(1,'Widget',0,0,0)")
  waits = []
  user = { id: 7, name: 'Operator', permissions: JSON.stringify({ inventory: true }) }
}

async function request(body) {
  const response = await inventory.request('/adjust', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, {}, {
    waitUntil: (promise) => { waits.push(Promise.resolve(promise)) }, passThroughOnException: () => {},
  })
  await Promise.all(waits.splice(0))
  return { status: response.status, body: await response.json() }
}

function catalogCost() {
  const row = sqlite.prepare('SELECT cost_price_usd, cost_price_khr FROM products WHERE id=1').get()
  return { usd: row.cost_price_usd, khr: row.cost_price_khr }
}

function addBody(overrides) {
  return {
    productId: 1, type: 'add', quantity: 1, reason: 'Restock', branchId: 1,
    supplierName: 'Acme', unitCostUsd: 3, batchId: 'new', ...overrides,
  }
}

let checks = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) }
  catch (e) { console.log(`FAIL ${name} - ${e.stack}`); process.exitCode = 1 }
}

async function main() {
  await check('a single receipt sets the catalog cost to that receipt cost', async () => {
    fresh()
    const result = await request(addBody({ unitCostUsd: 3, receivedDate: '01/09/2026' }))
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.deepEqual(catalogCost(), { usd: 3, khr: 0 })
  })

  await check('two distinct non-zero lot costs (3.00, 5.00) average to 4.00 -- not the last-written figure', async () => {
    fresh()
    const first = await request(addBody({ unitCostUsd: 3, receivedDate: '01/09/2026' }))
    assert.equal(first.status, 200, JSON.stringify(first))
    assert.deepEqual(catalogCost(), { usd: 3, khr: 0 })
    const second = await request(addBody({ unitCostUsd: 5, receivedDate: '02/09/2026' }))
    assert.equal(second.status, 200, JSON.stringify(second))
    assert.deepEqual(catalogCost(), { usd: 4, khr: 0 })
  })

  await check('a third free-goods (0) receipt is excluded from the mean -- stays 4.00, not 8/3', async () => {
    fresh()
    await request(addBody({ unitCostUsd: 3, receivedDate: '01/09/2026' }))
    await request(addBody({ unitCostUsd: 5, receivedDate: '02/09/2026' }))
    const third = await request(addBody({ unitCostUsd: 0, freeGoods: true, receivedDate: '03/09/2026' }))
    assert.equal(third.status, 200, JSON.stringify(third))
    assert.deepEqual(catalogCost(), { usd: 4, khr: 0 })
  })

  await check('a repeated receipt at the SAME cost stays a single distinct value (double-apply does not shift the mean)', async () => {
    fresh()
    await request(addBody({ unitCostUsd: 3, receivedDate: '01/09/2026' }))
    await request(addBody({ unitCostUsd: 3, receivedDate: '02/09/2026' }))
    // Same distinct cost twice averages to itself, not (3+3)/2 being treated
    // as two separate lots at different prices -- resolveMergedCostDetail
    // already dedupes by VALUE, this only proves the writer feeds it that way.
    assert.deepEqual(catalogCost(), { usd: 3, khr: 0 })
    await request(addBody({ unitCostUsd: 4, receivedDate: '03/09/2026' }))
    assert.deepEqual(catalogCost(), { usd: 3.5, khr: 0 })
  })

  await check('a deactivated (reverted) lot no longer feeds the mean', async () => {
    fresh()
    await request(addBody({ unitCostUsd: 3, receivedDate: '01/09/2026' }))
    await request(addBody({ unitCostUsd: 5, receivedDate: '02/09/2026' }))
    assert.deepEqual(catalogCost(), { usd: 4, khr: 0 })
    const revertedBatchId = sqlite.prepare('SELECT id FROM product_batches WHERE unit_cost_usd=5').get().id
    sqlite.exec(`UPDATE branch_batch_stock SET quantity=0 WHERE batch_id=${revertedBatchId}`)
    sqlite.exec(`UPDATE product_batches SET is_active=0 WHERE id=${revertedBatchId}`)
    const third = await request(addBody({ unitCostUsd: 3, receivedDate: '03/09/2026' }))
    assert.equal(third.status, 200, JSON.stringify(third))
    // Recomputed against the now-active lots only (3, 3, and the fresh
    // receipt at 3) -- the deactivated 5.00 lot no longer pulls the mean up.
    assert.deepEqual(catalogCost(), { usd: 3, khr: 0 })
  })

  await check('a receipt more than 2x the cheapest distinct cost is an outlier -- the writer stores the HIGHEST, not a $6 mean nobody paid', async () => {
    fresh()
    await request(addBody({ unitCostUsd: 3, receivedDate: '01/09/2026' }))
    assert.deepEqual(catalogCost(), { usd: 3, khr: 0 })
    const second = await request(addBody({ unitCostUsd: 9, receivedDate: '02/09/2026' }))
    assert.equal(second.status, 200, JSON.stringify(second))
    // 9 > 3 * COST_OUTLIER_RATIO(2) -- refused as a mean; highest kept instead.
    assert.deepEqual(catalogCost(), { usd: 9, khr: 0 })
  })

  console.log(`\n${checks} checks passed`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
