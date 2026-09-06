// The stat-card equations (owner ask N6, Sep 6 2026). Three sentences the
// Dashboard and the Sales strip printed were arithmetic that did not foot:
//
//   Revenue = Gross - Discounts            (no refund term at all)
//   Net after refunds = Revenue - Refunded (refunds taken off a SECOND time,
//                                           and off the return-date total)
//   Gross profit = Revenue - COGS - Store-paid delivery
//                                          (a term the kernel never subtracts;
//                                           the two delivery terms missing)
//
// Every check below runs the OLD term list against the same payload first and
// asserts its residual is NOT zero, so a green result here means the fixture
// can actually tell the two apart -- the tests would pass on the old code
// otherwise and prove nothing.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  revenueTerms, profitTerms, equationResidual, equationCloses, buildEquation,
  type FormulaTerm, type StatsFormulaTotals,
} from '../src/utils/statsFormulas.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8')

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

// One period, with every figure the two identities touch non-zero and
// DIFFERENT, so no two terms can be swapped without the sum moving.
//   net sales 310, refunds 20            -> revenue 290
//   COGS 118, fees charged 15, courier 9 -> profit 178
// The return-date activity total (65) is deliberately much larger than the
// sale-date reversal (20): 43 of it belongs to sales rung in earlier periods.
const totals: StatsFormulaTotals = {
  net_sales_usd: 310,
  refund_usd: 20,
  revenue_usd: 290,
  cost_usd: 118,
  recognized_delivery_usd: 15,
  recognized_delivery_cost_usd: 9,
  profit_usd: 178,
  // display line items -- never terms of either identity
  gross_sales_usd: 400,
  discount_usd: 78,
  store_delivery_usd: 7,
  tax_usd: 12,
}
const RETURN_DATE_REFUNDS = 65

test('revenue: the shipped terms close on revenue_usd exactly', () => {
  assert.equal(equationResidual(290, revenueTerms(totals)), 0)
  assert.equal(equationCloses(290, revenueTerms(totals)), true)
})

test('revenue: the OLD "Gross - Discounts" sentence is off by the refunds it never mentioned', () => {
  const old: FormulaTerm[] = [
    { key: 'gross_revenue', fallback: 'Gross', sign: 1, usd: 400 },
    { key: 'discounts', fallback: 'Discounts', sign: -1, usd: 78 },
  ]
  // 400 - 78 = 322, not 290. The gap is the 20 of refunds plus the 12 of
  // gross that is not in net sales -- neither of which the sentence named.
  assert.equal(equationResidual(290, old), -32)
  assert.equal(equationCloses(290, old), false)
})

test('revenue: subtracting refunds again gives a figure that is not revenue', () => {
  // The Returns card printed `Net after refunds = Revenue - Refunded` using
  // the RETURN-DATE total. On this period that is 290 - 65 = 225 -- 65 below
  // revenue, of which 20 was already out and 43 belongs to other periods.
  const doubled: FormulaTerm[] = [
    { key: 'revenue_short', fallback: 'Revenue', sign: 1, usd: 290 },
    { key: 'total_refunded', fallback: 'Refunded', sign: -1, usd: RETURN_DATE_REFUNDS },
  ]
  assert.equal(equationResidual(290, doubled), RETURN_DATE_REFUNDS)
  // And with a large enough return-date total the "net" goes below zero while
  // revenue itself is a healthy 290 -- the negative the owner ruled out.
  const heavy = 290 - 400
  assert.ok(heavy < 0, 'a return-date total above revenue manufactures a negative')
})

test('profit: the shipped terms close on profit_usd exactly', () => {
  assert.equal(equationResidual(178, profitTerms(totals)), 0)
})

test('profit: the OLD "- Store-paid delivery" sentence does not foot', () => {
  const old: FormulaTerm[] = [
    { key: 'revenue_short', fallback: 'Revenue', sign: 1, usd: 290 },
    { key: 'cogs', fallback: 'COGS', sign: -1, usd: 118 },
    { key: 'store_paid_delivery', fallback: 'Store-paid delivery', sign: -1, usd: 7 },
  ]
  // 290 - 118 - 7 = 165, while profit is 178: the waived fee was taken off
  // (it never was) and the real delivery pair (+15 - 9) was left out.
  assert.equal(equationResidual(178, old), 13)
})

