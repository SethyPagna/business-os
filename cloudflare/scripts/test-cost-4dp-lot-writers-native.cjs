'use strict'
// cost-4dp lane: the writers of a LOT cost (and the product cost its triggers derive) store 4 decimals, nearest, half away from zero.
// Real migrated SQLite with every trigger live, the stock-session planner and replay (the harness of test-stock-session-atomic):
//   stock-in session   a receipt at 1.00015 / 2.345678 creates a lot at 1.0002 / 2.3457, its received cost is exact, the catalog cost follows
//   same-day top-up    a second receipt at the same typed cost finds the lot it made (identity is the rounded cost)
//   undo and redo      the session replay leaves nothing over 4 places
//   revert receipt     planReceiveBatchStock called the way lib/stockRevert.ts calls it (explicit lot, historical unit cost, historicalReceiptReplay)
//                      stores the unit cost and the received cost at 4 places even for a movement snapshot that holds more
//   sold-out fallback  a product with nothing on hand whose newest lot was written long (a legacy row) re-derives at 4 places (migration 0312)
// After every scenario the census predicate runs over products, lots and cost entries.
// Mutants: the same scenarios re-run in a child process with one writer's rounding removed from the source text; each must go red.
//
// Run: node scripts/test-cost-4dp-lot-writers-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const SRC = path.resolve(__dirname, '../src')
const MUTANTS = {
  'productBatches.planReceiveBatchStock: a receipt writes the unit cost as given (preserveHistoricalUnitCost back)': [
    { file: 'lib/productBatches.ts', from: '  const unitCostUsd = unitCostForReceipt(input.unitCostUsd)\n  const receivedCost', to: '  const unitCostUsd = unitCostForReceipt(input.unitCostUsd, input.preserveHistoricalUnitCost === true)\n  const receivedCost' },
  ],
  'productBatches.unitCostForReceipt: no rounding at all': [
    { file: 'lib/productBatches.ts', from: '  return preserveHistoricalPrecision ? cost : roundMoney4(cost)', to: '  return cost' },
  ],
  'stockSession: the receipt line cost is not rounded': [
    { file: 'lib/stockSession.ts', from: 'roundMoney4(unitCostUsd)', to: 'unitCostUsd' },
    { file: 'lib/productBatches.ts', from: '  return preserveHistoricalPrecision ? cost : roundMoney4(cost)', to: '  return cost' },
  ],
  'catalog cost: migration 0312 not applied, the sold-out fallback copies the lot cost': [
    { file: '../migrations/0312_catalog_cost_fallback_rounding.sql', whole: true, to: 'SELECT 1;' },
  ],
}
const MUTANT = process.env.COST4DP_MUTANT || ''
if (MUTANT) {
  const mutations = MUTANTS[MUTANT]
  assert.ok(mutations, `unknown mutant ${MUTANT}`)
  const realRead = fs.readFileSync
  fs.readFileSync = function patched(file, ...rest) {
    const text = realRead.call(fs, file, ...rest)
    if (typeof text !== 'string') return text
    const rel = path.relative(SRC, String(file)).split(path.sep).join('/')
    let out = text.replace(/\r\n/g, '\n')
    let touched = false
    for (const m of mutations) if (m.file === rel) {
      if (m.whole) out = m.to
      else { assert.ok(out.includes(m.from), `${MUTANT}: anchor missing in ${rel}`); out = out.split(m.from).join(m.to) }
      touched = true
    }
    return touched ? out : text
  }
}

