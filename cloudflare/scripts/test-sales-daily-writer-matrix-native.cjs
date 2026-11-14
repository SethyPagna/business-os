'use strict'
// Stored daily sales totals: EVERY writer marks the right day(s) dirty. The design (DESIGN-stored-daily-totals.md section 3.1) hangs the whole guarantee on
// the mark-only triggers of migration 0308, so this test is the "every writer" check:
//   1. STATIC: every SQL write site (INSERT / UPDATE / DELETE, incl. an aliased UPDATE and a dynamic table name) on a table the report kernel reads, in
//      cloudflare/src, must be LISTED below with the design group it belongs to. A new site fails here until someone lists it and says how it is covered.
//      The listed sites are what the matrix then proves; a listed site that no longer exists fails too, so the list cannot rot.
//   2. BEHAVIOUR: on a fully migrated chain (node:sqlite), the statement shapes of every (table, verb) a writer uses are run on a CLEAN past day, and
//      EXACTLY the days they touch go dirty: the sale's own day for a child row, both days when a line or a sale moves, the old day for a delete, nothing
//      when only a day that is not the sale's changes (a return's own date).
//   3. The matrix covers every (table, verb) the static list names, so a new kind of write cannot be listed without a case that proves it.
//   Not here (needs the phase B kernel): the stored output equals the existing output after each writer. Restore mode and the data epoch are in
//   test-sales-daily-claim-protocol-pure.cjs and test-migration-0308-sales-daily-totals-pure.cjs.
//
// Run (from cloudflare/): node scripts/test-sales-daily-writer-matrix-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const ROOT = path.join(__dirname, '..')
const KERNEL_TABLES = ['sales', 'sale_items', 'returns', 'return_items', 'fees', 'sale_amendments', 'sale_payment_events', 'sale_item_batch_allocations', 'return_item_batch_allocations']
const scanner = require('./harness/sales-daily-write-scan.cjs')
// The scanner is a TOKENIZER (harness/sales-daily-write-scan.cjs), not a comment-stripping regex: see the fixtures in test-sales-daily-write-scan-pure.cjs.
const scanSource = (override) => scanner.scanSource(ROOT, KERNEL_TABLES, override)
module.exports = { scanSource, KERNEL_TABLES }
if (require.main !== module) return

// ---- the listed sites: file, table, verb -> the design group (section 3.1) that owns it -----------------------------------------------------------------
const LISTED = require('./sales-daily-writer-sites.cjs')

let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

check('STATIC: every SQL write site on a kernel table is listed with its design group, and every listed site still exists', () => {
  const found = scanSource()
  const listed = new Set(Object.keys(LISTED))
  const unlisted = [...found.keys()].filter((key) => !listed.has(key))
  const stale = [...listed].filter((key) => !found.has(key))
  assert.deepEqual(unlisted, [], `a NEW write site on a table the report kernel reads. Add it to scripts/sales-daily-writer-sites.cjs with the design group that covers it, and add the (table, verb) case to the matrix if it is new:\n  ${unlisted.join('\n  ')}`)
  assert.deepEqual(stale, [], `listed sites that no longer exist (delete them from scripts/sales-daily-writer-sites.cjs):\n  ${stale.join('\n  ')}`)
  for (const [key, group] of Object.entries(LISTED)) assert.ok(typeof group === 'string' && group.length > 3, `${key}: no design group`)
})

check('STATIC control: the scanner sees an aliased UPDATE, a dynamic table, a REPLACE, a concatenated write and a quoted table (so a quiet scan is not a blind one)', () => {
  const sample = 'UPDATE sales AS s SET x = 1; INSERT OR REPLACE INTO sale_items (a) VALUES (1); DELETE FROM returns WHERE id = 1; UPDATE ${table} SET y = 2; UPDATE sale_items si SET z = 1'
  const seen = scanner.scanText('const q = `' + sample + '`', KERNEL_TABLES).map((site) => `${site.table} ${site.verb}`)
  assert.deepEqual(seen.sort(), ['DYNAMIC update', 'returns delete', 'sale_items insert', 'sale_items update', 'sales update'])
  assert.deepEqual(scanner.scanText("const q = 'UPDATE ' + table + ' SET total_usd = 0'", KERNEL_TABLES), [{ table: 'DYNAMIC', verb: 'update' }])
  assert.deepEqual(scanner.scanText('const q = `UPDATE main."sales" SET total_usd = 0`', KERNEL_TABLES), [{ table: 'sales', verb: 'update' }])
})