test('the identities survive a period with no delivery and no refunds', () => {
  const plain: StatsFormulaTotals = { net_sales_usd: 50, refund_usd: 0, revenue_usd: 50, cost_usd: 20, profit_usd: 30 }
  assert.equal(equationResidual(50, revenueTerms(plain)), 0)
  assert.equal(equationResidual(30, profitTerms(plain)), 0)
})

test('a gated payload (no cost) does not silently claim to foot', () => {
  // A non-admin never receives cost_usd or profit_usd. Reading them as 0 must
  // NOT produce "Profit 0 = Revenue 290 ..." that closes by accident.
  const gated: StatsFormulaTotals = { net_sales_usd: 310, refund_usd: 20, revenue_usd: 290 }
  assert.equal(equationResidual(0, profitTerms(gated)), -290)
  assert.equal(equationCloses(0, profitTerms(gated)), false)
  // The revenue equation is still fully readable for that caller.
  assert.equal(equationResidual(290, revenueTerms(gated)), 0)
})

test('buildEquation prints the sentence, drops zero terms, keeps the operators', () => {
  const fmt = (n: number) => `$${n.toFixed(2)}`
  const tr = (_k: string, fallback: string) => fallback
  assert.equal(
    buildEquation({ key: 'revenue', fallback: 'Revenue', usd: 290 }, revenueTerms(totals), fmt, tr),
    'Revenue $290.00 = Net sales $310.00 − Refunds $20.00',
  )
  assert.equal(
    buildEquation({ key: 'gross_profit', fallback: 'Gross profit', usd: 178 }, profitTerms(totals), fmt, tr),
    'Gross profit $178.00 = Revenue $290.00 − COGS $118.00 + Delivery fees charged $15.00 − Delivery paid to couriers $9.00',
  )
  const noDelivery: StatsFormulaTotals = { revenue_usd: 50, cost_usd: 20, profit_usd: 30 }
  assert.equal(
    buildEquation({ key: 'gross_profit', fallback: 'Gross profit', usd: 30 }, profitTerms(noDelivery), fmt, tr),
    'Gross profit $30.00 = Revenue $50.00 − COGS $20.00',
    'a period with no deliveries does not spend two lines saying so',
  )
})

test('buildEquation reads a negative term by its effect, never as "- $-2"', () => {
  const fmt = (n: number) => `$${n.toFixed(2)}`
  const tr = (_k: string, fallback: string) => fallback
  const refundedCourier: StatsFormulaTotals = { revenue_usd: 50, cost_usd: 20, recognized_delivery_cost_usd: -2, profit_usd: 32 }
  const text = buildEquation({ key: 'gross_profit', fallback: 'Gross profit', usd: 32 }, profitTerms(refundedCourier), fmt, tr)
  assert.equal(text, 'Gross profit $32.00 = Revenue $50.00 − COGS $20.00 + Delivery paid to couriers $2.00')
  assert.equal(equationResidual(32, profitTerms(refundedCourier)), 0)
})

// ---- the surfaces actually use it -----------------------------------------
// A shared module nobody imports fixes nothing; and the specific wrong
// sentences must be gone, not merely joined by a right one.

