// P10-4 (owner ruling, 2026-09-16, verbatim): "check and make sure all the
// actions add, edit, remove, set, etc... sessions, make sure if different
// costs it adds and divide by number of different costs (excluding zero and
// empty costs)". This pins that products.cost_price_usd/khr is actually
// RE-DERIVED from the DISTINCT non-zero active-lot costs after every writer
// that records a new lot cost -- not left pinned to whichever receipt wrote
// the scalar column last.
//
// U-cost (owner ruling, 2026-09-25) supersedes "divide by number of different
// costs": the catalog cost is the QUANTITY-WEIGHTED mean of the stock on hand,
// SUM(qty x cost) / SUM(qty), 0 costs still excluded. Receipts here are one
// unit each, so the distinct-cost cases below still read the same; the cases
// that differ say so.
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
const { loadStockLifecycleFixture, nativeStockFixtureBinding } = require('./harness/load_stock_lifecycle_fixture.cjs')

let sqlite
let waits = []
let externalEffects = []
let user = { id: 7, name: 'Operator', permissions: JSON.stringify({ inventory: true, product_cost_edit: true, product_cost_view: true }) }
const modules = new Map()

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
    if (id === 'hono' || id === 'hono/http-exception') return require(id)
    const name = id.split('/').at(-1)
    if (['db', 'importMaintenanceFence', 'stockLifecycle'].includes(name)) return loadStockLifecycleFixture(`lib/${name}.ts`)
    if (name === 'auth') return { requireAuth: async (c, next) => { c.set('user', user); return next() } }
    if (name === 'broadcastHub') return { broadcast: async () => { externalEffects.push('broadcast') } }
    if (name === 'cache') return { bumpVersion: async () => { externalEffects.push('cache') } }
    if (name === 'telegram') return { formatStockChangeTelegramLines: () => [], formatTransferTelegramLines: () => [], sendTelegramEvent: async () => { externalEffects.push('telegram') } }
    if (id.startsWith('../lib/') || id.startsWith('./')) {
      const resolved = id.startsWith('../lib/') ? `lib/${name}.ts` : `lib/${name}.ts`
      if (fs.existsSync(path.join(__dirname, '../src', resolved))) return load(resolved)
    }
    throw new Error(`Unexpected dependency ${id}`)
  }, module)
  modules.set(relative, module.exports)
  return module.exports
}

const inventory = load('routes/inventory.ts').default
function fixtureLifecycleRefusal(error) {
  const d1Error = error?.code === 'SQLITE_CONSTRAINT_TRIGGER' && error.message === 'stock_lifecycle_dependency'
    ? new Error('D1_ERROR: stock_lifecycle_dependency: SQLITE_CONSTRAINT_TRIGGER') : error
  return loadStockLifecycleFixture().stockLifecycleRefusal(d1Error)
}
inventory.onError((error, c) => {
  const refusal = fixtureLifecycleRefusal(error)
  return refusal ? c.json({ success: false, ...refusal }, 409) : c.json({ error: error.message }, 500)
})

function fresh() {
  sqlite = new Database(':memory:')
  const migrations = fs.readdirSync(path.join(__dirname, '../migrations')).filter((file) => file.endsWith('.sql')).sort()
  for (const file of migrations) sqlite.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
  sqlite.exec("INSERT INTO branches(id,name,is_active,is_default) VALUES(1,'Shop',1,1)")
  sqlite.exec("INSERT INTO products(id,name,stock_quantity,cost_price_usd,cost_price_khr) VALUES(1,'Widget',0,0,0)")
  waits = []
  externalEffects = []
  user = { id: 7, name: 'Operator', permissions: JSON.stringify({ inventory: true, product_cost_edit: true, product_cost_view: true }) }
}

