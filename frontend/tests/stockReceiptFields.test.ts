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
//
// UI-STOCK-3 (30 Sep 2026): StockAdjustModal, the Inventory adjust form,
// Receive stock, Bulk add stock and the Add/Create Products session were
// retired into the one Stock Session. The pure rules below stay pinned where
// the session still uses them; the source pins on the retired surfaces are
// listed in the UI-STOCK-3 lane report, and the now-unused exports of
// stockReceiptFields.ts are handed to its owner (UI-STOCK-2).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildStockLineRequest, sessionSteps, type StockSessionLine } from '../src/utils/stockSessionDraft.ts'
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

runTest('the Stock Session resolves that figure through the one shared rule', () => {
  const session = source('components/inventory/FastStockInModal.tsx')
  assert.match(session, /const branchQuantity = picked \? adjustBranchQuantity\(picked\.branch_stock, branchId, picked\.stock_quantity\) : 0/, 'the entry row measures the session branch')
  assert.match(source('utils/stockSessionDraft.ts'), /const stockBefore = adjustBranchQuantity\(line\.product\.branch_stock, branchId, line\.product\.stock_quantity\)/, 'the Review measures the same figure')
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

runTest('the Stock Session asks for the cost and the payment, and sends them only on a receipt', () => {
  const lineEntry = source('components/stock-session/StockSessionLineEntry.tsx')
  assert.match(lineEntry, /label=\{tr\('cost', 'Cost'\)\}/, 'an Add item asks for its cost')
  assert.deepEqual(sessionSteps('add', []), ['items', 'payment', 'review'], 'a session with an Add has a Payment step')
  assert.deepEqual(sessionSteps('set', [{ mode: 'set' }]), ['items', 'review'], 'a Set session has none')
  // Executed: the receipt facts and the grouping session id ride an Add;
  // a Remove and a scoped Set carry none of them.
  const line = {
    key: 'k', requestId: 'r', product: { id: 7, name: 'Soap' }, productName: 'Soap', quantity: 2, freeQuantity: 0,
    unitCost: '2.5', sellingPrice: '', freeGoods: false, expiryDate: '', batchChoice: 'new', batchLabel: '', reason: '',
    conditionTag: '', createdProduct: false, status: 'queued', detail: '',
  }
  const ctx = {
    branchId: '1', receivedDate: '2026-09-30', supplier: { supplierId: 4, supplierName: 'Sok Supply' }, paymentStatus: 'credit' as const,
    creditDueDate: '2026-10-15', sessionId: 77, canEditPrice: false, reasonFor: () => 'R',
  }
  const add = buildStockLineRequest({ ...line, mode: 'add' } as unknown as StockSessionLine, ctx).body as Record<string, unknown>
  assert.equal(add.unitCostUsd, 2.5)
  assert.equal(add.paymentStatus, 'credit')
  assert.equal(add.creditDueDate, '2026-10-15')
  assert.equal(add.supplierId, 4)
  assert.equal(add.sessionId, 77)
  for (const mode of ['remove', 'set'] as const) {
    const body = buildStockLineRequest({ ...line, mode, batchChoice: 4 } as unknown as StockSessionLine, ctx).body as Record<string, unknown>
    for (const key of ['unitCostUsd', 'paymentStatus', 'creditDueDate', 'supplierId', 'supplierName']) {
      assert.equal(key in body, false, `a ${mode} carries no ${key}`)
    }
    assert.equal(body.sessionId, 77, `a ${mode} still groups under the session`)
  }
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
  // (stock_receipt_free_goods_hint, stock_set_down_hint and stock_set_up_hint
  // lost their last reader with the retired forms: HANDOFF to UI-STOCK-1.)
  for (const key of ['stock_receipt_free_goods']) {
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
  // (BulkAddStockModal and CreateProductsSessionModal, two of the four, were
  // retired by UI-STOCK-3.)
  const noFabrication: Array<[string, string]> = [
    ['components/products/helpers/productWriteHelpers.ts', 'unitCostUsd: options.unitCostUsd ?? ('],
  ]
  for (const [path, literal] of noFabrication) {
    assert.ok(!source(path).includes(literal), `${path} must stop inventing a receipt cost: ${literal}`)
  }
  // ...and the surfaces that submit a receipt must run the gate before they do.
  // The one receipt surface left is the Stock Session: its entry row runs the
  // gate (lineEntryRefusal) before an Add item can be queued.
  assert.match(source('utils/stockSessionDraft.ts'), /const gate = stockReceiptGateCode\(/, 'the session entry row checks the receipt gate')
  assert.match(source('components/inventory/FastStockInModal.tsx'), /lineEntryRefusal\(\{/, 'and the float refuses the Add through it')

  // Picking an existing lot BLANKS the supplier field on purpose -- an
  // attributed lot keeps its first supplier and the picker shows that name
  // locked. A gate that only read the (now empty) field would refuse a
  // complete receipt, so every surface that can pick a lot must either read
  // the lot's own name or say it cannot see one.
  for (const [path, marker] of [
    ['utils/stockSessionDraft.ts', 'lotSupplierName'],
  ] as Array<[string, string]>) {
    assert.ok(source(path).includes(marker),
      `${path} picks a lot, so it must pass ${marker} rather than refusing an attributed top-up`)
  }

  // The only exemption is explicit and auditable: a correction restores a
  // figure the ledger already held. It must be spelled on the wire, never
  // inferred from a reason string.
  const products = source('components/products/Products.tsx')
  assert.match(products, /attribution: 'correction'/, 'the snapshot-restore path must declare itself a correction')
  // (Inventory.tsx's adjust undo, the other correction, went with its adjust half.)
})

// Retired with the adjust half of InventoryStockModals (UI-STOCK-3): "a set
// that RAISES stock explains itself at the Δ line". A Set in the Stock Session
// is always scoped to a received date and never becomes a receipt; without a
// dated lot it may only lower the branch (lineEntryRefusal: no_batches_for_branch).

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

  // (The two submitters, Inventory's adjust form and StockAdjustModal, were
  // retired by UI-STOCK-3; the session names a lot only from its lot select.)
})

runTest('a bulk SET states no receipt facts: it is a scoped count correction (owner, 24 Sep)', () => {
  // Before the scoped Set, a bulk 'set' that raised a row became a receipt the
  // Worker gated as an add, so the form sent supplier and cost for it (N14-D).
  // Every bulk Set is now scoped to a NAMED existing received date
  // (lib/stockLotAdjustment.ts): it keeps that lot's own cost, has no supplier,
  // and the Worker refuses receipt prices on it (correction_cost_input).
  assert.equal(bulkActionCanReceive('add'), true)
  assert.equal(bulkActionCanReceive('set'), false)
  assert.equal(bulkActionCanReceive('remove'), false)

  const draft = { unitCost: '2.50', freeGoods: false, supplierId: 4, supplierName: ' Sok Supply ', receivedDate: '2026-09-06' }
  assert.deepEqual(bulkStockReceiptWire('set', draft), {})
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

  // (BulkAddStockModal was retired by UI-STOCK-3: the select-mode stock panel
  // queues the products as Stock Session items instead.)
})


// Retired with UI-STOCK-2's free row (owner, 30 Sep 06:40): "the free-goods
// declaration sits under the receipt row, not inside the cost cell". There is
// no declaration checkbox any more; free units are a row under their item.
runTest('no stock session part shows an info tooltip or the old "Free goods" wording', () => {
  const src = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
  for (const host of [
    'components/inventory/FastStockInModal.tsx',
    'components/stock-session/StockSessionItems.tsx',
    'components/stock-session/StockSessionLineEntry.tsx',
  ]) {
    const text = src(host)
    assert.doesNotMatch(text, /<InfoHint[^>]*stock_receipt_free_goods\b/, `${host} shows an info tooltip beside the free units`)
    assert.doesNotMatch(text, /'Free goods/, `${host} falls back to the old wording`)
  }
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} stock-receipt-field test(s) failed`)
} else {
  console.log('\nAll stock receipt field tests passed')
}
