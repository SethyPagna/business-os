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
  { id: 1, name: 'Aloe Vera Gel', barcode: '880123', selling_price_usd: 5.5, cost_price_usd: 2 },
  { id: 2, name: 'Aloe Vera Gel', barcode: '880999', selling_price_usd: 6, cost_price_usd: 2.5 },
  { id: 3, name: 'Rose Water Toner', barcode: '770001', selling_price_usd: 4 },
  { id: 4, name: 'Zero Code Balm', barcode: '000', selling_price_usd: 1 },
]

runTest('F1: same name + same barcode is an exact twin and cannot proceed as new', () => {
  const verdict = classifyCreateMatches({ name: 'aloe vera gel', barcode: '880123', cost_price_usd: 2 }, rows)
  assert.equal(verdict.kind, 'exact_twin')
  assert.equal(verdict.allowProceedAsNew, false)
  assert.equal(verdict.primary?.id, 1)
  // the group's exact casing is reported, not the operator's typed casing
  assert.equal(verdict.canonicalName, 'Aloe Vera Gel')
})

// N15 (repair): the client half of the create guard must ask THE SAME question
// the server's findSameProductIdentityProduct asks -- name group + the barcode
// folded past leading zeros, and NO cost. It used to compare the raw barcode
// and require equal cost, so the form promised "saving adds this as a new row"
// and the POST then 409'd into a bare alert. Both halves of this case fail on
// the old classifier: '0880123' was not '880123', and cost 3 was not cost 2.
runTest('N15: a zero-padded barcode is the same identity, and cost never splits it', () => {
  const padded = classifyCreateMatches({ name: 'Aloe Vera Gel', barcode: '0880123', cost_price_usd: 3 }, rows)
  assert.equal(padded.kind, 'exact_twin')
  assert.equal(padded.primary?.id, 1)
  assert.equal(padded.allowProceedAsNew, false)

  // cost alone never makes a second row (the Sep-4 ruling: only a different
  // barcode mints a child row), with the barcode typed exactly as stored.
  const costOnly = classifyCreateMatches({ name: 'Aloe Vera Gel', barcode: '880123', cost_price_usd: 3 }, rows)
  assert.equal(costOnly.kind, 'exact_twin')
  assert.equal(costOnly.primary?.id, 1)

  // the fold reaches the different-name barcode flag too
  const otherName = classifyCreateMatches({ name: 'Brand New Serum', barcode: '0770001' }, rows)
  assert.equal(otherName.kind, 'barcode_match')
  assert.equal(otherName.primary?.id, 3)
})

runTest('N15/Sep-15-2026: an all-zero barcode is BROKEN, so it wildcards onto the name-group row', () => {
  // '000' is all-zero -> BROKEN under isRealBarcode (not a real barcode at
  // all), same as '0', '00' and '' -- every one of them is a wildcard within
  // the 'Zero Code Balm' name group (whose only row, id 4, is ALSO broken:
  // '000'), so all four typed spellings are the SAME identity as id 4 per
  // the Sep 15 2026 ruling ("if both is empty merge into one empty").
  for (const barcode of ['000', '0', '00', '']) {
    const verdict = classifyCreateMatches({ name: 'Zero Code Balm', barcode }, rows)
    assert.equal(verdict.kind, 'exact_twin', `barcode=${JSON.stringify(barcode)}`)
    assert.equal(verdict.primary?.id, 4, `barcode=${JSON.stringify(barcode)}`)
  }
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
  // A REAL but genuinely different barcode from both existing rows keeps
  // this a name_match (not a wildcard) so price similarity stays advisory.
  const withPrice = classifyCreateMatches({ name: 'Aloe Vera Gel', barcode: '881777', selling_price_usd: 5.5 }, rows)
  assert.equal(withPrice.kind, 'name_match')
  assert.equal(withPrice.priceMatches, true)
  const differentPrice = classifyCreateMatches({ name: 'Aloe Vera Gel', barcode: '881777', selling_price_usd: 9.99 }, rows)
  assert.equal(differentPrice.priceMatches, false)
  // Price is advisory; the same normalized name still joins its group.
  assert.equal(withPrice.allowProceedAsNew, false)
})

runTest('Sep-15-2026: no barcode typed against a 2-distinct-real-barcode name group is an exact twin of the ranked winner, not a fresh name_match', () => {
  // Neither typed barcode is real (both undefined/broken), so the wildcard
  // rule attaches to the SAME single ranked winner clusterRowsByBarcodeIdentity
  // would pick (id 1: tied on stock -- this candidate shape carries none --
  // so the lower id wins), never leaving this as an open name_match that
  // would let two rows silently share one broken identity.
  const verdict = classifyCreateMatches({ name: 'Aloe Vera Gel', selling_price_usd: 5.5 }, rows)
  assert.equal(verdict.kind, 'exact_twin')
  assert.equal(verdict.primary?.id, 1)
  assert.equal(verdict.allowProceedAsNew, false)
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
  assert.match(productFormSource, /classifyCreateMatches\(\{[\s\S]*?name: form\.name,[\s\S]*?barcode: form\.barcode,/)
  // and cost is NOT fed in -- it is not part of identity, and passing it only
  // re-ran the classifier on every keystroke in a cost field
  assert.doesNotMatch(productFormSource, /classifyCreateMatches\(\{[\s\S]*?cost_price_usd[\s\S]*?\}, createMatches\)/)
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
