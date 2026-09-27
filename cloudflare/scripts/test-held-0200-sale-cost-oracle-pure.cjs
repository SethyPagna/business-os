// Oracle proof for ops/scripts/migration/held/0200_sale_cost_on_hand_repair.sql
// (U-cost2, refuter R-cost findings 1-4; U-cost3, refuter R-cost2 E1-E5).
//
// ONE event list is replayed twice on real migrated SQLite (node:sqlite via
// harness/d1compat.cjs, the chain through 0194):
//   - HIST: the buggy era as it happened. The catalog figure is STORED
//     (products.cost_price_usd) and only the setters of that era wrote it --
//     a receipt and a lot cost edit recompute the buggy average (mean of the
//     DISTINCT unit costs of active lots); an app merge writes the keeper the
//     merge scalar (the mean of the keeper's and the duplicate's stored costs,
//     resolveMergedCostDetail). A lot deactivation (DELETE /batches), a
//     receipt revert that retires its lot and a 0109-style SQL merge write
//     nothing, so the figure goes stale. Every sale line and walk-in return
//     snapshots the stored figure. 0195 is applied at fix_at; after it one
//     old-Worker receipt in the deploy window still writes the buggy figure
//     over the trigger's, and the next sale snapshots it.
//   - ORACLE: the same events with 0195 live from the start: its triggers,
//     plus its recompute statement (verbatim from the migration) after every
//     event, so every snapshot is the fixed on-hand weighted cost.
// Row ids are identical in both (same writes in the same order), so every
// sale_items / return_items row of HIST is compared with its ORACLE twin.
//
// Cases (the writes mirror the app's statement shapes):
//   P  walk-in return whose id equals an earlier CANCELLED sale's id: that
//      sale's restock 'return' movement carries the same reference_id (E2)
//   A  sale-linked return with sale_item_id NULL (copied by product)
//   B  two lines of one product in one sale, one partially returned
//   C  walk-in customer return (catalog cost), USD
//   D  walk-in customer return refunded in KHR: only cost_price_usd moves
//   E  lot cost edited before AND after the sale (audit_logs batch_update)
//   F  lots emptied and deactivated (DELETE) before the sale without a
//      re-derive: the sale snapshots the STALE average (E1)
//   R  a receipt reverted before the sale (lot retired, no re-derive) (E1)
//   G  0109-style merge after the sale: lines and movements re-pointed by SQL,
//      lots left on the retired product, no snapshot -> listed, not rewritten
//   H  app merge after the sale (fold + repoint, product.merge snapshot), and
//      a sale on the keeper after the merge, which snapshots the stale merge
//      scalar (E1)
//   J  a lot whose ledger does not reconcile -> listed, never rewritten
//   K  a control line that was right all along
//   I  deploy window: an old-Worker receipt re-writes the buggy figure and
//      the next sale takes it (repaired as 'window'); the sale after that sees
//      the trigger's figure (untouched); a sale after the window (not in scope)
//
// Checks:
//   1. oracle: every rewritten line equals its ORACLE twin; every line not
//      rewritten is byte-unchanged; every line that differs from ORACLE and is
//      not rewritten is LISTED (none silently skipped) with the right bucket,
//      and its best estimate is reported.
//   2. only cost_price_usd moves (KHR, revenue, quantities byte-identical).
//   3. audit: every bucket before apply (the fixture's counts), every in-scope
//      line in exactly one bucket (unbucketed 0); after apply the rewritten
//      lines move to 'unaffected' and the review lines stay listed.
//   4. idempotent: a second run changes no table, backups included.
//   5. recovery: the header's statements restore both tables byte-identical,
//      and a re-apply lands exactly where the first did.
//   6. aborts (E3): a line after the window still carrying a buggy figure,
//      and a 0195 applied less than 2 hours ago, each abort the migration
//      with nothing written.
//   7. E2 in the other direction: a walk-in line with no restock movement of
//      its own (stock action 'none') whose return id equals a sale cancelled
//      two days LATER is positioned at its own time, not at that restock.
//   8. E5: a whole-database diff -- besides its own tables and the two cost
//      columns only sale_write_revisions / return_write_revisions change, by
//      one per rewritten line, and the header names every trigger that fires
//      (read from the schema).
// Against the U-cost2 0200 (HELD_0200_SQL=<git show copy>) checks 1, 3, 5, 6,
// 7 and 8 fail; against 66da324e's (a lower time bound only) check 7 fails.
//
// Run (from cloudflare/): node scripts/test-held-0200-sale-cost-oracle-pure.cjs [--table] [--emit <dir>]
//   --table        prints line / case / before / expected / after
//   --emit <dir>   writes the HIST rows as SQL (fixture.sql), expected.json, and
//                  the after-window fixture (abort-fixture.sql) for a wrangler
//                  --local dry run
// HELD_0200_SQL=<path> runs the checks against another copy of the file.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const migrationsDir = path.resolve(__dirname, '../migrations')
const heldPath = process.env.HELD_0200_SQL || path.resolve(__dirname, '../../ops/scripts/migration/held/0200_sale_cost_on_hand_repair.sql')
const migrationText = fs.readFileSync(heldPath, 'utf8')
const migration0195 = fs.readFileSync(path.join(migrationsDir, '0195_catalog_cost_on_hand.sql'), 'utf8')
// 0195's recompute statement, verbatim: the fixed catalog rule the ORACLE runs after every event.
const recompute0195 = (() => {
  const start = migration0195.indexOf('\nUPDATE products SET\n') + 1
  assert.ok(start > 0, '0195 recompute statement')
  return migration0195.slice(start, migration0195.indexOf(';\n', start) + 1)
})()
const FIX_AT = '2026-09-26 00:00:00'

let checks = 0
function check(name, fn) {
  try { fn(); checks++; console.log(`PASS ${name}`) }
  catch (error) { console.log(`FAIL ${name} - ${error.stack}`); process.exitCode = 1 }
}

const BUGGY = `SELECT ROUND(AVG(c), 4) AS b FROM (
  SELECT pb.unit_cost_usd AS c FROM product_batches pb
   WHERE pb.variant_product_id = ?1 AND pb.is_active = 1 AND pb.unit_cost_usd > 0
     AND pb.id > COALESCE((SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = ?1 ORDER BY id DESC LIMIT 1), 0)
  UNION
  SELECT cost_usd FROM (SELECT cost_usd FROM product_cost_entries WHERE product_id = ?1 ORDER BY id DESC LIMIT 1) WHERE cost_usd > 0)`

