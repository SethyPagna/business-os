// Companion for the runbook P10 post-checks (G12-CUTOVER-READINESS.md 3.4; refuter blocker B3):
//   ops/queries/branch-cutover-post-checks.sql  self-contained, every column 0 (ops:expect-zero *)
//   ops/queries/branch-cutover-post-stock.sql   comparable, run at P7 and at P10
//   ops/queries/branch-cutover-post-labels.sql  comparable, run at P7 and at P10
//   ops/scripts/branch-cutover-post-compare.mjs the P7 / P10 comparison
// - every file passes the ops read-only guard identically for LF and CRLF, one row, no LIKE/GLOB over 50 bytes;
// - the REAL parent and certified child run to completed on the production-shaped e2e fixture (folds of every
//   owner-ruled class: weighted cost, real cost over $0/unknown, $0 + unknown -> unknown, empty supplier, slash dates);
//   P7 is read right after begin, P10 after finalize: the checks are all 0 and the comparison PASSES;
// - the fold put-back is what makes it pass: the same comparison with the fold audit rows ignored FAILS (the
//   merges re-cost survivors and move lot units: B3's 12 re-costed lots and the 1199.68 -> 1214.68 value), and the
//   revaluation it reports equals the recorded fold decisions;
// - wrong results are caught: each tamper below (on the completed database, rolled back after) turns a check
//   nonzero or the comparison FAIL - including a unit moved between two products, which the totals cannot see.
// Run (from cloudflare/): node scripts/test-branch-cutover-post-checks-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { world, drive, snapshot } = require('./test-branch-cutover-parent-e2e-native.cjs')

const root = path.resolve(__dirname, '../..')
const NAMES = ['branch-cutover-post-checks', 'branch-cutover-post-stock', 'branch-cutover-post-labels']

