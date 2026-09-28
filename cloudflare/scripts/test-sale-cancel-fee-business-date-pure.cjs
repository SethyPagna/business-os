// M7 (SCAN1, 2026-09-28): the lost-fee expense a cancellation writes is dated
// with the Cambodia business day, not the UTC day.
//
// PATCH /api/sales/:id/status wrote fee_date = date('now'), the UTC date. A
// cancel between 00:00 and 06:59 Cambodia time booked the loss on the previous
// business day, after that day's Telegram report had gone out, and outside the
// day the Expenses/Reports range shows it.
//
// Drives the real route on the fully migrated schema with BOTH clocks frozen
// (the Worker's Date and SQLite's 'now'), so a SQL-side fix and a JS-side fix
// are judged by the same instant. Also proves the read-only detection query
// ops/queries/forensics-m7-cancel-fee-business-date.sql on known positives and
// negatives.
//
// Run: node scripts/test-sale-cancel-fee-business-date-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const harnessFile = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const harnessSource = fs.readFileSync(harnessFile, 'utf8')
const boundary = harnessSource.indexOf(';(async () => {')
assert.ok(boundary > 0, 'test-sale-create-atomic-pure.cjs changed shape; update this harness import')
const harness = new Module(harnessFile, module)
harness.filename = harnessFile
harness.paths = module.paths
harness._compile(harnessSource.slice(0, boundary)
  + '\nmodule.exports={fixture,request,postSale,app,executionCtx,USER,setUser(value){currentUser=value}};', harnessFile)
const h = harness.exports

const RealDate = Date
const clock = { sqlNow: null }
function freeze(iso) {
  const ms = RealDate.parse(iso)
  globalThis.Date = class FrozenDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(ms); else super(...args) }
    static now() { return ms }
  }
  clock.sqlNow = iso.slice(0, 19).replace('T', ' ')
}
function thaw() { globalThis.Date = RealDate; clock.sqlNow = null }

function clockedDb(route) {
  const fix = (sql) => (clock.sqlNow ? sql.replace(/'now'/g, `'${clock.sqlNow}'`) : sql)
  const api = {
    prepare: (sql) => route.prepare(fix(sql)),
    batch: (statements) => route.batch(statements.map((statement) => ({ ...statement, sql: fix(statement.sql) }))),
    exec: (sql) => route.exec(fix(sql)),
  }
  api.staging = api
  return api
}

async function cancelWithFee(f, saleId, requestId) {
  const response = await h.app.request(`/${saleId}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sale_status: 'cancelled', cancel_reason: 'buyer_refused', cancel_fee_usd: 3, cancel_fee_khr: 12000,
      client_request_id: requestId,
    }),
  }, { DB: f.db }, h.executionCtx)
  return { status: response.status, body: await response.json() }
}

async function saleCancelledAt(f, key, iso) {
  const created = await h.postSale(f.route, h.request(key))
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const saleId = f.raw.db.prepare('SELECT id FROM sales WHERE client_request_id=?').get(key).id
  freeze(iso)
  try {
    const cancelled = await cancelWithFee(f, saleId, `${key}-cancel`)
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
  } finally {
    thaw()
  }
  return f.raw.db.prepare(`SELECT f.id, f.fee_date, s.cancelled_at, date(s.cancelled_at, '+7 hours') AS business_date
    FROM sales s JOIN fees f ON f.id = s.cancel_fee_id WHERE s.id = ?`).get(saleId)
}

const detection = fs.readFileSync(path.join(__dirname, '..', '..', 'ops', 'queries', 'forensics-m7-cancel-fee-business-date.sql'), 'utf8')

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}\n      ${error && error.message}`) }
}

;(async () => {
  h.setUser({ ...h.USER, permissions: JSON.stringify({ all: true }) })
  const f = h.fixture()
  f.db = clockedDb(f.route)
  f.route = f.db

  await check('a cancel at 00:30 Cambodia time books the lost fee on that business day', async () => {
    const fee = await saleCancelledAt(f, 'm7-after-midnight', '2031-01-15T17:30:00.000Z')
    assert.ok(fee, 'the cancellation wrote no linked lost-fee expense')
    assert.equal(fee.cancelled_at.slice(0, 16), '2031-01-15 17:30', 'fixture clock: the cancel instant is 17:30 UTC')
    assert.equal(fee.fee_date, '2031-01-16', 'fee_date must be the Cambodia business day (UTC+7), not the UTC day')
    assert.equal(fee.fee_date, fee.business_date)
  })

  await check('control: a daytime cancel lands on the same day either way', async () => {
    const fee = await saleCancelledAt(f, 'm7-daytime', '2031-01-16T03:00:00.000Z')
    assert.equal(fee.fee_date, '2031-01-16')
  })

  await check('detection query flags UTC-dated cancellation fees and nothing else', () => {
    const raw = f.raw.db
    const addSale = (id, cancelledAt, feeId) => raw.prepare(`INSERT INTO sales (id, receipt_number, branch_id, sale_status, cancelled_at, cancel_fee_id, subtotal_usd, total_usd)
      VALUES (?, ?, 1, 'cancelled', ?, ?, 5, 5)`).run(id, `R-M7-${id}`, cancelledAt, feeId)
    const addFee = (id, saleId, feeDate) => raw.prepare(`INSERT INTO fees (id, fee_type, label, amount_usd, amount_khr, fee_date, sale_id, branch_id)
      VALUES (?, 'expense', ?, 2, 8000, ?, ?, 1)`).run(id, `Cancelled sale R-M7-${saleId} -- lost fee`, feeDate, saleId)
    // Positive: single-sale cancel at 01:30 Cambodia, dated with the UTC day (the old date('now')).
    addSale(9001, '2031-02-01 18:30:00', 7001); addFee(7001, 9001, '2031-02-01')
    // Positive: grouped cancel at 05:00 Cambodia, dated stamp.slice(0, 10) (ISO stamp, negative fee id).
    addSale(9002, '2031-02-02T22:00:00.000Z', -7002); addFee(-7002, 9002, '2031-02-02')
    // Negative: same instant, already on the business day.
    addSale(9003, '2031-02-03 18:30:00', 7003); addFee(7003, 9003, '2031-02-04')
    // Negative: an unlinked expense on the sale (not its cancellation fee).
    addSale(9004, '2031-02-05 18:30:00', null); addFee(7004, 9004, '2031-02-05')
    const rows = raw.prepare(detection).all()
    assert.deepEqual(rows.map((row) => row.fee_id).sort((a, b) => a - b), [-7002, 7001])
    const single = rows.find((row) => row.fee_id === 7001)
    assert.equal(single.business_date, '2031-02-02')
    assert.equal(single.writer, 'single')
    assert.equal(rows.find((row) => row.fee_id === -7002).writer, 'grouped')
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
})().catch((error) => { console.error(error); process.exit(1) })
