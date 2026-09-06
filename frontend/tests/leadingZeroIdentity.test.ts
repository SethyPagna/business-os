// N15 (owner ruling, Sep 4 2026, verbatim): "for same products same barcode
// the only difference is a leading zero... remove the leading zero and merge
// them".
//
// The fold shipped in ONE place -- the Worker's whole-catalog auto-merge
// detector -- and nowhere else, so the twin still rendered as two child rows on
// every screen in the app until somebody ran the merge against production. This
// file pins the fix at the level that decides it: BEHAVIOUR of the shared
// normalization and of the grouped row, not a regex over source.
//
// Every check below is DISCRIMINATING -- it fails on the pre-fix code, where
// productDetailSignature compared the raw trimmed/lowercased barcode.
//
// Run: node tests/leadingZeroIdentity.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  identityBarcodeKey,
  normalizeLeadingZeroBarcodeForCleanup,
  productDetailSignature,
  productIdentitySignature,
} from '../src/utils/productDetailRule.ts'
import { mergeSameDetailRows } from '../src/utils/productGrouping.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..', '..')

let passed = 0
function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${label}`)
}

// --- the fixture set the two package copies must agree on ------------------
// Named here rather than inline because the same probes are run against the
// WORKER copy of the rule by tests/mergeRulesParity.test.ts, which extracts
// the fold from both package copies and asserts the two answer identically.
export const FOLD_FIXTURES: Array<[unknown, string]> = [
  // the edge cases the owner's ask names explicitly
  ['', ''],
  [null, ''],
  [undefined, ''],
  ['0', '0'],
  ['00', '00'],
  ['000', '000'],
  ['0000', '0000'],
  ['0abc123', '0abc123'],
  ['ABC-0012', 'abc-0012'],
  ['0012', '0012'],
  ['00 12', '00 12'],
  // the real production twins
  ['03614274226546', '3614274226546'],
  ['3614274226546', '3614274226546'],
  ['008339327539', '8339327539'],
  ['08339327539', '8339327539'],
  ['020130264999995', '20130264999995'],
  // the MAC shade codes the owner ruled must fold
  ['0601', '601'],
  ['601', '601'],
  ['0617', '617'],
  // boundaries that must NOT fold
  ['1234', '1234'],
  ['12345', '12345'],
  ['12034', '12034'],
  ['12340', '12340'],
  // whitespace / case are folded first, zeros second
  ['  03614274226546  ', '3614274226546'],
]

check('the shared fold answers every fixture, including the empty/0/000/mixed-alnum edges', () => {
  for (const [input, expected] of FOLD_FIXTURES) {
    assert.equal(
      normalizeLeadingZeroBarcodeForCleanup(input), expected,
      `fold(${JSON.stringify(input)}) must be ${JSON.stringify(expected)}`,
    )
  }
})

check('the shared fold lives in the module BOTH packages carry verbatim', () => {
  // The point of moving it: productDetailRuleParity.test.ts already byte-
  // compares these two files, so the fold can no longer drift between packages
  // the way the Worker copy and the Conflicts-tab copy could.
  for (const rel of [
    ['cloudflare', 'src', 'lib', 'productDetailRule.ts'],
    ['frontend', 'src', 'utils', 'productDetailRule.ts'],
  ]) {
    const text = fs.readFileSync(path.join(repoRoot, ...rel), 'utf8')
    assert.match(text, /export function normalizeLeadingZeroBarcodeForCleanup/,
      `${rel.join('/')} must own the shared fold`)
    assert.match(text, /export function identityBarcodeKey/,
      `${rel.join('/')} must expose the identity barcode key`)
  }
})

check('identityBarcodeKey folds case, whitespace and zeros in one step', () => {
  assert.equal(identityBarcodeKey('  03614274226546 '), '3614274226546')
  assert.equal(identityBarcodeKey('ABC0'), 'abc0')
  assert.equal(identityBarcodeKey(null), '')
})

// --- the identity signature itself ----------------------------------------
check('DISCRIMINATING: a leading-zero pair shares one detail signature', () => {
  // Pre-fix this returned '03614274226546' vs '3614274226546' -- two products.
  assert.equal(
    productDetailSignature({ barcode: '03614274226546' }),
    productDetailSignature({ barcode: '3614274226546' }),
  )
  assert.equal(
    productIdentitySignature({ name: 'Zero Twin', barcode: '008339327539' }),
    productIdentitySignature({ name: 'Zero Twin', barcode: '08339327539' }),
  )
})

check('NEGATIVE CONTROL: nothing but a leading zero folds', () => {
  assert.notEqual(productDetailSignature({ barcode: '1234' }), productDetailSignature({ barcode: '12345' }))
  assert.notEqual(productDetailSignature({ barcode: '0012' }), productDetailSignature({ barcode: '12' }))
  assert.notEqual(productDetailSignature({ barcode: '0abc123' }), productDetailSignature({ barcode: 'abc123' }))
  assert.notEqual(productDetailSignature({ barcode: '0' }), productDetailSignature({ barcode: '' }))
  assert.notEqual(productDetailSignature({ barcode: '000' }), productDetailSignature({ barcode: '' }))
  assert.notEqual(
    productIdentitySignature({ name: 'A', barcode: '0601' }),
    productIdentitySignature({ name: 'B', barcode: '601' }),
    'a different NAME is still a different product -- the fold only ever folds the barcode',
  )
})

// --- the grouped row every display surface renders -------------------------
// mergeSameDetailRows is what Products, POS, the transfer/add-stock pickers,
// the sale detail sheet and the public storefront all render, through
// buildProductGroups / buildProductCategorySections / buildProductGroupSections
// / portalProductGrouping. Fixing it here fixes all eleven call sites at once.
check('DISCRIMINATING: the twin renders as ONE row, with the mean of the distinct costs', () => {
  const merged = mergeSameDetailRows([
    { id: 100, name: 'Zero Twin Mascara', barcode: '03614274226546', cost_price_usd: 5, selling_price_usd: 12, wholesale_price_usd: 9, stock_quantity: 4 },
    { id: 101, name: 'Zero Twin Mascara', barcode: '3614274226546', cost_price_usd: 7.9, selling_price_usd: 15, wholesale_price_usd: 7, stock_quantity: 3 },
  ] as never)
  assert.equal(merged.length, 1, 'pre-fix this was 2 rows on every product surface')
  assert.equal(merged[0].cost_price_usd, 6.45, 'cost is the mean of the DISTINCT costs, rounded up to 4dp')
  assert.equal(merged[0].selling_price_usd, 15, 'selling price takes the maximum')
  assert.equal(merged[0].wholesale_price_usd, 9, 'wholesale price takes the maximum')
  assert.equal(merged[0].stock_quantity, 7, 'stock adds')
})

check('POSITIVE CONTROL: the pair the parity test already pinned still merges', () => {
  const merged = mergeSameDetailRows([
    { id: 9809, name: 'SK-II Facial Treatment Essence 230mL', barcode: null, cost_price_usd: 130.541696, stock_quantity: 2 },
    { id: 9810, name: 'SK-II Facial Treatment Essence 230mL', barcode: '', cost_price_usd: 130.777307, stock_quantity: 3 },
  ] as never)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].cost_price_usd, 130.6596)
})

check('NEGATIVE CONTROL: rows that are not zero twins still render separately', () => {
  const twoSkus = mergeSameDetailRows([
    { id: 200, name: 'Real Two Skus', barcode: '1111111111111', stock_quantity: 1 },
    { id: 201, name: 'Real Two Skus', barcode: '2222222222222', stock_quantity: 1 },
  ] as never)
  assert.equal(twoSkus.length, 2, 'two genuinely different barcodes are two child rows')

  const shortCodes = mergeSameDetailRows([
    { id: 300, name: 'Short Code', barcode: '0012', stock_quantity: 1 },
    { id: 301, name: 'Short Code', barcode: '12', stock_quantity: 1 },
  ] as never)
  assert.equal(shortCodes.length, 2, 'a 2-digit survivor is too short to fold')

  const placeholders = mergeSameDetailRows([
    { id: 400, name: 'Placeholder', barcode: '0', stock_quantity: 1 },
    { id: 401, name: 'Placeholder', barcode: null, stock_quantity: 1 },
  ] as never)
  assert.equal(placeholders.length, 2, "the placeholder '0' must never collapse into the unbarcoded row")

  const halfBarcoded = mergeSameDetailRows([
    { id: 500, name: 'Half Barcoded', barcode: null, stock_quantity: 1 },
    { id: 501, name: 'Half Barcoded', barcode: '5012345678900', stock_quantity: 1 },
  ] as never)
  assert.equal(halfBarcoded.length, 2, 'an unbarcoded row is not absorbed into a barcoded sibling')
})

// --- the guard that must NOT be widened ------------------------------------
check('the identity fold is bounded, and never becomes the unbounded search fold', () => {
  // searchMatch.ts folds zeros with a bare ltrim and no length floor, because
  // FINDING a row is reversible and MERGING two rows is not. If the identity
  // fold ever loses its numeric-only test or its 3-digit floor, the 238
  // production rows carrying the placeholder '0' all collapse into one product.
  assert.equal(normalizeLeadingZeroBarcodeForCleanup('0'), '0')
  assert.equal(normalizeLeadingZeroBarcodeForCleanup('00000'), '00000')
  assert.equal(normalizeLeadingZeroBarcodeForCleanup('0abc'), '0abc')
  const rule = fs.readFileSync(path.join(repoRoot, 'cloudflare', 'src', 'lib', 'productDetailRule.ts'), 'utf8')
  const start = rule.indexOf('export function normalizeLeadingZeroBarcodeForCleanup')
  const body = rule.slice(start, rule.indexOf('\n}', start))
  assert.match(body, /\^\[0-9\]\+\$/, 'the fold must stay numeric-only')
  assert.match(body, /length >= 3/, 'the fold must keep its 3-digit floor')
})

console.log(`\n${passed} checks passed`)
