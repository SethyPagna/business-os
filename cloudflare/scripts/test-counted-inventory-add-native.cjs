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

async function main() {
  const make = await h.bundle.exports.bundleWorker()
  if (process.argv.includes('--races-only')) return races(make)
  let failures = 0
  for (const tier of ['free', 'paid']) for (const kind of ['correction', 'correction-tagged', 'existing', 'existing-tagged', 'new', 'new-tagged', 'unlocked']) {
    try { await addition(make, tier, kind) }
    catch (error) { failures++; console.error(`FAIL ${tier}/${kind}`, error) }
  }
  assert.equal(failures, 0, `${failures} exact Inventory Add worlds failed`)
  for (const tier of ['free', 'paid']) for (const kind of ['correction', 'existing', 'new-tagged']) await addition(make, tier, kind, 0)
  if (process.argv.includes('--basics-only')) return
  await races(make)
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { addition, races }
