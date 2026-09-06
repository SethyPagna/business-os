// S4-15/S4-16: the receipt facts a stock-IN carries, and the two surfaces
// that must actually put them on the wire.
//
// The defect this covers: the Sessions list (StockInSessionsSection.tsx) has
// always had Supplier, Payment and Total cost columns, and
// POST /api/inventory/adjust has always accepted unitCostUsd, paymentStatus,
// creditDueDate and sessionId. Only FastStockInModal sent them. A receipt
// entered from the Products section or the Stock-changes ledger (both open
// StockAdjustModal) or from the Inventory page landed in that list with an
// empty Payment and a "-" Total cost -- and a "Set quantity" that raised the
// figure, which the route converts into a real add, offered no cost field at
// all.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  isStockInSubmission,
  isSetDownSubmission,
  isBatchPickerVisible,
  stockAdjustBatchWire,
  bulkActionCanReceive,
  bulkStockReceiptWire,
  isStockReceiptCreditIncomplete,
  stockReceiptWire,
  stockReceiptGateCode,
  adjustBranchQuantity,
  STOCK_RECEIPT_GATE_CODES,
  STOCK_RECEIPT_GATE_KEYS,
} from '../src/utils/stockReceiptFields.ts'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8')
}

runTest('a stock-in is an add, or a set that RAISES the figure (S4-16)', () => {
  assert.equal(isStockInSubmission('add', 5, 0), true)
  assert.equal(isStockInSubmission('add', 5, 100), true, 'an add is a receipt whatever is on hand')
  assert.equal(isStockInSubmission('remove', 5, 100), false)
  // routes/inventory.ts turns a set into an add of the difference only when
  // the requested total is above what the branch holds.
  assert.equal(isStockInSubmission('set', 12, 4), true)
  assert.equal(isStockInSubmission('set', 4, 12), false, 'a set that lowers stock is a remove')
  assert.equal(isStockInSubmission('set', 7, 7), false, 'a set to the same figure writes nothing')
  // Half-typed input must not be read as a receipt.
  assert.equal(isStockInSubmission('set', '', 3), false)
  assert.equal(isStockInSubmission('set', 5, undefined), false)
})

runTest('the adjust form measures against the BRANCH it is adjusting, not the page filter', () => {
  // The fixture the two rules disagree on. Inventory.tsx derived the figure it
  // handed the modal from `getStockQty`, which answers with whatever the LIST
  // is showing -- the product TOTAL while the page's branch filter is "All
  // branches" -- while the form was adjusting branch 5, which holds 12.
  const branchStock = [{ branch_id: 5, quantity: 12 }, { branch_id: 2, quantity: 43 }]
  const pageFilterFigure = 55 // getStockQty(adjustModal) under branchFilter 'all'
  const branchFigure = adjustBranchQuantity(branchStock, '5', pageFilterFigure)
  assert.equal(branchFigure, 12)
  assert.notEqual(branchFigure, pageFilterFigure, 'the fixture must be one the two rules answer differently')

  // "Set to 20" on branch 5. routes/inventory.ts compares 20 against the
  // BRANCH row (branchStockQty), so it converts this into an add of 8 and runs
  // it through the receipt gate.
  const ctx = { type: 'set', quantity: 20, unlockPricing: false, branchId: 5, batchId: '7' }
  assert.equal(isStockInSubmission('set', 20, branchFigure), true, 'the route receives goods here')

  // The old answer, on the page figure: a set-DOWN. The modal showed the batch
  // picker (asking which lot to drain), hid the supplier field, and the wire
  // carried the picked lot id -- into an ADD, which then topped up, and
  // inherited the supplier of, the lot the operator had picked to remove from.
  // The submission itself came back 400 supplier_required with no field on
  // screen able to answer it.
  assert.equal(isStockInSubmission('set', 20, pageFilterFigure), false)
  assert.equal(isSetDownSubmission('set', 20, pageFilterFigure), true)
  assert.equal(isBatchPickerVisible({ ...ctx, currentQuantity: pageFilterFigure }), true)
  assert.deepEqual(stockAdjustBatchWire({ ...ctx, currentQuantity: pageFilterFigure }), { batchId: '7', lotAttributionDeferred: true })

  // The new answer: one figure, so what the modal renders and what the
  // submitter gates are the same verdict on the same submission.
  assert.equal(isSetDownSubmission('set', 20, branchFigure), false)
  assert.equal(isBatchPickerVisible({ ...ctx, currentQuantity: branchFigure }), false)
  assert.deepEqual(stockAdjustBatchWire({ ...ctx, currentQuantity: branchFigure }), { lotAttributionDeferred: false })

  // No branch named: routes/inventory.ts falls back to the default branch, so
  // the form keeps the only figure it can see rather than inventing a zero.
  assert.equal(adjustBranchQuantity(branchStock, '', pageFilterFigure), 55)
  assert.equal(adjustBranchQuantity(branchStock, null, pageFilterFigure), 55)
  // A branch with no row holds nothing -- the same answer branchStockQty gives
  // the route, and the answer `previousQuantity` already gave.
  assert.equal(adjustBranchQuantity(branchStock, '9', pageFilterFigure), 0)
  assert.equal(adjustBranchQuantity(undefined, '5', pageFilterFigure), 0)
  // String branch ids from the <select> resolve the same as numbers.
  assert.equal(adjustBranchQuantity([{ branch_id: '5', quantity: '12' }], 5, 55), 12)
})

