// N2 (loophole review 2026-10-06): the POS shift prompt lived only in the
// browser, so POST /api/sales recorded a sale with no shift, or after End
// Shift -- cash no drawer reconciliation expects. The Worker now requires the
// cashier's OPEN shift for today (lib/saleShiftRequirement.ts), checked
// before any write and again inside the write batch.
//
// Discriminating: on 4ab47676e (SEC_SALES_BASELINE=1) the no-shift sale
// records, so the first assertion fails there. Controls exclude the plausible
// wrong fixes: an open shift records; yesterday's still-open row does not
// count for today; an exempt administrator sells without one; a shop-wide
// shift opened by a colleague covers this cashier; and the batch guard
// refuses a sale whose shift was ended after the preflight passed.
const assert = require('node:assert/strict')
const h = require('./harness/sec_sales_route.cjs')

const admin = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const colleague = { id: 72, username: 'colleague', name: 'Colleague' }

async function expectRefused(f, id, code, why) {
  const before = h.creationState(f.raw)
  const result = await h.postSale(f.route, h.request(id))
  assert.equal(result.status, 409, `${why}; got ${result.status} ${JSON.stringify(result.body).slice(0, 240)}`)
  assert.equal(result.body.code, code, why)
  assert.deepEqual(h.creationState(f.raw), before, `${why}: nothing was written`)
}
async function expectRecorded(f, id, why) {
  const result = await h.postSale(f.route, h.request(id))
  assert.equal(result.status, 200, `${why}: ${JSON.stringify(result.body).slice(0, 240)}`)
}

;(async () => {
  h.setUser(h.USER)
  {
    const f = h.fixture()
    await expectRefused(f, 'n2-none', 'sale_shift_required', 'a cashier with no shift today cannot record a sale')
    console.log('PASS no shift today: refused, nothing written')
  }
  {
    const f = h.fixture()
    h.openShift(f.raw, h.USER, { closed: true })
    await expectRefused(f, 'n2-closed', 'sale_shift_closed', 'a sale after End Shift is refused')
    console.log('PASS after End Shift: refused, nothing written')
  }
  {
    const f = h.fixture()
    h.openShift(f.raw, h.USER, { cancelled: true })
    await expectRefused(f, 'n2-cancelled', 'sale_shift_required', 'a cancelled shift is no shift')
    console.log('PASS cancelled shift: refused as unregistered')
  }
  {
    const f = h.fixture()
    const yesterday = f.raw.prepare("SELECT date('now','+7 hours','-1 day') AS d").get().d
    h.openShift(f.raw, h.USER, { businessDate: yesterday })
    await expectRefused(f, 'n2-yesterday', 'sale_shift_required', "yesterday's open shift does not cover today")
    console.log("PASS yesterday's still-open shift does not cover today's sale")
  }
  {
    const f = h.fixture()
    h.openShift(f.raw, h.USER)
    await expectRecorded(f, 'n2-open', 'control: an open shift today records')
    console.log('PASS control: an open shift today records')
  }
  {
    const f = h.fixture()
    h.openShift(f.raw, h.USER, { branchId: null })
    await expectRecorded(f, 'n2-unbranched', 'control: a shift registered without a branch covers the sale')
    console.log('PASS control: a shift registered without a branch covers the Shop sale')
  }
  {
    const f = h.fixture()
    h.setUser(admin)
    await expectRecorded(f, 'n2-admin', 'control: an exempt administrator sells without a shift')
    f.raw.prepare("INSERT INTO settings(key,value) VALUES('shift_admin_exempt','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    await expectRefused(f, 'n2-admin-not-exempt', 'sale_shift_required', 'an administrator is held to shifts when Settings says so')
    h.setUser(h.USER)
    console.log('PASS administrators follow shift_admin_exempt')
  }
  {
    const f = h.fixture()
    f.raw.prepare("INSERT INTO settings(key,value) VALUES('shift_scope_mode','shop_wide') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    h.openShift(f.raw, colleague, { scopeMode: 'shop_wide' })
    await expectRecorded(f, 'n2-shop-wide', "control: the shop's shift covers every cashier under shop_wide")
    console.log('PASS shop-wide: a colleague-opened shop shift covers this cashier')
  }
  {
    const f = h.fixture({
      beforeBatch: async (db) => { db.prepare("UPDATE shift_sessions SET closed_at=datetime('now') WHERE closed_at IS NULL").run() },
    })
    h.openShift(f.raw, h.USER)
    await expectRefused(f, 'n2-race', 'sale_shift_closed', 'End Shift landing between preflight and write refuses the sale')
    console.log('PASS the in-batch guard refuses a sale whose shift ended after the preflight')
  }
})().catch((error) => { console.error(error); process.exit(1) })
