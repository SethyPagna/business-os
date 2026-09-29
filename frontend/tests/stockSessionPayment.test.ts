// UI-STOCK S13: the Payment step compares what was paid to the supplier with
// the Items total and readjusts the unit costs (4 dp) so the recorded costs add
// up to what was actually paid. The commit carries a session block the Worker
// re-checks before writing any line.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyPaidToLines,
  commitSessionBlock,
  paymentDifference,
  paymentStepRefusal,
  resetLineCosts,
  sessionItemsTotal,
  type StockSessionLine,
} from '../src/utils/stockSessionDraft.ts'
import { fastStockInCommitPayload } from '../src/api/inventoryWriteTransport.ts'
import { supplierTotalMatches } from '../src/utils/stockSessionMath.ts'
import { multiplyMoney4, sumMoney4 } from '../src/utils/moneyPrecision.ts'

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

const src = (relative: string): string => readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8')

function line(key: string, quantity: number, unitCost: string, overrides: Partial<StockSessionLine> = {}): StockSessionLine {
  return {
    key, requestId: `r-${key}`, product: { id: key.length, name: key }, productName: key, mode: 'add',
    quantity, freeQuantity: 0, unitCost, sellingPrice: '', freeGoods: false, expiryDate: '', batchChoice: 'new',
    batchLabel: '', reason: '', conditionTag: '', createdProduct: false, status: 'queued', detail: '', ...overrides,
  }
}

const lines = [line('sk', 10, '3.5', { freeQuantity: 2 }), line('hs', 6, '12.09')]

runTest('the paid amount follows the Items total until the operator types one', () => {
  assert.equal(sessionItemsTotal(lines), 107.54, 'free units are not paid for')
  assert.equal(paymentDifference(107.54, ''), 0)
  assert.equal(paymentDifference(107.54, '107'), -0.54)
})

runTest('Next waits for the due date (Not Yet Paid) and for a paid amount within half a cent', () => {
  const base = { itemsTotal: 107.54, paymentStatus: 'paid' as const, creditDueDate: '', canViewCosts: true }
  assert.equal(paymentStepRefusal({ ...base, paidAmount: '' }), '')
  assert.equal(paymentStepRefusal({ ...base, paidAmount: '107.545' }), '', '0.005 is inside the tolerance')
  assert.equal(paymentStepRefusal({ ...base, paidAmount: '107.546' }), 'supplier_total_mismatch', '0.006 is not')
  assert.equal(paymentStepRefusal({ ...base, paymentStatus: 'credit', paidAmount: '' }), 'fast_stockin_credit_due')
  assert.equal(paymentStepRefusal({ ...base, paymentStatus: 'credit', creditDueDate: '2026-10-15', paidAmount: '' }), '')
  assert.equal(paymentStepRefusal({ ...base, canViewCosts: false, paidAmount: '1' }), '', 'a blind operator is never asked to match costs they cannot see')
})

runTest('auto-adjust rescales each unit cost (4 dp) so the lines add up to what was paid; reset restores the typed costs', () => {
  const result = applyPaidToLines(lines, '107')
  assert.ok(result.ok)
  const adjusted = result.lines
  const total = sumMoney4(adjusted.map((entry) => multiplyMoney4(Number(entry.unitCost), entry.quantity)))
  assert.ok(supplierTotalMatches(total, 107), `adjusted total ${total} must match 107`)
  assert.notEqual(adjusted[0].unitCost, '3.5', 'the costs actually moved')
  assert.match(adjusted[0].unitCost, /^\d+(\.\d{1,4})?$/, 'at most 4 decimals')
  assert.equal(adjusted[0].typedUnitCost, '3.5', 'the typed cost is kept for reset')
  const reset = resetLineCosts(adjusted)
  assert.equal(reset[0].unitCost, '3.5')
  assert.equal(reset[1].unitCost, '12.09')
})

runTest('auto-adjust leaves saved lines alone and refuses what cannot be matched', () => {
  const saved = line('done', 2, '5', { status: 'saved' })
  const result = applyPaidToLines([saved, ...lines], '117')
  assert.ok(result.ok)
  assert.equal(result.lines[0].unitCost, '5', 'a committed line is never repriced')
  const pendingTotal = sumMoney4(result.lines.slice(1).map((entry) => multiplyMoney4(Number(entry.unitCost), entry.quantity)))
  assert.ok(supplierTotalMatches(pendingTotal, 107), 'the pending lines carry the paid amount minus the saved line')
  const free = [line('gift', 0, '0', { freeQuantity: 3 })]
  const zero = applyPaidToLines(free, '5')
  assert.equal(zero.ok, false)
  if (!zero.ok) assert.equal(zero.code, 'items_total_zero')
})

runTest('the session block: paid amount minus what earlier attempts already saved; none without cost view or receipts', () => {
  assert.deepEqual(
    commitSessionBlock({ lines, paidAmount: '', paymentStatus: 'paid', creditDueDate: '', canViewCosts: true }),
    { supplierTotalUsd: 107.54, paymentStatus: 'paid' },
  )
  const retry = [line('done', 2, '5', { status: 'saved' }), ...lines]
  assert.deepEqual(
    commitSessionBlock({ lines: retry, paidAmount: '117.54', paymentStatus: 'credit', creditDueDate: '2026-10-15', canViewCosts: true }),
    { supplierTotalUsd: 107.54, paymentStatus: 'credit', creditDueDate: '2026-10-15' },
  )
  assert.equal(commitSessionBlock({ lines, paidAmount: '', paymentStatus: 'paid', creditDueDate: '', canViewCosts: false }), null)
  assert.equal(commitSessionBlock({ lines: [line('rm', 2, '', { mode: 'remove' })], paidAmount: '', paymentStatus: 'paid', creditDueDate: '', canViewCosts: true }), null)
})

runTest('the session block rides only the FIRST request of an attempt; deferred rounds carry lines only', () => {
  const block = { supplierTotalUsd: 107.54, paymentStatus: 'paid' as const }
  assert.deepEqual(fastStockInCommitPayload(['a', 'b'], block, true), { lines: ['a', 'b'], session: block })
  assert.deepEqual(fastStockInCommitPayload(['b'], block, false), { lines: ['b'] }, 'a deferred subset would never match the paid total')
  assert.deepEqual(fastStockInCommitPayload(['a'], null, true), { lines: ['a'] })
  const transport = src('api/inventoryWriteTransport.ts')
  assert.match(transport, /fastStockInCommitPayload\(batch, options\?\.session, firstRequest\)/)
})

runTest('the Payment step: no hint text, the two amount labels, match and reset icons, 4 dp costs', () => {
  const payment = src('components/stock-session/StockSessionPaymentStep.tsx')
  assert.doesNotMatch(payment, /InfoHint|stock_session_payment_scope_hint|_hint'/, 'owner: "payment no need the info"')
  assert.match(payment, /'paid_to_supplier'/)
  assert.match(payment, /'owed_to_supplier'/)
  assert.match(payment, /'match_cost_to_paid'/)
  assert.match(payment, /'reset_costs'/)
  assert.match(payment, /step="0\.0001"/)
  assert.match(payment, /onBlur=\{onPaidBlur\}/, 'costs readjust automatically when the paid amount is left')
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} stock session payment test(s) failed`)
} else {
  console.log('\nAll stock session payment tests passed')
}