// ---- BEHAVIOUR ------------------------------------------------------------------------------------------------------------------------------------------------
const directory = path.join(ROOT, 'migrations')
const db = new DatabaseSync(':memory:')
for (const f of fs.readdirSync(directory).filter((f) => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(directory, f), 'utf8').split('\r\n').join('\n'))
db.exec('PRAGMA foreign_keys = OFF')

// A row with every required column filled by its type, so a test names only what it cares about.
const columnsOf = (table) => db.prepare(`PRAGMA table_info(${table})`).all()
function insert(table, values) {
  const row = { ...values }
  for (const c of columnsOf(table)) {
    if (c.name in row || c.pk && c.type.toUpperCase() === 'INTEGER') continue
    if (c.notnull && c.dflt_value === null) row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : ''
  }
  const names = Object.keys(row)
  const info = db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...Object.values(row))
  return Number(info.lastInsertRowid)
}
const DAY1 = '2026-11-02', DAY2 = '2026-11-05', DAY3 = '2026-11-09'
const at = (day) => `${day} 03:00:00`
const ids = {}
function seed() {
  insert('branches', { name: 'LC Store' })
  for (const [key, day] of [['a', DAY1], ['b', DAY2], ['c', DAY3]]) {
    ids[`sale_${key}`] = insert('sales', { receipt_number: `R-${key}`, client_request_id: `req-${key}`, loyalty_accrual: 0, total_usd: 10, subtotal_usd: 10, branch_id: 1, created_at: at(day) })
    ids[`line_${key}`] = insert('sale_items', { sale_id: ids[`sale_${key}`], product_name: `P${key}`, quantity: 1, branch_id: 1 })
    ids[`ret_${key}`] = insert('returns', { sale_id: ids[`sale_${key}`], total_refund_usd: 1, status: 'completed', return_scope: 'customer', branch_id: 1 })
    ids[`retline_${key}`] = insert('return_items', { return_id: ids[`ret_${key}`], sale_item_id: ids[`line_${key}`], product_name: `P${key}`, quantity: 1 })
    ids[`fee_${key}`] = insert('fees', { sale_id: ids[`sale_${key}`], fee_type: 'delivery', amount_usd: 1, branch_id: 1, fee_date: day })
  }
}
seed()
const shape = (table) => columnsOf(table).map((c) => c.name)
// allocation tables: one row on each of sale a's line and return a's line
ids.alloc_a = insert('sale_item_batch_allocations', { sale_item_id: ids.line_a, batch_id: 1, branch_id: 1, quantity: 1 })
ids.retalloc_a = insert('return_item_batch_allocations', { return_item_id: ids.retline_a, sale_item_id: ids.line_a, batch_id: 1, branch_id: 1, quantity: 1 })
ids.amend_a = insert('sale_amendments', { sale_id: ids.sale_a, kind: 'delivery_fee_changed' })

const states = () => Object.fromEntries(db.prepare('SELECT business_date, state FROM sales_daily_totals').all().map((r) => [r.business_date, r.state]))
const dirtyDays = () => Object.entries(states()).filter(([, s]) => s !== 0).map(([d]) => d).sort()
const cleanAll = () => db.exec('UPDATE sales_daily_totals SET state = 0')
// One writer batch is one transaction (db.batch in D1): a savepoint gives the same all-or-nothing. isolated() undoes a whole case, so each starts from the seed.
const run = (sql) => { db.exec('SAVEPOINT batch'); try { db.exec(sql); db.exec('RELEASE batch') } catch (e) { db.exec('ROLLBACK TO batch'); db.exec('RELEASE batch'); throw e } }
const isolated = (fn) => { db.exec('SAVEPOINT iso'); try { return fn() } finally { db.exec('ROLLBACK TO iso'); db.exec('RELEASE iso') } }

