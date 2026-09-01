import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyCreateMatches, type CreateMatchCandidate } from '../src/components/products/helpers/productCreateMatch.ts'

let failed = 0

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const rows: CreateMatchCandidate[] = [
  { id: 1, name: 'Aloe Vera Gel', barcode: '880123', selling_price_usd: 5.5 },
  { id: 2, name: 'Aloe Vera Gel', barcode: '880999', selling_price_usd: 6 },
  { id: 3, name: 'Rose Water Toner', barcode: '770001', selling_price_usd: 4 },
]

runTest('F1: same name + same barcode is an exact twin and cannot proceed as new', () => {
  const verdict = classifyCreateMatches({ name: 'aloe vera gel', barcode: '880123' }, rows)
  assert.equal(verdict.kind, 'exact_twin')
  assert.equal(verdict.allowProceedAsNew, false)
  assert.equal(verdict.primary?.id, 1)
  // the group's exact casing is reported, not the operator's typed casing
  assert.equal(verdict.canonicalName, 'Aloe Vera Gel')
})

runTest('F1: same name + different barcode joins the virtual same-name group', () => {
  const verdict = classifyCreateMatches({ name: '  ALOE  vera gel ', barcode: '111222' }, rows)
  assert.equal(verdict.kind, 'name_match')
  assert.equal(verdict.allowProceedAsNew, false)
  assert.equal(verdict.groupRows.length, 2)
  assert.equal(verdict.canonicalName, 'Aloe Vera Gel')
  // The added row is a peer in the same virtual name group; there is no
  // stored parent/child relationship or separate choice for this case.
  assert.match(verdict.beforeAfter.group, /2 rows/)
  assert.match(verdict.beforeAfter.group, /3 rows/)
  assert.equal(verdict.beforeAfter.asNew, '')
})

runTest('F1: price similarity is advisory only, flagged on a name match', () => {
  const withPrice = classifyCreateMatches({ name: 'Aloe Vera Gel', selling_price_usd: 5.5 }, rows)
  assert.equal(withPrice.kind, 'name_match')
  assert.equal(withPrice.priceMatches, true)
  const differentPrice = classifyCreateMatches({ name: 'Aloe Vera Gel', selling_price_usd: 9.99 }, rows)
  assert.equal(differentPrice.priceMatches, false)
  // Price is advisory; the same normalized name still joins its group.
  assert.equal(withPrice.allowProceedAsNew, false)
})

runTest('F1: different name + same barcode is a barcode match, legal but flagged', () => {
  const verdict = classifyCreateMatches({ name: 'Brand New Serum', barcode: '770001' }, rows)
  assert.equal(verdict.kind, 'barcode_match')
  assert.equal(verdict.allowProceedAsNew, true)
  assert.equal(verdict.primary?.id, 3)
  assert.equal(verdict.canonicalName, 'Rose Water Toner')
  assert.match(verdict.beforeAfter.asNew, /770001/)
})

runTest('F1: nothing matching (or nothing typed) raises no verdict', () => {
  assert.equal(classifyCreateMatches({ name: 'Completely New', barcode: '000000' }, rows).kind, null)
  assert.equal(classifyCreateMatches({ name: '', barcode: '' }, rows).kind, null)
  assert.equal(classifyCreateMatches({}, []).kind, null)
})

const productFormSource = readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
const productsRouteSource = readFileSync(new URL('../../cloudflare/src/routes/products.ts', import.meta.url), 'utf8')

runTest('F1: ProductForm live-searches in create mode and gates submit on the verdict', () => {
  // the live search runs only for a NEW product and is debounced
  assert.match(productFormSource, /const isCreateMode = !product\?\.id/)
  assert.match(productFormSource, /classifyCreateMatches\(\{ name: form\.name, barcode: form\.barcode/)
  // the submit gate asks BEFORE saving, and 'back' aborts the save
  assert.match(productFormSource, /if \(isCreateMode && createVerdict\.kind\)/)
  assert.match(productFormSource, /const choice = await askCreateVerdict\(\)/)
  assert.match(productFormSource, /if \(choice === 'back'\) return/)
  // Grouping adopts the canonical spelling without storing a parent/child link.
  assert.match(productFormSource, /if \(choice === 'group' && createVerdict\.canonicalName\)/)
  // the inline panel and the modal both exist
  assert.match(productFormSource, /create_match_twin_hint/)
  assert.match(productFormSource, /create_match_group_button/)
  // 'proceed as new' is withheld for an exact twin
  assert.match(productFormSource, /\{createVerdict\.allowProceedAsNew \? \(/)
})

runTest('P7-b: scientific-notation barcodes are refused on the manual form (client)', () => {
  // the same rule productImportPlanner applies (barcode_scientific_notation)
  assert.match(productFormSource, /\^\[\+-\]\?\\d\+\(\?:\\\.\\d\+\)\?e\[\+-\]\?\\d\+\$/)
  assert.match(productFormSource, /barcode_scientific_notation_alert/)
})

runTest('P7-b: scientific-notation barcodes are refused server-side with a 400', () => {
  assert.match(productsRouteSource, /const SCIENTIFIC_NOTATION_BARCODE = \/\^\[\+-\]\?\\d\+\(\?:\\\.\\d\+\)\?e\[\+-\]\?\\d\+\$\/i/)
  assert.match(productsRouteSource, /code: 'barcode_scientific_notation'/)
  // both doors: create and update
  assert.match(productsRouteSource, /SCIENTIFIC_NOTATION_BARCODE\.test\(createBarcode\)/)
  assert.match(productsRouteSource, /SCIENTIFIC_NOTATION_BARCODE\.test\(nextBarcodeText\)/)
  // refused as a 400 before the duplicate/identity checks run
  assert.match(productsRouteSource, /scientificBarcodeError\(createBarcode\), 400/)
  assert.match(productsRouteSource, /scientificBarcodeError\(nextBarcodeText\), 400/)
})

if (failed > 0) {
  process.exitCode = 1
}
