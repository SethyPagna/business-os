// The direct-apply flow (one fast review, then auto-apply in the background --
// no second server-side review) was extended from products to the other import
// surfaces: the shared ServerImportReviewScreen used by Inventory and Sales, and
// the Contacts import (which keeps its merge screen only for genuine phone/name
// conflicts). These structural checks keep that wiring in place across all of
// them so the "no mid-action review/resolve" behaviour can't silently regress.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const genericScreen = read('src/components/imports/ServerImportReviewScreen.tsx')
const inventoryModal = read('src/components/inventory/InventoryImportModal.tsx')
const salesModal = read('src/components/sales/SalesImportModal.tsx')
const contactModal = read('src/components/contacts/ContactImportModal.tsx')

runTest('the shared review screen (inventory/sales) has an autoApprove mode that fires once', () => {
  assert.match(genericScreen, /autoApprove\?: boolean/, 'autoApprove must be a prop')
  assert.match(genericScreen, /if \(!autoApprove \|\| autoFellBack\) return/, 'the auto effect must bail when off / fallen back')
  assert.match(genericScreen, /status !== 'awaiting_review'\) return/, 'it must wait for analysis to finish')
  assert.match(genericScreen, /autoAttemptedRef\.current = true/, 'it must fire only once')
  assert.match(genericScreen, /confirm\(\{ auto: true \}\)/, 'it must approve in auto mode')
  assert.match(genericScreen, /if \(autoApprove && !autoFellBack\) \{/, 'auto mode must short-circuit the review table')
})

runTest('Inventory + Sales import modals turn autoApprove ON', () => {
  const invBlock = inventoryModal.slice(inventoryModal.indexOf('<ServerImportReviewScreen'))
  assert.match(invBlock.slice(0, invBlock.indexOf('/>')), /autoApprove/, 'InventoryImportModal must pass autoApprove')
  const salesBlock = salesModal.slice(salesModal.indexOf('<ServerImportReviewScreen'))
  assert.match(salesBlock.slice(0, salesBlock.indexOf('/>')), /autoApprove/, 'SalesImportModal must pass autoApprove')
})

runTest('Contacts import auto-approves a clean import but keeps the merge screen for conflicts', () => {
  // Auto-fire once ready_to_approve is reached...
  assert.match(contactModal, /postStartStep !== 'ready_to_approve' \|\| postStartJobId === null\) return/, 'it must auto-approve only when the clean import is ready')
  assert.match(contactModal, /autoApproveAttemptedRef\.current = true/, 'the contacts auto-approve must fire once')
  assert.match(contactModal, /void handleApproveNow\(postStartJobId, rowCount, conflictMode\)/, 'it must apply automatically')
  // ...but conflicts still route to the merge screen for manual resolution.
  assert.match(contactModal, /postStartStep === 'conflicts'/, 'genuine conflicts must still open the merge screen')
  assert.match(contactModal, /ContactImportConflictsModal/, 'the merge screen component must still be wired')
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} import direct-apply surface test(s) failed`)
} else {
  console.log('\nAll import direct-apply surface tests passed')
}