const { fixture, loadStockSession, user, receiveRequest } = require('./test-stock-session-atomic.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const over4 = (c) => `(typeof(${c}) IN ('integer','real') AND ABS(${c} * 10000 - ROUND(${c} * 10000)) > 0.000001)`
const census = (f) => {
  const n = (table, cols) => f.sql.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${cols.map(over4).join(' OR ')}`).get().n
  return { products: n('products', ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']),
    lots: n('product_batches', ['unit_cost_usd', 'received_cost_usd']), entries: n('product_cost_entries', ['cost_usd', 'cost_khr', 'previous_cost_usd']) }
}
const ZERO = { products: 0, lots: 0, entries: 0 }
const lots = (f) => f.sql.prepare('SELECT id, unit_cost_usd u, received_cost_usd r, received_quantity q FROM product_batches ORDER BY id').all().map((r) => ({ ...r }))
const productCost = (f) => f.sql.prepare('SELECT cost_price_usd c, purchase_price_usd p FROM products WHERE id=1').get()
const request = (key, cost, quantity = 3, extra = {}) => {
  const body = receiveRequest(key, quantity)
  Object.assign(body.items[0], { unit_cost_usd: cost, ...extra })
  return body
}
const payload = (f, r) => JSON.parse(f.sql.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(r.actionHistoryId).undo_payload)

async function scenarios() {
  const api = loadStockSession()
  const batches = loadStockSession('lib/productBatches.ts')
  const costs = loadStockSession('lib/catalogCostRecompute.ts')

  // ---- stock-in session --------------------------------------------------------------------------------------------------------------------
  let seq = 0
  for (const [typed, want, total] of [[1.00015, 1.0002, 3.0006], [2.345678, 2.3457, 7.0371], [1.00105, 1.0011, 3.0033], [4.1666666666, 4.1667, 12.5001]]) {
    const f = fixture()
    seq += 1
    const done = await api.commitStockSession(f.env, user, request('cost4dp-session-a' + seq, typed, 3))
    assert.equal(done.items[0].batchId, 1)
    assert.deepEqual(lots(f), [{ id: 1, u: want, r: total, q: 3 }], 'session receipt at ' + typed)
    assert.deepEqual({ ...productCost(f) }, { c: want, p: want }, 'the catalog cost follows the lot (' + typed + ')')
    assert.deepEqual(census(f), ZERO, 'census after the session receipt at ' + typed)
    // The same typed cost finds the lot it made: identity is the rounded cost, a top-up adds units to it.
    const again = await api.commitStockSession(f.env, user, request('cost4dp-session-b' + seq, typed, 1))
    assert.equal(again.items[0].batchId, done.items[0].batchId, 'a second receipt at the same typed cost reuses the lot')
    assert.deepEqual(census(f), ZERO)
    // Undo and redo leave nothing long.
    await api.replayStockSession(f.env, user, 'undo', again.actionHistoryId, 0, payload(f, again))
    assert.deepEqual(census(f), ZERO, 'census after undo')
    await api.replayStockSession(f.env, user, 'redo', again.actionHistoryId, 1, payload(f, again))
    assert.deepEqual(census(f), ZERO, 'census after redo')
  }

  // ---- revert: planReceiveBatchStock as lib/stockRevert.ts calls it ---------------------------------------------------------------------------
  {
    const f = fixture()
    const first = await api.commitStockSession(f.env, user, request('cost4dp-revert-base', 1.5, 4))
    const lotId = first.items[0].batchId
    for (const [snapshotCost, want] of [[1.00015, 1.0002], [2.345678, 2.3457], [1.5, 1.5]]) {
      const plan = batches.planReceiveBatchStock({
        productId: 1, branchId: 1, quantity: 2, batchId: lotId, unitCostUsd: snapshotCost, receiptTotalUsd: null,
        preserveHistoricalUnitCost: true, historicalReceiptReplay: true, supplierName: 'Fixture Supplier',
        receiptCostPreimage: { batchExists: true, receivedCostUsd: 6 },
      })
      assert.equal(plan.params.unitCostUsd, want, 'revert: a movement snapshot cost of ' + snapshotCost + ' is written to the lot at 4 places')
      assert.equal(plan.params.receivedCostUsd, Math.round(want * 2 * 10000) / 10000, 'and its received cost is the exact product of the stored figure')
    }
    // A lot that does not exist yet (the INSERT branch) stores the rounded cost.
    const created = batches.planReceiveBatchStock({
      productId: 1, branchId: 1, quantity: 2, unitCostUsd: 1.00015, preserveHistoricalUnitCost: true, supplierName: 'Fixture Supplier',
      receiptCostPreimage: { batchExists: false, receivedCostUsd: null }, receiptLotTarget: batches.resolveReceiptLotTarget([], '2026-09-06', 1.0002, 0), reservedBatchId: 50,
    })
    const insert = created.statements.find((s) => /INSERT INTO product_batches/.test(s.sql))
    assert.equal(insert.params.unitCostUsd, 1.0002, 'a re-created lot is stored at 4 places')
    assert.deepEqual(census(f), ZERO)
  }

  // ---- sold-out fallback (migration 0312) ------------------------------------------------------------------------------------------------------
  {
    const f = fixture()
    seedStockFixture(f.sql, () => {
      f.sql.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,unit_cost_usd,received_cost_usd,received_at) VALUES (70,1,'legacy-long',1,1.00015,1.00015,'2026-09-01')")
    })
    // The product holds nothing on hand: the lot-insert trigger derived the fallback from the newest lot.
    assert.deepEqual({ ...productCost(f) }, { c: 1.0002, p: 1.0002 }, 'sold-out fallback rounds the newest lot cost (tie goes up)')
    assert.equal(costs.buildCatalogCostBreakdown(1, { cost_price_usd: 9, cost_price_khr: null }, [{ id: 70, is_active: 1, unit_cost_usd: 1.00015, received_at: '2026-09-01', remaining_quantity: 0 }], []).result_usd, 1.0002,
      'the JS breakdown shows the stored figure')
  }
}

async function main() {
  await scenarios()
  console.log('test-cost-4dp-lot-writers-native: scenarios ok')
}

if (MUTANT) {
  main().then(() => { console.log(`SURVIVED ${MUTANT}`) }).catch((e) => { console.log(`KILLED ${MUTANT}: ${String(e.message).split('\n')[0].slice(0, 160)}`); process.exitCode = 1 })
} else {
  main().then(() => {
    for (const name of Object.keys(MUTANTS)) {
      const r = spawnSync(process.execPath, [__filename], { env: { ...process.env, COST4DP_MUTANT: name }, encoding: 'utf8' })
      const line = String(r.stdout).split('\n').find((l) => /^(KILLED|SURVIVED)/.test(l)) || String(r.stderr).split('\n')[0]
      assert.notEqual(r.status, 0, `mutant survived: ${name}`)
      assert.ok(/^KILLED/.test(line), `mutant did not run its scenarios: ${name}: ${line}`)
      console.log(`PASS mutant killed: ${name}`)
    }
    console.log(`test-cost-4dp-lot-writers-native: ${Object.keys(MUTANTS).length} mutants killed`)
  }).catch((e) => { console.error(e); process.exitCode = 1 })
}
