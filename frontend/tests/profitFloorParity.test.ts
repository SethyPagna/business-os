// Audit findings sibling:F14 / sibling:F15 -- the profit-floor lane.
//
// F14: the Inventory products list styled a NEGATIVE profit that the detail
// pane opened from the same row clamped to 0. Both surfaces read ONE row
// object (Inventory.tsx hands the list row straight to the pane via
// `onOpenDetail={setDetailProduct}`), so a disagreement is never two payloads:
// it is the pane clamping a figure the list renders raw. The pane clamps FOUR
// cells -- Net sold, Revenue, COGS (`Math.max(0, ...)` each) and the profit
// built on the last two -- and the list renders all four as they come, so the
// two surfaces disagree on any cell the server can send negative. All four are
// pinned below; pinning only three is how the uncapped qty_sold column
// survived a round of this lane.
//
// The owner rule (N6) is that such a figure is a scoping defect to root-cause,
// never a display floor, so the fix is in the Worker's per-product ledger and
// this file pins BOTH ends of it: the Worker's guarantee, and this surface not
// quietly acquiring a clamp of its own once the guarantee exists.
//
// F15: the Dashboard carried a FOURTH profit definition -- cost_out - cost_in,
// stock movement valued at cost -- that nothing read, so a reader comparing
// formulas met a dead one before the real one.
import assert from 'node:assert/strict'
import fs from 'node:fs'

// The "no clamp on this side" assertions have to read CODE, not prose. The
// list's own comment quotes the pane's clamp verbatim to explain why it is a
// no-op, and the first version of the operand assertion below tripped on that
// comment -- a red with no defect behind it. Stripping comments keeps the
// assertion pointed at code: verified to still catch a clamp added as code.
const stripComments = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

