// N15 (loophole review 2026-10-06): POST /api/sales booked any positive
// client exchange rate. A rate outside the band around the Settings rate is
// now refused before any write (lib/saleExchangeRateBand.ts, 5%).
//
// Discriminating: on 4ab47676e (SEC_SALES_BASELINE=1) the 6,000-riel quote
// against a 4,100 Settings rate records a sale, so the first assertion fails
// there. The controls exclude the two plausible wrong fixes: refusing every
// client rate (the in-band 4,000 quote must still record) and a fixed
// absolute range (6,000 must record once Settings itself says 6,000).
const assert = require('node:assert/strict')
const h = require('./harness/sec_sales_route.cjs')

function quotedAt(id, rate) {
  const body = h.request(id)
  body.exchange_rate = rate
  // The line quote carries its riel total at the quoted rate, exactly as the
  // till computes it; only the rate itself is under test.
  body.items[0].pricing_quote = { ...body.items[0].pricing_quote, total_khr: 9.5 * rate }
  return body
}

;(async () => {
  h.setUser(h.USER)
  {
    const f = h.fixture()
    h.openShift(f.raw, h.USER)
    const before = h.creationState(f.raw)
    const refused = await h.postSale(f.route, quotedAt('n15-far', 6000))
    assert.equal(refused.status, 409, `a 6,000 quote against the 4,100 default must be refused; got ${refused.status} ${JSON.stringify(refused.body).slice(0, 240)}`)
    assert.equal(refused.body.code, 'exchange_rate_out_of_range')
    assert.deepEqual(h.creationState(f.raw), before, 'nothing was written')
    console.log('PASS a quote 46% above the Settings rate is refused with nothing written')

    const low = await h.postSale(f.route, quotedAt('n15-low', 3000))
    assert.equal(low.status, 409, JSON.stringify(low.body).slice(0, 240))
    assert.equal(low.body.code, 'exchange_rate_out_of_range')
    console.log('PASS a quote far below the Settings rate is refused too')

    const near = await h.postSale(f.route, quotedAt('n15-near', 4000))
    assert.equal(near.status, 200, `control: 4,000 is within 5% of 4,100: ${JSON.stringify(near.body).slice(0, 240)}`)
    assert.equal(f.raw.prepare("SELECT exchange_rate FROM sales WHERE client_request_id='n15-near'").get().exchange_rate, 4000)
    console.log('PASS control: an in-band quote is booked at the quoted rate (prospective rate changes keep working)')
  }
  {
    const f = h.fixture()
    h.openShift(f.raw, h.USER)
    f.raw.prepare("INSERT INTO settings(key,value) VALUES('exchange_rate','6000') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const ok = await h.postSale(f.route, quotedAt('n15-settings', 6000))
    assert.equal(ok.status, 200, `control: the band follows Settings, not a fixed range: ${JSON.stringify(ok.body).slice(0, 240)}`)
    console.log('PASS control: the band is relative to the Settings rate')
  }
})().catch((error) => { console.error(error); process.exit(1) })
