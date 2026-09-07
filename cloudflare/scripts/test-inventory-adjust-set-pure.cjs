const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Anchored to this file, not to the caller's cwd. These paths used to be
// relative, so the suite passed when swept from `cloudflare/` and threw ENOENT
// when swept from `cloudflare/scripts/` -- which is the directory CLAUDE.md's
// own documented sweep command cds into. Three lanes independently reported the
// resulting false RED. A test's location is a property of the test, not of
// wherever someone happened to run it from.
const repo = path.resolve(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8')

const route = read('cloudflare/src/routes/inventory.ts')
const modal = read('frontend/src/components/inventory/InventoryStockModals.tsx')

assert.match(route, /const originalType = type[\s\S]*if \(type === 'set'\)/, 'set preserves its audit identity')
assert.match(route, /const current = await branchStockQty\(c\.env, productId, branchId\)/, 'set reads the selected branch total')
assert.match(route, /const diff = quantity - current/, 'set computes the signed difference from the desired total')
assert.match(route, /type = diff > 0 \? 'add' : 'remove'/, 'positive and negative differences reuse add/remove semantics')
assert.match(route, /quantity = Math\.abs\(diff\)/, 'the stock kernel receives the absolute movement quantity')
assert.match(route, /originalType === 'set' \? 'stock_set'/, 'the audit trail still records the operator action as set')
assert.match(modal, /requestedSetTotal - adjustCurrentQuantity/, 'the main adjust modal previews the exact server-side difference')
assert.match(modal, /adjustForm\.type === 'set'[\s\S]*adjust_set[\s\S]*stock[\s\S]*total/, 'the set input is explicitly labelled as a final stock total')
// N14-D: a set that RAISES a branch's stock is a receipt on the live surface
// (routes/inventory.ts converts it into an add of the difference, proven
// above), so the Δ-line block that previews the total-to-difference meaning
// must also carry the receipt hint under the same isStockIn predicate the
// supplier/cost fields render on -- otherwise a raising set previews the
// right number while never telling the operator it now owes a supplier and
// a cost.
assert.match(modal, /isStockIn \? \(\s*\n\s*<InfoHint[^>]*stock_set_up_hint/, 'a raising set previews the receipt hint next to the total-to-difference meaning')

console.log('PASS adjust-to-total UI and Worker contract')
