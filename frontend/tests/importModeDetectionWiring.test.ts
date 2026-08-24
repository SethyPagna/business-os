// Verifies item 10a's first real wiring: BulkImportModal.tsx (the "Add /
// Update Products" flow) actually calls importModeDetection.ts's pure
// detector once a file is parsed, and surfaces the result as a dismissible
// suggestion banner rather than an automatic mode switch. The detector
// itself already has its own full unit-test coverage in
// importModeDetection.test.ts; this file is source-level (same pattern as
// actionStability.test.ts / performanceLoadingUx.test.ts) since exercising
// BulkImportModal's actual React state would need a DOM harness this
// project's test scripts don't have.
import assert from 'node:assert/strict'
import fs from 'node:fs'

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

const source = fs.readFileSync(new URL('../src/components/products/import/BulkImportModal.tsx', import.meta.url), 'utf8')

await runTest('imports the pure detector from importModeDetection.ts', () => {
  assert.match(source, /import \{ detectLikelyDatedReconciliation, type ImportModeDetectionResult \} from '\.\/importModeDetection\.ts'/)
})

await runTest('holds the detection result and a per-file dismissal flag in state', () => {
  assert.match(source, /const \[datedReconciliationSignal, setDatedReconciliationSignal\] = useState<ImportModeDetectionResult \| null>\(null\)/)
  assert.match(source, /const \[dismissedDatedSignal, setDismissedDatedSignal\] = useState\(false\)/)
})

await runTest('runs the detector against the freshly parsed rows inside analyzePickedCsv, and resets dismissal per file', () => {
  assert.match(source, /const datedSignal = detectLikelyDatedReconciliation\(analysis\.rows \|\| \[\]\)/)
  assert.match(source, /setDatedReconciliationSignal\(datedSignal\.likelyDatedReconciliation \? datedSignal : null\)/)
  assert.match(source, /setDismissedDatedSignal\(false\)/)
  // Must run before the state setters it feeds -- a stale/undefined
  // datedSignal read would silently never show the banner.
  const analyzeFnStart = source.indexOf('const analyzePickedCsv = async')
  const datedSignalCallIndex = source.indexOf('const datedSignal = detectLikelyDatedReconciliation')
  const setDatedReconciliationSignalIndex = source.indexOf('setDatedReconciliationSignal(datedSignal')
  assert.ok(analyzeFnStart >= 0 && datedSignalCallIndex > analyzeFnStart, 'datedSignal computed inside analyzePickedCsv')
  assert.ok(setDatedReconciliationSignalIndex > datedSignalCallIndex, 'datedSignal computed before it is stored in state')
})

await runTest('the suggestion banner only renders on the review step, and only when not dismissed', () => {
  assert.match(source, /\{datedReconciliationSignal && !dismissedDatedSignal && step === 2 \? \(/)
})

await runTest('the banner never claims to auto-switch -- its action button closes the import (cancel), not a silent mode change', () => {
  const bannerStart = source.indexOf('datedReconciliationSignal && !dismissedDatedSignal && step === 2')
  assert.ok(bannerStart >= 0, 'banner block exists')
  const bannerBlock = source.slice(bannerStart, bannerStart + 2200)
  assert.match(bannerBlock, /onClick=\{onClose\}/)
  assert.match(bannerBlock, /Cancel this import & choose Dated Reconciliation/)
  assert.match(bannerBlock, /onClick=\{\(\) => setDismissedDatedSignal\(true\)\}/)
  assert.match(bannerBlock, /No, this file is correct/)
})

await runTest("the banner surfaces the detector's own repeatedGroupCount and sampleProductName, not a canned message", () => {
  const bannerStart = source.indexOf('datedReconciliationSignal && !dismissedDatedSignal && step === 2')
  const bannerBlock = source.slice(bannerStart, bannerStart + 2200)
  assert.match(bannerBlock, /datedReconciliationSignal\.repeatedGroupCount/)
  assert.match(bannerBlock, /datedReconciliationSignal\.sampleProductName/)
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('\nAll importModeDetectionWiring tests passed')
}
