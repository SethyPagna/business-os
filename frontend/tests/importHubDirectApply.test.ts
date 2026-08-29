// The unified import hub ("drop your files, we route them") queues one server
// import job per routed file and hands off to the BackgroundImportTracker for
// review/approval. To give it the same direct-apply behaviour as the per-page
// imports, the hub flags each job `auto_approve` in its policy, and the tracker
// approves any such job automatically the moment it reaches awaiting_review --
// going through handleApprove, which still redirects genuine product/contact
// conflicts to their review/merge screen. These checks keep that wiring intact.
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
const hub = read('src/components/products/import/ImportHub.tsx')
const tracker = read('src/components/shared/BackgroundImportTracker.tsx')

runTest('the import hub flags each queued job auto_approve in its policy', () => {
  assert.match(
    hub,
    /policy:\s*\{\s*\.\.\.defaultPolicyFor\([^)]*\),\s*auto_approve:\s*true\s*\}/,
    'ImportHub must add auto_approve: true to each job policy',
  )
})

runTest('the tracker auto-approves auto_approve jobs once they are awaiting_review, once each', () => {
  assert.match(tracker, /policy\.auto_approve !== true\) continue/, 'it must only act on auto_approve jobs')
  assert.match(tracker, /normalizeJobStatus\(job\) !== 'awaiting_review'\) continue/, 'it must wait for analysis to finish')
  assert.match(tracker, /autoApprovedJobIdsRef\.current\.add\(jobId\)/, 'it must fire once per job')
  assert.match(tracker, /approve\(job\)/, 'it must approve through the handleApprove bridge')
})

runTest('the tracker auto-approve goes through handleApprove (keeps the conflict/merge safety)', () => {
  // The bridge is assigned from handleApprove, so the conflict redirects inside
  // handleApprove (shouldPromptConflictReviewBeforeApprove / product variant)
  // still run instead of a raw approveImportJob call.
  assert.match(tracker, /autoApproveHandlerRef\.current = handleApprove/, 'the bridge must point at handleApprove')
  assert.match(tracker, /shouldPromptConflictReviewBeforeApprove/, 'handleApprove must still gate contact conflicts')
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} import-hub direct-apply test(s) failed`)
} else {
  console.log('\nAll import-hub direct-apply tests passed')
}
