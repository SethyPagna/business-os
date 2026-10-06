// N2 (SEC-SALES, loophole review 2026-10-06): the till mirrors the Worker's
// rule that a sale is rung inside the cashier's open shift for today.
//
// cloudflare/src/lib/saleShiftRequirement.ts refuses POST /api/sales with
// sale_shift_required (no registered shift today, or it was cancelled) or
// sale_shift_closed (End Shift); an exempt administrator is never refused.
// utils/saleShiftRequirement.ts gives the same answer from the /current state
// the till already holds, and POS checkout stops on it with the pack sentence.
//
// Run: node tests/saleShiftRequirement.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { saleShiftBlock } from '../src/utils/saleShiftRequirement.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => fs.readFileSync(path.resolve(here, '..', '..', rel), 'utf8')

const failures: string[] = []
function runCase(name: string, body: () => void) {
  try { body(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}\n  ${String((error as Error)?.message || error)}`) }
}

const state = (patch: Partial<{ exempt: boolean; needs_registration: boolean; is_open: boolean }>) =>
  ({ exempt: false, needs_registration: false, is_open: true, ...patch })

runCase('the till answers exactly the Worker refusals', () => {
  assert.equal(saleShiftBlock(state({ needs_registration: true, is_open: false })), 'sale_shift_required')
  assert.equal(saleShiftBlock(state({ is_open: false })), 'sale_shift_closed')
  assert.equal(saleShiftBlock(state({})), null)
})

runCase('an exempt account and an unknown state never invent a refusal', () => {
  assert.equal(saleShiftBlock(state({ exempt: true, needs_registration: true, is_open: false })), null)
  assert.equal(saleShiftBlock(null), null)
  assert.equal(saleShiftBlock(undefined), null)
})

runCase('the Worker defines the same two codes', () => {
  const worker = read('cloudflare/src/lib/saleShiftRequirement.ts')
  assert.match(worker, /SALE_SHIFT_REQUIRED_CODE = 'sale_shift_required'/)
  assert.match(worker, /SALE_SHIFT_CLOSED_CODE = 'sale_shift_closed'/)
})

runCase('POS checkout stops on the refusal with the pack sentence before the status picker opens', () => {
  const pos = read('frontend/src/components/pos/POS.tsx')
  assert.match(pos, /const saleShiftRefusal = saleShiftBlock\(saleShiftState\)/)
  assert.match(pos, /if \(saleShiftRefusal\) \{ window\.dispatchEvent\(new Event\(SHIFT_STATE_CHANGED_EVENT\)\); notify\(t\(saleShiftRefusal\), 'error'\); return \}\s+setShowStatusPicker\(true\)/)
})

// The Worker checks the shift for the SALE's branch (body.branch_id, the
// `saleHeaderBranchId` handed to lib/saleShiftRequirement.ts); the till sends
// the cart's one branch as branch_id, so it must ask about that branch too --
// not the till's browsing filter.
runCase('the till asks about the shift of the branch the sale is sent with, as the Worker does', () => {
  const pos = read('frontend/src/components/pos/POS.tsx')
  assert.match(pos, /const saleBranchId = cartTotals\.branchIds\.length === 1 \? cartTotals\.branchIds\[0\] : null/)
  assert.match(pos, /branch_id: saleBranchId,/)
  assert.match(pos, /const pendingSaleBranchId = Number\(active\.checkoutPayload\?\.branch_id\)/)
  assert.match(pos, /: cartTotals\.branchIds\.length === 1 \? cartTotals\.branchIds\[0\] : primaryBranchFilterId/)
  assert.match(pos, /useSharedShift\(saleShiftBranchId, user\?\.id, settings\?\.shift_scope_mode\)/)
  const routes = read('cloudflare/src/routes/sales.ts')
  assert.match(routes, /const saleHeaderBranchId = Number\(body\.branch_id\)/)
  assert.match(routes, /\{ scopeMode: shiftPolicy\.scope_mode, userId: Number\(user\.id\), branchId: saleHeaderBranchId \}/)
})

runCase('a shift refusal from the Worker re-reads the shift, and a closed shift is reopened in the till', () => {
  const pos = read('frontend/src/components/pos/POS.tsx')
  assert.equal((pos.match(/if \(saleSubmitShiftRefusal\((?:error|e|result)\)\) window\.dispatchEvent\(new Event\(SHIFT_STATE_CHANGED_EVENT\)\)/g) || []).length, 4)
  assert.match(pos, /saleShiftRefusal === 'sale_shift_closed' \? <div role="status"[^\n]*<ShiftHistoryModal branchId=\{saleShiftBranchId\} label=\{t\('shift_action_reopen'\)\} \/>/)
  // ShiftGate prompts whenever a re-read says registration is needed, and the
  // reopen in Shift history announces itself, so both answers reach the till.
  assert.match(read('frontend/src/components/pos/ShiftGate.tsx'), /window\.addEventListener\(SHIFT_STATE_CHANGED_EVENT, refreshChangedShift\)/)
  assert.match(read('frontend/src/components/shifts/ShiftHistoryModal.tsx'), /const refreshMountedShiftState = \(\) => window\.dispatchEvent\(new Event\(SHIFT_STATE_CHANGED_EVENT\)\)/)
})

if (failures.length) {
  console.error(`\n${failures.length} failing case(s)`)
  process.exit(1)
}
