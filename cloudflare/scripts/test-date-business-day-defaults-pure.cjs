// Business day (Cambodia, UTC+7) versus UTC day, at the one instant where they
// disagree: 2026-10-05T18:30:00Z is 01:30 on 6 OCTOBER in Phnom Penh. Every
// default below used `new Date().toISOString().slice(0, 10)` or SQLite's
// date('now') / datetime('now'), which name 5 October -- yesterday -- for the
// first seven hours of every business day.
//
// Owner rule (6 Oct 2026): storage stays ISO, display is dd/mm/yyyy, the
// business day is Cambodia. A fixture whose UTC day equals its business day
// (any noon time) cannot tell the right implementation from the wrong one, so
// the clock is frozen at 18:30Z on purpose.
//
// Run (from cloudflare/): node scripts/test-date-business-day-defaults-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
function load(rel, overrides = {}) {
  const filename = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText
  const mod = { exports: {} }
  const localRequire = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name]
    if (name.startsWith('.')) throw new Error(`${rel}: unexpected dependency ${name}`)
    return require(name)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const FROZEN = Date.parse('2026-10-05T18:30:00.000Z')
function withFrozenClock(fn) {
  const RealDate = Date
  global.Date = class extends RealDate {
    constructor(...args) { if (args.length === 0) super(FROZEN); else super(...args) }
    static now() { return FROZEN }
  }
  const restore = () => { global.Date = RealDate }
  try {
    const result = fn()
    if (result && typeof result.then === 'function') return result.finally(restore)
    restore()
    return result
  } catch (error) { restore(); throw error }
}

// Checks run strictly one after another: several freeze the global clock, and two frozen
// clocks running side by side would corrupt each other.
let passed = 0
const queue = []
function check(name, fn) { queue.push([name, fn]) }

const businessDateWindow = load('lib/businessDateWindow.ts')
const batchCode = load('lib/batchCode.ts')

// --- the instant itself ------------------------------------------------------
check('the fixture instant really is two different days (positive control)', () => {
  assert.equal(new Date(FROZEN).toISOString().slice(0, 10), '2026-10-05', 'the UTC day')
  assert.equal(businessDateWindow.businessToday(FROZEN), '2026-10-06', 'the business day')
})

// --- P13: one ISO-day validator for every date-range query parameter ------------
check('isIsoCalendarDay accepts exactly a real YYYY-MM-DD and nothing else', () => {
  const { isIsoCalendarDay } = businessDateWindow
  for (const good of ['2026-10-06', '2028-02-29', '1999-12-31']) assert.equal(isIsoCalendarDay(good), true, good)
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-10-32', '2026-1-6', '06/10/2026', '2026-10-06T00:00:00Z',
    '2026-10-06 ', ' 2026-10-06', '', 'garbage', null, undefined, 20261006, {}]) {
    assert.equal(isIsoCalendarDay(bad), false, `refuses ${JSON.stringify(bad)}`)
  }
})
check('no query-parameter day validator is spelled out a second time', () => {
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')
  // The two checks every copy repeated: the digit pattern and the round trip through Date.
  const COPY = /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\([^)]*\)[\s\S]{0,160}toISOString\(\)\.slice\(0, 10\) ===? /
  const offenders = ['routes/fees.ts', 'routes/returns.ts', 'routes/shifts.ts', 'routes/compat.ts', 'lib/invoiceReadWindow.ts',
    'lib/returnExportWindow.ts', 'lib/continuousReadWindow.ts', 'routes/products.ts'].filter((rel) => COPY.test(read(rel)))
  assert.deepEqual(offenders, [], 'these files still carry their own ISO-day check instead of isIsoCalendarDay')
  // Positive control: the detector fires on the shape it hunts.
  assert.equal(COPY.test("const ok = /^\\d{4}-\\d{2}-\\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value"), true)
  for (const rel of ['routes/fees.ts', 'routes/returns.ts', 'routes/shifts.ts', 'routes/compat.ts', 'lib/invoiceReadWindow.ts', 'lib/returnExportWindow.ts', 'lib/continuousReadWindow.ts']) {
    assert.match(read(rel), /isIsoCalendarDay/, `${rel} validates through the shared helper`)
  }
})

