// The Sep-4-2026 cost rule, pinned end to end.
//
// Until that date a differing cost forked a child row. The user's ruling
// replaced that: "all products if cost is different add different costs
// together and divide by the number different costs... keep 4 decimal digits
// always round up to 4 decimal digits... so now only diffeerent barcode
// creates new child row... rest merge".
//
// So cost is no longer identity -- it is reconciled on merge. This file pins
// the reconciliation itself; productDetailRuleParity.test.ts pins the fact
// that cost stayed out of the identity signature, and mergeSameDetailRows /
// productImportPlanner pin the merge behaviour at the two call sites.
import assert from 'node:assert/strict'
import { resolveMergedCost, roundCostUp4 } from '../src/utils/productDetailRule.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('roundCostUp4 rounds UP at the 4th decimal, never to nearest', () => {
  assert.equal(roundCostUp4(1.00001), 1.0001, 'a hair over 1.0000 becomes 1.0001, not 1.0000')
  assert.equal(roundCostUp4(1.00009), 1.0001)
  assert.equal(roundCostUp4(2.123401), 2.1235)
})

await runTest('roundCostUp4 leaves a value that is already 4dp exactly alone', () => {
  // Without the float-error nudge, 9.8765 * 10000 can land a hair above
  // 98765 and get pushed a tick up by its own binary representation.
  for (const value of [9.8765, 1.0001, 0.0001, 12, 0, 50.7]) {
    assert.equal(roundCostUp4(value), value, `${value} must survive unchanged`)
  }
})

await runTest('roundCostUp4 treats anything non-numeric as 0', () => {
  assert.equal(roundCostUp4(undefined), 0)
  assert.equal(roundCostUp4(null), 0)
  assert.equal(roundCostUp4('not a number'), 0)
  assert.equal(roundCostUp4(NaN), 0)
  assert.equal(roundCostUp4(Infinity), 0)
})

await runTest('resolveMergedCost averages two different costs', () => {
  const merged = resolveMergedCost([
    { cost_price_usd: 4 },
    { cost_price_usd: 5 },
  ])
  assert.equal(merged.cost_price_usd, 4.5)
})

await runTest('resolveMergedCost divides by the number of DISTINCT costs, not of rows', () => {
  // The user's words: "add different costs together and divide by the number
  // different costs". Ten rows bought at $4 and one at $5 average to $4.50,
  // not $4.09 -- the repeat purchases at the same price are one cost.
  const rows = Array.from({ length: 10 }, () => ({ cost_price_usd: 4 }))
  rows.push({ cost_price_usd: 5 })
  assert.equal(resolveMergedCost(rows).cost_price_usd, 4.5)
})

await runTest('resolveMergedCost keeps a single cost exactly as it was', () => {
  const merged = resolveMergedCost([
    { cost_price_usd: 50.7 },
    { cost_price_usd: 50.7 },
  ])
  assert.equal(merged.cost_price_usd, 50.7, 'one distinct cost averages to itself')
})

await runTest('resolveMergedCost rounds the mean UP to 4 decimals', () => {
  // 1 and 1.0001 average to 1.00005, which is not representable at 4dp and
  // must land on the higher tick: an understated cost overstates profit.
  assert.equal(resolveMergedCost([
    { cost_price_usd: 1 },
    { cost_price_usd: 1.0001 },
  ]).cost_price_usd, 1.0001)
  // Thirds of a dollar: 1, 1.5 and 1.9 average to 1.46666..., which must land
  // on the higher 4dp tick.
  assert.equal(resolveMergedCost([
    { cost_price_usd: 1 },
    { cost_price_usd: 1.5 },
    { cost_price_usd: 1.9 },
  ]).cost_price_usd, 1.4667)
  // CHANGED by the S4-32 similarity guard: this case used to read 1/2/4 ->
  // 2.3334, but 4 is more than COST_OUTLIER_RATIO (2x) above 1, so that set no
  // longer averages at all -- it keeps the highest. The rounding behaviour it
  // was written to pin is unchanged and is now pinned by the 1/2/2.9 case
  // above, which is a spread the guard permits.
  assert.equal(resolveMergedCost([
    { cost_price_usd: 1 },
    { cost_price_usd: 2 },
    { cost_price_usd: 4 },
  ]).cost_price_usd, 4)
})

