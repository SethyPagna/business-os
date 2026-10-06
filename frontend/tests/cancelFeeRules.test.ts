// N9 (SEC-SALES, loophole review 2026-10-06): the lost fee recorded when a
// sale is cancelled is an expense. The Worker (cloudflare/src/lib/
// cancelFeeRules.ts) requires Expenses -> Add to record it, Expenses ->
// Delete at Full to remove it by un-cancelling; the till
// (utils/cancelFeeRules.ts) mirrors both so a cashier is never offered a fee
// field, or an Un-cancel button, the Worker refuses. The fee has no ceiling
// (owner ruling, 6 Oct 2026): neither side may cap it at the sale total.
//
// Run: node tests/cancelFeeRules.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import * as till from '../src/utils/cancelFeeRules.ts'
const { CANCEL_FEE_REFUSAL_CODES, cancelFeeRefusalKey } = till

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
type Pack = Record<string, unknown>
const EN = JSON.parse(read('frontend/src/lang/en.json')) as Pack
const KM = JSON.parse(read('frontend/src/lang/km.json')) as Pack

// The Worker module, transpiled and run with its permission import stubbed:
// only the code constants (and the absence of a cap) are compared here.
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

runCase('neither the till nor the Worker caps the fee at the sale total (owner ruling, 6 Oct 2026)', () => {
  assert.equal(worker.cancelFeeWithinSaleTotal, undefined)
  assert.equal(worker.CANCEL_FEE_EXCEEDS_SALE_CODE, undefined)
  assert.equal((till as Record<string, unknown>).cancelFeeWithinSaleTotal, undefined)
  assert.equal(EN.cancel_fee_exceeds_sale_total, undefined)
  assert.equal(KM.cancel_fee_exceeds_sale_total, undefined)
})

runCase('the till knows exactly the Worker refusal codes, and each is a translated pack key', () => {
  const workerCodes = [worker.CANCEL_FEE_ADD_DENIED_CODE, worker.CANCEL_FEE_DELETE_DENIED_CODE].sort()
  assert.deepEqual([...CANCEL_FEE_REFUSAL_CODES].sort(), workerCodes)
  for (const code of CANCEL_FEE_REFUSAL_CODES) {
    assert.equal(cancelFeeRefusalKey(code), code)
    assert.equal(typeof EN[code], 'string', `en.json has ${code}`)
    assert.match(String(KM[code] || ''), /[ក-៿]/, `km.json ${code} is Khmer`)
  }
  assert.equal(cancelFeeRefusalKey('insufficient_payment_for_status'), null)
})

runCase('the fee field is offered only with Expenses -> Add, and any fee it takes can be confirmed', () => {
  const sales = read('frontend/src/components/sales/Sales.tsx')
  assert.match(sales, /const canRecordCancelFee = can\('fees', 'add'\)/)
  assert.match(sales, /const canRemoveCancelFee = getPermissionTier\('fees'\) === 'full' && can\('fees', 'delete'\)/)
  assert.match(sales, /<CancelSaleModal[\s\S]*?feeAllowed=\{canRecordCancelFee\}/)
  assert.match(sales, /<BulkSaleCancelModal[\s\S]*?feeAllowed=\{canRecordCancelFee\}/)
  const single = read('frontend/src/components/sales/CancelSaleModal.tsx')
  assert.match(single, /const withFee = !bulk && feeAllowed/)
  assert.match(single, /const canConfirm = cancelFieldsComplete\(fields\) && !saving/)
  const bulk = read('frontend/src/components/sales/BulkSaleCancelModal.tsx')
  assert.match(bulk, /withFee=\{feeAllowed\}/)
  for (const source of [single, bulk, read('frontend/src/components/sales/CancelSaleFields.tsx')]) assert.doesNotMatch(source, /feeOverTotal|FeeWithinSale/)
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
