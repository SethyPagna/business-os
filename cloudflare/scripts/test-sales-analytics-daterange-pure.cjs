// Local-day (UTC+7) bucketing + index-use lock for salesAnalytics.ts's
// date-range filter.
//
// created_at is stored UTC in SQLite's CURRENT_TIMESTAMP shape
// "YYYY-MM-DD HH:MM:SS" (space-separated, no T/Z/fraction -- lib/clientTimestamp.ts
// normalizes even client-supplied offline timestamps to it, precisely so the
// lexicographic ORDER BY / range comparisons this filter relies on are sound).
// The business is a single fixed timezone, Asia/Phnom_Penh (UTC+7, no DST), so
// "which day did this sale happen on" must be taken in UTC+7 -- otherwise a sale
// rung up at 00:30 local (17:30 UTC the previous day) lands on the previous
// calendar day and "Today" under-counts the morning (user directive, Sep 1 2026).
// The filter buckets locally by shifting the BOUNDS, not by date()-wrapping the
// column, so it stays sargable and still uses idx_sales_created_pg. This test
// proves the local bucketing across the boundary cases that break naive rewrites
// (the first/last local instant of the start and end days, the UTC instants just
// outside, NULL created_at) AND that the predicate is index-usable.
//
// Run (from cloudflare/): node scripts/test-sales-analytics-daterange-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Database = require('better-sqlite3')

// The UTC-date form the fix REPLACED (kept only to prove the behavior changed).
const OLD_UTC = `date(created_at) BETWEEN date(@startDate) AND date(@endDate)`
// The shipped local-day (UTC+7) sargable form -- must match what
// businessDateWindow.ts's localDayLowerBound/localDayUpperBoundExclusive build.
const NEW_LOCAL = `created_at >= datetime(@startDate, '-7 hours') AND created_at < datetime(date(@endDate, '+1 day'), '-7 hours')`

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE sales (id INTEGER PRIMARY KEY, created_at TEXT);
  CREATE INDEX idx_sales_created_pg ON sales (created_at DESC, id DESC);