test('Dashboard and the Sales strip both build their formulas from this module', () => {
  for (const rel of ['src/components/dashboard/Dashboard.tsx', 'src/components/sales/Sales.tsx']) {
    const src = read(rel)
    assert.match(src, /from '\.\.\/\.\.\/utils\/statsFormulas'/, `${rel} imports the shared formulas`)
    assert.match(src, /buildEquation\(/, `${rel} renders the equation rather than writing one out`)
  }
})

test('the three wrong sentences are gone from the surfaces', () => {
  const dashboard = read('src/components/dashboard/Dashboard.tsx')
  const sales = read('src/components/sales/Sales.tsx')
  assert.ok(!dashboard.includes('net_revenue_after_refunds'), 'the double-subtracting Net-after-refunds line is deleted')
  assert.ok(!/store_paid_delivery'[^\n]*\}\s*\$\{fmtUSD\(aStoreDelivery\)\}/.test(dashboard), 'the profit sentence no longer subtracts the waived fee')
  for (const [rel, src] of [['Dashboard.tsx', dashboard], ['Sales.tsx', sales]] as const) {
    assert.ok(
      !/awaiting-payment excluded/.test(src),
      `${rel} no longer claims awaiting-payment sales are outside the money figures`,
    )
  }
})

// ---- the awaiting-payment cohort ------------------------------------------
// Lineage commit fd7c49ba put awaiting_payment sales INSIDE revenue, COGS and
// profit: the kernel's recognizedExpr is `<> 'cancelled'`, which admits them.
// Shipped sentences still told the reader the opposite, in BOTH packs. A hint
// is not decoration -- it is the definition the reader takes the number by --
// so a hint that contradicts the query is the same defect class as a wrong
// figure, and it is the one the user cannot see is wrong.
const PENDING_CLAIM_KEYS = ['stats_sales_hint', 'rpt_hint_pending', 'awaiting_payment_title']
// Phrases that DENY the cohort is inside the money figures, English and Khmer,
// because a claim corrected in one pack only is still a shipped claim.
const DENIALS = [
  'not yet counted as revenue',
  'not counted as revenue',
  'counted as revenue once paid',
  'counted as revenue when paid',
  'excluded from revenue',
  'មិនទាន់រាប់ជាចំណូល',
  'រាប់ជាចំណូលនៅពេលបានបង់',
]
const denies = (text: string): string | null =>
  DENIALS.find((d) => text.toLowerCase().includes(d.toLowerCase())) ?? null

test('POSITIVE CONTROL: the predicate catches the sentences that actually shipped', () => {
  assert.equal(denies('Awaiting Payment — not yet counted as revenue'), 'not yet counted as revenue')
  assert.equal(denies('Sales awaiting payment. Counted as revenue once paid.'), 'counted as revenue once paid')
  assert.equal(denies('រង់ចាំការទូទាត់ — មិនទាន់រាប់ជាចំណូលទេ'), 'មិនទាន់រាប់ជាចំណូល')
  assert.equal(denies('ការលក់រង់ចាំការទូទាត់។ រាប់ជាចំណូលនៅពេលបានបង់។'), 'រាប់ជាចំណូលនៅពេលបានបង់')
  // ... and stays quiet on a sentence that says the true thing, so a green
  // result below is the packs being right, not the predicate being blind.
  assert.equal(denies('Included in sales, revenue, and profit, but excluded from collected cash.'), null)
})

test('neither pack tells the reader awaiting-payment money is outside revenue', () => {
  for (const pack of ['src/lang/en.json', 'src/lang/km.json']) {
    const strings = JSON.parse(read(pack)) as Record<string, string>
    for (const key of PENDING_CLAIM_KEYS) {
      const text = strings[key]
      assert.ok(typeof text === 'string' && text.length > 0, `${pack} carries ${key}`)
      assert.equal(denies(text), null, `${pack} ${key} denies the cohort is counted: ${text}`)
    }
  }
})

// The Reports "Not Paid" memo line ships a fallback as well as a pack key, and
// a fallback that disagrees with the pack is a second sentence to get wrong.
test('the Not Paid memo line and its pack key say the same thing', () => {
  const model = read('src/components/sales/reports/reportModel.ts')
  const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
  const fallback = model.match(/'rpt_hint_pending', '([^']+)'/)?.[1]
  assert.ok(fallback, 'the memo line still passes a fallback for rpt_hint_pending')
  assert.equal(denies(fallback!), null, 'the fallback does not deny it either')
  assert.equal(en.rpt_hint_pending, fallback, 'pack and fallback are one sentence, not two')
})

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nstats formulas: all checks passed')
