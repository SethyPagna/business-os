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
const branchAdjuster = read('frontend/src/components/products/forms/BranchStockAdjuster.tsx')

assert.match(route, /const originalType = type[\s\S]*if \(type === 'set'\)/, 'set preserves its audit identity')
assert.match(route, /const current = await branchStockQty\(c\.env, productId, branchId\)/, 'set reads the selected branch total')
assert.match(route, /const diff = quantity - current/, 'set computes the signed difference from the desired total')
assert.match(route, /type = diff > 0 \? 'add' : 'remove'/, 'positive and negative differences reuse add/remove semantics')
assert.match(route, /quantity = Math\.abs\(diff\)/, 'the stock kernel receives the absolute movement quantity')
assert.match(route, /originalType === 'set' \? 'stock_set'/, 'the audit trail still records the operator action as set')
assert.match(modal, /requestedSetTotal - adjustCurrentQuantity/, 'the main adjust modal previews the exact server-side difference')
assert.match(modal, /adjustForm\.type === 'set'[\s\S]*adjust_set[\s\S]*stock[\s\S]*total/, 'the set input is explicitly labelled as a final stock total')
assert.match(branchAdjuster, /row\.type === 'set'[\s\S]*current_stock[\s\S]*parseStockDelta\(row\.delta\) - row\.current/, 'the per-branch editor exposes the same total-to-difference meaning')

console.log('PASS adjust-to-total UI and Worker contract')
