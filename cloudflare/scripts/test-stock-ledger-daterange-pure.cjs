// Equivalence + index-use lock for stockLedgerQuery.ts's date-range filter.
//
// The stock ledger (Products/Inventory movement history) filtered with
// `date(m.created_at) >= @start` / `date(m.created_at) <= @end`, wrapping the
// indexed column so idx_inventory_movements_created_pg went unused and every
// movement row (~21k in production) was scanned per filtered view. Replaced
// with the sargable `m.created_at >= @start` / `m.created_at < date(@end,
// '+1 day')`. The two MUST select the same rows -- a movement ledger that
// silently drops or adds a same-day row is a correctness bug. Proven against
// real SQLite across the boundary cases that break naive rewrites, plus an
// EXPLAIN check that the new form uses the index and the old does not.
//
// Run (from cloudflare/): node scripts/test-stock-ledger-daterange-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Database = require('better-sqlite3')

// Old vs new filters, each split into the two independent (start / end) clauses
// exactly as the source builds them.
const OLD = { start: 'date(m.created_at) >= @startDate', end: 'date(m.created_at) <= @endDate' }
const NEW = { start: 'm.created_at >= @startDate', end: "m.created_at < date(@endDate, '+1 day')" }

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, created_at TEXT);
  CREATE INDEX idx_inventory_movements_created_pg ON inventory_movements (created_at DESC, id DESC);
`)

const rows = [
  [1, '2026-07-31 23:59:59', false],
  [2, '2026-08-01 00:00:00', true],
  [3, '2026-08-15 12:30:00', true],
  [4, '2026-08-31 23:59:59', true],
  [5, '2026-08-31T23:59:59.999Z', true],
  [6, '2026-09-01 00:00:00', false],
  [7, '2026-09-01T00:00:00Z', false],
  [8, null, false],
]
const insert = db.prepare('INSERT INTO inventory_movements (id, created_at) VALUES (?, ?)')
for (const [id, ts] of rows) insert.run(id, ts)

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

function idsFor(filter, startDate, endDate) {
  const clauses = []
  const params = {}
  if (startDate != null) { clauses.push(filter.start); params.startDate = startDate }
  if (endDate != null) { clauses.push(filter.end); params.endDate = endDate }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return db.prepare(`SELECT id FROM inventory_movements m ${where} ORDER BY id`).all(params).map((r) => r.id)
}

// Both bounds present.
check('full range: new form matches old form', JSON.stringify(idsFor(OLD, '2026-08-01', '2026-08-31')) === JSON.stringify(idsFor(NEW, '2026-08-01', '2026-08-31')))
check('full range: the expected in-range ids are selected', JSON.stringify(idsFor(NEW, '2026-08-01', '2026-08-31')) === JSON.stringify([2, 3, 4, 5]))

// Single day (start === end) -- the tightest boundary.
check('single-day: new form matches old form', JSON.stringify(idsFor(OLD, '2026-08-31', '2026-08-31')) === JSON.stringify(idsFor(NEW, '2026-08-31', '2026-08-31')))
check('single-day: only the end-day rows (4, 5) are selected', JSON.stringify(idsFor(NEW, '2026-08-31', '2026-08-31')) === JSON.stringify([4, 5]))

// Only a start bound (open-ended). Only an end bound. No bound.
check('start-only: new matches old', JSON.stringify(idsFor(OLD, '2026-08-01', null)) === JSON.stringify(idsFor(NEW, '2026-08-01', null)))
check('end-only: new matches old', JSON.stringify(idsFor(OLD, null, '2026-08-31')) === JSON.stringify(idsFor(NEW, null, '2026-08-31')))
check('no bounds: all rows (including NULL created_at) returned by both', JSON.stringify(idsFor(OLD, null, null)) === JSON.stringify(idsFor(NEW, null, null)))

// Index use: seed enough rows that the planner's choice is real.
{
  const bulk = db.prepare('INSERT INTO inventory_movements (id, created_at) VALUES (?, ?)')
  db.transaction(() => { for (let i = 0; i < 4000; i++) bulk.run(1000 + i, `2026-05-${String((i % 28) + 1).padStart(2, '0')} 10:00:00`) })()
  db.exec('ANALYZE')
  const usesIndex = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all({ startDate: '2026-08-01', endDate: '2026-08-31' })
    .some((r) => /USING (COVERING )?INDEX idx_inventory_movements_created_pg/.test(String(r.detail || '')))
  check('new sargable form uses idx_inventory_movements_created_pg',
    usesIndex(`SELECT id FROM inventory_movements m WHERE ${NEW.start} AND ${NEW.end}`))
  check('old date() form does NOT use the index (full scan)',
    !usesIndex(`SELECT id FROM inventory_movements m WHERE ${OLD.start} AND ${OLD.end}`))
}

// Source lock.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'stockLedgerQuery.ts'), 'utf8')
  check('stockLedgerQuery.ts uses the sargable created_at range', /m\.created_at >= @startDate/.test(src) && /m\.created_at < date\(@endDate, '\+1 day'\)/.test(src))
  check('stockLedgerQuery.ts no longer date()-wraps created_at in the filter', !/date\(m\.created_at\) >= @startDate/.test(src))
}

console.log(`\nALL ${passed} CHECKS PASSED`)
