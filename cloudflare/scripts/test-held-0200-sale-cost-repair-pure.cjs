// Companion for ops/scripts/migration/held/0200_sale_cost_on_hand_repair.sql and
// ops/scripts/audit/sale-cost-on-hand-audit.sql (U-cost Part B, owner decision
// 2026-09-26: past sale lines whose recorded cost came from the buggy catalog
// average get the cost of the stock on hand when they were sold).
//
// Real migrated SQLite (node:sqlite via harness/d1compat.cjs): the chain
// through 0194, a pre-0195 history seeded with the writers' statement shapes,
// then 0195 and the held 0200 exactly as written. Fixtures distinguish the method from
// the two plausible wrong ones -- today's corrected catalog average, and
// weighting by TODAY's on-hand quantities -- and each transition is checked
// for double-apply and reversal:
//   1. Text: LF-only; the plan is byte-identical in the migration and every
//      audit statement; the audit is SELECT-only and writes nothing.
//   2. Buckets: repair / already_correct / ledger_unverified, and the lines
//      that did not come from the buggy average (hand-typed, pre-era) are not
//      candidates at all.
//   3. Apply: backup first; ONLY sale_items.cost_price_usd and copied
//      return_items.cost_price_usd move; revenue, quantities, statuses,
//      receipts, movements, products byte-identical; the cost delta equals the
//      audit's D.
//   4. Double-apply: the plan finds nothing left to repair.
//   5. Recovery (the header's statements, verbatim): byte-identical cost
//      columns, and a line edited after 0200 is left alone.
//   6. Held: the file is NOT in cloudflare/migrations (a deploy applies every
//      waiting file there); its number sorts after every chain file that
//      touches a table it reads or writes (0195 among them), so moving it in
//      unchanged runs it after all of them. It need not be the last file: a
//      chain file numbered above it must touch none of those tables, and the
//      whole chain plus it applies to a fresh database in either order, to
//      the same schema.
//   7. Owner-run audit: every command in the header is --command (never
//      --file), and each one cut from the audit file is exactly that audit
//      statement and runs, returning the numbers the header says to read.
//
// Run (from cloudflare/): node scripts/test-held-0200-sale-cost-repair-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const migrationsDir = path.resolve(__dirname, '../migrations')
const heldDir = path.resolve(__dirname, '../../ops/scripts/migration/held')
const heldName = '0200_sale_cost_on_hand_repair.sql'
const migrationText = fs.readFileSync(path.join(heldDir, heldName), 'utf8')
const migration0195 = fs.readFileSync(path.join(migrationsDir, '0195_catalog_cost_on_hand.sql'), 'utf8')
const auditText = fs.readFileSync(path.resolve(__dirname, '../../ops/scripts/audit/sale-cost-on-hand-audit.sql'), 'utf8')
  // SELECT-only and outside the eol=lf rule: a fresh autocrlf checkout may give it CRLF.
  .replace(/\r\n/g, '\n')

let checks = 0
function check(name, fn) {
  try { fn(); checks++; console.log(`PASS ${name}`) }
  catch (error) { console.log(`FAIL ${name} - ${error.stack}`); process.exitCode = 1 }
}

const planOf = (text) => [...text.matchAll(/-- plan:begin\n([\s\S]*?)\n-- plan:stop\n/g)].map((m) => m[1])
// Audit statements: each "-- plan:begin ... ;" block, comments stripped.
const auditStatements = () => auditText.split(/\n(?=-- plan:begin\n)/).slice(1)
  .map((block) => block.slice(0, block.indexOf(';\n') + 1).trim())
const recoverySql = () => migrationText.split('\n-- Statements:\n')[1].split('\n-- The backup tables')[0]
  .split('\n').filter((l) => l.startsWith('--   ')).map((l) => l.slice(5)).join('\n')
const planSelect = (select) => `${planOf(migrationText)[0]}\n${select}`

