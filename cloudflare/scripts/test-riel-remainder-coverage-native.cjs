'use strict'
// A riel payment short by under 100 riel is fully paid, and whole-note cash never makes a routine shift read "needs review".
// Lane MONEY-1 review fix B1, 4 Nov 2026.
//
// Owner rulings, 27 Oct 2026: (1) cash riel is whole 100-riel notes (refused otherwise, any amount by a bank method);
// (2) "a payment leaving under 100 riel unpaid is accepted as fully paid" -- the sale is Completed and the shop absorbs the rest.
// Together they mean a riel total that is not whole hundreds ($9.99 = 39,960 riel at 4,000) is paid in cash by 39,900 (60 short)
// or 40,000 (40 over), and neither may raise a flag at the shift: a covered shortfall owes nothing, and a sub-note over-tender
// leaves nothing to hand back, so the till's computed change of 40 riel is not "change given is ambiguous".
//
// Every scenario drives the whole Worker (src/index.ts bundled, every migration, Miniflare). The shift is opened before its sales
// and the shift reader is asked the way the till does (GET /api/shifts/current).
//   W1  positive shift, checked after every sale (flags are cumulative, so one red flag fails the step that raised it):
//       create Cash 39,900 on $9.99; settle a $9.99 debt with Cash 39,900; create Cash 12,000 on $3.01 (12,040); create Cash 40,000
//       on $9.99 (40 over); settle a $9.99 debt with Cash 40,000 -- each 200, Completed, needs_review false.
//   W2  control: Cash 40,100 on $9.99 is 140 over (more than one note) with unmarked change -- the reader still flags it.
//   W3  refusals: Cash 39,800 on $9.99 is 160 short (not covered) -> 400 insufficient_payment_for_status on create and on settle;
//       a bank (ABA) tender 39,901 riel is 59 short -> Completed (the rule is not cash-only), ABA 39,860 is 100 short -> refused.
// DISCRIMINATING: on 8110a7682 (COVER_BASE=8110a7682) the coverage rule does not exist, so 39,900 on $9.99 is a 400, and the
// 40,000 over-tender is Completed but flags change_ambiguous; every positive step below is red there.
//
// Run (from cloudflare/scripts): node test-riel-remainder-coverage-native.cjs
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

// COVER_BASE=<commit> bundles the Worker as that commit had it; COVER_MUTATION bundles it with ONE rule broken. Either must turn the positive
// steps red (see the header). Mutants: coverage_removed (the under-100-riel rule answers false), reader_flag_restored (the shift reader
// flags unmarked sub-note change again).
const MUTATIONS = {
  coverage_removed: [{ name: 'coverage_removed', file: 'src/lib/saleStatusResolution.ts',
    from: '  return paidKhrUnits > 0n && scaled < RIEL_REMAINDER_ACCEPTED_KHR_UNITS * ratio.denominator', to: '  return false' }],
  reader_flag_restored: [{ name: 'reader_flag_restored', file: 'src/lib/shiftReconciliation.ts',
    from: "else if (change.kind === 'unknown' && !(underOneRielNote && unmarkedChange))", to: "else if (change.kind === 'unknown')" }],
}
const base = process.env.COVER_BASE || ''
const mutation = process.env.COVER_MUTATION || ''
if (mutation && !MUTATIONS[mutation]) throw new Error(`unknown COVER_MUTATION ${mutation}`)
// lib/salePayments.ts is not part of the Worker bundle (the harness asserts every patched file is loaded), so it is left out of the base.
const patches = () => (base ? H.basePatches(base).filter((patch) => !/salePayments.ts$/.test(patch.file)) : mutation ? MUTATIONS[mutation] : [])

async function withWorker(run) {
  const h = await H.startWorker({ patches: patches() })
  try { return await run(h) } finally { await h.mf.dispose() }
}

async function openShift(h) {
  await h.db.prepare("INSERT INTO settings(key,value) VALUES('shift_admin_exempt','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
  const opened = await h.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 0, opening_float_khr: 0 }, 'open the shift')
  assert.ok(opened.status === 200 || opened.status === 201, JSON.stringify(opened.body).slice(0, 240))
  // A sale is counted in the shift only once its second is past the opening instant (created_at has one-second resolution), so a
  // sale rung in the opening second would be left out and every 'no flag' below would pass for the wrong reason.
  await new Promise((resolve) => setTimeout(resolve, 2100))
}

