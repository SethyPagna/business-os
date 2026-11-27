// R40 (owner 26 + 27 Nov 2026): cash needs an open shift. Drives the real POST /api/sales and PATCH /:id/status on the fully migrated
// schema (the atomic-create harness), plus the one-statement probe on its own and the returns wiring.
// Mutants -> test (each makes one assertion below red):
//   `> 0` dropped            -> "a $0 Cash sale"
//   kind replaced by name    -> "a renamed cash method pinned by kind"
//   closed treated as open   -> "closed refuses"
//   business_date dropped    -> "an earlier-day open shift does not count"
//   NULL fallback dropped    -> "an All shift covers a branch till"
//   per_account user dropped -> "another cashier's shift does not count"
//   exemption ignored/inverted -> "exempt admin" / "admin_exempt=false"
//   check before idempotency -> "a committed sale retried after the close"
//   check after the batch    -> "refusal writes nothing"
//   correction refused       -> "payment correction"
//   probe as its own prepare -> "no statement reads shift_sessions on its own"
//   exchange top-up skipped / refund path skipped -> "returns wiring"
// Run: node scripts/test-cash-needs-shift-pure.cjs
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
harness._compile(harnessSource.slice(0, boundary) + '\nmodule.exports={fixture,request,postSale,creationState,app,executionCtx,USER,load,setUser(value){currentUser=value}};', harnessFile)
const h = harness.exports