// One database of the pair. mode 'hist' | 'oracle'.
function world(mode) {
  const raw = openDb(loadAll({ through: 194 })).db
  for (const [id, name] of [[1, 'Shop'], [2, 'Warehouse']]) raw.prepare('INSERT OR IGNORE INTO branches(id, name) VALUES (?, ?)').run(id, name)
  const w = { mode, raw, fixed: mode === 'oracle' }
  if (w.fixed) raw.exec(migration0195)
  const stored = (productId) => raw.prepare('SELECT cost_price_usd c FROM products WHERE id = ?').get(productId).c
  w.stored = stored
  // A setter of the buggy era writes the buggy average into the stored figure.
  // oldWorker: an old Worker still serving after 0195 did the same, AFTER the
  // trigger had re-derived (the oracle never runs old code).
  w.setter = (productId, { oldWorker = false } = {}) => {
    if (w.fixed && !(oldWorker && mode === 'hist')) return
    const b = raw.prepare(BUGGY).get(productId).b
    if (b > 0) raw.prepare('UPDATE products SET cost_price_usd = ?, purchase_price_usd = ? WHERE id = ?').run(b, b, productId)
  }
  // The fixed rule after every event (the oracle; HIST after 0195 relies on its triggers only).
  w.settle = () => { if (mode === 'oracle') raw.exec(recompute0195) }
  return w
}