function world() {
  const d1 = openDb(loadAll({ through: 194 }))
  const raw = d1.db
  for (const [id, name] of [[1, 'Shop'], [2, 'Warehouse']]) raw.prepare('INSERT OR IGNORE INTO branches(id, name) VALUES (?, ?)').run(id, name)
  let seq = 0
  const product = (stored) => Number(raw.prepare('INSERT INTO products(name, cost_price_usd, purchase_price_usd, cost_price_khr, is_active) VALUES (?, ?, ?, 0, 1)')
    .run(`P${++seq}`, stored, stored).lastInsertRowid)
  // A receipt: the lot and its batch-stamped stock_in movement (inventory.ts shape).
  const lot = (productId, cost, day, quantity, { movement = true } = {}) => {
    const at = `2026-09-${day} 08:00:00`
    const id = Number(raw.prepare(`INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, received_at, created_at, received_quantity, received_branch_id)
      VALUES (?, ?, 1, ?, ?, ?, ?, 1)`).run(productId, `k${++seq}`, cost, `2026-09-${day}`, at, quantity).lastInsertRowid)
    if (movement) raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, batch_id, created_at)
      VALUES (?, 1, 'stock_in', ?, ?, ?, ?)`).run(productId, quantity, cost, id, at)
    return id
  }
  const setStock = (lotId, quantity) => raw.prepare(`INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (?, 1, ?)
    ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = excluded.quantity`).run(lotId, quantity)
  // A sale line as routes/sales.ts writes it: the line with its cost snapshot,
  // its 'sale' movement (reference_id = sale id; batch_id = the lot, or NULL on
  // a multi-lot line), and per-lot allocations for a multi-lot line.
  const sale = (productId, at, quantity, cost, { lotId = null, allocations = [], price = 20, status = 'completed', movement = true } = {}) => {
    const total = price * quantity
    const saleId = Number(raw.prepare(`INSERT INTO sales(receipt_number, created_at, subtotal_usd, total_usd, sale_status, branch_id)
      VALUES (?, ?, ?, ?, ?, 1)`).run(`R${++seq}`, at, total, total, status).lastInsertRowid)
    const lineId = Number(raw.prepare(`INSERT INTO sale_items(sale_id, product_id, product_name, quantity, applied_price_usd, applied_price_khr, cost_price_usd, cost_price_khr, total_usd, total_khr, branch_id, batch_id)
      VALUES (?, ?, 'x', ?, ?, 0, ?, 0, ?, 0, 1, ?)`).run(saleId, productId, quantity, price, cost, total, lotId).lastInsertRowid)
    if (movement) raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, unit_cost_khr, reference_id, batch_id, created_at)
      VALUES (?, 1, 'sale', ?, ?, 0, ?, ?, ?)`).run(productId, -quantity, cost, saleId, lotId, at)
    for (const [batchId, q] of allocations) raw.prepare(`INSERT INTO sale_item_batch_allocations(sale_item_id, batch_id, branch_id, quantity, released_quantity)
      VALUES (?, ?, 1, ?, 0)`).run(lineId, batchId, q)
    return { saleId, lineId }
  }
  return { d1, raw, product, lot, setStock, sale }
}

// Every column of every row, with each cost column's storage type.
function dump(raw, table, { without = [] } = {}) {
  return raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all().map((row) => {
    const out = {}
    for (const [key, value] of Object.entries(row)) if (!without.includes(key)) out[key] = value
    if ((table === 'sale_items' || table === 'return_items') && !without.includes('cost_type')) out.cost_type = raw.prepare(`SELECT typeof(cost_price_usd) t FROM ${table} WHERE id = ?`).get(row.id).t
    return out
  })
}
function assertIdentical(actual, expected, message) {
  assert.equal(actual.length, expected.length, `${message}: row count`)
  for (let i = 0; i < expected.length; i++) {
    for (const key of new Set([...Object.keys(expected[i]), ...Object.keys(actual[i])])) {
      assert.ok(Object.is(actual[i][key], expected[i][key]), `${message}: row ${expected[i].id} ${key} ${String(actual[i][key])} vs ${String(expected[i][key])}`)
    }
  }
}

