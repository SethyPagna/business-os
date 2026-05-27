import assert from 'node:assert/strict'
import fs from 'node:fs'
import { countCsvDataRows } from '../src/utils/csvRowCounter.ts'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('shared CSV row counter handles sales rows and quoted notes', () => {
  assert.equal(countCsvDataRows('receipt,product,quantity\nR-1,Serum,1\nR-2,Toner,2'), 2)
  assert.equal(countCsvDataRows('receipt,notes\nR-1,"line 1\nline 2"\nR-2,ok'), 2)
  assert.equal(countCsvDataRows('receipt,product\n\n'), 0)
})

await runTest('sales import modal analyzes rows in a worker with a sync fallback', () => {
  const source = fs.readFileSync(new URL('../src/components/sales/SalesImportModal.jsx', import.meta.url), 'utf8')
  const worker = fs.readFileSync(new URL('../src/components/sales/salesImportWorker.ts', import.meta.url), 'utf8')
  assert.match(source, /new Worker\(new URL\('\.\/salesImportWorker\.mjs', import\.meta\.url\), \{ type: 'module' \}\)/)
  assert.match(source, /typeof Worker === 'undefined'[\s\S]*Promise\.resolve\(countCsvDataRows\(text\)\)/)
  assert.match(source, /SALES_IMPORT_ROW_COUNT_TIMEOUT_MS = 5000/)
  assert.match(source, /catch \(_\) \{[\s\S]*nextCount = countCsvDataRows\(nextText\)/)
  assert.match(source, /rowCountRequestRef/, 'stale worker results should not overwrite newer sales CSV text')
  assert.match(source, /disabled=\{loading \|\| analyzingCsv \|\| !String\(csvText \|\| ''\)\.trim\(\)\}/)
  assert.match(worker, /countCsvDataRows\(text\)/)
})

if (failed > 0) {
  process.exitCode = 1
}
