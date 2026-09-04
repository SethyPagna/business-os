// Pure-logic lock for the S4R3-6 report kernel additions:
//
//   (1) the two HALVES of delivery_net_usd are emitted, so the Reports income
//       statement can SHOW `revenue - COGS + delivery collected - courier cost
//       = gross profit` instead of deriving one labelled line by subtraction;
//   (2) `delivery_margin_usd` is NOT that figure and the two genuinely
//       diverge on a fixture that has an awaiting/cancelled delivery in it;
//   (3) profit_usd's definition is UNCHANGED by any of this;
//   (4) the awaiting-payment cohort is reported in full (gross, discounts,
//       revenue, delivery, COGS, profit) and foots on its own;
//   (5) no pending figure ever reaches a realised total;
//   (6) routes/reports.ts's gateTotals keeps pending COGS/profit admin-only.
//
// Runs standalone: `node scripts/test-reports-waterfall-pure.cjs`.
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const srcPath = path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts')
const src = fs.readFileSync(srcPath, 'utf8')

// Same isolation trick test-sales-analytics-pure.cjs uses: strip the two
// runtime-only imports so this compiles without the Hono/D1 stack. \r?\n so it
// works on a CRLF checkout.
const stripped = ('// @ts-nocheck\n' + src)
  .replace(/^import \{ getDb \} from '\.\/db'\r?\n/m, '')
  .replace(/^import type \{ Env \} from '\.\.\/index'\r?\n/m, '')
  .replace(/env: Env/g, 'env')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-waterfall-'))
