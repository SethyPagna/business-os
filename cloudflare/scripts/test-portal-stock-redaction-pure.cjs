#!/usr/bin/env node
// Locks the public-storefront stock redaction boundary (routes/portal.ts
// attachPortalStockStatus). The portal used to embed raw stock_quantity,
// low/out-of-stock thresholds and per-branch quantity ledgers in the public
// bootstrap HTML and every search response -- internal inventory intel any
// visitor could read. The fix computes a coarse stock_status (+ per-branch
// availability statuses) server-side and STRIPS the raw fields before the
// payload leaves the worker. These pins keep that boundary from silently
// regressing (e.g. someone re-adding branch_stock "for the frontend").
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const src = readFileSync(join(__dirname, '..', 'src', 'routes', 'portal.ts'), 'utf8')

let failed = 0
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed += 1; console.error(`FAIL ${name}`); console.error(e.message) }
}
function assertMatch(pattern, message) {
  if (!pattern.test(src)) throw new Error(message || `expected portal.ts to match ${pattern}`)
}
function assertNoMatch(pattern, message) {
  if (pattern.test(src)) throw new Error(message || `expected portal.ts NOT to match ${pattern}`)
}

test('the quantity-shipping attach helper is gone', () => {
  assertNoMatch(/attachPortalBranchStock/, 'attachPortalBranchStock must not come back -- it shipped raw per-branch quantities to shoppers')
})

test('both public product paths run the redacting status attach', () => {
  // p6/efficiency-3: both call sites now run inside `Promise.all([...])`
  // fanned out alongside their independent A-Z rail query, so the call is
  // `attachPortalStockStatus(` (the `await` is on the whole array), not a
  // standalone `await attachPortalStockStatus(`. Either shape still means
  // the promise is awaited before the response leaves the worker.
  const calls = src.match(/(?:await\s+)?attachPortalStockStatus\(/g) || []
  if (calls.length < 2) throw new Error(`bootstrap AND search must both attach+redact (found ${calls.length} call sites)`)
})

test('raw stock fields are destructured OFF the public row, never spread back', () => {
  assertMatch(/stock_quantity: rawQuantity,\s*\n\s*low_stock_threshold: rawLow,\s*\n\s*out_of_stock_threshold: rawOut,\s*\n\s*branch_stock: _neverServed,\s*\n\s*\.\.\.publicFields/, 'the helper must strip stock_quantity/thresholds/branch_stock via rest-destructuring before building the public row')
  assertMatch(/\.\.\.publicFields,\s*\n\s*stock_status:/, 'the public row is publicFields + computed statuses only')
})

// The behaviour (every settings combination, badge and filter) is pinned by test-portal-low-stock-parity-pure.cjs; these are the source-shape floor.
function mustInclude(text, message) {
  if (!src.includes(text)) throw new Error(message || `expected portal.ts to contain ${text}`)
}
function mustNotInclude(text, message) {
  if (src.includes(text)) throw new Error(message || `expected portal.ts NOT to contain ${text}`)
}

test("the status rule is the storefront's own levels (website levels, else the shop's setting), never a literal 10", () => {
  mustInclude("const out = rule.out ?? (Number.isFinite(productOut) ? productOut : 0)")
  mustInclude("const low = rule.low ?? effectiveLowStockThreshold(rule.shop, rawLow)")
  // The old private math: a literal 10 fallback.
  mustNotInclude('Number(rawLow || 10)', 'the storefront must not carry its own low fallback of 10')
  mustNotInclude('COALESCE(p.low_stock_threshold, 10)', 'the stock-state filter must use lowStockThresholdSql')
  mustNotInclude('?? 10', 'no literal-10 fallback on the storefront')
  // The Website Editor's levels are read (owner decision of 16 Nov 2026) and named in the decision record.
  for (const key of ['customer_portal_stock_threshold_mode', 'customer_portal_low_stock_threshold', 'customer_portal_out_of_stock_threshold']) {
    mustInclude(key, `the storefront reads the website level ${key}`)
  }
  mustInclude('by owner decision of 16 Nov 2026', "the decision record stays in the code comment")
})

test('the rule rides in the existing settings reads: no separate low-stock config call on the portal', () => {
  mustNotInclude('loadLowStockConfig', 'a separate loadLowStockConfig call would add a D1 call per public request (portal-bootstrap 20 -> 21)')
  mustInclude("WHERE key IN ('customer_portal_show_stock_status', ${portalStockRuleKeysSql()})", 'attachPortalStockStatus reads the rule rows in its own settings read')
  mustInclude("'customer_portal_show_prices', ${portalStockRuleKeysSql()})", 'the search settings read carries the rule rows')
  mustInclude("lowStockThresholdSql(rule.shop, 'p.low_stock_threshold')")
  mustInclude('buildPortalProductFilters(query, allowStockStateFilter, showOutOfStockProducts, stockRule)', 'search must hand the rule to the filter')
  mustInclude("buildPortalProductFilters({ ...query, initial: 'all' }, allowStockStateFilter, showOutOfStockProducts, stockRule)", 'the A-Z rail must filter by the same rule')
  mustInclude('resolvePortalStockRule(settings))', 'the AI route resolves the rule from its own settings read')
  mustInclude('rule.low ?? effectiveLowStockThreshold(rule.shop, row.low_stock_threshold)', 'the AI mapping (behaviour pinned by test-portal-ai-stock-status-pure.cjs)')
})

test('branch availability carries statuses only -- no quantities, no branch names', () => {
  const attachBody = src.slice(src.indexOf('async function attachPortalStockStatus'), src.indexOf('async function buildPortalMeta'))
  if (!attachBody.includes('branch_availability: branchRows.map((branch) => ({')) throw new Error('branch_availability must be built per active branch')
  if (!/branch_id: branch\.id,\s*\n\s*status: portalStockStatusFor\(/.test(attachBody)) throw new Error('each branch entry is {branch_id, status} only')
  const emit = attachBody.slice(attachBody.indexOf('branch_availability:'))
  // A `quantity:` PROPERTY would re-leak the ledger (the lookup map's name
  // `quantityByProductBranch` is fine -- it stays server-side).
  if (/\bquantity:/.test(emit.slice(0, emit.indexOf(']')))) throw new Error('branch_availability must not carry a quantity field')
})

if (failed > 0) { console.error(`${failed} test(s) failed`); process.exit(1) }
console.log('\nAll portal stock-redaction pins passed')
