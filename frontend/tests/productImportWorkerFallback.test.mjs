import assert from 'node:assert/strict'
import fs from 'node:fs'
import { analyzeProductImportText } from '../src/components/products/import/productImportPlanner.mjs'

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

await runTest('product import worker fallback keeps analysis deterministic', () => {
  const analysis = analyzeProductImportText('name,sku,selling_price_usd,stock_quantity\nSerum,S-1,12,3', [])
  assert.equal(analysis.summary.total, 1)
  assert.equal(analysis.rows[0]._planned_action, 'new')
})

await runTest('bulk product import worker has timeout and sync fallback guardrails', () => {
  const source = fs.readFileSync(new URL('../src/components/products/import/BulkImportModal.jsx', import.meta.url), 'utf8')
  assert.match(source, /const PRODUCT_IMPORT_ANALYSIS_TIMEOUT_MS = 60000/)
  assert.match(source, /const runFallbackAnalysis = \(\) => \{[\s\S]*return analyzeProductImportText\(text, existingProducts\)/)
  assert.match(source, /let worker = null/)
  assert.match(source, /worker = new Worker\(new URL\('\.\/productImportWorker\.mjs', import\.meta\.url\), \{ type: 'module' \}\)/)
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*Import analysis worker timed out[\s\S]*PRODUCT_IMPORT_ANALYSIS_TIMEOUT_MS/)
  assert.match(source, /worker\.onerror = \(error\) => \{[\s\S]*runFallback\(new Error\(error\?\.message \|\| 'Import analysis worker failed'\)\)/)
  assert.match(source, /try \{[\s\S]*worker = new Worker[\s\S]*worker\.postMessage\(\{ id, text, existingProducts \}\)[\s\S]*\} catch \(error\) \{[\s\S]*runFallback\(error\)/)
  assert.match(source, /clearTimeout\(timeoutId\)/)
  assert.match(source, /worker\?\.terminate\(\)/)
  assert.match(source, /worker = null/)
})

if (failed > 0) {
  process.exitCode = 1
}