// The event list. Every event runs on both worlds, in order.
function replay({ afterWindow = false, lateCancel = false } = {}) {
  const H = world('hist'), O = world('oracle')
  const both = (fn) => [fn(H), fn(O)]
  const one = (fn) => { const [h, o] = both(fn); assert.deepEqual(h, o, 'ids agree across the pair'); return h }
  const cases = {}
  const tag = (name, kind, id) => { cases[`${kind}:${id}`] = name; return id }
  let seq = 0
  const product = (name) => one((w) => Number(w.raw.prepare('INSERT INTO products(name, cost_price_usd, purchase_price_usd, cost_price_khr, is_active, barcode) VALUES (?, 0, 0, 0, 1, ?)')
    .run(name, `bc-${name}`).lastInsertRowid))
  // A receipt (inventory.ts shape): lot, batch-stamped stock_in, branch_batch_stock, then the setter.
  const lot = (productId, cost, at, quantity, key = `k${++seq}`, { oldWorker = false } = {}) => one((w) => {
    const id = Number(w.raw.prepare(`INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, received_at, created_at, updated_at, received_quantity, received_branch_id)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, 1)`).run(productId, key, cost, at.slice(0, 10), at, at, quantity).lastInsertRowid)
    w.raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, batch_id, created_at)
      VALUES (?, 1, 'stock_in', ?, ?, ?, ?)`).run(productId, quantity, cost, id, at)
    w.raw.prepare('INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (?, 1, ?)').run(id, quantity)
    w.setter(productId, { oldWorker })
    w.settle()
    return id
  })
  const stock = (w, lotId, delta) => w.raw.prepare('UPDATE branch_batch_stock SET quantity = quantity + ? WHERE batch_id = ? AND branch_id = 1').run(delta, lotId)
  // A write-off: batch-stamped removal, not a setter. stamped:false is an unstamped one (no batch_id).
  const remove = (productId, lotId, at, quantity, { stamped = true } = {}) => both((w) => {
    const cost = w.raw.prepare('SELECT unit_cost_usd c FROM product_batches WHERE id = ?').get(lotId).c
    w.raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, batch_id, created_at)
      VALUES (?, 1, 'remove', ?, ?, ?, ?)`).run(productId, -quantity, cost, stamped ? lotId : null, at)
    stock(w, lotId, -quantity); w.settle()
  })
  // routes/batches.ts PATCH: the lot editor stamps updated_at, logs the body, and re-derives.
  const editLot = (productId, lotId, cost, at) => both((w) => {
    w.raw.prepare('UPDATE product_batches SET unit_cost_usd = ?, updated_at = ? WHERE id = ?').run(cost, at, lotId)
    w.raw.prepare(`INSERT INTO audit_logs(action, entity, entity_id, details, created_at) VALUES ('batch_update', 'product_batch', ?, ?, ?)`)
      .run(String(lotId), JSON.stringify({ unit_cost_usd: cost }), at)
    w.setter(productId)
    w.settle()
  })
  // routes/batches.ts DELETE before U-cost3: deactivates an empty lot, re-derives nothing.
  const deleteLot = (lotId, at) => both((w) => {
    w.raw.prepare(`UPDATE product_batches SET is_active = 0, updated_at = ? WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM branch_batch_stock WHERE batch_id = ? AND quantity > 0)`).run(at, lotId, lotId)
    w.raw.prepare(`INSERT INTO audit_logs(action, entity, entity_id, details, created_at) VALUES ('batch_deactivate', 'product_batch', ?, NULL, ?)`).run(String(lotId), at)
    w.settle()
  })
  // lib/stockRevert.ts before U-cost3: reverting a receipt removes its units
  // (batch-stamped 'remove', reference 'revert:<id>'), un-receives the lot and
  // retires it once empty; nothing re-derives the stored figure.
  const revertReceipt = (productId, lotId, at) => both((w) => {
    const m = w.raw.prepare("SELECT id, quantity, unit_cost_usd FROM inventory_movements WHERE batch_id = ? AND movement_type = 'stock_in'").get(lotId)
    w.raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, batch_id, reference_id, created_at)
      VALUES (?, 1, 'remove', ?, ?, ?, ?, ?)`).run(productId, -m.quantity, m.unit_cost_usd, lotId, `revert:${m.id}`, at)
    stock(w, lotId, -m.quantity)
    w.raw.prepare('UPDATE product_batches SET received_quantity = 0, is_active = 0, updated_at = ? WHERE id = ?').run(at, lotId)
    w.settle()
  })
  // routes/sales.ts: every line snapshots the stored catalog cost BEFORE the
  // batch moves stock; one 'sale' movement per line (reference_id = sale id).
  const sale = (name, at, lines, { status = 'completed' } = {}) => {
    const out = both((w) => {
      const costs = new Map(lines.map((l) => [l.p, w.stored(l.p)]))
      const total = lines.reduce((s, l) => s + 20 * l.q, 0)
      const saleId = Number(w.raw.prepare(`INSERT INTO sales(receipt_number, created_at, subtotal_usd, total_usd, sale_status, branch_id)
        VALUES (?, ?, ?, ?, ?, 1)`).run(`R-${name}`, at, total, total, status).lastInsertRowid)
      const lineIds = lines.map((l) => {
        const id = Number(w.raw.prepare(`INSERT INTO sale_items(sale_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr, total_usd, total_khr, branch_id, batch_id)
          VALUES (?, ?, ?, ?, 20, 82000, ?, 41000, ?, ?, 1, ?)`).run(saleId, l.p, name, l.q, costs.get(l.p), 20 * l.q, 82000 * l.q, l.lot).lastInsertRowid)
        w.raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reference_id, batch_id, created_at)
          VALUES (?, 1, 'sale', ?, ?, 0, ?, ?, ?)`).run(l.p, -l.q, costs.get(l.p), saleId, l.lot, at)
        stock(w, l.lot, -l.q)
        return id
      })
      w.settle()
      return { saleId, lineIds }
    })
    assert.deepEqual(out[0], out[1])
    out[0].lineIds.forEach((id, i) => tag(`${name}${lines.length > 1 ? `#${i + 1}` : ''}`, 'sale', id))
    return out[0]
  }
  // lib/saleTransitions.ts: cancelling restocks with a 'return' movement whose
  // reference_id is the SALE id (the ambiguous type, lib/movementReference.ts).
  const cancelSale = (saleId, productId, lotId, quantity, at) => both((w) => {
    w.raw.prepare("UPDATE sales SET sale_status = 'cancelled' WHERE id = ?").run(saleId)
    w.raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, reference_id, batch_id, created_at)
      VALUES (?, 1, 'return', ?, NULL, ?, ?, ?)`).run(productId, quantity, saleId, lotId, at)
    stock(w, lotId, quantity); w.settle()
  })
  // A customer return. Sale-linked: the cost is copied from the sale line
  // (recordedReturnCosts 'sale' source; sale_item_id NULL -> the one cost all
  // that product's lines share). Walk-in: the stored catalog cost at the return.
  // restock: false is stock action 'none': routes/returns.ts writes the
  // 'return' movement (and moves stock) only for a restocked line.
  const customerReturn = (name, at, { saleId = null, lines, currency = 'USD' }) => {
    const out = both((w) => {
      const khr = currency === 'KHR'
      const returnId = Number(w.raw.prepare(`INSERT INTO returns(return_number, sale_id, total_refund_usd, total_refund_khr, exchange_rate, status, return_scope, branch_id, created_at)
        VALUES (?, ?, ?, ?, 4100, 'completed', 'customer', 1, ?)`).run(`RT-${name}`, saleId, khr ? 0 : 20, khr ? 82000 : 0, at).lastInsertRowid)
      const ids = lines.map((l) => {
        let cost
        if (saleId == null) cost = w.stored(l.p)
        else if (l.saleItemId) cost = w.raw.prepare('SELECT cost_price_usd c FROM sale_items WHERE id = ?').get(l.saleItemId).c
        else {
          const costs = w.raw.prepare('SELECT DISTINCT cost_price_usd c FROM sale_items WHERE sale_id = ? AND product_id = ?').all(saleId, l.p)
          assert.equal(costs.length, 1, 'recordedReturnCosts: one shared cost'); cost = costs[0].c
        }
        const restock = l.restock !== false
        const id = Number(w.raw.prepare(`INSERT INTO return_items(return_id, sale_item_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr, total_usd, total_khr, return_to_stock, stock_action, branch_id, batch_id)
          VALUES (?, ?, ?, ?, ?, 20, 82000, ?, ?, ?, ?, ?, ?, 1, ?)`).run(returnId, l.saleItemId || null, l.p, name, l.q, cost, l.khr ?? 41000, khr ? 0 : 20 * l.q, khr ? 82000 * l.q : 0,
          restock ? 1 : 0, restock ? 'restock' : 'none', restock ? l.lot : null).lastInsertRowid)
        if (restock) {
          w.raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, reference_id, batch_id, created_at)
            VALUES (?, 1, 'return', ?, ?, ?, ?, ?)`).run(l.p, l.q, cost, returnId, l.lot, at)
          stock(w, l.lot, l.q)
        }
        return id
      })
      w.settle()
      return ids
    })
    assert.deepEqual(out[0], out[1])
    out[0].forEach((id, i) => tag(`${name}${lines.length > 1 ? `#${i + 1}` : ''}`, 'return', id))
    return out[0]
  }
  // The app's merge (routes/products.ts): same-key lots fold (stock onto the
  // keeper lot, dup lot emptied and deactivated, allocations re-pointed),
  // the rest re-point; lines and movements re-parent; one product.merge
  // snapshot carrying keeperPricingBefore. Before 0195 the keeper's stored
  // cost became the merge scalar and nothing re-derived it.
  const appMerge = (dup, keeper, at, { fold = [], repoint = [] }) => both((w) => {
    const r = w.raw
    const keeperPricingBefore = { cost_price_usd: w.stored(keeper) }
    if (!w.fixed) {
      const values = [...new Set([w.stored(keeper), w.stored(dup)].filter((v) => v > 0))]
      const min = Math.min(...values), max = Math.max(...values)
      const merged = values.length > 1 && max > min * 2 ? max : Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10000) / 10000
      r.prepare('UPDATE products SET cost_price_usd = ?, purchase_price_usd = ? WHERE id = ?').run(merged, merged, keeper)
    }
    const foldedBatches = fold.map(([dupBatchId, keeperBatchId]) => {
      const dupStockBefore = r.prepare('SELECT branch_id, quantity FROM branch_batch_stock WHERE batch_id = ?').all(dupBatchId).map((x) => ({ branch_id: x.branch_id, quantity: x.quantity }))
      const saleAllocationIds = r.prepare('SELECT id FROM sale_item_batch_allocations WHERE batch_id = ?').all(dupBatchId).map((x) => x.id)
      for (const s of dupStockBefore) if (s.quantity) r.prepare(`INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (?, ?, ?)
        ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity`).run(keeperBatchId, s.branch_id, s.quantity)
      r.prepare('DELETE FROM branch_batch_stock WHERE batch_id = ?').run(dupBatchId)
      r.prepare('UPDATE product_batches SET is_active = 0, updated_at = ? WHERE id = ?').run(at, dupBatchId)
      r.prepare('UPDATE sale_item_batch_allocations SET batch_id = ? WHERE batch_id = ?').run(keeperBatchId, dupBatchId)
      return { dupBatchId, keeperBatchId, dupStockBefore, keeperStockBefore: [], saleAllocationIds, returnAllocationIds: [] }
    })
    const repointedBatches = repoint.map((id) => {
      r.prepare('UPDATE product_batches SET variant_product_id = ?, updated_at = ? WHERE id = ?').run(keeper, at, id)
      return { id, batchNumber: null }
    })
    const ids = (table) => r.prepare(`SELECT id FROM ${table} WHERE product_id = ? ORDER BY id`).all(dup).map((x) => x.id)
    const reparentedSaleItemIds = ids('sale_items')
    const reparentedMovementIds = ids('inventory_movements')
    const reparentedByTable = [{ table: 'return_items', column: 'product_id', ids: ids('return_items') }]
    for (const t of ['sale_items', 'inventory_movements', 'return_items']) r.prepare(`UPDATE ${t} SET product_id = ? WHERE product_id = ?`).run(keeper, dup)
    r.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(dup)
    r.prepare(`INSERT INTO undo_snapshots(kind, status, payload_json, created_at, updated_at) VALUES ('product.merge', 'applied', ?, ?, ?)`)
      .run(JSON.stringify({ dupId: dup, keeperId: keeper, keeperPricingBefore, repointedBatches, foldedBatches, writtenOffBatches: [], reparentedSaleItemIds, reparentedMovementIds, reparentedByTable }), at, at)
    w.settle()
  })
  // 0109-style (a migration, not the app): lines and movements re-pointed by
  // SQL, the retired row deactivated, its lots LEFT on it, no snapshot.
  const sqlMerge = (dup, keeper) => both((w) => {
    for (const t of ['sale_items', 'inventory_movements']) w.raw.prepare(`UPDATE ${t} SET product_id = ? WHERE product_id = ?`).run(keeper, dup)
    w.raw.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(dup)
    w.settle()
  })
  const apply0195 = () => {
    H.raw.exec(migration0195)
    H.raw.prepare('UPDATE catalog_cost_repair_0195_backup SET created_at = ?').run(FIX_AT)
    H.fixed = true
    O.raw.prepare('UPDATE catalog_cost_repair_0195_backup SET created_at = ?').run(FIX_AT)
  }

  const d = (day, hms = '09:00:00') => `2026-09-${day} ${hms}`

  if (afterWindow) {
    // The E3 abort fixture: an old-Worker receipt after the window, and the
    // sale that snapshots its buggy figure. 4 x 10 + 1 x 20, one sold -> 0195
    // gives 50 / 4; the old Worker's receipt of 1 x 30 writes mean(10, 20, 30)
    // = 20 over it; on hand 80 / 5 = 16.
    const pw = product('W'); const w1 = lot(pw, 10, d(17), 4); lot(pw, 20, d(18), 1)
    sale('W-era', d(20), [{ p: pw, q: 1, lot: w1 }])
    apply0195()
    lot(pw, 30, d(26, '03:00:00'), 1, undefined, { oldWorker: true })
    sale('W-after-window', d(26, '03:00:00'), [{ p: pw, q: 1, lot: w1 }])
    return { H, O, cases }
  }

  if (lateCancel) {
    // The E2 late-cancellation fixture. Q: 3 x 10 + 1 x 30 -> stored 20, on
    // hand 15. Sale #1 takes one unit; walk-in return #1 is stock action
    // 'none' (no movement of its own): stored 20, on hand 50 / 3 = 16.6667.
    // A 5 x 90 receipt follows, then sale #1 is cancelled two days after the
    // return -- its restock 'return' movement names reference_id 1 and Q.
    // Positioned there the line would read (20 + 30 + 450) / 8 = 62.5.
    const pq = product('Q'); const q1 = lot(pq, 10, d(16, '15:00:00'), 3); lot(pq, 30, d(17), 1)
    const sQ = sale('Q-cancelled-later', d(18), [{ p: pq, q: 1, lot: q1 }])
    customerReturn('Q-walkin-none', d(20), { lines: [{ p: pq, q: 1, restock: false }] })
    lot(pq, 90, d(21), 5)
    cancelSale(sQ.saleId, pq, q1, 1, d(22))
    apply0195()
    return { H, O, cases }
  }

  // P (E2): sale #1 of X is cancelled on the 17th -- its restock movement is
  // 'return' with reference_id 1. The walk-in return below is returns.id 1.
  // P: 1 x 10, then 9 x 30 -> stored mean 20; on hand at the return 280 / 10 = 28.
  const px = product('X'); const x1 = lot(px, 3, d(16, '15:00:00'), 5)
  const sX = sale('X-cancelled', d(17), [{ p: px, q: 1, lot: x1 }])
  cancelSale(sX.saleId, px, x1, 1, d(17, '10:00:00'))
  const pp = product('P'); lot(pp, 10, d(18), 1); const p2 = lot(pp, 30, d(19), 9)
  const [pRet] = customerReturn('P-walkin', d(22), { lines: [{ p: pp, q: 1, lot: p2 }] })
  assert.equal(one((w) => w.raw.prepare('SELECT return_id r FROM return_items WHERE id = ?').get(pRet).r), sX.saleId, 'P: the return id collides with the cancelled sale id')

  // A: 2 x 10 + 6 x 14. Stored 12; on hand 13. The return copies by product.
  const pa = product('A'); lot(pa, 10, d(17), 2); const a2 = lot(pa, 14, d(18), 6)
  const sA = sale('A', d(20), [{ p: pa, q: 1, lot: a2 }])
  customerReturn('A-ret', d(21), { saleId: sA.saleId, lines: [{ p: pa, q: 1, lot: a2, saleItemId: null }] })

  // B: 3 x 4 + 1 x 8. Stored 6; on hand 5. Two lines of B in one sale, the
  // second one partially returned (1 of 2).
  const pb = product('B'); const b1 = lot(pb, 4, d(17), 3); lot(pb, 8, d(18), 1)
  const sB = sale('B', d(20), [{ p: pb, q: 1, lot: b1 }, { p: pb, q: 2, lot: b1 }])
  customerReturn('B-ret', d(21), { saleId: sB.saleId, lines: [{ p: pb, q: 1, lot: b1, saleItemId: sB.lineIds[1] }] })

  // C: walk-in, 4 x 3 + 2 x 9. Stored 6; on hand 5.
  const pc = product('C'); lot(pc, 3, d(17), 4); const c2 = lot(pc, 9, d(18), 2)
  customerReturn('C-walkin', d(20), { lines: [{ p: pc, q: 1, lot: c2 }] })

  // D: walk-in refunded in KHR, 3 x 2 + 1 x 6. Stored 4; on hand 3. KHR cost stays.
  const pd = product('D'); const d1 = lot(pd, 2, d(17), 3); lot(pd, 6, d(18), 1)
  customerReturn('D-walkin-khr', d(20), { lines: [{ p: pd, q: 1, lot: d1, khr: 16400 }], currency: 'KHR' })

  // E: 1 x 10 + 3 x 20; E2 edited to 21 before the sale and to 22 after it.
  // Stored (10 + 21) / 2 = 15.5; on hand (10 + 63) / 4 = 18.25.
  const pe = product('E'); lot(pe, 10, d(17), 1); const e2 = lot(pe, 20, d(18), 3)
  editLot(pe, e2, 21, d(19))
  sale('E', d(20), [{ p: pe, q: 1, lot: e2 }])
  editLot(pe, e2, 22, d(22))

  // F: F0 (50 x 1), F1 (6 x 1), F2 (10 x 3) received: stored (50 + 6 + 10) / 3
  // = 22. F0 emptied and deleted before the sale -- nothing re-derives, so
  // the sale still snapshots 22; on hand (6 + 30) / 4 = 9. F1 emptied and
  // deleted after it.
  const pf = product('F'); const f0 = lot(pf, 50, d(17), 1); const f1 = lot(pf, 6, d(17, '10:00:00'), 1); const f2 = lot(pf, 10, d(18), 3)
  remove(pf, f0, d(18, '12:00:00'), 1); deleteLot(f0, d(18, '12:00:00'))
  sale('F', d(20), [{ p: pf, q: 1, lot: f2 }])
  remove(pf, f1, d(22), 1); deleteLot(f1, d(22))

  // R: 2 x 4 + 2 x 12 -> stored 8. The 12 receipt is reverted (lot retired),
  // nothing re-derives: the sale snapshots 8; on hand 2 x 4 -> 4.
  const pr = product('R'); const r1 = lot(pr, 4, d(17), 2); const r2 = lot(pr, 12, d(18), 2)
  revertReceipt(pr, r2, d(19))
  sale('R', d(20), [{ p: pr, q: 1, lot: r1 }])

  // G: 0109-style after the sale. Stored (4 + 10) / 2 = 7; on hand 8.5.
  const pgDup = product('G-dup'); lot(pgDup, 4, d(17), 1); const g2 = lot(pgDup, 10, d(18), 3)
  const pgKeep = product('G-keeper'); lot(pgKeep, 20, d(18), 1)
  sale('G', d(20), [{ p: pgDup, q: 1, lot: g2 }])
  sqlMerge(pgDup, pgKeep)

  // H: app merge after the sale. Dup: H1 (5 x 1, key KH1), H2 (9 x 3, KH2)
  // -> stored 7; keeper: HK (6 x 2, KH1) -> stored 6. H1 folds into HK, H2
  // re-points; the keeper's stored cost becomes mean(6, 7) = 6.5.
  // The dup's sale: stored 7, on hand (5 + 27) / 4 = 8.
  // The keeper's sale after the merge: stored 6.5; on hand HK 3 x 6 + H2 2 x 9 -> 7.2.
  const phDup = product('H-dup'); const h1 = lot(phDup, 5, d(17), 1, 'KH1'); const h2 = lot(phDup, 9, d(18), 3, 'KH2')
  const phKeep = product('H-keeper'); const hk = lot(phKeep, 6, d(18), 2, 'KH1')
  sale('H', d(20), [{ p: phDup, q: 1, lot: h2 }])
  appMerge(phDup, phKeep, d(23), { fold: [[h1, hk]], repoint: [h2] })
  sale('H-after-merge', d(24), [{ p: phKeep, q: 1, lot: h2 }])

  // J: J2 lost a unit to an unstamped removal: its ledger says 2, the shelf 1.
  // Stored 5; the ledger estimate 5; the shelf (2 x 3 + 1 x 7) / 3 = 4.3333.
  const pj = product('J'); const j1 = lot(pj, 3, d(17), 2); const j2 = lot(pj, 7, d(18), 2)
  remove(pj, j2, d(19), 1, { stamped: false })
  sale('J', d(20), [{ p: pj, q: 1, lot: j1 }])

  // K: one lot, so stored = on hand = 7. Right all along.
  const pk = product('K'); const k1 = lot(pk, 7, d(17), 3)
  sale('K', d(20), [{ p: pk, q: 1, lot: k1 }])

  // I: 1 x 10 + 5 x 20 -> stored 15. 0195 goes live at fix_at (HIST) and
  // re-derives 110 / 6. In the window an old-Worker receipt of 1 x 40 writes
  // mean(10, 20, 40) = 23.3333 over the trigger's figure.
  const pi = product('I'); lot(pi, 10, d(17), 1); const i2 = lot(pi, 20, d(18), 5)
  apply0195()
  lot(pi, 40, d(26, '00:20:00'), 1, undefined, { oldWorker: true })
  sale('I-window-buggy', d(26, '00:30:00'), [{ p: pi, q: 1, lot: i2 }]) // stored 23.3333; on hand 150 / 7 = 21.4286
  sale('I-window-fixed', d(26, '00:45:00'), [{ p: pi, q: 1, lot: i2 }]) // the sale's trigger re-derived: 130 / 6 both
  sale('I-later', d(26, '04:00:00'), [{ p: pi, q: 1, lot: i2 }]) // 110 / 5 = 22 both, not in scope

  return { H, O, cases }
}

