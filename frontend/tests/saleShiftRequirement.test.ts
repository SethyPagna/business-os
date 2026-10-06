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
  assert.match(pos, /if \(saleShiftRefusal\) \{ notify\(t\(saleShiftRefusal\), 'error'\); return \}\s+setShowStatusPicker\(true\)/)
})

if (failures.length) {
  console.error(`\n${failures.length} failing case(s)`)
  process.exit(1)
}
