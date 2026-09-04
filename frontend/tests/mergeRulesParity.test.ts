// S4-29: the shop owner's merge rulings (Sep 4 2026), on the CLIENT side.
//
// The Worker copy of these rules is pinned by
// cloudflare/scripts/test-merge-rules-pure.cjs. This file pins the client
// half, and -- more importantly -- pins that the two halves still agree.
//
// The leading-zero fold physically exists twice, because `frontend/` and
// `cloudflare/` are separate npm projects with no shared package:
//   * cloudflare/src/lib/productIdentity.ts  normalizeLeadingZeroBarcodeForCleanup
//   * frontend/.../ProductDuplicatesTab.tsx  cleanupBarcode
// This codebase has already been bitten once by one rule with three
// implementations that disagreed, so the fold is compared BEHAVIOURALLY here,
// over the probes that matter -- including the ones that must NOT merge.
//
// Run: node tests/mergeRulesParity.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveMergedPricing, resolveMergedCost, productIdentitySignature } from '../src/utils/productDetailRule.ts'
import { mergeSameDetailRows } from '../src/utils/productGrouping.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..', '..')

let passed = 0
function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${label}`)
}

// --- pull both copies of the fold out of their real files and run them ----
function extractFn(source: string, marker: string): (value: unknown) => string {
  const start = source.indexOf(marker)
  assert.ok(start >= 0, `could not find ${marker} -- has it been renamed?`)
  const open = source.indexOf('{', start)
  const end = source.indexOf('\n}', open)
  assert.ok(open >= 0 && end > open, `could not bound the body of ${marker}`)
  // The bodies are plain JS apart from the parameter/return annotations,
  // which live in the signature we just skipped past.
  const body = source.slice(open + 1, end)
  return new Function('value', body) as (value: unknown) => string
}

const workerFold = extractFn(
  fs.readFileSync(path.join(repoRoot, 'cloudflare', 'src', 'lib', 'productIdentity.ts'), 'utf8'),
  'export function normalizeLeadingZeroBarcodeForCleanup',
)
const clientSource = fs.readFileSync(
  path.join(repoRoot, 'frontend', 'src', 'components', 'products', 'ProductDuplicatesTab.tsx'), 'utf8')
const clientFold = extractFn(clientSource, 'function cleanupBarcode')

// Every probe that decides a real merge, plus every boundary that must not.
const PROBES: (string | null | undefined)[] = [
  '01234', '1234', '12345', '12340', '12034',
  '03614274226546', '3614274226546',
  '020130264999995', '20130264999995',
  '008339327539', '08339327539', '8339327539',
  '0035000463760', '035000463760',
  '0601', '601', '0', '00', '00000', '',
  '0abc123', 'abc', '  03614274226546  ',
  null, undefined,
]

check('the Worker fold and the client fold agree on every probe', () => {
  for (const probe of PROBES) {
    assert.equal(clientFold(probe), workerFold(probe),
      `the two copies of the leading-zero fold disagree on ${JSON.stringify(probe)}. `
      + 'Copy one over the other -- do not patch one side to merely behave the same.')
  }
})

check('RULING 2: a leading-zero pair folds to one key', () => {
  assert.equal(clientFold('020130264999995'), clientFold('20130264999995'))
  assert.equal(clientFold('01234'), '1234')
})

check('RULING 2: the fold is idempotent, so a double zero meets its clean twin', () => {
  assert.equal(clientFold('008339327539'), clientFold('08339327539'))
  assert.equal(clientFold(clientFold('008339327539')), clientFold('008339327539'))
})

check("RULING 2 boundary: '1234' and '12345' never fold together", () => {
  assert.notEqual(clientFold('1234'), clientFold('12345'))
})

check('RULING 2 boundary: short and non-numeric codes keep their zeros', () => {
  assert.equal(clientFold('0'), '0', 'a placeholder 0 must never become a blank barcode')
  assert.equal(clientFold('0601'), '0601')
  assert.notEqual(clientFold('0601'), clientFold('601'))
  assert.equal(clientFold('0abc123'), '0abc123')
})

check('the keeper ordering ranks on the NUMBER of zeros shed, in both copies', () => {
  // A boolean "was it normalized" ties '008339327539' with '08339327539' and
  // lets the dirtier row win the id tie-break, putting the extra zero back
  // into the catalog as the survivor.
  const worker = fs.readFileSync(path.join(repoRoot, 'cloudflare', 'src', 'lib', 'productIdentity.ts'), 'utf8')
  for (const [label, source] of [['Worker', worker], ['client', clientSource]] as const) {
    assert.ok(/zerosShed/.test(source),
      `${label} keeper ordering must rank on how many leading zeros a row sheds`)
  }
})

// --- RULING 4: selling and VIP price take the MAXIMUM ---------------------
// The VIP tier is read from special_price_usd / special_price_khr. S4-28 is
// renaming that tier to "wholesale"; if it renames the COLUMN, this moves too.
check('RULING 4: selling and VIP price take the maximum, never the average', () => {
  const merged = resolveMergedPricing([
    { selling_price_usd: 12, special_price_usd: 9 },
    { selling_price_usd: 15, special_price_usd: 7 },
  ])
  assert.equal(merged.selling_price_usd, 15)
  assert.equal(merged.special_price_usd, 9, 'the VIP price must not average down')
  assert.notEqual(merged.selling_price_usd, 13.5, 'price must not average like cost does')
})

check('RULING 3 vs 4: cost averages while price maximises', () => {
  const rows = [
    { cost_price_usd: 10, selling_price_usd: 20 },
    { cost_price_usd: 15, selling_price_usd: 30 },
  ]
  assert.equal(resolveMergedCost(rows).cost_price_usd, 12.5, 'cost is the mean of the distinct costs')
  assert.equal(resolveMergedPricing(rows).selling_price_usd, 30, 'price is the maximum')
})

// --- RULING 1: same name, both with no barcode, merge --------------------
check('RULING 1: two same-name rows with no barcode share one identity', () => {
  assert.equal(
    productIdentitySignature({ name: 'SK-II Facial Treatment Essence 230mL', barcode: null }),
    productIdentitySignature({ name: 'SK-II Facial Treatment Essence 230mL', barcode: '' }),
  )
})

check('RULING 1: the grouped row merges them into one, averaging cost and '
  + 'maximising price', () => {
  // The real production pair, ids 9809/9810.
  const merged = mergeSameDetailRows([
    { id: 9809, name: 'SK-II Facial Treatment Essence 230mL', barcode: null, cost_price_usd: 130.541696, selling_price_usd: 145, special_price_usd: 135, stock_quantity: 2 },
    { id: 9810, name: 'SK-II Facial Treatment Essence 230mL', barcode: null, cost_price_usd: 130.777307, selling_price_usd: 145, special_price_usd: 130, stock_quantity: 3 },
  ] as never)
  assert.equal(merged.length, 1, 'the two unbarcoded rows must collapse to one row')
  assert.equal(merged[0].cost_price_usd, 130.6596, 'cost is the mean, rounded UP to 4dp')
  assert.equal(merged[0].special_price_usd, 135, 'the VIP price takes the higher of the two')
  assert.equal(merged[0].stock_quantity, 5, 'stock adds')
})

check('RULING 1 boundary: an unbarcoded row is NOT absorbed into a barcoded '
  + 'sibling of the same name', () => {
  const merged = mergeSameDetailRows([
    { id: 20, name: 'Half Barcoded', barcode: null, stock_quantity: 1 },
    { id: 21, name: 'Half Barcoded', barcode: '5012345678900', stock_quantity: 1 },
  ] as never)
  assert.equal(merged.length, 2, 'the owner authorised merging two UNbarcoded rows, not this')
})

console.log(`\n${passed} checks passed`)
