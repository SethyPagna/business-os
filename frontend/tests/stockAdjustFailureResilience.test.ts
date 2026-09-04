import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Source-shape pins for the user's Sep 3 rule: "for adjust stock, if the
// adjustment (add, remove, set) fails for any reason it should not forget
// this... should not close the action, keep in same page, so user can edit
// the failed to correct... also show the failed in the stock change as well...
// or else user will get frustrated when they do a bunch of edits and it just
// closes when it fails, clearing everything they did."
//
// These assertions are structural on purpose: the behaviour lives in a React
// component that a plain-node test cannot render, so what is pinned is the
// absence of the close/reset call in the failure branch and the presence of
// the inline reason, the retry label and the ConfirmDialog guard.

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

const adjustModal = readFileSync(new URL('../src/components/products/forms/StockAdjustModal.tsx', import.meta.url), 'utf8')
const stockChange = readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')
const bulkModal = readFileSync(new URL('../src/components/products/forms/BulkAddStockModal.tsx', import.meta.url), 'utf8')
const stockModals = readFileSync(new URL('../src/components/inventory/InventoryStockModals.tsx', import.meta.url), 'utf8')
const fastStockIn = readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')
const outcomeUtil = readFileSync(new URL('../src/utils/stockAdjustOutcome.ts', import.meta.url), 'utf8')
const inventoryRoute = readFileSync(new URL('../../cloudflare/src/routes/inventory.ts', import.meta.url), 'utf8')

/** The body of `commitAdjust` -- the only place the adjust write happens. */
function commitAdjustBody(): string {
  const start = adjustModal.indexOf('const commitAdjust = useCallback')
  assert.ok(start > 0, 'StockAdjustModal must still have a commitAdjust callback')
  // S4-21 renamed the close path: the private discard dialog is gone and
  // `discardFailedAndClose` is now what the shared guard calls on Discard.
  const end = adjustModal.indexOf('const discardFailedAndClose', start)
  assert.ok(end > start, 'commitAdjust must be followed by the close guard')
  return adjustModal.slice(start, end)
}

/** The catch arm of that body -- what happens when the write is refused. */
function commitAdjustFailureBranch(): string {
  const body = commitAdjustBody()
  const start = body.indexOf('} catch (error: unknown) {')
  assert.ok(start > 0, 'commitAdjust must catch its rejection')
  const end = body.indexOf('} finally {', start)
  assert.ok(end > start, 'commitAdjust must have a finally arm')
  return body.slice(start, end)
}