// --- productBatches: default received date, lot matching, FIFO order ----------
const moneyPrecision = load('lib/moneyPrecision.ts')
const sqlBinding = load('lib/sqlBinding.ts')
const productBatches = load('lib/productBatches.ts', {
  './receivingBranch': load('lib/receivingBranch.ts'),
  './batchCode': batchCode,
  './businessDateWindow': businessDateWindow,
  './moneyPrecision': moneyPrecision,
  './sqlBinding': sqlBinding,
  './db': {},
})

check('a blank received date defaults to the BUSINESS day, a typed one is read day-first', () => {
  withFrozenClock(() => {
    assert.equal(productBatches.resolveReceivedDate(''), '2026-10-06', 'blank -> Cambodia day, not the UTC day 2026-10-05')
    assert.equal(productBatches.resolveReceivedDate(null), '2026-10-06')
    assert.equal(productBatches.resolveReceivedDate(undefined), '2026-10-06')
    assert.equal(productBatches.resolveReceivedDate('   '), '2026-10-06')
  })
  assert.equal(productBatches.resolveReceivedDate('25/12/2026'), '2026-12-25', 'a day past the 12th proves the day-first reading')
  assert.equal(productBatches.resolveReceivedDate('03/04/2026'), '2026-04-03', '3 April, not 4 March')
  assert.equal(productBatches.resolveReceivedDate('2026-10-01'), '2026-10-01')
})

check('an unreadable received date is refused, never silently replaced by today', () => {
  withFrozenClock(() => {
    for (const bad of ['13/13/2026', 'not a date', '2026-02-30', '12/25/2026', '2026-10-06garbage']) {
      assert.throws(() => productBatches.resolveReceivedDate(bad), /valid date \(dd\/mm\/yyyy\)/, `refuses ${bad}`)
    }
  })
})

check('lotReceivedDate reads every shape a stored received_at can have', () => {
  assert.equal(productBatches.lotReceivedDate('2026-10-05'), '2026-10-05', 'date-only ISO')
  assert.equal(productBatches.lotReceivedDate('2026-10-05 18:30:00'), '2026-10-05', "SQLite datetime (old default batch, migration 0032)")
  assert.equal(productBatches.lotReceivedDate('2026-10-05T18:30:00.000Z'), '2026-10-05', 'ISO T...Z')
  assert.equal(productBatches.lotReceivedDate('03/04/2026'), '2026-03-04', 'legacy slash: the pre-0077 importer read it MONTH-first')
  assert.equal(productBatches.lotReceivedDate('9/3/2026'), '2026-09-03')
  assert.equal(productBatches.lotReceivedDate(null), '')
  assert.equal(productBatches.lotReceivedDate('2029'), '', 'a year-only value is not a date')
})

check('M2: a same-date receipt tops up the existing lot whatever shape its received_at has', () => {
  const lot = (id, receivedAt) => ({ id, batch_key: `k${id}`, received_at: receivedAt, unit_cost_usd: 2 })
  const target = (lots, date) => productBatches.resolveReceiptLotTarget(lots, date, 2, 0).existingBatchId
  assert.equal(target([lot(1, '2026-10-05')], '2026-10-05'), 1, 'date-only')
  assert.equal(target([lot(2, '2026-10-05 18:30:00')], '2026-10-05'), 2, 'SQLite datetime')
  // The discriminating case: a legacy slash lot never matched under slice(0, 10), so a same-day
  // receipt created a twin lot.
  assert.equal(target([lot(3, '03/04/2026')], '2026-03-04'), 3, 'legacy month-first slash lot is found by the date it spells')
  assert.equal(target([lot(4, '03/04/2026')], '2026-04-03'), null, 'and is NOT the day-first reading')
})

