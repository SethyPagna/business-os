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
// The set-based fold (16 Nov 2026, round 4) and the inactive-lot re-point have their own native tests.
const FOLD_TESTS = ['test-merge-by-received-date-native.cjs', 'test-merge-fold-set-based-native.cjs']

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
    from: 'UPDATE product_batches SET is_active = 0, merge_deactivated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id IN (${FOLD_DUP_IDS_SQL})', to: 'DELETE FROM product_batches WHERE id IN (${FOLD_DUP_IDS_SQL})' },
  { name: 'the kept lot cost and expiry are never written', file: 'routes/products.ts',
    from: 'if (keeperLotPlan.costChanged || keeperLotPlan.expiryChanged) {', to: 'if (false) {' },
  { name: 'allocations are not re-pointed to the kept lot', file: 'routes/products.ts', tests: FOLD_TESTS,
    from: "for (const table of ['sale_item_batch_allocations', 'return_item_batch_allocations', 'sale_items', 'return_items'])", to: "for (const table of ['return_item_batch_allocations', 'sale_items', 'return_items'])" },
  { name: 'a created lot keeps a clashing batch_key', file: 'routes/products.ts',
    from: 'const batchKeyOnKeeper = canonicalBatchKeys.has(String(batchRow.batch_key))', to: 'const batchKeyOnKeeper = false && canonicalBatchKeys.has(String(batchRow.batch_key))' },
  { name: 'undo skips the kept lot cost', file: 'lib/undoAppliers.ts',
    from: "SET unit_cost_usd = ${field('cost')}, expiry_date", to: "SET unit_cost_usd = unit_cost_usd, expiry_date" },
  { name: 'undo skips the kept lot expiry', file: 'lib/undoAppliers.ts',
    from: "expiry_date = ${field('expiry')},\n              is_active", to: "expiry_date = expiry_date,\n              is_active" },
  { name: 'the credit reminder filters is_active = 1 again', file: 'routes/notifications.ts',
    from: 'WHERE (pb.is_active = 1 OR pb.merge_deactivated_at IS NOT NULL)', to: 'WHERE pb.is_active = 1' },
  { name: 'the merge does not mark the lots it deactivates', file: 'routes/products.ts',
    from: /SET is_active = 0, merge_deactivated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id/g, to: 'SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id' },
  { name: 'undo leaves the merge marker on a reactivated lot', file: 'lib/undoAppliers.ts', all: true,
    from: 'SET is_active = 1, merge_deactivated_at = NULL, updated_at', to: 'SET is_active = 1, updated_at' },
  // Single-lot lines (sale_items.batch_id / return_items.batch_id) follow the lot: only the single-lot test needs to run.
  { name: 'sale_items.batch_id is not re-pointed to the kept lot', file: 'routes/products.ts', tests: ['test-merge-single-lot-lines-native.cjs'],
    from: "'sale_item_batch_allocations', 'return_item_batch_allocations', 'sale_items', 'return_items'])", to: "'sale_item_batch_allocations', 'return_item_batch_allocations', 'return_items'])" },
  { name: 'return_items.batch_id is not re-pointed to the kept lot', file: 'routes/products.ts', tests: ['test-merge-single-lot-lines-native.cjs'],
    from: "'sale_item_batch_allocations', 'return_item_batch_allocations', 'sale_items', 'return_items'])", to: "'sale_item_batch_allocations', 'return_item_batch_allocations', 'sale_items'])" },
  { name: 'undo skips putting sale_items.batch_id back', file: 'lib/undoAppliers.ts', tests: ['test-merge-single-lot-lines-native.cjs'],
    from: 'for (const id of intIds(fb.saleItemIds)) saleLines.push', to: 'for (const id of [] as number[]) saleLines.push' },
  { name: 'undo skips putting return_items.batch_id back', file: 'lib/undoAppliers.ts', tests: ['test-merge-single-lot-lines-native.cjs'],
    from: 'for (const id of intIds(fb.returnItemIds)) returnLines.push', to: 'for (const id of [] as number[]) returnLines.push' },
  // Owner rules 5 and 6 Oct: quantity-weighted cost, $0/unknown not weighted, 4 places, supplier follows the lot that has one.
  { name: 'plain mean instead of the quantity-weighted average', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs', 'test-merge-by-received-date-native.cjs'],
    from: 'return weightedMeanMoney4(bearing.map((lot) => ({ amount: lot.cost, factor: lot.quantity })), totalQuantity)', to: 'return meanMoney4(bearing.map((lot) => lot.cost))' },
  { name: 'the folded cost is stored without the 4-place rounding', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs', 'test-merge-by-received-date-native.cjs'],
    from: 'return weightedMeanMoney4(bearing.map((lot) => ({ amount: lot.cost, factor: lot.quantity })), totalQuantity)', to: 'return bearing.reduce((sum, lot) => sum + lot.cost * lot.quantity, 0) / totalQuantity' },
  { name: 'a $0 cost is weighted like a real one', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs', 'test-merge-by-received-date-native.cjs'],
    from: 'return Number.isFinite(cost) && cost > 0 ? cost : null', to: 'return Number.isFinite(cost) && cost >= 0 ? cost : null' },
  { name: 'zero total stock does not fall back to the kept lot cost', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs'],
    from: 'if (totalQuantity <= 0) return own', to: 'if (false) return own' },
  // Lead ruling 16 Nov: the kept lot keeps its own supplier; the duplicate's payable stays on its inactive source lot, counted once.
  { name: 'the kept lot takes the duplicate lot supplier, payment status and due date (the 6.0.2336 behaviour)', file: 'routes/products.ts', tests: ['test-merge-by-received-date-native.cjs'],
    from: 'const keeperLotPlan = foldedLotPlanByKeeperId.get(existingCanonicalBatchId)\n',
    to: "const keeperLotPlan = foldedLotPlanByKeeperId.get(existingCanonicalBatchId)\n      statements.push({ sql: 'UPDATE product_batches SET supplier_id = (SELECT supplier_id FROM product_batches WHERE id = @dup), supplier_name = (SELECT supplier_name FROM product_batches WHERE id = @dup), payment_status = (SELECT payment_status FROM product_batches WHERE id = @dup), credit_due_date = (SELECT credit_due_date FROM product_batches WHERE id = @dup) WHERE id = @keep AND supplier_id IS NULL', params: { keep: existingCanonicalBatchId, dup: batchRow.id } })\n" },
  { name: 'the source lot is counted twice by the credit reminder', file: 'routes/notifications.ts', tests: ['test-merge-by-received-date-native.cjs'],
    from: '    FROM product_batches pb\n    JOIN products p ON p.id = pb.variant_product_id\n    -- A supplier payable',
    to: '    FROM (SELECT * FROM product_batches UNION ALL SELECT * FROM product_batches WHERE merge_deactivated_at IS NOT NULL) pb\n    JOIN products p ON p.id = pb.variant_product_id\n    -- A supplier payable' },
  { name: 'the source lot is dropped: the fold strips its supplier and credit', file: 'routes/products.ts', tests: ['test-merge-by-received-date-native.cjs'],
    from: /SET is_active = 0, merge_deactivated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id/g, to: "SET is_active = 0, merge_deactivated_at = CURRENT_TIMESTAMP, supplier_id = NULL, supplier_name = NULL, payment_status = 'paid', credit_due_date = NULL, updated_at = CURRENT_TIMESTAMP WHERE id" },
  { name: 'undo does not restore the original batch_key of a created lot', file: 'lib/undoAppliers.ts',
    from: "if (typeof b.batchKeyBefore === 'string' && b.batchKeyBefore) {", to: 'if (false) {' },
  // Review round (16 Nov): the surviving mutants M10, M12 and M17, and the lead rulings M1, M2, M3, expiry and received-date rules.
  { name: 'M10: same-day tie broken by lot id only (batch_number ignored)', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs', 'test-merge-by-received-date-native.cjs'],
    from: 'return left !== right ? left - right : Number(a.id) - Number(b.id)', to: 'return Number(a.id) - Number(b.id)' },
  // M12 (undo fingerprint not widened when the fold writes the kept lot: dropping the `|| keeperLotMetadataWritten` term at products.ts) is an EQUIVALENT
  // mutant, not a gap: the merge action's own recorded fingerprint is always the full-row one (undoAppliers.ts mergeStateFingerprint callers pass
  // fullBatchMetadataFingerprint: true), so an edit of the kept lot after the merge is refused with or without the snapshot flag. Verified with an
  // edit of received_branch_name (invisible to the stock-revision trigger): still 409 (test 'undo is REFUSED once the kept lot ... was edited').
  { name: 'M17: the write-off path does not mark its lots', file: 'routes/products.ts', tests: ['test-merge-by-received-date-native.cjs'],
    from: 'if (wasActive) statements.push(', to: 'if (false) statements.push(' },
  { name: 'M1: an inactive kept lot is a match target again', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs', 'test-merge-by-received-date-native.cjs'],
    from: '[...keeperLots].filter(isMergeableLot).sort(lotOrder)', to: '[...keeperLots].sort(lotOrder)' },
  { name: 'N2: an inactive discarded lot is folded (matched by date) again', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs', 'test-merge-by-received-date-native.cjs'],
    from: '[...duplicateLots].filter(isMergeableLot).sort(lotOrder)', to: '[...duplicateLots].sort(lotOrder)' },
  { name: 'B2: an already-inactive discarded lot is left on the discarded product again (not re-pointed)', file: 'lib/productMergeSnapshot.ts', tests: ['test-merge-inactive-lot-return-native.cjs'],
    from: 'FROM product_batches WHERE variant_product_id = @id`,\n      params: { id: duplicateId },', to: 'FROM product_batches WHERE variant_product_id = @id AND is_active = 1`,\n      params: { id: duplicateId },' },
  { name: 'M3: the second discarded lot of a new date is created too (no fold into the first)', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs', 'test-merge-by-received-date-native.cjs'],
    from: 'const target = byDate.get(date) ?? createdByDate.get(date)', to: 'const target = byDate.get(date)' },
  { name: 'B3: undo never restores the kept lot before-image', file: 'lib/undoAppliers.ts', tests: ['test-merge-by-received-date-native.cjs'],
    from: 'const restoreRows = [...keeperLotRestores].map(', to: 'const restoreRows = ([] as Array<[number, NonNullable<NonNullable<MergeReversal[\'foldedBatches\']>[number][\'keeperLotBefore\']>]>).map(' },
  // N7: the kept lot's active flag restored BEFORE the stock is put back (the order the two-branch B3 test pins; one branch cannot tell).
  { name: 'N7: undo restores the kept lot active flag before the stock is back', file: 'lib/undoAppliers.ts', tests: ['test-merge-by-received-date-native.cjs'],
    from: '  for (const ids of chunk(reactivate, 400)) {', to: "  stmts.push(...[...keeperLotRestores].map(([id, b]) => ({ sql: 'UPDATE product_batches SET is_active = COALESCE(@a, is_active) WHERE id = @id', params: { id, a: b.is_active == null ? null : Number(b.is_active) } })))\n  for (const ids of chunk(reactivate, 400)) {" },
  // M15: the statement estimates are honest. A per-lot estimate again (the old +7 per folded lot) refuses a 77-lot merge at preflight.
  { name: 'M15: the estimate counts statements per folded lot again', file: 'routes/products.ts', tests: ['test-merge-fold-estimate-pure.cjs'],
    from: 'return chunks(stockEntries, MERGE_FOLD_STOCK_CHUNK) + chunks(foldedLots, MERGE_FOLD_CHUNK) * MERGE_FOLD_STATEMENTS_PER_CHUNK', to: 'return chunks(stockEntries, MERGE_FOLD_STOCK_CHUNK) + foldedLots * 7' },
  { name: 'M15b: the estimate is 5 low', file: 'routes/products.ts', tests: ['test-merge-fold-estimate-pure.cjs'],
    from: 'chunks(foldedLots, MERGE_FOLD_CHUNK) * MERGE_FOLD_STATEMENTS_PER_CHUNK + chunks(keptLotsWritten, MERGE_FOLD_CHUNK)', to: 'chunks(foldedLots, MERGE_FOLD_CHUNK) * MERGE_FOLD_STATEMENTS_PER_CHUNK + chunks(keptLotsWritten, MERGE_FOLD_CHUNK) - 5' },
  // M-c: the kept lot cost is restored at 4 places.
  { name: 'M-c: undo restores the kept lot cost unrounded', file: 'lib/undoAppliers.ts', tests: ['test-merge-by-received-date-native.cjs'],
    from: 'cost: roundStoredCost(before.unit_cost_usd),', to: 'cost: before.unit_cost_usd == null ? null : Number(before.unit_cost_usd),' },
  { name: 'expiry compared as raw strings again', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs'],
    from: '.map(isoExpiry).filter((value): value is string => value !== null)', to: '.map((value) => String(value ?? \'\').trim()).filter(Boolean)' },
  { name: 'a non-ISO received date is read (month-first) again', file: 'lib/productMergeLots.ts', tests: ['test-merge-lots-by-date-pure.cjs'],
    from: 'if (!text || !ISO_LED.test(text)) return null', to: 'if (!text) return null' },
  // M-d: the same three rules, run against the REAL route only (the pure test is skipped), so a gap in the native test cannot hide behind it.
  { name: 'N2 (native route only): an inactive discarded lot is folded (matched by date) again', file: 'lib/productMergeLots.ts', tests: ['test-merge-by-received-date-native.cjs'],
    from: '[...duplicateLots].filter(isMergeableLot).sort(lotOrder)', to: '[...duplicateLots].sort(lotOrder)' },
  { name: 'N5 (native route only): expiry compared as raw strings again', file: 'lib/productMergeLots.ts', tests: ['test-merge-by-received-date-native.cjs'],
    from: '.map(isoExpiry).filter((value): value is string => value !== null)', to: '.map((value) => String(value ?? \'\').trim()).filter(Boolean)' },
  { name: 'N6 (native route only): a non-ISO received date is read (month-first) again', file: 'lib/productMergeLots.ts', tests: ['test-merge-by-received-date-native.cjs'],
    from: 'if (!text || !ISO_LED.test(text)) return null', to: 'if (!text) return null' },
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
