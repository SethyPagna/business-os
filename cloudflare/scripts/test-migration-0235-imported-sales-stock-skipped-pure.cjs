// Migration 0235 (RET-B F4 / LH-2, 5 Oct 2026): marks every sale carrying the
// sales import's own key ('sales-import:<job>:<row>') as stock_skipped, once.
// The import ledger (import_sales_commits) is NOT needed: retention deletes it
// 7 days after a job ends, and production holds none for its 14,913 imports
// (RET-B-VERIFY B1). A second run is a no-op; the header's recovery SQL clears
// only sales unchanged since marking; any POS evidence, a malformed key or a
// 0161 money-trigger failure aborts the whole file with nothing marked.
// Synthetic fixture on the real migration chain (no production data). Each
// apply runs in one transaction, as wrangler applies a migration file.
//
// Run (from cloudflare/): node scripts/test-migration-0235-imported-sales-stock-skipped-pure.cjs
const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

const sql0235 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0235_imported_sales_stock_skipped.sql'), 'utf8')
const M = 'migration:0235_imported_sales_stock_skipped'

function setup(migrations = loadAll({ through: 234 })) {
  const sqlite = new Database(':memory:')
  for (const migration of migrations) sqlite.exec(migration)
  sqlite.prepare(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Shop', 1)`).run()
  sqlite.prepare(`INSERT INTO products (id, name, sku, stock_quantity, cost_price_usd) VALUES (10, 'Widget', 'SKU-1', 5, 3)`).run()
  sqlite.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (10, 1, 5)`).run()
  const insertSale = sqlite.prepare(`INSERT INTO sales (id, receipt_number, client_request_id, sale_status, stock_skipped,
    stock_skipped_by_name, branch_id, updated_at, creation_snapshot_json) VALUES (?, ?, ?, ?, ?, ?, 1, '2026-08-28 01:00:00', ?)`)
  const sale = (id, key, status = 'completed', skipped = 0, by = null, snapshot = null) => insertSale.run(id, `S${id}`, key, status, skipped, by, snapshot)
  const apply = (sql = sql0235) => {
    sqlite.exec('BEGIN')
    try { sqlite.exec(sql); sqlite.exec('COMMIT') } catch (error) { sqlite.exec('ROLLBACK'); throw error }
  }
  const flags = () => Object.fromEntries(sqlite.prepare('SELECT id, stock_skipped, stock_skipped_by_name FROM sales ORDER BY id').all()
    .map((row) => [row.id, `${row.stock_skipped}:${row.stock_skipped_by_name ?? ''}`]))
  return { sqlite, sale, apply, flags }
}
const onHand = (sqlite) => sqlite.prepare('SELECT quantity FROM branch_stock WHERE product_id = 10 AND branch_id = 1').get().quantity
const unflaggedImports = (sqlite) => sqlite.prepare("SELECT COUNT(*) AS n FROM sales WHERE client_request_id LIKE 'sales-import:%' AND COALESCE(stock_skipped,0) = 0").get().n

;(async () => {
  await check('0235 is LF-only and its prefix scan uses the client-id index', () => {
    assert.ok(!sql0235.includes('\r'), 'migration SQL must be LF')
    const { sqlite } = setup(loadAll())
    const select = sql0235.slice(sql0235.indexOf('SELECT s.id, s.client_request_id'), sql0235.indexOf('-- Guards:')).trim().replace(/;$/, '')
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${select}`).all().map((row) => row.detail).join(' | ')
    assert.match(plan, /idx_sales_client_request_unique_pg/, `plan: ${plan}`)
    assert.doesNotMatch(sql0235.replace(/--[^\n]*/g, ''), /import_sales_commits/, 'the pruned import ledger is not a precondition')
  })

  await check('every unflagged imported sale is marked, ledger or not; nothing else is', () => {
    const { sqlite, sale, apply, flags } = setup()
    // Ledger-less imports: production's state once retention has run.
    sale(101, 'sales-import:J:2')
    sale(102, 'sales-import:J:3', 'cancelled')
    sale(103, 'sales-import:J:4', 'completed', 1, 'admin')
    sale(104, 'sales-import:0c7b9e2a-5d1f-4e7a-9a11-2b3c4d5e6f70:15', 'completed', 0, null, JSON.stringify({ version: 1, origin: 'sales_import' }))
    sale(106, 'pos-abc')
    sale(107, 'legacy-sale:77')
    sale(108, 'sales-importX:1')
    sale(109, 'sales-import;1')
    // One ledger row, to show it is neither needed nor harmful.
    sqlite.prepare("INSERT INTO import_sales_commits (job_id, group_key, row_number, status) VALUES ('J', 'row:2', 2, 'applied')").run()
    const stockBefore = onHand(sqlite)
    const revision = (id) => sqlite.prepare('SELECT revision FROM sale_write_revisions WHERE sale_id = ?').get(id)?.revision ?? 0
    const rev101 = revision(101)
    const unflaggedBefore = unflaggedImports(sqlite)
    assert.equal(unflaggedBefore, 3)

    apply()
    assert.deepEqual(flags(), { 101: `1:${M}`, 102: `1:${M}`, 103: '1:admin', 104: `1:${M}`, 106: '0:', 107: '0:', 108: '0:', 109: '0:' })
    const marked = sqlite.prepare('SELECT COUNT(*) AS n FROM sales WHERE stock_skipped_by_name = ?').get(M).n
    assert.equal(marked, unflaggedBefore, 'post-assertion: marked = unflagged sales-import:% before')
    assert.equal(unflaggedImports(sqlite), 0)
    assert.equal(onHand(sqlite), stockBefore, 'no quantity moves')
    assert.equal(revision(101), rev101 + 1, 'the mark bumps the sale revision, so an old Undo pin is refused')
    const work = () => sqlite.prepare('SELECT sale_id, sale_status, stock_skipped_before, applied FROM imported_sale_stock_skip_0235 ORDER BY sale_id').all().map((row) => ({ ...row }))
    assert.deepEqual(work().map((row) => row.sale_id), [101, 102, 104])
    assert.ok(work().every((row) => row.applied === 1 && row.stock_skipped_before === 0))

    // Double apply: nothing new.
    apply()
    assert.equal(work().length, 3)
    assert.equal(revision(101), rev101 + 1)
  })

  await check('recovery clears only sales unchanged since marking; a re-run marks them again', () => {
    const { sqlite, sale, apply, flags } = setup()
    sale(101, 'sales-import:J:2')
    sale(102, 'sales-import:J:3')
    apply()
    // 102 changed after marking (e.g. cancelled while skipped: nothing moved).
    sqlite.prepare("UPDATE sales SET sale_status = 'cancelled', updated_at = '2026-10-06 09:00:00' WHERE id = 102").run()
    const start = sql0235.indexOf('-- ============================== RECOVERY')
    const block = sql0235.slice(start, sql0235.indexOf('\n\n', start)).split('\n')
    const recovery = block.slice(block.findIndex((line) => line.startsWith('--   UPDATE sales')), block.findIndex((line) => line.startsWith('-- Rows still applied')))
      .map((line) => line.replace(/^--   /, '')).join('\n')
    apply(recovery)
    assert.deepEqual(flags(), { 101: '0:', 102: `1:${M}` }, 'the changed sale keeps its flag: un-cancelling it unflagged would deduct units never handed back')
    assert.deepEqual(sqlite.prepare('SELECT sale_id FROM imported_sale_stock_skip_0235 WHERE applied = 1').all().map((row) => row.sale_id), [102], 'left for owner review')
    apply()
    assert.equal(flags()[101], `1:${M}`)
  })

  for (const [name, key, snapshot, pattern] of [
    ['a POS creation snapshot', 'sales-import:J:5', JSON.stringify({ version: 1, origin: 'pos' }), /CHECK constraint failed/],
    ['a key that is not the import shape', 'sales-import:J:row5', null, /CHECK constraint failed/],
    ['a key with no job part', 'sales-import::5', null, /CHECK constraint failed/],
  ]) {
    await check(`aborts with nothing marked on ${name}`, () => {
      const { sqlite, sale, apply, flags } = setup()
      sale(101, 'sales-import:J:2')
      sale(110, key, 'completed', 0, null, snapshot)
      const before = flags()
      assert.throws(() => apply(), pattern)
      assert.deepEqual(flags(), before)
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'imported_sale_stock_skip_0235'").get().n, 0, 'rolled back whole')
    })
  }

  await check('aborts with nothing marked on a money-precision v1 sale (only the POS writes v1)', () => {
    const { sqlite, sale, apply, flags } = setup()
    sale(101, 'sales-import:J:2')
    sqlite.prepare(`INSERT INTO sales (id, receipt_number, client_request_id, money_precision_version, calculated_total_usd, total_usd,
      rounding_adjustment_usd, branch_id) VALUES (112, 'S112', 'sales-import:J:7', 1, 10, 10, 0, 1)`).run()
    const before = flags()
    assert.throws(() => apply(), /CHECK constraint failed/)
    assert.deepEqual(flags(), before)
  })

  await check('aborts with nothing marked when a target fails the 0161 money trigger', () => {
    const { sqlite, sale, apply, flags } = setup()
    sale(101, 'sales-import:J:2')
    sale(111, 'sales-import:J:6')
    // A v0 row that already carries a calculated total violates 0161's v0 rule;
    // written with the trigger dropped, as an old row could hold it.
    sqlite.exec('DROP TRIGGER sales_money_precision_update_0161')
    sqlite.prepare('UPDATE sales SET calculated_total_usd = 1.23 WHERE id = 111').run()
    for (const migration of loadAll({ through: 234 })) if (/CREATE TRIGGER sales_money_precision_update_0161/.test(migration)) {
      sqlite.exec(migration.slice(migration.indexOf('CREATE TRIGGER sales_money_precision_update_0161')))
    }
    const before = flags()
    assert.throws(() => apply(), /money_precision_invalid_sales/)
    assert.deepEqual(flags(), before)
  })

  console.log(`\n${passed} check(s) passed.`)
})().catch((error) => {
  console.error('FAIL', error && error.stack ? error.stack : error)
  process.exitCode = 1
})