check('M1: FIFO draws the oldest lot first whatever shape received_at has', async () => {
  const raw = openDb(loadAll())
  const db = {
    prepare(sql) {
      const stmt = raw.prepare(sql)
      return { get: (p) => stmt.get(p), all: (p) => stmt.all(p) ?? [], run: (p) => stmt.run(p) }
    },
  }
  raw.exec(`INSERT INTO branches (id, name) VALUES (1, 'Shop') ON CONFLICT(id) DO NOTHING`)
  raw.exec(`INSERT INTO products (id, name, is_active) VALUES (1, 'Fifo Fixture', 1)`)
  // oldest -> newest by the DATE each spells. Insertion order is scrambled on purpose.
  const lots = [
    { id: 11, received_at: '2026-10-05T18:30:00.000Z', label: 'ISO instant, 5 Oct' },
    { id: 12, received_at: '10/04/2026', label: 'legacy slash, 4 Oct (month-first)' },
    { id: 13, received_at: '2026-10-05 02:00:00', label: 'SQLite datetime, 5 Oct early' },
    { id: 14, received_at: '9/3/2026', label: 'legacy single-digit slash, 3 Sep' },
    { id: 15, received_at: '2026-10-03', label: 'date-only, 3 Oct' },
    { id: 16, received_at: '2026-10-05', label: 'date-only, 5 Oct' },
    { id: 17, received_at: null, label: 'undated' },
  ]
  for (const lot of lots) {
    raw.prepare('INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number) VALUES (@id, 1, @key, @key, @at, 1, @id)')
      .run({ id: lot.id, key: `fifo-${lot.id}`, at: lot.received_at })
    raw.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@id, 1, 5)').run({ id: lot.id })
  }
  const order = (await productBatches.readFifoLotAvailability(db, 1, 1)).map((row) => row.batchId)
  // 3 Sep, 3 Oct, 4 Oct, then 5 Oct (date-only < 02:00 < 18:30 by their raw text tiebreak), undated last.
  assert.deepEqual(order, [14, 15, 12, 16, 13, 11, 17])
  // Control: the raw-text order the old query produced is DIFFERENT -- slash lots first or last, wrongly.
  const rawOrder = lots.slice().sort((a, b) => (a.received_at === null) - (b.received_at === null) || String(a.received_at).localeCompare(String(b.received_at))).map((l) => l.id)
  assert.notDeepEqual(rawOrder, order, 'the fixture must separate the parsed order from the raw-text order')
  const cart = await productBatches.readFifoLotAvailabilityForCart(db, [{ productId: 1, branchId: 1 }])
  assert.deepEqual(cart.get('1:1').map((row) => row.batchId), order, 'the cart reader orders the same way')
})

// --- productWrites: the default "day added" lot -----------------------------------
check('W10/W11: the default lot is received on the business day, as ISO, and its code comes from the SAME day', async () => {
  const raw = openDb(loadAll())
  const cdb = { prepare: (sql) => { const stmt = raw.prepare(sql); return { get: (p) => stmt.get(p), all: (p) => stmt.all(p) ?? [], run: (p) => stmt.run(p) } }, async batch(items) { for (const item of items) raw.prepare(item.sql).run(item.params || {}) } }
  const lazy = new Proxy({}, { get: (_t, prop) => () => { throw new Error(`unexpected productWrites dependency: ${String(prop)}`) } })
  const productWrites = load('lib/productWrites.ts', {
    './db': { getDb: () => cdb }, './schemaProbe': lazy, './media': lazy, './batchCode': batchCode, './businessDateWindow': businessDateWindow,
    './searchMatch': lazy, './importImageMatch': { MAX_IMAGES_PER_PRODUCT: 10 }, '../index': {}, './moneyPrecision': moneyPrecision,
    './catalogCostRecompute': lazy, './receivingBranch': lazy, './businessMaintenanceGuard': lazy, './pendingActions': lazy, './audit': lazy,
  })
  raw.exec(`INSERT INTO branches (id, name) VALUES (1, 'Shop') ON CONFLICT(id) DO NOTHING`)
  raw.exec(`INSERT INTO products (id, name, is_active) VALUES (501, 'Seed Fixture', 1)`)
  await withFrozenClock(() => productWrites.seedInitialBatchForNewProduct({ DB: {} }, 501, 1, 3))
  const row = raw.prepare(`SELECT received_at, lot_code FROM product_batches WHERE variant_product_id = 501 AND batch_key = 'initial:501'`).get()
  assert.equal(row.received_at, '2026-10-06', 'a DATE column holds a date, not a datetime stamp, and it is the business day')
  assert.equal(row.lot_code, '10062026', 'the lot code is cut from the same business day')
  assert.equal(batchCode.dateToBatchCode(row.received_at), row.lot_code, 'received_at and lot_code derive from one date')
})

