// A confirmed duplicate cleanup is one resumable run. Normal request-budget
// yields continue under that confirmation; infrastructure failures stop for a
// fresh preview because their remaining counts are deliberately unknown.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  mergeDuplicateChunkCanContinueAutomatically,
  mergeDuplicateChunkRequiresManualResume,
} from '../src/components/products/mergeDuplicatesRun.ts'

const source = fs.readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const modal = fs.readFileSync(new URL('../src/components/products/MergeDuplicatesReviewModal.tsx', import.meta.url), 'utf8')

assert.equal(mergeDuplicateChunkRequiresManualResume({ interruptionCode: 'merge_infrastructure_interrupted' }), true)
assert.equal(mergeDuplicateChunkRequiresManualResume({ interruptionCode: 'merge_budget_reached' }), false)
assert.equal(mergeDuplicateChunkRequiresManualResume(undefined), false)
assert.equal(mergeDuplicateChunkCanContinueAutomatically({
  interruptionCode: 'merge_budget_reached',
  madeProgress: true,
  maxAdditionalRequests: 3,
}), true)
assert.equal(mergeDuplicateChunkCanContinueAutomatically({
  interruptionCode: 'merge_budget_reached',
  madeProgress: false,
  maxAdditionalRequests: 3,
}), false, 'a budget response without proven progress cannot continue automatically')
assert.equal(mergeDuplicateChunkCanContinueAutomatically({
  interruptionCode: 'merge_budget_reached',
  madeProgress: true,
  maxAdditionalRequests: null,
}), false, 'an unknown request bound cannot continue automatically')
assert.equal(mergeDuplicateChunkCanContinueAutomatically({
  interruptionCode: 'merge_infrastructure_interrupted',
  madeProgress: true,
  maxAdditionalRequests: 3,
}), false, 'infrastructure interruption always requires manual resume')

const start = source.indexOf('const handleMergeDuplicates = async () => {')
const end = source.indexOf('// --- Exact-duplicate', start)
assert.ok(start > 0 && end > start, 'merge handler exists as one bounded block')
const handler = source.slice(start, end)

assert.equal((handler.match(/const requestId =/g) || []).length, 1, 'one stable request id is created per confirmed run')
assert.ok(handler.indexOf('const requestId =') < handler.indexOf('while (calls < callCeiling)'), 'request id is created outside the continuation loop')
assert.match(handler, /productApi\.mergeDuplicates\(\{ requestId, signal: controller\.signal \}\)/,
  'every continuation call carries the same id and abort signal')
assert.match(handler, /calls \+= 1\s+const result = await productApi\.mergeDuplicates/,
  'a request is counted before awaiting so an unknown first-attempt outcome reloads authoritative state')

const manualAt = handler.indexOf('if (mergeDuplicateChunkRequiresManualResume(result))')
const budgetAt = handler.indexOf("if (result?.interruptionCode === 'merge_budget_reached')", manualAt)
assert.ok(manualAt > 0 && budgetAt > manualAt, 'infrastructure and normal budget outcomes have separate branches')
const manualBlock = handler.slice(manualAt, budgetAt)
assert.match(manualBlock, /merge_duplicates_partial_saved/, 'manual resume reports the count already committed')
assert.match(manualBlock, /merge_duplicates_partial_busy/, 'infrastructure interruption explains why the run stopped')
assert.match(manualBlock, /await load\(true\)/, 'manual resume first reloads authoritative product state')
assert.match(manualBlock, /setMergeDuplicatesReviewOpen\(false\)/, 'manual resume closes the stale review')
assert.match(manualBlock, /return/, 'manual resume cannot fall through into another request')

const completeAt = handler.indexOf('if (result?.complete)', budgetAt)
assert.ok(completeAt > budgetAt, 'normal budget handling precedes completion handling')
const budgetBlock = handler.slice(budgetAt, completeAt)
assert.match(budgetBlock, /mergeDuplicateChunkCanContinueAutomatically\(result\)/,
  'normal budget continuation requires progress and a finite server bound')
assert.match(budgetBlock, /callCeiling = Math\.max\(callCeiling, calls \+ result\.maxAdditionalRequests\)/,
  'a normal budget yield extends the same confirmed run by the server bound')
assert.match(budgetBlock, /continue/, 'a valid normal budget yield starts the next bounded request')
assert.doesNotMatch(budgetBlock, /load\(true\)|setMergeDuplicatesReviewOpen\(false\)|return/,
  'a normal budget yield neither reloads nor asks for another confirmation')
assert.doesNotMatch(budgetBlock, /setMergeDuplicatesRecovery/,
  'a normal bounded continuation does not enter unknown-outcome recovery')