runTest('both adjust surfaces resolve that figure through the one shared rule', () => {
  for (const path of ['components/inventory/Inventory.tsx', 'components/products/forms/StockAdjustModal.tsx']) {
    const text = source(path)
    assert.ok(text.includes('adjustBranchQuantity('), `${path} must resolve the adjust figure from the shared branch rule`)
  }
  const inventory = source('components/inventory/Inventory.tsx')
  assert.ok(!inventory.includes('adjustModal ? getStockQty(adjustModal) : 0'),
    'Inventory.tsx must stop handing the modal the page filter\'s figure')

  // The supplier field's visibility must be the receipt gate's own
  // applicability, not a narrower predicate. A locked add with no branch named
  // still reaches the Worker's gate -- routes/inventory.ts falls back to the
  // default branch and gates every add -- and the old `createsOrFillsLot`
  // (which required a visible batch picker, hence a branch) hid the one field
  // that could have satisfied it.
  const modals = source('components/inventory/InventoryStockModals.tsx')
  assert.ok(!modals.includes('createsOrFillsLot'),
    'the supplier field must render on the same predicate the gate runs on (isStockIn)')
  assert.equal(stockReceiptGateCode({ isStockIn: true, supplierName: '', unitCostUsd: '3' }), 'supplier_required',
    'the gate this fixture is about still refuses a supplier-less add')
})

runTest('on credit without a due date is refused before the request, as the route would', () => {
  assert.equal(isStockReceiptCreditIncomplete({ unit_cost_usd: '2', payment_status: 'credit', credit_due_date: '' }), true)
  assert.equal(isStockReceiptCreditIncomplete({ unit_cost_usd: '2', payment_status: 'credit', credit_due_date: '   ' }), true)
  assert.equal(isStockReceiptCreditIncomplete({ unit_cost_usd: '2', payment_status: 'credit', credit_due_date: '2026-10-01' }), false)
  assert.equal(isStockReceiptCreditIncomplete({ unit_cost_usd: '2', payment_status: 'paid', credit_due_date: '' }), false)
})

