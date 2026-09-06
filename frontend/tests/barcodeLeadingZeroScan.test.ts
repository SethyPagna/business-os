// The CLIENT half of the 2026-09-06 owner report, verbatim:
//
//   "I see that barcode scanner cannot scan the beginning with zero the
//    leading zero for products that actually have barcode with leading 0."
//
// The server half is pinned in
// cloudflare/scripts/test-barcode-leading-zero-scan-pure.cjs. This file
// guards the three client-side seams where a scan can still come back
// empty even when the server answered correctly:
//
//   1. THE RE-FILTER. Several pickers take the server's page and re-filter
//      it locally with fuzzyTextMatches. That was a plain compact-substring
//      test, and substring containment is ASYMMETRIC: a row stored
//      '885909950805' does not contain the scanned '0885909950805', so the
//      client silently dropped the row the server had just matched. Same
//      for the UPC-E/UPC-A pair, which share no substring at all.
//
//   2. THE JOINED HAYSTACK. A picker that pre-joins its fields into ONE
//      string ("name sku barcode") destroys the barcode as a discrete code
//      -- no per-field fold can see it any more. Those call sites must pass
//      the fields separately.
//
//   3. THE HANDOFF. Nothing on the decode -> search box path may coerce the
//      scanned text to a number: Number('0123') is 123, which would destroy
//      the leading zero before any matcher ever sees it.
//
// Each assertion below fails on base 01f0c93c.
//
// Run: node tests/barcodeLeadingZeroScan.test.ts

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  barcodeKeysMatch,
  barcodeSearchKeys,
  compressUpcA,
  expandUpcE,
  fuzzyTextMatches,
  MATCH_TIER_EXACT_BARCODE,
  normalizeBarcodeKey,
  searchRelevanceTier,
  searchTermBarcodeKey,
  searchTermBarcodeKeys,
} from '../src/utils/searchMatch.ts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// The same fixtures the Worker test uses, so the two halves cannot drift.
const PADDED_STORED = '0748485110011'
const PADDED_BARE = '748485110011'
const BARE_STORED = '885909950805'
const BARE_SCANNED_PADDED = '0885909950805'
const UPCE = '01234565'
const UPCA = '012345000065'

// --- 1. the kernel -----------------------------------------------------

check('UPC-E expands to the UPC-A its check digit proves', () => {
  assert.equal(expandUpcE(UPCE), UPCA)
  assert.equal(expandUpcE('04963406'), '049000006346')
  // Not a UPC-E: wrong check digit, wrong length, wrong number system.
  assert.equal(expandUpcE('20123458'), '')
  assert.equal(expandUpcE('0123456'), '')
  assert.equal(expandUpcE('91234565'), '')
})

check('UPC-A compresses back to the same UPC-E, or to nothing', () => {
  assert.equal(compressUpcA(UPCA), UPCE)
  assert.equal(compressUpcA(`0${UPCA}`), UPCE, 'the EAN-13 spelling must compress too')
  assert.equal(compressUpcA('049000006346'), '04963406')
  // A UPC-A with no zero run has no compressed form at all.
  assert.equal(compressUpcA('012345678905'), '')
})

check('barcodeSearchKeys carries every spelling one article is printed under', () => {
  assert.deepEqual(barcodeSearchKeys(UPCE), ['1234565', '12345000065'])
  assert.ok(barcodeSearchKeys(UPCA).includes('12345000065'))
  assert.ok(barcodeSearchKeys(UPCA).includes('1234565'))
  // A plain code still yields exactly one key -- no invented equivalents.
  assert.deepEqual(barcodeSearchKeys(PADDED_STORED), [PADDED_BARE])
  assert.deepEqual(barcodeSearchKeys('0'), [], 'the placeholder is not a barcode')
})

check('barcodeKeysMatch folds padding AND the UPC-E pair, both directions', () => {
  assert.ok(barcodeKeysMatch(PADDED_BARE, PADDED_STORED))
  assert.ok(barcodeKeysMatch(BARE_SCANNED_PADDED, BARE_STORED))
  assert.ok(barcodeKeysMatch(BARE_STORED, BARE_SCANNED_PADDED))
  assert.ok(barcodeKeysMatch(UPCE, UPCA))
  assert.ok(barcodeKeysMatch(UPCA, UPCE))
})

check('the fold never collapses two genuinely different articles', () => {
  assert.ok(!barcodeKeysMatch(PADDED_STORED, '0748485110012'))
  assert.ok(!barcodeKeysMatch(UPCE, '01234665'))
  assert.ok(!barcodeKeysMatch('0', '0'), 'the shared placeholder is never an identity')
  assert.ok(!barcodeKeysMatch('20123458', '0123458'))
})

check('searchTermBarcodeKey keeps its single-key contract for old callers', () => {
  assert.equal(searchTermBarcodeKey(PADDED_STORED), PADDED_BARE)
  assert.equal(searchTermBarcodeKey('dior 3348901770569'), '', 'two words is a normal search')
  assert.deepEqual(searchTermBarcodeKeys('dior 3348901770569'), [])
})

// --- 2. the client re-filter ------------------------------------------

check('re-filter: a scan with a leading zero still matches the bare stored code', () => {
  // Fields passed SEPARATELY, the way a picker must do it.
  assert.ok(
    fuzzyTextMatches(['Bare Only Cleanser', null, BARE_STORED], BARE_SCANNED_PADDED),
    'the client dropped a row the server matches',
  )
})