// [id, (table, verb) pairs it proves, design group, sql, the days that must go dirty]
const MATRIX = [
  ['sales insert (POST /api/sales, imports, replacement sale, exchange)', [['sales', 'insert']], 'create', () => insert('sales', { receipt_number: 'R-new', client_request_id: 'req-new', loyalty_accrual: 0, total_usd: 1, subtotal_usd: 1, branch_id: 1, created_at: at('2026-11-12') }), ['2026-11-12']],
  ['sales insert, historical created_at (sales import)', [['sales', 'insert']], 'create', () => insert('sales', { receipt_number: 'R-old', client_request_id: 'req-old', loyalty_accrual: 0, total_usd: 1, subtotal_usd: 1, branch_id: 1, created_at: at('2025-03-04') }), ['2025-03-04']],
  ['sales insert, date-only created_at and NULL branch (stock-action import)', [['sales', 'insert']], 'create', () => insert('sales', { receipt_number: 'R-imp', client_request_id: 'req-imp', loyalty_accrual: 0, total_usd: 1, subtotal_usd: 1, created_at: '2025-04-05' }), ['2025-04-05']],
  ['sales upsert path (INSERT .. ON CONFLICT DO UPDATE fires the update trigger)', [['sales', 'insert'], ['sales', 'update']], 'create', () => run(`INSERT INTO sales(id,receipt_number,client_request_id,loyalty_accrual,total_usd,subtotal_usd,branch_id,created_at) VALUES(${ids.sale_b},'R-b','req-b',0,11,11,1,'${at(DAY2)}') ON CONFLICT(id) DO UPDATE SET total_usd = excluded.total_usd`), [DAY2]],
  ['sales update: status, cancel, settlement, bulk status, customer, amendments', [['sales', 'update']], 'edit', () => run(`UPDATE sales SET sale_status = 'cancelled' WHERE id = ${ids.sale_a}`), [DAY1]],
  ['sales update with an alias (payment-method rename over history)', [['sales', 'update']], 'edit', () => run(`UPDATE sales AS s SET payment_method = 'ABA' WHERE s.id = ${ids.sale_c}`), [DAY3]],
  ['sales update through a dynamic table (user rename, branch rename, cutover label fill)', [['sales', 'update']], 'edit', () => run(`UPDATE sales SET branch_name = 'LC Store' WHERE branch_id = 1`), [DAY1, DAY2, DAY3]],
  ['sales update that MOVES created_at (ops import-aug30-legacy-reports)', [['sales', 'update']], 'ops', () => run(`UPDATE sales SET created_at = '${at('2026-11-20')}' WHERE id = ${ids.sale_a}`), [DAY1, '2026-11-20']],
  ['sales delete (reset-data, factory reset)', [['sales', 'delete']], 'wholesale', () => run(`DELETE FROM sales WHERE id = ${ids.sale_c}`), [DAY3]],
  ['sale_items insert (add lines, exchange, stock-action import)', [['sale_items', 'insert']], 'create', () => insert('sale_items', { sale_id: ids.sale_b, product_name: 'extra', quantity: 1, branch_id: 1 }), [DAY2]],
  ['sale_items update (pricing, quantity, historical line, KHR snapshots, product rename)', [['sale_items', 'update']], 'edit', () => run(`UPDATE sale_items SET quantity = 3 WHERE id = ${ids.line_a}`), [DAY1]],
  ['sale_items update that moves a line to ANOTHER sale (merge reparent, undo of a merge)', [['sale_items', 'update']], 'edit', () => run(`UPDATE sale_items SET sale_id = ${ids.sale_c} WHERE id = ${ids.line_b}`), [DAY2, DAY3]],
  ['sale_items delete (line delete, undo of add-items)', [['sale_items', 'delete']], 'edit', () => run(`DELETE FROM sale_items WHERE id = ${ids.line_a}`), [DAY1]],
  ['sale_item_batch_allocations insert (sale, add lines)', [['sale_item_batch_allocations', 'insert']], 'create', () => insert('sale_item_batch_allocations', { sale_item_id: ids.line_b, batch_id: 1, branch_id: 1, quantity: 1 }), [DAY2]],
  ['sale_item_batch_allocations update (restock, transitions, undo)', [['sale_item_batch_allocations', 'update']], 'edit', () => run(`UPDATE sale_item_batch_allocations SET quantity = 2 WHERE id = ${ids.alloc_a}`), [DAY1]],
  ['sale_item_batch_allocations delete (amendment, add-items undo)', [['sale_item_batch_allocations', 'delete']], 'edit', () => run(`DELETE FROM sale_item_batch_allocations WHERE id = ${ids.alloc_a}`), [DAY1]],
  ['returns insert on an OLD sale: the sale\'s day goes dirty, the return\'s own date does not', [['returns', 'insert']], 'returns', () => insert('returns', { sale_id: ids.sale_a, total_refund_usd: 2, status: 'completed', return_scope: 'customer', branch_id: 1, created_at: at('2026-11-14') }), [DAY1]],
  ['returns insert with no sale (supplier return): nothing to mark', [['returns', 'insert']], 'returns', () => insert('returns', { total_refund_usd: 2, status: 'completed', return_scope: 'supplier', branch_id: 1 }), []],
  ['returns update (edit, cancel, restore, legacy conversion, reason rename, branch change)', [['returns', 'update']], 'returns', () => run(`UPDATE returns SET status = 'cancelled' WHERE id = ${ids.ret_b}`), [DAY2]],
  ['returns update that relinks a return to another sale (contact merge, relink)', [['returns', 'update']], 'returns', () => run(`UPDATE returns SET sale_id = ${ids.sale_c} WHERE id = ${ids.ret_a}`), [DAY1, DAY3]],
  ['returns delete (reset)', [['returns', 'delete']], 'wholesale', () => run(`DELETE FROM returns WHERE id = ${ids.ret_b}`), [DAY2]],
  ['return_items insert (customer return, exchange)', [['return_items', 'insert']], 'returns', () => insert('return_items', { return_id: ids.ret_b, sale_item_id: ids.line_b, product_name: 'x', quantity: 1 }), [DAY2]],
  ['return_items update (legacy conversion, product rename)', [['return_items', 'update']], 'returns', () => run(`UPDATE return_items SET quantity = 2 WHERE id = ${ids.retline_c}`), [DAY3]],
  ['return_items delete (return edit)', [['return_items', 'delete']], 'returns', () => run(`DELETE FROM return_items WHERE id = ${ids.retline_a}`), [DAY1]],
  ['return_item_batch_allocations insert (return restock)', [['return_item_batch_allocations', 'insert']], 'returns', () => insert('return_item_batch_allocations', { return_item_id: ids.retline_b, sale_item_id: ids.line_b, batch_id: 1, branch_id: 1, quantity: 1 }), [DAY2]],
  ['return_item_batch_allocations update (undo, product merge)', [['return_item_batch_allocations', 'update']], 'returns', () => run(`UPDATE return_item_batch_allocations SET quantity = 2 WHERE id = ${ids.retalloc_a}`), [DAY1]],
  ['return_item_batch_allocations delete (return edit)', [['return_item_batch_allocations', 'delete']], 'returns', () => run(`DELETE FROM return_item_batch_allocations WHERE id = ${ids.retalloc_a}`), [DAY1]],
  ['fees insert linked to a sale (delivery fee, cancel fee, bulk status)', [['fees', 'insert']], 'fees', () => insert('fees', { sale_id: ids.sale_b, fee_type: 'delivery', amount_usd: 2, branch_id: 1, fee_date: '2026-11-14' }), [DAY2]],
  ['fees insert with NO sale (an ordinary expense): nothing to mark', [['fees', 'insert']], 'fees', () => insert('fees', { fee_type: 'rent', amount_usd: 20, branch_id: 1, fee_date: '2026-11-14' }), []],
  ['fees update (edit, type rename, delivery relabel, contact merge)', [['fees', 'update']], 'fees', () => run(`UPDATE fees SET amount_usd = 3 WHERE id = ${ids.fee_c}`), [DAY3]],
  ['fees delete (delete, review apply, bulk status)', [['fees', 'delete']], 'fees', () => run(`DELETE FROM fees WHERE id = ${ids.fee_a}`), [DAY1]],
  ['sale_amendments insert (delivery fee, actual cost, delivery added, tax)', [['sale_amendments', 'insert']], 'edit', () => insert('sale_amendments', { sale_id: ids.sale_b, kind: 'delivery_fee_changed' }), [DAY2]],
  ['sale_payment_events insert (append-only; no Worker writer today)', [['sale_payment_events', 'insert']], 'edit', () => insert('sale_payment_events', { event_id: 'ev-1', sale_id: ids.sale_c, direction: 'in', origin: 'checkout', payment_method: 'Cash', payment_details: '[]', exchange_rate: 4100, received_at: at(DAY3) }), [DAY3]],
]