runTest('the wire carries only what was typed, and nothing at all for a remove', () => {
  const paid = { unit_cost_usd: '3.25', payment_status: 'paid', credit_due_date: '' }
  assert.deepEqual(stockReceiptWire(paid, 1757003912345, true), {
    unitCostUsd: 3.25, paymentStatus: 'paid', sessionId: 1757003912345,
  })
  // Not a stock-in: no cost, no payment, no session id can ride along.
  assert.deepEqual(stockReceiptWire(paid, 1757003912345, false), {})
  // A blank cost stays blank -- the Sessions list reports "no receipt-level
  // cost" honestly rather than borrowing the product's stored cost price.
  assert.deepEqual(stockReceiptWire({ unit_cost_usd: '', payment_status: 'paid', credit_due_date: '' }, null, true), {
    paymentStatus: 'paid',
  })
  // Zero is a real answer (free stock, a sample); only blank is "unknown".
  assert.equal(stockReceiptWire({ unit_cost_usd: '0', payment_status: 'paid', credit_due_date: '' }, null, true).unitCostUsd, 0)
  // Junk and negatives never reach the wire.
  for (const bad of ['abc', '-1', ' ']) {
    assert.equal(
      stockReceiptWire({ unit_cost_usd: bad, payment_status: 'paid', credit_due_date: '' }, null, true).unitCostUsd,
      undefined,
      `cost ${JSON.stringify(bad)} should not be sent`,
    )
  }
  // Credit carries its due date; an unrecognised payment value carries none.
  assert.deepEqual(stockReceiptWire({ unit_cost_usd: '1', payment_status: 'credit', credit_due_date: '2026-10-01' }, null, true), {
    unitCostUsd: 1, paymentStatus: 'credit', creditDueDate: '2026-10-01',
  })
  assert.equal(stockReceiptWire({ unit_cost_usd: '1', payment_status: '', credit_due_date: '' }, null, true).paymentStatus, undefined)
  // A non-positive or non-integer session id is dropped rather than sent --
  // the route requires a safe positive integer.
  for (const bad of [0, -1, 1.5, Number.NaN, null]) {
    assert.equal(
      stockReceiptWire(paid, bad as number, true).sessionId,
      undefined,
      `session id ${String(bad)} should not be sent`,
    )
  }
})

