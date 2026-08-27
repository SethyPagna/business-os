import assert from 'node:assert/strict'
import fs from 'node:fs'
import { shouldPromptConflictReviewBeforeApprove, shouldPromptProductConflictReviewBeforeApprove } from '../src/components/shared/importJobApproveGate.ts'

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

await runTest('a warned products job prompts until its server conflicts are resolved', () => {
  const job = { type: 'products', summary: { warned: 2 } }
  assert.equal(shouldPromptProductConflictReviewBeforeApprove(job, new Set(), 'product-1'), true)
  assert.equal(shouldPromptProductConflictReviewBeforeApprove(job, new Set(['product-1']), 'product-1'), false)
})

await runTest('product prompting never captures other job types or clean products', () => {
  assert.equal(shouldPromptProductConflictReviewBeforeApprove({ type: 'sales', summary: { warned: 2 } }, new Set(), 'sale-1'), false)
  assert.equal(shouldPromptProductConflictReviewBeforeApprove({ type: 'products', summary: { warned: 0 } }, new Set(), 'product-2'), false)
})

await runTest('the product resolver persists explicit apply/skip decisions and exposes their consequence', () => {
  const source = fs.readFileSync(new URL('../src/components/products/import/ProductImportConflictsModal.tsx', import.meta.url), 'utf8')
  assert.match(source, /WARNING_KINDS = 'negative_stock,barcode_collision,sku_collision'/)
  assert.match(source, /updateImportJobDecisions\(jobId, \{ \[String\(rowNumber\)\]: \{ action \} \}\)/)
  assert.match(source, /Use safe result[\s\S]*colliding identifier stays a separate product[\s\S]*negative stock becomes 0/)
  assert.match(source, /unresolvedProductConflicts/)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
