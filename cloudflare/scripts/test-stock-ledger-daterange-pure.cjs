// Local-day (UTC+7) bucketing + format-robustness + index-use lock for
// stockLedgerQuery.ts's date-range filter.
//
// The stock ledger (Products/Inventory movement history) is filtered by the
// stored-UTC created_at, but the business is a single fixed timezone
// (Asia/Phnom_Penh, UTC+7, no DST), so "which day did this movement happen on"
// must be taken in UTC+7 -- otherwise a movement at 00:30 local (17:30 UTC the
// previous day) lands on the previous calendar day (user directive Sep 1 2026,
// "all Cambodia"). inventory_movements.created_at is a MIX of shapes (verified
// against prod D1: mostly space "YYYY-MM-DD HH:MM:SS", some ISO
// "YYYY-MM-DDTHH:MM:SS.sssZ"), and a raw string compare against a datetime bound
// MISFILES the ISO rows (at position 10 'T' sorts after ' '). So the day is taken
// through date(m.created_at,'+7 hours') -- shape-agnostic -- AND-ed with a
// sargable date-only pre-filter on the raw column so
// idx_inventory_movements_created_pg stays usable across ~21k rows. Proven
// against real SQLite over the start/end local-day edges, single-day,
// start-only/end-only/no-bound, both shapes, plus an EXPLAIN index-use check.
//
// Run (from cloudflare/): node scripts/test-stock-ledger-daterange-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Database = require('better-sqlite3')

// The UTC-date form the fix originally REPLACED (kept only to prove behavior
// changed), the OLD FRAGILE shifted-datetime-bound form (drops ISO rows), and the
// shipped HYBRID local (UTC+7) form -- each split into the start/end clauses
// exactly as the source builds them via localDateAtOrAfter/localDateAtOrBefore.
const OLD = { start: 'date(m.created_at) >= @startDate', end: 'date(m.created_at) <= @endDate' }
const FRAGILE = { start: "m.created_at >= datetime(@startDate, '-7 hours')", end: "m.created_at < datetime(date(@endDate, '+1 day'), '-7 hours')" }
const NEW = {
  start: "date(m.created_at, '+7 hours') >= @startDate AND m.created_at >= date(@startDate, '-1 day')",
  end: "date(m.created_at, '+7 hours') <= @endDate AND m.created_at < date(@endDate, '+1 day')",
}

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, created_at TEXT);
  CREATE INDEX idx_inventory_movements_created_pg ON inventory_movements (created_at DESC, id DESC);
