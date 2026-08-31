// Local-day (UTC+7) bucketing + index-use lock for the dashboard/analytics date
// filters in compat.ts (the Dashboard summary + Analytics endpoints).
//
// created_at is stored UTC "YYYY-MM-DD HH:MM:SS" (lib/clientTimestamp.ts). The
// business is a single fixed timezone, Asia/Phnom_Penh (UTC+7, no DST), so the
// dashboard's "Today" and its date-ranged breakdowns must bucket in UTC+7 --
// otherwise a sale rung up at 00:30 local (17:30 UTC the previous day) lands on
// the previous calendar day, and the dashboard's "Today" and its default range
// silently drop the morning (user directive Sep 1 2026, the reported "wrong /
// incomplete data"). The kernel totals (getSalesTotals/getSalesPeriodSeries)
// already bucket local after the sales-analytics fix; this locks the RAW
// dashboard/analytics queries (the returns/payment/branch/top/hour breakdowns
// and the two "today" tiles) to the same local window, so the total and its
// breakdown agree on the day boundary. It proves the local bucketing across the
// start/end local-day edges, the "today" boundary, hour-of-day, and index use.
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
// id : created_at (UTC) : in LOCAL [2026-08-01, 2026-08-31] (UTC+7)?
// Local Aug 1 begins 2026-07-31 17:00 UTC; local Sep 1 begins 2026-08-31 17:00 UTC.
const seedRows = [
  [1, '2026-07-31 16:59:59'], // local Jul 31 23:59:59 -- out
  [2, '2026-07-31 17:00:00'], // local Aug 1 00:00:00 -- in (start edge)
  [3, '2026-08-15 12:30:00'], // local Aug 15 19:30 -- in
  [4, '2026-08-30 17:00:00'], // local Aug 31 00:00:00 -- in (end-day start)
  [5, '2026-08-31 16:59:59'], // local Aug 31 23:59:59 -- in (end edge)
  [6, '2026-08-31 17:00:00'], // local Sep 1 00:00:00 -- out (after end day)
  [7, '2026-09-01 00:00:00'], // local Sep 1 07:00 -- out
  [8, null],                   // NULL created_at -- out
]
const insert = db.prepare('INSERT INTO sales (id, created_at) VALUES (?, ?)')
for (const [id, ts] of seedRows) insert.run(id, ts)

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }
const ids = (where, params) => db.prepare(`SELECT id FROM sales WHERE ${where} ORDER BY id`).all(params || {}).map((r) => r.id)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// The UTC-date form the fix REPLACED (proves the behavior changed, not just moved).
const OLD_BT = 'date(created_at) BETWEEN date(@startDate) AND date(@endDate)'
// The shipped local forms -- must match businessDateWindow.ts's helpers.
const NEW_RANGE = `created_at >= datetime(@startDate, '-7 hours') AND created_at < datetime(date(@endDate, '+1 day'), '-7 hours')`
const NEW_TODAY = `created_at >= datetime(date('now', '+7 hours'), '-7 hours') AND created_at < datetime(date(date('now', '+7 hours'), '+1 day'), '-7 hours')`

// ---- Range: bucketed in UTC+7 ----
{
  const local = ids(NEW_RANGE, { startDate: '2026-08-01', endDate: '2026-08-31' })
  check('range: selects exactly the local-Aug rows (start edge 2, end edges 4,5)', same(local, [2, 3, 4, 5]))
  const utc = ids(OLD_BT, { startDate: '2026-08-01', endDate: '2026-08-31' })
  check('range: local form differs from the old UTC form', !same(local, utc))
  check('range: old UTC form misfiled local-Sep-1 into Aug (6 in) and dropped local-Aug-1 (2 out)',
    utc.includes(6) && !utc.includes(2))
  check('range: single local day selects only that local day (4,5)', same(ids(NEW_RANGE, { startDate: '2026-08-31', endDate: '2026-08-31' }), [4, 5]))
  check('range: empty range selects nothing', ids(NEW_RANGE, { startDate: '2026-01-01', endDate: '2026-01-31' }).length === 0)
}

