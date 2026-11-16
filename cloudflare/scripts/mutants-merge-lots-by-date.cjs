'use strict'
// Mutation check for the 16 Nov 2026 "merge lots by received date" rule. NOT a test-*.cjs on purpose: it runs the
// native test once per mutant (each a copy of src/ with one rule broken), so the release sweep does not pay for it.
//
//   node scripts/mutants-merge-lots-by-date.cjs
//
// Every mutant MUST turn test-merge-by-received-date-native.cjs (or the pure test) red; a mutant that stays green means
// the test cannot tell the right implementation from that wrong one, and this script exits non-zero.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'src')
const TESTS = ['test-merge-lots-by-date-pure.cjs', 'test-merge-by-received-date-native.cjs']

const MUTANTS = [
  { name: 'match by batch_key again', file: 'lib/productMergeLots.ts',
    from: /mergeLotReceivedDate\(lot\.received_at\)/g, to: "(String(lot.batch_key ?? '') || null)" },
  { name: 'match by the UTC date instead of the business date', file: 'lib/productMergeLots.ts',
    from: 'const local = localDateOf(text)', to: 'const local = text.slice(0, 10)' },
  { name: 'cost mean includes a zero cost', file: 'lib/productMergeLots.ts',
    from: 'return Number.isFinite(cost) && cost > 0 ? cost : null', to: 'return Number.isFinite(cost) && cost >= 0 ? cost : null' },
  { name: 'latest expiry instead of earliest', file: 'lib/productMergeLots.ts',
    from: '(value < earliest ? value : earliest)', to: '(value > earliest ? value : earliest)' },
  { name: 'the highest batch_number takes a same-day match', file: 'lib/productMergeLots.ts',
    from: 'return left !== right ? left - right : Number(a.id) - Number(b.id)', to: 'return left !== right ? right - left : Number(a.id) - Number(b.id)' },
  { name: 'the source lot is deleted', file: 'routes/products.ts',
    from: "statements.push({ sql: 'UPDATE product_batches SET is_active = 0, merge_deactivated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id: batchRow.id } })\n      foldedBatches.push({",
    to: "statements.push({ sql: 'DELETE FROM product_batches WHERE id = @id', params: { id: batchRow.id } })\n      foldedBatches.push({" },
  { name: 'the kept lot cost and expiry are never written', file: 'routes/products.ts',
    from: 'if (keeperLotPlan.costChanged || keeperLotPlan.expiryChanged) {', to: 'if (false) {' },
  { name: 'allocations are not re-pointed to the kept lot', file: 'routes/products.ts',
    from: "statements.push({ sql: 'UPDATE sale_item_batch_allocations SET batch_id = @keeperBatchId WHERE batch_id = @dupBatchId'",
    to: "statements.push({ sql: 'SELECT 1 /* UPDATE sale_item_batch_allocations SET batch_id = @keeperBatchId WHERE batch_id = @dupBatchId */'" },
  { name: 'a created lot keeps a clashing batch_key', file: 'routes/products.ts',
    from: 'const batchKeyOnKeeper = canonicalBatchKeys.has(String(batchRow.batch_key))', to: 'const batchKeyOnKeeper = false && canonicalBatchKeys.has(String(batchRow.batch_key))' },
  { name: 'undo skips the kept lot cost', file: 'lib/undoAppliers.ts',
    from: 'SET unit_cost_usd = @cost, expiry_date = @expiry,', to: 'SET unit_cost_usd = unit_cost_usd + 0 * COALESCE(@cost, 0), expiry_date = @expiry,' },
  { name: 'undo skips the kept lot expiry', file: 'lib/undoAppliers.ts',
    from: 'expiry_date = @expiry,\n                is_active', to: 'expiry_date = expiry_date || substr(@expiry, 1, 0),\n                is_active' },
  { name: 'the credit reminder filters is_active = 1 again', file: 'routes/notifications.ts',
    from: 'WHERE (pb.is_active = 1 OR (pb.merge_deactivated_at IS NOT NULL AND pb.merge_payable_moved IS NULL))', to: 'WHERE pb.is_active = 1' },
  { name: 'the merge does not mark the lots it deactivates', file: 'routes/products.ts', all: true,
    from: 'SET is_active = 0, merge_deactivated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = @id', to: 'SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id' },
  { name: 'undo leaves the merge marker on a reactivated lot', file: 'lib/undoAppliers.ts', all: true,
    from: 'SET is_active = 1, merge_deactivated_at = NULL, merge_payable_moved = NULL, updated_at', to: 'SET is_active = 1, updated_at' },
  // Single-lot lines (sale_items.batch_id / return_items.batch_id) follow the lot: only the single-lot test needs to run.
  { name: 'sale_items.batch_id is not re-pointed to the kept lot', file: 'routes/products.ts', tests: ['test-merge-single-lot-lines-native.cjs'],
    from: "'UPDATE sale_items SET batch_id = @keeperBatchId WHERE batch_id = @dupBatchId'", to: "'SELECT 1 /* UPDATE sale_items SET batch_id = @keeperBatchId WHERE batch_id = @dupBatchId */'" },
  { name: 'return_items.batch_id is not re-pointed to the kept lot', file: 'routes/products.ts', tests: ['test-merge-single-lot-lines-native.cjs'],
    from: "'UPDATE return_items SET batch_id = @keeperBatchId WHERE batch_id = @dupBatchId'", to: "'SELECT 1 /* UPDATE return_items SET batch_id = @keeperBatchId WHERE batch_id = @dupBatchId */'" },
  { name: 'undo skips putting sale_items.batch_id back', file: 'lib/undoAppliers.ts', tests: ['test-merge-single-lot-lines-native.cjs'],
    from: 'chunk(intIds(fb.saleItemIds), 400)', to: 'chunk([], 400)' },
  { name: 'undo skips putting return_items.batch_id back', file: 'lib/undoAppliers.ts', tests: ['test-merge-single-lot-lines-native.cjs'],
    from: 'chunk(intIds(fb.returnItemIds), 400)', to: 'chunk([], 400)' },
  // Owner rules 5 and 6 Oct: quantity-weighted cost, $0/unknown not weighted, 4 places, supplier follows the lot that has one.
  { name: 'plain mean instead of the quantity-weighted average', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs', 'test-merge-by-received-date-native.cjs'],
    from: 'return weightedMeanMoney4(bearing.map((lot) => ({ amount: lot.cost, factor: lot.quantity })), totalQuantity)', to: 'return meanMoney4(bearing.map((lot) => lot.cost))' },
  { name: 'the folded cost is stored without the 4-place rounding', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs', 'test-merge-by-received-date-native.cjs'],
    from: 'return weightedMeanMoney4(bearing.map((lot) => ({ amount: lot.cost, factor: lot.quantity })), totalQuantity)', to: 'return bearing.reduce((sum, lot) => sum + lot.cost * lot.quantity, 0) / totalQuantity' },
  { name: 'a $0 cost is weighted like a real one', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs', 'test-merge-by-received-date-native.cjs'],
    from: 'return Number.isFinite(cost) && cost > 0 ? cost : null', to: 'return Number.isFinite(cost) && cost >= 0 ? cost : null' },
  { name: 'zero total stock does not fall back to the kept lot cost', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs'],
    from: 'if (totalQuantity <= 0) return own', to: 'if (false) return own' },
  { name: 'the supplier is not taken from the added lot when the kept lot has none', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs', 'test-merge-by-received-date-native.cjs'],
    from: 'const donor = lotHasSupplier(keeper) ? undefined : [...added].sort(lotOrder).find(lotHasSupplier)', to: 'const donor = undefined' },
  { name: 'the kept lot always takes the added lot supplier, even when it has its own', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs', 'test-merge-by-received-date-native.cjs'],
    from: 'const donor = lotHasSupplier(keeper) ? undefined :', to: 'const donor =' },
  { name: 'undo skips putting the kept lot supplier fields back', file: 'lib/undoAppliers.ts', tests: ['test-merge-by-received-date-native.cjs'],
    from: "if (supplierBefore && typeof supplierBefore === 'object') {", to: 'if (false) {' },
  { name: 'the donor lot is not marked payable-moved (its credit is counted twice)', file: 'routes/products.ts', tests: ['test-merge-by-received-date-native.cjs'],
    from: "statements.push({ sql: 'UPDATE product_batches SET merge_payable_moved = 1 WHERE id = @id', params: { id: fromLotId } })", to: 'void fromLotId' },
  { name: 'the credit reminder ignores merge_payable_moved', file: 'routes/notifications.ts', tests: ['test-merge-by-received-date-native.cjs'],
    from: ' AND pb.merge_payable_moved IS NULL', to: '' },
  { name: 'undo does not restore the original batch_key of a created lot', file: 'lib/undoAppliers.ts',
    from: "if (typeof b.batchKeyBefore === 'string' && b.batchKeyBefore) {", to: 'if (false) {' },
]