async function request(body) {
  const response = await inventory.request('/adjust', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: nativeStockFixtureBinding(sqlite) }, {
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

  await check('a repeated receipt at the SAME cost is more stock at that cost: it weighs by quantity', async () => {
    fresh()
    await request(addBody({ unitCostUsd: 3, receivedDate: '01/09/2026' }))
    await request(addBody({ unitCostUsd: 3, receivedDate: '02/09/2026' }))
    // Same cost twice averages to itself.
    assert.deepEqual(catalogCost(), { usd: 3, khr: 0 })
    await request(addBody({ unitCostUsd: 4, receivedDate: '03/09/2026' }))
    assert.deepEqual(catalogCost(), { usd: 3.3333, khr: 0 }, '(2 x 3 + 1 x 4) / 3 -- the distinct mean would say 3.5')
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

  await check('widely separated recorded receipt prices still use the distinct positive mean', async () => {
    fresh()
    await request(addBody({ unitCostUsd: 3, receivedDate: '01/09/2026' }))
    assert.deepEqual(catalogCost(), { usd: 3, khr: 0 })
    const second = await request(addBody({ unitCostUsd: 9, receivedDate: '02/09/2026' }))
    assert.equal(second.status, 200, JSON.stringify(second))
    assert.deepEqual(catalogCost(), { usd: 6, khr: 0 })
  })

  await check('selected-lot quantity correction uses its stored price without cost grants, new purchase, or override reset', async () => {
    fresh()
    await request(addBody({unitCostUsd:3,receivedDate:'2026-09-05'}))
    await request(addBody({unitCostUsd:5,receivedDate:'2026-09-05'}))
    assert.equal(catalogCost().usd,4)
    const lot = sqlite.prepare('SELECT * FROM product_batches WHERE unit_cost_usd=3').get()
    const oldMovements = sqlite.prepare('SELECT * FROM inventory_movements ORDER BY id').all()
    const lotsBefore = sqlite.prepare('SELECT * FROM product_batches ORDER BY id').all()
    const correction = {productId:1,type:'add',quantity:1,reason:'Count correction',branchId:1,batchId:lot.id,attribution:'correction'}
    user = {...user,permissions:JSON.stringify({inventory:true})}
    const applied = await request(correction)
    assert.equal(applied.status,200,JSON.stringify(applied))
    assert.equal(applied.body.movementType,'adjustment')
    assert.equal(catalogCost().usd,3.6667,'the corrected count re-weights: (2 x 3 + 1 x 5) / 3, at the lot\'s own stored price')
    assert.deepEqual(sqlite.prepare('SELECT * FROM product_batches ORDER BY id').all(),lotsBefore)
    assert.deepEqual(sqlite.prepare('SELECT * FROM inventory_movements ORDER BY id LIMIT ?').all(oldMovements.length),oldMovements)
    assert.deepEqual(sqlite.prepare('SELECT movement_type,unit_cost_usd,total_cost_usd FROM inventory_movements ORDER BY id DESC LIMIT 1').get(),
      {movement_type:'adjustment',unit_cost_usd:3,total_cost_usd:3})
    assert.equal(sqlite.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=?').get(lot.id).quantity,2)
    assert.equal(sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id=1').get().quantity,3)
    assert.equal(sqlite.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity,3)
    sqlite.exec("INSERT INTO product_cost_entries(product_id,cost_usd,baseline_batch_id,source) SELECT 1,10,MAX(id),'manual' FROM product_batches; UPDATE products SET cost_price_usd=10,purchase_price_usd=10 WHERE id=1")
    const overrideBefore=sqlite.prepare('SELECT * FROM product_cost_entries').all()
    assert.equal((await request(correction)).status,200)
    assert.equal(catalogCost().usd,10,'a correction to a pre-override lot cannot reset the manual catalog decision')
    assert.deepEqual(sqlite.prepare('SELECT * FROM product_cost_entries').all(),overrideBefore)
    assert.deepEqual(sqlite.prepare('SELECT * FROM product_batches ORDER BY id').all(),lotsBefore)
    const state = () => JSON.stringify(['products','product_batches','branch_stock','branch_batch_stock','inventory_movements','product_cost_entries']
      .map(table=>sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
    const beforeDenied=state()
    assert.equal((await request({...correction,unitCostUsd:8})).status,403)
    assert.equal(state(),beforeDenied)
    user = {...user,permissions:JSON.stringify({inventory:true,product_cost_edit:true})}
    assert.equal((await request({...correction,unitCostUsd:8})).body.code,'correction_cost_input')
    assert.equal((await request({...correction,batchId:999})).body.code,'batch_mismatch')
    assert.equal((await request({...correction,attribution:'receipt',supplierName:'Acme'})).body.code,'cost_required')
    assert.equal(state(),beforeDenied)
    sqlite.exec("CREATE TRIGGER correction_failure BEFORE INSERT ON inventory_movements WHEN NEW.movement_type='adjustment' BEGIN SELECT RAISE(ABORT,'injected correction movement failure'); END")
    assert.equal((await request(correction)).status,500)
    assert.equal(state(),beforeDenied,'movement failure rolls back both stock ledgers and product quantity')
  })

  await catalogLifecycleContract()
  console.log(`\n${checks} checks passed`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 })

async function catalogLifecycleContract() {
  const encode = value => JSON.stringify(value, (_, item) => typeof item === 'bigint'
    ? ['integer64', String(item)] : Buffer.isBuffer(item) ? ['blob', item.toString('hex')] : item)
  const snapshot = () => encode(sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all().map(object => [object,
    object.type === 'table' ? sqlite.prepare(`SELECT * FROM "${object.name.replaceAll('"', '""')}"`).safeIntegers(true).all().map(encode).sort() : []]))
  for (const funding of [false, true]) for (const linked of [true, false]) {
    fresh()
    assert.equal((await request(addBody({ unitCostUsd: 3, receivedDate: '01/09/2026' }))).status, 200)
    const productId = linked ? 1 : 2, batchId = linked ? 1 : 2
    sqlite.exec(`INSERT INTO users(id,username,name,password,permissions,is_active) SELECT 1,'fixture-actor','Fixture actor','admin123','{}',1 WHERE NOT EXISTS(SELECT 1 FROM users WHERE id=1);
      INSERT INTO suppliers(id,name) VALUES(31,'Linked supplier');`)
    if (!linked) sqlite.exec(`INSERT INTO products(id,name,stock_quantity) VALUES(2,'Unrelated source',3);
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,is_active) VALUES(2,2,'OTHER','OTHER',1);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(2,1,3);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,3);`)
    sqlite.exec(`UPDATE product_batches SET supplier_id=31,payment_status='credit',received_quantity=3,received_cost_usd=3,received_branch_id=1,unit_cost_usd=1 WHERE id=${batchId};
      INSERT INTO inventory_movements(id,product_id,branch_id,batch_id,movement_type,quantity,free_quantity,total_cost_usd,unit_cost_usd,user_id) VALUES(701,${productId},1,${batchId},'add',3,0,3,1,1);`)
    if (funding) sqlite.exec(`INSERT INTO stock_funding_sources(id,movement_id,batch_id,product_id,branch_id,supplier_id,quantity,free_quantity,gross4,opening_paid4,opening_debt4,reconciliation_proof,actor_id,source_json)
      VALUES('linked',701,${batchId},${productId},1,31,'3','0',30000,0,30000,'Fixture proof',1,'{}');`)
    else sqlite.exec(`INSERT INTO stock_disposition_sources(id,movement_id,batch_id,product_id,branch_id,supplier_id,quantity,free_quantity,gross4,opening_paid4,opening_debt4,funding_state)
      VALUES('linked',701,${batchId},${productId},1,31,'3','0',30000,0,30000,'reconciled_unpaid');`)
    const before = snapshot()
    externalEffects = []
    const result = await request({ productId: 1, type: 'add', quantity: 1, reason: 'Count correction', branchId: 1, batchId: 1, attribution: 'correction' })
    assert.equal(result.status, linked ? 409 : 200, JSON.stringify(result))
    if (linked) {
      assert.equal(result.body.code, 'stock_lifecycle_dependency')
      assert.equal(snapshot(), before)
      assert.deepEqual(externalEffects, [])
    } else assert.equal(sqlite.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id=1 AND branch_id=1').get().quantity, 2)
    sqlite.close()
  }
  const realDb = loadStockLifecycleFixture('lib/db.ts'), fence = loadStockLifecycleFixture('lib/importMaintenanceFence.ts')
  assert.strictEqual(realDb.getImportFencedDb, fence.getImportFencedDb)
  assert.strictEqual(realDb, loadStockLifecycleFixture('lib/db.ts'))
  assert.equal(loadStockLifecycleFixture().StockLifecycleError.prototype instanceof require('hono/http-exception').HTTPException, true)
  assert.equal(fixtureLifecycleRefusal(Object.assign(new Error('other trigger'), { code: 'SQLITE_CONSTRAINT_TRIGGER' })), null)
  assert.equal(fixtureLifecycleRefusal(Object.assign(new Error('stock_lifecycle_dependency'), { code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })), null)
  console.log('PASS catalog linked disposition/funding rollback with coded refusal and no external effects; unrelated source corrections admitted')
}
