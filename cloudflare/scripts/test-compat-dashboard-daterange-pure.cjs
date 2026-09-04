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

// ---- Alert scope: sales tiles follow the range, inventory alerts do NOT ----
//
// A product that is out of stock CANNOT sell, so scoping the out-of-stock /
// low-stock / expiring lists to "products with a recognized sale in the
// selected range" empties the alert exactly when it matters most. This block
// seeds that precise case against real sqlite: a product out of stock with no
// sale anywhere in the range must still be listed, while the sales tiles for
// the same range stay range-scoped.
{
  const inv = new Database(':memory:')
  inv.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY, name TEXT, category TEXT, unit TEXT, is_active INTEGER DEFAULT 1,
      stock_quantity REAL DEFAULT 0, low_stock_threshold REAL, out_of_stock_threshold REAL,
      expiry_date TEXT, expiry_alert_days INTEGER
    );
    CREATE TABLE sales (id INTEGER PRIMARY KEY, created_at TEXT, sale_status TEXT, total_usd REAL);
    CREATE TABLE sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER, product_id INTEGER);
  `)
  // 1: out of stock everywhere, LAST sold long before the range (the regression case)
  // 2: out of stock and never sold at all
  // 3: low stock, sold inside the range
  // 4: low stock, not sold inside the range
  // 5: expiring soon, never sold
  // 6: healthy stock, sold inside the range
  // 7: INACTIVE and out of stock -- must stay excluded (active catalog only)
  inv.exec(`
    INSERT INTO products (id, name, is_active, stock_quantity, low_stock_threshold, out_of_stock_threshold, expiry_date, expiry_alert_days) VALUES
      (1, 'Stale Out Of Stock', 1, 0, 10, 0, NULL, NULL),
      (2, 'Never Sold Out Of Stock', 1, 0, 10, 0, NULL, NULL),
      (3, 'Low And Selling', 1, 3, 10, 0, NULL, NULL),
      (4, 'Low And Quiet', 1, 2, 10, 0, NULL, NULL),
      (5, 'Expiring Quiet', 1, 40, 10, 0, date('now', '+3 day'), 30),
      (6, 'Healthy Seller', 1, 90, 10, 0, NULL, NULL),
      (7, 'Inactive Out Of Stock', 0, 0, 10, 0, NULL, NULL);
    INSERT INTO sales (id, created_at, sale_status, total_usd) VALUES
      (1, '2026-08-15 05:00:00', 'completed', 25),
      (2, '2026-08-16 05:00:00', 'completed', 15),
      (9, '2026-01-05 05:00:00', 'completed', 99);
    INSERT INTO sale_items (id, sale_id, product_id) VALUES
      (1, 1, 3), (2, 2, 6), (9, 9, 1);
  `)
  const range = { startDate: '2026-08-01', endDate: '2026-08-31' }
  const RANGE_ON = (col) => `date(${col}, '+7 hours') >= @startDate AND ${col} >= date(@startDate, '-1 day') AND date(${col}, '+7 hours') <= @endDate AND ${col} < date(@endDate, '+1 day')`
  // The scope the fix REMOVED, kept here to prove the behavior changed.
  const IN_RANGE_PRODUCT = `EXISTS (
    SELECT 1 FROM sale_items dsi JOIN sales ds ON ds.id = dsi.sale_id
    WHERE dsi.product_id = p.id AND ${RANGE_ON('ds.created_at')} AND COALESCE(ds.sale_status, 'completed') <> 'cancelled'
  )`
  const pick = (where) => inv.prepare(`SELECT id FROM products p WHERE ${where} ORDER BY id`).all(range).map((r) => r.id)

  const OUT_OF_STOCK = `p.is_active = 1 AND COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0)`
  const LOW_STOCK = `p.is_active = 1 AND COALESCE(stock_quantity, 0) <= COALESCE(low_stock_threshold, 10) AND COALESCE(stock_quantity, 0) > COALESCE(out_of_stock_threshold, 0)`
  const EXPIRING = `p.is_active = 1 AND expiry_date IS NOT NULL AND date(expiry_date) <= date('now', '+' || COALESCE(expiry_alert_days, 30) || ' day')`

  check('alerts: out-of-stock list is catalog-wide -- a product with no sale in the range is STILL listed',
    same(pick(OUT_OF_STOCK), [1, 2]))
  check('alerts: the removed in-range product scope EMPTIED the out-of-stock list (regression pinned)',
    pick(`${OUT_OF_STOCK} AND ${IN_RANGE_PRODUCT}`).length === 0)
  check('alerts: inactive products stay out of the out-of-stock list', !pick(OUT_OF_STOCK).includes(7))
  check('alerts: low-stock list is catalog-wide (quiet product 4 kept)', same(pick(LOW_STOCK), [3, 4]))
  check('alerts: the removed scope would have dropped the quiet low-stock product',
    same(pick(`${LOW_STOCK} AND ${IN_RANGE_PRODUCT}`), [3]))
  check('alerts: expiring list and its count are catalog-wide (never-sold product 5 kept)',
    same(pick(EXPIRING), [5]) && pick(`${EXPIRING} AND ${IN_RANGE_PRODUCT}`).length === 0)

  // ...and the money tiles for the same call DO follow the range.
  const salesInRange = inv.prepare(`SELECT COUNT(*) AS c, COALESCE(SUM(total_usd), 0) AS t FROM sales WHERE ${RANGE_ON('created_at')} AND COALESCE(sale_status, 'completed') <> 'cancelled'`).get(range)
  check('tiles: the sales count/total tiles stay scoped to the selected range (2 sales / $40, the January sale excluded)',
    salesInRange.c === 2 && salesInRange.t === 40)
  inv.close()
}

// ---- Source lock ----
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'compat.ts'), 'utf8')
  check('compat.ts has no raw date()-wrapped created_at window filter left',
    !/date\(s?\.?created_at\) (BETWEEN|= date\(@today\))/.test(src) && !/created_at >= date\(@(startDate|today)\)/.test(src))
  check('compat.ts buckets the range breakdowns via the local-day helper',
    /localDateRangeClause\(`\$\{alias\}\.created_at`\)/.test(src) && /localDateRangeClause\('r\.created_at'\)/.test(src))
  check('compat.ts scopes dashboard summary sales and returns through the selected local-date range',
    (src.match(/localDateRangeClause\('created_at'\)/g) || []).length >= 4)
  check('compat.ts buckets hour-of-day in local time', /localHourExpr\('s\.created_at'\)/.test(src))
  // Alert scope lock -- see the "Alert scope" block above for the behavior.
  check('compat.ts no longer scopes any dashboard card to products sold in the range',
    !/productInRangeClause/.test(src) && !/dashboard_si/.test(src))
  {
    const summary = src.slice(src.indexOf('async function dashboardSummary'), src.indexOf('async function dashboardAnalytics'))
    check('compat.ts dashboardSummary was located for the alert-scope lock', summary.length > 500)
    const alertQueries = summary.split('db.prepare(').filter((chunk) => /COALESCE\(stock_quantity, 0\) <=|COALESCE\(expiry_alert_days/.test(chunk))
    check('compat.ts has all four inventory alert queries (low stock, out of stock, expiring list, expiring count)',
      alertQueries.length === 4)
    check('compat.ts inventory alert queries filter on the active catalog only -- no sales/date scope',
      alertQueries.every((chunk) => /p\.is_active = 1/.test(chunk) && !/sale_items|localDateRangeClause|@startDate/.test(chunk.slice(0, chunk.indexOf('`).')))))
    check('compat.ts family stock stats are catalog-wide too, so the card badges match their lists',
      /whereSql: 'WHERE p\.is_active = 1',/.test(summary))
  }
  check('compat.ts returns the field names consumed by the dashboard',
    /AS return_count/.test(src) && /AS items_returned/.test(src) && /AS loss_usd/.test(src))
  check('compat.ts breakdowns share the canonical recognized net-sale formula',
    /recognizedExpr\(`\$\{alias\}\.`\)/.test(src) && /netSaleExpr\('s\.'\)/.test(src) && /CUSTOMER_REFUND_JOIN/.test(src))
  // The default window is the business day itself, matching every list page
  // (user, 2026-09-03) -- not a rolling seven days, not all history.
  check('compat.ts default range is today, the business day',
    /const today = businessToday\(\)/.test(src)
    && /startDate: String\(query\.startDate \|\| today\)/.test(src)
    && !/defaultStart/.test(src))
  // expiry_date keeps its date() wrapper: the comparison has a per-row bound,
  // so there is no index for a sargable rewrite to reach anyway.
  check('the expiry_date date() site is deliberately untouched', /date\(expiry_date\)/.test(src))

  // The audit_logs retention delete USED to be excluded from the sargable
  // sweep, on the reasoning that it had no created_at index so a +-7h drift
  // was immaterial. fx/sargable-date-fix rewrote it anyway, for a second
  // reason the old exclusion never considered: a single unbounded DELETE over
  // a large backlog blows D1's statement budget. It is now both sargable (a
  // bare `created_at < @cutoff`, no date() wrapper for an index to trip over)
  // and batched behind a LIMIT so the retention sweep cannot run away.
  //
  // This assertion was red on fx/sargable-date-fix's own branch -- the lane
  // changed the behaviour and left the guard pinning the old shape. Pin the
  // new intent instead, and keep both halves, so neither property can be lost
  // silently: dropping the batching would be a production incident, and
  // re-adding date(created_at) would undo the sargability.
  {
    const retention = src.slice(src.indexOf('DELETE FROM audit_logs'))
    check('the audit_logs retention delete is sargable -- no date() around created_at',
      /DELETE FROM audit_logs/.test(src) && !/DELETE FROM audit_logs WHERE date\(created_at\)/.test(src)
      && /created_at < @cutoff/.test(retention.slice(0, 300)))
    check('and it is batched, so a large backlog cannot exhaust the D1 statement budget',
      /LIMIT \d+/.test(retention.slice(0, 300)))
  }

  const win = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'businessDateWindow.ts'), 'utf8')
  check('businessDateWindow.ts localTodayExpr uses date(now,+7h)', /date\('now', '\$\{BUSINESS_TZ_FORWARD\}'\)/.test(win))
  check('businessDateWindow.ts today range has the sargable date-only window around localToday',
    /\$\{col\} >= date\(\$\{today\}, '-1 day'\) AND \$\{col\} < date\(\$\{today\}, '\+1 day'\)/.test(win))
  check('businessDateWindow.ts businessToday shifts by the business offset', /nowMs \+ BUSINESS_UTC_OFFSET_MINUTES \* 60 \* 1000/.test(win))
}

console.log(`\nALL ${passed} CHECKS PASSED`)