const remainingAt = handler.indexOf('const remainingBefore = Number(result?.remainingProductsBefore)', completeAt)
const terminalBlock = handler.slice(completeAt, remainingAt)
assert.match(terminalBlock, /if \(result\?\.complete\)[\s\S]*completed = true[\s\S]*break/,
  'an actually clean catalog completes the confirmed run')
assert.match(terminalBlock, /if \(result\?\.blockedOnly\)[\s\S]*completed = true[\s\S]*break/,
  'reviewed refusals finish the run so their reasons are shown without claiming complete')
assert.match(handler, /result\?\.stalled \|\| !madeProgress/,
  'an ordinary incomplete response must still prove progress')
assert.match(handler, /remaining >= remainingBefore/,
  'known remaining products must decrease before an ordinary continuation')
assert.match(handler, /callCeiling = calls \+ additional/,
  'ordinary known-count continuation remains bounded by the Worker response')
const catchAt = handler.indexOf('} catch (e) {')
const finallyAt = handler.indexOf('} finally {', catchAt)
assert.ok(catchAt > 0 && finallyAt > catchAt, 'unknown-outcome reconciliation stays inside the merge catch path')
const catchBlock = handler.slice(catchAt, finallyAt)
assert.match(catchBlock, /const startedRun = calls > 0 \|\| controller\.signal\.aborted/,
  'timeout, error, or abort reconciles because a started request may already have committed')
const recoveryAt = catchBlock.indexOf('setMergeDuplicatesRecovery({')
const invalidateAt = catchBlock.indexOf('await productApi.invalidateProductReadCacheForReconciliation()')
const reloadAt = catchBlock.indexOf('await load(true)', invalidateAt)
assert.ok(recoveryAt > 0 && invalidateAt > recoveryAt && reloadAt > invalidateAt,
  'a started-call failure invalidates the confirmed preview before cache invalidation and authoritative reload')
assert.match(catchBlock, /requestId,[\s\S]*?mergedGroups,[\s\S]*?mergedProducts,[\s\S]*?detail: requestError/,
  'persistent recovery records only known completed response counts and the request error')
assert.match(catchBlock, /catch \(reconciliationError\)/,
  'a failed authoritative reload cannot bypass the persistent recovery state')
assert.doesNotMatch(catchBlock, /productApi\.mergeDuplicates/,
  'unknown-outcome recovery never replays a merge write automatically')

assert.match(source, /const active = mergeDuplicatesAbortRef\.current[\s\S]{0,100}active\?\.abort\(\)[\s\S]{0,120}setMergeDuplicatesReviewOpen\(false\)/,
  'closing the modal aborts the active request and closes immediately')
assert.match(source, /mergeDuplicates: async \(options\)[\s\S]{0,260}merge\(options\)/,
  'the lazy ProductApi adapter forwards the request id and signal to the transport')

assert.match(modal, /onClick=\{close\}/, 'the review modal renders its parent close action')
assert.doesNotMatch(modal, /onClick=\{close\}[^>]*disabled=\{working\}/,
  'Cancel remains available to abort a long confirmed run')
assert.match(source, /recoveryNotice=\{mergeDuplicatesRecovery\}/,
  'Products keeps the recovery notice attached to the mounted review')
assert.match(modal, /previewRequestsRef\.current\?\.cancel\(\)[\s\S]*?setPreview\(null\)[\s\S]*?setAcknowledged\(false\)[\s\S]*?setRecoveryNeedsPreview\(true\)/,
  'a new recovery notice cancels preview work, clears the old preview and acknowledgement, and requires a fresh scan')
assert.match(modal, /if \(recoveryNotice\) \{[\s\S]*?setPreviewLoading\(false\)[\s\S]*?return[\s\S]*?\}\s+runPreview\(\)/,
  'reopening after an unknown outcome waits for an explicit fresh scan instead of loading a confirmable preview automatically')
assert.match(modal, /const canMerge = !recoveryNeedsPreview && !previewLoading && !previewError/,
  'confirm remains disabled until the recovery scan succeeds')
assert.match(modal, /setPreview\(result\)[\s\S]*?setAcknowledged\(false\)[\s\S]*?setRecoveryNeedsPreview\(false\)/,
  'a successful fresh scan supplies current rows but still resets acknowledgement')
assert.match(modal, /The previous merge request has an unknown outcome/,
  'the modal persistently identifies the unknown outcome')
assert.match(modal, /failed request may have saved more complete groups/,
  'the warning distinguishes known response counts from possibly committed work')
assert.match(modal, /No merge write will be retried automatically/,
  'the recovery action explicitly promises no automatic write replay')

console.log('PASS duplicate merge continuation UI contract')
