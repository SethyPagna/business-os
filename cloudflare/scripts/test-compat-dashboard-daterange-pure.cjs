// Equivalence + index-use lock for the dashboard/analytics date filters in
// compat.ts (the Dashboard + Analytics endpoints).
//
// Ten queries over sales / returns filtered with date(created_at) wrapped
// around the indexed column -- both a same-day equality (`= date(@today)`) and
// a range (`BETWEEN date(@start) AND date(@end)`) -- so idx_sales_created_pg /
// idx_returns_created_pg went unused and every sale/return was scanned on every
// dashboard load. Replaced with the sargable forms, date() kept on the PARAM
// only so a malformed date param still excludes everything exactly as before.
// The dashboard's numbers are high-visibility, so this proves the new SQL
// returns the identical row set to the old, for both shapes, incl. boundaries
// and malformed inputs, and that the index is now used.
//
// Run (from cloudflare/): node scripts/test-compat-dashboard-daterange-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Database = require('better-sqlite3')

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE sales (id INTEGER PRIMARY KEY, created_at TEXT);
  CREATE INDEX idx_sales_created_pg ON sales (created_at DESC, id DESC);
`)
const seedRows = [
  [1, '2026-07-31 23:59:59'], [2, '2026-08-01 00:00:00'], [3, '2026-08-15 12:30:00'],
  [4, '2026-08-31 23:59:59'], [5, '2026-08-31T23:59:59.999Z'], [6, '2026-09-01 00:00:00'],
  [7, '2026-09-01T00:00:00Z'], [8, null],
]
const insert = db.prepare('INSERT INTO sales (id, created_at) VALUES (?, ?)')
for (const [id, ts] of seedRows) insert.run(id, ts)

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }
const ids = (where, params) => db.prepare(`SELECT id FROM sales WHERE ${where} ORDER BY id`).all(params).map((r) => r.id)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ---- Shape A: same-day equality ----
const OLD_EQ = 'date(created_at) = date(@today)'
const NEW_EQ = "created_at >= date(@today) AND created_at < date(@today, '+1 day')"
check('equality: new matches old for a normal day', same(ids(OLD_EQ, { today: '2026-08-31' }), ids(NEW_EQ, { today: '2026-08-31' })))
check('equality: only that day\'s rows (4,5)', same(ids(NEW_EQ, { today: '2026-08-31' }), [4, 5]))
check('equality: new matches old for a day with no rows', same(ids(OLD_EQ, { today: '2026-06-15' }), ids(NEW_EQ, { today: '2026-06-15' })))
check('equality: malformed @today behaves identically (both exclude all)', same(ids(OLD_EQ, { today: 'nope' }), ids(NEW_EQ, { today: 'nope' })) && ids(NEW_EQ, { today: 'nope' }).length === 0)

// ---- Shape B: range ----
const OLD_BT = 'date(created_at) BETWEEN date(@startDate) AND date(@endDate)'
const NEW_BT = "created_at >= date(@startDate) AND created_at < date(@endDate, '+1 day')"
check('range: new matches old (full month)', same(ids(OLD_BT, { startDate: '2026-08-01', endDate: '2026-08-31' }), ids(NEW_BT, { startDate: '2026-08-01', endDate: '2026-08-31' })))
check('range: expected ids (2,3,4,5)', same(ids(NEW_BT, { startDate: '2026-08-01', endDate: '2026-08-31' }), [2, 3, 4, 5]))
check('range: single-day new matches old', same(ids(OLD_BT, { startDate: '2026-08-31', endDate: '2026-08-31' }), ids(NEW_BT, { startDate: '2026-08-31', endDate: '2026-08-31' })))
check('range: malformed dates behave identically', same(ids(OLD_BT, { startDate: 'x', endDate: 'y' }), ids(NEW_BT, { startDate: 'x', endDate: 'y' })))

// ---- Index use ----
{
  const bulk = db.prepare('INSERT INTO sales (id, created_at) VALUES (?, ?)')
  db.transaction(() => { for (let i = 0; i < 4000; i++) bulk.run(1000 + i, `2026-05-${String((i % 28) + 1).padStart(2, '0')} 10:00:00`) })()
  db.exec('ANALYZE')
  const usesIndex = (where, params) => db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM sales WHERE ${where}`).all(params)
    .some((r) => /USING (COVERING )?INDEX idx_sales_created_pg/.test(String(r.detail || '')))
  check('range: new form uses idx_sales_created_pg', usesIndex(NEW_BT, { startDate: '2026-08-01', endDate: '2026-08-31' }))
  check('range: old form does NOT use the index', !usesIndex(OLD_BT, { startDate: '2026-08-01', endDate: '2026-08-31' }))
  check('equality: new form uses idx_sales_created_pg', usesIndex(NEW_EQ, { today: '2026-05-10' }))
  check('equality: old form does NOT use the index', !usesIndex(OLD_EQ, { today: '2026-05-10' }))
}

// ---- Source lock ----
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'compat.ts'), 'utf8')
  check('compat.ts has no remaining date()-wrapped created_at filter', !/date\(s?\.?created_at\) (BETWEEN|= date\(@today\))/.test(src))
  check('compat.ts uses the sargable range form', /created_at >= date\(@startDate\) AND created_at < date\(@endDate, '\+1 day'\)/.test(src))
  check('compat.ts uses the sargable equality form', /created_at >= date\(@today\) AND created_at < date\(@today, '\+1 day'\)/.test(src))
  // The intentionally-skipped sites must stay (expiry_date has no plain index /
  // a per-row bound; the audit_logs retention delete has no created_at index).
  check('expiry_date and audit_logs date() sites are deliberately untouched', /date\(expiry_date\)/.test(src) && /DELETE FROM audit_logs WHERE date\(created_at\)/.test(src))
}

console.log(`\nALL ${passed} CHECKS PASSED`)
