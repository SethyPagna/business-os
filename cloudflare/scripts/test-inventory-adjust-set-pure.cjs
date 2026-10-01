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
const session = read('frontend/src/components/inventory/FastStockInModal.tsx')
const entry = read('frontend/src/components/stock-session/StockSessionLineEntry.tsx')
const draft = read('frontend/src/utils/stockSessionDraft.ts')

assert.match(route, /const originalType = type[\s\S]*if \(type === 'set'\)/, 'set preserves its audit identity')
assert.match(route, /const current = await branchStockQty\(c\.env, productId, branchId\)/, 'set reads the selected branch total')
assert.match(route, /const diff = quantity - current/, 'set computes the signed difference from the desired total')
assert.match(route, /type = diff > 0 \? 'add' : 'remove'/, 'positive and negative differences reuse add/remove semantics')
assert.match(route, /quantity = Math\.abs\(diff\)/, 'the stock kernel receives the absolute movement quantity')
assert.match(route, /originalType === 'set' \? 'stock_set'/, 'the audit trail still records the operator action as set')
// The old Adjust modal retired with the Stock Session (UI-STOCK, 30 Sep 2026): Set
// is now a mode of the one float. Its entry row labels the input as the total the
// lot (or branch) ends at and previews the signed difference the Worker will
// compute, and a Set that would RAISE the branch with no dated lot is refused
// there instead of sneaking in as a receipt, because raising stock is an Add.
assert.match(entry, /label=\{mode === 'set' \? tr\('set_to', 'Set to'\) : tr\('stock_line_qty', 'Qty'\)\}/, 'the set input is explicitly labelled as the total it sets to')
assert.match(draft, /export function scopedSetPreviewForLot\(quantity: string, lot: SessionLot, branchQuantity: number\)[\s\S]*targetQuantity: Number\(raw\), lotQuantity: lot\.quantity, branchQuantity/, 'the entry row previews the difference from the typed total')
assert.match(session, /const setPreview = mode === 'set' && chosenLot \? scopedSetPreviewForLot\(quantity, chosenLot, branchQuantity\) : null/, 'the session previews the exact difference for the chosen lot')
assert.match(session, /mode === 'set' && batchChoice === 'none' && Number\(quantity\) > branchQuantity[\s\S]*no_batches_for_branch/, 'a set that would raise the branch with no dated lot is refused: raising is an Add')

console.log('PASS adjust-to-total Stock Session and Worker contract')