// --- the product date columns: parse-and-reject --------------------------------
check('normalizeProductDateFields reads day-first, refuses unreadable, and lets an unchanged legacy value through', () => {
  const lazy = new Proxy({}, { get: () => () => { throw new Error('unexpected') } })
  const { normalizeProductDateFields } = load('lib/productWrites.ts', {
    './db': {}, './schemaProbe': lazy, './media': lazy, './batchCode': batchCode, './businessDateWindow': businessDateWindow,
    './searchMatch': lazy, './importImageMatch': { MAX_IMAGES_PER_PRODUCT: 10 }, '../index': {}, './moneyPrecision': moneyPrecision,
    './catalogCostRecompute': lazy, './receivingBranch': lazy, './businessMaintenanceGuard': lazy, './pendingActions': lazy, './audit': lazy,
  })
  const ok = { expiry_date: '25/12/2026', discount_starts_at: '2026-10-1', discount_ends_at: '' }
  assert.equal(normalizeProductDateFields(ok, null), null)
  assert.deepEqual(ok, { expiry_date: '2026-12-25', discount_starts_at: '2026-10-01', discount_ends_at: null })
  assert.equal(normalizeProductDateFields({ expiry_date: '13/13/2026' }, null), 'expiry_date')
  assert.equal(normalizeProductDateFields({ expiry_date: '2029' }, null), 'expiry_date', 'a year-only text is not a date')
  assert.equal(normalizeProductDateFields({ discount_ends_at: 'soon' }, null), 'discount_ends_at')
  const absent = { name: 'untouched' }
  assert.equal(normalizeProductDateFields(absent, null), null)
  assert.deepEqual(absent, { name: 'untouched' }, 'an absent field is not invented')
  // A legacy row re-sent unchanged by the product form must stay editable ...
  const resent = { expiry_date: '2029' }
  assert.equal(normalizeProductDateFields(resent, { expiry_date: '2029' }), null)
  assert.equal(resent.expiry_date, '2029', '... and is left exactly as it was')
  // ... but CHANGING it to garbage is still refused.
  assert.equal(normalizeProductDateFields({ expiry_date: '2030' }, { expiry_date: '2029' }), 'expiry_date')
  // An older writer's instant keeps its time of day.
  const instant = { discount_ends_at: '2026-10-06T16:59:59.000Z' }
  assert.equal(normalizeProductDateFields(instant, null), null)
  assert.equal(instant.discount_ends_at, '2026-10-06T16:59:59.000Z')
})

