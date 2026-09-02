// Local-day (UTC+7) bucketing + format-robustness + index-use lock for the
// dashboard/analytics date filters in compat.ts (Dashboard summary + Analytics).
//
// created_at is stored UTC, in a MIX of shapes: prod sales are ISO
// "YYYY-MM-DDTHH:MM:SS.sssZ"; server CURRENT_TIMESTAMP / sanitizeClientCreatedAt
// writes are space "YYYY-MM-DD HH:MM:SS". A raw string comparison against a
// datetime bound MISFILES ISO rows (at position 10 'T' sorts after ' '), so the
// day must be taken through date(col,'+7 hours') -- shape-agnostic -- with a
// sargable date-only pre-filter for the index. The business is one fixed
// timezone, Asia/Phnom_Penh (UTC+7, no DST), so the dashboard's "Today" and its
// date-ranged breakdowns must bucket in UTC+7 -- otherwise a sale rung up at
// 00:30 local (17:30 UTC the previous day) lands on the previous calendar day and
// the dashboard silently drops the morning (user directive Sep 1 2026, the
// reported "wrong / incomplete data"). The kernel totals already bucket local
// after the sales-analytics fix; this locks the RAW dashboard/analytics queries
// (the returns/payment/branch/top/hour breakdowns and the two "today" tiles) to
// the same local window, so the total and its breakdown agree on the day
// boundary. Proves local bucketing across the start/end edges, format-robustness
// on ISO rows, the "today" boundary, hour-of-day, and index use.
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
// Rows 1-8 space format; rows 20-23 ISO 'T'/'Z' at the same edge instants.
const seedRows = [
  [1, '2026-07-31 16:59:59'], // local Jul 31 23:59:59 -- out
  [2, '2026-07-31 17:00:00'], // local Aug 1 00:00:00 -- in (start edge)
  [3, '2026-08-15 12:30:00'], // local Aug 15 19:30 -- in
  [4, '2026-08-30 17:00:00'], // local Aug 31 00:00:00 -- in (end-day start)
  [5, '2026-08-31 16:59:59'], // local Aug 31 23:59:59 -- in (end edge)
  [6, '2026-08-31 17:00:00'], // local Sep 1 00:00:00 -- out (after end day)
  [7, '2026-09-01 00:00:00'], // local Sep 1 07:00 -- out
  [8, null],                   // NULL created_at -- out
  [20, '2026-07-31T17:00:00.000Z'], // ISO local Aug 1 00:00:00 -- in (start edge)
  [21, '2026-08-31T16:59:59.000Z'], // ISO local Aug 31 23:59:59 -- in (END edge, OLD_FRAGILE drops)
  [22, '2026-08-31T17:00:00.000Z'], // ISO local Sep 1 00:00:00 -- out
  [23, '2026-07-31T16:59:59.000Z'], // ISO local Jul 31 23:59:59 -- out
]
const insert = db.prepare('INSERT INTO sales (id, created_at) VALUES (?, ?)')
for (const [id, ts] of seedRows) insert.run(id, ts)

let passed = 0
const check = (label, cond) => { assert.ok(cond, label); passed++; console.log(`PASS ${label}`) }
const ids = (where, params) => db.prepare(`SELECT id FROM sales WHERE ${where} ORDER BY id`).all(params || {}).map((r) => r.id)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// The UTC-date form the fix REPLACED (proves the behavior changed, not just moved).
const OLD_BT = 'date(created_at) BETWEEN date(@startDate) AND date(@endDate)'
// The OLD FRAGILE shifted-datetime-bound form (raw string compare) -- drops ISO rows.
const OLD_FRAGILE = `created_at >= datetime(@startDate, '-7 hours') AND created_at < datetime(date(@endDate, '+1 day'), '-7 hours')`
// The shipped HYBRID local forms -- must match businessDateWindow.ts's helpers.
const NEW_RANGE = `date(created_at, '+7 hours') >= @startDate AND created_at >= date(@startDate, '-1 day') AND date(created_at, '+7 hours') <= @endDate AND created_at < date(@endDate, '+1 day')`
const NEW_TODAY = `date(created_at, '+7 hours') = date('now', '+7 hours') AND created_at >= date(date('now', '+7 hours'), '-1 day') AND created_at < date(date('now', '+7 hours'), '+1 day')`

// ---- Range: bucketed in UTC+7, across both shapes ----
{
  const local = ids(NEW_RANGE, { startDate: '2026-08-01', endDate: '2026-08-31' })
  check('range: selects exactly the local-Aug rows across both shapes (space 2,3,4,5 + ISO 20,21)', same(local, [2, 3, 4, 5, 20, 21]))
  const utc = ids(OLD_BT, { startDate: '2026-08-01', endDate: '2026-08-31' })
  check('range: local form differs from the old UTC form', !same(local, utc))
  check('range: old UTC form misfiled local-Sep-1 into Aug (6 in) and dropped local-Aug-1 (2 out)',
    utc.includes(6) && !utc.includes(2))
  check('range: single local day selects only that local day (space 4,5 + ISO 21)', same(ids(NEW_RANGE, { startDate: '2026-08-31', endDate: '2026-08-31' }), [4, 5, 21]))
  check('range: empty range selects nothing', ids(NEW_RANGE, { startDate: '2026-01-01', endDate: '2026-01-31' }).length === 0)
}