// What each case must end as. 'oracle' = rewritten to the ORACLE twin;
// 'listed:<bucket>' = byte-unchanged and listed; 'same' = unchanged, not listed for review.
const EXPECT = {
  'X-cancelled': 'same', 'P-walkin': 'oracle',
  'A': 'oracle', 'A-ret': 'oracle',
  'B#1': 'oracle', 'B#2': 'oracle', 'B-ret': 'oracle',
  'C-walkin': 'oracle', 'D-walkin-khr': 'oracle',
  'E': 'oracle', 'F': 'oracle', 'R': 'oracle',
  'G': 'listed:needs_owner_review',
  'H': 'oracle', 'H-after-merge': 'oracle',
  'J': 'listed:ledger_unverified',
  'K': 'same',
  'I-window-buggy': 'oracle', 'I-window-fixed': 'same', 'I-later': 'same',
}
const REWRITTEN_BUCKET = { sale: ['repair', 'window'], return: ['returns_sale_linked', 'returns_walk_in'] }
const INFORMATIONAL = ['-', 'already_correct', 'unaffected']

const apply = (raw) => raw.exec(migrationText)
const recoverySql = () => migrationText.split('\n-- Statements:\n')[1].split('\n-- The backup tables')[0]
  .split('\n').filter((l) => l.startsWith('--   ')).map((l) => l.slice(5)).join('\n')