runTest('the failure branch never closes the dialog or resets the form', () => {
  const branch = commitAdjustFailureBranch()
  // The regression the user hit: onClose() in the failure path threw away
  // everything they had typed.
  assert.doesNotMatch(branch, /onClose\(\)/, 'a failed adjustment must not close the modal')
  assert.doesNotMatch(branch, /onDone\(\)/, 'a failed adjustment must not report itself as done')
  assert.doesNotMatch(branch, /setPendingAdjust\(null\)/, 'a failed adjustment must keep the parked request')
  assert.doesNotMatch(branch, /setAdjustForm\(/, 'a failed adjustment must not touch the typed values')
  assert.doesNotMatch(branch, /setSelectedProduct\(/, 'a failed adjustment must keep the chosen product')
  // ...and it must positively record the failure instead.
  assert.match(branch, /classifyStockAdjustFailure\(error\)/)
  assert.match(branch, /applyRowOutcome\([\s\S]*status: 'failed'/)
  assert.match(branch, /persistFailedAttempt\(/)
})

runTest('the success branch is the only one that closes, and it marks the row done', () => {
  const body = commitAdjustBody()
  assert.match(body, /applyRowOutcome\(prev, target\.rowId, \{ status: 'done' \}\)/)
  assert.match(body, /dropFailedStockAttempt\(/, 'a committed retry clears its persisted failure record')
  assert.match(body, /onDone\(\)[\s\S]{0,40}onClose\(\)/)
})

runTest('the submitted row is never one that already committed', () => {
  const body = commitAdjustBody()
  // Only a pending or failed row is ever the target of a write, so a retry
  // can never re-apply a movement that already landed.
  assert.match(body, /rows\.find\(\(row\) => row\.status === 'pending'\)/)
  assert.match(body, /rows\.find\(\(row\) => row\.status === 'failed'\)/)
  assert.doesNotMatch(body, /status === 'done'/)
  // The retry keeps the SAME client-generated row id rather than minting one.
  assert.match(adjustModal, /Keep the row's identity across a retry/)
})

runTest('the failed row shows the server reason inline, not only as a toast', () => {
  assert.match(adjustModal, /data-stock-adjust-failure="true"/)
  assert.match(adjustModal, /failedRow\.failure\.message/)
  assert.match(adjustModal, /failedRow\.failure\.available != null/, 'insufficient stock shows the available quantity')
  assert.match(adjustModal, /stock_adjust_failed_offline/, 'an offline failure says the entry is kept')
  // It is pinned to the form itself, not just the review dialog.
  assert.match(adjustModal, /adjustNotice=\{failureNotice\}/)
  assert.match(stockModals, /\{adjustNotice\}/)
})

runTest('the submit button becomes Retry while a failure is unresolved', () => {
  assert.match(adjustModal, /submitState\.mode === 'retry'/)
  assert.match(adjustModal, /retry_failed/)
  assert.match(adjustModal, /adjustSubmitLabel=\{submitState\.mode === 'retry'/)
  assert.match(stockModals, /adjustSubmitLabel \|\| t\('save'\)/)
})

runTest('closing with unsaved failures asks through the ONE shared close guard', () => {
  // S4-21 retired this surface's private "Discard the unsaved adjustment?"
  // ConfirmDialog in favour of the app-wide guard. The behaviour the
  // original test protected is unchanged and still pinned here; what
  // changed is that one implementation of the question now serves every
  // modal instead of each surface growing its own.
  assert.doesNotMatch(adjustModal, /setConfirmDiscard/, 'the private discard dialog must not come back')
  // The shared adjust chrome does the asking...
  assert.match(stockModals, /const adjustGuard = useCloseGuard\(/)
  assert.match(stockModals, /onClick=\{requestCloseAdjust\}/)
  assert.match(stockModals, /<UnsavedChangesPrompt guard=\{adjustGuard\} items=\{adjustDiscardItems\} \/>/)
  // ...Discard still runs THIS page's cleanup, not a generic close...
  assert.match(adjustModal, /onCloseAdjust=\{discardFailedAndClose\}/)
  assert.match(adjustModal, /hasUnsavedFailures\(rows\)[\s\S]{0,200}?dropFailedStockAttempt\(/)
  // ...and the failed attempt's values still appear in the prompt.
  assert.match(adjustModal, /adjustDiscardItems=\{buildAdjustReviewItems\(\)\}/)
  // Confirmations go through a rendered dialog -- never a native popup.
  assert.doesNotMatch(adjustModal, /window\.confirm\(\s*tr\('discard/)
})

runTest('the Stock Change section lists the unsaved failed attempt', () => {
  assert.match(stockChange, /data-failed-stock-attempts="true"/)
  assert.match(stockChange, /readFailedStockAttempts\(/)
  assert.match(stockChange, /FAILED_ATTEMPTS_EVENT/, 'the list refreshes when a modal records a failure')
  assert.match(stockChange, /unsaved_not_applied/, 'the entry is explicitly marked unsaved')
  assert.match(stockChange, /row\.failure\?\.message/, 'the reason is shown on the entry')
  assert.match(stockChange, /fix_and_retry/)
  assert.match(stockChange, /discardFailedAttempt\(/)
})

runTest('a listed failure reopens the adjust modal prefilled', () => {
  assert.match(stockChange, /resumeRow=\{resumeAttempt\?\.rows\[0\] \|\| null\}/)
  assert.match(stockChange, /resumeAttemptId=\{resumeAttempt\?\.id \|\| null\}/)
  assert.match(stockChange, /initialProduct=\{resumeAttempt\?\.rows\[0\]\?\.productId != null/)
  // The modal puts every one of those values back.
  for (const field of ['type:', 'quantity:', 'reason:', 'branch_id:', 'batch_id:', 'received_date:']) {
    assert.ok(
      new RegExp(`${field.replace(':', ':')}\\s*resume\\.`).test(adjustModal),
      `resuming a failed attempt must restore ${field}`,
    )
  }
})

runTest('the bulk surface follows the same rule, row by row', () => {
  assert.match(bulkModal, /rowsToSubmit\(startingRows\)/, 'a retry submits only what failed')
  assert.match(bulkModal, /classifyStockAdjustFailure\(error\)/)
  assert.match(bulkModal, /data-bulk-stock-outcomes="true"/, 'per-product outcomes are rendered')
  assert.match(bulkModal, /row\.failure\.message/)
  // The old behaviour -- report and close even when rows failed -- is gone.
  assert.doesNotMatch(bulkModal, /if \(done\) onDone\(/)
  assert.match(bulkModal, /if \(counts\.failed > 0\) \{[\s\S]{0,600}?return\s/, 'failures keep the bulk dialog open')
  assert.match(bulkModal, /onClick=\{requestClose\}/)
  // Same S4-21 merge as the single-product surface above: the private
  // abandon dialog is gone, the shared guard asks, and the failed/done
  // counts it used to show are handed to that guard's prompt.
  assert.doesNotMatch(bulkModal, /setConfirmAbandon/, 'the private abandon dialog must not come back')
  assert.match(bulkModal, /const closeGuard = useCloseGuard\(\{ dirty: bulkDirty \}, reportAndClose\)/)
  assert.match(bulkModal, /<UnsavedChangesPrompt guard=\{closeGuard\} items=\{bulkPromptItems\} \/>/)
  assert.match(bulkModal, /hasUnsavedFailures\(rows\) \|\|/, 'unsaved failures still count as dirty')
})

runTest('fast stock-in already kept its lines -- that behaviour stays', () => {
  // The reference implementation this rule generalises: per-line status,
  // inline detail, saved lines skipped on the next Complete.
  assert.match(fastStockIn, /status: 'error', detail: message/)
  assert.match(fastStockIn, /received\.filter\(\(line\) => line\.status !== 'saved'\)/)
})

runTest('the outcome kernel is pure and documents the commit semantics', () => {
  assert.doesNotMatch(outcomeUtil, /from 'react'/, 'the reducer must stay testable without React')
  assert.doesNotMatch(outcomeUtil, /\bdocument\./, 'the reducer must not touch the DOM')
  assert.match(outcomeUtil, /single-row, non-idempotent write/)
  // The server truth this depends on: /adjust commits exactly one product per
  // call, so "all-or-nothing across rows" does not apply -- each row is its
  // own transaction and its own outcome.
  assert.match(inventoryRoute, /app\.post\('\/adjust'/)
  assert.match(inventoryRoute, /Cannot remove \$\{quantity\} - only \$\{current\} available/)
})

if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nstockAdjustFailureResilience tests passed')
