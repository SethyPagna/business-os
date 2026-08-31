// Equivalence + index-use lock for the GET /api/inventory/movements date filter.
//
// The movements list filtered with `date(created_at) >= date(@start)` /
// `date(created_at) <= date(@end)`, wrapping the indexed column so
// idx_inventory_movements_created_pg went unused. Replaced with
// `created_at >= date(@start)` / `created_at < date(@end,'+1 day')` -- date()
// kept on the PARAM only, so the column is unwrapped (sargable) while a
// MALFORMED date param still yields NULL and excludes everything, exactly as
// the old form did (this route does not pre-validate the date string). Proven
// against real SQLite, including malformed inputs and the index-use flip.
//
// Run (from cloudflare/): node scripts/test-inventory-movements-daterange-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Database = require('better-sqlite3')

const OLD = { start: 'date(created_at) >= date(@startDate)', end: 'date(created_at) <= date(@endDate)' }
const NEW = { start: 'created_at >= date(@startDate)', end: "created_at < date(@endDate, '+1 day')" }

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE inventory_movements (id INTEGER PRIMARY KEY, created_at TEXT);
  CREATE INDEX idx_inventory_movements_created_pg ON inventory_movements (created_at DESC, id DESC);
`)
const seedRows = [
  [1, '2026-07-31 23:59:59'], [2, '2026-08-01 00:00:00'], [3, '2026-08-15 12:30:00'],
  [4, '2026-08-31 23:59:59'], [5, '2026-08-31T23:59:59.999Z'], [6, '2026-09-01 00:00:00'],
  [7, '2026-09-01T00:00:00Z'], [8, null],
]
const insert = db.prepare('INSERT INTO inventory_movements (id, created_at) VALUES (?, ?)')
for (const [id, ts] of seedRows) insert.run(id, ts)

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

function idsFor(filter, startDate, endDate) {
  const clauses = []; const params = {}
  if (startDate != null) { clauses.push(filter.start); params.startDate = startDate }
  if (endDate != null) { clauses.push(filter.end); params.endDate = endDate }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return db.prepare(`SELECT id FROM inventory_movements ${where} ORDER BY id`).all(params).map((r) => r.id)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

check('full range: new matches old', same(idsFor(OLD, '2026-08-01', '2026-08-31'), idsFor(NEW, '2026-08-01', '2026-08-31')))
check('full range: expected ids selected', same(idsFor(NEW, '2026-08-01', '2026-08-31'), [2, 3, 4, 5]))
check('single-day: new matches old', same(idsFor(OLD, '2026-08-31', '2026-08-31'), idsFor(NEW, '2026-08-31', '2026-08-31')))
check('single-day: only end-day rows (4,5)', same(idsFor(NEW, '2026-08-31', '2026-08-31'), [4, 5]))
check('start-only: new matches old', same(idsFor(OLD, '2026-08-01', null), idsFor(NEW, '2026-08-01', null)))
check('end-only: new matches old', same(idsFor(OLD, null, '2026-08-31'), idsFor(NEW, null, '2026-08-31')))

// The important edge: a MALFORMED date param must behave identically (both
// exclude everything, because date('garbage') is NULL).
check('malformed start: new matches old (both exclude all)', same(idsFor(OLD, 'not-a-date', null), idsFor(NEW, 'not-a-date', null)))
check('malformed start excludes all', idsFor(NEW, 'not-a-date', null).length === 0)
check('malformed end: new matches old', same(idsFor(OLD, null, '2026-99-99'), idsFor(NEW, null, '2026-99-99')))

// Index use.
{
  const bulk = db.prepare('INSERT INTO inventory_movements (id, created_at) VALUES (?, ?)')
  db.transaction(() => { for (let i = 0; i < 4000; i++) bulk.run(1000 + i, `2026-05-${String((i % 28) + 1).padStart(2, '0')} 10:00:00`) })()
  db.exec('ANALYZE')
  const usesIndex = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all({ startDate: '2026-08-01', endDate: '2026-08-31' })
    .some((r) => /USING (COVERING )?INDEX idx_inventory_movements_created_pg/.test(String(r.detail || '')))
  check('new form uses idx_inventory_movements_created_pg',
    usesIndex(`SELECT id FROM inventory_movements WHERE ${NEW.start} AND ${NEW.end}`))
  check('old form does NOT use the index',
    !usesIndex(`SELECT id FROM inventory_movements WHERE ${OLD.start} AND ${OLD.end}`))
}

// Source lock.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'inventory.ts'), 'utf8')
  check('inventory.ts /movements uses the sargable form', /where\.push\('created_at >= date\(@startDate\)'\)/.test(src) && /where\.push\("created_at < date\(@endDate, '\+1 day'\)"\)/.test(src))
  check('inventory.ts /movements no longer date()-wraps the column', !/where\.push\('date\(created_at\) >= date\(@startDate\)'\)/.test(src))
}

console.log(`\nALL ${passed} CHECKS PASSED`)
