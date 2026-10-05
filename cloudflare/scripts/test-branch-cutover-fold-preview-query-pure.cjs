// Companion for ops/queries/cutover-fold-preview.sql (cutover lane LB, verifier precheck 6).
// - the file passes the ops read-only guard (one SELECT, one row), with the same canonical SQL for LF and CRLF;
// - on the production-shaped e2e fixture, the counts the preview reads BEFORE begin equal what the real parent
//   then does at the fold stage (terminal_json.folds) after the certified children move every product: merges,
//   folded lots, each kept-apart class, the owner 6 Oct merges and the cost-changing folds;
// - date formats, fractional rows and the next-Cambodia-day count match an independent count of the fixture;
// - the verifier's P1 shape (Shop 0.2 + Warehouse 0.1 in one lot) shows up as inexact_pairs;
// - it runs at SQLite expression depth 100, and keys the branches on canonical_key, else the name.
// Run (from cloudflare/): node scripts/test-branch-cutover-fold-preview-query-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { world, drive, snapshot } = require('./test-branch-cutover-parent-e2e-native.cjs')

const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'ops/queries/cutover-fold-preview.sql'), 'utf8')

async function main() {
  let checks = 0
  const check = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name) }
  const guard = await import(pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')).href)
  const { sql, rules } = guard.guardSql(source)

  await check('the preview passes the ops read-only guard as one row, identically for LF and CRLF', () => {
    assert.equal(rules.minRows, 1); assert.equal(rules.maxRows, 1)
    const lf = source.replace(/\r\n/g, '\n')
    assert.equal(guard.guardSql(lf).sql, sql); assert.equal(guard.guardSql(lf.replace(/\n/g, '\r\n')).sql, sql)
    assert.ok(sql.length <= guard.MAX_SQL_CHARS)
  })

  await check('preview counts before begin equal the fold stage of the real run on the production-shaped fixture', async () => {
    const w = world()
    assert.equal(w.raw.limits.exprDepth, 100)
    const preview = { ...w.raw.prepare(sql).get() }
    const base = snapshot(w.raw)
    // independent counts of the fixture, before anything moves
    const positive = w.raw.prepare(`SELECT b.received_at r FROM product_batches b WHERE b.variant_product_id IN (SELECT product_id FROM branch_stock WHERE branch_id=2 AND quantity>0)
      AND EXISTS(SELECT 1 FROM branch_batch_stock s WHERE s.batch_id=b.id AND s.branch_id IN (1,2) AND s.quantity>0)`).all().map(row => row.r)
    const nextDay = positive.filter(r => typeof r === 'string' && r.length > 10 && new Date(Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(r) ? r : r.replace(' ', 'T') + 'Z') + 7 * 3600000).toISOString().slice(0, 10) !== r.slice(0, 10))
    const fractional = w.raw.prepare('SELECT (SELECT count(*) FROM branch_stock WHERE branch_id IN (1,2) AND quantity<>CAST(quantity AS INTEGER))+(SELECT count(*) FROM branch_batch_stock WHERE branch_id IN (1,2) AND quantity<>CAST(quantity AS INTEGER)) n').get().n
    assert.deepEqual([preview.branches_ok, preview.inexact_pairs, preview.fractional_rows, preview.received_next_day_in_cambodia, preview.received_null, preview.received_utc_z, preview.received_space_time],
      [1, 0, fractional, nextDay.length, positive.filter(r => r === null).length, positive.filter(r => /^\d{4}-\d{2}-\d{2}T.*Z$/.test(r || '')).length, positive.filter(r => / /.test(r || '')).length])
    assert.equal(preview.received_date_only + preview.received_utc_z + preview.received_zoned + preview.received_space_time + preview.received_other + preview.received_null, positive.length)
    assert.ok(preview.received_next_day_in_cambodia >= 2 && preview.fractional_rows > 0)
    const final = await drive(w, { base })
    const terminal = JSON.parse(final.terminal_json)
    assert.equal(preview.moving_products, terminal.committedChildren)
    assert.deepEqual({
      groups: preview.same_date_merges, foldedLots: preview.folded_lots, costChanged: preview.cost_blend_folds, expirySplit: preview.expiry_splits,
      supplierSplit: preview.supplier_splits, costSplit: preview.cost_splits, uncostedMerges: preview.unknown_cost_merges, emptySupplierMerges: preview.empty_supplier_merges,
    }, terminal.folds)
    // the fixture exercises every class, so equality is not 0 = 0
    for (const [key, value] of Object.entries(terminal.folds)) assert.ok(value > 0, key)
    const lots = w.raw.prepare("SELECT count(*) n FROM branch_batch_stock s JOIN product_batches b ON b.id=s.batch_id WHERE s.branch_id=1 AND s.quantity>0 GROUP BY b.variant_product_id ORDER BY n DESC LIMIT 1").get().n
    assert.ok(preview.max_lots_per_product >= lots)
    w.raw.close()
  })

  await check('the verifier P1 shape (one lot, Shop 0.2 + Warehouse 0.1) shows as inexact_pairs; names key the branches before 0229', () => {
    const w = world({ generatedProducts: 0 })
    w.raw.exec(`INSERT INTO products(id,name,sku,is_active,stock_quantity,cost_price_usd) VALUES(60,'P1','SKU60',1,0.3,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(60,2,0.2),(60,1,0.1);
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,unit_cost_usd,received_branch_id,received_quantity,is_active,batch_number)
        VALUES(6001,60,'lot-6001','L6001','2026-09-01',1,2,0.3,1,6001);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(6001,2,0.2),(6001,1,0.1);`)
    assert.equal(w.raw.prepare(sql).get().inexact_pairs, 2, 'the product pair and the lot pair')
    const named = w.raw.prepare(sql).get()
    // the identity rows as production holds them before 0229 (the fixture cannot clear an immutable key, so it is rebuilt)
    w.raw.exec('DROP TRIGGER branches_canonical_key_immutable; UPDATE branches SET canonical_key=NULL, role=NULL')
    assert.deepEqual({ ...w.raw.prepare(sql).get() }, { ...named }, 'production before 0229: names resolve the same branches')
    w.raw.exec("UPDATE branches SET is_active=1 WHERE id=3")
    assert.equal(w.raw.prepare(sql).get().branches_ok, 0, 'two active shops: the preview says so instead of guessing')
    w.raw.close()
  })

  console.log(`${checks} branch cutover fold preview query checks passed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