// --- the dashboard expiry window --------------------------------------------------
check('M8: the expiry window and its day count run on the BUSINESS day', () => {
  const lazy = new Proxy({}, { get: () => () => { throw new Error('unexpected') } })
  const overview = load('lib/dashboardStockOverview.ts', {
    './db': lazy, './cache': lazy, './familyStockStats': lazy, './lowStockSettings': lazy, './planTier': lazy, './businessDateWindow': businessDateWindow,
  })
  const raw = openDb(loadAll())
  raw.exec(`INSERT INTO products (id, name, is_active, expiry_date, expiry_alert_days) VALUES
    (1, 'expires on the business day', 1, '2026-10-06', 0),
    (2, 'expired the business day before', 1, '2026-10-05', 0),
    (3, 'ten days out', 1, '2026-10-16', 10),
    (4, 'eleven days out', 1, '2026-10-17', 10)`)
  // SQLite cannot freeze 'now', so run the REAL shipped SQL with its 'now' replaced by the frozen instant.
  const at = (sql) => sql.split("'now'").join("'2026-10-05 18:30:00'")
  const ids = raw.prepare(at(`SELECT id FROM products p WHERE ${overview.DASHBOARD_EXPIRY_WHERE_SQL} ORDER BY id`)).all().map((r) => r.id)
  assert.deepEqual(ids, [1, 2, 3], 'product 1 expires on the Cambodia day (6 Oct) and is inside a 0-day window; the UTC reading (5 Oct) would drop it')
  const days = Object.fromEntries(raw.prepare(at(`SELECT id, ${overview.DASHBOARD_DAYS_UNTIL_EXPIRY_SQL} AS d FROM products p WHERE ${overview.DASHBOARD_EXPIRY_WHERE_SQL}`)).all().map((r) => [r.id, r.d]))
  assert.deepEqual(days, { 1: 0, 2: -1, 3: 10 }, 'whole days from the business today')
  // Control: the old UTC predicate on the same data differs, so this fixture can tell them apart.
  const oldWhere = `p.is_active = 1 AND expiry_date IS NOT NULL AND date(expiry_date) <= date('now', '+' || COALESCE(expiry_alert_days, 30) || ' day')`
  const oldIds = raw.prepare(at(`SELECT id FROM products p WHERE ${oldWhere} ORDER BY id`)).all().map((r) => r.id)
  assert.notDeepEqual(oldIds, ids, 'control: the UTC-day predicate answers differently at this instant')
  // The cache key rolls over at the Cambodia midnight, not the UTC one.
  const key = (nowMs) => overview.dashboardStockOverviewKey({ productsVersion: '1', stockVersion: '1', lowStock: { enabled: true, mode: 'fixed', threshold: 10 }, businessDate: businessDateWindow.businessToday(nowMs) })
  assert.notEqual(key(Date.parse('2026-10-05T16:59:59Z')), key(Date.parse('2026-10-05T17:00:01Z')), 'the key changes at 17:00Z = 00:00 Cambodia')
  assert.equal(key(Date.parse('2026-10-05T17:00:01Z')), key(Date.parse('2026-10-05T23:59:59Z')), 'and stays put until the next Cambodia midnight')
})

// --- the index still serves the new predicate ------------------------------------
check('M8: the business-day predicate still seeks idx_products_active_expiry_day (no scan, no sort)', () => {
  const lazy = new Proxy({}, { get: () => () => { throw new Error('unexpected') } })
  const overview = load('lib/dashboardStockOverview.ts', {
    './db': lazy, './cache': lazy, './familyStockStats': lazy, './lowStockSettings': lazy, './planTier': lazy, './businessDateWindow': businessDateWindow,
  })
  const raw = openDb(loadAll())
  const plan = (sql) => raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row) => row.detail).join(' | ')
  const list = plan(`SELECT id FROM products p WHERE ${overview.DASHBOARD_EXPIRY_WHERE_SQL} ORDER BY date(expiry_date) ASC LIMIT 10`)
  const count = plan(`SELECT COUNT(*) AS count FROM products p WHERE ${overview.DASHBOARD_EXPIRY_WHERE_SQL}`)
  assert.match(list, /idx_products_active_expiry_day/, list)
  assert.doesNotMatch(list, /TEMP B-TREE/, list)
  assert.match(count, /idx_products_active_expiry_day/, count)
})

;(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed += 1; console.log('PASS', name) } catch (error) { console.log('FAIL', name, '-', error.message); process.exitCode = 1 }
  }
  console.log(`\n${passed}/${queue.length} check(s) passed`)
})()