const tsPath = path.join(tmpDir, 'salesAnalytics.ts')
fs.writeFileSync(tsPath, stripped)
fs.writeFileSync(
  path.join(tmpDir, 'businessDateWindow.ts'),
  fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'businessDateWindow.ts'), 'utf8'),
)
const tscBin = path.join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath} ${path.join(tmpDir, 'businessDateWindow.ts')}`, {
  cwd: tmpDir,
  stdio: 'inherit',
})
const lib = require(path.join(tmpDir, 'salesAnalytics.js'))

let failed = 0
const test = (name, fn) => {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e) }
}

// A level row as salesLevelTotals returns it. Deliberately built so that the
// descriptive delivery figures and the profit-bearing ones DIVERGE:
//
//   delivery_usd 30            = every customer-paid fee in the window
//   recognized_delivery_usd 10 = the recognized share of it ($20 sits on
//                                awaiting-payment sales)
//   delivery_actual_cost_usd 25= every courier payment recorded in the window
//   recognized_delivery_cost 8 = the recognized share of it
//
// so delivery_margin_usd = 30 - 25 = 5 while delivery_net_usd = 10 - 8 = 2.
// A fixture where those two coincide proves nothing (the recognized_* fields
// fall back to the descriptive ones when the caller sent no split), which is
// exactly why this one is skewed.
const level = {
  tx_count: 8,
  gross_sales_usd: 500,
  store_discount_usd: 30,
  membership_discount_usd: 10,
  tax_usd: 12,
  delivery_usd: 30,
  store_delivery_usd: 7,
  delivery_actual_cost_usd: 25,
  delivery_actual_cost_count: 3,
  delivery_sale_count: 9,
  // recognized split
  recognized_net_usd: 300,
  recognized_tax_usd: 9,
  recognized_delivery_usd: 10,
  recognized_store_delivery_usd: 4,
  recognized_delivery_cost_usd: 8,
  refund_usd: 20,
  refund_paid_out_usd: 22,
  // awaiting-payment cohort
  pending_revenue_usd: 160,
  pending_tx_count: 3,
  pending_gross_sales_usd: 180,
  pending_store_discount_usd: 15,
  pending_membership_discount_usd: 5,
  pending_delivery_usd: 20,
  pending_delivery_cost_usd: 17,
}
const totals = lib.deriveTotals(level, /* costUsd */ 120, /* returnedCostUsd */ 20, { costUsd: 70 })

test('the two halves of delivery_net_usd are emitted and reconcile to it', () => {
  assert.equal(totals.recognized_delivery_usd, 10, 'customer-paid fees on RECOGNIZED sales')
  assert.equal(totals.recognized_delivery_cost_usd, 8, 'courier money paid out on RECOGNIZED sales')
  assert.equal(totals.delivery_net_usd, 2, 'delivery_net_usd = 10 - 8')
  assert.equal(
    totals.recognized_delivery_usd - totals.recognized_delivery_cost_usd,
    totals.delivery_net_usd,
    'the halves are the terms of delivery_net_usd, not a re-derivation of it',
  )
})

test('delivery_margin_usd is a DIFFERENT figure and must never close the waterfall', () => {
  assert.equal(totals.delivery_margin_usd, 5, 'margin describes EVERY delivery in the window')
  assert.notEqual(totals.delivery_margin_usd, totals.delivery_net_usd, 'the fixture separates them on purpose')
  // Wiring delivery_margin_usd into the statement would still make it "foot"
  // -- while readmitting deliveries profit_usd never counted.
  assert.notEqual(
    totals.revenue_usd - totals.cost_usd + totals.delivery_margin_usd,
    totals.profit_usd,
    'delivery_margin_usd does not close the profit identity',
  )
})

test('the realised waterfall foots: revenue - COGS + delivery collected - courier cost = gross profit', () => {
  // revenue = 300 - 20 = 280; netCost = 120 - 20 = 100; deliveryNet = 2.
  assert.equal(totals.revenue_usd, 280)
  assert.equal(totals.cost_usd, 100, 'cost_usd is already NET of restocked returns')
  assert.equal(totals.profit_usd, 182, '280 - 100 + 10 - 8')
  assert.equal(
    totals.revenue_usd - totals.cost_usd + totals.recognized_delivery_usd - totals.recognized_delivery_cost_usd,
    totals.profit_usd,
    'every term of gross profit is on the wire',
  )
})

test("profit_usd's definition is unchanged -- the pending argument moves nothing realised", () => {
  const withoutPending = lib.deriveTotals(level, 120, 20)
  const movedPending = lib.deriveTotals(
    { ...level, pending_revenue_usd: 999, pending_delivery_usd: 999, pending_delivery_cost_usd: 999, pending_gross_sales_usd: 999 },
    120,
    20,
    { costUsd: 999 },
  )
  for (const k of ['revenue_usd', 'cost_usd', 'profit_usd', 'collected_total_usd', 'gross_sales_usd', 'delivery_net_usd', 'avg_order_usd', 'margin_pct']) {
    assert.equal(movedPending[k], withoutPending[k], `${k} is untouched by the awaiting cohort`)
  }
  assert.equal(withoutPending.profit_usd, totals.profit_usd, 'passing pending cost does not change profit')
  assert.equal(withoutPending.pending_cost_usd, 0, 'absent pending cost reads 0, never inferred')
})

test('the theoretical (awaiting-payment) block foots on its own bases', () => {
  assert.equal(totals.pending_tx_count, 3)
  assert.equal(totals.pending_gross_sales_usd, 180)
  assert.equal(
    totals.pending_gross_sales_usd - totals.pending_store_discount_usd - totals.pending_membership_discount_usd,
    totals.pending_revenue_usd,
    'unpaid gross - unpaid discounts = unpaid net sales',
  )
  assert.equal(totals.pending_cost_usd, 70)
  assert.equal(totals.pending_delivery_usd, 20)
  assert.equal(totals.pending_delivery_cost_usd, 17)
  assert.equal(totals.pending_profit_usd, 93, '160 - 70 + 20 - 17')
  assert.equal(
    totals.pending_revenue_usd - totals.pending_cost_usd + totals.pending_delivery_usd - totals.pending_delivery_cost_usd,
    totals.pending_profit_usd,
    'the pending block uses the SAME formula as the realised one',
  )
})

test('emptySalesTotals carries every new key at 0 (no undefined on an empty window)', () => {
  const empty = lib.emptySalesTotals()
  for (const k of [
    'recognized_delivery_usd', 'recognized_delivery_cost_usd', 'pending_tx_count', 'pending_gross_sales_usd',
    'pending_store_discount_usd', 'pending_membership_discount_usd', 'pending_delivery_usd',
    'pending_delivery_cost_usd', 'pending_cost_usd', 'pending_profit_usd',
  ]) {
    assert.equal(empty[k], 0, `${k} present and zero`)
  }
})

// ---- SQL shape: the pending split happens in the CASEs, not the WHERE ------

test('the shared item-cost columns keep COGS recognized-only while summing pending beside it', () => {
  const cols = lib.ITEM_COST_COLUMNS
  const clause = lib.ITEM_COST_STATUS_CLAUSE
  assert.ok(/AS cost_usd/.test(cols) && /AS pending_cost_usd/.test(cols) && /AS missing_snapshot_lines/.test(cols))
  // cost_usd is gated on the recognized expression INSIDE the CASE, so
  // relaxing the WHERE to admit awaiting rows cannot change it.
  assert.ok(
    /CASE WHEN [^\n]*NOT IN \('cancelled', 'awaiting_payment'\)[^\n]*THEN si\.cost_price_usd \* si\.quantity/.test(cols),
    'cost_usd sums recognized lines only',
  )
  assert.ok(
    /CASE WHEN [^\n]*= 'awaiting_payment'[^\n]*THEN si\.cost_price_usd \* si\.quantity/.test(cols),
    'pending_cost_usd sums awaiting lines only',
  )
  assert.ok(clause.includes("NOT IN ('cancelled', 'awaiting_payment')") && clause.includes("= 'awaiting_payment'"), 'the WHERE admits both cohorts and nothing else')
  assert.ok(!/cancelled/.test(cols.replace(/NOT IN \('cancelled', 'awaiting_payment'\)/g, '')), 'no cancelled sale reaches either sum')
})

test('the level columns carry the whole pending cohort, and every cost query uses the shared fragment', () => {
  for (const col of ['pending_tx_count', 'pending_gross_sales_usd', 'pending_store_discount_usd', 'pending_membership_discount_usd', 'pending_delivery_usd', 'pending_delivery_cost_usd']) {
    assert.ok(lib.RECOGNIZED_LEVEL_COLUMNS.includes(`AS ${col}`), `RECOGNIZED_LEVEL_COLUMNS emits ${col}`)
  }
  // Four queries measure COGS; all four must read the one fragment, or a
  // report's pending block disagrees with the Overview's.
  const uses = src.match(/\$\{ITEM_COST_COLUMNS\}/g) || []
  assert.equal(uses.length, 4, 'salesCost + period series + grouped + day rows all use ITEM_COST_COLUMNS')
  // getProductSalesRanking keeps its own COGS sum ON PURPOSE: it measures a
  // different thing (per-product `line_sales_usd - cost_usd`, no delivery
  // term, line-sales basis rather than net-sales revenue) and never feeds
  // deriveTotals. Exactly one such copy is allowed to exist; a second would
  // mean a deriveTotals path had drifted back to a hand-rolled sum.
  const handRolled = src.match(/COALESCE\(SUM\(si\.cost_price_usd \* si\.quantity\), 0\) AS cost_usd/g) || []
  assert.equal(handRolled.length, 1, 'only the product-ranking query keeps its own COGS sum')
  const rankingStart = src.indexOf('export async function getProductSalesRanking')
  assert.ok(rankingStart > 0 && src.indexOf(handRolled[0], rankingStart) > rankingStart, 'and that one copy lives inside getProductSalesRanking')
})

// ---- the permission gate --------------------------------------------------

test('gateTotals keeps pending COGS and pending profit admin-only', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'reports.ts'), 'utf8')
  const gate = routes.slice(routes.indexOf('export function gateTotals'), routes.indexOf('export function gateProductRow'))
  assert.ok(/const \{ cost_usd, profit_usd, cost_missing_snapshot_lines, pending_cost_usd, pending_profit_usd, \.\.\.rest \}/.test(gate), 'both pending money keys are destructured out before the non-admin return')
  assert.ok(gate.indexOf('if (!isAdmin) return rest') < gate.indexOf('pending_cost_usd: round2'), 'they are re-added only after the non-admin early return')
  assert.ok(gate.includes('pending_profit_usd: round2(num(pending_profit_usd))'), 'the admin branch re-adds pending profit')
  // The rest of the pending block is sale-header money and stays readable.
  assert.ok(!gate.includes('pending_revenue_usd,') && !gate.includes('pending_gross_sales_usd,'), 'unpaid revenue/gross are not gated (they never were)')
})

if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nreports-waterfall kernel: all tests passed')