const surface = fs.readFileSync(new URL('../src/components/inventory/InventoryProductsSurface.tsx', import.meta.url), 'utf8')
const pane = fs.readFileSync(new URL('../src/components/inventory/ProductDetailModal.tsx', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
const dashboard = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
const workerRoute = fs.readFileSync(new URL('../../cloudflare/src/routes/inventory.ts', import.meta.url), 'utf8')
const workerLedger = fs.readFileSync(new URL('../../cloudflare/src/lib/productSalesLedger.ts', import.meta.url), 'utf8')

// ---- F15: one profit definition in the Dashboard, not two ------------------
assert.doesNotMatch(dashboard, /const\s+profit\s*=\s*\(summary\?\.cost_out/,
  'the dead cost_out - cost_in "profit" is gone: it was stock movement valued at cost, read by nothing, and it met the reader before the real formula')
assert.doesNotMatch(dashboard, /\n\s*const\s+profit\s*=/,
  'no bare `profit` binding survives under any definition -- the component reads aProfit')
assert.match(dashboard, /const aProfit\s*=\s*analytics\?\.totals\?\.profit_usd/,
  'the one profit this component renders is the sales kernel\'s')
assert.match(dashboard, /dashboard_formula_profit/,
  'and it is the one the profit card explains')

// ---- F14: the list and the pane are the same number ------------------------
// The pane's formula, verbatim from ProductDetailModal.tsx.
assert.match(pane, /const profit = Math\.max\(0, p\.revenue_usd \|\| 0\) - Math\.max\(0, p\.cogs_usd \|\| 0\)/,
  'the pane clamps each operand -- that is the formula the list has to agree with')
// The list passes the server's figure straight through, unclamped.
assert.match(surface, /money\(metric\(product, 'profit_usd'\), null, profitTone\(metric\(product, 'profit_usd'\)\)\)/,
  'the list renders the server profit as it comes')
assert.doesNotMatch(stripComments(surface), /Math\.max\(0,[^)]*profit/,
  'the list must NOT acquire a display floor of its own: a wrong negative is a ledger defect, and flooring it here would hide the next one')
assert.match(inventory, /onOpenDetail=\{setDetailProduct\}/,
  'the pane opens on the very row object the list rendered, so any disagreement is arithmetic, not two payloads')

// Profit was not the only cell that disagreed. The pane clamps the two
// OPERANDS as well, and Net sold, and the list renders all three raw (they are
// InventoryProductRow metrics in their own right), so on the old ledger a
// product read "-$100" for Revenue in the list and "$0" in the pane. Pin every
// one of the pane's four clamps: the no-op claim has to cover the whole
// Performance row, not the columns that happened to get fixed first.
assert.match(pane, /fmtUSD\(Math\.max\(0, p\.revenue_usd \|\| 0\)\)/,
  'the pane clamps Revenue too')
assert.match(pane, /fmtUSD\(Math\.max\(0, p\.cogs_usd \|\| 0\)\)/,
  'the pane clamps COGS too')
assert.match(pane, /Math\.max\(0, p\.qty_sold \|\| 0\)/,
  'the pane clamps Net sold too -- the unit count is a cell of the same row and carries the same invariant as the money')
for (const metric of ['revenue_usd', 'cogs_usd', 'qty_sold'] as const) {
  assert.ok(surface.includes(`'${metric}'`),
    `the list renders ${metric} as its own cell, so it had to agree with the pane's clamp of it as well`)
}
assert.doesNotMatch(stripComments(surface), /Math\.max\(0,[^)]*(revenue|cogs|qty_sold)/,
  'and the list still must not floor an operand, or the unit count, on its own account')

// The two formulas over the domain the Worker now guarantees, and over the one
// it used to allow. This is the whole finding in four lines: identical wherever
// revenue and COGS are non-negative, divergent the moment either is not --
// which is why the fix had to be the ledger and not a clamp on this side.
const listProfit = (revenue: number, cogs: number) => revenue - cogs
const paneProfit = (revenue: number, cogs: number) => Math.max(0, revenue) - Math.max(0, cogs)
for (const [revenue, cogs] of [[0, 0], [120, 45], [5, 9], [0, 12], [7.5, 7.5]]) {
  assert.equal(listProfit(revenue, cogs), paneProfit(revenue, cogs),
    `list and pane agree on the guaranteed domain (revenue ${revenue}, cogs ${cogs}) -- including a genuine below-cost loss, which both report as a loss`)
}
assert.notEqual(listProfit(-100, -15), paneProfit(-100, -15),
  'and they diverge on exactly what the old ledger could emit: -85 in the list, 0 in the pane')

// ---- F14: the Worker guarantee the agreement rests on ----------------------
assert.match(workerLedger, /export function buildProductSalesLedgerSql/,
  'the per-product sales ledger is one implementation the routes share')
assert.equal((workerRoute.match(/buildProductSalesLedgerSql\(/g) || []).length, 4,
  'all four Inventory product financial surfaces go through it -- the list, both /products paths and /stats')
assert.doesNotMatch(workerRoute, /localDateAtOrAfter\('r\.created_at'\)/,
  'a refund is scoped by the SALE it reverses, never by the return\'s own date -- that is what subtracted a refund from a window that never recognised the sale')
assert.doesNotMatch(workerRoute, /return_to_stock = 1/,
  'the restock test is lib/returnsStock.ts\'s rule (RESTOCKED_RETURN_LINE), not a hand-written boolean that misses stock_action')
assert.match(workerLedger, /JOIN sales s ON s\.id = r\.sale_id/,
  'the return side joins through the sale, which is what carries the recognition and window scope onto it -- branch is NOT among them: `si.branch_id = @branchId` is a sale-LINE clause, and nothing on the return side inherits it')
assert.match(workerLedger, /SUM\(l\.qty_sold\) OVER \(PARTITION BY l\.sale_id, l\.product_id\)/,
  'so the branch-scoped read apportions each return across the sale\'s branch lines instead, against a denominator that deliberately ignores the branch filter -- subtracting the whole return at every branch is what reported Net sold -2')
assert.match(workerLedger, /groupShare\('rg\.refund_usd', 'rg\.named_net_usd', 'sb\.net_usd', 'sb\.sale_net_usd'\)/,
  'and each column is apportioned against its OWN denominator: money by the share of the net VALUE a branch recognised, never by its share of the UNITS -- a $50 refund over 1 unit at $1 and 1 unit at $99 is $0.50 and $49.50, not $25 each')
assert.match(workerLedger, /MIN\(sold\.net_usd, COALESCE\(ret\.refund_usd, 0\)\)/,
  'a reversal is capped at what the sale recognised for that product, so revenue_usd >= 0 by construction')
assert.match(workerLedger, /MAX\(0, sold\.cogs_usd - COALESCE\(ret\.cogs_returned_usd, 0\)\)/,
  'and returned cost cannot drive COGS below zero')
assert.match(workerLedger, /ORDER BY share\.order_frac DESC/,
  'and the unit spill is allocated by largest remainder, so Net sold -- which this list renders with no formatting at all, unlike the money cells -- stays a whole number instead of "1.8"')
assert.match(workerLedger, /MIN\(sold\.qty_sold, COALESCE\(ret\.qty_returned, 0\)\)/,
  'the UNIT reversal carries the same residual cap as the money, for the one case apportionment cannot reach: a return line taking back more than the sale recognised for the product at all')

console.log('profit floor parity (list vs pane, one Dashboard formula) tests passed')
