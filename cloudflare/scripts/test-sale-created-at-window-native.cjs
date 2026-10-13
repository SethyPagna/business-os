'use strict'
// B1 (whole-app security audit, 13 Oct 2026): POST /api/sales stored any past
// created_at a POS user sent, so a cashier could take cash today and record the
// sale on an old, closed business day -- today's shift expected-cash then
// excludes it. Offline selling was cancelled (26 Sep), so nothing legitimate
// sends a past-dated sale.
//
// Drives the REAL Worker on workerd + D1 as an Employee holding only pos+sales.
// A claim inside [server now - 10 min, server now + 2 min] is kept (positive
// control, so a refusal cannot be a harness that never honors a claim); any
// other claim is stored as the server clock and recorded as a normal POS sale.
//
// Run (from cloudflare/): node scripts/run-native-suite.cjs sale-created-at-window
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
const storedMs = value => Date.parse(`${String(value).replace(' ', 'T')}Z`)
const storedShape = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')

async function main() {
  const h = await H.startWorker()
  const r = H.recorder('SALE-TIME')
  try {
    await H.seedProduct(h, 12, 'Window Lipstick', 5, 50, 2)
    const cookie = await h.addEmployee(950, 'window_cashier', { pos: true, sales: true })
    const asEmployee = { ...h, call: (method, url, body, label, options = {}) => h.call(method, url, body, label, { cookie, ...options }) }
    const sell = (key, createdAt) => H.createSale(asEmployee, { key, createdAt, lines: [{ productId: 12, quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }], extra: { offline_owner: { ...h.owner, actor_id: 950 } }, label: `sale claiming ${createdAt}` })
    const read = async key => {
      const row = await h.one("SELECT created_at, creation_snapshot_json, CURRENT_TIMESTAMP AS server_now FROM sales WHERE client_request_id=?", key)
      return { ...row, creation: JSON.parse(row.creation_snapshot_json) }
    }
    const serverClock = (row, label) => {
      const gap = Math.abs(storedMs(row.created_at) - storedMs(row.server_now))
      assert.ok(gap < MINUTE, `${label}: stored ${row.created_at}, server clock ${row.server_now}`)
      assert.equal(row.creation.origin, 'pos')
      assert.equal(row.creation.sale_at, null)
    }

    const thirtyDays = new Date(Date.now() - 30 * DAY).toISOString()
    const month = await sell('window-30-days-0001', thirtyDays)
    const monthRow = await read('window-30-days-0001')
    r.check(`an Employee claiming created_at 30 days ago is stored at the server clock (got ${month.status}, stored ${monthRow.created_at}, server ${monthRow.server_now})`, () => {
      assert.equal(month.status, 200, JSON.stringify(month.body).slice(0, 200))
      serverClock(monthRow, '30 days ago')
    })

    const audit = await sell('window-9-months-0001', '2026-01-02T03:00:00.000Z')
    const auditRow = await read('window-9-months-0001')
    const oldDay = await h.one("SELECT COUNT(*) AS n FROM sales WHERE date(created_at,'+7 hours')='2026-01-02'")
    r.check(`the audit's probe (created_at 2026-01-02) leaves nothing on the closed day (got ${audit.status}, stored ${auditRow.created_at}, ${oldDay.n} sale(s) on 2026-01-02)`, () => {
      assert.equal(audit.status, 200, JSON.stringify(audit.body).slice(0, 200))
      serverClock(auditRow, '2026-01-02')
      assert.equal(oldDay.n, 0)
    })

    const ahead = await sell('window-1-hour-ahead-0001', new Date(Date.now() + 60 * MINUTE).toISOString())
    const aheadRow = await read('window-1-hour-ahead-0001')
    r.check(`a claim one hour ahead is stored at the server clock (got ${ahead.status}, stored ${aheadRow.created_at})`, () => {
      assert.equal(ahead.status, 200, JSON.stringify(ahead.body).slice(0, 200))
      serverClock(aheadRow, '1 hour ahead')
    })

    const garbage = await sell('window-garbage-0001', 'not-a-date')
    const garbageRow = await read('window-garbage-0001')
    r.check(`an unparseable claim is stored at the server clock, not refused (got ${garbage.status}, stored ${garbageRow.created_at})`, () => {
      assert.equal(garbage.status, 200, JSON.stringify(garbage.body).slice(0, 200))
      serverClock(garbageRow, 'garbage')
    })

    const claimedMs = Date.now() - 5 * MINUTE
    const recent = await sell('window-5-minutes-0001', new Date(claimedMs).toISOString())
    const recentRow = await read('window-5-minutes-0001')
    r.check(`control: a claim five minutes ago is kept (got ${recent.status}, stored ${recentRow.created_at}, claimed ${storedShape(claimedMs)})`, () => {
      assert.equal(recent.status, 200, JSON.stringify(recent.body).slice(0, 200))
      assert.equal(recentRow.created_at, storedShape(claimedMs))
      assert.equal(recentRow.creation.origin, 'offline_replay')
      assert.equal(recentRow.creation.sale_at, storedShape(claimedMs))
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} SALE-TIME created_at window: ${r.results.length - failed.length}/${r.results.length} checks hold`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
