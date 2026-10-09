const assert = require('node:assert/strict')
const h = require('./test-counted-quantity-exact-native.cjs')
const { state } = require('./test-counted-add-budget-native.cjs')

const base = { productId: 1, branchId: 1, type: 'add', quantity: 0.2, reason: 'Exact intake', client_request_id: 'exact-inventory-add' }
const receipt = { supplierName: 'Fixture supplier', unitCostUsd: 2, receivedDate: '2026-09-01', paymentStatus: 'paid' }
function metadata(f) { return f.sql.prepare('SELECT * FROM product_batches ORDER BY id').all() }
async function addition(make, tier, kind, initial = 0.1) {
  const correction = kind.startsWith('correction')
  const tagged = kind.endsWith('tagged')
  const fresh = kind.startsWith('new')
  const f = await h.world(make, tier, 'zero', sql => {
    h.seed(initial, true)(sql)
    sql.prepare("UPDATE product_batches SET received_quantity=?,received_cost_usd=?,supplier_name='Original supplier',payment_status='credit',credit_due_date='2026-10-31' WHERE id=1").run(initial, initial * 2)
  })
  try {
    const before = metadata(f)
    const body = { ...base, ...(correction ? { attribution: 'correction' } : receipt),
      ...(fresh ? { batchId: 'new', receivedDate: '2026-10-09' } : { batchId: 1 }),
      ...(tagged ? { conditionTag: 'damaged' } : {}),
      ...(kind === 'unlocked' ? { unlockPricing: true, pricing: {} } : {}) }
    const result = await f.call('/inventory/adjust', body)
    assert.equal(result.status, 200, JSON.stringify(result.json))
    const after = f.state()
    const expected = initial === 0 ? 0.2 : 0.3
    assert.equal(after.physical, expected, `${tier}/${kind} physical addition must be exact`)
    assert.equal(after.cache, expected)
    assert.equal(after.lots.find(row => row.batch_id === result.json.batchId)?.quantity, fresh ? 0.2 : expected)
    assert.equal(after.movements.filter(row => row.movement_type === (correction ? 'adjustment' : 'add')).length, 1)
    if (correction) assert.deepEqual(metadata(f), before, 'a count correction preserves every purchase metadata field')
    else if (!fresh) assert.equal(metadata(f)[0].received_quantity, expected)
    if (tagged) assert.deepEqual(after.tags.map(row => [row.batch_id, row.quantity_remaining]), [[result.json.batchId, 0.2]])
    else assert.deepEqual(after.tags, [])
    const savedMetadata = metadata(f)
    assert.equal((await f.call('/inventory/adjust', body)).status, 200)
    assert.deepEqual(f.state(), after, 'same-id replay preserves physical stock, tags and history')
    assert.deepEqual(metadata(f), savedMetadata)
    console.log(`PASS exact ${tier}/${kind}/${initial} addition and canonical replay`)
  } finally { f.sql.close() }
}

async function races(make) {
  const mutations = {
    actor: 'UPDATE users SET is_active=0 WHERE id=7',
    role: "UPDATE roles SET permissions='{}' WHERE id=(SELECT role_id FROM users WHERE id=7)",
    cost: 'UPDATE products SET cost_price_usd=3 WHERE id=1',
    price: 'UPDATE products SET selling_price_usd=3 WHERE id=1',
    date: "UPDATE product_batches SET received_at='2026-09-02' WHERE id=1",
    metadata: "UPDATE product_batches SET supplier_name='Rival supplier' WHERE id=1",
    membership: "INSERT INTO product_batches(id,variant_product_id,batch_key,is_active)VALUES(90,1,'rival-empty',1)",
    tags: "INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(90,1,1,NULL,0,0,'opened','remove')",
  }
  for (const tier of ['free', 'paid']) for (const correction of [false, true]) for (const [fault, sql] of Object.entries(mutations)) {
    const f = await h.world(make, tier, 'zero', h.seed(0.1, true))
    try {
      const db = h.loadStockSession('lib/db.ts').getDb(f.env)
      let rival
      f.beforeCommit(async () => {
        await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(db, [{ sql }], 'once')
        rival = state(f)
      })
      const result = await f.call('/inventory/adjust', { ...base, batchId: 1,
        ...(correction ? { attribution: 'correction' } : receipt) })
      assert.equal(result.status, 409, JSON.stringify(result.json))
      assert.ok(['counted_quantity_conflict', 'write_conflict'].includes(result.json.code))
      assert.deepEqual(state(f), rival, 'only the rival mutation survives')
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_mutation_receipts').get().n, 0)
      console.log(`PASS ${tier}/${correction ? 'correction' : 'receipt'} original ${fault} guard`)
    } finally { f.sql.close() }
  }
}

