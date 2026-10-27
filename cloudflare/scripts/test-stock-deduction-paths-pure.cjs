'use strict'
// Every writer that takes stock out for a SALE either raises the low / out-of-stock crossing alert or is on an explicit,
// reasoned exclusion list (owner ruling 6 Oct 2026: alert when a sale crosses the threshold).
//
// The writers are FOUND, not listed by hand: every file under src/ that
//   (a) subtracts from branch_stock in SQL (an upsert `quantity = branch_stock.quantity - @x`, or `SET quantity = quantity - @x`
//       / `quantity=quantity-@x`), or
//   (b) inserts a 'sale' inventory movement (`movementType: 'sale'`, or an INSERT INTO inventory_movements whose statement names
//       the 'sale' type), or
//   (c) is the bulk-status mover (its signed `quantity+@q` update, which takes stock when q < 0)
// must appear in REGISTRY below, and the registry is checked in both directions:
//   - a file that matches the scan but is not in REGISTRY fails (a NEW deduction path was added without a decision);
//   - a REGISTRY entry the scan no longer finds fails (the list cannot rot);
//   - a `covered` entry must really call the recorder (or the callback that reaches it) in every file it names;
//   - an `excluded` entry must carry a reason of substance.
//
// Run (from cloudflare/scripts): node test-stock-deduction-paths-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'src')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r/g, '')
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return entry.name.endsWith('.ts') ? [path.relative(SRC, full).split(path.sep).join('/')] : []
  })
}

// ---- the scan --------------------------------------------------------------------------------------------------------
const BRANCH_STOCK_DECREMENT = [
  /DO UPDATE SET quantity\s*=\s*branch_stock\.quantity\s*-\s*@/,
  /UPDATE branch_stock SET quantity\s*=\s*quantity\s*-\s*@/,
  /UPDATE \$\{table\} SET quantity\s*=\s*quantity\s*-\s*@/, // a stock table chosen at run time (branch_stock / branch_batch_stock)
]
const BULK_SIGNED_MOVER = /UPDATE branch_stock SET quantity=quantity\+@q /
function sale_movement_writer(source) {
  if (/movementType: 'sale'/.test(source)) return true
  for (const match of source.matchAll(/INSERT INTO inventory_movements/g)) {
    if (/'sale'/.test(source.slice(match.index, match.index + 1800))) return true
  }
  return false
}
function deductionWriters() {
  const found = new Map()
  for (const rel of walk(SRC)) {
    const source = read(rel)
    const hits = []
    if (BRANCH_STOCK_DECREMENT.some((pattern) => pattern.test(source))) hits.push('branch_stock decrement')
    if (BULK_SIGNED_MOVER.test(source)) hits.push('signed branch_stock mover')
    if (sale_movement_writer(source)) hits.push("'sale' movement")
    if (hits.length) found.set(rel, hits)
  }
  return found
}

// ---- the decision for each writer --------------------------------------------------------------------------------------
// covered:  { by: [files that must contain a call to recordStockCrossings( or the onStockTaken callback] }
// excluded: { reason }
const REGISTRY = {
  'routes/sales.ts': { covered: ['routes/sales.ts'], note: 'create, add-items, status transition, amendments, bulk status' },
  'lib/saleAmendments.ts': { covered: ['routes/sales.ts'], note: 'POST /:id/amendments (raised quantity, replacement line) collects the units and calls the recorder' },
  'lib/saleLineAddition.ts': { covered: ['routes/sales.ts'], note: 'POST /:id/items and the amendment replacement line' },
  'lib/saleTransitions.ts': { covered: ['routes/sales.ts'], note: 'PATCH /:id/status (restoring a cancelled sale re-takes its stock)' },
  'lib/saleBulkStatus.ts': { covered: ['routes/sales.ts', 'lib/saleBulkStatus.ts'], note: 'POST /bulk-status passes onStockTaken; applySaleBulkStatus calls it after the commit and on a lost-response retry' },
  'lib/returnsStock.ts': { covered: ['routes/returns.ts', 'lib/returnExchangeCreate.ts'], note: 'planReplacementStock: the replacement a customer takes away on a return / exchange' },
  'routes/returns.ts': { covered: ['routes/returns.ts'], note: 'replacement lines are alerted; its supplier-return and return-reversal decrements are stock leaving for a supplier / undoing a return, not sales' },
  'lib/stockActionCommit.ts': { excluded: 'a historical import of PAST sales (origin stock_action_import, cashier "Unified stock import", IMP- receipts, dated soldAt): a bulk data load, alerting would flood the chat' },
  'lib/saleNotPaidStockRecovery.ts': { excluded: 'a one-off correction receipt for incident sale-not-paid-stock-recovery-20260909 (fixed receipt ids), not a live sale' },
  'lib/productBatches.ts': { excluded: 'manual stock removal, damage and transfer-out through the Stock pages: not a sale (the Stock Change ledger and its own alerts cover them)' },
  'lib/datedStockCountApply.ts': { excluded: 'a stock-count adjustment applying counted quantities: not a sale' },
}