for (const [label, , , action, expected] of MATRIX) {
  check(`BEHAVIOUR ${label}: dirty days = ${expected.length ? expected.join(', ') : 'none'}`, () => isolated(() => {
    cleanAll()
    action()
    assert.deepEqual(dirtyDays(), [...expected].sort())
  }))
}

check('BEHAVIOUR sale_payment_events: update and delete abort (append-only), so no write can bypass the mark', () => isolated(() => {
  insert('sale_payment_events', { event_id: 'ev-2', sale_id: ids.sale_c, direction: 'in', origin: 'checkout', payment_method: 'Cash', payment_details: '[]', exchange_rate: 4100, received_at: at(DAY3) })
  assert.throws(() => db.exec(`UPDATE sale_payment_events SET sale_id = ${ids.sale_a}`), /./)
  assert.throws(() => db.exec('DELETE FROM sale_payment_events'), /./)
}))

check('BEHAVIOUR one atomic batch touching many sales (a bulk status change, a contact merge) marks every day it touches and no other', () => isolated(() => {
  cleanAll()
  run(`UPDATE sales SET sale_status = 'cancelled' WHERE id IN (${ids.sale_a}, ${ids.sale_b})`)
  assert.deepEqual(dirtyDays(), [DAY1, DAY2])
}))

