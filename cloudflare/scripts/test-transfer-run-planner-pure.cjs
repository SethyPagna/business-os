const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
function load(name, dependencies = {}) {
  const file = path.join(__dirname, '../src/lib', name + '.ts')
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', 'require', output)(module, module.exports, name => {
    assert.ok(name in dependencies, `unexpected dependency ${name}`)
    return dependencies[name]
  })
  return module.exports
}
const budget = load('transferRunBudget')
const quantityKernel = load('moneyPrecision')
const { planTransferRunFragment: plan } = load('transferRunPlanner', { './transferRunBudget': budget, './moneyPrecision': quantityKernel })
const { readTransferLotPage: read, TRANSFER_LOT_PAGE_MAX } = load('transferRunLots')
const reserve = (tier = 'free', alreadyUsed = 0) => ({ tier, alreadyUsed, remainingReads: 3,
  completionQueries: 2, retryQueries: 2, safetyQueries: 3, extraAtomicStatements: 2 })
const db = new Database(':memory:')
db.exec(`CREATE TABLE product_batches(id INTEGER PRIMARY KEY,variant_product_id INTEGER,is_active INTEGER,
  received_at TEXT,batch_number INTEGER,unit_cost_usd REAL);
  CREATE TABLE branch_batch_stock(batch_id INTEGER,branch_id INTEGER,quantity REAL,PRIMARY KEY(batch_id,branch_id));`)
