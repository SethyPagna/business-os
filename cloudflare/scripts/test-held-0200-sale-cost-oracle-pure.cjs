// Oracle proof for ops/scripts/migration/held/0200_sale_cost_on_hand_repair.sql
// (U-cost2, refuter R-cost findings 1-4).
//
// ONE event list is replayed twice on real migrated SQLite (node:sqlite via
// harness/d1compat.cjs, the chain through 0194):
//   - HIST: the buggy era as it happened -- every sale line and every walk-in
//     return snapshots the buggy catalog figure (mean of the DISTINCT unit
//     costs of active lots after the manual-override baseline, plus the
//     override), 0195 is applied at fix_at, one sale inside the deploy window
//     still carries the buggy figure (old Worker), one carries the fixed one.
//   - ORACLE: the same events with 0195 live from the start: its triggers, plus
//     its recompute statement (verbatim from the migration) after every event,
//     so every snapshot is the fixed on-hand weighted cost at that moment.
// Row ids are identical in both (same writes in the same order), so every
// sale_items / return_items row of HIST is compared with its ORACLE twin.
//
// Cases (the writes mirror the app's statement shapes):
//   A  sale-linked return with sale_item_id NULL (copied by product)
//   B  two lines of one product in one sale, one partially returned
//   C  walk-in customer return (catalog cost), USD
//   D  walk-in customer return refunded in KHR: only cost_price_usd moves
//   E  lot cost edited before AND after the sale (audit_logs batch_update)
//   F  a lot deactivated after the sale (and one deactivated before it)
//   G  0109-style merge after the sale: lines and movements re-pointed by SQL,
//      lots left on the retired product, no snapshot -> listed, not rewritten
//   H  app merge after the sale (fold + repoint, product.merge snapshot), and
//      a sale on the keeper after the merge (fold replayed in the ledger)
//   I  deploy window: a buggy-figure sale in [fix_at, fix_at + 2h) repaired,
//      a fixed-figure sale there untouched, a buggy one after the window listed
//   J  a lot whose ledger does not reconcile -> listed, never rewritten
//   K  a control line that was right all along
//
// Checks:
//   1. oracle: every rewritten line equals its ORACLE twin; every line not
//      rewritten is byte-unchanged; every line that differs from ORACLE and is
//      not rewritten is LISTED (none silently skipped) with the right bucket,
//      and its best estimate is reported.
//   2. only cost_price_usd moves (KHR, revenue, quantities byte-identical).
//   3. audit: every bucket before apply (the fixture's counts); after apply
//      only the review lines stay listed.
//   4. idempotent: a second run changes no table, backups included.
//   5. recovery: the header's statements restore both tables byte-identical,
//      and a re-apply lands exactly where the first did.
// Against 2f37af5a's 0200 (HELD_0200_SQL=<git show copy>) checks 1, 3, 4, 5 fail.
//
// Run (from cloudflare/): node scripts/test-held-0200-sale-cost-oracle-pure.cjs [--table] [--emit <dir>]
//   --table        prints line / case / before / expected / after
//   --emit <dir>   writes the HIST rows as SQL (fixture.sql) and expected.json
//                  for a wrangler --local dry run
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
  const w = { mode, raw, fixed: mode === 'oracle', oldWorker: false }
  if (w.fixed) raw.exec(migration0195)
  // The catalog cost a snapshot reads right now.
  w.cost = (productId) => {
    if (w.fixed && !w.oldWorker) {
      raw.exec(recompute0195)
      return raw.prepare('SELECT cost_price_usd c FROM products WHERE id = ?').get(productId).c
    }
    return raw.prepare(BUGGY).get(productId).b
  }
  w.settle = () => { if (w.fixed) raw.exec(recompute0195) }
  return w
}