runTest('the shared adjust form actually asks for the cost and the payment', () => {
  const modals = source('components/inventory/InventoryStockModals.tsx')
  // The form gates on the shared rule, not on `type === 'add'`, so a
  // set-that-raises gets the same fields (S4-16).
  assert.match(modals, /const isStockIn = isStockInSubmission\(adjustForm\.type, adjustForm\.quantity, adjustCurrentQuantity\)/)
  assert.match(modals, /id="inventory-adjust-unit-cost"/)
  assert.match(modals, /id="inventory-adjust-credit-due-date"/)
  assert.match(modals, /tr\('receipt_cost', 'Receipt cost'\)/)
  // Received date and supplier moved off `type === 'add'` onto the same rule.
  assert.doesNotMatch(modals, /\{adjustForm\.type === 'add' && \(unlockPricing \|\|/)
})

runTest('both adjust surfaces send the receipt fields and a grouping session id', () => {
  // Products section AND Stock changes both open StockAdjustModal, so one
  // payload builder covers the two entry points S4-15 names; Inventory.tsx is
  // the sibling surface on the same shared form and must not drift.
  for (const path of ['components/products/forms/StockAdjustModal.tsx', 'components/inventory/Inventory.tsx']) {
    const text = source(path)
    assert.match(text, /\.\.\.stockReceiptWire\(adjustForm, receiptSessionIdRef\.current, isStockIn\)/, `${path} must spread the receipt wire`)
    assert.match(text, /isStockReceiptCreditIncomplete\(adjustForm\)/, `${path} must refuse credit with no due date`)
    // supplier and received date follow the same stock-in rule now.
    assert.match(text, /supplierId: isStockIn && adjustForm\.supplier_id !== ''/, `${path} supplier must follow isStockIn`)
    assert.doesNotMatch(text, /supplierId: adjustForm\.type === 'add'/, `${path} must not gate supplier on 'add' alone`)
    assert.match(text, /adjustForm\.type === 'set' \|\| \(Boolean\(numericBranchId\)/, `${path} received date must cover a set-increase`)
    // The id is per modal opening, never a module constant.
    assert.match(text, /receiptSessionIdRef = useRef\(Date\.now\(\)\)/, `${path} must mint its own session id`)
  }
  // The Inventory page reseeds its form per opening, so a previous receipt's
  // cost or credit due date can never attribute the next lot.
  const inventory = source('components/inventory/Inventory.tsx')
  assert.match(inventory, /receiptSessionIdRef\.current = Date\.now\(\)/)
  assert.match(inventory, /unit_cost_usd: '', free_goods: false, payment_status: 'paid', credit_due_date: '',/)
})

// ---------------------------------------------------------------------------
// N14-D: supplier + unit cost are REQUIRED on a stock-in, and the browser must
// reach the same verdict as the server.
//
// The table is the CONTRACT, not a copy of one: cloudflare/scripts/
// test-stock-receipt-gate-pure.cjs runs the very same file through
// cloudflare/src/lib/stockReceiptGate.ts. Neither implementation can be
// relaxed, tightened or typo'd alone without one of the two suites going red.
// Every case here is a case the OLD code answered "" to -- there was no gate
// at all -- so this file fails wholesale on the previous implementation.
// ---------------------------------------------------------------------------
runTest('the stock-in receipt gate agrees, case for case, with the server kernel', () => {
  const table = JSON.parse(readFileSync(new URL('../../cloudflare/scripts/fixtures/stock-receipt-gate-cases.json', import.meta.url), 'utf8')) as {
    cases: Array<{ name: string; input: Record<string, unknown>; code: string }>
  }
  assert.ok(table.cases.length >= 15, 'the shared table must actually exercise the rule')
  for (const testCase of table.cases) {
    assert.equal(stockReceiptGateCode(testCase.input as never), testCase.code, testCase.name)
  }

  // The server's own copy, read as text: same branch order, same thresholds.
  // A rule that reads differently here is a rule that will disagree on some
  // input the table has not thought of yet.
  const server = readFileSync(new URL('../../cloudflare/src/lib/stockReceiptGate.ts', import.meta.url), 'utf8')
  const client = readFileSync(new URL('../src/utils/stockReceiptFields.ts', import.meta.url), 'utf8')
  const gateBody = (text: string): string => {
    const at = text.indexOf('export function stockReceiptGateCode(')
    assert.notEqual(at, -1, 'both sides must export stockReceiptGateCode')
    const close = text.indexOf(String.fromCharCode(10) + '}', at)
    assert.notEqual(close, -1, 'stockReceiptGateCode must be a top-level function')
    return text.slice(at, close)
      .split(String.fromCharCode(10))
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ')
  }
  assert.equal(gateBody(client), gateBody(server), 'the two gate bodies must be the same rule, character for character')

  // Every code the operator can meet has a pack key, in BOTH packs.
  const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
  const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
  for (const code of STOCK_RECEIPT_GATE_CODES) {
    const key = STOCK_RECEIPT_GATE_KEYS[code]
    assert.ok(key, `${code} has no pack key`)
    assert.ok(en[key], `en.json is missing ${key}`)
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.notEqual(en[key], km[key], `${key} must be really translated`)
  }
  for (const key of ['stock_receipt_free_goods', 'stock_receipt_free_goods_hint', 'stock_set_down_hint']) {
    assert.ok(en[key] && km[key], `both packs need ${key}`)
    assert.notEqual(en[key], km[key], `${key} must be really translated`)
  }
})

runTest('nothing invents a receipt cost any more', () => {
  // The four call sites that used to answer "cost?" with a number the operator
  // never typed. Each `|| 0` silently recorded free goods nobody declared,
  // which is exactly the claim the gate now demands be made explicitly.
  // Plain substring checks, not regexes: the literals being hunted contain
  // `||` and `?.`, which a regex would read as alternation and a quantifier
  // -- an escaping slip there produces a pattern that matches anything and a
  // test that can never fail.
  const noFabrication: Array<[string, string]> = [
    ['components/products/forms/BranchStockAdjuster.tsx', 'unitCostUsd: product.cost_price_usd || 0'],
    ['components/products/forms/BulkAddStockModal.tsx', 'unitCostUsd: product.purchase_price_usd || 0'],
    ['components/products/helpers/productWriteHelpers.ts', 'unitCostUsd: options.unitCostUsd ?? ('],
    ['components/products/CreateProductsSessionModal.tsx', "cost_price_usd === '' ? 0"],
  ]
  for (const [path, literal] of noFabrication) {
    assert.ok(!source(path).includes(literal), `${path} must stop inventing a receipt cost: ${literal}`)
  }
  // ...and the surfaces that submit a receipt must run the gate before they do.
  for (const path of [
    'components/products/forms/StockAdjustModal.tsx',
    'components/inventory/Inventory.tsx',
    'components/inventory/FastStockInModal.tsx',
    'components/products/forms/BulkAddStockModal.tsx',
    'components/products/forms/BranchStockAdjuster.tsx',
    'components/inventory/ReceiveBatchModal.tsx',
    // Both of its line paths: the new product built through ProductForm and
    // the existing product queued from the picker.
    'components/products/CreateProductsSessionModal.tsx',
  ]) {
    assert.match(source(path), /stockReceiptGateCode/, `${path} must check the receipt gate before submitting`)
  }

  // Picking an existing lot BLANKS the supplier field on purpose -- an
  // attributed lot keeps its first supplier and the picker shows that name
  // locked. A gate that only read the (now empty) field would refuse a
  // complete receipt, so every surface that can pick a lot must either read
  // the lot's own name or say it cannot see one.
  for (const [path, marker] of [
    ['components/inventory/Inventory.tsx', 'lotAttributionDeferred'],
    ['components/products/forms/StockAdjustModal.tsx', 'lotAttributionDeferred'],
    ['components/products/forms/BranchStockAdjuster.tsx', 'lotAttributionDeferred'],
    ['components/inventory/ReceiveBatchModal.tsx', 'lotSupplierName'],
    ['components/products/CreateProductsSessionModal.tsx', 'lotSupplierName'],
  ] as Array<[string, string]>) {
    assert.ok(source(path).includes(marker),
      `${path} picks a lot, so it must pass ${marker} rather than refusing an attributed top-up`)
  }

  // The only exemption is explicit and auditable: a correction restores a
  // figure the ledger already held. It must be spelled on the wire, never
  // inferred from a reason string.
  const products = source('components/products/Products.tsx')
  assert.match(products, /attribution: 'correction'/, 'the snapshot-restore path must declare itself a correction')
  const inventory2 = source('components/inventory/Inventory.tsx')
  assert.match(inventory2, /attribution: 'correction'/, 'undo must declare itself a correction rather than carrying a fake supplier')
})

runTest('a hidden batch picker chose nothing: a set-down lot cannot ride a set-up (N14-E)', () => {
  // The picker is on screen for an add, for a remove, and -- since N14-E --
  // for a set that LOWERS the figure, which routes/inventory.ts turns into a
  // remove of the difference.
  const base = { unlockPricing: false, branchId: 3, batchId: '' as string | number }
  assert.equal(isBatchPickerVisible({ ...base, type: 'add', quantity: 5, currentQuantity: 10 }), true)
  assert.equal(isBatchPickerVisible({ ...base, type: 'remove', quantity: 5, currentQuantity: 10 }), true)
  assert.equal(isSetDownSubmission('set', 2, 10), true)
  assert.equal(isBatchPickerVisible({ ...base, type: 'set', quantity: 2, currentQuantity: 10 }), true)
  // ...and NOT for a set that raises it (that becomes an add of the
  // difference, which always creates or date-matches its own lot), nor for an
  // unlocked add (always a fresh lot), nor with no branch to scope a lot to.
  assert.equal(isSetDownSubmission('set', 40, 10), false)
  assert.equal(isBatchPickerVisible({ ...base, type: 'set', quantity: 40, currentQuantity: 10 }), false)
  assert.equal(isBatchPickerVisible({ ...base, type: 'add', quantity: 5, currentQuantity: 10, unlockPricing: true }), false)
  assert.equal(isBatchPickerVisible({ ...base, type: 'add', quantity: 5, currentQuantity: 10, branchId: '' }), false)

  // THE DISCRIMINATING CASE. The operator sets 10 -> 2, the picker appears,
  // they name lot 7 to take the loss from, then change their mind and set 40
  // instead. The picker is gone; lot 7 was picked to REMOVE from and this is
  // now a receipt. Both surfaces used to put `batch_id !== ''` straight on the
  // wire, so lot 7 rode along: the receipt topped that lot up AND deferred the
  // supplier question to it, inheriting an attribution this submission never
  // named. Old answer: { batchId: '7', lotAttributionDeferred: true }.
  const stale = stockAdjustBatchWire({ type: 'set', quantity: 40, currentQuantity: 10, unlockPricing: false, branchId: 3, batchId: '7' })
  assert.equal(stale.batchId, undefined, 'a lot chosen while the picker was showing must not ride a submission that hides it')
  assert.equal(stale.lotAttributionDeferred, false, 'a stale lot must not answer the supplier half of the receipt gate')

  // What a VISIBLE picker chose still rides, and only an existing lot defers
  // the supplier half -- '+ New batch' has no attribution to inherit.
  const chosen = stockAdjustBatchWire({ type: 'remove', quantity: 3, currentQuantity: 10, unlockPricing: false, branchId: 3, batchId: '7' })
  assert.deepEqual(chosen, { batchId: '7', lotAttributionDeferred: true })
  const fresh = stockAdjustBatchWire({ type: 'add', quantity: 3, currentQuantity: 10, unlockPricing: false, branchId: 3, batchId: 'new' })
  assert.deepEqual(fresh, { batchId: 'new', lotAttributionDeferred: false })
  const nothing = stockAdjustBatchWire({ type: 'add', quantity: 3, currentQuantity: 10, unlockPricing: false, branchId: 3, batchId: '' })
  assert.deepEqual(nothing, { lotAttributionDeferred: false })

  // And the two submitters must derive it from here rather than re-deriving
  // `batch_id !== ''` on their own, which is what let the two disagree.
  for (const path of ['components/inventory/Inventory.tsx', 'components/products/forms/StockAdjustModal.tsx']) {
    const text = source(path)
    assert.ok(text.includes('stockAdjustBatchWire'), `${path} must build its batch wire from the shared rule`)
    assert.ok(!text.includes("adjustForm.batch_id !== '' ? adjustForm.batch_id : undefined"),
      `${path} must stop putting a possibly-stale batch_id straight on the wire`)
  }
})

runTest('a bulk SET states its receipt facts, because a set that raises stock is a receipt (N14-D)', () => {
  // BulkAddStockModal sees no branch figures, so it cannot tell which rows of
  // a 'set' rise. routes/inventory.ts gates each of those rows as the add it
  // becomes, so the form must offer -- and send -- the supplier and cost for
  // a set as well as an add. It offered them for 'add' only, which meant a
  // bulk set-up was refused row by row with nothing on screen to fix.
  assert.equal(bulkActionCanReceive('add'), true)
  assert.equal(bulkActionCanReceive('set'), true)
  assert.equal(bulkActionCanReceive('remove'), false)

  const draft = { unitCost: '2.50', freeGoods: false, supplierId: 4, supplierName: ' Sok Supply ', receivedDate: '2026-09-06' }
  // Old answer for a 'set': {} -- no supplier, no cost, so the Worker refused
  // every raising row with supplier_required.
  assert.deepEqual(bulkStockReceiptWire('set', draft), {
    unitCostUsd: 2.5, supplierId: 4, supplierName: 'Sok Supply', receivedDate: '2026-09-06',
  })
  assert.deepEqual(bulkStockReceiptWire('add', draft), {
    unitCostUsd: 2.5, supplierId: 4, supplierName: 'Sok Supply', receivedDate: '2026-09-06',
  })
  // A remove carries none of it, per the owner ruling.
  assert.deepEqual(bulkStockReceiptWire('remove', draft), {})
  // A blank cost stays blank -- it is never sent as 0, which is the claim the
  // free-goods box exists to make. The gate refuses it before the wire.
  assert.deepEqual(bulkStockReceiptWire('add', { ...draft, unitCost: '' }), {
    supplierId: 4, supplierName: 'Sok Supply', receivedDate: '2026-09-06',
  })
  assert.equal(stockReceiptGateCode({ isStockIn: true, supplierName: 'Sok Supply', unitCostUsd: '' }), 'cost_required')
  // ...and the declared zero rides as an explicit true, never as false.
  assert.equal(bulkStockReceiptWire('add', { ...draft, unitCost: '0', freeGoods: true }).freeGoods, true)
  assert.equal(bulkStockReceiptWire('add', { ...draft, unitCost: '0', freeGoods: false }).freeGoods, undefined)

  const bulk = source('components/products/forms/BulkAddStockModal.tsx')
  assert.ok(bulk.includes('bulkStockReceiptWire'), 'the bulk surface must build its receipt half from the shared rule')
  assert.ok(bulk.includes('bulkActionCanReceive'), 'the bulk gate must cover a set as well as an add')
  assert.ok(!bulk.includes("isStockIn: action === 'add'"), 'a bulk set-up is a stock-in the Worker gates; the form must gate it too')
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} stock-receipt-field test(s) failed`)
} else {
  console.log('\nAll stock receipt field tests passed')
}
