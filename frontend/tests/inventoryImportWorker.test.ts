import assert from 'node:assert/strict'
import fs from 'node:fs'
import { countCsvDataRows } from '../src/utils/csvRowCounter.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('shared CSV row counter handles inventory rows and quoted notes', () => {
  assert.equal(countCsvDataRows('product,action,quantity\nSerum,add,3\nToner,set,5'), 2)
  assert.equal(countCsvDataRows('product,notes\nSerum,"line 1\nline 2"\nToner,ok'), 2)
  assert.equal(countCsvDataRows('product,action\n\n'), 0)
})

await runTest('inventory import modal analyzes rows in a worker with a sync fallback', () => {
  const source = fs.readFileSync(new URL('../src/components/inventory/InventoryImportModal.tsx', import.meta.url), 'utf8')
  const worker = fs.readFileSync(new URL('../src/components/inventory/inventoryImportWorker.ts', import.meta.url), 'utf8')
  assert.match(source, /new Worker\(new URL\('\.\/inventoryImportWorker\.ts', import\.meta\.url\), \{ type: 'module' \}\)/)
  assert.match(source, /typeof Worker === 'undefined'[\s\S]*Promise\.resolve\(countCsvDataRows\(text\)\)/)
  assert.match(source, /INVENTORY_IMPORT_ROW_COUNT_TIMEOUT_MS = 5000/)
  assert.match(source, /catch \(_\) \{[\s\S]*nextCount = countCsvDataRows\(nextText\)/)
  assert.match(source, /rowCountRequestRef/, 'stale worker results should not overwrite newer inventory CSV text')
  assert.match(source, /disabled=\{loading \|\| analyzingCsv \|\| !String\(csvText \|\| ''\)\.trim\(\)\}/)
  assert.match(worker, /countCsvDataRows\(text\)/)
})

await runTest('inventory import stays in-modal for authoritative Screen 2 review and confirmation', () => {
  const source = fs.readFileSync(new URL('../src/components/inventory/InventoryImportModal.tsx', import.meta.url), 'utf8')
  const review = fs.readFileSync(new URL('../src/components/imports/ServerImportReviewScreen.tsx', import.meta.url), 'utf8')
  assert.match(source, /setReviewJob\(\{ id: job\.id as string \| number, rowCount \}\)/)
  assert.match(source, /<ServerImportReviewScreen/)
  assert.match(review, /getImportJobReview\(jobId/)
  assert.match(review, /pageSize: PAGE_SIZE/)
  assert.match(review, /Confirm & import/)
  assert.match(review, /approveImportJob\(jobId/)
  assert.doesNotMatch(source, /Review and approve it from the top progress bar/)
})

if (failed > 0) {
  process.exitCode = 1
}
