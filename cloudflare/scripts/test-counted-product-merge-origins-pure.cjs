const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const h = require('./test-counted-quantity-exact-native.cjs')

const parent = '6d901946c5d0be17f5d545430db2411302a1bd49'
function load(source) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('exports', 'module', 'require', output)(module.exports, module, name => {
    assert.equal(name, './countedDamagedStock')
    return h.loadStockSession('lib/countedDamagedStock.ts')
  })
  return module.exports.planExactProductMergeStock
}
const source = fs.readFileSync(path.join(__dirname, '../src/lib/countedProductMerge.ts'), 'utf8')
const plan = load(source)
const oldPlan = load(execFileSync('git', ['show', parent + ':cloudflare/src/lib/countedProductMerge.ts'], { cwd: path.join(__dirname, '../..'), encoding: 'utf8' }))
const receipt = (id, product) => ({ id, variant_product_id: product, batch_key: 'same-key', batch_number: id,
  is_active: 1, received_at: '2026-10-09', unit_cost_usd: 2, received_quantity: 5, received_cost_usd: 10 })
const tag = (id, product, batch, quantity, remaining, branch = 1) => ({ id, product_id: product, branch_id: branch,
  batch_id: batch, quantity, quantity_remaining: remaining, condition_tag: 'damaged', return_id: 7,
  return_item_id: 70, unit_cost_usd: 1.0000000000000002, reason: 'Original tag', created_at: '2026-09-01' })
function snapshot() {
  return { canonicalProduct: { id: 1, stock_quantity: 1 }, duplicateProduct: { id: 2, stock_quantity: 2 },
    canonicalStockBefore: [{ branch_id: 1, quantity: 1 }], duplicateStockRows: [{ branch_id: 1, quantity: 2 }],
    canonicalBatchRows: [receipt(1, 1)], duplicateBatchRows: [receipt(2, 2)],
    canonicalBatchStockRows: [{ id: 1, batch_id: 1, branch_id: 1, quantity: 1 }],
    duplicateBatchStockRows: [{ id: 2, batch_id: 2, branch_id: 1, quantity: 2 }],
    damagedStockRows: [tag(1, 1, 1, 3, 0.1), tag(2, 2, 2, 4, 0.2)], productCostRows: [] }
}

