const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')
const { state } = require('./test-counted-add-budget-native.cjs')

async function world(make, tier) {
  return h.world(make, tier, 'zero', sql => {
    h.seed(0.1, true)(sql)
    sql.exec("UPDATE products SET name='Fixture identity',barcode='11111' WHERE id=1")
  })
}
const base = { productId: 1, branchId: 1, type: 'add', quantity: 0.2, batchId: 'new',
  supplierName: 'Fixture supplier', unitCostUsd: 3, receivedDate: '2026-10-09', paymentStatus: 'paid',
  unlockPricing: true, pricing: { barcode: '22222', cost_usd: 7, selling_price_usd: 9, wholesale_price_usd: 7 },
  reason: 'Atomic sibling intake', client_request_id: 'atomic-sibling-intake' }

async function tails(make, tier, kind, extraReads) {
  const f = await world(make, tier)
  const raw = f.env.DB, failed = new Set(), families = new Set()
  let attempts = 0, committed = false, padded = false, batches = 0
  const retry = (sql, params) => {
    if (!committed) return false
    const family = /UPDATE stock_mutation_receipts SET response_status/.test(sql) ? 'completion'
      : /INSERT INTO audit_logs/.test(sql) ? 'audit' : /SELECT namespace, version FROM cache_versions/.test(sql) ? 'versions'
      : /INSERT INTO quota_usage/.test(sql) ? 'quota' : /INSERT INTO cache_versions/.test(sql) ? 'handoff'
      : /SELECT stock_quantity,/.test(sql) ? 'onhand' : /FROM settings/.test(sql) ? 'settings' : null
    if (!family) return false
    families.add(family)
    const key = family + JSON.stringify(params)
    if (failed.has(key)) return false
    failed.add(key)
    return true
  }
  const wrap = (statement, sql) => new Proxy(statement, { get(target, key) {
    if (key === 'bind') return (...args) => wrap(target.bind(...args), sql)
    if (['all', 'first', 'run'].includes(key)) return async (...args) => {
      if (!padded && /AS maximumId/.test(sql)) {
        padded = true
        const db = h.loadStockSession('lib/db.ts').getDb(f.env)
        for (let index = 0; index < extraReads; index++) await db.prepare('SELECT 1 AS padding').get()
      }
      attempts++
      if (retry(sql, target.params)) throw new Error('D1_ERROR: network reset before atomic intake tail')
      return target[key](...args)
    }
    return target[key]
  } })
  f.env.DB = new Proxy(raw, { get(target, key) {
    if (key === 'prepare') return sql => wrap(target.prepare(sql), sql)
    if (key === 'batch') return async statements => {
      attempts += statements.length
      const mutation = statements.some(row => /INSERT INTO inventory_movements/.test(row.text))
      if (mutation) batches++
      if (statements.some(row => retry(row.text, row.params))) throw new Error('D1_ERROR: network reset before atomic intake tail')
      try { return await target.batch(statements) }
      finally { if (mutation) committed = f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n > 0 }
    }
    return target[key]
  } })
  try {
    f.env.CACHE = { get: async () => null, put: async () => { throw new Error('Synthetic KV failure') }, delete: async () => {} }
    f.sql.exec("DELETE FROM cache_versions WHERE namespace='products'")
    const before = state(f)
    const tagged = kind.includes('tagged'), free = kind.includes('free')
    const result = await f.call('/inventory/adjust', { ...base, ...(tagged ? { conditionTag: 'damaged' } : {}), ...(free ? { freeQuantity: 1 } : {}) })
    console.log('ATOMIC_TAIL ' + JSON.stringify({ tier, kind, extraReads, attempts, batches, families: [...families], status: result.status, code: result.json.code }))
    assert.ok(attempts <= (tier === 'free' ? 50 : 1000))
    if (result.status === 503) {
      assert.equal(result.json.code, 'stock_request_query_budget_exceeded')
      assert.equal(batches, 0, 'capacity refusal must precede the first catalog or stock business write')
      assert.deepEqual(state(f), before)
    } else {
      assert.equal(result.status, 200, JSON.stringify(result.json))
      assert.equal(batches, 1, 'catalog, receipt and physical stock share one transaction')
      assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=?').get(result.json.productId).stock_quantity, free ? 1.2 : 0.2)
      assert.equal(f.state().tags.length, tagged ? 1 : 0)
      if (tagged) assert.equal(f.state().tags[0].quantity_remaining, free ? 1.2 : 0.2)
      assert.deepEqual([...families].sort(), (tier === 'free'
        ? ['audit', 'completion', 'handoff', 'onhand', 'quota', 'settings', 'versions']
        : ['audit', 'completion', 'handoff', 'onhand', 'settings', 'versions']).sort())
    }
    if (extraReads === 0) assert.equal(result.status, 200, 'ordinary one-line creation should fit its real plan limit')
  } finally { f.sql.close() }
}

