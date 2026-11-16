'use strict'
// Companion for cloudflare/migrations/0313_cost_4dp_repair.sql (cost-4dp lane): the data repair that rounds stored costs over 4 decimals.
//
// Runs the real chain (every trigger live: the 0258 permit fence, the 0255 review guards, the catalog-cost triggers, the 0124 revisions) with a
// fixture that holds long values in every column of the scope, then the repair. Checked:
//   1. Text: LF-only; permit and maintenance flag inserted and removed in pairs; no write to sale_items / return_items / inventory_movements /
//      cost_review_key; the recovery block in the header is runnable SQL.
//   2. Exact before/after for every column written (ties 1.00015 and 2.00005 go up, 4.166667 and 1.2333333333333334 round to 4 places, KHR),
//      a ledger row per change, clean rows and the untouched tables byte-identical, cost_review_key kept (the 0255 lot trigger would have
//      cleared it without the maintenance flag).
//   3. Idempotent: running the file again changes nothing.
//   4. Reversal: the header's recovery SQL puts every value back, and leaves a row edited after the repair alone.
//   5. PRE aborts before any write (permit present, scope over the cap); POST aborts on a mutant that touches sale_items.
//   6. Mutants: ROUND(x, 4) instead of the nudge, no permit, no maintenance flag, a smaller scope: each goes red.
//
// Run (from cloudflare/): node scripts/test-migration-0313-cost-4dp-repair-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')

const root = path.resolve(__dirname, '..')
const migrationsDir = path.join(root, 'migrations')
const heldDir = path.join(root, '..', 'ops', 'scripts', 'migration', 'held')
const MIGRATION = '0313_cost_4dp_repair.sql'
const text = fs.readFileSync(path.join(heldDir, MIGRATION), 'utf8')
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
const chain = (filter) => files.filter(filter).map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
const GUARD = 'product_cost_review_update_guard_0255'
const KEY = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'
const KEY2 = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'

const rows = (db, sql, ...a) => db.prepare(sql).all(...a).map((r) => ({ ...r }))
const one = (db, sql, ...a) => db.prepare(sql).get(...a)
const PERMIT = "INSERT INTO system_flags (key, value, updated_at) SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP FROM system_flags WHERE key = 'stock_schema_epoch'"
const NO_PERMIT = "DELETE FROM system_flags WHERE key = 'stock_transaction_permit'"