function seed() {
  const w = world()
  const { raw, product, lot, setStock, sale } = w
  const ids = {}

  // P1, the owner's example. C (11.00) sold out before the line; 2 x 12.00 and
  // 8 x 12.50 on the shelf. Buggy: (11 + 12 + 12.5) / 3 = 11.8333. On hand:
  // 12.40. Today's corrected catalog figure (A 2, B 6 after later traffic,
  // what 0195 stores) is 12.375 -- not what the shelf held at the sale.
  const p1 = ids.p1 = product(11.8333)
  const c = lot(p1, 11, 17, 3), a = lot(p1, 12, 18, 2), b = lot(p1, 12.5, 19, 8)
  // s0 sells out C; it was recorded at the buggy figure too, and the shelf
  // then held 3 x 11 + 2 x 12 + 8 x 12.5 -> 12.0769.
  ids.s0 = sale(p1, '2026-09-20 09:00:00', 3, 11.8333, { lotId: c })
  ids.s1 = sale(p1, '2026-09-21 10:00:00', 1, 11.8333, { lotId: a })
  ids.s2 = sale(p1, '2026-09-22 10:00:00', 2, 11.8333, { lotId: b })
  // A restocking customer return of s1's line: return_items copies the line's cost.
  const retId = Number(raw.prepare(`INSERT INTO returns(return_number, sale_id, total_refund_usd, status, created_at) VALUES ('RT1', ?, 20, 'completed', '2026-09-23 09:00:00')`).run(ids.s1.saleId).lastInsertRowid)
  ids.returnCopied = Number(raw.prepare(`INSERT INTO return_items(return_id, sale_item_id, product_id, product_name, quantity, applied_price_usd, cost_price_usd, cost_price_khr, total_usd, return_to_stock, stock_action, branch_id, batch_id)
    VALUES (?, ?, ?, 'x', 1, 20, 11.8333, 0, 20, 1, 'restock', 1, ?)`).run(retId, ids.s1.lineId, p1, a).lastInsertRowid)
  raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, reference_id, batch_id, created_at)
    VALUES (?, 1, 'return', 1, 11.8333, ?, ?, '2026-09-23 09:00:00')`).run(p1, retId, a)
  // A return line whose cost was NOT copied from the line (typed): untouched.
  ids.returnTyped = Number(raw.prepare(`INSERT INTO return_items(return_id, sale_item_id, product_id, product_name, quantity, applied_price_usd, cost_price_usd, cost_price_khr, total_usd, return_to_stock, stock_action, branch_id)
    VALUES (?, ?, ?, 'x', 1, 20, 9.5, 0, 20, 0, 'none', 1)`).run(retId, ids.s2.lineId, p1).lastInsertRowid)
  setStock(c, 0); setStock(a, 2); setStock(b, 6)

  // P2, a multi-lot line (movement batch NULL, allocations 2 x D + 1 x E),
  // then a line after D sold out. s3: buggy (5 + 7) / 2 = 6 = on hand
  // (2 x 5 + 2 x 7) / 4 -> already correct. s4: buggy 6, on hand only E -> 7.
  const p2 = ids.p2 = product(6)
  const d = lot(p2, 5, 17, 2), e = lot(p2, 7, 18, 2)
  ids.s3 = sale(p2, '2026-09-20 11:00:00', 3, 6, { allocations: [[d, 2], [e, 1]] })
  ids.s4 = sale(p2, '2026-09-21 11:00:00', 1, 6, { lotId: e })
  setStock(d, 0); setStock(e, 0)

  // P3, a lot that holds stock but has no ledger event: its on-hand history
  // cannot be proven, so the line is reported, not repaired.
  const p3 = ids.p3 = product(3.5)
  const f = lot(p3, 3, 17, 4, { movement: false }), g = lot(p3, 4, 18, 4)
  sale(p3, '2026-09-19 09:00:00', 4, 3.5, { lotId: g })
  ids.s5 = sale(p3, '2026-09-20 09:00:00', 1, 3.5, { lotId: f })
  setStock(f, 3); setStock(g, 0)

  // P4, a hand-typed cost that is no formula's output: not a candidate.
  const p4 = ids.p4 = product(9.99)
  const h = lot(p4, 8, 17, 3); lot(p4, 10, 18, 3)
  ids.s6 = sale(p4, '2026-09-20 09:00:00', 1, 9.99, { lotId: h })
  raw.prepare('UPDATE branch_batch_stock SET quantity = 2 WHERE batch_id = ?').run(h)
  setStock(h, 2); setStock(h + 1, 3)

  // P5, the same buggy figure BEFORE a5a2169f went live: not a candidate.
  const p5 = ids.p5 = product(11.5)
  const i = lot(p5, 11, '09', 2); const j = lot(p5, 12, 10, 2)
  sale(p5, '2026-09-11 09:00:00', 2, 11.5, { lotId: i })
  ids.s7 = sale(p5, '2026-09-15 09:00:00', 1, 11.5, { lotId: j })
  setStock(i, 0); setStock(j, 1)

  // P6, a manual override (baseline = H6) then a later lot. Buggy set = the
  // later lot's 4 plus the override's 10 -> 7. On hand: the override prices
  // H6's 2 units at 10, I6's 1 unit at 4 -> (20 + 4) / 3 = 8.
  const p6 = ids.p6 = product(7)
  const h6 = lot(p6, 2, 17, 2)
  raw.prepare(`INSERT INTO product_cost_entries(product_id, cost_usd, source, baseline_batch_id, created_at) VALUES (?, 10, 'manual', ?, '2026-09-18 08:00:00')`).run(p6, h6)
  const i6 = lot(p6, 4, 19, 1)
  ids.s8 = sale(p6, '2026-09-20 09:00:00', 1, 7, { lotId: i6, movement: true })
  setStock(h6, 2); setStock(i6, 0)

  // P7, a lot whose ledger does not balance: an unstamped removal (no
  // batch_id) took one unit of L, so L holds 2 while its ledger says 3.
  const p7 = ids.p7 = product(9.5)
  const k = lot(p7, 9, 17, 3), l = lot(p7, 10, 18, 3)
  sale(p7, '2026-09-19 09:00:00', 3, 9.5, { lotId: k })
  raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, created_at) VALUES (?, 1, 'remove', -1, 10, '2026-09-19 12:00:00')`).run(p7)
  ids.s9 = sale(p7, '2026-09-20 09:00:00', 1, 9.5, { lotId: l })
  setStock(k, 0); setStock(l, 1)

  // P8, a received lot with no ledger event and nothing on hand today: it
  // balances (0 = 0) but its history is unknown -- it may have been on the
  // shelf at the sale -- so it is not proof.
  const p8 = ids.p8 = product(7)
  lot(p8, 6, 17, 2, { movement: false }); const o = lot(p8, 8, 18, 2)
  ids.s10 = sale(p8, '2026-09-20 09:00:00', 1, 7, { lotId: o })
  setStock(o, 1)

  // P9, a lot whose ledger balances but runs negative (its sale is ledgered
  // before its receipt): the timing is wrong somewhere, so it is not proof.
  const p9 = ids.p9 = product(4)
  const q = lot(p9, 3, 17, 2, { movement: false }); const r = lot(p9, 5, 17, 2)
  sale(p9, '2026-09-17 09:00:00', 2, 4, { lotId: q })
  raw.prepare(`INSERT INTO inventory_movements(product_id, branch_id, movement_type, quantity, unit_cost_usd, batch_id, created_at) VALUES (?, 1, 'stock_in', 2, 3, ?, '2026-09-17 10:00:00')`).run(p9, q)
  ids.s11 = sale(p9, '2026-09-20 09:00:00', 1, 4, { lotId: r })
  setStock(q, 0); setStock(r, 1)

  // 0195 as shipped; its apply time bounds the era.
  raw.exec(migration0195)
  raw.prepare("UPDATE catalog_cost_repair_0195_backup SET created_at = '2026-09-26 00:00:00'").run()
  return { ...w, ids, lots: { a, b } }
}

