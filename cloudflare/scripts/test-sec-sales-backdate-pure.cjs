// N3 (loophole review 2026-10-06): POST /api/sales stored any past client
// created_at, so a cash sale could be moved into yesterday's closed shift.
// Offline selling is retired; a client moment is honoured only within
// device-clock skew of the server (lib/clientTimestamp.ts) and anything older
// records at the server clock, with the refused claim kept in the creation
// audit for review.
//
// Discriminating: on 4ab47676e (SEC_SALES_BASELINE=1) the three-day-old
// moment is stored as sent, so the first assertion fails there. The control
// (two minutes ago, inside the skew) is still stored as sent, so a fix that
// ignored every client moment would fail it -- the rule is a window, not a ban.
const assert = require('node:assert/strict')
const h = require('./harness/sec_sales_route.cjs')

const sqliteUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
const ageMs = (stored) => Date.now() - Date.parse(`${stored.replace(' ', 'T')}Z`)

;(async () => {
  h.setUser(h.USER)
  const f = h.fixture()
  h.openShift(f.raw, h.USER)

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const backdated = await h.postSale(f.route, { ...h.request('n3-backdated'), created_at: threeDaysAgo })
  assert.equal(backdated.status, 200, JSON.stringify(backdated.body).slice(0, 240))
  const stored = f.raw.prepare("SELECT id, created_at FROM sales WHERE client_request_id='n3-backdated'").get()
  assert.ok(Math.abs(ageMs(stored.created_at)) < 2 * 60 * 1000,
    `a three-day-old client moment must record at the server clock; stored ${stored.created_at} (sent ${threeDaysAgo})`)
  if (!h.baseline) {
    const audit = JSON.parse(f.raw.prepare(`SELECT details FROM audit_logs WHERE entity='sale_creation' AND entity_id='${Number(stored.id)}'`).get().details)
    assert.equal(audit.origin, 'pos')
    assert.equal(audit.refusedClientCreatedAt, threeDaysAgo, 'the refused claim is kept for review')
  }
  console.log('PASS a backdated sale records at the server clock, and the refused claim is audited')

  const twoMinutesAgoMs = Date.now() - 2 * 60 * 1000
  const near = await h.postSale(f.route, { ...h.request('n3-near'), created_at: new Date(twoMinutesAgoMs).toISOString() })
  assert.equal(near.status, 200, JSON.stringify(near.body).slice(0, 240))
  assert.equal(f.raw.prepare("SELECT created_at FROM sales WHERE client_request_id='n3-near'").get().created_at, sqliteUtc(twoMinutesAgoMs),
    'control: a moment inside device-clock skew is still honoured')
  console.log('PASS control: a client moment inside the skew window is kept')
})().catch((error) => { console.error(error); process.exit(1) })
