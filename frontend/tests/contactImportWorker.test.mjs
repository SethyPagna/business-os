import assert from 'node:assert/strict'
import fs from 'node:fs'
import { countCsvDataRows } from '../src/components/contacts/contactImportParser.mjs'

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

await runTest('contact import row counter handles quoted newlines and empty files', () => {
  assert.equal(countCsvDataRows('name,phone\nAlice,1\nBob,2'), 2)
  assert.equal(countCsvDataRows('name,notes\n"Alice","line 1\nline 2"\nBob,ok'), 2)
  assert.equal(countCsvDataRows('name,phone\n\n'), 0)
  assert.equal(countCsvDataRows(''), 0)
})

await runTest('contact import modal analyzes rows in a worker with a sync fallback', () => {
  const source = fs.readFileSync(new URL('../src/components/contacts/ContactImportModal.jsx', import.meta.url), 'utf8')
  const worker = fs.readFileSync(new URL('../src/components/contacts/contactImportWorker.ts', import.meta.url), 'utf8')
  assert.match(source, /new Worker\(new URL\('\.\/contactImportWorker\.mjs', import\.meta\.url\), \{ type: 'module' \}\)/)
  assert.match(source, /typeof Worker === 'undefined'[\s\S]*Promise\.resolve\(countCsvDataRows\(text\)\)/)
  assert.match(source, /CONTACT_IMPORT_ROW_COUNT_TIMEOUT_MS = 5000/)
  assert.match(source, /catch \(_\) \{[\s\S]*nextCount = countCsvDataRows\(nextText\)/)
  assert.match(source, /rowCountRequestRef/, 'stale worker results should not overwrite newer file choices')
  assert.match(worker, /countCsvDataRows\(text\)/)
})

if (failed > 0) {
  process.exitCode = 1
}
