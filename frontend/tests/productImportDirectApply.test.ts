// The products import used to make the operator review TWICE: a fast
// client-side review, then a second server-side review that polled "Analyzing
// on the server…" before applying. By request, the client review is now the
// single decision point -- once the server finishes analysis the import
// auto-approves and applies in the background (the modal closes into the tracker),
// with NO second review. The one exception is data safety: the server 409s on
// unresolved product conflicts, and in that case the manual review table is
// shown so they can be resolved. These structural checks keep that wiring intact.
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

const screen = readFileSync(new URL('../src/components/products/import/ProductServerImportReviewScreen.tsx', import.meta.url), 'utf8')
const modal = readFileSync(new URL('../src/components/products/import/BulkImportModal.tsx', import.meta.url), 'utf8')

runTest('the review screen accepts an autoApprove mode', () => {
  assert.match(screen, /autoApprove\?: boolean/, 'autoApprove must be a declared prop')
})

runTest('autoApprove auto-fires the approve once analysis reaches awaiting_review', () => {
  // An effect gated on status awaiting_review + autoApprove that calls the
  // approve with the auto flag, guarded so it fires exactly once.
  assert.match(screen, /if \(!autoApprove \|\| autoFellBack\) return/, 'the auto effect must bail when off / fallen back')
  assert.match(screen, /status !== 'awaiting_review'\) return/, 'auto-approve must wait for analysis to finish')
  assert.match(screen, /autoAttemptedRef\.current = true/, 'auto-approve must fire only once')
  assert.match(screen, /confirm\(\{ auto: true \}\)/, 'it must approve in auto mode')
})

runTest('an unresolved-conflict 409 falls back to the manual review, not a silent apply', () => {
  assert.match(screen, /product_conflicts_unresolved/, 'the fallback must key off the server conflict code')
  assert.match(screen, /setAutoFellBack\(true\)/, 'the fallback must switch to the manual review table')
})

runTest('direct-apply shows a single Importing progress state, not the review table', () => {
  assert.match(screen, /if \(autoApprove && !autoFellBack\) \{/, 'auto mode must short-circuit the review table render')
  assert.match(screen, /import_applying_now/, 'the progress copy must be present')
})

runTest('the products modal turns autoApprove ON for its review screen', () => {
  const block = modal.slice(modal.indexOf('<ProductServerImportReviewScreen'))
  const propsRegion = block.slice(0, block.indexOf('/>') > -1 ? block.indexOf('/>') : 2000)
  assert.match(propsRegion, /autoApprove/, 'BulkImportModal must pass autoApprove to the review screen')
})

runTest('step 1 shows a client-side review table before any server work (review, then import)', () => {
  // The old "Add" flow reviewed the file before importing; it must again -- a
  // preview built from the picked file client-side, not "ready for server review".
  assert.match(modal, /const csvPreview = useMemo\(/, 'a client-side CSV preview must be derived from the picked file')
  assert.match(modal, /parseCsvRows\(csvData\.content\)/, 'the preview must parse the picked file client-side')
  assert.match(modal, /import_review_before'?, 'Review before importing'/, 'step 1 must present a review heading')
  assert.doesNotMatch(modal, /ready for server review/, 'the bare "ready for server review" line must be gone')
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} direct-apply test(s) failed`)
} else {
  console.log('\nAll product-import direct-apply tests passed')
}
