import assert from 'node:assert/strict'
import fs from 'node:fs'
import './financialPrecision.test.ts'

// Locks the Part-77 money fixes in POS.tsx (frontend audit):
//
// 1. Loyalty redemption value keeps CENTS precision. The old
//    `Math.round(parseFloat(...))` turned a configured $0.50-per-step into
//    $1 (double redemption value) and $0.25 into $0 -- while
//    membership_points_redeemed was still sent, so the member's points were
//    burned for a $0 discount.
// 2. KHR amounts are whole riel end to end: the tax/total/change
//    multiplications used to hand fractional riel to the checkout payload
//    and the printed receipt.

const pos = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')

let failed = 0
function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

check('loyalty redeem USD step keeps cents precision, never whole-dollar rounding', () => {
  const line = pos.split('\n').find((entry) => entry.includes('const redeemValueUsdStep ='))
  assert.ok(line, 'expected the redeemValueUsdStep derivation')
  assert.ok(line!.includes('* 100) / 100'), 'redeemValueUsdStep must round to cents (x*100)/100, not Math.round(x)')
  assert.ok(line!.includes('Math.round((parseFloat'), 'the cents rounding must wrap the parsed setting')
})

check('KHR tax, total and change are whole riel', () => {
  assert.match(pos, /const taxKhr\s+= Math\.round\(afterDiscKhr \* taxRate\)/, 'taxKhr must round')
  assert.match(pos, /const totalKhr\s+= Math\.round\(afterDiscKhr \+ taxKhr \+ customerFeeKhr\)/, 'totalKhr must round')
  // Part 534: change converts at its own dedicated rate, still whole riel.
  assert.match(pos, /const changeKhr\s+= Math\.round\(changeUsd \* changeExchangeRate\)/, 'changeKhr must round (at the dedicated change rate)')
})

check('the checkout payload sends whole-riel subtotal and rounded KHR discounts', () => {
  assert.match(pos, /subtotal_khr: Math\.round\(subtotalKhr\)/, 'payload subtotal_khr must be whole riel')
  assert.match(pos, /const membershipDiscKhr = Math\.round\(/, 'membership KHR discount must round')
  assert.match(pos, /: Math\.round\(parseFloat\(active\.discountKhr\) \|\| CURRENCY\.usdToKhr\(discUsd, exchangeRate\)\)/, 'fixed KHR discount must round')
})

// The behavior the cents fix protects, computed the way the component does:
check('a $0.25-per-100-points config yields $0.25/step, not $0 (and $0.50 stays $0.50)', () => {
  const stepFor = (configured: string): number => Math.max(0, Math.round((parseFloat(configured) || 1) * 100) / 100)
  assert.equal(stepFor('0.25'), 0.25)
  assert.equal(stepFor('0.5'), 0.5)
  assert.equal(stepFor('1'), 1)
  // 3 steps at $0.25 = $0.75 exactly, presented with toFixed(2) as the UI does
  assert.equal((3 * stepFor('0.25')).toFixed(2), '0.75')
})

if (failed) {
  process.exit(1)
}
console.log('\nAll posMoneyRounding checks passed.')
