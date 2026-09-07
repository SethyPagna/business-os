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
const inventoryRoute = fs.readFileSync(new URL('../../cloudflare/src/routes/inventory.ts', import.meta.url), 'utf8')

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

await runTest('the suggestion banner renders on Screen 1 before upload, and only when not dismissed', () => {
  assert.match(source, /\{datedReconciliationSignal && !dismissedDatedSignal && step === 1 \? \(/)
})

// The banner block, bounded exactly -- from its own condition to the next
// Screen-1 block -- so an assertion about "no onClick={onClose} here" cannot
// accidentally read a neighbouring control.
function bannerBlockOf(src: string): string {
  const start = src.indexOf('datedReconciliationSignal && !dismissedDatedSignal && step === 1')
  assert.ok(start >= 0, 'banner block exists')
  const end = src.indexOf("{step === 1 && mode === 'products' ?", start)
  assert.ok(end > start, 'banner block ends before the Screen 1 upload card')
  return src.slice(start, end)
}

// The import-review audit's finding: this button PROMISED the Dated
// Reconciliation importer and was wired to onClose alone, so the live Worker
// routes behind it (routes/inventory.ts POST /dated-stock-count/resolve,
// /resolve/apply-decisions, /preview, /apply) had no client at all -- the
// only component that speaks them, DatedStockReconciliationModal.tsx, had
// zero importers anywhere in the frontend. Cancelling an import is not
// choosing a mode; the button now opens the importer it names.
await runTest('the banner action opens the Dated Reconciliation importer rather than only cancelling this import', () => {
  const bannerBlock = bannerBlockOf(source)
  assert.doesNotMatch(bannerBlock, /onClick=\{onClose\}/, 'closing this modal is not "choosing Dated Reconciliation"')
  assert.doesNotMatch(bannerBlock, /Cancel this import & choose Dated Reconciliation/, 'the old label promised a destination it never reached')
  assert.match(bannerBlock, /setDatedReconciliationOpen\(true\)/)
  assert.match(bannerBlock, /Open the Dated Reconciliation import/)
  assert.match(bannerBlock, /onClick=\{\(\) => setDismissedDatedSignal\(true\)\}/)
  assert.match(bannerBlock, /No, this file is correct/)
})

await runTest('BulkImportModal actually mounts DatedStockReconciliationModal, so those Worker routes have a client', () => {
  assert.match(
    source,
    /const DatedStockReconciliationModal = lazyRetry\(\(\) => import\('\.\/DatedStockReconciliationModal'\), 'products-dated-stock-reconciliation'\)/,
    'a 600-line flow only the dated-count shape reaches must not ride along in the bulk-import chunk',
  )
  assert.match(source, /import \{ lazyRetry \} from '\.\.\/\.\.\/\.\.\/utils\/lazyImport\.ts'/)
  assert.match(source, /const \[datedReconciliationOpen, setDatedReconciliationOpen\] = useState\(false\)/)
  // Swapped, not stacked: one dialog on screen at a time, so the
  // importer's own Back still reads as "back inside that flow" rather
  // than fighting a second modal's backdrop underneath it.
  assert.match(source, /if \(datedReconciliationOpen\) \{\s*return \(\s*<Suspense fallback=\{null\}>\s*<DatedStockReconciliationModal/)
  assert.match(source, /import \{ Suspense, useMemo, useRef, useState \} from 'react'/)
})

await runTest('the mounted importer gets the translator and the product list its review step needs', () => {
  const start = source.indexOf('<DatedStockReconciliationModal')
  assert.ok(start >= 0)
  const block = source.slice(start, source.indexOf('/>', start))
  // Its t is (key, fallback?, km?); this modal's T is (key, fallback) and
  // is not assignable as-is, so the adapter is what carries the packs in.
  assert.match(block, /t=\{\(key: string, fallback\?: string\) => T\(key, fallback \?\? key\)\}/, 'without a translator every label falls back to English')
  assert.match(block, /products=\{products\}/, 'its unresolved-row picker labels candidates "#123" without this')
  assert.match(block, /setDatedReconciliationOpen\(false\)/)
  assert.match(block, /onDone=\{/)
  // Backing out returns to this file's analysis; once a reconciliation has
  // actually been applied there is nothing to come back to.
  assert.match(block, /if \(datedReconciliationApplied\) onClose\(\)/)
  assert.match(source, /const \[datedReconciliationApplied, setDatedReconciliationApplied\] = useState\(false\)/)
})

// The owner's import preference is one fast client-side review, then apply
// directly. The reconciliation flow is an ALTERNATIVE for the dated-count
// file shape, never a second mandatory review bolted onto the ordinary
// import -- so the only thing that may open it is the detector's own banner.
await runTest('the importer is reachable only from the dated-count signal, never as a second mandatory review step', () => {
  const opens = [...source.matchAll(/setDatedReconciliationOpen\(true\)/g)]
  assert.equal(opens.length, 1, 'exactly one place may open it')
  const bannerStart = source.indexOf('datedReconciliationSignal && !dismissedDatedSignal && step === 1')
  const bannerEnd = source.indexOf("{step === 1 && mode === 'products' ?", bannerStart)
  const at = opens[0].index ?? -1
  assert.ok(at > bannerStart && at < bannerEnd, 'the only opener sits inside the suggestion banner')
})

await runTest('ImportModeWizard forwards the product list it already receives from Products.tsx', () => {
  const wizard = fs.readFileSync(new URL('../src/components/products/import/ImportModeWizard.tsx', import.meta.url), 'utf8')
  assert.match(wizard, /export default function ImportModeWizard\(\{ onClose, onDone, t, products \}/, 'products was a declared-but-never-read prop')
  assert.match(wizard, /<BulkImportModal[^>]*products=\{products\}/)
})

// Root cause: T() at line ~1232 returns the PACK value whenever the key
// resolves, and 'dated_reconciliation_suggestion_body' resolves in both
// packs -- so a template-literal fallback built from the detector's own
// numbers is unreachable dead code; the operator always sees whatever
// static sentence lives in the pack. The real fix is placeholders in the
// pack text itself, filled in by .replace() after T() resolves.
await runTest("the banner surfaces the detector's own repeatedGroupCount and sampleProductName via placeholders, not a canned message", () => {
  const bannerBlock = bannerBlockOf(source)
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
  const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
  assert.match(en.dated_reconciliation_suggestion_body, /\{count\}/, 'en pack text must carry the {count} placeholder')
  assert.match(en.dated_reconciliation_suggestion_body, /\{name\}/, 'en pack text must carry the {name} placeholder')
  assert.match(km.dated_reconciliation_suggestion_body, /\{count\}/, 'km pack text must carry the {count} placeholder')
  assert.match(km.dated_reconciliation_suggestion_body, /\{name\}/, 'km pack text must carry the {name} placeholder')
  assert.match(bannerBlock, /\.replace\('\{count\}'/, 'the count placeholder must be filled from the detector result')
  assert.match(bannerBlock, /\.replace\('\{name\}'/, 'the name placeholder must be filled from the detector result')
  assert.doesNotMatch(
    source,
    /\$\{datedReconciliationSignal\.repeatedGroupCount\} product/,
    'the old template-literal fallback can never be reached once the key resolves in both packs, and must be deleted, not left as dead code',
  )
})

// The audit's finding: the banner (BulkImportModal.tsx) and the destination
// modal (DatedStockReconciliationModal.tsx, dated_stock_reconciliation_title)
// must name the same destination in the same language -- an English product
// name stitched into an otherwise-Khmer sentence, right below a button that
// already names the destination in Khmer, reads as two different places.
await runTest('the km suggestion body names its destination in Khmer, the same way the destination names itself', () => {
  const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
  assert.doesNotMatch(
    km.dated_reconciliation_suggestion_body,
    /Dated Stock Reconciliation/,
    'the km banner body must not carry the English destination name',
  )
  assert.ok(
    km.dated_reconciliation_suggestion_body.includes(km.dated_stock_reconciliation_title),
    'the km banner body must name the destination using the exact km title the destination itself uses',
  )
})

// The audit's finding: DatedStockReconciliationModal's own header comment
// documented a launch path (ImportModeWizard) that was never wired, and a
// Back behaviour ("closes the whole flow") that BulkImportModal's actual
// wiring (onClose -> setDatedReconciliationOpen(false), staying mounted on
// its own analysis) contradicts. The two files must not disagree in writing
// about the flow this lane shipped.
await runTest('DatedStockReconciliationModal documents its real launcher and Back semantics, not the old wizard design', () => {
  const dsrm = fs.readFileSync(
    new URL('../src/components/products/import/DatedStockReconciliationModal.tsx', import.meta.url),
    'utf8',
  )
  const header = dsrm.slice(0, dsrm.indexOf('\nimport'))
  assert.doesNotMatch(header, /Launched from ImportModeWizard/, 'that launch path does not exist')
  assert.match(header, /BulkImportModal/, 'the header must name its real launcher')
  // The same residue survived outside the header, in restartUpload's own
  // comment ("...is locked in from ImportModeWizard") -- the fake launch
  // path must not appear anywhere in the file, not just its top comment.
  assert.doesNotMatch(dsrm, /locked in from ImportModeWizard/, 'that launch path does not exist anywhere in the file')
})

// The audit's rule:F8 finding: on step === 'done' the footer rendered both a
// left "Cancel" button (calling onClose) and a right "Done" button (also
// calling onClose) -- a second close affordance alongside the shared Modal's
// own header X, the same defect this lane already removed from
// BulkImportModal.tsx:3001. The done screen must offer exactly one action.
await runTest('DatedStockReconciliationModal done step has no reachable Cancel button', () => {
  const dsrm = fs.readFileSync(
    new URL('../src/components/products/import/DatedStockReconciliationModal.tsx', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(
    dsrm,
    /step === 'upload' \|\| step === 'done' \? T\('cancel'/,
    'the done step must not resolve the left button to Cancel',
  )
})

// The audit's finding: this banner button is the ONLY door into a flow whose
// every Worker route (routes/inventory.ts:1851/1881/1904/1919) refuses
// anyone below Full Access on inventory/stock_count, and nothing on the
// client checked that -- an operator without the permission could click the
// button, walk the whole importer, and only 403 at the very end. can()
// mirrors the exact route guard (permissionActions.ts:136 declares
// stock_count with review:'block', so can() is true only at the 'full'
// tier), and the button must be disabled -- not hidden -- with a real
// explanation, per this file's own precedent at the replace-mode notice.
await runTest('the banner action is gated by the same permission the Worker routes require, disabled not hidden', () => {
  const bannerBlock = bannerBlockOf(source)
  assert.match(bannerBlock, /disabled=\{!canDatedStockCount\}/, 'the open button must be disabled when the permission is missing')
  assert.match(bannerBlock, /dated_reconciliation_permission_required/, 'a real explanation must sit under the disabled button')
  assert.match(source, /const canDatedStockCount = can\('inventory', 'stock_count'\)/, 'the check must mirror routes/inventory.ts\'s getActionTier(user, \'inventory\', \'stock_count\') guard')
  const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
  const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))
  assert.ok(en.dated_reconciliation_permission_required, 'en pack must carry the new key')
  assert.ok(km.dated_reconciliation_permission_required, 'km pack must carry the new key')
  assert.notEqual(km.dated_reconciliation_permission_required, en.dated_reconciliation_permission_required, 'km must not just copy the English text')
  assert.match(km.dated_reconciliation_permission_required, /[ក-៿]/, 'km pack value must actually be Khmer script')
})

await runTest('all four Worker endpoints enforce the exact stock_count full-access tier mirrored by the client', () => {
  const paths = [
    '/dated-stock-count/resolve',
    '/dated-stock-count/resolve/apply-decisions',
    '/dated-stock-count/preview',
    '/dated-stock-count/apply',
  ]
  for (let index = 0; index < paths.length; index += 1) {
    const start = inventoryRoute.indexOf(`app.post('${paths[index]}'`)
    assert.ok(start >= 0, `Worker route exists: ${paths[index]}`)
    const next = index + 1 < paths.length
      ? inventoryRoute.indexOf(`app.post('${paths[index + 1]}'`, start + 1)
      : inventoryRoute.indexOf("app.post('/transfer'", start + 1)
    const block = inventoryRoute.slice(start, next)
    assert.match(
      block,
      /getActionTier\(user, 'inventory', 'stock_count'\) !== 'full'/,
      `${paths[index]} must refuse every tier below the client's can('inventory', 'stock_count') result`,
    )
    assert.match(block, /, 403\)/, `${paths[index]} must return an authorization refusal`)
  }
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('\nAll importModeDetectionWiring tests passed')
}
