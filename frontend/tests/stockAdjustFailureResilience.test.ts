import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

// Source-shape pins for the user's Sep 3 rule: "for adjust stock, if the
// adjustment (add, remove, set) fails for any reason it should not forget
// this... should not close the action, keep in same page, so user can edit
// the failed to correct... also show the failed in the stock change as well...
// or else user will get frustrated when they do a bunch of edits and it just
// closes when it fails, clearing everything they did."
//
// Since 30 Sep 2026 every add, remove and set is a line in the one Stock
// Session (FastStockInModal); StockAdjustModal and BulkAddStockModal, with
// their row reducers and retry buttons, are retired. The rule now lives in the
// session: a failed line stays in Items with its reason inline, the float
// stays open, and Complete Session again sends only what did not save.
//
// These assertions are structural on purpose: the behaviour lives in a React
// component that a plain-node test cannot render.

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

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const stockChange = read('../src/components/products/StockChangeSection.tsx')
const fastStockIn = read('../src/components/inventory/FastStockInModal.tsx')
const items = read('../src/components/stock-session/StockSessionItems.tsx')
const outcomeUtil = read('../src/utils/stockAdjustOutcome.ts')
const inventoryRoute = read('../../cloudflare/src/routes/inventory.ts')

/** The body of performCommit -- where the session writes. */
function performCommitBody(): string {
  const start = fastStockIn.indexOf('const performCommit = async () => {')
  assert.ok(start > 0, 'the Stock Session must still have performCommit')
  const end = fastStockIn.indexOf('// ---- close / minimize ----', start)
  assert.ok(end > start)
  return fastStockIn.slice(start, end)
}

runTest('the retired one-product and bulk forms stay retired', () => {
  for (const rel of ['../src/components/products/forms/StockAdjustModal.tsx', '../src/components/products/forms/BulkAddStockModal.tsx']) {
    assert.equal(existsSync(new URL(rel, import.meta.url)), false, `${rel} must not come back beside the session`)
  }
})

runTest('a failed line keeps the float open on Items with everything typed', () => {
  const body = performCommitBody()
  const failure = body.slice(body.indexOf('if (failed) {\n      onDone()'))
  assert.ok(failure.length > 0, 'a partial failure has its own branch')
  const branch = failure.slice(0, failure.indexOf('return'))
  assert.doesNotMatch(branch, /onClose\(\)|finishSession\(\)|clearWorkDraft\(/, 'a failure must not close the float or drop the draft')
  assert.match(branch, /setStep\(requestFailure === 'supplier_total_mismatch' \? 'payment' : 'items'\)/)
  assert.match(branch, /stock_session_partial/)
  assert.match(body, /status: 'error',\s*\n?\s*needsRemoval: stockLineNeedsRemoval\(result\)/, 'a refused line records its outcome')
  assert.match(body, /detail: failureText\(result, tr\('error', 'Error'\)\)/, 'with the refusal in words')
})

runTest('a line already saved is never sent again', () => {
  const body = performCommitBody()
  assert.match(body, /const pending = lines\.filter\(\(line\) => line\.status !== 'saved'\)/)
  assert.match(body, /const toCommit = lines\.filter\(\(line\) => line\.status !== 'saved'\)/)
  assert.match(body, /\/\/ Only lines no round has answered: a line already saved must stay saved\./)
})

runTest('the failed line shows its reason inline in Items', () => {
  assert.match(items, /line\.status === 'error'/)
  assert.match(items, /line\.detail/)
})

runTest('the Stock Change section lists an unsaved failed attempt', () => {
  assert.match(stockChange, /data-failed-stock-attempts="true"/)
  assert.match(stockChange, /readFailedStockAttempts\(/)
  assert.match(stockChange, /FAILED_ATTEMPTS_EVENT/, 'the list refreshes when a failure is recorded')
  assert.match(stockChange, /unsaved_not_applied/, 'the entry is explicitly marked unsaved')
  assert.match(stockChange, /row\.failure\?\.message/, 'the reason is shown on the entry')
  assert.match(stockChange, /fix_and_retry/)
  assert.match(stockChange, /discardFailedAttempt\(/)
})

runTest('a listed failure reopens the session in its mode with its lines queued', () => {
  const resume = stockChange.slice(stockChange.indexOf('const resumeFailedAttempt = useCallback'), stockChange.indexOf('}, [blurLedgerSearch])', stockChange.indexOf('const resumeFailedAttempt')))
  assert.match(resume, /const mode: StockMode = first\.type === 'remove' \|\| first\.type === 'set' \? first\.type : 'add'/)
  for (const field of ['quantity: Number(row.quantity)', 'batchId: Number(row.batchId) > 0', 'reason: row.reason']) {
    assert.ok(resume.includes(field), `resuming a failed attempt must carry ${field}`)
  }
  assert.match(resume, /branchId: first\.branchId \?\? null/)
  const mount = stockChange.slice(stockChange.indexOf('{fastStockInOpen ? ('))
  assert.match(mount, /initialLines=\{fastStockInResume\?\.lines\}/)
  assert.match(mount, /defaultBranchId=\{fastStockInResume\?\.branchId \|\| branchId \|\| null\}/)
  // The record goes only once that session wrote; closing keeps it listed.
  assert.match(mount, /onDone=\{\(\) => \{\s*if \(fastStockInResume\) discardFailedAttempt\(fastStockInResume\.attemptId\)/)
  assert.doesNotMatch(mount.slice(0, mount.indexOf('onDone=')), /discardFailedAttempt/, 'closing without writing keeps the record')
})

runTest('closing with unsaved work asks through the ONE shared close guard', () => {
  assert.match(fastStockIn, /const closeGuard = useCloseGuard\(\{ dirty: closeDirty \}, discardAndClose, onMinimize \? preserveAndMinimize : undefined\)/)
  assert.match(fastStockIn, /const preserveAndMinimize = \(\) => \{\s*if \(saving \|\| !onMinimize\) return\s*flushPendingWorkDraft\(fastStockInDraftKey\)/, 'minimize persists exact typed values before the host hides the float')
  assert.doesNotMatch(fastStockIn, /window\.confirm\(/)
})

runTest('the outcome store is pure and /adjust stays a single-row write', () => {
  assert.doesNotMatch(outcomeUtil, /from 'react'/, 'the outcome store must stay testable without React')
  assert.doesNotMatch(outcomeUtil, /\bdocument\./, 'the outcome store must not touch the DOM')
  // The server truth the failed-attempt store depends on: /adjust commits
  // exactly one product per call, so "all-or-nothing across rows" does not
  // apply -- each row is its own transaction and its own outcome.
  assert.match(inventoryRoute, /app\.post\('\/adjust'/)
  assert.match(inventoryRoute, /Cannot remove \$\{quantity\} - only \$\{current\} available/)
})

if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nstockAdjustFailureResilience tests passed')
