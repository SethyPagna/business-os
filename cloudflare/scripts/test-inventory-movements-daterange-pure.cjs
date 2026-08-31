// Local-day (UTC+7) bucketing + format-robustness + index-use lock for
// GET /api/inventory/movements.
//
// The movements list is filtered by the stored-UTC created_at, but the business
// is a single fixed timezone (Asia/Phnom_Penh, UTC+7, no DST), so the movement's
// calendar day must be taken in UTC+7 -- a movement at 00:30 local (17:30 UTC the
// previous day) must not land on the previous day (user directive Sep 1 2026,
// "all Cambodia"). inventory_movements.created_at is a MIX of shapes (space and
// ISO 'T'/'Z'), so the day is taken through date(created_at,'+7 hours')
// (shape-agnostic) AND-ed with a sargable date-only pre-filter that keeps
// idx_inventory_movements_created_pg usable. A MALFORMED date param still
// excludes everything: the sargable term's date(param,...) is NULL and
// `created_at < NULL`/`>= NULL` is NULL (falsy), so no row leaks even though this
// route does not pre-validate the date string. Proven against real SQLite,
// including both shapes, malformed inputs, and the index-use flip.
//
// Run (from cloudflare/): node scripts/test-inventory-movements-daterange-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Database = require('better-sqlite3')

// The UTC-date form the fix originally REPLACED, the OLD FRAGILE
// shifted-datetime-bound form (drops ISO rows), and the shipped HYBRID local
// (UTC+7) form -- each split into the start/end clauses exactly as inventory.ts
// builds them via localDateAtOrAfter/localDateAtOrBefore.
const OLD = { start: 'date(created_at) >= date(@startDate)', end: 'date(created_at) <= date(@endDate)' }
const FRAGILE = { start: "created_at >= datetime(@startDate, '-7 hours')", end: "created_at < datetime(date(@endDate, '+1 day'), '-7 hours')" }
const NEW = {
  start: "date(created_at, '+7 hours') >= @startDate AND created_at >= date(@startDate, '-1 day')",
  end: "date(created_at, '+7 hours') <= @endDate AND created_at < date(@endDate, '+1 day')",
}

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, created_at TEXT);
  CREATE INDEX idx_inventory_movements_created_pg ON inventory_movements (created_at DESC, id DESC);
`)
// id : created_at (UTC) : in LOCAL [2026-08-01, 2026-08-31]?
// Rows 1-8 space format; rows 20-23 ISO 'T'/'Z' at the same edge instants.
const seedRows = [
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
for (const [id, ts] of seedRows) insert.run(id, ts)

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function idsFor(filter, startDate, endDate) {
  const clauses = []; const params = {}
  if (startDate != null) { clauses.push(filter.start); params.startDate = startDate }
  if (endDate != null) { clauses.push(filter.end); params.endDate = endDate }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return db.prepare(`SELECT id FROM inventory_movements ${where} ORDER BY id`).all(params).map((r) => r.id)
}

check('full range: selects exactly the local-Aug rows (space 2,3,4,5 + ISO 20,21)', same(idsFor(NEW, '2026-08-01', '2026-08-31'), [2, 3, 4, 5, 20, 21]))
check('full range: local form differs from the old UTC form', !same(idsFor(NEW, '2026-08-01', '2026-08-31'), idsFor(OLD, '2026-08-01', '2026-08-31')))
check('full range: old UTC form misfiled local-Sep-1 in (6) and dropped local-Aug-1 (2)',
  idsFor(OLD, '2026-08-01', '2026-08-31').includes(6) && !idsFor(OLD, '2026-08-01', '2026-08-31').includes(2))

// Format robustness: the ISO end-edge row the OLD fragile form dropped.
{
  const local = idsFor(NEW, '2026-08-01', '2026-08-31')
  const fragile = idsFor(FRAGILE, '2026-08-01', '2026-08-31')
  check('hybrid INCLUDES ISO end-edge row 21; OLD fragile form DROPPED it (data-loss fixed)',
    local.includes(21) && !fragile.includes(21))
}

check('single local day: only local-Aug-31 rows (space 4,5 + ISO 21)', same(idsFor(NEW, '2026-08-31', '2026-08-31'), [4, 5, 21]))
check('start-only: everything from local Aug 1 00:00 onward', same(idsFor(NEW, '2026-08-01', null), [2, 3, 4, 5, 6, 7, 20, 21, 22]))
check('end-only: everything before local Sep 1 00:00', same(idsFor(NEW, null, '2026-08-31'), [1, 2, 3, 4, 5, 20, 21, 23]))

// A MALFORMED date param must still exclude everything: the sargable date-only
// term goes NULL, so the AND is NULL (falsy) for every row.
check('malformed start excludes all', idsFor(NEW, 'not-a-date', null).length === 0)
check('malformed start: local matches old (both exclude all)', same(idsFor(OLD, 'not-a-date', null), idsFor(NEW, 'not-a-date', null)))
check('malformed end excludes all (redundant sargable term is NULL, not a false include)', idsFor(NEW, null, '2026-99-99').length === 0)

// Index use.
{
  const bulk = db.prepare('INSERT INTO inventory_movements (id, created_at) VALUES (?, ?)')
  db.transaction(() => { for (let i = 0; i < 4000; i++) bulk.run(1000 + i, `2026-05-${String((i % 28) + 1).padStart(2, '0')} 10:00:00`) })()
  db.exec('ANALYZE')
  const usesIndex = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all({ startDate: '2026-08-01', endDate: '2026-08-31' })
    .some((r) => /USING (COVERING )?INDEX idx_inventory_movements_created_pg/.test(String(r.detail || '')))
  check('hybrid form uses idx_inventory_movements_created_pg via its sargable date-only pre-filter',
    usesIndex(`SELECT id FROM inventory_movements WHERE ${NEW.start} AND ${NEW.end}`))
  check('old form does NOT use the index',
    !usesIndex(`SELECT id FROM inventory_movements WHERE ${OLD.start} AND ${OLD.end}`))
}

// Source lock.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'inventory.ts'), 'utf8')
  check('inventory.ts /movements buckets created_at via the shared at-or-after/at-or-before helpers',
    /where\.push\(localDateAtOrAfter\('created_at'\)\)/.test(src) && /where\.push\(localDateAtOrBefore\('created_at'\)\)/.test(src))
  check('inventory.ts /movements no longer compares created_at against the raw UTC date bounds',
    !/where\.push\('created_at >= date\(@startDate\)'\)/.test(src) && !/date\(created_at\) >= date\(@startDate\)/.test(src) && !/localDayLowerBound/.test(src))
}

console.log(`\nALL ${passed} CHECKS PASSED`)
