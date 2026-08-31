// Pure-logic regression test for lib/salesAnalytics.ts's revenue/COGS/
// profit model. Runs directly via `node scripts/test-sales-analytics-pure.cjs`
// (transpiled inline, no D1 binding needed) -- exercises deriveTotals() and
// previousPeriodFilters() against hand-built inputs that specifically
// reproduce the bug this file replaced: a per-period SUM(sales.total_usd)
// joined against sale_items would inflate revenue/tax/delivery by however
// many line items a sale has. deriveTotals() takes sale-level sums and an
// already-separately-aggregated cost figure, so it can't reproduce that.
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const srcPath = path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts')
const src = fs.readFileSync(srcPath, 'utf8')

// Strip the two type-only imports (getDb/Env) so this file can run
// standalone under plain Node without pulling in the Hono/D1 stack, then
// transpile with the TypeScript compiler already used elsewhere in this
// repo's test scripts.
const stripped = ('// @ts-nocheck\n' + src)
  .replace(/^import \{ getDb \} from '\.\/db'\n/m, '')
  .replace(/^import type \{ Env \} from '\.\.\/index'\n/m, '')
  .replace(/env: Env/g, 'env')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-analytics-'))
const tsPath = path.join(tmpDir, 'salesAnalytics.ts')
fs.writeFileSync(tsPath, stripped)
// salesAnalytics.ts imports ./businessDateWindow (the UTC+7 helpers); copy that
// pure dependency in so the isolated compile resolves and emits it.
const winPath = path.join(tmpDir, 'businessDateWindow.ts')
fs.writeFileSync(winPath, fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'businessDateWindow.ts'), 'utf8'))
const tscBin = path.join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath} ${winPath}`, {
  cwd: tmpDir,
  stdio: 'inherit',
})
const lib = require(path.join(tmpDir, 'salesAnalytics.js'))

// ---- deriveTotals: basic definitions ----
{
  const level = {
    tx_count: 3,
    gross_sales_usd: 100,
    store_discount_usd: 5,
    membership_discount_usd: 2,
    tax_usd: 4,
    delivery_usd: 6,        // customer-paid delivery (already excludes store-paid, per the SQL CASE)
    store_delivery_usd: 3,  // store-absorbed delivery -- a cost, not revenue
  }
  const totals = lib.deriveTotals(level, /* costUsd */ 20)
  assert.equal(totals.discount_usd, 7, 'discount_usd = store + membership')
  assert.equal(totals.revenue_usd, 93, 'revenue_usd = gross_sales - discount (excludes tax/delivery)')
  assert.equal(totals.collected_total_usd, 103, 'collected_total = revenue + tax + customer-paid delivery')
  assert.equal(totals.profit_usd, 70, 'profit = revenue - cost - store-paid delivery (93 - 20 - 3)')
  assert.equal(totals.avg_order_usd, Math.round((93 / 3) * 100) / 100, 'avg_order = revenue / tx_count')
}

// ---- deriveTotals: the fan-out bug this replaces can't reproduce here ----
// A 3-item sale used to inflate SUM(sales.total_usd) 3x when joined to
// sale_items and grouped by period. Simulate a period bucket that contains
// exactly one sale with 3 line items: the *level* aggregate (this file's
// query never joins sale_items for these fields) reports the sale's true
// totals once, not 3x, and cost is a genuinely separate item-level sum.
{
  const oneSaleThreeItems = {
    tx_count: 1,
    gross_sales_usd: 50,     // the one sale's real subtotal, not 150
    store_discount_usd: 0,
    membership_discount_usd: 0,
    tax_usd: 5,               // real tax once, not 15
    delivery_usd: 0,
    store_delivery_usd: 0,
  }
  const realCostAcrossThreeItems = 12 + 8 + 4 // three distinct line costs, genuinely summed
  const totals = lib.deriveTotals(oneSaleThreeItems, realCostAcrossThreeItems)
  assert.equal(totals.revenue_usd, 50, 'revenue for a multi-item sale must equal its real subtotal, not subtotal * item_count')
  assert.equal(totals.tax_usd, 5, 'tax for a multi-item sale must not be multiplied by item count')
  assert.equal(totals.cost_usd, 24, 'cost is a genuine per-item sum (12+8+4), unrelated to the fan-out bug')
  assert.equal(totals.profit_usd, 26, 'profit = revenue - cost (50 - 24), not deflated/inflated by item count')
}

// ---- P6: delivery actual cost is display-only and never moves profit ----
{
  const level = {
    tx_count: 4, gross_sales_usd: 100, store_discount_usd: 0, membership_discount_usd: 0,
    tax_usd: 0, delivery_usd: 12, store_delivery_usd: 3,
    delivery_actual_cost_usd: 9, delivery_actual_cost_count: 3, delivery_sale_count: 4,
  }
  const totals = lib.deriveTotals(level, 20)
  assert.equal(totals.delivery_actual_cost_usd, 9, 'actual courier cost sums straight through')
  assert.equal(totals.delivery_margin_usd, 3, 'margin = customer-charged delivery (12) - actual cost (9)')
  assert.equal(totals.delivery_actual_cost_count, 3, 'how many sales actually recorded a cost')
  assert.equal(totals.delivery_sale_count, 4, 'vs how many deliveries there were -- the gap is visible')
  assert.equal(totals.profit_usd, 77, 'profit stays revenue - cost - store-paid delivery (100-20-3): actual cost is display-only until an explicit decision folds it in')
}
{
  // No actual costs recorded at all (every historical sale): zeros, not NaN.
  const totals = lib.deriveTotals({ tx_count: 1, gross_sales_usd: 10, delivery_usd: 2 }, 0)
  assert.equal(totals.delivery_actual_cost_usd, 0)
  assert.equal(totals.delivery_margin_usd, 2)
  assert.equal(totals.delivery_actual_cost_count, 0)
}

// ---- previousPeriodFilters: same-length window shifted immediately before ----
{
  const prev = lib.previousPeriodFilters({ startDate: '2026-08-08', endDate: '2026-08-14' })
  assert.equal(prev.endDate, '2026-08-07', 'previous period ends the day before the current period starts')
  assert.equal(prev.startDate, '2026-08-01', 'previous period is the same length (7 days) as the current one')
}
{
  const prev = lib.previousPeriodFilters({ startDate: '2026-08-07', endDate: '2026-08-07' })
  assert.equal(prev.endDate, '2026-08-06', 'single-day previous period ends the day before')
  assert.equal(prev.startDate, '2026-08-06', 'single-day previous period is also one day long')
}

console.log('PASS sales analytics revenue/COGS/profit model')
