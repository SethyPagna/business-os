// THE COST RULING, and the proof it did not leak into the grouping rule.
//
// A cost of 0 or NULL is a cost NOBODY HAS RECORDED. It is not "a different
// cost". So, for deciding whether two rows are one product to merge:
//
//   both missing, or both set and equal -> 'same'
//   exactly one side missing            -> 'missing': the rows do NOT disagree,
//                                          they are one product, and the merge
//                                          survivor keeps the real cost
//   both set and different              -> 'differs': a real difference. Real
//                                          money out. REVIEW ONLY -- never
//                                          auto-merged, never averaged.
//
// The dangerous half of this change is the half that must NOT happen:
// productDetailSignature is what groups child rows in the product list and what
// the import path auto-merges on, and it still has to answer EXACTLY as it did
// before -- a missing cost is its own signature there. The ruling is a layer ON
// TOP of it (compareCosts / detailsMergeCompatible), read by merge eligibility
// and the create/edit guard. This test pins both halves: the new verdicts, and
// the untouched signature.
//
// normalizedBarcode is pinned here for the same reason: the leading-zero
// equivalence that lets a GTIN-14/EAN-13 twin be offered for review must never
// be pushed down into the signature, or rows nobody reviewed would auto-merge.
//
// Run: node tests/productCostRuling.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  compareCostField, compareCosts, costFillFromDiscarded, costIsMissing,
  detailsMergeCompatible, isSameProductIdentity, productDetailSignature,
} from '../src/utils/productDetailRule.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = (...parts: string[]): string => readFileSync(join(here, '..', 'src', ...parts), 'utf8')
const duplicatesTab = read('components', 'products', 'ProductDuplicatesTab.tsx')
const dialog = read('components', 'products', 'MergeStockChoiceDialog.tsx')
const hook = read('components', 'products', 'useMergeStockChoice.tsx')
const en = JSON.parse(read('lang', 'en.json')) as Record<string, string>
const km = JSON.parse(read('lang', 'km.json')) as Record<string, string>

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

test('a cost of 0, NULL, blank or nonsense is MISSING; a real number is not', () => {
  for (const value of [0, -0, '0', '', null, undefined, 'abc', NaN]) {
    assert.equal(costIsMissing(value), true, `${String(value)} must read as missing`)
  }
  for (const value of [8, '8', 0.01, '0.01']) {
    assert.equal(costIsMissing(value), false, `${String(value)} is a recorded cost`)
  }
})

test('per field: both missing = same, one missing = missing, both set and different = differs', () => {
  assert.equal(compareCostField(0, null), 'same')
  assert.equal(compareCostField(8, 8), 'same')
  assert.equal(compareCostField(8, 8.001), 'same', 'cents, so CSV float noise is not a difference')
  assert.equal(compareCostField(0, 8), 'missing')
  assert.equal(compareCostField(8, 0), 'missing')
  assert.equal(compareCostField(8, 9.5), 'differs')
})

test('the pair verdict: ANY field that truly differs makes the whole pair review-only', () => {
  const set = { barcode: 'X', cost_price_usd: 8, cost_price_khr: 32000 }
  assert.equal(compareCosts(set, { ...set }), 'same')
  assert.equal(compareCosts(set, { barcode: 'X', cost_price_usd: 8, cost_price_khr: 0 }), 'missing')
  assert.equal(compareCosts(set, { barcode: 'X', cost_price_usd: 9.5, cost_price_khr: 32000 }), 'differs')
  // A pair that is missing on one field and differing on another is DIFFERING:
  // the real difference decides, so nothing gets folded on the strength of the
  // blank field.
  assert.equal(compareCosts(set, { barcode: 'X', cost_price_usd: 9.5, cost_price_khr: 0 }), 'differs')
})

test('merge eligibility: same barcode + costs that do not disagree, and NOTHING looser', () => {
  const keeper = { barcode: '689304051040', cost_price_usd: 0, cost_price_khr: 0 }
  assert.equal(detailsMergeCompatible(keeper, { barcode: '689304051040', cost_price_usd: 8 }), true,
    'one side with no cost recorded is the same product')
  assert.equal(detailsMergeCompatible({ barcode: 'X', cost_price_usd: 8 }, { barcode: 'X', cost_price_usd: 9.5 }), false,
    'two costs that both exist and differ are REVIEW ONLY')
  assert.equal(detailsMergeCompatible(keeper, { barcode: '0689304051040', cost_price_usd: 8 }), false,
    'the barcode stays hard identity -- the cost ruling never widens it')
  assert.equal(detailsMergeCompatible({ barcode: ' X ', cost_price_usd: 8 }, { barcode: 'x', cost_price_usd: 8 }), true,
    'trim + lowercase is the barcode normalization, exactly as before')
})

