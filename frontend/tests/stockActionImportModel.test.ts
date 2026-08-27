// Tests the pure view-model behind the two-screen unified stock-action import
// (§12/§13) and guards the wiring that makes it live end-to-end: the modal
// drives the SERVER job (type stock_actions) with an explicit confirm gate,
// the wizard launches it in place of the old client-side importer, the
// transport forwards confirm_stock_actions, and the backend allow-list now
// admits the type. If any of those regress the feature is half-wired again.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { unwrapImportJob, deriveStockImportReview } from '../src/components/products/import/stockActionImportModel.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

test('unwrapImportJob accepts {job:{id}}, a bare job, and rejects id-less/garbage', () => {
  assert.equal(unwrapImportJob({ job: { id: 7, status: 'analyzing' } })?.id, 7)
  assert.equal(unwrapImportJob({ id: 9 })?.id, 9)
  assert.equal(unwrapImportJob({}), null)
  assert.equal(unwrapImportJob(null), null)
  assert.equal(unwrapImportJob('nope'), null)
})

test('still analyzing until a terminal status is reached', () => {
  const r = deriveStockImportReview({ id: 1, status: 'analyzing' }, false)
  assert.equal(r.analyzing, true)
  assert.equal(r.canConfirm, false, 'cannot confirm while analyze is still running')
})

test('no conflicts: Confirm is enabled once analyze finishes with actionable rows', () => {
  const r = deriveStockImportReview({ id: 1, status: 'awaiting_review', summary: { created: 3, updated: 2, skipped: 1, errored: 0, total: 6 } }, false)
  assert.equal(r.analyzing, false)
  assert.equal(r.needsConfirm, false)
  assert.equal(r.actionable, 5)
  assert.equal(r.canConfirm, true)
})

test('conflicts gate Confirm behind the explicit checkbox', () => {
  const summary = { created: 4, updated: 0, errored: 0, total: 4, requires_stock_action_confirmation: true, stock_action_confirmation_rows: 2 }
  const unchecked = deriveStockImportReview({ id: 1, status: 'awaiting_review', summary }, false)
  assert.equal(unchecked.needsConfirm, true)
  assert.equal(unchecked.conflictRows, 2)
  assert.equal(unchecked.canConfirm, false, 'must tick the confirmation box first')
  const checked = deriveStockImportReview({ id: 1, status: 'awaiting_review', summary }, true)
  assert.equal(checked.canConfirm, true)
})

test('nothing actionable (all skipped, none errored) cannot be confirmed', () => {
  const r = deriveStockImportReview({ id: 1, status: 'awaiting_review', summary: { created: 0, updated: 0, skipped: 5, errored: 0, total: 5 } }, true)
  assert.equal(r.canConfirm, false)
})

test('an errored-only result is still confirmable (the good rows, if any, apply; errors are reported)', () => {
  // errored counts as "there is something to run"; the engine isolates per-unit
  // failures, so the operator can still proceed and download the error report.
  const r = deriveStockImportReview({ id: 1, status: 'awaiting_review', summary: { created: 0, updated: 0, skipped: 0, errored: 2, total: 2 } }, false)
  assert.equal(r.canConfirm, true)
})

test('a failed analyze is neither analyzing nor confirmable', () => {
  const r = deriveStockImportReview({ id: 1, status: 'failed', last_error: 'boom' }, true)
  assert.equal(r.analyzing, false)
  assert.equal(r.failed, true)
  assert.equal(r.canConfirm, false)
})

// ---- wiring guards (cross-file) -------------------------------------------
test('StockActionImportModal drives the server job with type stock_actions + confirm gate', () => {
  const src = read('src/components/products/import/StockActionImportModal.tsx')
  assert.ok(/type:\s*'stock_actions'/.test(src), 'creates a stock_actions job')
  assert.ok(src.includes('stock_action_mode: mode'), 'sends the Direct/Reconcile mode in the policy')
  assert.ok(src.includes('confirmStockActions: true'), 'approves with the confirm-action gate')
  assert.ok(src.includes("useState<Step>('upload')"), 'starts on the upload screen')
})

test('ImportModeWizard launches the server-backed modal, not the old client-side one', () => {
  const src = read('src/components/products/import/ImportModeWizard.tsx')
  assert.ok(src.includes('StockActionImportModal'), 'wires in the server-backed modal')
  assert.ok(!/import\(['"]\.\/AddSaleImportModal['"]\)/.test(src), 'no longer launches the retired client-side AddSaleImportModal')
})

test('approveImportJob forwards confirm_stock_actions', () => {
  const src = read('src/api/importJobsTransport.ts')
  assert.ok(src.includes('confirm_stock_actions: true'), 'transport can send the confirmation flag')
})

test('backend allow-list now admits stock_actions', () => {
  const src = read('../cloudflare/src/routes/importJobs.ts')
  assert.ok(/ALLOWED_TYPES[^\n]*'stock_actions'/.test(src), 'stock_actions is in ALLOWED_TYPES')
})

if (failed > 0) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nAll stockActionImportModel tests passed')