const failures = []
const check = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.error(`FAIL ${name}\n${error.message}`) } }

const writers = deductionWriters()

check('scan: the finder sees the writers it must (a control: the scan is not vacuous)', () => {
  for (const must of ['routes/sales.ts', 'lib/saleAmendments.ts', 'lib/saleBulkStatus.ts', 'lib/saleLineAddition.ts', 'lib/saleTransitions.ts', 'lib/returnsStock.ts', 'lib/stockActionCommit.ts']) {
    assert.ok(writers.has(must), `${must} is a known deduction writer but the scan did not find it: ${[...writers.keys()].join(', ')}`)
  }
  assert.ok(!writers.has('lib/stockCrossingAlert.ts'), 'the recorder itself writes no stock')
})

check('every deduction writer found in src/ has a decision (a new path fails here until it is covered or excluded with a reason)', () => {
  const undecided = [...writers.keys()].filter((rel) => !(rel in REGISTRY))
  assert.deepEqual(undecided, [], `these files take stock but neither call the crossing recorder nor sit on the exclusion list: ${undecided.map((rel) => `${rel} [${writers.get(rel).join(', ')}]`).join('; ')}. `
    + 'Wire them to recordStockCrossings (lib/stockCrossingAlert.ts) and register them as covered, or register them as excluded WITH a reason.')
})

check('the registry has no stale entry: every entry is still found by the scan', () => {
  const stale = Object.keys(REGISTRY).filter((rel) => !writers.has(rel))
  assert.deepEqual(stale, [], `registry entries the scan no longer finds: ${stale.join(', ')}`)
})

check('every covered entry really reaches the recorder in each file it names', () => {
  for (const [rel, entry] of Object.entries(REGISTRY)) {
    if (!entry.covered) continue
    for (const by of entry.covered) {
      const source = read(by)
      const reaches = by === 'lib/saleBulkStatus.ts' ? /onStockTaken\(lines\)/.test(source) : /recordStockCrossings\(/.test(source)
      assert.ok(reaches, `${rel} is registered as covered by ${by}, which does not call the recorder`)
    }
  }
  const sales = read('routes/sales.ts')
  assert.ok(sales.split('recordStockCrossings(c.env').length - 1 >= 7, 'sales.ts: create, status transition, add-items (+ its lost-response retry), amendments (+ its retry), bulk status')
  assert.ok(/applySaleBulkStatus\(c\.env[\s\S]{0,400}recordStockCrossings\(c\.env/.test(sales), 'bulk-status passes the recorder to applySaleBulkStatus')
  assert.ok(/replacementLines\.map/.test(read('routes/returns.ts')) && /priced\.lines\.map/.test(read('lib/returnExchangeCreate.ts')))
})

check('every excluded entry states a real reason', () => {
  for (const [rel, entry] of Object.entries(REGISTRY)) {
    if (!entry.excluded) continue
    assert.ok(entry.excluded.length >= 40, `${rel}: exclusion needs a reason of substance`)
    assert.ok(!read(rel).includes('recordStockCrossings('), `${rel} is excluded but calls the recorder: move it to covered`)
  }
})

check('the signed bulk mover is recognised even though its SQL has no subtraction', () => {
  assert.ok(BULK_SIGNED_MOVER.test(read('lib/saleBulkStatus.ts')))
  assert.deepEqual(writers.get('lib/saleBulkStatus.ts').includes('signed branch_stock mover'), true)
})

if (failures.length) { console.error(`\n${failures.length} FAILED`); process.exit(1) }
console.log('\nall deduction-path checks passed')
