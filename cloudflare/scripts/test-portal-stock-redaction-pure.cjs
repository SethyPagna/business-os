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
  const calls = src.match(/await attachPortalStockStatus\(/g) || []
  if (calls.length < 2) throw new Error(`bootstrap AND search must both attach+redact (found ${calls.length} call sites)`)
})

test('raw stock fields are destructured OFF the public row, never spread back', () => {
  assertMatch(/stock_quantity: rawQuantity,\s*\n\s*low_stock_threshold: rawLow,\s*\n\s*out_of_stock_threshold: rawOut,\s*\n\s*branch_stock: _neverServed,\s*\n\s*\.\.\.publicFields/, 'the helper must strip stock_quantity/thresholds/branch_stock via rest-destructuring before building the public row')
  assertMatch(/\.\.\.publicFields,\s*\n\s*stock_status:/, 'the public row is publicFields + computed statuses only')
})

test('the status rule matches the storefront badge math (out<=outThreshold, low<=lowThreshold default 10)', () => {
  assertMatch(/if \(quantity <= outThreshold\) return 'out_of_stock'/)
  assertMatch(/if \(quantity <= lowThreshold\) return 'low_stock'/)
  assertMatch(/Number\(rawOut \|\| 0\)/)
  assertMatch(/Number\(rawLow \|\| 10\)/)
})

test('the merchant global-threshold mode is honored server-side', () => {
  assertMatch(/customer_portal_stock_threshold_mode/, 'global vs per-product threshold mode must be read from settings')
  assertMatch(/customer_portal_low_stock_threshold/)
  assertMatch(/customer_portal_out_of_stock_threshold/)
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
