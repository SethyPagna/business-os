const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

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
assert.match(route, /if \(body\.setScope !== undefined\)[\s\S]*applyStockLotSet/, 'explicit scope uses the durable correction kernel before the legacy branch-total path')
assert.match(modal, /scopedSetPreview\(\{\s*scope: setScope,\s*targetQuantity: requestedSetTotal,\s*lotQuantity: selectedBatchOption\.quantity,\s*branchQuantity: adjustCurrentQuantity/, 'the modal passes the selected lot and branch independently into the actual preview helper')
assert.match(modal, /stock_set_scope_lot[\s\S]*stock_set_scope_branch/, 'the two target scopes are explicitly labelled')
assert.match(modal, /setPreview\.beforeLotQuantity[\s\S]*setPreview\.afterLotQuantity[\s\S]*setPreview\.beforeBranchQuantity[\s\S]*setPreview\.afterBranchQuantity/, 'both lot and branch before/after are visible')

// Execute the production pure helper, not a second implementation of the UI
// formula. Explicit scopes are corrections; omitted scope keeps N14-D legacy
// receipt rules. Requiring the retired raising-set receipt hint on the new
// correction UI would incorrectly classify corrections as purchases.
const helperSource = read('frontend/src/utils/stockReceiptFields.ts')
const compiled = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const helper = { exports: {} }
new Function('exports', 'module', compiled)(helper.exports, helper)
const { scopedSetPreview, isStockInSubmission, isSetDownSubmission, stockAdjustQuantityError } = helper.exports
for (const [scope, target, delta, afterLot, afterBranch, valid] of [
  ['lot', 5, 2, 5, 12, true],
  ['branch', 5, -5, -2, 5, false],
  ['branch', 9, -1, 2, 9, true],
  ['lot', 0, -3, 0, 7, true],
  ['lot', 3, 0, 3, 10, true],
  ['branch', 10, 0, 3, 10, true],
  ['lot', 2.5, -0.5, 2.5, 9.5, true],
]) {
  assert.deepEqual(scopedSetPreview({ scope, targetQuantity: target, lotQuantity: 3, branchQuantity: 10 }), {
    scope, targetQuantity: target, beforeLotQuantity: 3, beforeBranchQuantity: 10,
    delta, afterLotQuantity: afterLot, afterBranchQuantity: afterBranch, valid,
  }, `${scope} target ${target} preserves distinct lot/branch arithmetic`)
  assert.equal(isStockInSubmission('set', target, 10, scope), false, 'scoped correction never invents a receipt')
}
assert.equal(isStockInSubmission('set', 12, 10), true, 'omitted-scope raising set remains a legacy receipt')
assert.equal(isStockInSubmission('set', 9, 10), false, 'omitted-scope decreasing set is not a receipt')
assert.equal(isSetDownSubmission('set', 9, 10), true, 'legacy branch-total set-down semantics remain intact')
assert.equal(isStockInSubmission('add', 1, 10, 'lot'), true, 'ordinary add remains a receipt')
assert.notEqual(stockAdjustQuantityError('set', ''), null, 'blank target must not be treated as zero')
assert.equal(stockAdjustQuantityError('set', 0), null, 'an explicit zero target remains valid')

console.log('PASS legacy branch-total Worker contract and executable scoped lot/branch UI preview parity')