function pure() {
  for (const disposition of ['merge', 'write_off']) {
    const s = snapshot(), before = structuredClone(s), result = plan(s, disposition)
    assert.equal(result.keeperTotal, disposition === 'merge' ? 3 : 1)
    assert.equal(result.moved, disposition === 'merge' ? 2 : 0)
    assert.equal(result.writtenOff, disposition === 'write_off' ? 2 : 0)
    assert.equal(result.duplicateSource.receipts[0].original.id, 2, 'same batch key must not erase original receipt identity')
    assert.equal(result.duplicateSource.tags[0].quantity, 4, 'historical restoration cap is separate from moved remaining quantity')
    assert.equal(result.duplicateSource.tags[0].remaining, 0.2)
    assert.deepEqual(s, before, 'planning never rewrites original history or financial fields')
  }
  const exhausted = snapshot()
  exhausted.canonicalProduct.stock_quantity = exhausted.duplicateProduct.stock_quantity = 0
  exhausted.canonicalStockBefore = exhausted.duplicateStockRows = []
  exhausted.canonicalBatchStockRows = exhausted.duplicateBatchStockRows = []
  exhausted.damagedStockRows.forEach(row => { row.quantity_remaining = 0 })
  const empty = plan(exhausted, 'merge')
  assert.equal(empty.keeperTotal, 0)
  assert.equal(empty.duplicateSource.receipts.length, 1, 'sold-out receipt remains available to future original-sale return mapping')
  assert.equal(empty.duplicateSource.tags.length, 1, 'exhausted tag retains original entitlement and cap')

  const exact = snapshot()
  exact.canonicalProduct.stock_quantity = exact.canonicalStockBefore[0].quantity = exact.canonicalBatchStockRows[0].quantity = 0.1
  exact.duplicateProduct.stock_quantity = exact.duplicateStockRows[0].quantity = exact.duplicateBatchStockRows[0].quantity = 0.2
  assert.equal(plan(exact, 'merge').keeperTotal, 0.3)
  const unlotted = snapshot()
  unlotted.duplicateBatchStockRows = []
  unlotted.damagedStockRows[1].batch_id = null
  assert.equal(plan(unlotted, 'merge').duplicateSource.tags[0].batchId, null)
  assert.equal(plan(unlotted, 'merge').duplicateSource.receipts[0].quantityByBranch.size, 0, 'unlotted quantity does not acquire a fictitious receipt')

  const cases = [
    ['keeper overtag hidden by incoming quantity', s => { s.damagedStockRows[0].quantity_remaining = 2 }],
    ['duplicate overtag', s => { s.damagedStockRows[1].quantity_remaining = 3 }],
    ['tag cap below remaining', s => { s.damagedStockRows[0].quantity = 0 }],
    ['negative tag cap', s => { s.damagedStockRows[0].quantity = -1 }],
    ['negative remaining', s => { s.damagedStockRows[0].quantity_remaining = -1 }],
    ['null tag cannot consume unrelated receipt capacity', s => { s.damagedStockRows[0].batch_id = null }],
    ['tag refers to other product receipt', s => { s.damagedStockRows[0].batch_id = 2 }],
    ['tag refers to missing receipt', s => { s.damagedStockRows[0].batch_id = 99 }],
    ['tag belongs to unrelated product', s => { s.damagedStockRows[0].product_id = 99 }],
    ['tag belongs to absent physical branch', s => { s.damagedStockRows[0].branch_id = 99 }],
    ['duplicate tag identity', s => { s.damagedStockRows.push({ ...s.damagedStockRows[0] }) }],
    ['unknown tag receipt is not NULL', s => { delete s.damagedStockRows[0].batch_id }],
    ['receipt owner mismatch', s => { s.canonicalBatchRows[0].variant_product_id = 2 }],
    ['receipt stock missing original receipt', s => { s.canonicalBatchStockRows[0].batch_id = 99 }],
    ['duplicate original receipt', s => { s.canonicalBatchRows.push({ ...s.canonicalBatchRows[0] }) }],
    ['receipt-specific overtag with valid total', s => {
      s.canonicalBatchRows.push({ ...receipt(3, 1), batch_key: 'different' })
      s.canonicalBatchStockRows[0].quantity = 0.05
      s.canonicalBatchStockRows.push({ id: 3, batch_id: 3, branch_id: 1, quantity: 0.95 })
    }],
    ['fractional remaining must not gain tolerance', s => { s.damagedStockRows[0].quantity_remaining = 1.0000000000000002 }],
    ['text remaining must not coerce', s => { s.damagedStockRows[0].quantity_remaining = '0.1' }],
    ['null remaining must not coerce', s => { s.damagedStockRows[0].quantity_remaining = null }],
    ['nonfinite cap must refuse', s => { s.damagedStockRows[0].quantity = Infinity }],
    ['malformed branch identity', s => { s.damagedStockRows[0].branch_id = 1.1 }],
  ]
  for (const [name, alter] of cases) {
    const s = snapshot(); alter(s)
    assert.doesNotThrow(() => oldPlan(s, 'merge'), 'parent accepted this wrong source: ' + name)
    assert.throws(() => plan(s, 'merge'), /merge_state_conflict|invalid_decimal/, name)
    assert.throws(() => plan(s, 'write_off'), /merge_state_conflict|invalid_decimal/, 'same admission for write-off: ' + name)
  }
  for (const alter of [s => { s.canonicalProduct.stock_quantity = 2 },
    s => { s.canonicalBatchStockRows[0].quantity = 2 },
    s => { s.duplicateStockRows.push({ branch_id: 1, quantity: 0 }) }]) {
    const s = snapshot(); alter(s)
    assert.throws(() => oldPlan(s, 'merge'))
    assert.throws(() => plan(s, 'merge'))
  }
  console.log('PASS 21 parent-accepted bad source worlds in both dispositions; exact fractions, same-key origins, exhausted/NULL sources, caps and immutable inputs')
}

async function native() {
  const worker = await h.bundle.exports.bundleWorker()
  for (const tier of ['free', 'paid']) for (const mode of ['keeper-total', 'keeper-receipt', 'keeper-null']) {
    const f = await h.world(worker, tier, 'zero', sql => {
      h.seed(1, true)(sql)
      sql.exec(`UPDATE products SET name='Merge origin',barcode='origin' WHERE id=1;
        INSERT INTO products(id,name,barcode,is_active,stock_quantity,cost_price_usd) VALUES(2,'Merge origin','origin',1,2,2);
        INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,2);
        INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)
          VALUES(1,1,1,${mode === 'keeper-null' ? 'NULL' : 1},3,0,'damaged','remove');`)
      if (mode === 'keeper-receipt') sql.exec(`UPDATE branch_batch_stock SET quantity=.05 WHERE batch_id=1;
        INSERT INTO product_batches(id,variant_product_id,batch_key,is_active) VALUES(3,1,'other',1);
        INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(3,1,.95);`)
    })
    try {
      const db = h.loadStockSession('lib/db.ts').getDb(f.env)
      await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(db, [{
        sql: 'UPDATE damaged_stock_lots SET quantity_remaining=@value WHERE id=1',
        params: { value: mode === 'keeper-total' ? 2 : 0.1 },
      }], 'once')
      const tables = ['products', 'branch_stock', 'product_batches', 'branch_batch_stock', 'damaged_stock_lots',
        'product_cost_entries', 'inventory_movements', 'action_history', 'undo_snapshots', 'audit_logs']
      const state = () => tables.map(table => f.sql.prepare(`SELECT * FROM ${table} ORDER BY id`).all())
      const before = state()
      const result = await f.call('/products/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge' })
      assert.equal(result.status, 409, mode)
      assert.equal(result.json.code, 'merge_state_conflict', mode)
      assert.deepEqual(state(), before, mode + ' refuses before changing stock, history or financial records')
    } finally { f.sql.close() }
  }
  console.log('PASS six authenticated Free/Paid merge source refusals with all tails counted and exact ten-domain no-effect proof')
}

async function main() { pure(); if (!process.argv.includes('--pure-only')) await native() }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { load, snapshot, pure, native }