function dump(raw, table) {
  return raw.prepare(`SELECT *, typeof(cost_price_usd) AS cost_type FROM ${table} ORDER BY id`).all().map((r) => ({ ...r }))
}
// Every table's rows, for a whole-database diff.
function snapshotAll(raw) {
  return Object.fromEntries(raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    .map((t) => [t.name, raw.prepare(`SELECT * FROM "${t.name}"`).all().map((r) => JSON.stringify(r)).sort()]))
}
const tableExists = (raw, t) => !!raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)
const plainDump = (raw, t) => tableExists(raw, t) ? raw.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all().map((r) => ({ ...r })) : null

// Audit statement 1 (bucket summary), cut from the audit file as the header says.
const auditText = fs.readFileSync(path.resolve(__dirname, '../../ops/scripts/audit/sale-cost-on-hand-audit.sql'), 'utf8')
  // SELECT-only and outside the eol=lf rule: a fresh autocrlf checkout may give it CRLF.
  .replace(/\r\n/g, '\n')
const auditSummary = (raw) => {
  const block = auditText.split(/\n(?=-- plan:begin\n)/)[1]
  const sql = block.slice(0, block.indexOf(';\n') + 1).split('\n').filter((l) => !l.startsWith('--')).join('\n')
  return Object.fromEntries(raw.prepare(sql).all().map((r) => [r.bucket, [r.lines, r.units, r.cost_delta_usd]]))
}
// Audit statement 2 (the listed lines, everything but 'unaffected').
const auditListed = (raw) => {
  const block = auditText.split(/\n(?=-- plan:begin\n)/)[2]
  const sql = block.slice(0, block.indexOf(';\n') + 1).split('\n').filter((l) => !l.startsWith('--')).join('\n')
  return raw.prepare(sql).all().map((r) => [`${r.kind}:${r.item_id}`, r.bucket, r.reason])
}