async function main() {
  let checks = 0
  const check = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name) }
  const guard = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')).href)
  const { compareCutoverPost, VALUE_TOLERANCE } = await import(pathToFileURL(path.join(root, 'ops/scripts/branch-cutover-post-compare.mjs')).href)
  const q = {}
  await check('the post-check queries pass the ops read-only guard, one row each, identically for LF and CRLF', () => {
    for (const name of NAMES) {
      const source = fs.readFileSync(path.join(root, 'ops/queries', name + '.sql'), 'utf8')
      const { sql, rules } = guard.guardSql(source)
      assert.equal(rules.minRows, 1); assert.equal(rules.maxRows, 1)
      assert.deepEqual(rules.expectZero, name === 'branch-cutover-post-checks' ? '*' : null)
      const lf = source.replace(/\r\n/g, '\n')
      assert.equal(guard.guardSql(lf.replace(/\n/g, '\r\n')).sql, sql)
      assert.ok(sql.length <= guard.MAX_SQL_CHARS)
      for (const m of sql.matchAll(/\b(?:GLOB|LIKE)\s+'((?:[^']|'')*)'/gi)) assert.ok(Buffer.byteLength(m[1]) <= 50, m[1])
      q[name] = sql
    }
  })
  const read = (raw, name) => ({ query: name, sql: q[name], rows: raw.prepare(q[name]).all().map(row => ({ ...row })) })
  const zeroes = (row) => Object.entries(row).filter(([, v]) => v !== 0)

  // ---- the real run, P7 read right after begin
  const w = world()
  const base = snapshot(w.raw)
  const valueBefore = w.raw.prepare(`SELECT sum(s.quantity * CASE WHEN b.unit_cost_usd > 0 THEN b.unit_cost_usd ELSE 0 END) v
    FROM branch_batch_stock s JOIN product_batches b ON b.id = s.batch_id WHERE s.branch_id IN (1, 2)`).get().v
  let p7 = null
  const final = await drive(w, { base, onStep: (label) => {
    if (label === 'begin' && !p7) p7 = { stock: read(w.raw, 'branch-cutover-post-stock'), labels: read(w.raw, 'branch-cutover-post-labels'), checks: read(w.raw, 'branch-cutover-post-checks') }
  } })
  assert.equal(final.phase, 'completed')
  const p10 = { stock: read(w.raw, 'branch-cutover-post-stock'), labels: read(w.raw, 'branch-cutover-post-labels'), checks: read(w.raw, 'branch-cutover-post-checks') }
  const folds = w.raw.prepare("SELECT details FROM audit_logs WHERE action = 'branch_cutover_lot_fold'").all().map(r => JSON.parse(r.details))

  await check('on the completed run every self-contained post-check is 0; at P7 (nothing moved yet) they are not', () => {
    assert.deepEqual(zeroes(p10.checks.rows[0]), [])
    assert.ok(Object.keys(p10.checks.rows[0]).length >= 20)
    const before = p7.checks.rows[0]
    assert.equal(before.no_completed_run, 1); assert.ok(before.source_stock > 0 && before.source_lots > 0)
  })

  await check('the big label tables are read in one sequential pass, never row by row through the branch index (6x on D1)', () => {
    for (const name of ['branch-cutover-post-labels', 'branch-cutover-post-checks']) {
      const plan = w.raw.prepare('EXPLAIN QUERY PLAN ' + q[name]).all().map(r => r.detail)
      for (const index of ['idx_inventory_movements_branch_created_pg (branch_id=?)', 'idx_sales_branch_created (branch_id=?)']) {
        assert.ok(!plan.some(d => d.endsWith(index)), name + ' reads through ' + index)
      }
      assert.ok(plan.filter(d => /^SCAN x$/.test(d)).length >= 3, name + ' ' + plan.join(' | '))
    }
    // the run's own movements are still found through the index range from begin
    assert.ok(w.raw.prepare('EXPLAIN QUERY PLAN ' + q['branch-cutover-post-checks']).all().some(r => /idx_inventory_movements_branch_created_pg \(branch_id=\? AND created_at>\?\)/.test(r.detail)))
  })

  await check('P7 and P10 compare equal once the recorded folds are put back (stock and labels)', () => {
    for (const part of ['stock', 'labels']) {
      const result = compareCutoverPost(p7[part], p10[part])
      assert.ok(result.ok, part + ' ' + JSON.stringify(result.columns.filter(c => !c.ok)) + ' ' + result.problems)
    }
    const a = p7.stock.rows[0], b = p10.stock.rows[0]
    assert.equal(a.info_folds, 0); assert.equal(b.info_folds, folds.length); assert.ok(folds.length >= 8)
    assert.ok(Math.abs(a.value_lots - valueBefore) <= 1e-6, 'P7 value is the plain stock value')
  })

  await check('discriminating: ignoring the fold records, the same comparison FAILS - the merges re-cost and move lot units', () => {
    const blind = { ...q }
    for (const name of ['branch-cutover-post-stock']) blind[name] = q[name].replace("a.action = 'branch_cutover_lot_fold'", "a.action = 'no_such_action'")
    assert.notEqual(blind['branch-cutover-post-stock'], q['branch-cutover-post-stock'])
    const raw = { query: 'branch-cutover-post-stock', rows: w.raw.prepare(blind['branch-cutover-post-stock']).all().map(row => ({ ...row })) }
    const result = compareCutoverPost({ query: 'branch-cutover-post-stock', rows: p7.stock.rows }, raw)
    const failed = result.columns.filter(c => !c.ok).map(c => c.column).sort()
    assert.deepEqual(failed, ['batch_checksum', 'lot_checksum_pair', 'value_lots'])
    // the revaluation the merges made is exactly the recorded decisions: sum over folds of (after value - before value)
    const cost = new Map(w.raw.prepare('SELECT id, unit_cost_usd c FROM product_batches').all().map(r => [r.id, r.c]))
    const pos = (c) => (typeof c === 'number' && c > 0 ? c : 0)
    let delta = 0
    for (const f of folds) for (const [i, [id, qb]] of f.before.entries()) {
      const qa = f.after[i][1], recost = id === f.survivorBatchId && f.unitCostUsdAfter !== f.unitCostUsdBefore
      delta += qa * pos(cost.get(id)) - qb * pos(recost ? f.unitCostUsdBefore : cost.get(id))
    }
    const b = p10.stock.rows[0]
    assert.ok(Math.abs(b.info_fold_value_delta - delta) <= 1e-6 && Math.abs(b.info_fold_value_delta) > 0.01, String(b.info_fold_value_delta))
    assert.ok(Math.abs(b.info_value_raw - b.value_lots - delta) <= 1e-6)
    assert.ok(folds.filter(f => f.unitCostUsdAfter !== f.unitCostUsdBefore).length >= 5, 'survivors were re-costed')
  })

  await check('the comparison is strict: a NULL, a missing column, another query text or a value beyond the tolerance FAILS', () => {
    const row = p7.stock.rows[0]
    assert.equal(compareCutoverPost(p7.stock, { ...p7.stock, rows: [{ ...row, lot_checksum_pair: null }] }).ok, false)
    const { batches, ...missing } = row
    assert.equal(compareCutoverPost(p7.stock, { ...p7.stock, rows: [missing] }).ok, false)
    assert.equal(compareCutoverPost(p7.stock, { ...p7.stock, sql: p7.stock.sql + ' ' }).ok, false)
    assert.equal(compareCutoverPost(p7.stock, { ...p7.stock, rows: [{ ...row, value_lots: row.value_lots + VALUE_TOLERANCE / 2 }] }).ok, true)
    assert.equal(compareCutoverPost(p7.stock, { ...p7.stock, rows: [{ ...row, value_lots: row.value_lots + 0.0001 }] }).ok, false)
    assert.equal(compareCutoverPost(p7.stock, { ...p7.stock, rows: [{ ...row, info_phase: 'x' }] }).ok, true, 'info_ columns are not compared')
  })

  // ---- wrong results: each tamper must be caught, then is rolled back
  const caught = (sql) => {
    w.raw.exec('SAVEPOINT tamper')
    try {
      w.raw.exec(sql)
      const checksNow = zeroes(read(w.raw, 'branch-cutover-post-checks').rows[0]).map(([k]) => k)
      const compared = ['stock', 'labels'].flatMap(part => compareCutoverPost(p7[part], read(w.raw, 'branch-cutover-post-' + part)).columns.filter(c => !c.ok).map(c => c.column))
      return [...checksNow, ...compared].sort()
    } finally { w.raw.exec('ROLLBACK TO tamper'); w.raw.exec('RELEASE tamper') }
  }
  const one = (sql) => w.raw.prepare(sql).get()
  const lc = 1, old = 2
  await check('controls: every wrong result is caught by a check or the comparison', () => {
    // p holds an untracked unit at LC Store, so taking one keeps its lots within stock: only the checksums can see it
    const p = one(`SELECT x.product_id FROM branch_stock x WHERE x.branch_id = ${lc} AND x.quantity - COALESCE((SELECT sum(s.quantity) FROM branch_batch_stock s
      JOIN product_batches b ON b.id = s.batch_id WHERE b.variant_product_id = x.product_id AND s.branch_id = ${lc}), 0) >= 1 ORDER BY x.product_id LIMIT 1`).product_id
    const r = one(`SELECT product_id FROM branch_stock WHERE branch_id = ${lc} AND quantity >= 1 AND product_id <> ${p} ORDER BY product_id LIMIT 1`).product_id
    const survivor = folds.find(f => f.unitCostUsdAfter !== f.unitCostUsdBefore && typeof f.unitCostUsdAfter === 'number').survivorBatchId
    const plain = one(`SELECT id FROM product_batches WHERE id NOT IN (${folds.map(f => f.survivorBatchId).join(',')}) ORDER BY id LIMIT 1`).id
    const lot = one(`SELECT batch_id FROM branch_batch_stock WHERE branch_id = ${lc} AND quantity > 0 AND batch_id NOT IN (${folds.flatMap(f => f.before.map(([id]) => id)).join(',')}) ORDER BY batch_id LIMIT 1`).batch_id
    const cases = {
      'a unit moved between two products at LC Store (totals unchanged)': [`UPDATE branch_stock SET quantity = quantity - 1 WHERE product_id = ${p} AND branch_id = ${lc};
        UPDATE branch_stock SET quantity = quantity + 1 WHERE product_id = ${r} AND branch_id = ${lc}`, ['product_checksum_pair', 'untracked_checksum']],
      'a unit left at Old Shop': [`UPDATE branch_stock SET quantity = 1 WHERE product_id = ${p} AND branch_id = ${old}`, ['product_checksum_pair', 'product_units_micro', 'source_stock', 'untracked_checksum']],
      'a lot unit added at LC Store': [`UPDATE branch_batch_stock SET quantity = quantity + 1 WHERE batch_id = ${lot} AND branch_id = ${lc};
        UPDATE branch_stock SET quantity = quantity + 1 WHERE branch_id = ${lc} AND product_id = (SELECT variant_product_id FROM product_batches WHERE id = ${lot})`,
        ['lot_checksum_pair', 'lot_units_micro', 'product_checksum_pair', 'product_units_micro', 'target_lot_units_off', 'target_units_off', 'value_lots']],
      // the comparable half puts the recorded cost back, so the recorded-cost check is the one that sees this
      'a survivor re-costed differently than recorded': [`UPDATE product_batches SET unit_cost_usd = unit_cost_usd + 1 WHERE id = ${survivor}`, ['fold_costs_off']],
      'a lot code rewritten silently (no updated_at)': [`UPDATE product_batches SET lot_code = lot_code || 'x' WHERE id = ${plain}`, ['batch_checksum']],
      'a plain lot re-costed silently': [`UPDATE product_batches SET unit_cost_usd = COALESCE(unit_cost_usd, 0) + 1 WHERE id = ${lot}`, ['batch_checksum', 'value_lots']],
      'a lot touched since begin that no fold explains': [`UPDATE product_batches SET updated_at = '2999-01-01 00:00:00' WHERE id = ${plain}`, ['batches_changed_off']],
      // X2: row timestamps are whole seconds, the journal's begin is an ISO instant with milliseconds. A write that landed in
      // the SAME second as begin (stored at second .000, so before begin's .xyz) is not a change of the run. The only instant
      // that cannot be told apart is a begin at exactly .000, which the expectation below names.
      'a lot written in the same second as begin, before it': [`UPDATE product_batches SET updated_at = datetime((SELECT created_at FROM branch_cutovers LIMIT 1)) WHERE id = ${plain}`,
        /.000Z$/.test(one("SELECT created_at c FROM branch_cutovers LIMIT 1").c) ? ['batches_changed_off'] : []],
      'a stock transfer written in the same second as begin, before it, outside the run': [`INSERT INTO stock_transfers(product_id, product_name, from_branch_id, to_branch_id, quantity, from_branch_name, to_branch_name, created_at)
        SELECT product_id, product_name, from_branch_id, to_branch_id, quantity, from_branch_name, to_branch_name, datetime((SELECT created_at FROM branch_cutovers LIMIT 1)) FROM stock_transfers ORDER BY id LIMIT 1`,
        /.000Z$/.test(one("SELECT created_at c FROM branch_cutovers LIMIT 1").c) ? ['orphans'] : []],
      'an inactive product holding stock (the run reactivates them all)': [`DROP TRIGGER transfer_product_identity_update; UPDATE products SET is_active = 0 WHERE id = (SELECT product_id FROM branch_stock WHERE branch_id = ${lc} AND quantity > 0 ORDER BY product_id LIMIT 1)`, ['inactive_with_stock']],
      'an inactive product with only a drifted cache (owner: recompute it)': [`DROP TRIGGER transfer_product_identity_update; UPDATE products SET is_active = 0, stock_quantity = 8 WHERE id = (SELECT product_id FROM branch_stock WHERE branch_id = ${lc} AND quantity > 0 ORDER BY product_id LIMIT 1)`, ['inactive_with_stock']],
      'an inactive product holding a held (damaged-tagged) unit': [`DROP TRIGGER transfer_product_identity_update; UPDATE products SET is_active = 0 WHERE id = (SELECT product_id FROM branch_stock WHERE branch_id = ${lc} AND quantity > 0 ORDER BY product_id LIMIT 1); INSERT INTO damaged_stock_lots(product_id, branch_id, quantity, quantity_remaining, condition_tag, source) SELECT id, ${lc}, 1, 1, 'damaged', 'remove' FROM products WHERE is_active = 0 LIMIT 1`, ['inactive_with_stock']],
      'a nonblank history label rewritten': [`UPDATE sales SET branch_name = 'Warehouse' WHERE id = 2`, ['sales']],
      'a history label left blank': [`UPDATE sales SET branch_name = NULL WHERE id = 2`, ['blank_labels', 'sales']],
      'Old Shop renamed back': [`UPDATE branches SET name = 'Shop' WHERE id = ${old}`, ['directory_off']],
      'a second active branch': [`UPDATE branches SET is_active = 1 WHERE id = 3`, ['directory_off']],
      'a movement of the run under another label': [`UPDATE inventory_movements SET branch_name = 'Elsewhere' WHERE id = (SELECT max(id) FROM inventory_movements)`, ['movements_off']],
      'a movement of the run missing': [`DELETE FROM inventory_movements WHERE id = (SELECT max(id) FROM inventory_movements)`, ['movements_off']],
      'a transfer row of the run missing':[`DELETE FROM stock_transfers WHERE id = (SELECT max(id) FROM stock_transfers)`, ['transfers_off']],
      'the maintenance flag left behind': [`INSERT INTO system_flags(key, value) VALUES ('maintenance', '{}')`, ['maintenance_flag']],
    }
    for (const [name, [sql, expected]] of Object.entries(cases)) {
      let got
      try { got = caught(sql) } catch (error) { throw new Error(name + ': ' + error.message) }
      if (process.env.POST_DEBUG) console.log(name, JSON.stringify(got)); else assert.deepEqual(got, expected.sort(), name)
    }
    // and nothing is left over: the untouched result still passes
    assert.deepEqual(caught('SELECT 1'), [])
  })
  w.raw.close()
  console.log(`${checks} branch cutover post-check groups passed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