`)

// id : created_at (UTC) : in LOCAL [2026-08-01, 2026-08-31]?
// Local Aug 1 begins 2026-07-31 17:00 UTC; local Sep 1 begins 2026-08-31 17:00 UTC.
// Rows 1-8 space format; rows 20-23 ISO 'T'/'Z' at the same edge instants.
const rows = [
  [1, '2026-07-31 16:59:59'], // local Jul 31 23:59:59 -- out
  [2, '2026-07-31 17:00:00'], // local Aug 1 00:00:00 -- in (start edge)
  [3, '2026-08-15 12:30:00'], // local Aug 15 19:30 -- in
  [4, '2026-08-30 17:00:00'], // local Aug 31 00:00:00 -- in (end-day start)
  [5, '2026-08-31 16:59:59'], // local Aug 31 23:59:59 -- in (end edge)
  [6, '2026-08-31 17:00:00'], // local Sep 1 00:00:00 -- out
  [7, '2026-09-01 00:00:00'], // local Sep 1 07:00 -- out
  [8, null],                   // NULL created_at -- out
  [20, '2026-07-31T17:00:00.000Z'], // ISO local Aug 1 00:00:00 -- in (start edge)
  [21, '2026-08-31T16:59:59.000Z'], // ISO local Aug 31 23:59:59 -- in (END edge, FRAGILE drops)
  [22, '2026-08-31T17:00:00.000Z'], // ISO local Sep 1 00:00:00 -- out
  [23, '2026-07-31T16:59:59.000Z'], // ISO local Jul 31 23:59:59 -- out
]
const insert = db.prepare('INSERT INTO inventory_movements (id, created_at) VALUES (?, ?)')
for (const [id, ts] of rows) insert.run(id, ts)

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function idsFor(filter, startDate, endDate) {
  const clauses = []
  const params = {}
  if (startDate != null) { clauses.push(filter.start); params.startDate = startDate }
  if (endDate != null) { clauses.push(filter.end); params.endDate = endDate }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return db.prepare(`SELECT id FROM inventory_movements m ${where} ORDER BY id`).all(params).map((r) => r.id)
}

// Both bounds present, bucketed in UTC+7, across both shapes.
check('full range: selects exactly the local-Aug rows (space 2,3,4,5 + ISO 20,21)', eq(idsFor(NEW, '2026-08-01', '2026-08-31'), [2, 3, 4, 5, 20, 21]))
check('full range: local form differs from the old UTC form', !eq(idsFor(NEW, '2026-08-01', '2026-08-31'), idsFor(OLD, '2026-08-01', '2026-08-31')))
check('full range: old UTC form misfiled local-Sep-1 in (6) and dropped local-Aug-1 (2)',
  idsFor(OLD, '2026-08-01', '2026-08-31').includes(6) && !idsFor(OLD, '2026-08-01', '2026-08-31').includes(2))

// Format robustness: the ISO end-edge row the OLD fragile form dropped.
{
  const local = idsFor(NEW, '2026-08-01', '2026-08-31')
  const fragile = idsFor(FRAGILE, '2026-08-01', '2026-08-31')
  check('hybrid INCLUDES ISO end-edge row 21; OLD fragile form DROPPED it (data-loss fixed)',
    local.includes(21) && !fragile.includes(21))
  check('hybrid and OLD-fragile agree on every space-format row (only ISO rows differed)',
    eq(local.filter((id) => id < 20), fragile.filter((id) => id < 20)))
}

// Single local day (start === end) -- the tightest boundary.
check('single-day: only the local-Aug-31 rows (space 4,5 + ISO 21) are selected', eq(idsFor(NEW, '2026-08-31', '2026-08-31'), [4, 5, 21]))

// Only a start bound (open-ended). Only an end bound. No bound.
check('start-only: local start admits everything from local Aug 1 00:00 onward', eq(idsFor(NEW, '2026-08-01', null), [2, 3, 4, 5, 6, 7, 20, 21, 22]))
check('end-only: local end admits everything before local Sep 1 00:00', eq(idsFor(NEW, null, '2026-08-31'), [1, 2, 3, 4, 5, 20, 21, 23]))
check('no bounds: all rows (including NULL created_at) returned', eq(idsFor(NEW, null, null), [1, 2, 3, 4, 5, 6, 7, 8, 20, 21, 22, 23]))

// Index use: seed enough rows that the planner's choice is real.
{
  const bulk = db.prepare('INSERT INTO inventory_movements (id, created_at) VALUES (?, ?)')
  db.transaction(() => { for (let i = 0; i < 4000; i++) bulk.run(1000 + i, `2026-05-${String((i % 28) + 1).padStart(2, '0')} 10:00:00`) })()
  db.exec('ANALYZE')
  const usesIndex = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all({ startDate: '2026-08-01', endDate: '2026-08-31' })
    .some((r) => /USING (COVERING )?INDEX idx_inventory_movements_created_pg/.test(String(r.detail || '')))
  check('hybrid form uses idx_inventory_movements_created_pg via its sargable date-only pre-filter',
    usesIndex(`SELECT id FROM inventory_movements m WHERE ${NEW.start} AND ${NEW.end}`))
  check('old date() form does NOT use the index (full scan)',
    !usesIndex(`SELECT id FROM inventory_movements m WHERE ${OLD.start} AND ${OLD.end}`))
}

// Source lock.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'stockLedgerQuery.ts'), 'utf8')
  check('stockLedgerQuery.ts buckets created_at via the shared at-or-after/at-or-before helpers',
    /localDateAtOrAfter\('m\.created_at'\)/.test(src) && /localDateAtOrBefore\('m\.created_at'\)/.test(src))
  check('stockLedgerQuery.ts no longer compares created_at against the raw UTC bounds',
    !/date\(m\.created_at\) >= @startDate/.test(src) && !/m\.created_at >= @startDate\b/.test(src) && !/localDayLowerBound/.test(src))
}

console.log(`\nALL ${passed} CHECKS PASSED`)