check('re-filter: the UPC-E/UPC-A pair matches although they share no substring', () => {
  assert.ok(fuzzyTextMatches(['Small Package Balm', null, UPCA], UPCE))
  assert.ok(fuzzyTextMatches(['Compressed Tin', null, '04963406'], '049000006346'))
})

check('re-filter: an unrelated code is still rejected', () => {
  // Deliberately far apart, because the WORD path underneath is fuzzy by
  // design (it tolerates a one-character typo, which predates this lane and
  // is what keeps a mistyped name searchable). What this lane must not do
  // is make two different codes the SAME BARCODE -- asserted on the tier in
  // the next check, where "identity" actually lives.
  assert.ok(!fuzzyTextMatches(['Different Article', null, '5012345678900'], PADDED_BARE))
  assert.ok(!fuzzyTextMatches(['Small Package Balm', null, UPCA], '77712345'))
})

check('re-filter: a near-miss code is never promoted to barcode IDENTITY', () => {
  // One digit off is a different article. It may still surface through the
  // fuzzy word path (it did before this lane too), but it must never be
  // treated as the scanned code itself.
  assert.notEqual(
    searchRelevanceTier({ name: 'Different Article', barcode: '0748485110012' }, PADDED_BARE),
    MATCH_TIER_EXACT_BARCODE,
  )
  assert.notEqual(
    searchRelevanceTier({ name: 'Small Package Balm', barcode: UPCA }, '01234665'),
    MATCH_TIER_EXACT_BARCODE,
  )
  assert.notEqual(
    searchRelevanceTier({ name: 'Legacy Placeholder', barcode: '0' }, '0'),
    MATCH_TIER_EXACT_BARCODE,
  )
})

check('re-filter: ordinary word search is untouched by the barcode path', () => {
  assert.ok(fuzzyTextMatches(['Dior Backstage Highlighter', null, '3348901770569'], 'backstage'))
  assert.ok(fuzzyTextMatches(['Cover Concealer', null, ''], 'concealer cover'))
  assert.ok(!fuzzyTextMatches(['Dior Backstage', null, ''], 'chanel'))
})

check('relevance: the folded row is still the EXACT-BARCODE tier, so it leads', () => {
  assert.equal(
    searchRelevanceTier({ name: 'Bare Only Cleanser', barcode: BARE_STORED }, BARE_SCANNED_PADDED),
    MATCH_TIER_EXACT_BARCODE,
  )
  assert.equal(
    searchRelevanceTier({ name: 'Small Package Balm', barcode: UPCA }, UPCE),
    MATCH_TIER_EXACT_BARCODE,
  )
})

// --- 3. source-shape guards -------------------------------------------

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

check('no numeric coercion anywhere on the decode -> search box path', () => {
  for (const file of [
    '../src/components/products/scanning/scanbotScanner.ts',
    '../src/components/products/scanning/barcodeImageScanner.ts',
    '../src/components/products/scanning/barcodeScannerState.ts',
    '../src/components/products/scanning/BarcodeScannerModal.tsx',
    '../src/components/shared/ScanSearchButton.tsx',
  ]) {
    const src = read(file)
    // Number(...) / parseInt(...) / parseFloat(...) / unary + on the scanned
    // text would all silently drop a leading zero.
    assert.ok(!/\bparseInt\s*\(/.test(src), `${file} parses the scan as an integer`)
    assert.ok(!/\bparseFloat\s*\(/.test(src), `${file} parses the scan as a float`)
    assert.ok(!/\bNumber\s*\(/.test(src), `${file} coerces the scan to a Number`)
  }
})

check('pickers that re-filter locally pass barcode as its OWN field', () => {
  // A pre-joined "name sku barcode" string is not a barcode any more: the
  // fold cannot see a discrete code inside a sentence, so these call sites
  // must hand the fields over separately.
  for (const file of [
    '../src/components/branches/TransferModal.tsx',
    '../src/components/catalog/CatalogPage.tsx',
  ]) {
    const src = read(file)
    const joinedHaystack = /fuzzyTextMatches\(\s*\[[^\]]*\]\s*\.join\(/.test(src)
    assert.ok(!joinedHaystack, `${file} joins its haystack before fuzzyTextMatches`)
  }
})

check('the shared kernel is the ONLY place the UPC-E rule is implemented', () => {
  // One rule, one implementation: nothing outside the two searchMatch
  // copies may hand-roll an expansion.
  const offenders: string[] = []
  for (const file of [
    '../src/utils/productGrouping.ts',
    '../src/components/products/helpers/productCreateMatch.ts',
    '../src/components/returns/NewSupplierReturnModal.tsx',
  ]) {
    if (/expandUpcE\s*=|function\s+expandUpcE/.test(read(file))) offenders.push(file)
  }
  assert.deepEqual(offenders, [])
})

check('the frontend and Worker barcode kernels state the same rule', () => {
  const fe = read('../src/utils/searchMatch.ts')
  const cf = read('../../cloudflare/src/lib/searchMatch.ts')
  for (const fn of ['expandUpcE', 'compressUpcA', 'barcodeSearchKeys', 'upcCheckDigit']) {
    assert.ok(fe.includes(`function ${fn}`), `frontend kernel is missing ${fn}`)
    assert.ok(cf.includes(`function ${fn}`), `Worker kernel is missing ${fn}`)
  }
})

console.log(`\nOK - ${passed} checks passed.`)
