// Actual migrated SQLite and Hono routes. No network/database outside this process.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8'), boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0)
const harness = new Module(file, module)
harness.filename = file; harness.paths = module.paths
harness._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },") + '\nmodule.exports={fixture,load,executionCtx,USER,setUser(value){currentUser=value}};', file)
const h = harness.exports, app = h.load('routes/products.ts').default
const isBranches = sql => /SELECT id, name FROM branches WHERE is_active/.test(sql)
const isStock = sql => /FROM branch_stock\s+WHERE product_id IN/.test(sql)
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const tick = () => new Promise(resolve => setImmediate(resolve))

function observe(db, hooks = {}) {
  const calls = []
  return {
    calls,
    prepare(sql) {
      const statement = db.prepare(sql)
      return Object.fromEntries(['all', 'get', 'run'].map(method => [method, async params => {
        const entry = { sql, params, done: false }; calls.push(entry)
        try {
          await hooks.before?.(entry)
          return await statement[method](params)
        } finally { entry.done = true }
      }]))
    },
    batch: statements => db.batch(statements),
    exec: sql => db.exec(sql),
  }
}
async function get(db, suffix = '/search?surface=pos&pageSize=10&query=Powder') {
  const response = await app.request(suffix, {}, { DB: db }, h.executionCtx)
  return { status: response.status, body: await response.json() }
}

;(async () => {
  h.setUser({ ...h.USER, permissions: '{"all":true}' })
  const f = h.fixture()
  try {
    f.raw.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(2,'Empty',0,1),(3,'Closed',0,0),(4,'Priority',1,1)").run()
    f.raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,3,2.5)').run()
    f.raw.prepare('UPDATE products SET stock_quantity=999 WHERE id=10').run()
    // A single family expands beyond D1 binding limits. Stock chunks stay sequential.
    for (let id = 11; id <= 215; id++) {
      f.raw.prepare("INSERT INTO products(id,name,sku,is_active,stock_quantity) VALUES(@id,'Powder',@sku,1,999)").run({ id, sku: `POWDER-${id}` })
      f.raw.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(@id,1,0.5)').run({ id })
    }
    const reference = await get(f.route)
    assert.equal(reference.status, 200)
    assert.equal(reference.body.items.length, 206)
    const product = reference.body.items.find(item => item.id === 10)
    assert.equal(product.stock_quantity, 12.5, 'total includes inactive branch, not stale cached column')
    assert.deepEqual(product.branch_stock, [
      { branch_id: 1, branch_name: 'Shop', quantity: 10 },
      { branch_id: 4, branch_name: 'Priority', quantity: 0 },
      { branch_id: 2, branch_name: 'Empty', quantity: 0 },
    ])

    const held = deferred(), started = deferred()
    let stockReads = 0, activeStockReads = 0, maxStockReads = 0
    const db = observe(f.route, { before: async ({ sql, params }) => {
      if (isBranches(sql)) { started.resolve(); await held.promise }
      if (isStock(sql)) {
        stockReads++; activeStockReads++; maxStockReads = Math.max(maxStockReads, activeStockReads)
        assert.ok(Object.keys(params).length <= 100)
        await tick(); activeStockReads--
      }
    } })
    const pending = get(db)
    await started.promise
    await tick()
    const admittedWhileBranchesHeld = stockReads > 0
    held.resolve()
    const overlapped = await pending
    assert.deepEqual(overlapped, reference, 'scheduling does not change successful payload')
    assert.equal(stockReads, 3)
    assert.equal(maxStockReads, 1, 'chunks must remain sequential, not unbounded fanout')
    if (process.argv.includes('--expect-serial')) {
      assert.equal(admittedWhileBranchesHeld, false)
      console.log('PASS baseline negative control: stock waits for branches in old source')
      return
    }
    assert.equal(admittedWhileBranchesHeld, true, 'stock read must start while independent branch read remains held')
    console.log('PASS held-branch admission, three bounded sequential chunks and exact real-route payload parity')

    for (const suffix of ['/bootstrap?surface=pos&pageSize=10&query=Powder&metadata=0', '/?surface=pos']) {
      const result = await get(f.route, suffix)
      assert.equal(result.status, 200)
      assert.deepEqual(Array.isArray(result.body) ? result.body : result.body.items, reference.body.items)
    }
    console.log('PASS search/bootstrap/list preserve branch ordering, zero branch rows and inactive-ledger totals')

    for (const target of ['branches', 'second-stock']) {
      let seen = 0
      const broken = observe(f.route, { before: ({ sql }) => {
        if ((target === 'branches' && isBranches(sql)) || (target === 'second-stock' && isStock(sql) && ++seen === 2)) throw new Error(`expected ${target} read failure`)
      } })
      const response = await app.request('/search?surface=pos', {}, { DB: broken }, h.executionCtx)
      assert.equal(response.status, 500, 'failed enrichment must not publish a partial successful product')
      await tick()
    }
    console.log('PASS branch/stock failures refuse instead of publishing partial stock')
    h.setUser({ ...h.USER, permissions: '{}' })
    const deniedDb = observe(f.route)
    for (const suffix of ['/search?surface=pos', '/bootstrap?surface=pos', '/?surface=pos']) assert.equal((await get(deniedDb, suffix)).status, 403)
    assert.equal(deniedDb.calls.length, 0, 'authorization precedes all read work')
    console.log('PASS unauthorized search/bootstrap/list perform no reads')
  } finally { f.raw.db.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