const buckets = (raw, kind = 'sale') => Object.fromEntries(raw.prepare(planSelect(`SELECT item_id, bucket, correct FROM classified WHERE kind = '${kind}'`)).all()
  .map((row) => [row.item_id, { bucket: row.bucket, correct: row.correct }]))

check('text: LF-only, one plan shared verbatim by the migration and every audit statement, audit SELECT-only', () => {
  assert.ok(!migrationText.includes('\r'), 'migration LF-only (held/*.sql is eol=lf)')
  const plans = [...planOf(migrationText), ...planOf(auditText)]
  assert.equal(planOf(migrationText).length, 1)
  assert.equal(planOf(auditText).length, 3, 'three audit statements')
  for (const plan of plans) assert.equal(plan, plans[0], 'plan text identical')
  const statements = auditStatements()
  assert.equal(statements.length, 3)
  for (const s of statements) {
    const body = s.replace(/--[^\n]*\n/g, '\n')
    assert.match(body.trim(), /^WITH\b/)
    assert.doesNotMatch(body, /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i, 'no writes')
  }
  const body = migrationText.split('\n').filter((l) => !l.startsWith('--')).join('\n')
  const at = (needle) => { const i = body.indexOf(needle); assert.ok(i > 0, needle); return i }
  const firstUpdate = at('\nUPDATE ')
  assert.ok(at('\nCREATE TABLE IF NOT EXISTS sale_cost_repair_0200 (') < at('\nINSERT OR IGNORE INTO sale_cost_repair_0200 (')
    && at('\nINSERT OR IGNORE INTO sale_cost_repair_0200 (') < firstUpdate
    && at('\nINSERT OR IGNORE INTO sale_cost_repair_0200_return_items (') < firstUpdate, 'backups before any UPDATE')
  const updates = [...body.matchAll(/\nUPDATE (\w+) SET (\w+) =/g)].map((m) => `${m[1]}.${m[2]}`)
  assert.deepEqual(updates, ['sale_items.cost_price_usd', 'return_items.cost_price_usd'], 'the only writes are the two cost columns')
  const writes = [...body.matchAll(/\n(INSERT(?: OR IGNORE)? INTO|UPDATE|DELETE FROM|REPLACE INTO|DROP \w+|ALTER TABLE) (\w+)/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual([...new Set(writes)], ['INSERT OR IGNORE INTO sale_cost_repair_0200_plan', 'INSERT OR IGNORE INTO sale_cost_repair_0200',
    'INSERT OR IGNORE INTO sale_cost_repair_0200_return_items', 'UPDATE sale_items', 'UPDATE return_items', 'INSERT INTO branches'], 'nothing else is written')
  const asserts = [...body.matchAll(/\nINSERT INTO branches\(name\) SELECT NULL WHERE /g)].map((m) => m.index)
  assert.ok(asserts.length >= 4 && asserts.every((i) => i > body.lastIndexOf('\nUPDATE ')), 'post assertions use the NOT NULL abort idiom, after the writes')
})

check('buckets: repair / already_correct / ledger_unverified; hand-typed and pre-era lines are not candidates; the audit writes nothing', () => {
  const { raw, ids } = seed()
  const before = raw.prepare('SELECT total_changes() n').get().n
  for (const s of auditStatements()) raw.prepare(s).all()
  assert.equal(raw.prepare('SELECT total_changes() n').get().n, before, 'audit statements change nothing')
  const got = buckets(raw)
  assert.deepEqual(got[ids.s0.lineId], { bucket: 'repair', correct: 12.0769 }, 'C still on hand: (3 x 11 + 2 x 12 + 8 x 12.5) / 13')
  assert.deepEqual(got[ids.s1.lineId], { bucket: 'repair', correct: 12.4 }, 'owner example: (2 x 12 + 8 x 12.5) / 10 on the shelf at the sale')
  assert.deepEqual(got[ids.s2.lineId], { bucket: 'repair', correct: 12.4444 }, 'next day: (1 x 12 + 8 x 12.5) / 9')
  assert.deepEqual(got[ids.s3.lineId], { bucket: 'already_correct', correct: 6 }, 'multi-lot line: the buggy mean equalled the shelf')
  assert.deepEqual(got[ids.s4.lineId], { bucket: 'repair', correct: 7 }, 'after the multi-lot line (allocations) D is empty')
  assert.deepEqual(got[ids.s5.lineId], { bucket: 'ledger_unverified', correct: 4 }, 'a lot with no ledger event (its fallback would be G at 4): reported, not repaired')
  assert.deepEqual(got[ids.s9.lineId], { bucket: 'ledger_unverified', correct: 10 }, 'a lot whose ledger does not sum to its stock: reported, not repaired')
  assert.deepEqual(got[ids.s10.lineId], { bucket: 'ledger_unverified', correct: 8 }, 'a received lot with no ledger event: not proof even when it balances')
  assert.deepEqual(got[ids.s11.lineId], { bucket: 'ledger_unverified', correct: 5 }, 'a ledger that runs negative: not proof even when it balances')
  assert.deepEqual(got[ids.s8.lineId], { bucket: 'repair', correct: 8 }, 'override prices the 2 units it re-priced: (2 x 10 + 1 x 4) / 3')
  assert.equal(got[ids.s6.lineId], undefined, 'hand-typed cost: not a candidate')
  assert.equal(got[ids.s7.lineId], undefined, 'before a5a2169f: not a candidate')
  // Discriminating controls: the plausible wrong methods give other figures.
  const today = raw.prepare('SELECT cost_price_usd c FROM products WHERE id = ?').get(ids.p1).c
  assert.equal(today, 12.375, "today's corrected catalog cost, today's quantities: (2 x 12 + 6 x 12.5) / 8")
  assert.ok(today !== 12.4 && today !== 12.4444, "today's corrected average is NOT the shelf at either sale")
  const summaryRows = raw.prepare(auditStatements()[0]).all()
  assert.deepEqual(summaryRows.map((r) => r.bucket), ['repair', 'window', 'returns_sale_linked', 'returns_walk_in', 'ledger_unverified',
    'needs_owner_review', 'after_window', 'already_correct'], 'every bucket listed, in order, even when empty')
  const summary = Object.fromEntries(summaryRows.map((r) => [r.bucket, r]))
  assert.equal(summary.repair.lines, 5)
  assert.equal(summary.ledger_unverified.lines, 7, 's5, s9, s10, s11, the two unnamed earlier sales of P3 and P9, and the earlier sale of P7 -- its estimate equals its recorded cost, but an unreconciled ledger proves neither')
  assert.equal(summary.returns_sale_linked.lines, 1, 'the copied return line')
  assert.equal(summary.window.lines + summary.returns_walk_in.lines + summary.needs_owner_review.lines + summary.after_window.lines, 0)
  assert.deepEqual(buckets(raw, 'return'), { [ids.returnCopied]: { bucket: 'returns_sale_linked', correct: 12.4 } }, 'the typed return line is not listed')
  assert.equal(summary.repair.cost_delta_usd, Math.round((3 * (12.0769 - 11.8333) + (12.4 - 11.8333) + 2 * (12.4444 - 11.8333) + (7 - 6) + (8 - 7)) * 10000) / 10000)
  const effect = raw.prepare(auditStatements()[2]).get()
  assert.equal(effect.return_lines, 1, 'one copied return line')
  assert.equal(effect.returned_cost_delta_usd, 0.5667)
})

check('apply: backup first, only the two cost columns move, revenue and everything else byte-identical, delta = D', () => {
  const { raw, ids } = seed()
  const D = raw.prepare(auditStatements()[0]).all().find((r) => r.bucket === 'repair').cost_delta_usd
  const tables = ['sales', 'returns', 'inventory_movements', 'products', 'product_batches', 'branch_batch_stock', 'sale_item_batch_allocations']
  const before = Object.fromEntries(tables.map((t) => [t, dump(raw, t)]))
  const itemsBefore = dump(raw, 'sale_items'), returnItemsBefore = dump(raw, 'return_items')
  const sums = () => raw.prepare(`SELECT COUNT(*) n, SUM(quantity) q, SUM(total_usd) t, SUM(applied_price_usd * quantity) p, SUM(cost_price_khr * quantity) k,
    ROUND(SUM(cost_price_usd * quantity), 4) c FROM sale_items`).get()
  const s0 = sums()
  raw.exec(migrationText)
  const s1 = sums()
  assert.deepEqual([s1.n, s1.q, s1.t, s1.p, s1.k], [s0.n, s0.q, s0.t, s0.p, s0.k], 'count, quantity, revenue, price, KHR cost unchanged')
  assert.equal(Math.round((s1.c - s0.c) * 10000) / 10000, D, 'the cost total moved by exactly D')
  assert.equal(raw.prepare('SELECT ROUND(SUM(quantity * (new_cost_price_usd - old_cost_price_usd)), 4) d FROM sale_cost_repair_0200').get().d, D)
  for (const t of tables) assertIdentical(dump(raw, t), before[t], `${t} byte-identical`)
  assertIdentical(dump(raw, 'sale_items', { without: ['cost_price_usd', 'cost_type'] }), itemsBefore.map(({ cost_price_usd, cost_type, ...r }) => r), 'sale_items: every other column identical')
  assertIdentical(dump(raw, 'return_items', { without: ['cost_price_usd', 'cost_type'] }), returnItemsBefore.map(({ cost_price_usd, cost_type, ...r }) => r), 'return_items: every other column identical')
  const cost = (table, id) => raw.prepare(`SELECT cost_price_usd c FROM ${table} WHERE id = ?`).get(id).c
  assert.deepEqual([ids.s0, ids.s1, ids.s2, ids.s3, ids.s4, ids.s5, ids.s6, ids.s7, ids.s8, ids.s9, ids.s10, ids.s11].map((s) => cost('sale_items', s.lineId)),
    [12.0769, 12.4, 12.4444, 6, 7, 3.5, 9.99, 11.5, 8, 9.5, 7, 4], 'only the repair bucket moved')
  assert.equal(cost('return_items', ids.returnCopied), 12.4, 'copied return line follows its sale line')
  assert.equal(cost('return_items', ids.returnTyped), 9.5, 'typed return cost untouched')
  assert.deepEqual(raw.prepare('SELECT sale_item_id, old_cost_price_usd o, new_cost_price_usd n FROM sale_cost_repair_0200 ORDER BY sale_item_id').all().map((r) => [r.sale_item_id, r.o, r.n]),
    [[ids.s0.lineId, 11.8333, 12.0769], [ids.s1.lineId, 11.8333, 12.4], [ids.s2.lineId, 11.8333, 12.4444], [ids.s4.lineId, 6, 7], [ids.s8.lineId, 7, 8]])
  // Double-apply: the plan finds nothing further to repair.
  assert.equal(Object.values(buckets(raw)).filter((b) => b.bucket === 'repair').length, 0, 'second run: nothing to repair')
  const after = Object.fromEntries(raw.prepare(auditStatements()[0]).all().map((r) => [r.bucket, r.lines]))
  assert.deepEqual([after.repair, after.window, after.returns_sale_linked, after.returns_walk_in], [0, 0, 0, 0], 'audit after: nothing left to rewrite')
  assert.equal(after.ledger_unverified, 7, 'review buckets unchanged')
  // Re-running the whole file changes nothing at all, backup tables included.
  const snap = () => Object.fromEntries([...['sale_items', 'return_items', ...tables].map((t) => [t, dump(raw, t)]),
    ...['sale_cost_repair_0200', 'sale_cost_repair_0200_return_items'].map((t) => [t, raw.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()]),
    ['plan', raw.prepare('SELECT * FROM sale_cost_repair_0200_plan ORDER BY kind, item_id').all()]])
  const once = snap()
  raw.exec(migrationText)
  assert.deepEqual(snap(), once, 'second exec of the file: every table identical')
})

check('recovery: the header statements restore both cost columns byte-identical; a line changed after 0200 is left alone', () => {
  const { raw, ids } = seed()
  const itemsBefore = dump(raw, 'sale_items'), returnItemsBefore = dump(raw, 'return_items')
  raw.exec(migrationText)
  raw.exec(recoverySql())
  assertIdentical(dump(raw, 'sale_items'), itemsBefore, 'sale_items restored exactly')
  assertIdentical(dump(raw, 'return_items'), returnItemsBefore, 'return_items restored exactly')
  raw.exec(recoverySql())
  assertIdentical(dump(raw, 'sale_items'), itemsBefore, 'recovery twice: still exact')

  const again = seed()
  again.raw.exec(migrationText)
  again.raw.prepare('UPDATE sale_items SET cost_price_usd = 99 WHERE id = ?').run(again.ids.s2.lineId)
  const preview = migrationText.split('Preview:\n')[1].split('\n-- Statements:')[0].split('\n').map((l) => l.replace(/^--\s+/, '')).join(' ')
  assert.equal(Object.values(again.raw.prepare(preview).get())[0], 1, 'preview names the line changed since')
  again.raw.exec(recoverySql())
  assert.equal(again.raw.prepare('SELECT cost_price_usd c FROM sale_items WHERE id = ?').get(again.ids.s2.lineId).c, 99, 'a later edit is not reverted')
  assert.equal(again.raw.prepare('SELECT cost_price_usd c FROM sale_items WHERE id = ?').get(again.ids.s1.lineId).c, 11.8333, 'the rest is restored')
})

// The tables a migration names: its SQL with comments and string literals
// blanked (a quoted name is data, e.g. the merge payload's '$.table' values).
const namedIn = (text) => {
  const sql = text.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
  return (table) => new RegExp(`\\b${table}\\b`, 'i').test(sql)
}

// A file made only of CREATE INDEX statements adds seek paths and cannot change
// a row or a column, so its position relative to the repair cannot interact
// with it (0196, 0207). Anything else that names a table still counts.
const indexOnly = (text) => {
  const statements = text.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').split(';').map((s) => s.trim()).filter(Boolean)
  return statements.length > 0 && statements.every((s) => /^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(s))
}

check('held: not in cloudflare/migrations; sorts after every chain file touching a table it reads or writes (0195 among them), not necessarily last; the chain plus it applies to a fresh database in either order', () => {
  const chain = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  const chainText = (f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8')
  assert.ok(!chain.some((f) => /sale_cost_on_hand_repair/.test(f)), 'the repair must not sit in the deploy chain')
  assert.ok(!chain.some((f) => f.startsWith('0200_')), 'slot 0200 is this held file, not a chain file')
  assert.ok(chain.includes('0195_catalog_cost_on_hand.sql'), '0195 stays in the chain')
  assert.ok(!loadAll().some((sql) => /CREATE TABLE sale_cost_repair_/.test(sql)), 'the full chain creates no repair table')
  assert.match(heldName, /^\d{4}_[a-z0-9_]+\.sql$/, 'wrangler migration file name shape')
  // Moved in unchanged, it takes its place by number (wrangler orders
  // migration files by their leading number).
  const movedIn = [...chain, heldName].sort()
  assert.ok(movedIn.indexOf(heldName) > movedIn.indexOf('0195_catalog_cost_on_hand.sql'), 'it reads the backup 0195 creates, so it must sort after 0195')
  // What it depends on: every chain file that names a table the repair names,
  // the tables read from the migrated schema itself.
  const fresh = openDb(chain.map(chainText)).db
  const tables = fresh.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name)
  const touched = tables.filter(namedIn(migrationText))
  const dependencies = chain.filter((f) => !indexOnly(chainText(f)) && touched.some(namedIn(chainText(f))))
  assert.ok(['sale_items', 'return_items', 'catalog_cost_repair_0195_backup'].every((t) => touched.includes(t)), 'control: the scan sees the two tables it writes and the 0195 backup it reads')
  assert.ok(dependencies.includes('0195_catalog_cost_on_hand.sql'), 'control: the scan finds 0195')
  assert.ok(indexOnly('-- x\nCREATE INDEX IF NOT EXISTS i ON sale_items(id);\nCREATE UNIQUE INDEX j ON sale_items(id);'), 'control: an index-only file is skipped')
  assert.ok(!indexOnly('CREATE INDEX i ON sale_items(id); UPDATE sale_items SET cost_price_usd = 0;') && !indexOnly('ALTER TABLE sale_items ADD COLUMN z INTEGER;'), 'control: a file that also changes rows or columns is still a dependency')
  const later = chain.filter((f) => movedIn.indexOf(f) > movedIn.indexOf(heldName))
  assert.deepEqual(later.filter((f) => dependencies.includes(f)), [],
    `these chain files sort after ${heldName} yet touch a table it reads or writes (${touched.join(', ')}). ` +
    'It need not be the last file, but a file numbered above it must touch none of those tables: wrangler applies whatever is ' +
    'unapplied in file-number order, so where that file is already applied (production) the repair runs after it, and on a ' +
    'fresh database it runs before it -- the two orders agree only when they cannot interact. Otherwise number the repair ' +
    'above that file in the owner-approved move.')
  // The chain plus it: production's order (every chain file already applied) ...
  fresh.exec(migrationText)
  assert.equal(fresh.prepare('SELECT COUNT(*) n FROM sale_cost_repair_0200').get().n, 0, 'fresh database: nothing to repair')
  // ... and a fresh database's once it is moved in (file-number order).
  const byNumber = openDb(movedIn.map((f) => (f === heldName ? migrationText : chainText(f)))).db
  const schema = (db) => db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all()
  assert.deepEqual(schema(byNumber), schema(fresh), `before or after ${later.join(', ') || 'no later file'}: the same schema`)
  assert.throws(() => openDb(loadAll({ through: 194 })).db.exec(migrationText), /catalog_cost_repair_0195_backup/, 'without 0195 it refuses to run')
})

check('owner-run audit: every header command is --command (never --file); the cut statements are the audit verbatim and run', () => {
  const header = migrationText.split('\n-- ============================== OWNER-RUN AUDIT')[1].split('\n-- Owner decision')[0]
  const commands = header.split('\n').filter((l) => /^--\s+node .*wrangler d1 execute/.test(l)).map((l) => l.replace(/^--\s+/, ''))
  assert.equal(commands.length, 5, 'A (two), B, C, D')
  for (const c of commands) {
    assert.match(c, /^node scripts\/with-wrangler-auth\.cjs wrangler d1 execute business-os --remote --command "/)
    assert.doesNotMatch(c, /--file/)
  }
  for (const read of ["bucket 'repair' -> lines = R", "bucket 'window' -> lines = W", "'returns_sale_linked' and 'returns_walk_in'", 'cost_delta_usd = D',
    "bucket 'ledger_unverified' -> lines", "bucket 'needs_owner_review' -> lines", "bucket 'after_window'"]) {
    assert.ok(header.includes(read), `header says to read ${read}`)
  }
  const { raw } = seed()
  // A: the literal SELECT (d1_migrations is wrangler's own table, absent here).
  const eraEnd = commands.map((c) => c.match(/--command "(SELECT [^"]*catalog_cost_repair_0195_backup)"/)).find(Boolean)
  assert.ok(eraEnd, 'A names the 0195 backup')
  const eraRow = raw.prepare(eraEnd[1]).get()
  assert.deepEqual([eraRow.fix_at, eraRow.era_end], ['2026-09-26 00:00:00', '2026-09-26 02:00:00'], 'A reads fix_at and the window end')
  // B, C, D: emulate  sed -n '/^-- N\. /,/;$/p' <audit> | grep -v '^--'
  const auditLines = auditText.split('\n')
  const cut = (n) => {
    const start = auditLines.findIndex((l) => l.startsWith(`-- ${n}. `))
    const end = auditLines.findIndex((l, i) => i > start && /;$/.test(l))
    return auditLines.slice(start, end + 1).filter((l) => !l.startsWith('--')).join('\n')
  }
  const sedCut = /sed -n '\/\^-- (\d)\\\. \/,\/;\$\/p' \.\.\/ops\/scripts\/audit\/sale-cost-on-hand-audit\.sql \| grep -v '\^--'\)" --json$/
  const cuts = commands.map((c) => c.match(sedCut)).filter(Boolean).map((m) => Number(m[1]))
  assert.deepEqual(cuts, [1, 2, 3], 'B, C, D cut statements 1, 2, 3 from the audit file')
  const strip = (s) => s.split('\n').filter((l) => !l.startsWith('--')).join('\n')
  for (const n of cuts) {
    assert.equal(cut(n), strip(auditStatements()[n - 1]), `statement ${n} cut verbatim`)
    // Survives a shell that flattens newlines: no comment left to swallow the rest.
    assert.doesNotMatch(cut(n), /--/, `statement ${n} carries no comment`)
  }
  const summary = Object.fromEntries(raw.prepare(cut(1).replace(/\n/g, ' ')).all().map((r) => [r.bucket, r]))
  assert.equal(summary.repair.lines, 5, 'R')
  assert.equal(summary.ledger_unverified.lines, Object.values(buckets(raw)).filter((b) => b.bucket === 'ledger_unverified').length, 'ledger_unverified count')
  assert.ok(summary.ledger_unverified.lines >= 4, 'the four seeded unverified lines at least')
  assert.equal(typeof summary.repair.cost_delta_usd, 'number', 'D')
  assert.equal(raw.prepare(cut(2)).all().length, Object.values(summary).reduce((n, r) => n + r.lines, 0), 'C lists every line B counts')
  assert.deepEqual(Object.keys(raw.prepare(cut(3)).get()), ['sold_cost_delta_usd', 'returned_cost_delta_usd', 'return_lines'])
  // Logs get counts and sums only: statements 1 and 3 print no id, number or name.
  for (const n of [1, 3]) for (const row of raw.prepare(cut(n)).all()) for (const [k, v] of Object.entries(row)) {
    assert.ok(k === 'bucket' || typeof v === 'number', `statement ${n} prints only aggregates (${k})`)
  }
})

console.log(`${checks} checks passed`)
