// Local-day (UTC+7) bucketing + format-robustness + index-use lock for
// salesAnalytics.ts's date-range filter.
//
// created_at is stored UTC, but in a MIX of shapes: verified against prod D1,
// ALL sales rows are ISO "YYYY-MM-DDTHH:MM:SS.sssZ" (migrated/historical), while
// server CURRENT_TIMESTAMP / sanitizeClientCreatedAt writes are space-separated
// "YYYY-MM-DD HH:MM:SS". SQLite's date()/datetime()/strftime() parse BOTH, but a
// RAW string comparison against a datetime bound does NOT: at position 10 'T'
// (0x54) sorts AFTER ' ' (0x20), so an ISO timestamp compared against a space-
// formatted datetime bound at the same instant misfiles -- the row is dropped
// from its own day (silent data loss).
//
// The business is a single fixed timezone, Asia/Phnom_Penh (UTC+7, no DST), so
// "which day did this sale happen on" must be taken in UTC+7 -- otherwise a sale
// rung up at 00:30 local (17:30 UTC the previous day) lands on the previous
// calendar day and "Today" under-counts the morning (user directive, Sep 1 2026).
//
// The shipped filter (localDateRangeClause) buckets locally via a SHAPE-AGNOSTIC
// date(created_at,'+7 hours') precise check, AND-ed with a redundant, sargable,
// DATE-ONLY pre-filter on the raw column (created_at >= date(param,'-1 day') /
// < date(param,'+1 day')) so idx_sales_created_pg is still used and no valid row
// is ever excluded. This test proves: (a) local bucketing across the boundary
// cases that break naive rewrites; (b) format-robustness -- ISO 'T'/'Z' rows land
// on the correct local day where the OLD fragile datetime-bound form dropped them;
// (c) the predicate is still index-usable.
//
// Run (from cloudflare/): node scripts/test-sales-analytics-daterange-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Database = require('better-sqlite3')

// The UTC-date form the fix originally REPLACED (kept to prove behavior changed).
const OLD_UTC = `date(created_at) BETWEEN date(@startDate) AND date(@endDate)`
// The OLD FRAGILE sargable form (shifted datetime BOUNDS, raw string compare).
// Correct for space-format rows, but MISFILES ISO 'T'/'Z' rows -- the data-loss
// regression the hybrid form fixes. Kept to prove the ISO rows are now rescued.
const OLD_FRAGILE = `created_at >= datetime(@startDate, '-7 hours') AND created_at < datetime(date(@endDate, '+1 day'), '-7 hours')`
// The shipped hybrid local-day (UTC+7) form -- must match what
// businessDateWindow.ts's localDateRangeClause('created_at') builds.
const NEW_LOCAL = `date(created_at, '+7 hours') >= @startDate AND created_at >= date(@startDate, '-1 day') AND date(created_at, '+7 hours') <= @endDate AND created_at < date(@endDate, '+1 day')`

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE sales (id INTEGER PRIMARY KEY, created_at TEXT);
  CREATE INDEX idx_sales_created_pg ON sales (created_at DESC, id DESC);