// The event list. Every event runs on both worlds, in order.
function replay() {
  const H = world('hist'), O = world('oracle')
  const both = (fn) => [fn(H), fn(O)]
  const one = (fn) => { const [h, o] = both(fn); assert.deepEqual(h, o, 'ids agree across the pair'); return h }
  const cases = {}
  const tag = (name, kind, id) => { cases[`${kind}:${id}`] = name; return id }
  let seq = 0
  const product = (name) => one((w) => Number(w.raw.prepare('INSERT INTO products(name, cost_price_usd, purchase_price_usd, cost_price_khr, is_active, barcode) VALUES (?, 0, 0, 0, 1, ?)')
    .run(name, `bc-${name}`).lastInsertRowid))
  // A receipt (inventory.ts shape): lot, batch-stamped stock_in, branch_batch_stock.
  const lot = (productId, cost, at, quantity, key = `k${++seq}`) => one((w) => {
    const id = Number(w.raw.prepare(`INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, received_at, created_at, updated_at, received_quantity, received_branch_id)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, 1)`).run(productId, key, cost, at.slice(0, 10), at, at, quantity).lastInsertRowid)
    w.raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, batch_id, created_at)
      VALUES (?, 1, 'stock_in', ?, ?, ?, ?)`).run(productId, quantity, cost, id, at)
    w.raw.prepare('INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (?, 1, ?)').run(id, quantity)
    w.settle()
    return id
  })
  const stock = (w, lotId, delta) => w.raw.prepare('UPDATE branch_batch_stock SET quantity = quantity + ? WHERE batch_id = ? AND branch_id = 1').run(delta, lotId)
  // A write-off: batch-stamped removal. stamped:false is an unstamped one (no batch_id).
  const remove = (productId, lotId, at, quantity, { stamped = true } = {}) => both((w) => {
    const cost = w.raw.prepare('SELECT unit_cost_usd c FROM product_batches WHERE id = ?').get(lotId).c
    w.raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, batch_id, created_at)
      VALUES (?, 1, 'remove', ?, ?, ?, ?)`).run(productId, -quantity, cost, stamped ? lotId : null, at)
    stock(w, lotId, -quantity); w.settle()
  })
  // routes/batches.ts: the lot editor stamps updated_at and logs the body.
  const editLot = (lotId, cost, at) => both((w) => {
    w.raw.prepare('UPDATE product_batches SET unit_cost_usd = ?, updated_at = ? WHERE id = ?').run(cost, at, lotId)
    w.raw.prepare(`INSERT INTO audit_logs(action, entity, entity_id, details, created_at) VALUES ('batch_update', 'product_batch', ?, ?, ?)`)
      .run(String(lotId), JSON.stringify({ unit_cost_usd: cost }), at)
    w.settle()
  })
  const deactivate = (lotId, at) => both((w) => { w.raw.prepare('UPDATE product_batches SET is_active = 0, updated_at = ? WHERE id = ?').run(at, lotId); w.settle() })
  // routes/sales.ts: every line snapshots the catalog cost BEFORE the batch
  // moves stock; one 'sale' movement per line (reference_id = sale id).
  const sale = (name, at, lines, { oldWorker = false } = {}) => {
    const out = both((w) => {
      w.oldWorker = oldWorker && w.mode === 'hist' // the oracle is fixed code throughout
      const costs = new Map(lines.map((l) => [l.p, null]))
      for (const p of costs.keys()) costs.set(p, w.cost(p))
      w.oldWorker = false
      const total = lines.reduce((s, l) => s + 20 * l.q, 0)
      const saleId = Number(w.raw.prepare(`INSERT INTO sales(receipt_number, created_at, subtotal_usd, total_usd, sale_status, branch_id)
        VALUES (?, ?, ?, ?, 'completed', 1)`).run(`R-${name}`, at, total, total).lastInsertRowid)
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
  // A customer return. Sale-linked: the cost is copied from the sale line
  // (recordedReturnCosts 'sale' source; sale_item_id NULL -> the one cost all
  // that product's lines share). Walk-in: the catalog cost at the return.
  const customerReturn = (name, at, { saleId = null, lines, currency = 'USD' }) => {
    const out = both((w) => {
      const khr = currency === 'KHR'
      const returnId = Number(w.raw.prepare(`INSERT INTO returns(return_number, sale_id, total_refund_usd, total_refund_khr, exchange_rate, status, return_scope, branch_id, created_at)
        VALUES (?, ?, ?, ?, 4100, 'completed', 'customer', 1, ?)`).run(`RT-${name}`, saleId, khr ? 0 : 20, khr ? 82000 : 0, at).lastInsertRowid)
      const ids = lines.map((l) => {
        let cost
        if (saleId == null) cost = w.cost(l.p)
        else if (l.saleItemId) cost = w.raw.prepare('SELECT cost_price_usd c FROM sale_items WHERE id = ?').get(l.saleItemId).c
        else {
          const costs = w.raw.prepare('SELECT DISTINCT cost_price_usd c FROM sale_items WHERE sale_id = ? AND product_id = ?').all(saleId, l.p)
          assert.equal(costs.length, 1, 'recordedReturnCosts: one shared cost'); cost = costs[0].c
        }
        const id = Number(w.raw.prepare(`INSERT INTO return_items(return_id, sale_item_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr, total_usd, total_khr, return_to_stock, stock_action, branch_id, batch_id)
          VALUES (?, ?, ?, ?, ?, 20, 82000, ?, ?, ?, ?, 1, 'restock', 1, ?)`).run(returnId, l.saleItemId || null, l.p, name, l.q, cost, l.khr ?? 41000, khr ? 0 : 20 * l.q, khr ? 82000 * l.q : 0, l.lot).lastInsertRowid)
        w.raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, reference_id, batch_id, created_at)
          VALUES (?, 1, 'return', ?, ?, ?, ?, ?)`).run(l.p, l.q, cost, returnId, l.lot, at)
        stock(w, l.lot, l.q)
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
  // the rest re-point; lines and movements re-parent; one product.merge snapshot.
  const appMerge = (dup, keeper, at, { fold = [], repoint = [] }) => both((w) => {
    const r = w.raw
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
      .run(JSON.stringify({ dupId: dup, keeperId: keeper, repointedBatches, foldedBatches, writtenOffBatches: [], reparentedSaleItemIds, reparentedMovementIds, reparentedByTable }), at, at)
    w.settle()
  })
  // 0109-style (a migration, not the app): lines and movements re-pointed by
  // SQL, the retired row deactivated, its lots LEFT on it, no snapshot.
  const sqlMerge = (dup, keeper) => both((w) => {
    for (const t of ['sale_items', 'inventory_movements']) w.raw.prepare(`UPDATE ${t} SET product_id = ? WHERE product_id = ?`).run(keeper, dup)
    w.raw.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(dup)
    w.settle()
  })

  const d = (day, hms = '09:00:00') => `2026-09-${day} ${hms}`

  // A: 2 x 10 + 6 x 14. Buggy 12; on hand 13. The return copies by product.
  const pa = product('A'); lot(pa, 10, d(17), 2); const a2 = lot(pa, 14, d(18), 6)
  const sA = sale('A', d(20), [{ p: pa, q: 1, lot: a2 }])
  customerReturn('A-ret', d(21), { saleId: sA.saleId, lines: [{ p: pa, q: 1, lot: a2, saleItemId: null }] })

  // B: 3 x 4 + 1 x 8. Buggy 6; on hand 5. Two lines of B in one sale, the
  // second one partially returned (1 of 2).
  const pb = product('B'); const b1 = lot(pb, 4, d(17), 3); lot(pb, 8, d(18), 1)
  const sB = sale('B', d(20), [{ p: pb, q: 1, lot: b1 }, { p: pb, q: 2, lot: b1 }])
  customerReturn('B-ret', d(21), { saleId: sB.saleId, lines: [{ p: pb, q: 1, lot: b1, saleItemId: sB.lineIds[1] }] })

  // C: walk-in, 4 x 3 + 2 x 9. Buggy 6; on hand 5.
  const pc = product('C'); lot(pc, 3, d(17), 4); const c2 = lot(pc, 9, d(18), 2)
  customerReturn('C-walkin', d(20), { lines: [{ p: pc, q: 1, lot: c2 }] })

  // D: walk-in refunded in KHR, 3 x 2 + 1 x 6. Buggy 4; on hand 3. KHR cost stays.
  const pd = product('D'); const d1 = lot(pd, 2, d(17), 3); lot(pd, 6, d(18), 1)
  customerReturn('D-walkin-khr', d(20), { lines: [{ p: pd, q: 1, lot: d1, khr: 16400 }], currency: 'KHR' })

  // E: 1 x 10 + 3 x 20; E2 edited to 21 before the sale and to 22 after it.
  // Buggy (10 + 21) / 2 = 15.5; on hand (10 + 63) / 4 = 18.25.
  const pe = product('E'); lot(pe, 10, d(17), 1); const e2 = lot(pe, 20, d(18), 3)
  editLot(e2, 21, d(19))
  sale('E', d(20), [{ p: pe, q: 1, lot: e2 }])
  editLot(e2, 22, d(22))

  // F: F0 (50) emptied and deactivated before the sale; F1 (6 x 1) emptied
  // and deactivated after it. Buggy (6 + 10) / 2 = 8; on hand (6 + 30) / 4 = 9.
  const pf = product('F'); const f0 = lot(pf, 50, d(17), 1); const f1 = lot(pf, 6, d(17, '10:00:00'), 1); const f2 = lot(pf, 10, d(18), 3)
  remove(pf, f0, d(18, '12:00:00'), 1); deactivate(f0, d(18, '12:00:00'))
  sale('F', d(20), [{ p: pf, q: 1, lot: f2 }])
  remove(pf, f1, d(22), 1); deactivate(f1, d(22))

  // G: 0109-style after the sale. Buggy (4 + 10) / 2 = 7; on hand 8.5.
  const pgDup = product('G-dup'); lot(pgDup, 4, d(17), 1); const g2 = lot(pgDup, 10, d(18), 3)
  const pgKeep = product('G-keeper'); lot(pgKeep, 20, d(18), 1)
  sale('G', d(20), [{ p: pgDup, q: 1, lot: g2 }])
  sqlMerge(pgDup, pgKeep)

  // H: app merge after the sale. Dup: H1 (5 x 1, key KH1), H2 (9 x 3, KH2);
  // keeper: HK (6 x 2, KH1). H1 folds into HK, H2 re-points.
  // The dup's sale: buggy 7, on hand (5 + 27) / 4 = 8.
  // The keeper's sale after the merge: HK 3 x 6 + H2 2 x 9 -> 7.2; buggy (6 + 9) / 2 = 7.5.
  const phDup = product('H-dup'); const h1 = lot(phDup, 5, d(17), 1, 'KH1'); const h2 = lot(phDup, 9, d(18), 3, 'KH2')
  const phKeep = product('H-keeper'); const hk = lot(phKeep, 6, d(18), 2, 'KH1')
  sale('H', d(20), [{ p: phDup, q: 1, lot: h2 }])
  appMerge(phDup, phKeep, d(23), { fold: [[h1, hk]], repoint: [h2] })
  sale('H-after-merge', d(24), [{ p: phKeep, q: 1, lot: h2 }])

  // J: J2 lost a unit to an unstamped removal: its ledger says 2, the shelf 1.
  // Buggy 5; the ledger estimate 5; the shelf (2 x 3 + 1 x 7) / 3 = 4.3333.
  const pj = product('J'); const j1 = lot(pj, 3, d(17), 2); const j2 = lot(pj, 7, d(18), 2)
  remove(pj, j2, d(19), 1, { stamped: false })
  sale('J', d(20), [{ p: pj, q: 1, lot: j1 }])

  // K: one lot, so buggy = on hand = 7. Right all along.
  const pk = product('K'); const k1 = lot(pk, 7, d(17), 3)
  sale('K', d(20), [{ p: pk, q: 1, lot: k1 }])

  // I: 1 x 10 + 5 x 20. 0195 goes live at fix_at (HIST); the old Worker keeps
  // serving some requests for a while.
  const pi = product('I'); lot(pi, 10, d(17), 1); const i2 = lot(pi, 20, d(18), 5)
  H.raw.exec(migration0195)
  H.raw.prepare('UPDATE catalog_cost_repair_0195_backup SET created_at = ?').run(FIX_AT)
  H.fixed = true
  O.raw.prepare('UPDATE catalog_cost_repair_0195_backup SET created_at = ?').run(FIX_AT)
  sale('I-window-buggy', d(26, '00:30:00'), [{ p: pi, q: 1, lot: i2 }], { oldWorker: true }) // buggy 15; on hand 110 / 6 = 18.3333
  sale('I-window-fixed', d(26, '00:45:00'), [{ p: pi, q: 1, lot: i2 }]) // 90 / 5 = 18 both
  sale('I-after-window', d(26, '03:00:00'), [{ p: pi, q: 1, lot: i2 }], { oldWorker: true }) // buggy 15; on hand 70 / 4 = 17.5
  sale('I-later', d(26, '04:00:00'), [{ p: pi, q: 1, lot: i2 }]) // 50 / 3 = 16.6667 both

  return { H, O, cases }
}

// What each case must end as. 'oracle' = rewritten to the ORACLE twin;
// 'listed:<bucket>' = byte-unchanged and listed; 'same' = unchanged, not listed.
const EXPECT = {
  'A': 'oracle', 'A-ret': 'oracle',
  'B#1': 'oracle', 'B#2': 'oracle', 'B-ret': 'oracle',
  'C-walkin': 'oracle', 'D-walkin-khr': 'oracle',
  'E': 'oracle', 'F': 'oracle',
  'G': 'listed:needs_owner_review',
  'H': 'oracle', 'H-after-merge': 'oracle',
  'J': 'listed:ledger_unverified',
  'K': 'same',
  'I-window-buggy': 'oracle', 'I-window-fixed': 'same', 'I-after-window': 'listed:after_window', 'I-later': 'same',
}
const REWRITTEN_BUCKET = { sale: ['repair', 'window'], return: ['returns_sale_linked', 'returns_walk_in'] }

const apply = (raw) => raw.exec(migrationText)
const recoverySql = () => migrationText.split('\n-- Statements:\n')[1].split('\n-- The backup tables')[0]
  .split('\n').filter((l) => l.startsWith('--   ')).map((l) => l.slice(5)).join('\n')

function dump(raw, table) {
  return raw.prepare(`SELECT *, typeof(cost_price_usd) AS cost_type FROM ${table} ORDER BY id`).all().map((r) => ({ ...r }))
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

const argv = process.argv.slice(2)
const world0 = replay()
const { H, O, cases } = world0
let summaryBefore = null
try { summaryBefore = auditSummary(H.raw) } catch (error) { summaryBefore = error }
const before = { sale: dump(H.raw, 'sale_items'), return: dump(H.raw, 'return_items') }
const oracle = { sale: dump(O.raw, 'sale_items'), return: dump(O.raw, 'return_items') }
let applied = null
try { apply(H.raw); applied = true } catch (error) { applied = error }
const after = { sale: dump(H.raw, 'sale_items'), return: dump(H.raw, 'return_items') }
const plan = tableExists(H.raw, 'sale_cost_repair_0200_plan')
  ? Object.fromEntries(H.raw.prepare('SELECT kind, item_id, bucket, reason, correct_cost_usd FROM sale_cost_repair_0200_plan').all().map((r) => [`${r.kind}:${r.item_id}`, r]))
  : {}

const rows = []
for (const kind of ['sale', 'return']) {
  for (let i = 0; i < before[kind].length; i++) {
    const key = `${kind}:${before[kind][i].id}`
    rows.push({ key, case: cases[key] || '?', before: before[kind][i].cost_price_usd, oracle: oracle[kind][i].cost_price_usd,
      after: after[kind][i] ? after[kind][i].cost_price_usd : undefined, bucket: plan[key]?.bucket ?? '-', estimate: plan[key]?.correct_cost_usd ?? null })
  }
}
if (argv.includes('--table')) {
  console.log('line          case              before    expected  after     bucket               estimate')
  for (const r of rows) {
    const exp = EXPECT[r.case] === 'oracle' ? r.oracle : r.before
    console.log(`${r.key.padEnd(13)} ${r.case.padEnd(17)} ${String(r.before).padEnd(9)} ${String(exp).padEnd(9)} ${String(r.after).padEnd(9)} ${String(r.bucket).padEnd(20)} ${r.estimate ?? ''}${EXPECT[r.case] !== 'oracle' && r.oracle !== r.before ? `  (oracle ${r.oracle})` : ''}`)
  }
}

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
  const byCase = Object.fromEntries(rows.map((r) => [r.case, r]))
  assert.deepEqual(['A', 'B#1', 'C-walkin', 'D-walkin-khr', 'E', 'F', 'G', 'H', 'H-after-merge', 'J', 'I-window-buggy'].map((c) => [byCase[c].before, byCase[c].oracle]),
    [[12, 13], [6, 5], [6, 5], [4, 3], [15.5, 18.25], [8, 9], [7, 8.5], [7, 8], [7.5, 7.2], [5, 4.3333], [15, 18.3333]], 'hand-checked figures')
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
    if (want === 'same' && r.bucket !== '-' && r.bucket !== 'already_correct') failures.push(`${r.case} (${r.key}): listed as ${r.bucket}`)
    // Not silently skipped: whatever still differs from the oracle is listed.
    if (!Object.is(r.after, r.oracle) && (r.bucket === '-' || r.bucket === 'already_correct')) failures.push(`${r.case} (${r.key}): differs from the oracle and is not listed`)
  }
  assert.deepEqual(failures, [])
  const byCase = Object.fromEntries(rows.map((r) => [r.case, r]))
  assert.equal(plan[byCase.G.key].reason, 'sold_lot_belongs_to_another_product')
  assert.equal(byCase.G.estimate, byCase.G.oracle, '0109-style: the best estimate is the fixed-code figure')
  assert.equal(byCase['I-after-window'].estimate, byCase['I-after-window'].oracle)
  assert.equal(byCase.J.estimate, 5, 'unreconciled ledger: the estimate is reported as what the ledger says, and not trusted')
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
  const byCase = Object.fromEntries(rows.map((r) => [r.case, r]))
  const khr = after.return.find((x) => `return:${x.id}` === byCase['D-walkin-khr'].key)
  assert.equal(khr.cost_price_khr, 16400, 'KHR cost untouched')
})

check('audit: every bucket before apply; after apply only the review lines remain listed', () => {
  if (applied !== true) throw applied
  if (summaryBefore instanceof Error) throw summaryBefore
  // [lines, units, cost delta] -- the fixture's bucket counts.
  assert.deepEqual(summaryBefore, {
    // A +1, B#1 -1, B#2 2 x -1, E +2.75, F +1, H +1, H-after-merge -0.3
    repair: [7, 8, 2.45],
    window: [1, 1, 3.3333], // I-window-buggy
    returns_sale_linked: [2, 2, 0], // A-ret +1, B-ret -1
    returns_walk_in: [2, 2, -2], // C -1, D (KHR) -1
    ledger_unverified: [1, 1, 0], // J: the ledger's own estimate equals the recorded cost; the shelf says 4.3333
    needs_owner_review: [1, 1, 1.5], // G, 0109-style
    after_window: [1, 1, 2.5],
    already_correct: [1, 1, 0],
  })
  const afterSummary = auditSummary(H.raw)
  assert.deepEqual(afterSummary, { ...summaryBefore, repair: [0, 0, 0], window: [0, 0, 0], returns_sale_linked: [0, 0, 0], returns_walk_in: [0, 0, 0] },
    'post-check: the rewritten lines drop off every list; the review lines are exactly as before')
})

check('idempotent: a second run changes no table, backups and plan included', () => {
  if (applied !== true) throw applied
  const tables = ['sale_items', 'return_items', 'sale_cost_repair_0200', 'sale_cost_repair_0200_return_items', 'sale_cost_repair_0200_plan', 'products', 'inventory_movements']
  const snap = () => Object.fromEntries(tables.map((t) => [t, plainDump(H.raw, t)]))
  const one = snap()
  apply(H.raw)
  assert.deepEqual(snap(), one)
})

check('recovery: the header statements restore both cost columns byte-identical', () => {
  if (applied !== true) throw applied
  H.raw.exec(recoverySql())
  assert.deepEqual(dump(H.raw, 'sale_items'), before.sale)
  assert.deepEqual(dump(H.raw, 'return_items'), before.return)
  // Rolled back, a fresh apply lands exactly where the first one did.
  apply(H.raw)
  assert.deepEqual(dump(H.raw, 'sale_items'), after.sale)
  assert.deepEqual(dump(H.raw, 'return_items'), after.return)
})

// --emit <dir>: the HIST rows (state just before 0200) as SQL for a wrangler
// --local dry run on a database migrated through 0195, plus expected.json.
const emitAt = argv.indexOf('--emit')
if (emitAt >= 0) {
  const dir = argv[emitAt + 1]
  const fresh = replay().H.raw
  const lit = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
  const out = ['PRAGMA defer_foreign_keys = true;']
  for (const t of ['products', 'product_batches', 'branch_batch_stock', 'inventory_movements', 'sales', 'sale_items', 'returns', 'return_items',
    'sale_item_batch_allocations', 'product_cost_entries', 'undo_snapshots', 'audit_logs', 'catalog_cost_repair_0195_backup']) {
    for (const r of fresh.prepare(`SELECT * FROM ${t}`).all()) {
      const cols = Object.keys(r)
      out.push(`INSERT OR REPLACE INTO ${t}(${cols.join(', ')}) VALUES (${cols.map((c) => lit(r[c])).join(', ')});`)
    }
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'fixture.sql'), out.join('\n') + '\n')
  fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify(rows.map((r) => ({ ...r, expect: EXPECT[r.case] })), null, 1))
  console.log(`emitted ${out.length} statements to ${dir}`)
}

console.log(`${checks} checks passed`)
