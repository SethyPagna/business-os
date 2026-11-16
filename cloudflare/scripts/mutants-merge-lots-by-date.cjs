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
  { name: 'cost is a plain per-lot mean, not over the distinct costs', file: 'lib/productMergeLots.ts',
    from: 'const distinct = [...new Set([keeperCost, ...addedCosts].map(positiveCost).filter((cost): cost is number => cost !== null))]',
    to: 'const distinct = [keeperCost, ...addedCosts].map(positiveCost).filter((cost): cost is number => cost !== null)' },
  { name: 'latest expiry instead of earliest', file: 'lib/productMergeLots.ts',
    from: '(value < earliest ? value : earliest)', to: '(value > earliest ? value : earliest)' },
  { name: 'the highest batch_number takes a same-day match', file: 'lib/productMergeLots.ts',
    from: 'return left !== right ? left - right : Number(a.id) - Number(b.id)', to: 'return left !== right ? right - left : Number(a.id) - Number(b.id)' },
  { name: 'the source lot is deleted', file: 'routes/products.ts',
    from: "statements.push({ sql: 'UPDATE product_batches SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id: batchRow.id } })\n      foldedBatches.push({",
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
  { name: 'undo does not restore the original batch_key of a created lot', file: 'lib/undoAppliers.ts',
    from: "if (typeof b.batchKeyBefore === 'string' && b.batchKeyBefore) {", to: 'if (false) {' },
]

function copySrc(target) {
  fs.cpSync(SRC, target, { recursive: true })
}

let survived = 0
for (const mutant of MUTANTS) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbd-mutant-'))
  try {
    copySrc(dir)
    const file = path.join(dir, mutant.file)
    const original = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    const count = typeof mutant.from === 'string' ? original.split(mutant.from).length - 1 : (original.match(mutant.from) || []).length
    assert.ok(count >= 1, `mutant "${mutant.name}" no longer matches ${mutant.file}`)
    fs.writeFileSync(file, original.replace(mutant.from, () => mutant.to).replace(/\n/g, '\r\n'))
    let red = null
    for (const test of TESTS) {
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
console.log(`${MUTANTS.length - survived} of ${MUTANTS.length} mutants killed`)
if (survived) process.exitCode = 1