`)

// id : created_at (UTC) : in LOCAL [2026-08-01, 2026-08-31] (UTC+7)?
// Local Aug 1 begins at 2026-07-31 17:00 UTC; local Sep 1 begins 2026-08-31 17:00 UTC.
// Rows 1-8 are SPACE format; rows 20-23 are ISO 'T'/'Z' at the same edge instants.
const rows = [
  [1, '2026-07-31 16:59:59', false], // local Jul 31 23:59:59 -- before start
  [2, '2026-07-31 17:00:00', true],  // local Aug 1 00:00:00 -- first instant of start day
  [3, '2026-08-15 05:00:00', true],  // local Aug 15 12:00 -- mid range
  [4, '2026-08-30 17:00:00', true],  // local Aug 31 00:00:00 -- first instant of end day
  [5, '2026-08-31 16:59:59', true],  // local Aug 31 23:59:59 -- last instant of end day
  [6, '2026-08-31 17:00:00', false], // local Sep 1 00:00:00 -- first instant AFTER end day
  [7, '2026-09-01 00:00:00', false], // local Sep 1 07:00 -- well after
  [8, null, false],                   // NULL created_at
  // ISO 'T'/'Z' rows (the prod sales shape) at the exact boundary instants:
  [20, '2026-07-31T17:00:00.000Z', true],  // local Aug 1 00:00:00 -- start edge
  [21, '2026-08-31T16:59:59.000Z', true],  // local Aug 31 23:59:59 -- END edge (OLD_FRAGILE drops this)
  [22, '2026-08-31T17:00:00.000Z', false], // local Sep 1 00:00:00 -- just AFTER end
  [23, '2026-07-31T16:59:59.000Z', false], // local Jul 31 23:59:59 -- before start
]
const insert = db.prepare('INSERT INTO sales (id, created_at) VALUES (?, ?)')
for (const [id, ts] of rows) insert.run(id, ts)

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }

function idsFor(clause, startDate, endDate) {
  return db.prepare(`SELECT id FROM sales WHERE ${clause} ORDER BY id`).all({ startDate, endDate }).map((r) => r.id)
}

// Full-month range, bucketed in UTC+7 -- both space and ISO edge rows land right.
{
  const localIds = idsFor(NEW_LOCAL, '2026-08-01', '2026-08-31')
  check('full-month: selects exactly the local-Aug rows across BOTH shapes (space 2,3,4,5 + ISO 20,21)',
    JSON.stringify(localIds) === JSON.stringify([2, 3, 4, 5, 20, 21]))
  // The old UTC form buckets differently: row 2 (UTC Jul 31, local Aug 1) is
  // dropped and row 6 (UTC Aug 31 17:00, local Sep 1) is included -- proving the
  // fix changed behavior.
  const utcIds = idsFor(OLD_UTC, '2026-08-01', '2026-08-31')
  check('the local form differs from the old UTC form (the whole point of the fix)',
    JSON.stringify(localIds) !== JSON.stringify(utcIds))
  check('old UTC form misfiled the early-morning-local rows onto the wrong month',
    utcIds.includes(6) && !utcIds.includes(2))
}

// FORMAT ROBUSTNESS: the ISO end-edge row is the regression case. The OLD fragile
// datetime-bound form drops it (raw 'T' vs ' ' string compare); the hybrid keeps it.
{
  const newIds = idsFor(NEW_LOCAL, '2026-08-01', '2026-08-31')
  const fragileIds = idsFor(OLD_FRAGILE, '2026-08-01', '2026-08-31')
  check('hybrid form INCLUDES the ISO end-edge row 21 (2026-08-31T16:59:59Z = local Aug 31 23:59:59)',
    newIds.includes(21))
  check('OLD fragile datetime-bound form DROPPED that ISO row 21 (the data-loss bug now fixed)',
    !fragileIds.includes(21))
  check('hybrid and OLD-fragile still AGREE on every space-format row (only ISO rows differed)',
    JSON.stringify(newIds.filter((id) => id < 20)) === JSON.stringify(fragileIds.filter((id) => id < 20)))
  check('hybrid EXCLUDES the ISO just-after-end row 22 and before-start row 23',
    !newIds.includes(22) && !newIds.includes(23))
}

// Single local day (start === end) -- the case most likely to break a rewrite.
{
  const ids = idsFor(NEW_LOCAL, '2026-08-31', '2026-08-31')
  check('single local day: only local-Aug-31 rows selected (space 4,5 + ISO 21), local-Sep-1 (6,22) excluded',
    JSON.stringify(ids) === JSON.stringify([4, 5, 21]))
}

// "Today" boundary: a sale at 00:30 local must count as today, not yesterday --
// proven for BOTH shapes.
{
  // 2026-09-01 00:30 local = 2026-08-31 17:30 UTC.
  insert.run(100, '2026-08-31 17:30:00')       // space form
  insert.run(101, '2026-08-31T17:30:00.000Z')  // ISO form, same instant
  const todayIds = idsFor(NEW_LOCAL, '2026-09-01', '2026-09-01')
  check('early-morning-local sale (00:30) counts on its local day for BOTH shapes',
    todayIds.includes(100) && todayIds.includes(101))
  const utcTodayIds = idsFor(OLD_UTC, '2026-09-01', '2026-09-01')
  check('the old UTC form dropped that 00:30-local sale from Today (the reported bug)',
    !utcTodayIds.includes(100) && !utcTodayIds.includes(101))
  db.prepare('DELETE FROM sales WHERE id IN (100, 101)').run()
}

// A range that matches nothing.
{
  check('empty range selects nothing', idsFor(NEW_LOCAL, '2026-01-01', '2026-01-31').length === 0)
}

// Index use: the hybrid predicate's sargable date-only pre-filter keeps the
// created_at index usable.
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
  check('hybrid form still uses idx_sales_created_pg via its sargable date-only pre-filter', usesIndex(newPlan))
  check('old date() BETWEEN form does NOT use the index (full scan) -- the perf bug it also fixed', !usesIndex(oldPlan))
}

// The shipped helper + kernel actually use the hybrid local-day form.
{
  const win = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'businessDateWindow.ts'), 'utf8')
  check('businessDateWindow.ts pins the fixed UTC+7 modifiers', /BUSINESS_TZ_FORWARD = '\+7 hours'/.test(win) && /BUSINESS_TZ_BACK = '-7 hours'/.test(win))
  check('businessDateWindow.ts precise check normalizes the column via date(col, +7h)', /date\(\$\{col\}, '\$\{BUSINESS_TZ_FORWARD\}'\)/.test(win))
  check('businessDateWindow.ts at-or-after has a sargable date-only floor date(param, -1 day)', /\$\{col\} >= date\(\$\{param\}, '-1 day'\)/.test(win))
  check('businessDateWindow.ts at-or-before has a sargable date-only ceiling date(param, +1 day)', /\$\{col\} < date\(\$\{param\}, '\+1 day'\)/.test(win))

  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'salesAnalytics.ts'), 'utf8')
  check('salesAnalytics.ts buckets the date window via the shared localDateRangeClause helper',
    /localDateRangeClause\(`\$\{alias\}\.created_at`\)/.test(src))
  check('salesAnalytics.ts no longer compares created_at against the raw UTC date bounds',
    !/created_at >= @startDate AND \$\{alias\}\.created_at < date\(@endDate, '\+1 day'\)/.test(src))
}

console.log(`\nALL ${passed} CHECKS PASSED`)