async function drawer(h) {
  // The shift reader leaves out a sale stamped in the current second, so a read straight after a sale would not see it.
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const current = await h.call('GET', '/api/shifts/current?branch_id=1', undefined, 'shift reconciliation (observe)', { observe: true })
  assert.equal(current.status, 200, JSON.stringify(current.body).slice(0, 240))
  const reconciliation = current.body.shift && current.body.shift.reconciliation
  assert.ok(reconciliation, `the shift carries a reconciliation: ${JSON.stringify(current.body).slice(0, 300)}`)
  return { needsReview: reconciliation.needs_review, codes: reconciliation.review_codes || [], cashKhr: reconciliation.cash_sales.khr }
}

let seq = 0
const key = (prefix) => `${prefix}-${++seq}-cover`
const cash = (khr) => [{ method: 'Cash', amount_usd: 0, amount_khr: khr }]
const aba = (khr) => [{ method: 'ABA', amount_usd: 0, amount_khr: khr }]

async function main() {
  const results = []
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`) }
    catch (error) { results.push({ name, ok: false }); console.log(`FAIL ${name}\n     ${String(error.message).split('\n').join('\n     ')}`) }
  }

  await withWorker(async (h) => {
    await H.seedProduct(h, 701, 'COVER item 9.99', 9.99, 200)
    await H.seedProduct(h, 702, 'COVER item 3.01', 3.01, 200)
    await openShift(h)
    const sale = (productId, details, status = 'completed') => H.createSale(h, { key: key('sale'), status, lines: [{ productId, quantity: 1 }],
      ...(details ? { paymentDetails: details } : {}), extra: details ? { payment_currency: 'KHR' } : {}, label: `sale ${productId} ${JSON.stringify(details)}` })
    const settle = (id, details) => h.call('PATCH', `/api/sales/${id}/status`, { sale_status: 'completed', client_request_id: key('settle'),
      expected_exchange_rate: 4000, payment_details: details }, `settle ${id} ${JSON.stringify(details)}`)
    const row = (id) => h.one('SELECT sale_status, amount_paid_khr, total_usd, change_usd, change_khr, change_is_actual FROM sales WHERE id=?', id)
    // The expected riel is checked too: the shift must COUNT the sale, or 'no flag' would be a vacuous pass.
    const quiet = async (label, cashKhr) => { const d = await drawer(h); assert.deepEqual([d.cashKhr, d.needsReview, d.codes], [cashKhr, false, []], `${label}: the shift reads ${JSON.stringify(d)}`) }

    await check('W1a create: Cash 39,900 riel on a $9.99 sale (39,960, 60 short) is 200, Completed, and the shift needs no review', async () => {
      const res = await sale(701, cash(39900))
      assert.equal(res.status, 200, `${res.status} ${JSON.stringify(res.body).slice(0, 240)}`)
      const stored = await row(res.body.id)
      assert.deepEqual([stored.sale_status, stored.total_usd, stored.amount_paid_khr], ['completed', 9.99, 39900])
      await quiet('after the 60-short sale', 39900)
    })
    await check('W1b settle: a $9.99 debt settled with Cash 39,900 riel is Completed and the shift needs no review', async () => {
      const unpaid = await sale(701, null, 'awaiting_payment')
      assert.equal(unpaid.status, 200, JSON.stringify(unpaid.body).slice(0, 240))
      const res = await settle(unpaid.body.id, cash(39900))
      assert.equal(res.status, 200, `${res.status} ${JSON.stringify(res.body).slice(0, 240)}`)
      assert.equal((await row(unpaid.body.id)).sale_status, 'completed')
      await quiet('after settling 60 short', 79800)
    })
    await check('W1c create: Cash 12,000 riel on a $3.01 sale (12,040, 40 short) is Completed with no flag', async () => {
      const res = await sale(702, cash(12000))
      assert.equal(res.status, 200, `${res.status} ${JSON.stringify(res.body).slice(0, 240)}`)
      assert.equal((await row(res.body.id)).sale_status, 'completed')
      await quiet('after the $3.01 sale', 91800)
    })
    await check('W1d create: Cash 40,000 riel on $9.99 (40 over, no note exists to hand it back) is Completed with no flag', async () => {
      const res = await sale(701, cash(40000))
      assert.equal(res.status, 200, `${res.status} ${JSON.stringify(res.body).slice(0, 240)}`)
      const stored = await row(res.body.id)
      assert.equal(stored.sale_status, 'completed')
      assert.equal(stored.change_is_actual, 0, 'the till did not state the change: the 40 riel is computed and unmarked')
      await quiet('after the 40-over sale', 131800)
    })
    await check('W1e settle: a $9.99 debt settled with Cash 40,000 riel (40 over) is Completed with no flag', async () => {
      const unpaid = await sale(701, null, 'awaiting_payment')
      assert.equal(unpaid.status, 200, JSON.stringify(unpaid.body).slice(0, 240))
      const res = await settle(unpaid.body.id, cash(40000))
      assert.equal(res.status, 200, `${res.status} ${JSON.stringify(res.body).slice(0, 240)}`)
      await quiet('after settling 40 over', 171800)
    })
  })

  await withWorker(async (h) => {
    await H.seedProduct(h, 701, 'COVER item 9.99', 9.99, 200)
    await openShift(h)
    await check('W2 control: Cash 40,100 riel on $9.99 is 140 over with unmarked change, so the shift is still flagged', async () => {
      const res = await H.createSale(h, { key: key('sale'), lines: [{ productId: 701, quantity: 1 }], paymentDetails: cash(40100), extra: { payment_currency: 'KHR' }, label: 'sale 140 over' })
      assert.equal(res.status, 200, `${res.status} ${JSON.stringify(res.body).slice(0, 240)}`)
      const d = await drawer(h)
      assert.equal(d.needsReview, true, `a change of more than one note that nobody stated must still be reviewed: ${JSON.stringify(d)}`)
      assert.ok(d.codes.includes('change_ambiguous'), JSON.stringify(d))
    })
  })

  await withWorker(async (h) => {
    await H.seedProduct(h, 701, 'COVER item 9.99', 9.99, 200)
    const count = async () => Number((await h.one('SELECT COUNT(*) AS n FROM sales')).n)
    await check('W3a create: Cash 39,800 riel on $9.99 is 160 short, not covered: 400 insufficient_payment_for_status and nothing written', async () => {
      const before = await count()
      const res = await H.createSale(h, { key: key('sale'), lines: [{ productId: 701, quantity: 1 }], paymentDetails: cash(39800), extra: { payment_currency: 'KHR' }, label: 'sale 160 short' })
      assert.equal(res.status, 400, `${res.status} ${JSON.stringify(res.body).slice(0, 240)}`)
      assert.equal(res.body.code, 'insufficient_payment_for_status')
      assert.equal(await count(), before)
    })
    await check('W3b settle: Cash 39,800 riel against a $9.99 debt is 400 insufficient_payment and the sale stays Not Paid', async () => {
      const unpaid = await H.createSale(h, { key: key('sale'), status: 'awaiting_payment', lines: [{ productId: 701, quantity: 1 }], label: 'unpaid' })
      assert.equal(unpaid.status, 200, JSON.stringify(unpaid.body).slice(0, 240))
      const res = await h.call('PATCH', `/api/sales/${unpaid.body.id}/status`, { sale_status: 'completed', client_request_id: key('settle'), expected_exchange_rate: 4000, payment_details: cash(39800) }, 'settle 160 short')
      assert.equal(res.status, 400, `${res.status} ${JSON.stringify(res.body).slice(0, 240)}`)
      assert.equal(res.body.code, 'insufficient_payment')
      assert.equal((await h.one('SELECT sale_status FROM sales WHERE id=?', unpaid.body.id)).sale_status, 'awaiting_payment')
    })
    await check('W3c create: ABA 39,901 riel on $9.99 is 59 short and Completed -- the rule is about any riel tender, not cash only', async () => {
      const res = await H.createSale(h, { key: key('sale'), lines: [{ productId: 701, quantity: 1 }], paymentDetails: aba(39901), extra: { payment_currency: 'KHR' }, label: 'sale aba 59 short' })
      assert.equal(res.status, 200, `${res.status} ${JSON.stringify(res.body).slice(0, 240)}`)
      assert.equal((await h.one('SELECT sale_status FROM sales WHERE id=?', res.body.id)).sale_status, 'completed')
    })
    await check('W3d create: ABA 39,860 riel on $9.99 is exactly one note short and is refused', async () => {
      const res = await H.createSale(h, { key: key('sale'), lines: [{ productId: 701, quantity: 1 }], paymentDetails: aba(39860), extra: { payment_currency: 'KHR' }, label: 'sale aba 100 short' })
      assert.equal(res.status, 400, `${res.status} ${JSON.stringify(res.body).slice(0, 240)}`)
      assert.equal(res.body.code, 'insufficient_payment_for_status')
    })
  })

  const failures = results.filter((result) => !result.ok)
  if (failures.length) { console.log(`RED riel remainder coverage${base ? ` [base ${base}]` : mutation ? ` [mutation ${mutation}]` : ''}: ${failures.length} of ${results.length} checks failed`); process.exit(1) }
  console.log(`GREEN riel remainder coverage: ${results.length}/${results.length} checks hold`)
}

main().catch((error) => { console.error(error); process.exit(1) })
