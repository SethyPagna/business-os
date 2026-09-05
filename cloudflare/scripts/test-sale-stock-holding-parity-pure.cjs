// S4-3 / S4-4: `awaiting_payment` HOLDS stock, and every gate agrees on WHICH
// statuses hold.
//
// WHY THIS FILE EXISTS. "Does this sale hold its units?" is asked in five
// places that must never disagree:
//
//   lib/salesStatus.ts        STOCK_DEDUCTED_STATUSES        (the membership)
//   lib/saleTransitions.ts    heldQuantity()                 (an early return
//                                                             for hold-nothing
//                                                             statuses, THEN
//                                                             the set)
//   lib/saleLineAddition.ts   saleStatusDeductsStock()
//   lib/saleLineAddition.ts   allocateNewSaleLines() -> heldUnits
//   lib/saleAmendments.ts     saleAmendmentMovesStock() / amendmentHeldUnits()
//
// heldQuantity's early return is a SECOND, INDEPENDENT gate: it can zero a
// status before STOCK_DEDUCTED_STATUSES is ever consulted. That is exactly
// the shape that lets a fix half-apply -- move the set, forget the early
// return, and the system reports a new rule while behaving by the old one.
//
// So this file asserts the RULE, never the literal contents of a Set:
//
//   for EVERY valid status s:  heldQuantity(s, q, 0) > 0  <=>  s holds
//
// where "s holds" is read from the sets themselves. Both halves of a
// half-applied change go red:
//   - set changed, early return not  -> the set says hold, held() says 0
//   - early return changed, set not  -> held() says hold, the set says 0
//
// Then the substantive S4-3 behaviour, its double-apply case, its reversal,
// and S4-2's sticky stock_skipped flag which must still beat all of it.
//
// Run: node scripts/test-sale-stock-holding-parity-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

function compile(file, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request)
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

const salesStatus = compile('salesStatus.ts')
const productBatches = compile('productBatches.ts', {
  './db': {},
  './batchCode': compile('batchCode.ts'),
  './sqlBinding': compile('sqlBinding.ts'),
})
const saleTransitions = compile('saleTransitions.ts', {
  './salesStatus': salesStatus,
  './productBatches': productBatches,
})
const financialPrecision = compile('financialPrecision.ts')
const saleLineAddition = compile('saleLineAddition.ts', {
  './salesStatus': salesStatus,
  './saleTransitions': saleTransitions,
  './productBatches': productBatches,
  './db': {},
  './saleTotals': compile('saleTotals.ts'),
  './financialPrecision': financialPrecision,
})

const { VALID_SALE_STATUSES, STOCK_DEDUCTED_STATUSES, RETURN_STATUSES } = salesStatus
const { heldQuantity, planSaleStockTransition } = saleTransitions
const { saleStatusDeductsStock, allocateNewSaleLines } = saleLineAddition

const QTY = 7

// The rule, derived from the sets rather than hardcoded: a status holds its
// units when it is a deducting status or a return status (a return status
// holds quantity - alreadyReturned, which for returned=0 is the full qty).
const holdsByRule = (status) => STOCK_DEDUCTED_STATUSES.has(status) || RETURN_STATUSES.has(status)

// ---------------------------------------------------------------------------
console.log('PASS 1 -- the two gates in lib agree for EVERY valid status')
// This is the assertion that makes the half-applied fix impossible. It does
// not care WHICH statuses hold; it cares that held() and the sets say the
// same thing about each one.
for (const status of VALID_SALE_STATUSES) {
  const held = heldQuantity(status, QTY, 0)
  const expected = holdsByRule(status) ? QTY : 0
  assert.strictEqual(
    held, expected,
    `heldQuantity('${status}') returned ${held} but the status sets say it ${holdsByRule(status) ? 'HOLDS' : 'holds NOTHING'}. `
    + 'One gate moved without the other: check salesStatus.ts STOCK_DEDUCTED_STATUSES against '
    + "saleTransitions.ts heldQuantity()'s early return.",
  )
}

// The early return may only ever zero a status the sets already call
// hold-nothing. Stated separately so the failure message points at the cause.
for (const status of VALID_SALE_STATUSES) {
  if (holdsByRule(status)) {
    assert.ok(
      heldQuantity(status, QTY, 0) > 0,
      `'${status}' is in a holding set but heldQuantity zeroed it -- an early return is shadowing the set.`,
    )
  }
}

// ---------------------------------------------------------------------------
console.log('PASS 2 -- the S4-3 rule itself: awaiting_payment holds, only cancelled does not')
assert.strictEqual(heldQuantity('awaiting_payment', QTY, 0), QTY,
  'S4-3: an unpaid order has taken the goods off the shelf.')
