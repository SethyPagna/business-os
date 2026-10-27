'use strict'
// GET /api/notifications/summary, sales section: the Not Paid and delivery queues.
//
// The queues used to be `WHERE <notPaidSaleSql | deliveryPendingSaleSql> ORDER BY created_at DESC LIMIT 50`.
// Those predicates are ORs across columns, and once the database has ANALYZE statistics (production does)
// SQLite answers them by walking idx_sales_created_pg and testing every sale until it has 50 -- the whole
// table when fewer than 50 match: 15.8k rows per queue, about 32k rows of every 56k-row bell poll. The new
// form is one ordered index seek per OR term. This file pins (1) the same ids in the same order as the
// predicate form over every status combination, ties and short and long queues included, and (2) that, with
// statistics, no queue scans sales. The old form is restated from salesStatus.ts, so a predicate change
// shows up as red here.
//
// Run: node scripts/test-notifications-sales-queues-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const modules = new Map()
const overrides = {
  '../lib/db': { getDb: () => { throw new Error('unused') } },
  '../lib/auth': { requireAuth: async (_c, next) => next() },
}
function load(rel) {
  if (modules.has(rel)) return modules.get(rel).exports
  const output = ts.transpileModule(fs.readFileSync(path.join(SRC, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: path.join(SRC, rel),
  }).outputText
  const mod = { exports: {} }
  modules.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}
const { AWAITING_PAYMENT_SQL, AWAITING_DELIVERY_SQL } = load('routes/notifications.ts')
const { notPaidSaleSql, deliveryPendingSaleSql } = load('lib/salesStatus.ts')

// The removed form, with the id tie-break the index walk always gave it.
const OLD_PAYMENT = `SELECT id, receipt_number, total_usd FROM sales WHERE ${notPaidSaleSql('sales')} ORDER BY created_at DESC, id DESC LIMIT 50`
const OLD_DELIVERY = `SELECT id, receipt_number, total_usd FROM sales WHERE ${deliveryPendingSaleSql('sales')} ORDER BY created_at DESC, id DESC LIMIT 50`

const COLUMNS = '(receipt_number, created_at, sale_status, status_before_return, delivery_pending, total_usd)'
const raw = openDb(loadAll())
raw.db.limits.exprDepth = 100
const statuses = ['completed', 'awaiting_payment', 'awaiting_delivery', 'partial_return', 'returned', 'cancelled', null, '']
const before = [null, 'awaiting_payment', 'awaiting_delivery', 'completed']
const pending = [0, 1]
const insert = raw.db.prepare(`INSERT INTO sales ${COLUMNS} VALUES (?, ?, ?, ?, ?, ?)`)
let n = 0
for (let copy = 0; copy < 8; copy += 1) {
  for (const status of statuses) for (const prior of before) for (const flag of pending) {
    n += 1
    // every 7th row shares its timestamp with the one before it: ties must come back in id order
    const second = n % 7 === 0 ? n - 1 : n
    insert.run(`R${n}`, `2026-10-${String(1 + (second % 27)).padStart(2, '0')} ${String(second % 24).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}:00`, status, prior, flag, 1 + (n % 9))
  }
}
const idsOf = (db, sql) => db.prepare(sql).all().map((row) => row.id)

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

check('long queues (64 status combinations x 8): same ids in the same order as the predicate form', () => {
  assert.equal(raw.db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE ${notPaidSaleSql('sales')}`).get().n > 50, true, 'fixture: payment queue overflows 50')
  assert.equal(raw.db.prepare(`SELECT COUNT(*) AS n FROM sales WHERE ${deliveryPendingSaleSql('sales')}`).get().n > 50, true, 'fixture: delivery queue overflows 50')
  assert.deepEqual(idsOf(raw.db, AWAITING_PAYMENT_SQL), idsOf(raw.db, OLD_PAYMENT))
  assert.deepEqual(idsOf(raw.db, AWAITING_DELIVERY_SQL), idsOf(raw.db, OLD_DELIVERY))
  assert.equal(idsOf(raw.db, AWAITING_PAYMENT_SQL).length, 50)
})
check('rows carry exactly the columns the section reads', () => {
  const [row] = raw.db.prepare(AWAITING_PAYMENT_SQL).all()
  assert.deepEqual(Object.keys(row), ['id', 'receipt_number', 'total_usd'])
})

// Short queues among many sales that match nothing
const small = openDb(loadAll())
small.db.limits.exprDepth = 100
const put = small.db.prepare(`INSERT INTO sales ${COLUMNS} VALUES (?, ?, ?, ?, ?, 5)`)
for (let i = 0; i < 2000; i += 1) put.run(`C${i}`, `2026-09-${String(1 + (i % 27)).padStart(2, '0')} 10:00:${String(i % 60).padStart(2, '0')}`, 'completed', null, 0)
const shortRows = [
  ['awaiting_payment', null, 0], ['returned', 'awaiting_payment', 0], ['partial_return', 'awaiting_payment', 0], ['partial_return', 'completed', 0],
  ['awaiting_delivery', null, 0], ['completed', null, 1], ['cancelled', null, 1], ['awaiting_delivery', null, 1], ['returned', 'awaiting_delivery', 0],
]
shortRows.forEach(([status, prior, flag], i) => put.run(`S${i}`, `2026-10-0${1 + i} 09:00:00`, status, prior, flag))
check('short queues: same ids; a sale both delivery-pending and awaiting_delivery is listed once; cancelled is left out', () => {
  assert.deepEqual(idsOf(small.db, AWAITING_PAYMENT_SQL), idsOf(small.db, OLD_PAYMENT))
  assert.deepEqual(idsOf(small.db, AWAITING_DELIVERY_SQL), idsOf(small.db, OLD_DELIVERY))
  assert.equal(idsOf(small.db, AWAITING_PAYMENT_SQL).length, 3)
  assert.equal(idsOf(small.db, AWAITING_DELIVERY_SQL).length, 4)
})

// The plan, with statistics: production has them, a fresh database does not, which is why this went unseen.
small.db.exec('ANALYZE')
const plan = (sql) => small.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => row.detail)
const scansSales = (sql) => plan(sql).some((detail) => /^SCAN sales/.test(detail))
check('control: with statistics the predicate form scans the whole sales table', () => {
  assert.ok(scansSales(OLD_PAYMENT), plan(OLD_PAYMENT).join(' | '))
  assert.ok(scansSales(OLD_DELIVERY), plan(OLD_DELIVERY).join(' | '))
})
check('with statistics neither queue scans sales: every term is an index seek', () => {
  for (const sql of [AWAITING_PAYMENT_SQL, AWAITING_DELIVERY_SQL]) {
    assert.ok(!scansSales(sql), plan(sql).join(' | '))
    assert.ok(plan(sql).filter((detail) => /^SEARCH sales USING INDEX/.test(detail)).length >= 2, plan(sql).join(' | '))
  }
})
console.log(`${passed} checks passed`)