const insert = db.prepare('INSERT INTO product_batches VALUES(?,?,?,?,?,?)')
const stock = db.prepare('INSERT INTO branch_batch_stock VALUES(?,?,?)')
for (let id = 1; id <= 1200; id++) {
  insert.run(id, 1, 1, id > 1190 ? null : '2026-01-01', id % 5 === 0 ? null : id, 3.123456)
  stock.run(id, 1, 1)
}
insert.run(1201, 2, 1, '1900-01-01', 1, 9); stock.run(1201, 1, 3)
insert.run(1202, 1, 0, '1900-01-01', 1, 9); stock.run(1202, 1, 3)
insert.run(1203, 1, 1, '1900-01-01', 1, 9); stock.run(1203, 2, 3)
let reads = 0
const adapter = { prepare(sql) { return { async all(params) { reads++; return db.prepare(sql).all(params) } } } }
async function main() {
  for (const tier of ['free', 'paid']) {
    const b = reserve(tier)
    const allowance = budget.transferStatementAllowance(b)
    assert.equal(allowance, (tier === 'free' ? 50 : 1000) - 12)
    budget.assertTransferStatementsFit(b, allowance)
    assert.throws(() => budget.assertTransferStatementsFit(b, allowance + 1), /budget/)
    assert.throws(() => budget.transferStatementAllowance({ ...b, retryQueries: undefined }), /reserves/)
  }
  assert.throws(() => budget.transferStatementAllowance({ ...reserve(), tier: 'unknown' }), /tier/)
  assert.throws(() => budget.transferStatementEstimate(1, 0, 1), /counts/)
  console.log('PASS both-tier exact boundaries, explicit reserves, invalid budgets')

  const expected = db.prepare(`SELECT pb.id FROM product_batches pb JOIN branch_batch_stock bs ON bs.batch_id=pb.id
    WHERE pb.variant_product_id=1 AND pb.is_active=1 AND bs.branch_id=1 AND bs.quantity>0
    ORDER BY (received_at IS NULL),received_at,batch_number,id`).all().map(row => row.id)
  const seen = []
  let after = null
  do {
    const page = await read(adapter, { productId: 1, branchId: 1, limit: 17, after })
    assert.ok(page.lots.length <= 17)
    seen.push(...page.lots.map(lot => lot.batchId))
    if (page.exhausted) break
    after = page.lots.at(-1).cursor
  } while (true)
  assert.deepEqual(seen, expected)
  assert.equal(new Set(seen).size, 1200)
  console.log('PASS bounded keyset pages match existing FIFO including NULL dates/numbers')

  const beforeReads = reads
  const selected = await read(adapter, { productId: 1, branchId: 1, selectedBatchId: 1199, limit: 10 })
  assert.equal(reads - beforeReads, 1)
  assert.deepEqual(selected.lots.map(lot => lot.batchId), [1199])
  assert.equal(plan({ page: selected, remainingQuantity: 0.5, budget: reserve(), mayCloneLots: false }).quantity, 0.5)
  assert.throws(() => plan({ page: selected, remainingQuantity: 2, budget: reserve(), mayCloneLots: false }), /Selected lot/)
  for (const selectedBatchId of [1201, 1202, 1203]) {
    const invalid = await read(adapter, { productId: 1, branchId: 1, selectedBatchId, limit: 1 })
    assert.throws(() => plan({ page: invalid, remainingQuantity: 1, budget: reserve(), mayCloneLots: false }), /Selected lot/)
  }
  await assert.rejects(read(adapter, { productId: 2, branchId: 1, after: selected.lots[0].cursor, limit: 1 }), /cursor/)
  await assert.rejects(read(adapter, { productId: 1, branchId: 1, limit: TRANSFER_LOT_PAGE_MAX + 1 }), /page/)
  console.log('PASS selected-lot only, shortage fail-closed, scope/cursor/page limits')

  for (const tier of ['free', 'paid']) {
    let remaining = 1204, cursor = null, untracked = 0, chunks = 0
    const allocated = []
    while (remaining > 0) {
      const page = await read(adapter, { productId: 1, branchId: 1, limit: 100, after: cursor })
      const fragment = plan({ page, remainingQuantity: remaining, budget: reserve(tier), mayCloneLots: true })
      assert.deepEqual(fragment, plan({ page, remainingQuantity: remaining, budget: reserve(tier), mayCloneLots: true }))
      budget.assertTransferStatementsFit(reserve(tier), fragment.estimatedStatements)
      if (!page.exhausted || fragment.allocations.length < page.lots.length) assert.equal(fragment.untrackedQuantity, 0)
      allocated.push(...fragment.allocations.map(lot => lot.batchId))
      untracked += fragment.untrackedQuantity
      remaining = fragment.remainingQuantity
      cursor = fragment.after || cursor
      assert.ok(++chunks < 200)
    }
    assert.deepEqual(allocated, expected)
    assert.equal(untracked, 4)
    assert.ok(chunks > 1)
  }
  console.log('PASS single-product 1200 lots partition deterministically under both tiers; final remainder only after exhaustion')

  const page = await read(adapter, { productId: 1, branchId: 1, limit: 2 })
  const noLotRoom = reserve('free', 19) // 19 statements available: base only
  assert.throws(() => plan({ page, remainingQuantity: 3, budget: noLotRoom, mayCloneLots: false }), /No transfer progress/)
  const empty = await read(adapter, { productId: 3, branchId: 1, limit: 2 })
  const remainder = plan({ page: empty, remainingQuantity: 3, budget: noLotRoom, mayCloneLots: false })
  assert.equal(remainder.untrackedQuantity, 3)
  assert.equal(remainder.estimatedStatements, 19)
  assert.throws(() => plan({ page: empty, remainingQuantity: 3, budget: reserve('free', 20), mayCloneLots: false }), /No transfer fits/)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM product_batches WHERE unit_cost_usd=3.123456').get().n, 1200)
  assert.equal(db.prepare('SELECT SUM(quantity) n FROM branch_batch_stock').get().n, 1209)
  console.log('PASS budget clipping never fabricates untracked stock; no stored money or quantity mutation')

  const fractionalPage = (quantities, exhausted = true, selectedBatchId = null) => ({
    productId: 1, branchId: 1, exhausted, selectedBatchId,
    lots: quantities.map((available, index) => ({ batchId: index + 1, available,
      cursor: { productId: 1, branchId: 1, batchId: index + 1, receivedAt: null, batchNumber: null } })),
  })
  const fractional = plan({ page: fractionalPage(Array(7).fill(0.1)), remainingQuantity: 0.7, budget: reserve(), mayCloneLots: false })
  assert.equal(fractional.untrackedQuantity, 0)
  assert.equal(fractional.remainingQuantity, 0)
  assert.equal(fractional.quantity, 0.7)
  assert.equal(quantityKernel.subtractDecimalSum(0.7, fractional.allocations.map(row => row.quantity)), '0')
  const clipped = plan({ page: fractionalPage(Array(7).fill(0.1)), remainingQuantity: 0.7, budget: reserve('free', 17), mayCloneLots: false })
  assert.equal(clipped.allocations.length, 2)
  assert.equal(clipped.quantity, 0.2)
  assert.equal(clipped.remainingQuantity, 0.5)
  assert.equal(clipped.untrackedQuantity, 0)
  const resumed = plan({ page: fractionalPage(Array(5).fill(0.1)), remainingQuantity: clipped.remainingQuantity, budget: reserve(), mayCloneLots: false })
  assert.equal(resumed.untrackedQuantity, 0)
  assert.equal(resumed.remainingQuantity, 0)
  const selectedFraction = plan({ page: fractionalPage([0.3], true, 1), remainingQuantity: 0.2, budget: reserve(), mayCloneLots: false })
  assert.equal(selectedFraction.quantity, 0.2)
  assert.equal(selectedFraction.untrackedQuantity, 0)
  const genuineRemainder = plan({ page: fractionalPage([0.1, 0.1]), remainingQuantity: 0.3, budget: reserve(), mayCloneLots: false })
  assert.equal(genuineRemainder.untrackedQuantity, 0.1)
  assert.equal(quantityKernel.subtractDecimalSum(genuineRemainder.quantity,
    [...genuineRemainder.allocations.map(row => row.quantity), genuineRemainder.untrackedQuantity]), '0')
  const nextPageNeeded = plan({ page: fractionalPage([0.1, 0.1], false), remainingQuantity: 0.3, budget: reserve(), mayCloneLots: false })
  assert.equal(nextPageNeeded.untrackedQuantity, 0)
  assert.equal(nextPageNeeded.remainingQuantity, 0.1)
  for (const unsafe of [1e20, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
    assert.throws(() => plan({ page: fractionalPage([1]), remainingQuantity: unsafe, budget: reserve(), mayCloneLots: false }), /quantity/)
    assert.throws(() => plan({ page: fractionalPage([unsafe]), remainingQuantity: 1, budget: reserve(), mayCloneLots: false }), /lot page/)
  }
  assert.throws(() => plan({ page: fractionalPage([0.1]), remainingQuantity: Number.MAX_SAFE_INTEGER,
    budget: reserve(), mayCloneLots: false }), /represented exactly/)
  console.log('PASS exact fractional exhausted/clipped/resumed/selected conservation; genuine remainder; unsafe magnitude and decimal roundtrip refusal')
  db.close()
}
main().catch(error => { console.error(error); process.exitCode = 1 })