const shiftSql = 'SELECT COUNT(*) AS n FROM shift_sessions'
const writeState = (raw) => ({ ...h.creationState(raw), sales: raw.prepare('SELECT COUNT(*) n FROM sales').get().n, audit: raw.prepare('SELECT COUNT(*) n FROM audit_logs').get().n })
const setShift = (raw, set) => raw.prepare(`UPDATE shift_sessions SET ${set} WHERE shift_code='ATOMIC-S1'`).run()
const setSetting = (raw, key, value) => raw.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run([key, value])
const bodyWith = (id, extra) => ({ ...h.request(id), ...extra })
const ADMIN = { ...h.USER, id: 72, name: 'Admin', username: 'admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }

async function refused(f, body, state) {
  const before = writeState(f.raw)
  const res = await h.postSale(f.route, body)
  assert.equal(res.status, 409, JSON.stringify(res.body))
  assert.equal(res.body.code, 'shift_required_for_cash')
  assert.equal(res.body.shift_state, state)
  assert.deepEqual(writeState(f.raw), before, 'refusal writes nothing')
  return res.body
}

;(async () => {
  {
    const f = h.fixture()
    assert.equal((await h.postSale(f.route, bodyWith('r40-open'))).status, 200)
    console.log('PASS open shift: a cash sale is recorded')
  }
  {
    const f = h.fixture()
    f.raw.prepare("DELETE FROM shift_sessions").run()
    const body = await refused(f, bodyWith('r40-none'), 'none')
    assert.equal(body.error, 'Open a shift to take cash.')
    assert.equal(body.direction, 'in')
    assert.equal(body.who, 'open')
    console.log('PASS no shift refuses cash with nothing written')
  }
  {
    const f = h.fixture()
    setShift(f.raw, "closed_at=datetime('now')")
    const body = await refused(f, bodyWith('r40-closed'), 'closed')
    assert.equal(body.opener_name, 'Sale Cashier')
    assert.equal(body.can_reopen, true)
    assert.equal(body.who, 'reopen')
    console.log('PASS closed refuses; the opener may reopen')
  }
  {
    const f = h.fixture()
    setShift(f.raw, "closed_at=datetime('now'), user_id=999, user_name='Dara'")
    setSetting(f.raw, 'shift_scope_mode', 'shop_wide')
    f.raw.prepare("UPDATE shift_sessions SET scope_mode='shop_wide'").run()
    const body = await refused(f, bodyWith('r40-ask'), 'closed')
    assert.equal(body.can_reopen, false)
    assert.equal(body.who, 'ask_reopen')
    assert.equal(body.opener_name, 'Dara')
    console.log('PASS closed by another opener: the till is told who to ask (Q2: opener or admin only)')
  }
  {
    const f = h.fixture()
    setShift(f.raw, "cancelled_at=datetime('now'), cancelled_by_user_id=1, cancel_reason='mistake'")
    await refused(f, bodyWith('r40-cancelled'), 'cancelled')
    console.log('PASS cancelled refuses')
  }
  {
    const f = h.fixture()
    setShift(f.raw, "business_date=date('now','+7 hours','-1 day')")
    await refused(f, bodyWith('r40-yesterday'), 'none')
    console.log('PASS an earlier-day open shift does not count')
  }
  {
    const f = h.fixture()
    setShift(f.raw, 'user_id=999')
    await refused(f, bodyWith('r40-other'), 'none')
    setSetting(f.raw, 'shift_scope_mode', 'shop_wide')
    f.raw.prepare("UPDATE shift_sessions SET scope_mode='shop_wide'").run()
    assert.equal((await h.postSale(f.route, bodyWith('r40-shared'))).status, 200)
    console.log("PASS another cashier's shift does not count per account, and does under shop_wide")
  }
  {
    const f = h.fixture()
    setShift(f.raw, 'branch_id=NULL')
    assert.equal((await h.postSale(f.route, bodyWith('r40-all'))).status, 200)
    console.log('PASS an All shift covers a branch till')
  }
  {
    const f = h.fixture()
    f.raw.prepare('DELETE FROM shift_sessions').run()
    assert.equal((await h.postSale(f.route, bodyWith('r40-aba', { payment_method: 'ABA' }))).status, 200)
    setSetting(f.raw, 'pos_payment_method_kinds', '{"till":"cash"}')
    await refused(f, bodyWith('r40-till', { payment_method: 'Till' }), 'none')
    console.log('PASS a digital tender needs no shift; a renamed cash method pinned by kind does')
  }
  {
    const f = h.fixture()
    f.raw.prepare('DELETE FROM shift_sessions').run()
    const free = bodyWith('r40-zero', { amount_paid_usd: 0 })
    const res = await h.postSale(f.route, free)
    assert.notEqual(res.body.code, 'shift_required_for_cash', 'a $0 Cash sale')
    console.log('PASS a $0 Cash sale is not refused for the shift')
  }
  {
    const f = h.fixture()
    f.raw.prepare('DELETE FROM shift_sessions').run()
    h.setUser(ADMIN)
    try {
      assert.equal((await h.postSale(f.route, bodyWith('r40-admin'))).status, 200)
      setSetting(f.raw, 'shift_admin_exempt', 'false')
      await refused(f, bodyWith('r40-admin-2'), 'none')
    } finally { h.setUser(h.USER) }
    console.log('PASS exempt admin sells with no shift; admin_exempt=false makes the rule apply')
  }
  {
    const f = h.fixture()
    const body = bodyWith('r40-retry')
    const first = await h.postSale(f.route, body)
    assert.equal(first.status, 200)
    setShift(f.raw, "closed_at=datetime('now')")
    const again = await h.postSale(f.route, body)
    assert.equal(again.status, 200, JSON.stringify(again.body))
    assert.equal(again.body.duplicate, true)
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM sales').get().n, 1)
    console.log('PASS a committed sale retried after the close returns the original (duplicate)')
  }
  {
    const f = h.fixture()
    const seen = []
    const route = {
      ...f.route,
      prepare(sql) { seen.push(String(sql)); return f.route.prepare(sql) },
    }
    route.staging = route
    assert.equal((await h.postSale(route, bodyWith('r40-calls'))).status, 200)
    const readers = seen.filter((sql) => /FROM shift_sessions/.test(sql) && !/FROM settings WHERE key IN/.test(sql) && !/^\s*INSERT/i.test(sql))
    assert.deepEqual(readers, [], 'no statement reads shift_sessions on its own')
    assert.ok(seen.some((sql) => /__current_shift/.test(sql) && /FROM settings WHERE key IN/.test(sql)), 'the probe rides the settings read')
    console.log('PASS the shift read adds no D1 call: it rides the existing settings statement')
  }
  {
    const f = h.fixture()
    const created = await h.postSale(f.route, bodyWith('r40-s2'))
    assert.equal(created.status, 200)
    const id = created.body.sale.id
    h.setUser({ ...h.USER, role_code: 'employee', permissions: '{"sales":true,"pos":true}' })
    f.raw.prepare("UPDATE sales SET sale_status='awaiting_payment',amount_paid_usd=0,amount_paid_khr=0,payment_details='[]' WHERE id=?").run([id])
    const patch = async (details, extra = {}) => {
      const response = await h.app.request(`/${id}/status`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_request_id: `r40-pay-${Math.random()}`, sale_status: 'completed', expected_exchange_rate: 4000, payment_details: details, ...extra }),
      }, { DB: f.route }, h.executionCtx)
      return { status: response.status, body: await response.json() }
    }
    setShift(f.raw, "closed_at=datetime('now')")
    setSetting(f.raw, 'pos_payment_methods', '["Cash","ABA"]')
    const before = writeState(f.raw)
    const cash = await patch([{ method: 'Cash', amount_usd: 9.5, amount_khr: 0 }])
    assert.equal(cash.status, 409, JSON.stringify(cash.body))
    assert.equal(cash.body.code, 'shift_required_for_cash')
    assert.equal(f.raw.prepare('SELECT sale_status FROM sales WHERE id=?').get([id]).sale_status, 'awaiting_payment')
    assert.deepEqual(writeState(f.raw), before)
    const bank = await patch([{ method: 'ABA', amount_usd: 9.5, amount_khr: 0 }])
    assert.equal(bank.status, 200, JSON.stringify(bank.body))
    console.log('PASS later payment: cash refused with no shift, bank accepted')
    f.raw.prepare("UPDATE sales SET sale_status='completed' WHERE id=?").run([id])
    const correction = await patch([{ method: 'Cash', amount_usd: 9.5, amount_khr: 0 }], { replace_existing_payment: true })
    assert.notEqual(correction.body.code, 'shift_required_for_cash', 'payment correction is never refused for the shift')
    console.log('PASS payment correction is not refused for the shift')
  }
  {
    // The probe equals readCurrent's row over the matrix, and uses the business-date index (no ANALYZE).
    const f = h.fixture()
    const probe = h.load('lib/shiftCurrentProbe.ts')
    const sql = `SELECT ${probe.currentShiftProbeValueSql('@b')} AS v`
    const read = (branch, user) => probe.parseShiftProbe(f.raw.prepare(sql).get({ b: branch, shiftUserId: user }).v)
    assert.equal(read(1, 71).shift.user_name, 'Sale Cashier')
    assert.equal(read(2, 71).shift, null)
    setShift(f.raw, 'branch_id=NULL')
    assert.equal(read(2, 71).shift.branch_id, null)
    assert.equal(read(null, 71).shift.branch_id, null)
    f.raw.prepare("INSERT INTO shift_sessions(shift_code,user_id,user_name,branch_id,branch_name,business_date,opened_at,closed_at) VALUES('EXACT',71,'Sale Cashier',2,'Two',date('now','+7 hours'),datetime('now'),datetime('now'))").run()
    assert.equal(read(2, 71).shift.closed, true, 'the exact branch row wins over the All row')
    const plan = f.raw.prepare(`EXPLAIN QUERY PLAN SELECT s.id FROM shift_sessions s WHERE +s.scope_mode = 'per_account' AND s.business_date = date('now','+7 hours')`).all().map((r) => r.detail).join(' | ')
    assert.match(plan, /idx_shift_sessions_business_date/)
    console.log('PASS the probe answers like readCurrent (exact branch first, All fallback, today only) on the business-date index')
  }
  {
    const f = h.fixture()
    const ctx = h.load('lib/returnExchangeContext.ts')
    const q = ctx.exchangeContextQuery({ saleId: 1, saleItemIds: [], replacementProductIds: [], explicitBatchIds: [], returnNumbers: [], receiptNumbers: [], customerId: null, shiftUserId: 71 })
    const rows = f.raw.prepare(q.sql).all(q.params)
    const parsed = ctx.parseExchangeContext(rows)
    assert.equal(JSON.parse(parsed.branchCashShift.get(1)).shift.user_name, 'Sale Cashier')
    console.log('PASS the exchange context carries each branch current-shift probe in its one statement')
  }
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'returns.ts'), 'utf8')
    const create = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'returnExchangeCreate.ts'), 'utf8')
    assert.match(src, /direction: 'out'/, 'returns wiring: cash refund path')
    assert.match(src, /cashRefundUsd > 0/, 'returns wiring: a debt-only return has no cash share and is never refused')
    assert.match(src, /replacementShiftRefused/, 'returns wiring: legacy replacement default Cash')
    assert.match(create, /cashShiftRefusal\(/, 'returns wiring: exchange top-up')
    const exchangeCheck = create.indexOf('cashShiftRefusal(')
    assert.ok(exchangeCheck > create.indexOf('settleExchange(') && exchangeCheck < create.indexOf('planExchangeReturnLots('), 'the exchange check sits after the tender is settled and before any write')
    const refund = src.indexOf('refundShiftRefused')
    assert.ok(refund > src.indexOf('const cashRefundUsd = refundCashUsd(') && refund < src.indexOf("INSERT INTO returns"), 'the refund check sits before the write')
    console.log('PASS returns wiring: exchange top-up, legacy replacement and every cash refund path are checked before any write')
  }
  void shiftSql
})().catch((error) => { console.error(error); process.exit(1) })