function copySrc(target) {
  fs.cpSync(SRC, target, { recursive: true })
}

let survived = 0
// MUTANT_ONLY=<regex> runs just the mutants whose name matches (a faster loop while writing one).
const only = process.env.MUTANT_ONLY ? new RegExp(process.env.MUTANT_ONLY, 'i') : null
for (const mutant of only ? MUTANTS.filter((m) => only.test(m.name)) : MUTANTS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-mutant-'))
  try {
    copySrc(dir)
    const file = path.join(dir, mutant.file)
    const original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    const count = typeof mutant.from === 'string' ? original.split(mutant.from).length - 1 : (original.match(mutant.from) || []).length
    assert.ok(count >= 1, `mutant "${mutant.name}" no longer matches ${mutant.file}`)
    fs.writeFileSync(file, (mutant.all && typeof mutant.from === 'string' ? original.split(mutant.from).join(mutant.to) : original.replace(mutant.from, () => mutant.to)).replace(/\n/g, '\r\n'))
    let red = null
    for (const test of mutant.tests || TESTS) {
      const run = spawnSync(process.execPath, [path.join(__dirname, test)], {
        env: { ...process.env, BOS_HARNESS_SRC_DIR: dir }, encoding: 'utf8', timeout: 600000,
      })
      if (run.status !== 0) { red = test; break }
    }
    console.log(`${red ? 'KILLED  ' : 'SURVIVED'} ${mutant.name}${red ? `  (red in ${red})` : ''}`)
    if (!red) survived += 1
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
const ran = only ? MUTANTS.filter((m) => only.test(m.name)).length : MUTANTS.length
console.log(`${ran - survived} of ${ran} mutants killed`)
if (survived) process.exitCode = 1