test('the survivor takes the real cost ONLY where it has none of its own', () => {
  assert.deepEqual(
    costFillFromDiscarded({ cost_price_usd: 0, cost_price_khr: 0 }, { cost_price_usd: 8, cost_price_khr: 32000 }),
    [{ field: 'cost_price_usd', value: 8 }, { field: 'cost_price_khr', value: 32000 }],
  )
  assert.deepEqual(costFillFromDiscarded({ cost_price_usd: 8 }, { cost_price_usd: 9.5 }), [],
    'a real difference is the operator\'s to resolve, never the fold\'s to average away')
  assert.deepEqual(costFillFromDiscarded({ cost_price_usd: 8 }, { cost_price_usd: 0 }), [],
    'and a blank never overwrites a real cost')
})

test('LEAK GUARD: productDetailSignature still decides grouping/auto-merge exactly as before', () => {
  const withCost = { barcode: 'X', cost_price_usd: 8, cost_price_khr: 0 }
  const without = { barcode: 'X', cost_price_usd: 0, cost_price_khr: 0 }
  assert.notEqual(productDetailSignature(withCost), productDetailSignature(without),
    'a missing cost is STILL its own detail signature -- child rows group as they always did')
  assert.equal(compareCosts(withCost, without), 'missing',
    'while the merge verdict, a separate layer, says the two do not disagree')
  assert.equal(isSameProductIdentity({ name: 'A', ...withCost }, { name: 'A', ...without }), false,
    'the exact-identity predicate is unchanged too')
  assert.equal(isSameProductIdentity({ name: 'A', ...withCost }, { name: ' a ', ...withCost }), true)
})

test('LEAK GUARD: a leading-zero barcode is still a DIFFERENT signature', () => {
  // The leading-zero equivalence lives on the review surface (the duplicates
  // panel offers such a pair for a human to merge). Pushing it into the
  // signature would auto-merge rows nobody looked at.
  assert.notEqual(
    productDetailSignature({ barcode: '0689304051040', cost_price_usd: 8 }),
    productDetailSignature({ barcode: '689304051040', cost_price_usd: 8 }),
  )
})

test('the bulk auto-merge guard reads the shared ruling, and blocks a real cost difference', () => {
  const guard = duplicatesTab.slice(
    duplicatesTab.indexOf('function clusterIsSafeAutoMerge'),
    duplicatesTab.indexOf('function chooseAutomaticKeeper'),
  )
  assert.ok(guard, 'the auto-merge guard must exist')
  assert.match(guard, /compareCosts\(a, b\) === 'differs'/, 'a real cost difference must block the automatic path')
  assert.match(guard, /cleanupBarcode\(a\.barcode\) === cleanupBarcode\(b\.barcode\)/,
    'only a leading-zero-equivalent barcode may auto-merge')
  assert.match(guard, /normalizeProductGroupName\(a\.name\) !== normalizeProductGroupName\(b\.name\)/,
    'same-barcode-different-name stays manual')
  assert.match(duplicatesTab, /from '\.\.\/\.\.\/utils\/productDetailRule\.ts'/,
    'the verdict must come from the shared rule, not a local re-spelling')
  // The behaviour the guard now has, stated as data: the unset-0 bucket may
  // merge, the both-set-and-different bucket may not.
  assert.notEqual(compareCosts({ cost_price_usd: 0 }, { cost_price_usd: 8 }), 'differs')
  assert.equal(compareCosts({ cost_price_usd: 8 }, { cost_price_usd: 9.5 }), 'differs')
})

test('a review-only pair shows both costs AND both rows per-branch stock lines', () => {
  assert.match(duplicatesTab, /branch_stock\?: Array</, 'the entry type must carry the per-branch lines')
  assert.match(duplicatesTab, /\(product\.branch_stock \|\| \[\]\)\.map/, 'and the card must render them')
  assert.match(duplicatesTab, /money\(product\.cost_price_usd\)/, 'the cost stays visible next to them')
})

test('a merge that fills the kept row\'s missing cost says so, and is never silent', () => {
  assert.match(dialog, /identity\?\.costFill \?\? \[\]/)
  assert.match(dialog, /merge_cost_fill_title/)
  assert.match(hook, /const fillsCost = Boolean\(identity\?\.costFill\?\.length\)/)
  assert.match(hook, /if \(!needsChoice && !wouldReprice && !crossIdentity && !fillsCost\)/,
    'a cost fill must stop for confirmation like a reprice does')
  for (const key of ['merge_cost_fill_title', 'merge_cost_fill_hint']) {
    assert.ok(en[key], `en.json is missing ${key}`)
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.ok(/[ក-៿]/.test(km[key]), `km.json ${key} is not actually Khmer`)
  }
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll productCostRuling tests passed')