assert.strictEqual(heldQuantity('cancelled', QTY, 0), 0,
  'a cancelled sale holds nothing.')
// Stated as the rule, not as a list: cancelled is the ONLY live status that
// holds nothing. If a future status is added that holds nothing, this is a
// deliberate place to come and think about it.
const nonHolding = VALID_SALE_STATUSES.filter((status) => !holdsByRule(status))
assert.deepStrictEqual(nonHolding, ['cancelled'],
  `expected 'cancelled' to be the only non-holding status, got ${JSON.stringify(nonHolding)}`)
// Return statuses still net off what already came back.
assert.strictEqual(heldQuantity('partial_return', QTY, 3), QTY - 3)
assert.strictEqual(heldQuantity('returned', QTY, QTY), 0)

// ---------------------------------------------------------------------------
console.log('PASS 3 -- every downstream gate agrees with heldQuantity, per status')
for (const status of VALID_SALE_STATUSES) {
  const held = heldQuantity(status, QTY, 0) > 0

  // saleLineAddition's own predicate. It reads STOCK_DEDUCTED_STATUSES only,
  // so it is compared against the set for non-return statuses.
  if (!RETURN_STATUSES.has(status)) {
    assert.strictEqual(
      saleStatusDeductsStock(status), held,
      `saleStatusDeductsStock('${status}') disagrees with heldQuantity('${status}')`,
    )
  }

  // The allocation kernel, which is where heldUnits is actually computed for
  // an added line -- the number that decides whether stock statements are
  // emitted at all.
  const [line] = allocateNewSaleLines(
    [{ productId: 1, productName: 'p', quantity: QTY, branchId: 2, unitPriceUsd: 1, costPriceUsd: 0, costPriceKhr: 0 }],
    new Map(),
    status,
  )
  assert.strictEqual(
    line.heldUnits > 0, held,
    `allocateNewSaleLines heldUnits for '${status}' disagrees with heldQuantity('${status}')`,
  )
}

// ---------------------------------------------------------------------------
console.log('PASS 4 -- DOUBLE-APPLY: awaiting_payment -> completed moves nothing')
// The whole point of S4-3, and the trap it removes. The units left the shelf
// when the order was taken; completing the sale must not take them again.
// This is also what makes the transition safe to re-run.
const items = [{ id: 1, product_id: 10, product_name: 'p', quantity: QTY, cost_price_usd: 1, cost_price_khr: 0, branch_id: 2, batch_id: null }]
const noReturns = new Map([[1, 0]])
const plan = (oldStatus, newStatus) => planSaleStockTransition({
  saleId: 1, oldStatus, newStatus, items, returnedByItem: noReturns,
  reason: 'test', userId: null, userName: null,
})

const settle = plan('awaiting_payment', 'completed')
assert.strictEqual(settle.deductedUnits, 0, 'settling an unpaid order must not deduct a second time')
assert.strictEqual(settle.restoredUnits, 0)
assert.strictEqual(settle.statements.length, 0, 'a zero-delta transition emits NO statements at all')

// Re-running it is still zero -- idempotent, not merely small.
const settleAgain = plan('completed', 'completed')
assert.strictEqual(settleAgain.deductedUnits, 0)
assert.strictEqual(settleAgain.statements.length, 0)

// And the same in the other direction: un-settling gives nothing back,
// because nothing was taken by that transition.
const unsettle = plan('completed', 'awaiting_payment')
assert.strictEqual(unsettle.restoredUnits, 0, 'completed -> awaiting_payment must not restore: both hold')
assert.strictEqual(unsettle.deductedUnits, 0)

// ---------------------------------------------------------------------------
console.log('PASS 5 -- REVERSAL: cancelling an unpaid order gives the units back exactly once')
const cancelFromAwaiting = plan('awaiting_payment', 'cancelled')
assert.strictEqual(cancelFromAwaiting.restoredUnits, QTY,
  'S4-3: the units WERE held for an unpaid order, so cancelling must return them')
assert.strictEqual(cancelFromAwaiting.deductedUnits, 0)

// The reversal is worth the same however the sale got there: taking the
// order then completing then cancelling restores QTY once, not twice.
const viaCompleted = plan('awaiting_payment', 'completed').restoredUnits
  + plan('completed', 'cancelled').restoredUnits
assert.strictEqual(viaCompleted, QTY,
  'restoring must total the units once across the whole path, never once per hop')