check('BEHAVIOUR a rolled-back batch leaves no mark behind (the mark is inside the writer\'s own transaction)', () => isolated(() => {
  cleanAll()
  assert.throws(() => run(`UPDATE sales SET sale_status = 'cancelled' WHERE id = ${ids.sale_b}; INSERT INTO sales_daily_totals(business_date, state) VALUES ('${DAY2}', 1)`), /UNIQUE/)
  assert.deepEqual(dirtyDays(), [])
}))

check('MATRIX covers every (table, verb) the static list names for a real table, so no kind of write is listed without a proof', () => {
  const proven = new Set(MATRIX.flatMap(([, pairs]) => pairs.map(([table, verb]) => `${table} ${verb}`)))
  const named = new Set(Object.keys(LISTED).map((key) => key.split(' ').slice(1).join(' ')).filter((pair) => !pair.startsWith('DYNAMIC')))
  const missing = [...named].filter((pair) => !proven.has(pair))
  assert.deepEqual(missing, [], `listed write sites with no matrix case: ${missing.join(', ')}`)
})

check('the empty-string day and the same-day cases: a second write to a dirty day writes no extra row (the mark is an upsert on a state change only)', () => isolated(() => {
  cleanAll()
  const before = db.prepare('select total_changes() n').get().n
  run(`UPDATE sales SET sale_status = 'cancelled' WHERE id = ${ids.sale_b}`)
  const first = db.prepare('select total_changes() n').get().n - before
  const mid = db.prepare('select total_changes() n').get().n
  run(`UPDATE sales SET sale_status = 'completed' WHERE id = ${ids.sale_b}`)
  const second = db.prepare('select total_changes() n').get().n - mid
  assert.equal(first - second, 1, 'the first write of a clean day costs exactly one more table row than the second')
}))

console.log(`\n${passed} checks passed`)
