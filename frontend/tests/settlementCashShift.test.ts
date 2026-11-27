// R40: the later-payment form (SaleSettlementEditor) and the return / exchange forms say "Open a shift to take cash." with the way
// through BEFORE submit, and only when cash is actually being taken (owner, 26 + 27 Nov 2026).
// Mutants killed (each turns one assertion red):
//   the note shows for a bank row / no amount            -> "the note mounts only when a new cash row has an amount"
//   the note shows on a payment correction                -> "a payment correction never shows it"
//   recorded (already taken) cash counts as new cash       -> "a recorded cash row is not new cash"
//   the note is not mounted by the detail modal / return   -> "wiring"
//   the form reads the shift for every keystroke branch    -> "one shared read per branch"
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { settlementCashRows, settlementTakesCash } from '../src/components/sales/settlementCashShift.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]) => readFileSync(path.join(here, '..', 'src', ...parts), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
function runTest(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const row = (id: string, method: string, usd: string, khr = '') => ({ id, method, usd, khr })

runTest('the note mounts only when a new cash row has an amount', () => {
  assert.equal(settlementTakesCash([row('s1', 'Cash', '5')], {}, false), true)
  assert.equal(settlementTakesCash([row('s1', 'Cash', '', '4000')], {}, false), true)
  assert.equal(settlementTakesCash([row('s1', 'ABA', '5')], {}, false), false, 'a bank row')
  assert.equal(settlementTakesCash([row('s1', 'Cash', '')], {}, false), false, 'no amount typed yet')
  assert.equal(settlementTakesCash([row('s1', 'Cash', '0')], {}, false), false, 'a $0 cash row')
  assert.equal(settlementTakesCash([row('s1', 'Till', '5')], { till: 'cash' }, false), true, 'a renamed method pinned as cash')
})
runTest('a recorded cash row is not new cash', () => {
  assert.equal(settlementTakesCash([row('recorded-0', 'Cash', '5')], {}, false), false)
  assert.deepEqual(settlementCashRows([row('recorded-0', 'Cash', '5'), row('s2', 'Cash', '2')]).map((entry) => entry.amount_usd), [2])
})
runTest('a payment correction never shows it', () => {
  assert.equal(settlementTakesCash([row('s1', 'Cash', '5')], {}, true), false)
})
runTest('wiring: the editor mounts the note only while cash is taken; the detail modal and the return form pass the branch', () => {
  const editor = read('components', 'sales', 'SaleSettlementEditor.tsx')
  assert.match(editor, /cashShift\?: \{ branchId: number \| null; branchName\?: string \| null; direction\?: 'in' \| 'out' \} \| null/)
  assert.match(editor, /settlementTakesCash\(rows, methodKinds, allowRecordedEdits\)/)
  assert.match(editor, /<SettlementCashShiftNote /)
  const detail = read('components', 'sales', 'SaleDetailModal.tsx')
  assert.match(detail, /cashShift=\{\{ branchId: sale\.branch_id == null \? null : Number\(sale\.branch_id\), branchName: sale\.branch_name \?\? null \}\}/)
  const ret = read('components', 'returns', 'NewReturnModal.tsx')
  assert.match(ret, /cashShift=\{\{ branchId: foundSale\?\.branch_id \? Number\(foundSale\.branch_id\) : null \}\}/)
  assert.match(ret, /<CashOutShiftNote branchId=/, 'a plain refund shows the cash-out note')
  assert.match(ret, /foundSale\?\.sale_status !== 'awaiting_payment'/, 'a debt-only return on a Not Paid sale is never noted')
})

if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
