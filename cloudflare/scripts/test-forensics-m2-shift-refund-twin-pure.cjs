// SCAN1 M2 detection query: ops/queries/forensics-m2-shift-refund-riel-twin.sql
//
// The query counts ended shifts whose drawer expectation, before the fix, took
// a refund's riel twin out as well as its dollars. It re-states the shift
// window in SQL, so this test runs the REAL query file against a fixture and
// holds its per-shift answer against the REAL lib/shiftReconciliation.ts
// window (shiftRefunds): a shift is affected exactly when its window holds a
// paired customer return and its riel opening was counted, since an uncounted
// one leaves the riel expected unprinted. Every window clause (half-open bounds, branch,
// per-account cashier, shop-wide, cancelled and supplier returns) has a row
// that only that clause excludes, so a query that drops one over-counts, and
// one return sits inside two overlapping windows (a shop-wide shift and its
// cashier's own), so affected_returns must count returns, not window hits.
//
// Run (from cloudflare/): node scripts/test-forensics-m2-shift-refund-twin-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const QUERY = fs.readFileSync(path.join(root, '..', 'ops', 'queries', 'forensics-m2-shift-refund-riel-twin.sql'), 'utf8')
function load(file, overrides = {}) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, 'src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', output)((name) => (name in overrides ? overrides[name] : require(name)), m, m.exports)
  return m.exports
}

const sql = new Database(':memory:')
sql.exec(`
CREATE TABLE shift_sessions(id INTEGER PRIMARY KEY, business_date TEXT, branch_id INTEGER, user_id INTEGER,
 scope_mode TEXT NOT NULL DEFAULT 'per_account', opened_at TEXT, closed_at TEXT, cancelled_at TEXT, closing_counted_khr REAL,
 opening_float_khr REAL NOT NULL DEFAULT 0,
 opening_float_khr_registered INTEGER NOT NULL DEFAULT 0 CHECK (opening_float_khr_registered IN (0, 1)));
CREATE TABLE returns(id INTEGER PRIMARY KEY, created_at TEXT, branch_id INTEGER, cashier_id INTEGER,
 status TEXT DEFAULT 'completed', return_scope TEXT DEFAULT 'customer',
 total_refund_usd REAL DEFAULT 0, total_refund_khr REAL DEFAULT 0, exchange_rate REAL,
 refund_currency TEXT, owed_reduction_usd REAL NOT NULL DEFAULT 0, sale_id INTEGER);
-- shiftRefunds leaves out refunds on cancelled sales (RET-A, LH-4); these returns have no sale.
CREATE TABLE sales(id INTEGER PRIMARY KEY, sale_status TEXT);

INSERT INTO shift_sessions(id,business_date,branch_id,user_id,scope_mode,opened_at,closed_at,cancelled_at,closing_counted_khr,opening_float_khr,opening_float_khr_registered) VALUES
 (1,'2026-09-01',2,7,'per_account','2026-09-01T02:00:00.000Z','2026-09-01T06:00:00.000Z',NULL,1000,40000,1),
 (2,'2026-09-01',2,8,'per_account','2026-09-01T06:00:00.000Z','2026-09-01T08:00:00.000Z',NULL,NULL,20000,1),
 (3,'2026-09-02',2,9,'per_account','2026-09-02T09:00:00.000Z','2026-09-02T10:00:00.000Z',NULL,0,10000,1),
 (4,'2026-09-03',3,9,'shop_wide','2026-09-03T11:00:00.000Z','2026-09-03T12:00:00.000Z',NULL,0,0,1),
 (5,'2026-09-03',2,11,'per_account','2026-09-03T11:00:00.000Z',NULL,NULL,NULL,0,0),
 (6,'2026-09-04',2,7,'per_account','2026-09-04T02:00:00.000Z',NULL,'2026-09-04T03:00:00.000Z',NULL,8000,1),
 (7,'2026-09-05',NULL,7,'per_account','2026-09-05T13:00:00.000Z','2026-09-05T14:00:00.000Z',NULL,NULL,4100,1),
 (8,'2026-09-06',2,10,'per_account','2026-09-06T15:00:00.000Z','2026-09-06T16:00:00.000Z',NULL,500,0,0),
 (9,'2026-09-03',3,12,'per_account','2026-09-03T11:00:00.000Z','2026-09-03T12:00:00.000Z',NULL,NULL,12000,1),
 (10,'2026-09-08',2,13,'per_account','2026-09-08T02:00:00.000Z','2026-09-08T04:00:00.000Z',NULL,2000,0,0);
`)
const moneyPrecision = load('lib/moneyPrecision.ts')
const insertReturn = sql.prepare(`INSERT INTO returns(id,created_at,branch_id,cashier_id,status,return_scope,
  total_refund_usd,total_refund_khr,exchange_rate) VALUES (?,?,?,?,?,?,?,?,?)`)
