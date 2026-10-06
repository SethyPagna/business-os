// N9 (SEC-SALES, loophole review 2026-10-06): the lost fee recorded when a
// sale is cancelled is an expense. The Worker (cloudflare/src/lib/
// cancelFeeRules.ts) requires Expenses -> Add to record it, Expenses ->
// Delete at Full to remove it by un-cancelling, and caps it at the sale's
// total; the till (utils/cancelFeeRules.ts) mirrors all three so a cashier
// is never offered a fee field, or an Un-cancel button, the Worker refuses.
//
// Run: node tests/cancelFeeRules.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { CANCEL_FEE_REFUSAL_CODES, cancelFeeRefusalKey, cancelFeeWithinSaleTotal } from '../src/utils/cancelFeeRules.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
type Pack = Record<string, unknown>
const EN = JSON.parse(read('frontend/src/lang/en.json')) as Pack
const KM = JSON.parse(read('frontend/src/lang/km.json')) as Pack

// The Worker module, transpiled and run with its permission import stubbed:
// only the pure cap and the code constants are compared here.
function loadWorkerRules(): Record<string, any> {
  const code = transformSync(read('cloudflare/src/lib/cancelFeeRules.ts'), { loader: 'ts', format: 'cjs' }).code
  const mod = { exports: {} as Record<string, any> }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, () => ({ getActionTier: () => 'none' }))
  return mod.exports
}
const worker = loadWorkerRules()

const failures: string[] = []
function runCase(name: string, body: () => void) {
  try { body(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error)}`) }
}

const CAP_CASES = [
  { feeUsd: 0, feeKhr: 0, saleTotalUsd: 0, exchangeRate: 4100, within: true },
  { feeUsd: 9.5, feeKhr: 0, saleTotalUsd: 9.5, exchangeRate: 4000, within: true },
  { feeUsd: 9.51, feeKhr: 0, saleTotalUsd: 9.5, exchangeRate: 4000, within: false },
  { feeUsd: 8.5, feeKhr: 4000, saleTotalUsd: 9.5, exchangeRate: 4000, within: true },
  { feeUsd: 9, feeKhr: 4000, saleTotalUsd: 9.5, exchangeRate: 4000, within: false },
  { feeUsd: 0, feeKhr: 41000, saleTotalUsd: 10, exchangeRate: 4100, within: true },
  { feeUsd: 0, feeKhr: 41100, saleTotalUsd: 10, exchangeRate: 4100, within: false },
  { feeUsd: 10.004, feeKhr: 0, saleTotalUsd: 10, exchangeRate: 0, within: true },
  { feeUsd: 1, feeKhr: 0, saleTotalUsd: 0, exchangeRate: 4100, within: false },
]

runCase('the till and the Worker cap the fee identically, riel at the sale rate within half a cent', () => {
  for (const { within, ...input } of CAP_CASES) {
    assert.equal(cancelFeeWithinSaleTotal(input), within, `till ${JSON.stringify(input)}`)
    assert.equal(worker.cancelFeeWithinSaleTotal(input), within, `worker ${JSON.stringify(input)}`)
  }
})

runCase('the till knows exactly the Worker refusal codes, and each is a translated pack key', () => {
  const workerCodes = [worker.CANCEL_FEE_EXCEEDS_SALE_CODE, worker.CANCEL_FEE_ADD_DENIED_CODE, worker.CANCEL_FEE_DELETE_DENIED_CODE].sort()
  assert.deepEqual([...CANCEL_FEE_REFUSAL_CODES].sort(), workerCodes)
  for (const code of CANCEL_FEE_REFUSAL_CODES) {
    assert.equal(cancelFeeRefusalKey(code), code)
    assert.equal(typeof EN[code], 'string', `en.json has ${code}`)
    assert.match(String(KM[code] || ''), /[ក-៿]/, `km.json ${code} is Khmer`)
  }
  assert.equal(cancelFeeRefusalKey('insufficient_payment_for_status'), null)
})

runCase('the fee field is offered only with Expenses -> Add, and an over-total fee cannot be confirmed', () => {
  const sales = read('frontend/src/components/sales/Sales.tsx')
  assert.match(sales, /const canRecordCancelFee = can\('fees', 'add'\)/)
  assert.match(sales, /const canRemoveCancelFee = getPermissionTier\('fees'\) === 'full' && can\('fees', 'delete'\)/)
  assert.match(sales, /<CancelSaleModal[\s\S]*?feeAllowed=\{canRecordCancelFee\}/)
  assert.match(sales, /<BulkSaleCancelModal[\s\S]*?feeAllowed=\{canRecordCancelFee\}/)
  const single = read('frontend/src/components/sales/CancelSaleModal.tsx')
  assert.match(single, /const withFee = !bulk && feeAllowed/)
  assert.match(single, /const canConfirm = cancelFieldsComplete\(fields\) && !feeOverTotal && !saving/)
  const bulk = read('frontend/src/components/sales/BulkSaleCancelModal.tsx')
  assert.match(bulk, /withFee=\{feeAllowed\}/)
  assert.match(bulk, /cancelFieldsFeeWithinSale\(draft, sale\)/)
})

runCase('Un-cancel is withheld, with the reason, when it would delete an expense the role cannot delete', () => {
  const detail = read('frontend/src/components/sales/SaleDetailModal.tsx')
  assert.match(detail, /const uncancelBlockedByFee = toNumber\(sale\?\.cancel_fee_id\) > 0 && !\(getPermissionTier\('fees'\) === 'full' && can\('fees', 'delete'\)\)/)
  assert.match(detail, /disabled=\{statusSaving \|\| uncancelBlockedByFee\}/)
  const sales = read('frontend/src/components/sales/Sales.tsx')
  assert.match(sales, /nextStatus !== 'cancelled' && !canRemoveCancelFee/)
})

if (failures.length) {
  console.error(`\n${failures.length} failing case(s)`)
  process.exit(1)
}
