// N14 (loophole review 2026-10-06): POST /api/sales checked that a member HAD
// the points being redeemed, then booked whatever membership_discount_usd the
// request carried. The Worker now computes the value itself -- points /
// customer_portal_redeem_points whole units x customer_portal_redeem_value_usd
// (lib/membershipRedemption.ts) -- refuses a request that claims anything
// else, and derives the riel figure at the sale's rate.
//
// Discriminating: on 4ab47676e (SEC_SALES_BASELINE=1) redeeming 100 points
// for the whole $9.50 records a $0 sale, so the first assertion fails there.
// The honest control must still record, at the server-derived riel figure
// (the request's 99,999 riel is ignored -- the baseline stores it), so a fix
// that refused every redemption, or kept trusting the riel, fails too.
const assert = require('node:assert/strict')
const h = require('./harness/sec_sales_route.cjs')

function memberFixture() {
  const f = h.fixture()
  h.openShift(f.raw, h.USER)
  // The migrated schema seeds the programme switched off; this suite is about its value.
  f.raw.prepare("INSERT INTO settings(key,value) VALUES('loyalty_points_enabled','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  f.raw.prepare("INSERT INTO customers(id,name,membership_number,is_anonymous) VALUES(5,'Member','M-5',0)").run()
  f.raw.prepare("INSERT INTO loyalty_point_adjustments(customer_id,points,note) VALUES(5,500,'opening balance')").run()
  return f
}
function redeeming(id, { points, discountUsd, discountKhr, paidUsd }) {
  return {
    ...h.request(id),
    customer_id: 5,
    membership_points_redeemed: points,
    membership_discount_usd: discountUsd,
    ...(discountKhr === undefined ? {} : { membership_discount_khr: discountKhr }),
    amount_paid_usd: paidUsd,
  }
}

;(async () => {
  h.setUser(h.USER)
  {
    const f = memberFixture()
    const before = h.creationState(f.raw)
    const inflated = await h.postSale(f.route, redeeming('n14-inflated', { points: 100, discountUsd: 9.5, paidUsd: 0 }))
    assert.equal(inflated.status, 409, `100 points are worth $1, not $9.50; got ${inflated.status} ${JSON.stringify(inflated.body).slice(0, 240)}`)
    assert.equal(inflated.body.code, 'membership_discount_mismatch')
    assert.deepEqual(h.creationState(f.raw), before, 'nothing was written')
    console.log('PASS an inflated points discount is refused with nothing written')

    const partUnit = await h.postSale(f.route, redeeming('n14-part-unit', { points: 150, discountUsd: 1.5, paidUsd: 8 }))
    assert.equal(partUnit.status, 409, JSON.stringify(partUnit.body).slice(0, 240))
    assert.equal(partUnit.body.code, 'membership_discount_mismatch')
    console.log('PASS points that are not whole redemption units are refused')

    const honest = await h.postSale(f.route, redeeming('n14-honest', { points: 100, discountUsd: 1, discountKhr: 99999, paidUsd: 8.5 }))
    assert.equal(honest.status, 200, `control: the configured value records: ${JSON.stringify(honest.body).slice(0, 240)}`)
    const row = f.raw.prepare("SELECT membership_discount_usd AS usd, membership_discount_khr AS khr, membership_points_redeemed AS pts, total_usd FROM sales WHERE client_request_id='n14-honest'").get()
    assert.deepEqual({ ...row }, { usd: 1, khr: 4000, pts: 100, total_usd: 8.5 }, 'riel derived at the sale rate (4,000), not taken from the request')
    console.log('PASS control: the configured value records, and its riel is derived by the Worker')
  }
  {
    const f = memberFixture()
    f.raw.prepare("INSERT INTO settings(key,value) VALUES('customer_portal_redeem_value_usd','0.25') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    f.raw.prepare("INSERT INTO settings(key,value) VALUES('customer_portal_redeem_points','50') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const configured = await h.postSale(f.route, redeeming('n14-configured', { points: 200, discountUsd: 1, paidUsd: 8.5 }))
    assert.equal(configured.status, 200, `control: 200 points at 50 per $0.25 unit is $1: ${JSON.stringify(configured.body).slice(0, 240)}`)
    const stale = await h.postSale(f.route, redeeming('n14-stale', { points: 200, discountUsd: 2, paidUsd: 7.5 }))
    assert.equal(stale.status, 409, 'the value follows Settings, not a fixed $1 per 100 points')
    console.log('PASS the value follows the configured points-per-unit and value-per-unit')
  }
  {
    const f = memberFixture()
    const plain = await h.postSale(f.route, { ...h.request('n14-none'), customer_id: 5, membership_discount_usd: 3, amount_paid_usd: 9.5 })
    assert.equal(plain.status, 200, JSON.stringify(plain.body).slice(0, 240))
    assert.equal(f.raw.prepare("SELECT membership_discount_usd AS usd FROM sales WHERE client_request_id='n14-none'").get().usd, 0)
    console.log('PASS a discount with no points redeemed still books $0 (unchanged)')
  }
})().catch((error) => { console.error(error); process.exit(1) })
