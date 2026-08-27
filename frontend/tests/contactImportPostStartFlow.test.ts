import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideContactImportPostStartAction } from '../src/components/contacts/contactImportPostStartFlow.ts'
import {
  CONTACT_REVIEW_PAGE_SIZE,
  contactConflictWarningKinds,
  contactReviewPageCount,
  restoreContactRowDecision,
} from '../src/components/contacts/contactImportReviewModel.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('no job snapshot yet keeps polling', () => {
  assert.deepEqual(decideContactImportPostStartAction(null), { kind: 'keep_polling' })
  assert.deepEqual(decideContactImportPostStartAction(undefined), { kind: 'keep_polling' })
})

await runTest('pending/queued/analyzing all keep polling', () => {
  for (const status of ['pending', 'queued', 'analyzing']) {
    assert.deepEqual(decideContactImportPostStartAction({ status }), { kind: 'keep_polling' }, status)
  }
})

await runTest('status is case/whitespace-normalized, same as normalizeJobStatus', () => {
  assert.deepEqual(decideContactImportPostStartAction({ status: '  Analyzing ' }), { kind: 'keep_polling' })
})

await runTest('failed and cancelled are terminal -- stop polling, do not open the conflicts modal', () => {
  assert.deepEqual(decideContactImportPostStartAction({ status: 'failed' }), { kind: 'terminal' })
  assert.deepEqual(decideContactImportPostStartAction({ status: 'cancelled' }), { kind: 'terminal' })
})

await runTest('awaiting_review with warned rows shows the conflicts step', () => {
  assert.deepEqual(
    decideContactImportPostStartAction({ status: 'awaiting_review', summary: { warned: 4 } }),
    { kind: 'show_conflicts' },
  )
})

await runTest('awaiting_review with zero (or missing) warned rows goes straight to ready_to_approve', () => {
  assert.deepEqual(
    decideContactImportPostStartAction({ status: 'awaiting_review', summary: { warned: 0 } }),
    { kind: 'ready_to_approve' },
  )
  assert.deepEqual(
    decideContactImportPostStartAction({ status: 'awaiting_review' }),
    { kind: 'ready_to_approve' },
  )
})

await runTest('any other/unexpected status (e.g. approved, completed, running) keeps polling rather than guessing', () => {
  for (const status of ['approved', 'completed', 'running', 'applying', 'completed_with_errors', 'weird_unknown_status']) {
    assert.deepEqual(decideContactImportPostStartAction({ status }), { kind: 'keep_polling' }, status)
  }
})

await runTest('contact conflict review keeps filters and pagination bounded', () => {
  assert.equal(CONTACT_REVIEW_PAGE_SIZE, 50)
  assert.equal(contactConflictWarningKinds('all'), 'name_match,membership_phone_conflict')
  assert.equal(contactConflictWarningKinds('name'), 'name_match')
  assert.equal(contactConflictWarningKinds('phone'), 'membership_phone_conflict')
  assert.equal(contactReviewPageCount(0), 1)
  assert.equal(contactReviewPageCount(51), 2)
})

await runTest('all saved contact decisions restore from server truth', () => {
  assert.deepEqual(restoreContactRowDecision(null), { resolved: false })
  assert.deepEqual(restoreContactRowDecision({ action: 'apply' }), { choice: 'merge', resolved: true })
  assert.deepEqual(restoreContactRowDecision({ action: 'skip' }), { choice: 'delete', resolved: true })
  assert.deepEqual(
    restoreContactRowDecision({ action: 'force_create', field_overrides: { name: 'Sokha (2)' } }),
    { choice: 'different', rename: 'Sokha (2)', resolved: true },
  )
})

await runTest('contact conflict screen wires server search, sort, filters, pagination and durable merge', () => {
  const source = readFileSync(new URL('../src/components/contacts/ContactImportConflictsModal.tsx', import.meta.url), 'utf8')
  assert.match(source, /contactConflictWarningKinds\(conflictFilter\)/)
  assert.match(source, /pageSize: CONTACT_REVIEW_PAGE_SIZE/)
  assert.match(source, /query: searchQuery/)
  assert.match(source, /sort,/)
  assert.match(source, /action: 'apply'/)
  assert.match(source, /unresolvedContactConflicts/)
  assert.match(source, /Confirm & import/)
  assert.match(source, /updateImportJobDecisions\(jobId/)
  assert.match(source, /contactReviewPageCount\(total\)/)
  assert.doesNotMatch(source, /pageSize:\s*200/)
})

await runTest('contacts keep confirmation on the same authoritative review screen', () => {
  const source = readFileSync(new URL('../src/components/contacts/ContactImportModal.tsx', import.meta.url), 'utf8')
  assert.match(source, /onConfirm=\{\(\) => handleApproveNow/)
  assert.match(source, /onClose=\{\(\) => void fallBackToBackgroundTracking/)
  assert.doesNotMatch(source, /handleConflictsReviewed/)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
