import assert from 'node:assert/strict'
import fs from 'node:fs'
import { shouldPromptConflictReviewBeforeApprove } from '../src/components/shared/importJobApproveGate.ts'

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

await runTest('a contacts job with unresolved warned rows, not yet reviewed, prompts', () => {
  const job = { type: 'customers', summary: { warned: 3 } }
  assert.equal(shouldPromptConflictReviewBeforeApprove(job, new Set(), 'job-1'), true)
})

await runTest('the same job does not prompt again once its id is in reviewedJobIds', () => {
  const job = { type: 'customers', summary: { warned: 3 } }
  assert.equal(shouldPromptConflictReviewBeforeApprove(job, new Set(['job-1']), 'job-1'), false)
})

await runTest('a contacts job with zero warned rows never prompts', () => {
  const job = { type: 'suppliers', summary: { warned: 0 } }
  assert.equal(shouldPromptConflictReviewBeforeApprove(job, new Set(), 'job-2'), false)
})

await runTest('a job with no summary at all never prompts (warned defaults to 0)', () => {
  const job = { type: 'delivery_contacts' }
  assert.equal(shouldPromptConflictReviewBeforeApprove(job, new Set(), 'job-3'), false)
})

await runTest('a non-contacts job type never prompts, even with warned rows', () => {
  const job = { type: 'products', summary: { warned: 5 } }
  assert.equal(shouldPromptConflictReviewBeforeApprove(job, new Set(), 'job-4'), false)
})

await runTest('all three contact job types are covered', () => {
  for (const type of ['customers', 'suppliers', 'delivery_contacts']) {
    const job = { type, summary: { warned: 1 } }
    assert.equal(shouldPromptConflictReviewBeforeApprove(job, new Set(), `job-${type}`), true, type)
  }
})

await runTest('reviewedJobIds is keyed by job id, not job type -- a different job of the same type still prompts', () => {
  const job = { type: 'customers', summary: { warned: 1 } }
  assert.equal(shouldPromptConflictReviewBeforeApprove(job, new Set(['job-1']), 'job-2'), true)
})

await runTest('products have NO client pre-gate -- the tracker reacts to the server 409 code instead', () => {
  // The old warned>0 pre-gate bounced fully-resolved hub jobs into the
  // conflicts modal for nothing; the server's product_conflicts_unresolved
  // 409 is the one authority now. Pin both halves of that contract.
  const gate = fs.readFileSync(new URL('../src/components/shared/importJobApproveGate.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(gate, /shouldPromptProductConflictReviewBeforeApprove/)
  const tracker = fs.readFileSync(new URL('../src/components/shared/BackgroundImportTracker.tsx', import.meta.url), 'utf8')
  assert.match(tracker, /code === 'product_conflicts_unresolved'/)
  assert.match(tracker, /setProductConflictsJobId\(jobId\)/)
  assert.match(tracker, /if \(job\) void handleApprove\(job\)/, 'resolving every conflict re-fires the interrupted approve')
})

await runTest('the tracker approve carries the stock confirm flag so hub stock jobs cannot dead-end on the 409', () => {
  const tracker = fs.readFileSync(new URL('../src/components/shared/BackgroundImportTracker.tsx', import.meta.url), 'utf8')
  assert.match(tracker, /=== 'stock_actions' \? \{ confirmStockActions: true \} : undefined/)
})

await runTest('the product resolver persists explicit apply/skip decisions and exposes their consequence', () => {
  const source = fs.readFileSync(new URL('../src/components/products/import/ProductImportConflictsModal.tsx', import.meta.url), 'utf8')
  assert.match(source, /WARNING_KINDS = 'negative_stock,barcode_collision,sku_collision'/)
  assert.match(source, /updateImportJobDecisions\(jobId, \{ \[String\(rowNumber\)\]: \{ action \} \}\)/)
  assert.match(source, /Use safe result[\s\S]*colliding identifier stays a separate product[\s\S]*negative stock becomes 0/)
  assert.match(source, /unresolvedProductConflicts/)
})

await runTest('the products modal uses one persisted server review instead of advancing after local parsing', () => {
  const modal = fs.readFileSync(new URL('../src/components/products/import/BulkImportModal.tsx', import.meta.url), 'utf8')
  const screen = fs.readFileSync(new URL('../src/components/products/import/ProductServerImportReviewScreen.tsx', import.meta.url), 'utf8')
  const analyzeBody = modal.slice(modal.indexOf('const analyzePickedCsv'), modal.indexOf('const handlePickCSV'))
  assert.doesNotMatch(analyzeBody, /setStep\(2\)/)
  assert.match(modal, /buildCsvForServerReview/)
  assert.match(modal, /Object\.entries\(row \|\| \{\}\)\.filter\(\(\[key\]\) => !key\.startsWith\('_'\)\)/)
  assert.match(modal, /<ProductServerImportReviewScreen/)
  assert.match(screen, /getImportJobReview\(jobId, \{ page, pageSize: PAGE_SIZE/)
  assert.match(screen, /updateImportJobDecisions\(jobId, \{ \[String\(row\.rowNumber\)\]: decisionFor\(choice\) \}\)/)
  assert.match(screen, /approveImportJob\(jobId, \{ source: 'products_modal' \}\)/)
})

await runTest('serious product warnings require a visible durable choice and approval is fail-closed', () => {
  const screen = fs.readFileSync(new URL('../src/components/products/import/ProductServerImportReviewScreen.tsx', import.meta.url), 'utf8')
  assert.match(screen, /\['negative_stock', 'barcode_collision', 'sku_collision'\]/)
  assert.match(screen, /if \(needsDecision && !row\.decision\) return 'needs_decision'/)
  assert.match(screen, /disabled=\{approving \|\| loadingRows \|\| unresolved > 0\}/)
  assert.match(screen, /onCancel/)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
