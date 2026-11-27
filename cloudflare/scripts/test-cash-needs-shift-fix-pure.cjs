// R40 fixes (review r40rev, S1 / S2 / N2): the settlement and correction rule on the real PATCH /api/sales/:id/status, and the 409 body.
// Mutants -> test (each makes one assertion below red):
//   correction skips the rule again (S1 base)          -> "a correction that grows the total and takes new cash"
//   correction counts relabelled cash as new           -> "a correction that records no new cash"
//   before rows read from stored payment_details only  -> "a legacy deposit with no stored rows"
//   opener_name always sent                            -> "a caller without shift access"
// Run: node scripts/test-cash-needs-shift-fix-pure.cjs
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
harness._compile(harnessSource.slice(0, boundary) + '\nmodule.exports={fixture,request,postSale,app,executionCtx,USER,load,setUser(value){currentUser=value}};', harnessFile)
const h = harness.exports

const ONLY = process.env.ONLY
const setSetting = (raw, key, value) => raw.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run([key, value])
const EMPLOYEE = { ...h.USER, role_code: 'employee', permissions: '{"sales":true,"pos":true}' }

async function newSale(f, key) {
  const created = await h.postSale(f.route, { ...h.request(key) })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  h.setUser(EMPLOYEE)
  f.raw.prepare('DELETE FROM shift_sessions').run()
  setSetting(f.raw, 'pos_payment_methods', '["Cash","ABA"]')
  return created.body.sale.id
}
const patch = async (f, id, details, extra = {}) => {
  const response = await h.app.request(`/${id}/status`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_request_id: `r40fix-${Math.random()}`, sale_status: 'completed', expected_exchange_rate: 4000, payment_details: details, ...extra }),
  }, { DB: f.route }, h.executionCtx)
  return { status: response.status, body: await response.json() }
}
const rowsOf = (f, id) => ({ sales: f.raw.prepare('SELECT sale_status, amount_paid_usd FROM sales WHERE id=?').get([id]), audit: f.raw.prepare('SELECT COUNT(*) n FROM audit_logs').get().n })

;(async () => {
  if (!ONLY || ONLY === 's2') {
    // S2: an imported partial deposit has no stored payment rows; the old Cash deposit is not new cash.
    const f = h.fixture()
    const id = await newSale(f, 'r40fix-s2')
    const legacy = () => f.raw.prepare("UPDATE sales SET sale_status='awaiting_payment',amount_paid_usd=3,amount_paid_khr=0,payment_method='Cash',payment_details=NULL WHERE id=?").run([id])
    legacy()
    const more = await patch(f, id, [{ method: 'Cash', amount_usd: 3, amount_khr: 0 }, { method: 'Cash', amount_usd: 2, amount_khr: 0 }, { method: 'ABA', amount_usd: 4.5, amount_khr: 0 }])
    assert.equal(more.status, 409, 'cash above the old deposit is new cash: ' + JSON.stringify(more.body))
    assert.equal(more.body.code, 'shift_required_for_cash')
    assert.equal(rowsOf(f, id).sales.sale_status, 'awaiting_payment')
    const rest = await patch(f, id, [{ method: 'Cash', amount_usd: 3, amount_khr: 0 }, { method: 'ABA', amount_usd: 6.5, amount_khr: 0 }])
    assert.equal(rest.status, 200, 'a legacy deposit with no stored rows, the rest by bank: ' + JSON.stringify(rest.body))
    console.log('PASS S2: a legacy deposit with no stored rows is not new cash; a larger cash row still is')
  }
  if (!ONLY || ONLY === 's1') {
    // S1: a payment correction counts only the cash the tender GREW by.
    const f = h.fixture()
    const id = await newSale(f, 'r40fix-s1')
    const reopen = (method, paid) => {
      f.raw.prepare('UPDATE sales SET sale_status=?,amount_paid_usd=?,amount_paid_khr=0,payment_method=?,payment_details=? WHERE id=?')
        .run(['awaiting_payment', paid, method, JSON.stringify([{ method, amount_usd: paid, amount_khr: 0 }]), id])
      f.raw.prepare("INSERT INTO audit_logs(action,entity,entity_id,details) VALUES('sale_payment_correction_opened','sale',?,'{}')").run([String(id)])
    }
    reopen('ABA', 5)
    const grown = await patch(f, id, [{ method: 'ABA', amount_usd: 5, amount_khr: 0 }, { method: 'Cash', amount_usd: 4.5, amount_khr: 0 }], { replace_existing_payment: true })
    assert.equal(grown.status, 409, 'a correction that grows the total and takes new cash: ' + JSON.stringify(grown.body))
    assert.equal(grown.body.code, 'shift_required_for_cash')
    assert.equal(rowsOf(f, id).sales.sale_status, 'awaiting_payment', 'a refusal writes nothing')
    const bank = await patch(f, id, [{ method: 'ABA', amount_usd: 9.5, amount_khr: 0 }], { replace_existing_payment: true })
    assert.equal(bank.status, 200, 'the growth paid by bank is no cash: ' + JSON.stringify(bank.body))
    console.log('PASS S1: a correction that grows the tender with new cash is refused; the same growth by bank is recorded')
    reopen('Cash', 9.5)
    const relabel = await patch(f, id, [{ method: 'ABA', amount_usd: 9.5, amount_khr: 0 }], { replace_existing_payment: true })
    assert.equal(relabel.status, 200, 'a correction that records no new cash (cash relabelled to bank): ' + JSON.stringify(relabel.body))
    reopen('ABA', 9.5)
    const toCash = await patch(f, id, [{ method: 'Cash', amount_usd: 9.5, amount_khr: 0 }], { replace_existing_payment: true })
    assert.equal(toCash.status, 200, 'a correction that records no new cash (bank relabelled to cash, same total): ' + JSON.stringify(toCash.body))
    console.log('PASS S1: a correction that records no new cash is never refused')
  }
  if (!ONLY || ONLY === 'n2') {
    // N2: the refusal names the opener only to a caller who may read shifts.
    const f = h.fixture()
    const probe = h.load('lib/shiftCurrentProbe.ts')
    f.raw.prepare("UPDATE shift_sessions SET closed_at=datetime('now'), user_id=99, user_name='Opener Name'").run()
    const rows = () => f.raw.prepare(`SELECT id, ${probe.branchCashShiftColumnsSql()} FROM branches`).all({ shiftUserId: 99 })
    const ask = (user) => probe.cashShiftRefusal({ probe: probe.pickCashShiftProbe(rows(), 1), user, cash: { usd: 5, khr: 0 }, branchId: 1 })
    const returnsOnly = ask({ ...h.USER, id: 5, role_code: 'employee', permissions: '{"returns":true}' })
    assert.equal(returnsOnly.shift_state, 'closed')
    assert.equal(returnsOnly.opener_name, null, 'a caller without shift access gets no name')
    assert.equal(returnsOnly.who, 'ask_reopen', 'and still learns who can reopen')
    assert.equal(ask({ ...h.USER, id: 5, role_code: 'employee', permissions: '{"pos":true}' }).opener_name, 'Opener Name')
    assert.equal(ask({ ...h.USER, id: 5, role_code: 'employee', permissions: '{"sales":true}' }).opener_name, 'Opener Name')
    console.log('PASS N2: the opener name goes only to a caller with pos or sales')
  }
})().catch((error) => { console.error(error); process.exit(1) })