// Un-cancelling back into the unpaid state re-takes them, once.
const uncancel = plan('cancelled', 'awaiting_payment')
assert.strictEqual(uncancel.deductedUnits, QTY)
assert.strictEqual(uncancel.restoredUnits, 0)

// Round trip is a no-op on the shelf.
assert.strictEqual(
  cancelFromAwaiting.restoredUnits - uncancel.deductedUnits, 0,
  'cancel then un-cancel must leave stock exactly where it started',
)

// ---------------------------------------------------------------------------
console.log('PASS 6 -- S4-2 stock_skipped still beats the status, now that the status holds')
// Before S4-3 this was untestable in the direction that matters: a migrated
// sale sat in awaiting_payment, which held nothing anyway, so the flag was
// never load-bearing there. Now it is the only thing keeping those sales out
// of the ledger.
const skipPlan = planSaleStockTransition({
  saleId: 1, oldStatus: 'awaiting_payment', newStatus: 'cancelled', items, returnedByItem: noReturns,
  reason: 'test', userId: null, userName: null, skipStock: true,
})
assert.strictEqual(skipPlan.statements.length, 0, 'skipStock emits zero statements')
assert.strictEqual(skipPlan.restoredUnits, 0, 'and invents no units')
assert.strictEqual(skipPlan.deductedUnits, 0)
assert.strictEqual(skipPlan.skippedUnits, QTY, 'but RECORDS what it deliberately did not move')

// ---------------------------------------------------------------------------
console.log('PASS 7 -- the addition kernel takes skipStock as a FACT, not a status stand-in')
// Regression lock on the sentinel that S4-3 would have inverted. Callers used
// to pass a literal 'awaiting_payment' to mean "hold nothing"; once
// awaiting_payment held, that stand-in would have planned a FULL deduction on
// exactly the stock_skipped sales that must never move a unit.
const mkLine = (status, skipStock) => allocateNewSaleLines(
  [{ productId: 1, productName: 'p', quantity: QTY, branchId: 2, unitPriceUsd: 1, costPriceUsd: 0, costPriceKhr: 0 }],
  new Map(),
  status,
  skipStock,
)[0]

assert.strictEqual(mkLine('awaiting_payment', false).heldUnits, QTY,
  'a line added to a normal unpaid order takes its units now')
assert.strictEqual(mkLine('awaiting_payment', true).heldUnits, 0,
  'a line added to a stock_skipped unpaid order takes nothing')
assert.strictEqual(mkLine('completed', true).heldUnits, 0,
  'the flag beats a completed status too')
assert.strictEqual(mkLine('completed', false).heldUnits, QTY)

// ---------------------------------------------------------------------------
console.log('PASS 8 -- no caller smuggles "hold nothing" in as a status literal')
// A source lock, because the defect this pins is invisible to any behavioural
// test of the lib: it lives in how the ROUTE calls it.
const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
assert.ok(
  !/movesStock\s*\?\s*saleStatus\s*:\s*'awaiting_payment'/.test(routeSource),
  "routes/sales.ts still passes a literal 'awaiting_payment' as a stand-in for \"holds nothing\". "
  + 'That inverted the moment awaiting_payment started holding stock -- pass the skipStock flag instead.',
)
// And the add-items route must combine the status with the sticky flag rather
// than trusting the status alone.
assert.ok(
  /saleStatusDeductsStock\(saleStatus\)\s*&&\s*!skipStock/.test(routeSource),
  'the add-items route must AND the status gate with S4-2\'s stock_skipped flag, '
  + 'or a migrated sale deducts stock the system never took.',
)

// ---------------------------------------------------------------------------
console.log('PASS 9 -- the frontend mirror of the rule matches the server')
// Sales.tsx keeps its own copy to label the confirmation dialog. A stale copy
// tells the shop the opposite of what the server is about to do.
const salesTsx = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'sales', 'Sales.tsx'), 'utf8',
)
const mirror = salesTsx.match(/const STOCK_HOLDING_STATUSES = new Set\(\[([^\]]*)\]\)/)
assert.ok(mirror, 'Sales.tsx STOCK_HOLDING_STATUSES not found -- the mirror moved, re-point this lock')
const mirrorSet = mirror[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
const serverHolding = VALID_SALE_STATUSES.filter(holdsByRule)
assert.deepStrictEqual(
  [...mirrorSet].sort(), [...serverHolding].sort(),
  'frontend Sales.tsx STOCK_HOLDING_STATUSES has drifted from the server rule. '
  + 'Both move in the same commit.',
)

console.log('\nAll sale stock-holding parity assertions passed.')