await runTest('resolveMergedCost refuses to average costs that are not SIMILAR, and keeps the highest', () => {
  // Owner ruling, 2026-09-04: "the add and divide is only for those similar
  // costs...not the 0 cost etc...". The zero half is pinned below; this is
  // the other half. $2 and a mistyped $200 used to blend into $101 -- a
  // number nobody ever paid, and wrong in the direction that overstates
  // profit. The full guard (threshold, reporting, KHR, both fold sites) is
  // pinned by cloudflare/scripts/test-merge-cost-similarity-guard-pure.cjs;
  // this case is here so the frontend copy of the rule cannot drift on it.
  assert.equal(resolveMergedCost([
    { cost_price_usd: 2 },
    { cost_price_usd: 200 },
  ]).cost_price_usd, 200)
  // The widest real production pair (1.58x) still averages: the guard fires
  // on nothing in today's catalogue and is purely forward-looking.
  assert.equal(resolveMergedCost([
    { cost_price_usd: 5 },
    { cost_price_usd: 7.9 },
  ]).cost_price_usd, 6.45)
})

await runTest('resolveMergedCost treats 0 as NOT RECORDED and leaves it out of the mean', () => {
  // Both cost columns are DEFAULT 0 and every importer writes 0 when the
  // source has no cost, so 0 is this schema's "unset", not a free item.
  // Averaging it in would halve a real cost and double reported profit.
  assert.equal(resolveMergedCost([
    { cost_price_usd: 50.7 },
    { cost_price_usd: 0 },
  ]).cost_price_usd, 50.7)
})

await runTest('resolveMergedCost returns 0 when no row records a cost at all', () => {
  const merged = resolveMergedCost([
    { cost_price_usd: 0 },
    { cost_price_usd: 0 },
  ])
  assert.equal(merged.cost_price_usd, 0, 'unchanged from what every row already said')
})

await runTest('resolveMergedCost omits a field no row carried, so it cannot clobber with zeros', () => {
  const merged = resolveMergedCost([
    { cost_price_usd: 4 },
    { cost_price_usd: 5 },
  ])
  assert.equal('cost_price_khr' in merged, false, 'KHR was never mentioned, so it must not be written')
  assert.deepEqual(Object.keys(merged), ['cost_price_usd'])
  assert.deepEqual(resolveMergedCost([]), {}, 'nothing in, nothing out')
  assert.deepEqual(resolveMergedCost([{}, {}]), {})
})

await runTest('resolveMergedCost resolves USD and KHR independently', () => {
  const merged = resolveMergedCost([
    { cost_price_usd: 4, cost_price_khr: 16000 },
    { cost_price_usd: 5, cost_price_khr: 16000 },
  ])
  assert.equal(merged.cost_price_usd, 4.5, 'two distinct USD costs average')
  assert.equal(merged.cost_price_khr, 16000, 'one distinct KHR cost stays put')
})

await runTest('resolveMergedCost reads the numeric strings a CSV import hands it', () => {
  const merged = resolveMergedCost([
    { cost_price_usd: '4' },
    { cost_price_usd: '5' },
  ])
  assert.equal(merged.cost_price_usd, 4.5)
})

await runTest('resolveMergedCost ignores unreadable values instead of scoring them as 0', () => {
  // A garbled cell must not drag the mean down; it is not a cost of nothing,
  // it is not a cost at all.
  assert.equal(resolveMergedCost([
    { cost_price_usd: 4 },
    { cost_price_usd: 'n/a' },
    { cost_price_usd: null },
    { cost_price_usd: '' },
  ]).cost_price_usd, 4)
})

await runTest('resolveMergedCost survives a null row without throwing', () => {
  const rows = [{ cost_price_usd: 4 }, null, undefined] as unknown as { cost_price_usd?: unknown }[]
  assert.equal(resolveMergedCost(rows).cost_price_usd, 4)
})

if (failed > 0) {
  process.exitCode = 1
}