async function tails(make) {
  for (const tier of ['free', 'paid']) for (const kind of ['correction', 'existing', 'new-tagged', 'price', 'free', 'combined']) {
    const f = await h.world(make, tier, 'zero', h.seed(0.1, true))
    const raw = f.env.DB, families = new Set(), failed = new Set()
    let attempts = 0, committed = false
    const correction = kind === 'correction'
    const price = ['price', 'combined'].includes(kind)
    const free = ['free', 'combined'].includes(kind)
    const body = { ...base, ...(correction ? { attribution: 'correction', batchId: 1 } : receipt),
      ...(kind === 'new-tagged' ? { batchId: 'new', receivedDate: '2026-10-09', conditionTag: 'damaged' } : {}),
      ...(price ? { sellingPriceUsd: 3, sellingPriceKhr: 12000 } : {}), ...(free ? { freeQuantity: 1 } : {}) }
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
      if (['all', 'first', 'run'].includes(key)) return (...args) => {
        attempts++
        return retry(sql, target.params) ? Promise.reject(new Error('D1_ERROR: network reset before intake tail')) : target[key](...args)
      }
      return target[key]
    } })
    f.env.DB = new Proxy(raw, { get(target, key) {
      if (key === 'prepare') return sql => wrap(target.prepare(sql), sql)
      if (key === 'batch') return async statements => {
        attempts += statements.length
        const mutation = statements.some(row => /INSERT INTO inventory_movements/.test(row.text))
        if (statements.some(row => retry(row.text, row.params))) throw new Error('D1_ERROR: network reset before intake tail')
        try { return await target.batch(statements) }
        finally { if (mutation) committed = f.sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n > 0 }
      }
      return target[key]
    } })
    try {
      f.env.CACHE = { get: async () => null, put: async () => { throw new Error('Synthetic KV failure') }, delete: async () => {} }
      f.sql.exec("DELETE FROM cache_versions WHERE namespace='products'")
      const result = await f.call('/inventory/adjust', body)
      console.log('INTAKE_OUTER_TAIL ' + JSON.stringify({ tier, kind, attempts, families: [...families], status: result.status }))
      assert.equal(result.status, 200, JSON.stringify(result.json))
      assert.equal(f.state().physical, free ? 1.3 : 0.3)
      assert.ok(attempts <= (tier === 'free' ? 50 : 1000))
      assert.deepEqual([...families].sort(), (tier === 'free'
        ? ['audit', 'completion', 'handoff', 'onhand', 'quota', 'settings', 'versions']
        : ['audit', 'completion', 'handoff', 'onhand', 'settings', 'versions']).sort())
    } finally { f.sql.close() }
  }
}

