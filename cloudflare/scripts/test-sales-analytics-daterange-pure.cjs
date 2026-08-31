// Equivalence + index-use lock for salesAnalytics.ts's date-range filter.
//
// whereActiveSales() used `date(created_at) BETWEEN date(@start) AND date(@end)`,
// which wraps the indexed column in a function and forces a full scan of every
// sale on every date-filtered report. It was replaced with the sargable
// `created_at >= @start AND created_at < date(@end,'+1 day')`. The two MUST
// select the exact same rows or every report total shifts. This test proves
// that against real SQLite (the engine D1 runs), across the boundary cases that
// break naive rewrites: the first/last instant of the start and end days, the
// days just outside, space- vs T-separated timestamps, and NULL created_at.
// It also asserts the new form is index-usable (EXPLAIN QUERY PLAN uses the
// index) while the old one is not.
//
// Run (from cloudflare/): node scripts/test-sales-analytics-daterange-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const Database = require('better-sqlite3')

const OLD = `date(created_at) BETWEEN date(@startDate) AND date(@endDate)`
const NEW = `created_at >= @startDate AND created_at < date(@endDate, '+1 day')`

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE sales (id INTEGER PRIMARY KEY, created_at TEXT);
  CREATE INDEX idx_sales_created_pg ON sales (created_at DESC, id DESC);
`)

// id : created_at : whether it falls in [2026-08-01, 2026-08-31]
const rows = [
  [1, '2026-07-31 23:59:59', false], // day before start
  [2, '2026-08-01 00:00:00', true],  // first instant of start day
  [3, '2026-08-01 00:00:00.500', true],
  [4, '2026-08-15 12:30:00', true],  // mid range
  [5, '2026-08-31 23:59:59', true],  // last second of end day
  [6, '2026-08-31T23:59:59.999Z', true], // T-separated + ms + Z, still end day
  [7, '2026-09-01 00:00:00', false], // first instant after end day
  [8, '2026-09-01T00:00:00Z', false],
  [9, '2026-08-20T08:00:00Z', true], // T-separated mid range
  [10, null, false],                  // NULL created_at
]
const insert = db.prepare('INSERT INTO sales (id, created_at) VALUES (?, ?)')
for (const [id, ts] of rows) insert.run(id, ts)

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

function idsFor(clause, startDate, endDate) {
  return db.prepare(`SELECT id FROM sales WHERE ${clause} ORDER BY id`).all({ startDate, endDate }).map((r) => r.id)
}

// Full-month range.
{
  const oldIds = idsFor(OLD, '2026-08-01', '2026-08-31')
  const newIds = idsFor(NEW, '2026-08-01', '2026-08-31')
  check('full-month: new range selects the same ids as the old date() form', JSON.stringify(oldIds) === JSON.stringify(newIds))
  check('full-month: the expected in-range ids are selected', JSON.stringify(newIds) === JSON.stringify([2, 3, 4, 5, 6, 9]))
}

// Single-day range (start === end) -- the case most likely to break a naive rewrite.
{
  const oldIds = idsFor(OLD, '2026-08-31', '2026-08-31')
  const newIds = idsFor(NEW, '2026-08-31', '2026-08-31')
  check('single-day: new form matches old form', JSON.stringify(oldIds) === JSON.stringify(newIds))
  check('single-day: only the end-day rows are selected (5 and 6), next-day excluded', JSON.stringify(newIds) === JSON.stringify([5, 6]))
}

// A range that matches nothing.
{
  const oldIds = idsFor(OLD, '2026-01-01', '2026-01-31')
  const newIds = idsFor(NEW, '2026-01-01', '2026-01-31')
  check('empty range: both forms select nothing', oldIds.length === 0 && newIds.length === 0)
}

// Index use: the new predicate can use the created_at index; the old cannot.
// SQLite's planner only reaches for an index once the table is big enough that
// a scan actually costs more, so seed enough rows that the choice is real.
{
  const bulk = db.prepare('INSERT INTO sales (id, created_at) VALUES (?, ?)')
  const seed = db.transaction(() => {
    for (let i = 0; i < 4000; i++) {
      const day = String((i % 28) + 1).padStart(2, '0')
      bulk.run(1000 + i, `2026-05-${day} 10:00:00`)
    }
  })
  seed()
  db.exec('ANALYZE')
  const newPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM sales WHERE ${NEW}`).all({ startDate: '2026-08-01', endDate: '2026-08-31' })
  const oldPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM sales WHERE ${OLD}`).all({ startDate: '2026-08-01', endDate: '2026-08-31' })
  const usesIndex = (plan) => plan.some((r) => /USING (COVERING )?INDEX idx_sales_created_pg/.test(String(r.detail || '')))
  check('new sargable form uses idx_sales_created_pg', usesIndex(newPlan))
  check('old date() form does NOT use the index (full scan) -- the perf bug', !usesIndex(oldPlan))
}

// The shipped source actually uses the sargable form.
{
  const fs = require('node:fs')
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts'), 'utf8')
  check('salesAnalytics.ts uses the sargable created_at range', /created_at >= @startDate AND \$\{alias\}\.created_at < date\(@endDate, '\+1 day'\)/.test(src))
  check('salesAnalytics.ts no longer date()-wraps created_at in the filter', !/date\(\$\{alias\}\.created_at\) BETWEEN/.test(src))
}

console.log(`\nALL ${passed} CHECKS PASSED`)
