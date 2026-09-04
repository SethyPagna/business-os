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
  isStockReceiptCreditIncomplete,
  stockReceiptWire,
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
  assert.match(inventory, /unit_cost_usd: '', payment_status: 'paid', credit_due_date: '',/)
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} stock-receipt-field test(s) failed`)
} else {
  console.log('\nAll stock receipt field tests passed')
}