function paired(id, createdAt, branchId, cashierId, usd, { status = 'completed', scope = 'customer', rate = 4100 } = {}) {
  insertReturn.run(id, createdAt, branchId, cashierId, status, scope, usd, moneyPrecision.multiplyMoney4(usd, rate), rate)
}
paired(1, '2026-09-01 03:00:00', 2, 7, 5)                          // shift 1: positive, riel counted
paired(2, '2026-09-01 06:00:00', 2, 8, 3)                          // shift 2: positive AT the opening second
paired(3, '2026-09-01 08:00:00', 2, 8, 4)                          // closing second of shift 2: outside
paired(4, '2026-09-02 09:10:00', 2, 9, 6, { status: 'cancelled' }) // shift 3: cancelled return
paired(5, '2026-09-02 09:20:00', 2, 9, 6, { scope: 'supplier' })   // shift 3: supplier return
paired(6, '2026-09-02 09:30:00', 2, 7, 6)                          // shift 3: another cashier (per-account)
paired(7, '2026-09-02 09:40:00', 3, 9, 6)                          // shift 3: another branch
paired(8, '2026-09-02 09:50:00', 2, 9, 0)                          // shift 3: a zero-money return has no twin
paired(9, '2026-09-03 11:30:00', 3, 12, 2)                         // shift 4: shop-wide takes every cashier; ALSO shift 9's own
paired(10, '2026-09-03 11:40:00', 2, 11, 2)                        // shift 5: open, not ended
paired(11, '2026-09-04 02:30:00', 2, 7, 1.25, { rate: 4000 })      // shift 6: cancelled shift, window ends at cancel
paired(12, '2026-09-05 13:30:00', 5, 7, 8)                         // shift 7: no branch on the shift, any branch counts
paired(13, '2026-09-06 14:59:59', 2, 10, 9)                        // shift 8: one second before opening
paired(14, '2026-09-06 16:00:00', 2, 10, 9)                        // shift 8: the closing second
insertReturn.run(15, '2026-09-07 20:00:00', 2, 7, 'completed', 'customer', 0, 4100, 4100) // riel-only, outside every window
paired(16, '2026-09-08 03:00:00', 2, 13, 7)                        // shift 10: in its window, but no riel opening was counted