const argv = process.argv.slice(2)
const world0 = replay()
const { H, O, cases } = world0
let summaryBefore = null
try { summaryBefore = auditSummary(H.raw) } catch (error) { summaryBefore = error }
const before = { sale: dump(H.raw, 'sale_items'), return: dump(H.raw, 'return_items') }
const oracle = { sale: dump(O.raw, 'sale_items'), return: dump(O.raw, 'return_items') }
let applied = null
const allBefore = snapshotAll(H.raw)
try { apply(H.raw); applied = true } catch (error) { applied = error }
const allAfter = snapshotAll(H.raw)
const after = { sale: dump(H.raw, 'sale_items'), return: dump(H.raw, 'return_items') }
const plan = tableExists(H.raw, 'sale_cost_repair_0200_plan')
  ? Object.fromEntries(H.raw.prepare('SELECT kind, item_id, bucket, reason, correct_cost_usd FROM sale_cost_repair_0200_plan').all().map((r) => [`${r.kind}:${r.item_id}`, r]))
  : {}

const rows = []
for (const kind of ['sale', 'return']) {
  for (let i = 0; i < before[kind].length; i++) {
    const key = `${kind}:${before[kind][i].id}`
    rows.push({ key, case: cases[key] || '?', before: before[kind][i].cost_price_usd, oracle: oracle[kind][i].cost_price_usd,
      after: after[kind][i] ? after[kind][i].cost_price_usd : undefined, bucket: plan[key]?.bucket ?? '-', reason: plan[key]?.reason ?? '',
      estimate: plan[key]?.correct_cost_usd ?? null })
  }
}
if (argv.includes('--table')) {
  console.log('line          case              before    expected  after     bucket               reason                               estimate')
  for (const r of rows) {
    const exp = EXPECT[r.case] === 'oracle' ? r.oracle : r.before
    console.log(`${r.key.padEnd(13)} ${r.case.padEnd(17)} ${String(r.before).padEnd(9)} ${String(exp).padEnd(9)} ${String(r.after).padEnd(9)} ${String(r.bucket).padEnd(20)} ${String(r.reason).padEnd(36)} ${r.estimate ?? ''}${EXPECT[r.case] !== 'oracle' && r.oracle !== r.before ? `  (oracle ${r.oracle})` : ''}`)
  }
}
const byCase = Object.fromEntries(rows.map((r) => [r.case, r]))

check('fixture: the pair agrees on every non-cost column, and the fixture is discriminating', () => {
  for (const kind of ['sale', 'return']) {
    assert.equal(before[kind].length, oracle[kind].length)
    before[kind].forEach((h, i) => {
      const o = oracle[kind][i]
      for (const k of Object.keys(h)) if (k !== 'cost_price_usd') assert.ok(Object.is(h[k], o[k]), `${kind} ${h.id} ${k}`)
    })
  }
  assert.deepEqual(Object.keys(EXPECT).sort(), [...new Set(Object.values(cases))].sort(), 'every case has an expectation')
  // Each 'oracle' case really was wrong in HIST, and each control really was right.
  for (const r of rows) {
    if (EXPECT[r.case] === 'oracle') assert.ok(Math.abs(r.before - r.oracle) >= 0.00005, `${r.case}: HIST differs from the oracle`)
    if (EXPECT[r.case] === 'same') assert.equal(r.before, r.oracle, `${r.case}: control was right`)
  }
  assert.deepEqual(['P-walkin', 'A', 'B#1', 'C-walkin', 'D-walkin-khr', 'E', 'F', 'R', 'G', 'H', 'H-after-merge', 'J', 'I-window-buggy'].map((c) => [byCase[c].before, byCase[c].oracle]),
    [[20, 28], [12, 13], [6, 5], [6, 5], [4, 3], [15.5, 18.25], [22, 9], [8, 4], [7, 8.5], [7, 8], [6.5, 7.2], [5, 4.3333], [23.3333, 21.4286]], 'hand-checked figures')
})

check('oracle: every rewritten line equals its fixed-code twin; nothing that differs is silently skipped', () => {
  if (applied !== true) throw applied
  const failures = []
  for (const r of rows) {
    const want = EXPECT[r.case]
    if (want === 'oracle') { if (!Object.is(r.after, r.oracle)) failures.push(`${r.case} (${r.key}): after ${r.after}, oracle ${r.oracle}`) }
    else if (!Object.is(r.after, r.before)) failures.push(`${r.case} (${r.key}): moved ${r.before} -> ${r.after}`)
    if (want.startsWith('listed:') && r.bucket !== want.slice(7)) failures.push(`${r.case} (${r.key}): bucket ${r.bucket}, want ${want.slice(7)}`)
    if (want === 'oracle' && !REWRITTEN_BUCKET[r.key.split(':')[0]].includes(r.bucket)) failures.push(`${r.case} (${r.key}): bucket ${r.bucket}`)
    if (want === 'same' && !INFORMATIONAL.includes(r.bucket)) failures.push(`${r.case} (${r.key}): listed as ${r.bucket}`)
    // Not silently skipped: whatever still differs from the oracle is listed.
    if (!Object.is(r.after, r.oracle) && INFORMATIONAL.includes(r.bucket)) failures.push(`${r.case} (${r.key}): differs from the oracle and is not listed`)
  }
  assert.deepEqual(failures, [])
  assert.equal(plan[byCase.G.key].reason, 'sold_lot_belongs_to_another_product')
  assert.equal(byCase.G.estimate, byCase.G.oracle, '0109-style: the best estimate is the fixed-code figure')
  assert.equal(byCase.J.estimate, 5, 'unreconciled ledger: the estimate is reported as what the ledger says, and not trusted')
  // Which producer proved each stale line.
  assert.deepEqual(['F', 'R', 'H-after-merge', 'I-window-buggy', 'P-walkin'].map((c) => byCase[c].reason),
    ['stale_buggy_average', 'stale_buggy_average', 'stale_merge_cost', 'buggy_average_deploy_window', 'buggy_average'])
})

check('only sale_items.cost_price_usd and return_items.cost_price_usd move; KHR and everything else byte-identical', () => {
  if (applied !== true) throw applied
  for (const kind of ['sale', 'return']) {
    before[kind].forEach((b, i) => {
      const a = after[kind][i]
      for (const k of Object.keys(b)) if (k !== 'cost_price_usd') assert.ok(Object.is(a[k], b[k]), `${kind} ${b.id} ${k}`)
      assert.equal(a.cost_type, 'real')
    })
  }
  const khr = after.return.find((x) => `return:${x.id}` === byCase['D-walkin-khr'].key)
  assert.equal(khr.cost_price_khr, 16400, 'KHR cost untouched')
})

