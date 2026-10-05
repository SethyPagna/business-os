// Migration 0235 (RET-B F4 / LH-2, 5 Oct 2026): marks every sale an applied
// sales-import row created as stock_skipped, once; a second run is a no-op;
// the header's recovery SQL reverses it; a work row whose key no longer
// matches aborts the file before anything is marked. Synthetic fixture on
// the real migration chain (no production data).
//
// Run (from cloudflare/): node scripts/test-migration-0235-imported-sales-stock-skipped-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

function setup(migrations = loadAll()) {
  const sqlite = new Database(':memory:')
  for (const migration of migrations) sqlite.exec(migration)
  sqlite.prepare(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Shop', 1)`).run()
  sqlite.prepare(`INSERT INTO products (id, name, sku, stock_quantity, cost_price_usd) VALUES (10, 'Widget', 'SKU-1', 5, 3)`).run()
  sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 5)`).run()
  return { sqlite }
}
const onHand = (sqlite) => sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id = 10 AND branch_id = 1').get().quantity

;(async () => {
  const sql0235 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0235_imported_sales_stock_skipped.sql'), 'utf8')

  await check('0235 is LF-only and uses the client-id index for its join', () => {
    assert.ok(!sql0235.includes('\r'), 'migration SQL must be LF')
    const { sqlite } = setup()
    const select = sql0235.slice(sql0235.indexOf('SELECT s.id, c.job_id'), sql0235.indexOf('-- Guards:')).trim().replace(/;$/, '')
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${select}`).all().map((row) => row.detail).join(' | ')
    assert.match(plan, /idx_sales_client_request_unique_pg/, `plan: ${plan}`)
  })

  await check('0235 marks exactly the applied import sales, once; recovery reverses it; a bad work row aborts', () => {
    const { sqlite } = setup(loadAll({ through: 234 }))
    const sale = sqlite.prepare("INSERT INTO sales (id, receipt_number, client_request_id, sale_status, stock_skipped, stock_skipped_by_name, branch_id) VALUES (?, ?, ?, ?, ?, ?, 1)")
    // group_key exactly as salesImportCommit.ts writes it: `row:${rowNumber}`.
    const insertCommit = sqlite.prepare('INSERT INTO import_sales_commits (job_id, group_key, row_number, status) VALUES (?, ?, ?, ?)')
    const commit = { run: (job, _row, row, status) => insertCommit.run(job, `row:${row}`, row, status) }
    sale.run(101, 'S101', 'sales-import:J:2', 'completed', 0, null); commit.run('J', 2, 2, 'applied')
    sale.run(102, 'S102', 'sales-import:J:3', 'cancelled', 0, null); commit.run('J', 3, 3, 'applied')
    sale.run(103, 'S103', 'sales-import:J:4', 'completed', 1, 'admin'); commit.run('J', 4, 4, 'applied')
    sale.run(104, 'S104', 'sales-import:J:9', 'completed', 0, null); commit.run('J', 9, 9, 'pending')
    sale.run(105, 'S105', 'sales-import:K:1', 'completed', 0, null) // no ledger row: not linked
    sale.run(106, 'S106', 'pos-abc', 'completed', 0, null)
    sale.run(107, 'S107', 'legacy-sale:77', 'completed', 0, null)
    const flags = () => Object.fromEntries(sqlite.prepare('SELECT id, stock_skipped, stock_skipped_by_name FROM sales ORDER BY id').all()
      .map((row) => [row.id, `${row.stock_skipped}:${row.stock_skipped_by_name ?? ''}`]))
    const revision = (id) => sqlite.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id = ?').get(id)?.revision ?? 0
    const stockBefore = onHand(sqlite)
    const rev101 = revision(101)

    sqlite.exec(sql0235)
    const M = 'migration:0235_imported_sales_stock_skipped'
    assert.deepEqual(flags(), { 101: `1:${M}`, 102: `1:${M}`, 103: '1:admin', 104: '0:', 105: '0:', 106: '0:', 107: '0:' })
    assert.equal(onHand(sqlite), stockBefore, 'no quantity moves')
    assert.equal(revision(101), rev101 + 1, 'the mark bumps the sale revision, so an old Undo pin is refused')
    const work = () => sqlite.prepare('SELECT sale_id, sale_status, stock_skipped_before, applied FROM imported_sale_stock_skip_0235 ORDER BY sale_id').all().map((row) => ({ ...row }))
    assert.deepEqual(work(), [
      { sale_id: 101, sale_status: 'completed', stock_skipped_before: 0, applied: 1 },
      { sale_id: 102, sale_status: 'cancelled', stock_skipped_before: 0, applied: 1 },
    ], 'the work table is the provenance: every marked sale with its before-value')

    // Double apply: nothing new.
    sqlite.exec(sql0235)
    assert.equal(work().length, 2)
    assert.equal(revision(101), rev101 + 1)

    // Recovery (verbatim from the header) restores the before-state, and a
    // re-run marks again.
    const recoveryStart = sql0235.indexOf('-- ============================== RECOVERY')
    const recovery = sql0235.slice(recoveryStart, sql0235.indexOf('\n\n', recoveryStart)).split('\n').filter((line) => /^--   (UPDATE|WHERE|  AND)/.test(line))
      .map((line) => line.replace(/^--   /, '')).join('\n')
    sqlite.exec(recovery)
    assert.deepEqual(flags(), { 101: '0:', 102: '0:', 103: '1:admin', 104: '0:', 105: '0:', 106: '0:', 107: '0:' })
    sqlite.exec(sql0235)
    assert.equal(flags()[101], `1:${M}`)

    // Guard: a pending work row whose key no longer matches its sale aborts
    // the file before any sale is marked.
    sqlite.prepare('UPDATE sales SET stock_skipped = 0, stock_skipped_by_name = NULL WHERE id = 101').run()
    sqlite.prepare("INSERT INTO imported_sale_stock_skip_0235 (sale_id, job_id, row_number, client_request_id, stock_skipped_before) VALUES (106, 'J', 50, 'sales-import:J:50', 0)").run()
    assert.throws(() => sqlite.exec(sql0235), /CHECK constraint failed/)
    assert.equal(flags()[106], '0:', 'the POS sale behind the bad row was never marked')
  })

  console.log(`\n${passed} check(s) passed.`)
})().catch((error) => {
  console.error('FAIL', error && error.stack ? error.stack : error)
  process.exitCode = 1
})