`)

// id : created_at (UTC, stored "YYYY-MM-DD HH:MM:SS") : in LOCAL [2026-08-01, 2026-08-31] (UTC+7)?
// Local Aug 1 begins at 2026-07-31 17:00 UTC; local Sep 1 begins 2026-08-31 17:00 UTC.
const rows = [
  [1, '2026-07-31 16:59:59', false], // local Jul 31 23:59:59 -- before start
  [2, '2026-07-31 17:00:00', true],  // local Aug 1 00:00:00 -- first instant of start day
  [3, '2026-08-15 05:00:00', true],  // local Aug 15 12:00 -- mid range
  [4, '2026-08-30 17:00:00', true],  // local Aug 31 00:00:00 -- first instant of end day
  [5, '2026-08-31 16:59:59', true],  // local Aug 31 23:59:59 -- last instant of end day
  [6, '2026-08-31 17:00:00', false], // local Sep 1 00:00:00 -- first instant AFTER end day
  [7, '2026-09-01 00:00:00', false], // local Sep 1 07:00 -- well after
  [8, null, false],                   // NULL created_at
]
const insert = db.prepare('INSERT INTO sales (id, created_at) VALUES (?, ?)')
for (const [id, ts] of rows) insert.run(id, ts)

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

function idsFor(clause, startDate, endDate) {
  return db.prepare(`SELECT id FROM sales WHERE ${clause} ORDER BY id`).all({ startDate, endDate }).map((r) => r.id)
}

// Full-month range, bucketed in UTC+7.
{
  const localIds = idsFor(NEW_LOCAL, '2026-08-01', '2026-08-31')
  check('full-month: selects exactly the local-Aug rows (incl. +7h start-edge row 2 and end-edge rows 4,5)',
    JSON.stringify(localIds) === JSON.stringify([2, 3, 4, 5]))
  // The old UTC form buckets differently: row 2 (UTC Jul 31, local Aug 1) is
  // dropped and row 6 (UTC Aug 31 17:00, local Sep 1) is included -- proving the
  // fix changed behavior.
  const utcIds = idsFor(OLD_UTC, '2026-08-01', '2026-08-31')
  check('the local form differs from the old UTC form (the whole point of the fix)',
    JSON.stringify(localIds) !== JSON.stringify(utcIds))
  check('old UTC form misfiled the early-morning-local rows onto the wrong month',
    utcIds.includes(6) && !utcIds.includes(2))
}

// Single local day (start === end) -- the case most likely to break a rewrite.
{
  const ids = idsFor(NEW_LOCAL, '2026-08-31', '2026-08-31')
  check('single local day: only local-Aug-31 rows selected (4,5), local-Sep-1 (6) excluded',
    JSON.stringify(ids) === JSON.stringify([4, 5]))
}

// "Today" boundary: a sale at 00:30 local must count as today, not yesterday.
{
  // 2026-09-01 00:30 local = 2026-08-31 17:30 UTC.
  db.prepare('INSERT INTO sales (id, created_at) VALUES (?, ?)').run(100, '2026-08-31 17:30:00')
  const todayIds = idsFor(NEW_LOCAL, '2026-09-01', '2026-09-01')
  check('early-morning-local sale (00:30) counts on its local day, not the UTC previous day',
    todayIds.includes(100))
  const utcTodayIds = idsFor(OLD_UTC, '2026-09-01', '2026-09-01')
  check('the old UTC form dropped that 00:30-local sale from Today (the reported bug)',
    !utcTodayIds.includes(100))
  db.prepare('DELETE FROM sales WHERE id = 100').run()
}

// A range that matches nothing.
{
  check('empty range selects nothing', idsFor(NEW_LOCAL, '2026-01-01', '2026-01-31').length === 0)
}

// Index use: the shifted-bound predicate can still use the created_at index.
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
  const newPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM sales WHERE ${NEW_LOCAL}`).all({ startDate: '2026-08-01', endDate: '2026-08-31' })
  const oldPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM sales WHERE ${OLD_UTC}`).all({ startDate: '2026-08-01', endDate: '2026-08-31' })
  const usesIndex = (plan) => plan.some((r) => /USING (COVERING )?INDEX idx_sales_created_pg/.test(String(r.detail || '')))
  check('shifted-bound local form still uses idx_sales_created_pg (stays sargable)', usesIndex(newPlan))
  check('old date() form does NOT use the index (full scan) -- the perf bug it also fixed', !usesIndex(oldPlan))
}

// The shipped helper + kernel actually use the local-day form.
{
  const win = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'businessDateWindow.ts'), 'utf8')
  check('businessDateWindow.ts pins the fixed UTC+7 modifiers', /BUSINESS_TZ_FORWARD = '\+7 hours'/.test(win) && /BUSINESS_TZ_BACK = '-7 hours'/.test(win))
  check('businessDateWindow.ts lower bound shifts the start param back 7h', /datetime\(\$\{param\}, '\$\{BUSINESS_TZ_BACK\}'\)/.test(win))
  check('businessDateWindow.ts upper bound is the next local day, exclusive', /datetime\(date\(\$\{param\}, '\+1 day'\), '\$\{BUSINESS_TZ_BACK\}'\)/.test(win))

  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts'), 'utf8')
  check('salesAnalytics.ts buckets the date window via the local-day bounds helper',
    /created_at >= \$\{localDayLowerBound\('@startDate'\)\} AND \$\{alias\}\.created_at < \$\{localDayUpperBoundExclusive\('@endDate'\)\}/.test(src))
  check('salesAnalytics.ts no longer compares created_at against the raw UTC date bounds',
    !/created_at >= @startDate AND \$\{alias\}\.created_at < date\(@endDate, '\+1 day'\)/.test(src))
}

console.log(`\nALL ${passed} CHECKS PASSED`)