async function main() {
  const make = await h.bundle.exports.bundleWorker()
  if (process.argv.includes('--projection-only')) return projection(make)
  let failures = 0
  for (const tier of ['free', 'paid']) for (const kind of ['plain', 'free', 'tagged', 'tagged-free']) {
    for (const extra of (tier === 'free' ? [0, 1, 2, 3] : [0])) {
      try { await tails(make, tier, kind, extra) }
      catch (error) { failures++; console.error(`FAIL ${tier}/${kind}/${extra}`, error) }
    }
  }
  assert.equal(failures, 0)
}

async function projection(make) {
  const f = await world(make, 'paid')
  const counted = h.loadStockSession('lib/countedDamagedStock.ts')
  const db = h.loadStockSession('lib/db.ts').getDb(f.env)
  const commit = statements => h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(db, statements, 'once')
  try {
    const observed = f.sql.prepare(`SELECT ${counted.countedProductCreationFactsSql('900', '1')} AS facts`).get().facts
    const input = { productId: 900, name: 'Projected item', costUsd: 2, costKhr: 0, observed }
    for (const bad of [ { ...input, productId: 0 }, { ...input, observed: '{"occupied":1,"branch":[1,1,"Shop","store"]}' },
      { ...input, observed: '{"occupied":0,"branch":null}' }, { ...input, observed: '{"occupied":0,"branch":[1,0,"Shop","store"]}' } ]) {
      assert.throws(() => new counted.CountedStockPlan(bad, 1), counted.CountedStockConflictError)
    }
    const phantom = new counted.CountedStockPlan(input, 1)
    const before = state(f)
    await assert.rejects(commit(phantom.changeOrdinary(null, 0.2, 'receive')), counted.isCountedStockConflict)
    assert.deepEqual(state(f), before, 'a projected product without the planned INSERT cannot create physical stock')
    const exact = new counted.CountedStockPlan(input, 1)
    const prefix = exact.takeInitialGuard()
    input.observed = '{"occupied":1}'
    assert.equal(prefix[0].params.observed, observed, 'caller mutation cannot rewrite the captured preimage')
    await commit([...prefix, { sql: "INSERT INTO products(id,name,stock_quantity,is_active,cost_price_usd,cost_price_khr)VALUES(900,'Projected item',0,1,2,0)" },
      ...exact.changeOrdinary(null, 0.1, 'receive'), ...exact.changeOrdinary(null, 0.2, 'receive')])
    assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=900').get().stock_quantity, 0.3)
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=900').get().quantity, 0.3)
    const occupied = f.sql.prepare(`SELECT ${counted.countedProductCreationFactsSql('900', '1')} AS facts`).get().facts
    assert.throws(() => new counted.CountedStockPlan({ ...input, observed: occupied }, 1), counted.CountedStockConflictError)
    await assert.rejects(commit(prefix), counted.isCountedStockConflict)
    await commit([{ sql: "INSERT INTO branches(id,name,is_active)VALUES(2,'Second',1)" }])
    for (const alias of ['p', 'pb', 'bbs', 'b']) {
      const facts = counted.countedStockFactsSql(`${alias}.id`, 'outer_branch.id')
      const rows = f.sql.prepare(`SELECT ${alias}.id AS productId,outer_branch.id AS branchId,${facts} AS facts
        FROM products ${alias} CROSS JOIN branches outer_branch ORDER BY ${alias}.id,outer_branch.id`).all()
      assert.equal(rows.length, 4)
      for (const row of rows) {
        const parsed = JSON.parse(row.facts)
        assert.equal(parsed.product[0], row.productId, alias + ' product context must not be shadowed')
        assert.equal(parsed.branch[0], row.branchId)
        assert.equal(parsed.product[2], row.productId === 1 ? 0.1 : 0.3)
      }
    }
    const branchRows = f.sql.prepare(`SELECT b.id AS branchId,${counted.countedStockFactsSql('900', 'b.id')} AS facts FROM branches b ORDER BY b.id`).all()
    assert.deepEqual(branchRows.map(row => JSON.parse(row.facts).branch[0]), [1, 2])
    console.log('PASS real absent-product capture, missing-INSERT rollback, immutable preimage, occupied-ID guard, exact projection and 18 correlated alias worlds')
  } finally { f.sql.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