async function sources(make) {
  for (const tier of ['free', 'paid']) for (const kind of ['sibling', 'new-sibling', 'null-tags', 'receipt-tags', 'rollback', 'ack']) {
    const sibling = kind.endsWith('sibling')
    const tagged = kind.endsWith('tags')
    const f = await h.world(make, tier, 'zero', sql => {
      h.seed(0.1, true)(sql)
      if (sibling) {
        sql.exec("UPDATE products SET name='Fixture identity',barcode='11111',selling_price_usd=8,wholesale_price_usd=6 WHERE id=1")
        if (kind === 'sibling') sql.exec("INSERT INTO products(id,name,barcode,is_active,stock_quantity,selling_price_usd,wholesale_price_usd,cost_price_usd,purchase_price_usd)VALUES(900,'Fixture identity','22222',1,0,10,4,2,2)")
      }
      if (tagged) sql.exec(`INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source,unit_cost_usd)
        VALUES(1,1,1,${kind === 'null-tags' ? 'NULL' : 1},.1,.1,'opened','remove',2),(2,1,1,${kind === 'null-tags' ? 'NULL' : 1},.2,.2,'damaged','remove',2)`)
    })
    try {
      const before = state(f), tagsBefore = f.state().tags
      const body = { ...base, ...receipt, batchId: 'new', receivedDate: '2026-10-09',
        ...(tagged ? { conditionTag: 'broken' } : {}),
        ...(sibling ? { unitCostUsd: 3, unlockPricing: true, pricing: { barcode: '22222', cost_usd: 7, selling_price_usd: 9, wholesale_price_usd: 7 } } : {}) }
      if (kind === 'rollback') f.sql.exec("CREATE TEMP TRIGGER intake_fail BEFORE INSERT ON inventory_movements BEGIN SELECT RAISE(ABORT,'CHECK constraint failed: unrelated_intake'); END")
      if (kind === 'ack') f.loseNextCommitAcknowledgement()
      const result = await f.call('/inventory/adjust', body)
      if (kind === 'rollback') {
        assert.equal(result.status, 400)
        assert.deepEqual(state(f), before)
        f.sql.exec('DROP TRIGGER intake_fail')
        assert.equal((await f.call('/inventory/adjust', body)).status, 200)
      } else if (kind === 'ack') {
        assert.equal(result.status, 503)
        assert.equal(result.json.code, 'stock_request_outcome_unknown')
        const committed = state(f)
        const retry = await f.call('/inventory/adjust', body)
        assert.equal(retry.status, 409)
        assert.equal(retry.json.code, 'stock_request_partially_applied')
        assert.deepEqual(state(f), committed)
      } else {
        assert.equal(result.status, 200, JSON.stringify(result.json))
        if (sibling) {
          assert.equal(result.json.createdSibling, kind === 'new-sibling')
          const row = f.sql.prepare('SELECT * FROM products WHERE id=?').get(result.json.productId)
          assert.equal(row.stock_quantity, 0.2)
          assert.equal(row.selling_price_usd, kind === 'sibling' ? 10 : 9)
          assert.equal(row.wholesale_price_usd, 7)
          assert.equal(row.cost_price_usd, 3)
          assert.equal(f.state().physical, 0.1)
          assert.equal(f.state().movements[0].unit_cost_usd, 3)
        } else {
          assert.equal(f.state().physical, 0.6)
          assert.deepEqual(f.state().tags.slice(0, 2), tagsBefore)
          assert.equal(f.state().tags[2].batch_id, result.json.batchId)
          assert.equal(f.state().tags[2].quantity_remaining, 0.2)
          const counted = h.loadStockSession('lib/countedDamagedStock.ts')
          const facts = f.sql.prepare('SELECT ' + counted.countedStockFactsSql('1', '1') + ' AS facts').get().facts
          const exact = new counted.CountedStockPlan(facts, 1)
          const initial = exact.ordinaryQuantity(null)
          const created = exact.receiveProjectedCreatedReceipt('future-receipt', 0.3, 999).createdReceipt
          assert.throws(() => exact.holdCreatedReceipt({ ...created }, 0.1), counted.CountedStockConflictError)
          assert.throws(() => new counted.CountedStockPlan(facts, 1).holdCreatedReceipt(created, 0.1), counted.CountedStockConflictError)
          exact.holdCreatedReceipt(created, 0.1)
          exact.holdCreatedReceipt(created, 0.2)
          assert.throws(() => exact.holdCreatedReceipt(created, 0.000001), counted.CountedStockConflictError)
          assert.equal(exact.ordinaryQuantity(null), initial)
        }
        const saved = state(f)
        assert.equal((await f.call('/inventory/adjust', body)).status, 200)
        assert.deepEqual(state(f), saved)
      }
      console.log(`PASS ${tier}/${kind} source/metadata/once-only semantics`)
    } finally { f.sql.close() }
  }
}

async function main() {
  const make = await h.bundle.exports.bundleWorker()
  if (process.argv.includes('--races-only')) return races(make)
  if (process.argv.includes('--tails-only')) return tails(make)
  if (process.argv.includes('--sources-only')) return sources(make)
  let failures = 0
  for (const tier of ['free', 'paid']) for (const kind of ['correction', 'correction-tagged', 'existing', 'existing-tagged', 'new', 'new-tagged', 'unlocked']) {
    try { await addition(make, tier, kind) }
    catch (error) { failures++; console.error(`FAIL ${tier}/${kind}`, error) }
  }
  assert.equal(failures, 0, `${failures} exact Inventory Add worlds failed`)
  for (const tier of ['free', 'paid']) for (const kind of ['correction', 'existing', 'new-tagged']) await addition(make, tier, kind, 0)
  if (process.argv.includes('--basics-only')) return
  await races(make)
  await tails(make)
  await sources(make)
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { addition, races, tails, sources }