const db = {
  prepare(query) {
    const bind = (params = {}) => {
      const values = []
      const text = query.replace(/@(\w+)/g, (_, key) => { values.push(params[key] ?? null); return '?' })
      return { stmt: sql.prepare(text), values }
    }
    return {
      get(params) { const b = bind(params); return b.stmt.get(...b.values) },
      all(params) { const b = bind(params); return b.stmt.all(...b.values) },
    }
  },
}
const businessDateWindow = load('lib/businessDateWindow.ts')
const reportMoneyPrecision = load('lib/reportMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
const promotionRules = load('lib/promotionRules.ts', { './moneyPrecision': moneyPrecision })
const saleItemPricing = load('lib/saleItemPricing.ts', { './moneyPrecision': moneyPrecision, './promotionRules': promotionRules })
const saleMoneyPrecision = load('lib/saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision })
// salesAnalytics reads a credit sale's balance due through the one owed helper.
const saleStatusResolutionForAnalytics = load('lib/saleStatusResolution.ts', { './financialPrecision': load('lib/financialPrecision.ts') })
const refundTenderForAnalytics = load('lib/refundTender.ts')
const refundMoneyPrecision = load('lib/refundMoneyPrecision.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const customerReturnEntitlement = load('lib/customerReturnEntitlement.ts', { './moneyPrecision': moneyPrecision, './refundMoneyPrecision': refundMoneyPrecision, './saleItemPricing': saleItemPricing, './saleMoneyPrecision': saleMoneyPrecision })
const saleTotals = load('lib/saleTotals.ts', { './moneyPrecision': moneyPrecision, './saleMoneyPrecision': saleMoneyPrecision })
const nativeSaleChange = load('lib/nativeSaleChange.ts', { './financialPrecision': load('lib/financialPrecision.ts'), './saleTotals': saleTotals })
const salesAnalytics = load('lib/salesAnalytics.ts', { './saleStatusResolution': saleStatusResolutionForAnalytics, './refundTender': refundTenderForAnalytics, './db': { getDb: () => db }, './removalLosses': load('lib/removalLosses.ts'), './schemaProbe': load('lib/schemaProbe.ts'), './businessDateWindow': businessDateWindow,
  './saleMoneyPrecision': saleMoneyPrecision, './reportMoneyPrecision': reportMoneyPrecision, './customerReturnEntitlement': customerReturnEntitlement, './refundMoneyPrecision': refundMoneyPrecision })
const recon = load('lib/shiftReconciliation.ts', {
  './db': { getDb: () => db }, './nativeSaleChange': nativeSaleChange, './salesAnalytics': salesAnalytics,
  './paymentMethodRegistry': load('lib/paymentMethodRegistry.ts'), './refundTender': load('lib/refundTender.ts'),
})

;(async () => {
  const rows = sql.prepare(QUERY).all()
  assert.equal(rows.length, 1, 'one row of counts')
  const [row] = rows
  assert.deepEqual(Object.keys(row).filter((key) => /usd|khr|amount|total|note|name/.test(key)), [],
    'counts and dates only -- no cash figure, name or note leaves the database')
  assert.deepEqual(row, {
    ended_shifts: 9,
    affected_shifts: 6,
    affected_closed_shifts: 5,
    affected_with_riel_count: 2,
    affected_returns: 5,
    riel_only_returns: 1,
    first_affected_date: '2026-09-01',
    last_affected_date: '2026-09-05',
  })
  console.log('PASS counts: shifts 1, 2, 4, 6, 7 and 9 are affected (return 9 once); the open shift, shift 10 (riel opening never counted), every excluded return and both window edges are not')

  // The ops workflow never runs the raw file: it runs the guard's canonical
  // text (comments stripped, whitespace collapsed) and enforces its row rules.
  const { pathToFileURL } = require('node:url')
  const guard = await import(pathToFileURL(path.join(root, '..', 'ops', 'scripts', 'ops-sql-guard.mjs')).href)
  const loaded = guard.loadQuery('forensics-m2-shift-refund-riel-twin')
  assert.deepEqual(loaded.rules, { minRows: 1, maxRows: 1, expectZero: null })
  assert.deepEqual(sql.prepare(loaded.sql).all(), rows, 'the guarded canonical text gives the same answer')
  console.log('PASS guard: the read-only guard accepts the query and its canonical text answers the same')

  // The same question through the real module: a shift is affected exactly
  // when shiftRefunds finds a dollar refund in its window (every fixture
  // return inside a window is paired, as every live writer stores it).
  const hitSql = `${QUERY.slice(0, QUERY.lastIndexOf('\nSELECT'))}\nSELECT DISTINCT shift_id FROM hit ORDER BY shift_id`
  const fromQuery = sql.prepare(hitSql).all().map((r) => r.shift_id)
  const NOW = Date.parse('2026-09-10T00:00:00.000Z')
  const ended = sql.prepare('SELECT * FROM shift_sessions WHERE closed_at IS NOT NULL OR cancelled_at IS NOT NULL ORDER BY id').all()
  const fromModule = []
  for (const shift of ended) if ((await recon.shiftRefunds({}, shift, NOW)).usd > 0) fromModule.push(shift.id)
  assert.deepEqual(fromQuery, [1, 2, 4, 6, 7, 9, 10])
  assert.deepEqual(fromQuery, fromModule, 'the query window is the module window, shift by shift')
  console.log('PASS parity: the query selects exactly the shifts whose real reconciliation window holds a refund')

  const appOpeningRead = /CASE WHEN \w+=1 THEN opening_float_khr ELSE NULL END AS opening_float_khr/
    .exec(fs.readFileSync(path.join(root, 'src', 'routes', 'shifts.ts'), 'utf8'))
  assert.ok(appOpeningRead, 'routes/shifts.ts reads the riel opening through its registration flag')
  const openingKhrAsRead = new Map(sql.prepare(`SELECT id, ${appOpeningRead[0]} FROM shift_sessions`).all().map((r) => [r.id, r.opening_float_khr]))
  const rielExpectedShown = fromModule.filter((id) => recon.computeShiftReconciliation({
    opening: { usd: 0, khr: openingKhrAsRead.get(id) }, cashSales: null, refunds: null, expenses: null, courier: null, counted: null,
  }).expected.khr !== null)
  const affectedSql = `${QUERY.slice(0, QUERY.lastIndexOf('\nSELECT'))}\nSELECT id FROM affected ORDER BY id`
  assert.deepEqual(rielExpectedShown, [1, 2, 4, 6, 7, 9])
  assert.deepEqual(sql.prepare(affectedSql).all().map((r) => r.id), rielExpectedShown,
    'affected = window hit AND the app, reading the opening as it does, prints a riel expected at all')
  console.log('PASS parity: an affected shift is one whose real reconciliation prints a riel expected; an uncounted riel opening prints none')
})().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => sql.close())