// E5: the header's write claim, checked against the whole database. The
// triggers that fire are read from the schema, so a trigger added later on
// either table fails this until the header names it.
check('E5: besides its own tables and the two cost columns, the only writes are the revision triggers the header names, one bump per rewritten line', () => {
  if (applied !== true) throw applied
  const own = ['sale_cost_repair_0200', 'sale_cost_repair_0200_return_items', 'sale_cost_repair_0200_plan']
  const changed = Object.keys(allAfter).filter((t) => !own.includes(t) && JSON.stringify(allAfter[t]) !== JSON.stringify(allBefore[t] ?? []))
  assert.deepEqual(changed, ['return_items', 'return_write_revisions', 'sale_items', 'sale_write_revisions'], 'tables written')
  const firing = H.raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ('sale_items', 'return_items')
    AND upper(sql) LIKE '%AFTER UPDATE%' ORDER BY name`).all().map((r) => r.name)
  assert.deepEqual(firing, ['return_revision_items_update', 'sale_revision_return_items_update', 'sale_revision_sale_items_update'])
  const comments = migrationText.split('\n').filter((l) => l.startsWith('--')).join('\n')
  for (const name of firing) assert.ok(comments.includes(name), `the header names ${name}`)
  // One bump per rewritten line: a sale for each of its lines and each line of a return linked to it; a return for each of its lines.
  const revisions = (rows, key) => Object.fromEntries(rows.map((r) => JSON.parse(r)).map((r) => [r[key], r.revision]))
  const bumps = (table, key) => {
    const b = revisions(allBefore[table], key), a = revisions(allAfter[table], key)
    return Object.fromEntries(Object.keys(a).filter((k) => a[k] !== (b[k] ?? 0)).map((k) => [k, a[k] - (b[k] ?? 0)]))
  }
  const count = (sql) => Object.fromEntries(H.raw.prepare(sql).all().map((r) => [String(r.id), r.n]))
  const saleExpected = count(`SELECT id, SUM(n) n FROM (
      SELECT sale_id id, COUNT(*) n FROM sale_cost_repair_0200 GROUP BY sale_id
      UNION ALL
      SELECT r.sale_id, COUNT(*) FROM sale_cost_repair_0200_return_items x JOIN returns r ON r.id = x.return_id WHERE r.sale_id IS NOT NULL GROUP BY r.sale_id)
    GROUP BY id`)
  const returnExpected = count('SELECT return_id id, COUNT(*) n FROM sale_cost_repair_0200_return_items GROUP BY return_id')
  assert.ok(Object.keys(saleExpected).length >= 8 && Object.keys(returnExpected).length >= 4, 'the fixture rewrites lines of several sales and returns')
  assert.deepEqual(bumps('sale_write_revisions', 'sale_id'), saleExpected, 'sale revisions')
  assert.deepEqual(bumps('return_write_revisions', 'return_id'), returnExpected, 'return revisions')
})

check('audit: every in-scope line in exactly one bucket; after apply the rewritten lines leave the rewritten buckets', () => {
  if (applied !== true) throw applied
  if (summaryBefore instanceof Error) throw summaryBefore
  // [lines, units, cost delta] -- the fixture's bucket counts.
  assert.deepEqual(summaryBefore, {
    // A +1, B#1 -1, B#2 2 x -1, E +2.75, F -13, R -4, H +1, H-after-merge +0.7
    repair: [8, 9, -14.55],
    window: [1, 1, -1.9047], // I-window-buggy
    returns_sale_linked: [2, 2, 0], // A-ret +1, B-ret -1
    returns_walk_in: [3, 3, 6], // P +8, C -1, D (KHR) -1
    ledger_unverified: [1, 1, 0], // J: the ledger's own estimate equals the recorded cost; the shelf says 4.3333
    needs_owner_review: [1, 1, 1.5], // G, 0109-style
    after_window: [0, 0, 0],
    already_correct: [2, 2, 0], // X-cancelled, K
    unaffected: [1, 1, 0], // I-window-fixed
    unbucketed: [0, 0, 0],
  })
  // Every line of an era sale and every era walk-in return is in the plan once.
  const inScope = rows.filter((r) => r.case !== 'I-later')
  assert.deepEqual(inScope.filter((r) => r.bucket === '-').map((r) => r.case), [], 'every in-scope line bucketed')
  assert.equal(Object.keys(plan).length, inScope.length)
  const afterSummary = auditSummary(H.raw)
  // A rewritten line now holds its on-hand cost, so it is 'unaffected' -- or
  // 'already_correct' when some setter moment's figure also equals that cost.
  // In this fixture exactly one does: see the listing below.
  assert.deepEqual(afterSummary, { ...summaryBefore, repair: [0, 0, 0], window: [0, 0, 0], returns_sale_linked: [0, 0, 0], returns_walk_in: [0, 0, 0],
    already_correct: [3, 3, 0], unaffected: [1 + 8 + 1 + 2 + 3 - 1, 1 + 9 + 1 + 2 + 3 - 1, 0] },
  'post-check: the rewritten lines now hold the on-hand cost; the review lines are exactly as before')
  const listedAfter = auditListed(H.raw)
  const rewritten = new Set(rows.filter((r) => EXPECT[r.case] === 'oracle').map((r) => r.key))
  const movedToCorrect = listedAfter.filter(([key]) => rewritten.has(key))
  console.log('post-apply: rewritten lines still listed:', JSON.stringify(movedToCorrect.map(([key, b, reason]) => [cases[key], b, reason])))
  assert.equal(movedToCorrect.length, 1)
  assert.equal(movedToCorrect[0][1], 'already_correct')
  // The review lines are listed exactly as before.
  assert.deepEqual(listedAfter.filter(([, b]) => b !== 'already_correct').map(([k, b, r]) => [cases[k], b, r]).sort(),
    [['G', 'needs_owner_review', 'sold_lot_belongs_to_another_product'], ['J', 'ledger_unverified', 'lot_ledger_does_not_reconcile']])
})

check('idempotent: a second run changes no table, backups and plan included', () => {
  if (applied !== true) throw applied
  const tables = ['sale_items', 'return_items', 'sale_cost_repair_0200', 'sale_cost_repair_0200_return_items', 'sale_cost_repair_0200_plan', 'products', 'inventory_movements']
  const snap = () => Object.fromEntries(tables.map((t) => [t, plainDump(H.raw, t)]))
  const one = snap()
  apply(H.raw)
  assert.deepEqual(snap(), one)
})

check('recovery: the header statements restore both cost columns byte-identical; a line edited since is left alone', () => {
  if (applied !== true) throw applied
  H.raw.exec(recoverySql())
  assert.deepEqual(dump(H.raw, 'sale_items'), before.sale)
  assert.deepEqual(dump(H.raw, 'return_items'), before.return)
  // Rolled back, a fresh apply lands exactly where the first one did.
  apply(H.raw)
  assert.deepEqual(dump(H.raw, 'sale_items'), after.sale)
  assert.deepEqual(dump(H.raw, 'return_items'), after.return)
  // Recover, hand-edit one rewritten line, re-apply: the edit stays, the rest is repaired again, no abort.
  H.raw.exec(recoverySql())
  H.raw.prepare('UPDATE sale_items SET cost_price_usd = 99 WHERE id = ?').run(Number(byCase.A.key.split(':')[1]))
  apply(H.raw)
  const again = dump(H.raw, 'sale_items')
  after.sale.forEach((a, i) => assert.equal(again[i].cost_price_usd, `sale:${a.id}` === byCase.A.key ? 99 : a.cost_price_usd, `sale ${a.id}`))
})

// E3: each refusal aborts with nothing written. The migration runs inside an
// explicit transaction here, as D1 applies it; the abort must leave every
// table (and the schema) exactly as before.
const fullSnap = (raw) => raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
  .map((t) => [t.name, raw.prepare(`SELECT * FROM "${t.name}"`).all().map((r) => JSON.stringify(r)).sort()])
function applyAtomically(raw) {
  raw.exec('BEGIN')
  try { raw.exec(migrationText); raw.exec('COMMIT'); return null } catch (error) { raw.exec('ROLLBACK'); return error }
}
check('abort: a line after the deploy window still carrying a buggy figure refuses the whole migration, nothing written', () => {
  const { H: A, O: AO, cases: aCases } = replay({ afterWindow: true })
  const dumpA = dump(A.raw, 'sale_items'), dumpAO = dump(AO.raw, 'sale_items')
  const line = dumpA.find((x) => aCases[`sale:${x.id}`] === 'W-after-window')
  assert.deepEqual([line.cost_price_usd, dumpAO.find((x) => x.id === line.id).cost_price_usd], [20, 16], 'the fixture really has a buggy line after the window')
  const summary = auditSummary(A.raw)
  assert.deepEqual(summary.after_window, [1, 1, -4], 'the audit shows it')
  const snapBefore = fullSnap(A.raw)
  const error = applyAtomically(A.raw)
  assert.ok(error && /NOT NULL constraint failed: branches\.name/.test(error.message), `aborted (${error && error.message})`)
  assert.deepEqual(fullSnap(A.raw), snapBefore, 'nothing written, no table created')
  assert.ok(!tableExists(A.raw, 'sale_cost_repair_0200_plan'))
})
check('abort: 0195 applied less than 2 hours ago, or missing, refuses the whole migration, nothing written', () => {
  const { H: A } = replay()
  A.raw.prepare("UPDATE catalog_cost_repair_0195_backup SET created_at = datetime('now', '-1 hours')").run()
  const snapBefore = fullSnap(A.raw)
  const error = applyAtomically(A.raw)
  assert.ok(error && /NOT NULL constraint failed: branches\.name/.test(error.message), `aborted (${error && error.message})`)
  assert.deepEqual(fullSnap(A.raw), snapBefore, 'nothing written')
  A.raw.exec('DELETE FROM catalog_cost_repair_0195_backup')
  assert.ok(/branches\.name/.test(applyAtomically(A.raw)?.message || ''), 'an empty backup table refuses too')
  A.raw.exec('DROP TABLE catalog_cost_repair_0195_backup')
  assert.ok(/no such table: catalog_cost_repair_0195_backup/.test(applyAtomically(A.raw)?.message || ''), 'without 0195 it refuses')
})

// E2, the other direction: 'P-walkin' collides with an EARLIER cancellation;
// a walk-in line with no restock of its own collides with a LATER one. Only a
// window on both sides of returns.created_at keeps that restock (written in
// another request, days later) from positioning the line.
check('E2: a walk-in line with no movement of its own is not positioned at a later cancellation of the same-numbered sale', () => {
  const { H: L, O: LO, cases: lCases } = replay({ lateCancel: true })
  const key = Object.keys(lCases).find((k) => lCases[k] === 'Q-walkin-none')
  const id = Number(key.split(':')[1])
  const ret = L.raw.prepare('SELECT r.id, r.created_at, ri.cost_price_usd c FROM return_items ri JOIN returns r ON r.id = ri.return_id WHERE ri.id = ?').get(id)
  const cancel = L.raw.prepare("SELECT created_at FROM inventory_movements WHERE movement_type = 'return' AND reference_id = ? ORDER BY id").all(ret.id)
  assert.deepEqual([cancel.length, cancel[0].created_at > ret.created_at], [1, true], 'the only return-typed movement naming the return id is the later cancellation')
  const oracleCost = LO.raw.prepare('SELECT cost_price_usd c FROM return_items WHERE id = ?').get(id).c
  assert.deepEqual([ret.c, oracleCost], [20, 16.6667], 'the fixture is discriminating')
  const error = applyAtomically(L.raw)
  if (error) throw error
  const planRow = L.raw.prepare("SELECT bucket, correct_cost_usd FROM sale_cost_repair_0200_plan WHERE kind = 'return' AND item_id = ?").get(id)
  assert.deepEqual([planRow.bucket, L.raw.prepare('SELECT cost_price_usd c FROM return_items WHERE id = ?').get(id).c], ['returns_walk_in', oracleCost],
    `positioned at its own time, not at the cancellation (estimate ${planRow.correct_cost_usd})`)
})

// --emit <dir>: the HIST rows (state just before 0200) as SQL for a wrangler
// --local dry run on a database migrated through 0195, plus expected.json,
// and the after-window fixture that must abort.
const emitAt = argv.indexOf('--emit')
if (emitAt >= 0) {
  const dir = argv[emitAt + 1]
  const lit = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
  const emit = (fresh) => {
    const out = ['PRAGMA defer_foreign_keys = true;']
    for (const t of ['products', 'product_batches', 'branch_batch_stock', 'inventory_movements', 'sales', 'sale_items', 'returns', 'return_items',
      'sale_item_batch_allocations', 'product_cost_entries', 'undo_snapshots', 'audit_logs', 'catalog_cost_repair_0195_backup']) {
      for (const r of fresh.prepare(`SELECT * FROM ${t}`).all()) {
        const cols = Object.keys(r)
        out.push(`INSERT OR REPLACE INTO ${t}(${cols.join(', ')}) VALUES (${cols.map((c) => lit(r[c])).join(', ')});`)
      }
    }
    return out
  }
  fs.mkdirSync(dir, { recursive: true })
  const main = emit(replay().H.raw)
  fs.writeFileSync(path.join(dir, 'fixture.sql'), main.join('\n') + '\n')
  fs.writeFileSync(path.join(dir, 'abort-fixture.sql'), emit(replay({ afterWindow: true }).H.raw).join('\n') + '\n')
  fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(rows.map((r) => ({ ...r, expect: EXPECT[r.case] })), null, 1))
  console.log(`emitted ${main.length} statements to ${dir}`)
}

console.log(`${checks} checks passed`)
