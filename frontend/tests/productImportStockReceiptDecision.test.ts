// A product-import row the server reads as a stock receipt waits for an
// explicit decision on every surface that can approve the import, using the
// warning kinds the Worker's approval gate counts.
//
// Run: node tests/productImportStockReceiptDecision.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const frontend = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const repo = path.dirname(frontend)
const read = (...parts: string[]): string => fs.readFileSync(path.join(...parts), 'utf8')

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

const importDir = path.join(frontend, 'src', 'components', 'products', 'import')
const screen = read(importDir, 'ProductServerImportReviewScreen.tsx')
const conflicts = read(importDir, 'ProductImportConflictsModal.tsx')
const kindsFile = path.join(importDir, 'productImportReviewKinds.ts')
const loadKinds = async () => {
  assert.ok(fs.existsSync(kindsFile), 'the decision-kind list lives in one shared module')
  return import(pathToFileURL(kindsFile).href)
}

await runTest('a stock_receipt row needs a decision; routine warnings do not', async () => {
  const { productRowNeedsDecision, productRowIsStockReceipt } = await loadKinds()
  const receipt = { warnings: [{ kind: 'stock_receipt', message: 'Adds 5 to Shop as a new stock receipt' }] }
  assert.equal(productRowNeedsDecision(receipt), true)
  assert.equal(productRowIsStockReceipt(receipt), true)
  for (const kind of ['negative_stock', 'barcode_collision', 'sku_collision']) {
    assert.equal(productRowNeedsDecision({ warnings: [{ kind }] }), true, kind)
    assert.equal(productRowIsStockReceipt({ warnings: [{ kind }] }), false, kind)
  }
  for (const kind of ['cost_outlier', 'unreadable_batch_date', 'other']) {
    assert.equal(productRowNeedsDecision({ warnings: [{ kind }] }), false, kind)
  }
  assert.equal(productRowNeedsDecision({}), false)
})

await runTest('the kinds are exactly the ones the Worker approval gate counts', async () => {
  const { PRODUCT_DECISION_WARNING_KINDS } = await loadKinds()
  const worker = read(repo, 'cloudflare', 'src', 'lib', 'importReviewQuery.ts')
  const match = worker.match(/PRODUCT_REVIEW_WARNING_KINDS: ImportWarningKind\[\] = \[([^\]]*)\]/)
  assert.ok(match, 'PRODUCT_REVIEW_WARNING_KINDS is still declared in importReviewQuery.ts')
  const workerKinds = [...match[1].matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1])
  assert.deepEqual([...PRODUCT_DECISION_WARNING_KINDS].sort(), workerKinds.sort())
})

await runTest('keeping the stock is the server\'s fields-only mode', async () => {
  const { KEEP_STOCK_DECISION, isKeepStockDecision } = await loadKinds()
  assert.deepEqual(KEEP_STOCK_DECISION, { action: 'apply', field_overrides: { _action: 'override_replace' } })
  assert.equal(isKeepStockDecision(KEEP_STOCK_DECISION), true)
  assert.equal(isKeepStockDecision({ action: 'apply' }), false)
  assert.equal(isKeepStockDecision({ action: 'skip' }), false)
  const engine = read(repo, 'cloudflare', 'src', 'lib', 'importEngine.ts').replace(/\r\n/g, '\n')
  const branch = engine.slice(engine.indexOf("if (mode === 'override_replace') {"), engine.indexOf("} else if (mode === 'merge_stock' || mode === 'override_add') {"))
  assert.ok(branch.length > 0, 'the override_replace branch still exists in runImportApply')
  assert.doesNotMatch(branch, /branch_stock|inventory_movements|product_batches/, 'override_replace writes no stock')
})

await runTest('the review screen holds a stock_receipt row at "needs a decision" (no auto-approve past it)', () => {
  const choiceFor = screen.slice(screen.indexOf('function choiceFor('), screen.indexOf('function decisionFor('))
  assert.match(choiceFor, /productRowNeedsDecision\(row\)/, 'choiceFor reads the shared list')
  assert.doesNotMatch(choiceFor, /'negative_stock', 'barcode_collision', 'sku_collision'\]/, 'no private copy of the kind list')
  assert.match(screen, /tr\('product_import_stock_receipt_hint'/, 'the unresolved banner explains a stock receipt row')
})

await runTest('the tracker\'s conflicts modal lists stock_receipt rows and offers add or keep', () => {
  assert.match(conflicts, /const WARNING_KINDS = PRODUCT_DECISION_WARNING_KINDS\.join\(','\)/, 'a receipt row counted by the gate must be listed, or the modal traps the operator')
  assert.match(conflicts, /productRowIsStockReceipt\(row\)/)
  assert.match(conflicts, /decide\(row\.rowNumber, KEEP_STOCK_DECISION\)/)
  for (const key of ['products_import_conflicts_add_stock', 'products_import_conflicts_keep_stock', 'product_import_stock_receipt_hint']) {
    assert.match(conflicts, new RegExp(`tr\\('${key}'`), `${key} is looked up`)
  }
})

await runTest('both packs carry the new keys, the Khmer ones really translated', () => {
  const en = JSON.parse(read(frontend, 'src', 'lang', 'en.json'))
  const km = JSON.parse(read(frontend, 'src', 'lang', 'km.json'))
  const expected: Record<string, string> = {
    product_import_stock_receipt_hint: 'A stock receipt row adds its quantity to stock. Choose to add it, or to update the details and keep the stock.',
    products_import_conflicts_add_stock: 'Add stock',
    products_import_conflicts_keep_stock: 'Keep stock',
    import_warning_kind_stock_receipt: 'Stock receipt row (add or keep stock, decided per row)',
  }
  for (const [key, english] of Object.entries(expected)) {
    assert.equal(en[key], english, `en.json ${key}`)
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.notEqual(km[key], en[key], `km.json ${key} is still English`)
    assert.match(km[key], /[ក-៿]/, `km.json ${key} carries no Khmer script`)
  }
  assert.equal(km.products_import_conflicts_add_stock, km.add_stock, 'Add stock reads the same as everywhere else in the app')
})

await runTest('the import report names a stock_receipt row in the reader\'s language, under needs attention', async () => {
  const { PRODUCT_DECISION_WARNING_KINDS } = await loadKinds()
  const report = read(frontend, 'src', 'components', 'shared', 'ImportReportModal.tsx')
  assert.match(report, /stock_receipt: 'import_warning_kind_stock_receipt'/, 'without the key a Khmer reader sees the Worker\'s English label')
  const seriousList = report.match(/const SERIOUS_KINDS = new Set\(\[([^\]]+)\]\)/)
  assert.ok(seriousList, 'SERIOUS_KINDS is still declared in ImportReportModal.tsx')
  const serious = [...seriousList[1].matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1])
  for (const kind of PRODUCT_DECISION_WARNING_KINDS) assert.ok(serious.includes(kind), `${kind} held the import for a decision, so the report lists it under needs attention`)
  const engine = read(repo, 'cloudflare', 'src', 'lib', 'importEngine.ts')
  const workerLabel = engine.match(/\n\s*stock_receipt: '([^']+)',/)
  assert.ok(workerLabel, 'IMPORT_WARNING_LABELS carries stock_receipt')
  const en = JSON.parse(read(frontend, 'src', 'lang', 'en.json'))
  assert.equal(en.import_warning_kind_stock_receipt, workerLabel[1], 'the English pack reads like the Worker label it replaces')
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} stock-receipt decision test(s) failed`)
} else {
  console.log('\nAll product-import stock-receipt decision tests passed')
}
