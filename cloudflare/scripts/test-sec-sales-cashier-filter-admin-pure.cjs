// N16 (loophole review 2026-10-06): the sales list and stats refused a
// non-administrator's cashier-ID filter but answered the same question asked
// by cashier NAME. Both forms are now one administrator rule.
//
// Discriminating: the baseline route (SEC_SALES_BASELINE=1) answers the name
// filter with 200 for the non-admin, so the first assertion fails there. The
// unfiltered list stays 200 for the same user, so a rule that simply refused
// every non-admin read would fail the control below.
const assert = require('node:assert/strict')
const h = require('./harness/sec_sales_route.cjs')

const viewer = { id: 81, username: 'sales_viewer', name: 'Sales Viewer', permissions: JSON.stringify({ sales: true }) }
const admin = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: JSON.stringify({ all: true }) }

;(async () => {
  const f = h.fixture()
  // One real sale so a filtered answer has something it could leak.
  h.setUser(h.USER)
  const created = await h.postSale(f.route, h.request('n16-seed'))
  if (created.status !== 200) {
    // After N2 a sale needs an open shift; register one and retry.
    h.openShift(f.raw, h.USER)
    const retried = await h.postSale(f.route, h.request('n16-seed'))
    assert.equal(retried.status, 200, JSON.stringify(retried.body))
  }

  for (const route of ['/', '/stats']) {
    h.setUser(viewer)
    const byName = await h.call(f.route, 'GET', `${route}?cashier=sale_cashier`)
    assert.equal(byName.status, 403, `${route} cashier-name filter must be admin-only; got ${byName.status} ${JSON.stringify(byName.body).slice(0, 200)}`)
    assert.match(byName.body.error, /Administrator access required for cashier user filters/)
    const byId = await h.call(f.route, 'GET', `${route}?userId=71`)
    assert.equal(byId.status, 403, `${route} cashier-id filter stays admin-only`)
    const unfiltered = await h.call(f.route, 'GET', route)
    assert.equal(unfiltered.status, 200, `${route} control: an unfiltered read is still allowed for a sales viewer`)

    h.setUser(admin)
    const adminByName = await h.call(f.route, 'GET', `${route}?cashier=sale_cashier`)
    assert.equal(adminByName.status, 200, `${route} administrators keep the name filter: ${JSON.stringify(adminByName.body).slice(0, 200)}`)
    console.log(`PASS ${route}: cashier name and id filters share one administrator rule`)
  }
  h.setUser(h.USER)
})().catch((error) => { console.error(error); process.exit(1) })