// A database at the state before 0313 with long values everywhere in the scope. Seeding runs under the permit and with the review guard
// dropped for the one statement that sets a key, exactly the states the Worker reaches through its own writers.
function fixture({ extraProducts = 0 } = {}) {
  const db = openDb(chain((f) => f < MIGRATION)).db
  db.exec(PERMIT)
  db.exec("INSERT INTO branches(id, name, is_active) VALUES (1, 'B1', 1)")
  // id, active, cost usd, cost khr, purchase usd, purchase khr, stock
  const P = [
    [1, 1, 1.2333333333333334, 4100.12345, 1.2333333333333334, 4100.12345, 5],   // active, costed lot with stock, long everywhere
    [2, 0, 4.166667, 4100, 4.166667, 4100, 0],                                   // inactive, long cost
    [3, 1, 1.00015, null, 1.00015, 0, 0],                                         // sold-out, tie
    [4, 1, 2.0001, 6000, 2.0001, 6000, 3],                                        // clean: nothing to do
    [5, 1, 3.5, 4100, 3.50005, 4100, 0],                                          // long purchase mirror only (tie 3.50005)
    [6, 1, 1.00015, 4100, 1.00015, 4100, 0],                                      // active with a review key and a recorded sold-out lot
    [7, 1, 9.123456789, 4100, 9.123456789, 4100, 0],                              // long cost, no lots at all
    [8, 1, 1.00105, 4100, 1.00105, 4100, 0],                                      // a tie that SQLite ROUND(x, 4) rounds DOWN (1.001)
  ]
  for (const p of P) {
    db.prepare(`INSERT INTO products(id, name, is_active, cost_price_usd, cost_price_khr, purchase_price_usd, purchase_price_khr, stock_quantity,
      selling_price_usd, wholesale_price_usd, name_key, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 12.345678, 11.5, ?, '2026-11-01T01:02:03Z')`)
      .run(p[0], `P${p[0]}`, p[1], p[2], p[3], p[4], p[5], p[6], `k${p[0]}`)
  }
  // lot id, product, active, unit cost, received cost, received at
  const B = [
    [1, 1, 1, 1.2333333333333334, 149.573577, '2026-10-01'], [2, 1, 1, 2, 10, '2026-10-02'],
    [3, 3, 1, 1.00015, 1.00015, '2026-10-01'], [4, 4, 1, 2.0001, 6.0003, '2026-10-01'],
    [5, 6, 1, 1.00015, 2.00005, '2026-10-01'], [6, 2, 0, 4.166667, 4.166667, '2026-09-01'],
  ]
  for (const b of B) {
    db.prepare("INSERT INTO product_batches(id, variant_product_id, batch_key, is_active, unit_cost_usd, received_cost_usd, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(b[0], b[1], `bk${b[0]}`, b[2], b[3], b[4], b[5])
  }
  db.exec('INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (1, 1, 3), (2, 1, 2), (4, 1, 3)')
  // The lot inserts fired the catalog-cost triggers: put the fixture's long product costs back (the state the repair meets in production).
  for (const p of P) {
    db.prepare('UPDATE products SET cost_price_usd = ?, cost_price_khr = ?, purchase_price_usd = ?, purchase_price_khr = ? WHERE id = ?').run(p[2], p[3], p[4], p[5], p[0])
  }
  // Review keys (the guard refuses them outside a merge): set with the guard dropped, then restored byte for byte.
  const guard = one(db, 'SELECT sql FROM sqlite_master WHERE name = ?', GUARD).sql
  db.exec(`DROP TRIGGER ${GUARD}`)
  db.prepare('UPDATE products SET cost_review_key = ? WHERE id = 6').run(KEY)
  db.prepare('UPDATE products SET cost_review_key = ? WHERE id = 7').run(KEY2)
  db.exec(guard + ';')
  // entry id, product, usd, khr, previous
  const E = [[1, 1, 1.00015, 5000.55555, 1.1111111], [2, 1, 1.25, 5000, 1.00015], [3, 3, 2.5, null, null], [4, 4, 4.1667, 17000, 4.1666]]
  for (const e of E) {
    db.prepare("INSERT INTO product_cost_entries(id, product_id, cost_usd, cost_khr, source, baseline_batch_id, created_at, previous_cost_usd) VALUES (?, ?, ?, ?, 'manual', 0, '2026-11-01T00:00:00Z', ?)")
      .run(e[0], e[1], e[2], e[3], e[4])
  }
  // History that must never move, long values included (snapshots keep what was true when they were written).
  db.exec(`INSERT INTO sales(id, receipt_number, branch_id, branch_name, total_usd, subtotal_usd, sale_status, created_at) VALUES (1, 'R-1', 1, 'B1', 12, 12, 'completed', '2026-11-01 10:00:00');
    INSERT INTO sale_items(id, sale_id, product_id, product_name, quantity, applied_price_usd, cost_price_usd, cost_price_khr, total_usd, branch_id, batch_id) VALUES (1, 1, 1, 'P1', 1, 12, 1.2333333333333334, 5056.66666, 12, 1, 1), (2, 1, 3, 'P3', 2, 3, 1.00015, NULL, 6, 1, 3);
    INSERT INTO returns(id, return_number, sale_id, branch_id, branch_name, total_refund_usd, created_at) VALUES (1, 'RT-1', 1, 1, 'B1', 0, '2026-11-02 10:00:00');
    INSERT INTO return_items(id, return_id, sale_item_id, product_id, product_name, quantity, applied_price_usd, cost_price_usd, total_usd) VALUES (1, 1, 1, 1, 'P1', 1, 12, 1.2333333333333334, 12);
    INSERT INTO inventory_movements(id, product_id, branch_id, branch_name, movement_type, quantity, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr, reference_id, batch_id, created_at) VALUES (1, 1, 1, 'B1', 'stock_in', 3, 1.2333333333333334, 5056.66666, 3.7000000000000002, 15170, NULL, 1, '2026-10-01 08:00:00'), (2, 3, 1, 'B1', 'sale', -2, 1.00015, NULL, 2.0003, NULL, 1, 3, '2026-11-01 10:00:00')`)
  for (let i = 0; i < extraProducts; i++) {
    db.prepare("INSERT INTO products(id, name, is_active, cost_price_usd, purchase_price_usd, name_key) VALUES (?, ?, 0, 1.00015, 1.00015, ?)").run(1000 + i, `X${i}`, `x${i}`)
  }
  db.exec(NO_PERMIT)
  return db
}

// Everything the repair must leave alone, as plain data (long values included).
const untouched = (db) => ({
  sale_items: rows(db, 'SELECT * FROM sale_items ORDER BY id'),
  return_items: rows(db, 'SELECT * FROM return_items ORDER BY id'),
  inventory_movements: rows(db, 'SELECT * FROM inventory_movements ORDER BY id'),
  keys: rows(db, 'SELECT id, cost_review_key FROM products ORDER BY id'),
  products_other: rows(db, 'SELECT id, name, is_active, stock_quantity, selling_price_usd, wholesale_price_usd, updated_at FROM products ORDER BY id'),
  lots_other: rows(db, 'SELECT id, variant_product_id, is_active, received_quantity, received_at FROM product_batches ORDER BY id'),
  stock: rows(db, 'SELECT * FROM branch_batch_stock ORDER BY id'),
  entries_other: rows(db, 'SELECT id, product_id, source, baseline_batch_id, created_at FROM product_cost_entries ORDER BY id'),
  flags: rows(db, "SELECT key FROM system_flags WHERE key IN ('maintenance', 'stock_transaction_permit')"),
})
const costs = (db) => ({
  products: rows(db, 'SELECT id, cost_price_usd, cost_price_khr, purchase_price_usd, purchase_price_khr FROM products ORDER BY id'),
  lots: rows(db, 'SELECT id, unit_cost_usd, received_cost_usd FROM product_batches ORDER BY id'),
  entries: rows(db, 'SELECT id, cost_usd, cost_khr, previous_cost_usd FROM product_cost_entries ORDER BY id'),
})
const over4 = (db) => {
  const p = (c) => `typeof(${c}) IN ('integer','real') AND ABS(${c} * 10000 - ROUND(${c} * 10000)) > 0.000001`
  const n = (t, cols) => one(db, `SELECT COUNT(*) n FROM ${t} WHERE ${cols.map(p).map((x) => `(${x})`).join(' OR ')}`).n
  return { products: n('products', ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']),
    lots: n('product_batches', ['unit_cost_usd', 'received_cost_usd']), entries: n('product_cost_entries', ['cost_usd', 'cost_khr', 'previous_cost_usd']) }
}

function main() {
  // Held: the repair is kept out of the deploy chain until the lead moves it in (that move is the decision to run it on production).
  assert.ok(!files.includes(MIGRATION), 'held: 0313 must not appear in cloudflare/migrations without a deliberate move (update this check and the held-0200 ordering in the same commit)')
  assert.ok(files.includes('0312_catalog_cost_fallback_rounding.sql') && files.every((f) => f < MIGRATION), 'the chain it is applied on ends at 0312')
  // ---- 1. text ---------------------------------------------------------------------------------------------------------------------------------
  assert.ok(!text.includes('\r'), 'LF-only')
  const code = text.replace(/--[^\n]*/g, '')
  const count = (re) => (code.match(re) || []).length
  assert.equal(count(/INSERT INTO system_flags \(key, value, updated_at\)\s+SELECT 'stock_transaction_permit'/g), 1)
  assert.equal(count(/DELETE FROM system_flags WHERE key = 'stock_transaction_permit'/g), 1)
  assert.equal(count(/INSERT INTO system_flags \(key, value, updated_at\) VALUES \('maintenance'/g), 1)
  assert.equal(count(/DELETE FROM system_flags WHERE key = 'maintenance'/g), 1)
  for (const forbidden of [/\bUPDATE\s+(sale_items|return_items|inventory_movements|returns|sales)\b/i, /\bDELETE\s+FROM\s+(sale_items|return_items|inventory_movements|products|product_batches|product_cost_entries)\b/i,
    /\bSET\s+[^;]*cost_review_key/i, /\bUPDATE\s+products\s+SET[^;]*\b(is_active|updated_at|selling_price|wholesale_price|stock_quantity)\b/i, /\bWITHOUT\s+ROWID\b/i, /\bDROP\s+TABLE\s+(?!_cost_4dp_)/i]) {
    assert.ok(!forbidden.test(code), `forbidden: ${forbidden}`)
  }
  assert.ok(!/ROUND\(\s*\w+\s*,\s*4\s*\)/i.test(code.replace(/ROUND\([a-z_]+ \* 10000\)/g, '')), 'the rounding is the nudge form, never ROUND(x, 4)')
  const headerLines = text.split('\n')
  const recovery = headerLines.slice(headerLines.findIndex((l) => l.startsWith('-- RECOVERY')) + 1, headerLines.findIndex((l) => l.startsWith('-- A row edited after this file')))
    .filter((l) => l.startsWith('--   ')).map((l) => l.slice(5))
  assert.ok(recovery.length >= 14, 'the recovery block is in the header')
  const recoverySql = recovery.join('\n').replace(/^--\s+/gm, '')

  // ---- 2. exact before / after ------------------------------------------------------------------------------------------------------------------
  const db = fixture()
  const before = costs(db)
  const beforeUntouched = untouched(db)
  assert.deepEqual(over4(db), { products: 7, lots: 4, entries: 2 }, 'the fixture holds long values in every column of the scope')
  db.exec(text)
  const after = costs(db)
  assert.deepEqual(over4(db), { products: 0, lots: 0, entries: 0 })
  assert.deepEqual(untouched(db), beforeUntouched, 'sale_items, return_items, movements, review keys, prices, stock, updated_at and flags are byte-identical')
  assert.deepEqual(after.products, [
    { id: 1, cost_price_usd: 1.2333, cost_price_khr: 4100.1235, purchase_price_usd: 1.2333, purchase_price_khr: 4100.1235 },  // 1.2333333.. down; 4100.12345 is a tie -> up
    { id: 2, cost_price_usd: 4.1667, cost_price_khr: 4100, purchase_price_usd: 4.1667, purchase_price_khr: 4100 },
    { id: 3, cost_price_usd: 1.0002, cost_price_khr: null, purchase_price_usd: 1.0002, purchase_price_khr: 0 },                 // tie 1.00015 -> 1.0002; null and 0 stay
    { id: 4, cost_price_usd: 2.0001, cost_price_khr: 6000, purchase_price_usd: 2.0001, purchase_price_khr: 6000 },              // clean row untouched
    { id: 5, cost_price_usd: 3.5, cost_price_khr: 4100, purchase_price_usd: 3.5001, purchase_price_khr: 4100 },                 // mirror tie 3.50005 -> 3.5001
    { id: 6, cost_price_usd: 1.0002, cost_price_khr: 4100, purchase_price_usd: 1.0002, purchase_price_khr: 4100 },
    { id: 7, cost_price_usd: 9.1235, cost_price_khr: 4100, purchase_price_usd: 9.1235, purchase_price_khr: 4100 },
    { id: 8, cost_price_usd: 1.0011, cost_price_khr: 4100, purchase_price_usd: 1.0011, purchase_price_khr: 4100 },
  ])
  assert.deepEqual(after.lots, [
    { id: 1, unit_cost_usd: 1.2333, received_cost_usd: 149.5736 },   // 149.573577 -> 149.5736
    { id: 2, unit_cost_usd: 2, received_cost_usd: 10 },
    { id: 3, unit_cost_usd: 1.0002, received_cost_usd: 1.0002 },
    { id: 4, unit_cost_usd: 2.0001, received_cost_usd: 6.0003 },
    { id: 5, unit_cost_usd: 1.0002, received_cost_usd: 2.0001 },     // 2.00005 tie -> 2.0001
    { id: 6, unit_cost_usd: 4.1667, received_cost_usd: 4.1667 },
  ])
  assert.deepEqual(after.entries, [
    { id: 1, cost_usd: 1.0002, cost_khr: 5000.5556, previous_cost_usd: 1.1111 },
    { id: 2, cost_usd: 1.25, cost_khr: 5000, previous_cost_usd: 1.0002 },
    { id: 3, cost_usd: 2.5, cost_khr: null, previous_cost_usd: null },
    { id: 4, cost_usd: 4.1667, cost_khr: 17000, previous_cost_usd: 4.1666 },
  ])
  // The ledger: one row per column written, exact before and after, nothing for a clean value.
  const ledger = rows(db, 'SELECT entity, row_id, col, before_value, after_value FROM cost_4dp_repair_0313 ORDER BY entity, row_id, col')
  const key = (r) => `${r.entity}:${r.row_id}:${r.col}`
  const byKey = Object.fromEntries(ledger.map((r) => [key(r), r]))
  const expectLedger = {
    'products:1:cost_price_usd': [1.2333333333333334, 1.2333], 'products:1:cost_price_khr': [4100.12345, 4100.1235], 'products:1:purchase_price_usd': [1.2333333333333334, 1.2333],
    'products:1:purchase_price_khr': [4100.12345, 4100.1235], 'products:2:cost_price_usd': [4.166667, 4.1667], 'products:2:purchase_price_usd': [4.166667, 4.1667],
    'products:3:cost_price_usd': [1.00015, 1.0002], 'products:3:purchase_price_usd': [1.00015, 1.0002], 'products:5:purchase_price_usd': [3.50005, 3.5001],
    'products:6:cost_price_usd': [1.00015, 1.0002], 'products:6:purchase_price_usd': [1.00015, 1.0002], 'products:7:cost_price_usd': [9.123456789, 9.1235], 'products:7:purchase_price_usd': [9.123456789, 9.1235],
    'products:8:cost_price_usd': [1.00105, 1.0011], 'products:8:purchase_price_usd': [1.00105, 1.0011],
    'product_batches:1:unit_cost_usd': [1.2333333333333334, 1.2333], 'product_batches:1:received_cost_usd': [149.573577, 149.5736], 'product_batches:3:unit_cost_usd': [1.00015, 1.0002],
    'product_batches:3:received_cost_usd': [1.00015, 1.0002], 'product_batches:5:unit_cost_usd': [1.00015, 1.0002], 'product_batches:5:received_cost_usd': [2.00005, 2.0001],
    'product_batches:6:unit_cost_usd': [4.166667, 4.1667], 'product_batches:6:received_cost_usd': [4.166667, 4.1667],
    'product_cost_entries:1:cost_usd': [1.00015, 1.0002], 'product_cost_entries:1:cost_khr': [5000.55555, 5000.5556], 'product_cost_entries:1:previous_cost_usd': [1.1111111, 1.1111],
    'product_cost_entries:2:previous_cost_usd': [1.00015, 1.0002],
  }
  assert.deepEqual(Object.keys(byKey).sort(), Object.keys(expectLedger).sort(), 'the ledger holds exactly the columns that were over 4 places')
  assert.equal(ledger.length, 27)
  for (const [k, [b, a]] of Object.entries(expectLedger)) {
    assert.equal(byKey[k].before_value, b, `${k} before`)
    assert.equal(byKey[k].after_value, a, `${k} after`)
  }
  assert.equal(one(db, "SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE '\\_cost\\_4dp\\_%' ESCAPE '\\'").n, 0, 'work tables dropped')

  // The catalog-cost triggers agree with the repair: a later lot event on a repaired sold-out product keeps the repaired figure.
  const recompute = fixture()
  recompute.exec(text)
  recompute.exec(PERMIT)
  recompute.exec('UPDATE product_batches SET unit_cost_usd = unit_cost_usd WHERE id IN (3, 5)')
  recompute.exec(NO_PERMIT)
  assert.equal(one(recompute, 'SELECT cost_price_usd c FROM products WHERE id = 3').c, 1.0002)
  assert.equal(one(recompute, 'SELECT cost_price_usd c FROM products WHERE id = 6').c, 1.0002)

  // ---- 3. idempotent ---------------------------------------------------------------------------------------------------------------------------
  const clean = fixture()
  clean.exec(text)
  const state = (d) => JSON.stringify([costs(d), untouched(d), rows(d, 'SELECT * FROM cost_4dp_repair_0313 ORDER BY entity, row_id, col'), over4(d)])
  const once = state(clean)
  clean.exec(text)
  assert.equal(state(clean), once, 'a second run changes nothing')

  // ---- 4. reversal -----------------------------------------------------------------------------------------------------------------------------
  const rev = fixture()
  const original = costs(rev)
  rev.exec(text)
  // A product edited after the repair keeps its newer value: the recovery moves only a value still at the repair's after-value.
  rev.exec(PERMIT)
  rev.exec('UPDATE products SET cost_price_usd = 7.7777, purchase_price_usd = 7.7777 WHERE id = 7')
  rev.exec(NO_PERMIT)
  rev.exec(recoverySql)
  const reverted = costs(rev)
  const without7 = (c) => JSON.stringify({ ...c, products: c.products.filter((p) => p.id !== 7) })
  assert.equal(without7(reverted), without7(original), 'recovery puts every repaired value back exactly')
  assert.deepEqual(reverted.products.find((p) => p.id === 7), { id: 7, cost_price_usd: 7.7777, cost_price_khr: 4100, purchase_price_usd: 7.7777, purchase_price_khr: 4100 }, 'a row edited after the repair keeps its newer value')
  assert.deepEqual(rows(rev, "SELECT key FROM system_flags WHERE key IN ('maintenance', 'stock_transaction_permit')"), [], 'recovery leaves no flag behind')

  // ---- 5. PRE and POST --------------------------------------------------------------------------------------------------------------------------
  const aborts = (setup, sql, label) => {
    const d = fixture({ extraProducts: label.includes('cap') ? 500 : 0 })
    setup(d)
    const costsBefore = JSON.stringify(costs(d))
    try { d.exec(sql) } catch (e) { assert.match(String(e.message), /bad JSON path|malformed JSON|JSON path/i, label + ': ' + e.message); return { d, unchanged: JSON.stringify(costs(d)) === costsBefore } }
    assert.fail(label + ': did not abort')
    return { d, unchanged: JSON.stringify(costs(d)) === costsBefore }
  }
  for (const [label, setup] of [['PRE: a permit left behind aborts', (d) => d.exec(PERMIT)],
    ['PRE: a maintenance flag aborts', (d) => { d.exec(PERMIT); d.exec("INSERT INTO system_flags(key, value) VALUES ('maintenance', '{\"mode\":\"restore\"}')"); d.exec(NO_PERMIT) }],
    ['PRE: scope over the cap aborts', () => {}]]) {
    const r = aborts(setup, text, label)
    assert.ok(r.unchanged, `${label}: nothing written`)
    assert.equal(one(r.d, "SELECT COUNT(*) n FROM sqlite_master WHERE name = 'cost_4dp_repair_0313'").n, 0, `${label}: no ledger created`)
  }

  // ---- 6. mutants -------------------------------------------------------------------------------------------------------------------------------
  const mutant = (label, transform, expectAbort) => {
    const sql = transform(text)
    assert.notEqual(sql, text, `${label}: the mutation applied`)
    const d = fixture()
    if (expectAbort) { assert.throws(() => d.exec(sql), expectAbort, label); return d }
    d.exec(sql)
    return d
  }
  // The POST check catches a repair that rewrites history.
  mutant('touches sale_items', (s) => s.replace("DELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';",
    "UPDATE sale_items SET cost_price_usd = 9;\nDELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';"), /malformed JSON|JSON path/i)
  mutant('touches inventory_movements', (s) => s.replace("DELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';",
    "UPDATE inventory_movements SET unit_cost_usd = 9;\nDELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';"), /malformed JSON|JSON path/i)
  mutant('touches return_items', (s) => s.replace("DELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';",
    "UPDATE return_items SET cost_price_usd = 9;\nDELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';"), /malformed JSON|JSON path/i)
  mutant('touches a cost_review_key', (s) => s.replace("DELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';",
    "UPDATE products SET cost_review_key = NULL WHERE id = 6;\nDELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';"), /malformed JSON|JSON path|product_cost_review_write_refused/i)
  mutant('touches a price', (s) => s.replace("DELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';",
    "UPDATE products SET selling_price_usd = 1 WHERE id = 4;\nDELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';"), /malformed JSON|JSON path/i)
  // Without the permit the 0258 fence refuses the write.
  mutant('no permit', (s) => s.replace(/INSERT INTO system_flags \(key, value, updated_at\)\nSELECT 'stock_transaction_permit'[^;]*;\n/, ''), /stock_transaction_required/)
  // Without the maintenance flag the lot trigger clears a review key: the key check goes red.
  mutant('no maintenance flag', (s) => s.replace("INSERT INTO system_flags (key, value, updated_at) VALUES ('maintenance', '{\"mode\":\"restore\"}', CURRENT_TIMESTAMP);\n", '')
    .replace("DELETE FROM system_flags WHERE key = 'maintenance' AND value = '{\"mode\":\"restore\"}';\n", ''), /malformed JSON|JSON path/i)
  // A smaller scope leaves long values behind.
  mutant('lots left out of the scope', (s) => s.replace(/INSERT INTO cost_4dp_repair_0313 \(entity, row_id, col, before_value, after_value\)\nSELECT 'product_batches', id, 'received_cost_usd'[^;]*;\n/, ''), /malformed JSON|JSON path/i)
  // ROUND(x, 4) rounds the binary double: 1.00015 stores as 1.000149999999999961 and goes DOWN. The nudge form is what makes the tie exact.
  const naive = mutant('ROUND(x, 4)', (s) => s.replace(/\(\(CASE WHEN (\w+) < 0 THEN -CAST\(-\1 \* 10000\.0 \+ 0\.5 \+ 1e-8 AS INTEGER\) ELSE CAST\(\1 \* 10000\.0 \+ 0\.5 \+ 1e-8 AS INTEGER\) END\) \/ 10000\.0\)/g, 'ROUND($1, 4)'))
  assert.notDeepEqual(costs(naive), after, 'ROUND(x, 4) gives a different answer on the fixture (the tie cases)')
  assert.equal(one(naive, 'SELECT cost_price_usd c FROM products WHERE id = 8').c, 1.001, 'ROUND(1.00105, 4) lands on 1.001, the wrong side of the tie')
  // Unsigned truncation without the sign branch would mis-round negatives: the sign-aware form is symmetric.
  const sym = openDb(chain((f) => f < MIGRATION)).db
  assert.equal(one(sym, 'SELECT ((CASE WHEN -1.00015 < 0 THEN -CAST(-(-1.00015) * 10000.0 + 0.5 + 1e-8 AS INTEGER) ELSE CAST(-1.00015 * 10000.0 + 0.5 + 1e-8 AS INTEGER) END) / 10000.0) AS v').v, -1.0002, 'ties go away from zero for a negative value too')

  console.log('test-migration-0313-cost-4dp-repair-pure: ok')
}

try { main() } catch (e) { console.error(e); process.exitCode = 1 }