// ---- "Today" tile: the boundary taken in UTC+7, no bound param ----
{
  // Anchor three rows relative to SQLite's own clock so the test is deterministic
  // whatever the wall time: NOW is always within the current local day; -2d/+2d
  // never are.
  db.prepare("INSERT INTO sales (id, created_at) VALUES (900, strftime('%Y-%m-%d %H:%M:%S','now'))").run()
  db.prepare("INSERT INTO sales (id, created_at) VALUES (901, datetime('now','-2 days'))").run()
  db.prepare("INSERT INTO sales (id, created_at) VALUES (902, datetime('now','+2 days'))").run()
  const todayIds = ids(NEW_TODAY)
  check('today: includes the just-now row (900), excludes -2d (901) and +2d (902)',
    todayIds.includes(900) && !todayIds.includes(901) && !todayIds.includes(902))
  // A 00:30-local sale (17:30 UTC the prior day) belongs to that local day, which
  // the old UTC `date(created_at) = date('now')` would miss on the morning.
  db.prepare("DELETE FROM sales WHERE id IN (900,901,902)").run()
}

// ---- Hour-of-day: bucketed in UTC+7 ----
{
  const hourLocal = (ts) => db.prepare("SELECT strftime('%H', ? , '+7 hours') AS h").get(ts).h
  const hourUtc = (ts) => db.prepare("SELECT strftime('%H', ?) AS h").get(ts).h
  check('hour: 20:00 UTC buckets as local 03 (next-day early morning), not 20', hourLocal('2026-08-15 20:00:00') === '03' && hourUtc('2026-08-15 20:00:00') === '20')
  check('hour: 05:00 UTC buckets as local 12 (noon)', hourLocal('2026-08-15 05:00:00') === '12')
}

// ---- Index use ----
{
  const bulk = db.prepare('INSERT INTO sales (id, created_at) VALUES (?, ?)')
  db.transaction(() => { for (let i = 0; i < 4000; i++) bulk.run(1000 + i, `2026-05-${String((i % 28) + 1).padStart(2, '0')} 10:00:00`) })()
  db.exec('ANALYZE')
  const usesIndex = (where, params) => db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM sales WHERE ${where}`).all(params || {})
    .some((r) => /USING (COVERING )?INDEX idx_sales_created_pg/.test(String(r.detail || '')))
  check('range: local form uses idx_sales_created_pg (stays sargable)', usesIndex(NEW_RANGE, { startDate: '2026-08-01', endDate: '2026-08-31' }))
  check('range: old date() form does NOT use the index', !usesIndex(OLD_BT, { startDate: '2026-08-01', endDate: '2026-08-31' }))
  check('today: local form uses idx_sales_created_pg', usesIndex(NEW_TODAY))
}

// ---- Source lock ----
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'compat.ts'), 'utf8')
  check('compat.ts has no raw date()-wrapped created_at window filter left',
    !/date\(s?\.?created_at\) (BETWEEN|= date\(@today\))/.test(src) && !/created_at >= date\(@(startDate|today)\)/.test(src))
  check('compat.ts buckets the range breakdowns via the local-day helper',
    /localDateRangeClause\('created_at'\)/.test(src) && /localDateRangeClause\('s\.created_at'\)/.test(src))
  check('compat.ts buckets the two "today" tiles via the local-today helper', /localTodayRangeClause\('created_at'\)/.test(src))
  check('compat.ts buckets hour-of-day in local time', /localHourExpr\('created_at'\)/.test(src))
  check('compat.ts default range uses the business-timezone today', /const today = businessToday\(\)/.test(src))
  // The intentionally-skipped sites must stay (expiry_date has a per-row bound;
  // the audit_logs retention delete has no created_at index -- ±7h immaterial).
  check('expiry_date and audit_logs date() sites are deliberately untouched',
    /date\(expiry_date\)/.test(src) && /DELETE FROM audit_logs WHERE date\(created_at\)/.test(src))

  const win = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'businessDateWindow.ts'), 'utf8')
  check('businessDateWindow.ts localTodayExpr uses date(now,+7h)', /date\('now', '\$\{BUSINESS_TZ_FORWARD\}'\)/.test(win))
  check('businessDateWindow.ts businessToday shifts by the business offset', /nowMs \+ BUSINESS_UTC_OFFSET_MINUTES \* 60 \* 1000/.test(win))
}

console.log(`\nALL ${passed} CHECKS PASSED`)