// ---- Format robustness: the ISO end-edge row the OLD fragile form dropped ----
{
  const local = ids(NEW_RANGE, { startDate: '2026-08-01', endDate: '2026-08-31' })
  const fragile = ids(OLD_FRAGILE, { startDate: '2026-08-01', endDate: '2026-08-31' })
  check('hybrid INCLUDES ISO end-edge row 21; OLD fragile form DROPPED it (data-loss fixed)',
    local.includes(21) && !fragile.includes(21))
  check('hybrid and OLD-fragile agree on every space-format row (only ISO rows differed)',
    same(local.filter((id) => id < 20), fragile.filter((id) => id < 20)))
}

// ---- "Today" tile: the boundary taken in UTC+7, no bound param, both shapes ----
{
  // Anchor rows relative to SQLite's own clock so the test is deterministic
  // whatever the wall time: NOW is always within the current local day; -2d/+2d
  // never are.
  db.prepare("INSERT INTO sales (id, created_at) VALUES (900, strftime('%Y-%m-%d %H:%M:%S','now'))").run()      // space now
  db.prepare("INSERT INTO sales (id, created_at) VALUES (903, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run()     // ISO now
  db.prepare("INSERT INTO sales (id, created_at) VALUES (901, datetime('now','-2 days'))").run()
  db.prepare("INSERT INTO sales (id, created_at) VALUES (902, datetime('now','+2 days'))").run()
  const todayIds = ids(NEW_TODAY)
  check('today: includes the just-now rows in BOTH shapes (900 space, 903 ISO), excludes -2d/+2d',
    todayIds.includes(900) && todayIds.includes(903) && !todayIds.includes(901) && !todayIds.includes(902))
  db.prepare("DELETE FROM sales WHERE id IN (900,901,902,903)").run()
}

// ---- Hour-of-day: bucketed in UTC+7 ----
{
  const hourLocal = (ts) => db.prepare("SELECT strftime('%H', ? , '+7 hours') AS h").get(ts).h
  const hourUtc = (ts) => db.prepare("SELECT strftime('%H', ?) AS h").get(ts).h
  check('hour: 20:00 UTC buckets as local 03 (next-day early morning), not 20', hourLocal('2026-08-15 20:00:00') === '03' && hourUtc('2026-08-15 20:00:00') === '20')
  check('hour: 05:00 UTC buckets as local 12 (noon)', hourLocal('2026-08-15 05:00:00') === '12')
  check('hour: ISO shape buckets the same as space shape (20:00Z -> local 03)', hourLocal('2026-08-15T20:00:00.000Z') === '03')
}

// ---- Index use ----
{
  const bulk = db.prepare('INSERT INTO sales (id, created_at) VALUES (?, ?)')
  db.transaction(() => { for (let i = 0; i < 4000; i++) bulk.run(1000 + i, `2026-05-${String((i % 28) + 1).padStart(2, '0')} 10:00:00`) })()
  db.exec('ANALYZE')
  const usesIndex = (where, params) => db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM sales WHERE ${where}`).all(params || {})
    .some((r) => /USING (COVERING )?INDEX idx_sales_created_pg/.test(String(r.detail || '')))
  check('range: hybrid form uses idx_sales_created_pg via its sargable date-only pre-filter', usesIndex(NEW_RANGE, { startDate: '2026-08-01', endDate: '2026-08-31' }))
  check('range: old date() form does NOT use the index', !usesIndex(OLD_BT, { startDate: '2026-08-01', endDate: '2026-08-31' }))
  check('today: hybrid form uses idx_sales_created_pg', usesIndex(NEW_TODAY))
}

// ---- Source lock ----
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'compat.ts'), 'utf8')
  check('compat.ts has no raw date()-wrapped created_at window filter left',
    !/date\(s?\.?created_at\) (BETWEEN|= date\(@today\))/.test(src) && !/created_at >= date\(@(startDate|today)\)/.test(src))
  check('compat.ts buckets the range breakdowns via the local-day helper',
    /localDateRangeClause\(`\$\{alias\}\.created_at`\)/.test(src) && /localDateRangeClause\('r\.created_at'\)/.test(src))
  check('compat.ts buckets the two "today" tiles via the local-today helper', /localTodayRangeClause\('created_at'\)/.test(src))
  check('compat.ts buckets hour-of-day in local time', /localHourExpr\('s\.created_at'\)/.test(src))
  check('compat.ts returns the field names consumed by the dashboard',
    /AS return_count/.test(src) && /AS items_returned/.test(src) && /AS loss_usd/.test(src))
  check('compat.ts breakdowns share the canonical recognized net-sale formula',
    /recognizedExpr\(`\$\{alias\}\.`\)/.test(src) && /netSaleExpr\('s\.'\)/.test(src) && /CUSTOMER_REFUND_JOIN/.test(src))
  check('compat.ts default range uses the business-timezone today', /const today = businessToday\(\)/.test(src))
  // The intentionally-skipped sites must stay (expiry_date has a per-row bound;
  // the audit_logs retention delete has no created_at index -- ±7h immaterial).
  check('expiry_date and audit_logs date() sites are deliberately untouched',
    /date\(expiry_date\)/.test(src) && /DELETE FROM audit_logs WHERE date\(created_at\)/.test(src))

  const win = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'businessDateWindow.ts'), 'utf8')
  check('businessDateWindow.ts localTodayExpr uses date(now,+7h)', /date\('now', '\$\{BUSINESS_TZ_FORWARD\}'\)/.test(win))
  check('businessDateWindow.ts today range has the sargable date-only window around localToday',
    /\$\{col\} >= date\(\$\{today\}, '-1 day'\) AND \$\{col\} < date\(\$\{today\}, '\+1 day'\)/.test(win))
  check('businessDateWindow.ts businessToday shifts by the business offset', /nowMs \+ BUSINESS_UTC_OFFSET_MINUTES \* 60 \* 1000/.test(win))
}

console.log(`\nALL ${passed} CHECKS PASSED`)
