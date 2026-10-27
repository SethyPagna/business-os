'use strict'
// Sale payment WRITERS (lane 6.0.982, slice S4 of DESIGN-SALE-ADDITIONS-PAYMENTS), against the whole Worker on
// workerd + D1 with every migration (harness/al_money_native.cjs: real src/index.ts, real login, statements
// counted per request). The shift figures are read by the REAL lib/shiftReconciliation.ts over the same D1.
//
// What each block proves, and the plausible wrong implementation it is red against:
//   A. checkout writes ONE checkout event that copies the sale's tender and moves it to payments_version 1
//      (red: no event, or an event at a different time/branch than the v0 reading of the sale).
//   B. settling a v0 Not Paid sale later writes an opening event at its created_at (canonical, though the stored
//      created_at is 'T...Z') and a collect event NOW: the old shift keeps the deposit, the later shift gets the
//      money (red: the v0 rule, which moves the whole tender into the old shift; or an opening that copies
//      created_at raw).
//   C. instalments stay Not Paid with the Part paid reading until covered, then Completed (red: status left alone).
//   D. more than is owed is refused unless the change is stated and reconciles (red: any tender accepted).
//   E. a retry with the same client_request_id answers the first result and writes nothing (red: a second event).
//   F. undo appends an out that reverses the collect, redo an in; undoing an older payment under a newer one is
//      refused (red: undo restores the columns only, and the health check goes red).
//   G. payment_events_mismatch of ops/queries/health-sale-money.sql stays 0, with a positive control.
//   H. an account without sales:status Full is refused on both writers.
//   I. a settle and an instalment racing on one sale never both land on the same revision.
//   J. a payment correction writes its pair NOW (owner ruling 27 Oct 2026: it counts on the day it is made, in the
//      shift that made it, never back-dated); undo answers both, also now.
//   L. the same, discriminating: a deposit on 20 Aug and a settle on 10 Sep stay put; the current shift takes the correction.
//   K. a v0 sale whose created_at cannot be read still settles (stays version 0, no events).
//
// Mutation controls (each must turn this file red; run with PAY_MUTATION=<name>):
//   collect_at_creation  the collect event is dated at the sale's creation (the v0 rule)
//   undo_without_event   the undo restores the columns and writes no reversal event
//   overpay_accepted     the instalment skips the "more than is owed" refusal
//   no_revision_guard    the instalment batch does not pin the revision it read (I2 must go red)
//   correction_backdated      a correction is dated at the latest live payment, the pre-ruling rule (L1/L2 must go red)
//   (the undo of a correction dated at the events it answers is caught by test-sale-payment-writers-pure: here the pair is
//    itself dated now, so its answers land now either way and L3 only asserts it)
//   credit_without_event      an exchange cancel moves the credit in the columns only (X must go red)
//   credit_flag_dropped       a settle drops the refund_credit marker of a repeated row (X must go red)
//   credit_dropped_on_correction  a payment correction replaces the credit row with plain cash (X4/X5 must go red)
//   correction_change_from_columns  the correction takes back the sale's change columns, not the events' net (M1 must go red)
//   receipt_keeps_search      the settlement receipt stores search_normalized (P4 must go red)
//   search_from_snapshot      the replay writes the snapshot's search text instead of recomputing it (P4 must go red)
//   reversal_current_method   the exchange-cancel reversal takes the method of the sale's current credit row (R1 must go red)
//   relabel_moves_credit      bulk relabel rewrites the refund_credit row's method (R2/R3 must go red)
//   rename_moves_credit       the linked Settings rename rewrites the refund_credit row's method (R4 must go red)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const H = require('./harness/al_money_native.cjs')

const root = path.resolve(__dirname, '..')
const MUTATIONS = {
  collect_at_creation: [{ name: 'collect_at_creation', file: 'src/lib/salePaymentWriters.ts',
    from: 'receivedAt: anchor ? anchor.received_at : input.actor.receivedAt,', to: 'receivedAt: anchor ? anchor.received_at : (input as any).saleCreatedAt ?? \'2026-08-20 03:00:00\',' }],
  undo_without_event: [{ name: 'undo_without_event', file: 'src/lib/saleSettlementAction.ts',
    from: '...replayEvents.map((event) => paymentEventInsertStatement(event)),', to: '' }],
  no_revision_guard: [{ name: 'no_revision_guard', file: 'src/routes/sales.ts',
    from: '    saleRevisionGuard(id, Number(sale.write_revision)),\n    ...openingStatements,', to: '    ...openingStatements,' }],
  correction_backdated: [{ name: 'correction_backdated_out', file: 'src/lib/salePaymentWriters.ts',
    from: "reversesEventId: null, receivedAt: input.actor.receivedAt, branchId: input.actor.branchId, cashierId: input.actor.cashierId,\n      cashierName: input.actor.cashierName, drawerEffect: anchor.drawer_effect,",
    to: "reversesEventId: null, receivedAt: anchor.received_at, branchId: anchor.branch_id, cashierId: anchor.cashier_id,\n      cashierName: anchor.cashier_name, drawerEffect: anchor.drawer_effect," },
  { name: 'correction_backdated_in', file: 'src/lib/salePaymentWriters.ts',
    from: "    receivedAt: input.actor.receivedAt,\n    operationId: input.operationId,\n    change: input.change,", to: "    receivedAt: anchor ? anchor.received_at : input.actor.receivedAt,\n    operationId: input.operationId,\n    change: input.change," }],
  credit_without_event: [{ name: 'credit_without_event', file: 'src/lib/returnBulkAction.ts',
    from: 'return [creditPaymentEventStatement(members, direction), {', to: 'return [{' }],
  credit_flag_dropped: [{ name: 'credit_flag_dropped', file: 'src/lib/paymentSettlement.ts',
    from: '      ...(preserved ? preserved.markers : {}),\n', to: '' }],
  credit_dropped_on_correction: [{ name: 'credit_dropped_on_correction', file: 'src/routes/sales.ts',
    from: 'const keptCredit = creditSplit && creditSplit.creditRows.length ? creditSplit : null', to: 'const keptCredit = null as any' }],
  correction_change_from_columns: [{ name: 'correction_change_from_columns', file: 'src/lib/salePaymentWriters.ts',
    from: 'return latest ? { event: latest, tender: tender ? { ...tender, ...netEventChange(events) } : null } : null', to: 'return latest ? { event: latest, tender } : null' }],
  receipt_keeps_search: [{ name: 'receipt_keeps_search', file: 'src/routes/sales.ts',
    from: 'beforeJson: JSON.stringify(settlementReceiptState(snapshot.before)), afterJson: JSON.stringify(settlementReceiptState(snapshot.after)),',
    to: 'beforeJson: JSON.stringify(snapshot.before), afterJson: JSON.stringify(snapshot.after),' }],
  search_from_snapshot: [{ name: 'search_from_snapshot', file: 'src/lib/saleSettlementAction.ts',
    from: 'search_normalized: settlementSearchNormalized(eventRows[0] ?? {}, target.payment_method)', to: 'search_normalized: target.search_normalized ?? null' }],
  reversal_current_method: [{ name: 'reversal_current_method', file: 'src/lib/returnBulkAction.ts',
    from: "${anchorMethod}, json_set(json_extract(u.value,'$.details'),'$[0].method',${anchorMethod}),", to: "json_extract(u.value,'$.method'), json_extract(u.value,'$.details')," }],
  relabel_moves_credit: [{ name: 'relabel_moves_credit_match', file: 'src/lib/saleBulkUpdate.ts',
    from: 'matches = details.some((detail) => normalized(detail.method) === source && detail.refund_credit !== true)', to: 'matches = details.some((detail) => normalized(detail.method) === source)' },
  { name: 'relabel_moves_credit_write', file: 'src/lib/saleBulkUpdate.ts',
    from: 'normalized(detail.method) === source && detail.refund_credit !== true ? { ...detail, method: targetMethod } : detail', to: 'normalized(detail.method) === source ? { ...detail, method: targetMethod } : detail' }],
  rename_moves_credit: [{ name: 'rename_moves_credit', file: 'src/routes/settings.ts',
    from: "IN (SELECT CAST(value AS TEXT) FROM json_each(@identityVariants)) AND json_extract(detail.value,'$.refund_credit') IS NOT 1\n      THEN json_set(detail.value,'$.method',@target)",
    to: "IN (SELECT CAST(value AS TEXT) FROM json_each(@identityVariants))\n      THEN json_set(detail.value,'$.method',@target)" }],
  overpay_accepted: [{ name: 'overpay_accepted', file: 'src/routes/sales.ts',
    from: "if (!statedChange && error.code === 'invalid_actual_change_total') {", to: "if (false) {" }],
}
const mutation = process.env.PAY_MUTATION || ''
if (mutation && !MUTATIONS[mutation]) throw new Error(`unknown PAY_MUTATION ${mutation}`)

async function loadShiftReader() {
  const out = await build({ entryPoints: [path.join(root, 'src/lib/shiftReconciliation.ts')], bundle: true, write: false,
    platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'silent' })
  const m = { exports: {} }
  new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, m, m.exports)
  return m.exports
}

function healthSql() {
  const text = fs.readFileSync(path.join(root, '..', 'ops', 'queries', 'health-sale-money.sql'), 'utf8')
  return text.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n')
}

const canonical = (value) => new Date(value).toISOString().slice(0, 19).replace('T', ' ')

async function main() {
  const h = await H.startWorker({ patches: mutation ? MUTATIONS[mutation] : [] })
  const r = H.recorder(mutation ? `PAY [mutation ${mutation}]` : 'PAY')
  const shiftReader = await loadShiftReader()
  const env = { DB: h.db }
  const cashOptions = { kinds: {}, configuredMethods: ['Cash', 'ABA'] }
  // An open shift reads up to now at whole-second precision; read 5 s ahead so a payment taken this second is in.
  const shiftCash = async (openedAt, closedAt) => {
    const cash = await shiftReader.shiftCashSales(env, { scope_mode: 'shop_wide', user_id: 901, branch_id: 1, opened_at: openedAt, closed_at: closedAt,
      cancelled_at: null, opening_float_usd: 0, opening_float_khr: 0 }, Date.now() + 5000, cashOptions)
    return { usd: cash.usd, khr: cash.khr, digital: cash.digital }
  }
  const events = (saleId) => h.all('SELECT * FROM sale_payment_events WHERE sale_id=? ORDER BY id', saleId)
  const sale = (saleId) => h.one('SELECT id,sale_status,payments_version,amount_paid_usd,amount_paid_khr,payment_method,payment_details,created_at,change_usd,change_khr,change_is_actual FROM sales WHERE id=?', saleId)
  const revision = async (saleId) => Number((await h.one('SELECT COALESCE((SELECT revision FROM sale_write_revisions WHERE sale_id=?),0) AS r', saleId)).r)
  const health = async () => (await h.db.prepare(healthSql()).all()).results[0]
  const net = (rows) => rows.reduce((sum, row) => ({ usd: sum.usd + (row.direction === 'out' ? -1 : 1) * row.amount_paid_usd,
    khr: sum.khr + (row.direction === 'out' ? -1 : 1) * row.amount_paid_khr }), { usd: 0, khr: 0 })
  let requestCounter = 0
  const pay = (saleId, details, extra = {}, label) => h.call('POST', `/api/sales/${saleId}/payments`, { client_request_id: `pay-${++requestCounter}`,
    expected_exchange_rate: extra.rate ?? 4000, payment_details: details, ...extra.body }, label || `pay ${saleId}`)
  const settle = (saleId, details, extra = {}, label) => h.call('PATCH', `/api/sales/${saleId}/status`, { sale_status: 'completed',
    client_request_id: `settle-${++requestCounter}`, expected_exchange_rate: 4000, payment_details: details, ...extra }, label || `settle ${saleId}`)

  try {
    for (const [id, name] of [[401, 'PAY Balm'], [402, 'PAY Serum'], [403, 'PAY Mask'], [404, 'PAY Oil'], [405, 'PAY Toner']]) {
      await H.seedProduct(h, id, name, 2, 200)
    }

    // ---- A. checkout ----------------------------------------------------------------------------------------
    const paidSale = await H.createSale(h, { key: 'pay-a-paid', lines: [{ productId: 401, quantity: 5 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 6, amount_khr: 16000 }], label: 'checkout $10 paid $6 + 16000 riel' })
    assert.equal(paidSale.status, 200, JSON.stringify(paidSale.body).slice(0, 300))
    const paidId = Number(paidSale.body.id)
    const paidRow = await sale(paidId)
    const paidEvents = await events(paidId)
    r.check(`A1 checkout writes one checkout event copying the tender, version 1 (${JSON.stringify(paidEvents.map((e) => [e.origin, e.amount_paid_usd, e.amount_paid_khr, e.received_at]))})`, () => {
      assert.equal(paidRow.payments_version, 1)
      assert.equal(paidEvents.length, 1)
      const [event] = paidEvents
      assert.deepEqual([event.event_id, event.origin, event.direction, event.drawer_effect], [`checkout:${paidId}`, 'checkout', 'in', 1])
      assert.deepEqual([event.amount_paid_usd, event.amount_paid_khr, event.payment_details, event.payment_method],
        [paidRow.amount_paid_usd, paidRow.amount_paid_khr, paidRow.payment_details, paidRow.payment_method])
      assert.equal(event.received_at, canonical(`${String(paidRow.created_at).replace(' ', 'T')}Z`))
      assert.deepEqual([event.branch_id, event.cashier_id], [1, 901])
    })
    const unpaid = await H.createSale(h, { key: 'pay-a-unpaid', status: 'awaiting_payment', lines: [{ productId: 402, quantity: 5 }], label: 'checkout Not Paid $10, nothing paid' })
    const unpaidId = Number(unpaid.body.id)
    const unpaidRow = await sale(unpaidId)
    const unpaidEvents = await events(unpaidId)
    r.check('A2 a Not Paid checkout with nothing paid is version 1 with no event', () => {
      assert.equal(unpaid.status, 200, JSON.stringify(unpaid.body).slice(0, 300))
      assert.equal(unpaidRow.payments_version, 1)
      assert.equal(unpaidEvents.length, 0)
    })

    // ---- C. instalments on the version 1 sale (owes $10) ---------------------------------------------------
    const p1 = await pay(unpaidId, [{ method: 'Cash', amount_usd: 3, amount_khr: 0 }], {}, 'instalment 1: $3 cash')
    const afterP1 = await sale(unpaidId)
    r.check(`C1 a $3 instalment keeps it Not Paid, Part paid, owing $7 (got ${p1.status} ${JSON.stringify(p1.body).slice(0, 200)})`, () => {
      assert.equal(p1.status, 200)
      assert.deepEqual([afterP1.sale_status, afterP1.amount_paid_usd, p1.body.owed_usd, p1.body.part_paid, p1.body.covered], ['awaiting_payment', 3, 7, true, false])
    })
    const p2 = await pay(unpaidId, [{ method: 'ABA', amount_usd: 4, amount_khr: 0 }], {}, 'instalment 2: $4 ABA')
    r.check('C2 a $4 instalment: still Not Paid, owing $3', () => {
      assert.equal(p2.status, 200, JSON.stringify(p2.body).slice(0, 200))
      assert.deepEqual([p2.body.sale_status, p2.body.owed_usd], ['awaiting_payment', 3])
    })

    // ---- D. over-payment ------------------------------------------------------------------------------------
    const revBefore = await revision(unpaidId)
    const eventsBefore = (await events(unpaidId)).length
    const over = await pay(unpaidId, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }], {}, 'over-payment: $5 against $3 owed, no change stated')
    r.check(`D1 $5 against $3 owed with no change stated is refused and writes nothing (got ${over.status} ${over.body.code})`, () => {
      assert.equal(over.status, 400)
      assert.equal(over.body.code, 'payment_exceeds_owed')
    })
    const badChange = await pay(unpaidId, [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }], { body: { change_is_actual: true, change_usd: 1, change_khr: 0 } }, 'over-payment with wrong change')
    r.check(`D2 stated change that does not reconcile is refused (got ${badChange.status} ${badChange.body.code})`, () => {
      assert.equal(badChange.status, 400)
      assert.equal(badChange.body.code, 'invalid_actual_change_total')
    })
    const revAfterRefusals = await revision(unpaidId)
    const eventsAfterRefusals = (await events(unpaidId)).length
    r.check('D3 the refusals wrote nothing (same revision, same events)', () => {
      assert.equal(revAfterRefusals, revBefore)
      assert.equal(eventsAfterRefusals, eventsBefore)
    })
    const p3Body = { client_request_id: 'pay-final-with-change', expected_exchange_rate: 4000, payment_details: [{ method: 'Cash', amount_usd: 5, amount_khr: 0 }],
      change_is_actual: true, change_usd: 2, change_khr: 0 }
    const p3 = await h.call('POST', `/api/sales/${unpaidId}/payments`, p3Body, 'instalment 3: $5 cash, $2 change -> covered')
    const afterP3 = await sale(unpaidId)
    const p3Events = await events(unpaidId)
    r.check(`C3 the covering instalment completes the sale; its event carries the stated change (got ${p3.status} ${JSON.stringify(p3.body).slice(0, 160)})`, () => {
      assert.equal(p3.status, 200)
      assert.deepEqual([afterP3.sale_status, p3.body.covered, p3.body.owed_usd, p3.body.part_paid], ['completed', true, 0, false])
      assert.equal(afterP3.amount_paid_usd, 12)
      const last = p3Events[p3Events.length - 1]
      assert.deepEqual([last.origin, last.amount_paid_usd, last.change_usd, last.change_is_actual], ['collect', 5, 2, 1])
      assert.deepEqual(JSON.parse(afterP3.payment_details), [{ method: 'Cash', amount_usd: 8, amount_khr: 0 }, { method: 'ABA', amount_usd: 4, amount_khr: 0 }])
    })

    // ---- E. idempotent retry --------------------------------------------------------------------------------
    const retry = await h.call('POST', `/api/sales/${unpaidId}/payments`, p3Body, 'retry instalment 3')
    const retryEvents = await events(unpaidId)
    const reused = await h.call('POST', `/api/sales/${unpaidId}/payments`, { ...p3Body, payment_details: [{ method: 'Cash', amount_usd: 4, amount_khr: 0 }] }, 'reuse the id with other data')
    r.check(`E1 the retry answers the first result and writes nothing; reuse with other data is a conflict (${retry.status}, ${reused.status} ${reused.body.code})`, () => {
      assert.equal(retry.status, 200)
      assert.equal(retry.body.operationId, p3.body.operationId)
      assert.equal(retryEvents.length, p3Events.length)
      assert.equal(reused.status, 409)
      assert.equal(reused.body.code, 'idempotency_conflict')
    })

    // ---- F. undo / redo -------------------------------------------------------------------------------------
    const olderUndo = await H.historyStep(h, Number(p1.body.actionHistoryId), 'undo', 0, 'undo instalment 1 under the later ones')
    const afterOlderUndo = await events(unpaidId)
    r.check(`F1 undoing an older payment under newer ones is refused and writes nothing (got ${olderUndo.status})`, () => {
      assert.equal(olderUndo.status, 409, JSON.stringify(olderUndo.body).slice(0, 200))
      assert.equal(afterOlderUndo.length, p3Events.length)
    })
    const undo3 = await H.historyStep(h, Number(p3.body.actionHistoryId), 'undo', 0, 'undo instalment 3')
    const afterUndo = await sale(unpaidId)
    const undoEvents = await events(unpaidId)
    const undoEvent = undoEvents[undoEvents.length - 1]
    const collect3 = p3Events[p3Events.length - 1]
    r.check(`F2 undo appends an out reversing the collect, received now; the sale owes $3 again (got ${undo3.status}; ${JSON.stringify(undoEvent).slice(0, 220)})`, () => {
      assert.equal(undo3.status, 200, JSON.stringify(undo3.body).slice(0, 200))
      assert.equal(undoEvents.length, p3Events.length + 1)
      assert.deepEqual([undoEvent.direction, undoEvent.origin, undoEvent.reverses_event_id, undoEvent.amount_paid_usd, undoEvent.change_usd],
        ['out', 'undo', collect3.event_id, 5, 2])
      assert.ok(Math.abs(Date.parse(`${undoEvent.received_at.replace(' ', 'T')}Z`) - Date.now()) < 120000, 'received now')
      assert.deepEqual([afterUndo.sale_status, afterUndo.amount_paid_usd], ['awaiting_payment', 7])
      assert.deepEqual(net(undoEvents), { usd: afterUndo.amount_paid_usd, khr: afterUndo.amount_paid_khr })
    })
    const redo3 = await H.historyStep(h, Number(p3.body.actionHistoryId), 'redo', 1, 'redo instalment 3')
    const afterRedo = await sale(unpaidId)
    const redoEvents = await events(unpaidId)
    const redoEvent = redoEvents[redoEvents.length - 1]
    r.check(`F3 redo appends an in reversing the undo; Completed again (got ${redo3.status})`, () => {
      assert.equal(redo3.status, 200, JSON.stringify(redo3.body).slice(0, 200))
      assert.deepEqual([redoEvent.direction, redoEvent.origin, redoEvent.reverses_event_id, redoEvent.amount_paid_usd], ['in', 'redo', undoEvent.event_id, 5])
      assert.deepEqual([afterRedo.sale_status, afterRedo.amount_paid_usd], ['completed', 12])
      assert.deepEqual(net(redoEvents), { usd: 12, khr: 0 })
    })

    // ---- B. v0 sale settled in a later shift ----------------------------------------------------------------
    const legacy = await H.importSale(h, 1, 'awaiting_payment', [{ productId: 403, name: 'PAY Mask', quantity: 5, price: 2 }], { paidUsd: 4, createdAt: '2026-08-20T03:00:00.000Z' })
    const legacyId = Number(legacy.sale.id)
    const legacyBefore = await sale(legacyId)
    const oldShiftBefore = await shiftCash('2026-08-20 02:00:00', '2026-08-20 04:00:00')
    const nowShiftOpen = canonical(Date.now() - 3600 * 1000)
    const nowShiftBefore = await shiftCash(nowShiftOpen, null)
    const settled = await settle(legacyId, [{ method: 'Cash', amount_usd: 4, amount_khr: 0 }, { method: 'Cash', amount_usd: 6, amount_khr: 0 }], {}, 'settle the v0 sale: $6 more')
    const legacyAfter = await sale(legacyId)
    const legacyEvents = await events(legacyId)
    const oldShiftAfter = await shiftCash('2026-08-20 02:00:00', '2026-08-20 04:00:00')
    const nowShiftAfter = await shiftCash(nowShiftOpen, null)
    r.check(`B1 fixture: an imported v0 Not Paid sale, created_at stored non-canonical (${legacyBefore.created_at}), $4 deposit`, () => {
      assert.equal(legacyBefore.payments_version, 0)
      assert.notEqual(legacyBefore.created_at, '2026-08-20 03:00:00')
      assert.equal(legacyBefore.amount_paid_usd, 4)
    })
    r.check(`B2 the settle writes an opening at the canonical created_at and a collect now (got ${settled.status}; ${JSON.stringify(legacyEvents.map((e) => [e.origin, e.amount_paid_usd, e.received_at, e.drawer_effect]))})`, () => {
      assert.equal(settled.status, 200, JSON.stringify(settled.body).slice(0, 300))
      assert.equal(legacyAfter.payments_version, 1)
      assert.deepEqual(legacyEvents.map((e) => [e.event_id === `opening:${legacyId}` ? 'opening-id' : e.event_id.split(':').slice(1).join(':'), e.origin, e.amount_paid_usd]),
        [['opening-id', 'opening', 4], ['0:in', 'collect', 6]])
      assert.equal(legacyEvents[0].received_at, '2026-08-20 03:00:00')
      assert.deepEqual([legacyEvents[1].branch_id, legacyEvents[1].cashier_id, legacyEvents[1].cashier_name], [1, 901, 'al_admin'])
    })
    r.check(`B3 the old shift keeps its $4, the later shift gets the $6 (old ${JSON.stringify(oldShiftBefore)} -> ${JSON.stringify(oldShiftAfter)}; now ${JSON.stringify(nowShiftBefore)} -> ${JSON.stringify(nowShiftAfter)})`, () => {
      assert.equal(oldShiftBefore.usd, 4)
      assert.equal(oldShiftAfter.usd, 4, 'the v0 rule would show 10 here')
      assert.equal(Number((nowShiftAfter.usd - nowShiftBefore.usd).toFixed(2)), 6)
    })

    // ---- K. an unreadable created_at still settles, on version 0 --------------------------------------------
    const broken = await H.importSale(h, 2, 'awaiting_payment', [{ productId: 404, name: 'PAY Oil', quantity: 5, price: 2 }], { paidUsd: 0, createdAt: '2026-08-21T03:00:00.000Z' })
    const brokenId = Number(broken.sale.id)
    await h.db.prepare("UPDATE sales SET created_at='not a time', amount_paid_usd=1, payment_method='Cash', payment_details='[{\"method\":\"Cash\",\"amount_usd\":1,\"amount_khr\":0}]' WHERE id=?").bind(brokenId).run()
    const brokenSettle = await settle(brokenId, [{ method: 'Cash', amount_usd: 1, amount_khr: 0 }, { method: 'Cash', amount_usd: 9, amount_khr: 0 }], {}, 'settle a sale whose created_at cannot be read')
    const brokenAfter = await sale(brokenId)
    const brokenEvents = await events(brokenId)
    r.check(`K1 the payment is not failed: it settles on version 0 with no events (got ${brokenSettle.status} ${brokenSettle.body.code || ''})`, () => {
      assert.equal(brokenSettle.status, 200, JSON.stringify(brokenSettle.body).slice(0, 200))
      assert.deepEqual([brokenAfter.sale_status, brokenAfter.payments_version, brokenSettle.body.payments_version], ['completed', 0, 0])
      assert.equal(brokenEvents.length, 0)
    })

    // ---- J. payment correction ------------------------------------------------------------------------------
    const mistyped = await H.createSale(h, { key: 'pay-j-mistyped', lines: [{ productId: 405, quantity: 5 }], paymentDetails: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], label: 'checkout $10 cash (really ABA)' })
    const mistypedId = Number(mistyped.body.id)
    const checkoutEvent = (await events(mistypedId))[0]
    const correctionStartedAt = canonical(Date.now() - 1000)
    const reopen = await h.call('PATCH', `/api/sales/${mistypedId}/status`, { sale_status: 'awaiting_payment', client_request_id: 'pay-j-reopen' }, 'reopen for payment correction')
    const corrected = await settle(mistypedId, [{ method: 'ABA', amount_usd: 10, amount_khr: 0 }], { replace_existing_payment: true }, 'correct the tender to ABA')
    const correctionEvents = await events(mistypedId)
    r.check(`J1 the correction pair is dated now, by the acting cashier, and nets to the new tender (reopen ${reopen.status}, correct ${corrected.status}; ${JSON.stringify(correctionEvents.map((e) => [e.direction, e.origin, e.payment_method, e.received_at]))})`, () => {
      assert.equal(reopen.status, 200, JSON.stringify(reopen.body).slice(0, 200))
      assert.equal(corrected.status, 200, JSON.stringify(corrected.body).slice(0, 200))
      assert.deepEqual(correctionEvents.slice(1).map((e) => [e.direction, e.origin, e.payment_method, e.reverses_event_id]),
        [['out', 'correction', 'Cash', null], ['in', 'correction', 'ABA', null]])
      for (const event of correctionEvents.slice(1)) assert.ok(event.received_at >= correctionStartedAt && event.received_at >= checkoutEvent.received_at, event.received_at)
      assert.deepEqual(net(correctionEvents), { usd: 10, khr: 0 })
    })
    const correctionUndo = await H.historyStep(h, Number(corrected.body.actionHistoryId), 'undo', 0, 'undo the correction')
    const correctionUndone = await events(mistypedId)
    const mistypedAfterUndo = await sale(mistypedId)
    r.check(`J2 undoing the correction answers both events, also dated now (got ${correctionUndo.status})`, () => {
      assert.equal(correctionUndo.status, 200, JSON.stringify(correctionUndo.body).slice(0, 200))
      assert.deepEqual(correctionUndone.slice(3).map((e) => [e.direction, e.origin]).sort(), [['in', 'correction'], ['out', 'correction']])
      for (const event of correctionUndone.slice(3)) assert.ok(event.received_at >= correctionStartedAt, event.received_at)
      assert.equal(mistypedAfterUndo.payment_method, 'Cash')
      assert.deepEqual(net(correctionUndone), { usd: 10, khr: 0 })
    })

    // A deposit at checkout, then the settle keyed wrong: the correction replaces the whole tender, dated now.
    const twoPayments = await H.createSale(h, { key: 'pay-j-two', status: 'awaiting_payment', lines: [{ productId: 405, quantity: 5 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }], label: 'checkout Not Paid $10 with a $2 deposit' })
    const twoId = Number(twoPayments.body.id)
    const twoSettle = await settle(twoId, [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }, { method: 'Cash', amount_usd: 8, amount_khr: 0 }], {}, 'settle $8 keyed as cash')
    const twoBefore = await events(twoId)
    const twoReopen = await h.call('PATCH', `/api/sales/${twoId}/status`, { sale_status: 'awaiting_payment', client_request_id: 'pay-j-two-reopen' }, 'reopen the two-payment sale')
    const twoCorrect = await settle(twoId, [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }, { method: 'ABA', amount_usd: 8, amount_khr: 0 }], { replace_existing_payment: true }, 'correct the $8 to ABA')
    const twoAfter = await events(twoId)
    r.check(`J3 with a deposit and a settle the correction replaces the whole tender, dated now (${twoSettle.status}/${twoReopen.status}/${twoCorrect.status}; ${JSON.stringify(twoAfter.map((e) => [e.direction, e.origin, e.amount_paid_usd, e.received_at]))})`, () => {
      assert.equal(twoCorrect.status, 200, JSON.stringify(twoCorrect.body).slice(0, 200))
      const collect = twoBefore[1]
      assert.equal(collect.origin, 'collect')
      assert.deepEqual(twoAfter.slice(2).map((e) => [e.direction, e.origin, e.amount_paid_usd]), [['out', 'correction', 10], ['in', 'correction', 10]])
      for (const event of twoAfter.slice(2)) assert.ok(event.received_at >= collect.received_at, event.received_at)
      assert.deepEqual(net(twoAfter), { usd: 10, khr: 0 })
    })

    // ---- L. correction dating, discriminating (owner ruling 27 Oct 2026) ------------------------------------
    // A v0 deposit on 20 Aug (opening event), a settle whose event is moved to 10 Sep (restore mode: the only way an
    // append-only row can be re-dated in a fixture), then a correction. It counts on the day it is made: the 20 Aug and
    // 10 Sep shifts keep what they took, the current shift takes the correction (cash -8, ABA +8). Its undo is dated now too.
    const dated = await H.importSale(h, 3, 'awaiting_payment', [{ productId: 403, name: 'PAY Mask', quantity: 5, price: 2 }], { paidUsd: 2, createdAt: '2026-08-20T03:00:00.000Z' })
    const datedId = Number(dated.sale.id)
    const datedSettle = await settle(datedId, [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }, { method: 'Cash', amount_usd: 8, amount_khr: 0 }], {}, 'settle the dated sale $8 cash')
    const collectRow = (await events(datedId)).find((event) => event.origin === 'collect')
    const { id: _collectId, created_at: _created, ...collectColumns } = collectRow
    const backdated = { ...collectColumns, received_at: '2026-09-10 05:00:00' }
    // The maintenance flag is guarded like stock: it is set and cleared under the transient stock permit, in one batch.
    const permit = "INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"
    await h.db.batch([
      h.db.prepare(permit),
      h.db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance','{\"mode\":\"restore\"}')"),
      h.db.prepare('DELETE FROM sale_payment_events WHERE id=?').bind(collectRow.id),
      h.db.prepare(`INSERT INTO sale_payment_events(${Object.keys(backdated).join(',')}) VALUES(${Object.keys(backdated).map(() => '?').join(',')})`).bind(...Object.values(backdated)),
      h.db.prepare("DELETE FROM system_flags WHERE key IN ('maintenance','stock_transaction_permit')"),
    ])
    const augShift = () => shiftCash('2026-08-20 02:00:00', '2026-08-20 04:00:00')
    const sepShift = () => shiftCash('2026-09-10 04:00:00', '2026-09-10 06:00:00')
    const [augBefore, sepBefore, nowBefore] = [await augShift(), await sepShift(), await shiftCash(canonical(Date.now() - 3600 * 1000), null)]
    const datedReopen = await h.call('PATCH', `/api/sales/${datedId}/status`, { sale_status: 'awaiting_payment', client_request_id: 'pay-l-reopen' }, 'reopen the dated sale')
    const datedCorrect = await settle(datedId, [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }, { method: 'ABA', amount_usd: 8, amount_khr: 0 }], { replace_existing_payment: true }, 'correct the $8 to ABA')
    const datedEvents = await events(datedId)
    const [augAfter, sepAfter, nowAfter] = [await augShift(), await sepShift(), await shiftCash(canonical(Date.now() - 3600 * 1000), null)]
    r.check(`L1 the correction is dated now, not at the settle (10 Sep) or the deposit (20 Aug) (settle ${datedSettle.status}, reopen ${datedReopen.status}, correct ${datedCorrect.status}; ${JSON.stringify(datedEvents.map((e) => [e.direction, e.origin, e.received_at]))})`, () => {
      assert.equal(datedCorrect.status, 200, JSON.stringify(datedCorrect.body).slice(0, 200))
      const pair = datedEvents.filter((e) => e.origin === 'correction')
      assert.deepEqual(pair.map((e) => [e.direction, e.amount_paid_usd]), [['out', 10], ['in', 10]])
      for (const event of pair) assert.ok(event.received_at >= canonical(Date.now() - 600 * 1000), `dated now, got ${event.received_at}`)
    })
    r.check(`L2 only the current shift moves: cash -8, ABA +8; 20 Aug and 10 Sep unchanged (aug ${JSON.stringify(augBefore)} -> ${JSON.stringify(augAfter)}; sep ${JSON.stringify(sepBefore)} -> ${JSON.stringify(sepAfter)}; now ${JSON.stringify(nowBefore)} -> ${JSON.stringify(nowAfter)})`, () => {
      assert.deepEqual(augAfter, augBefore)
      assert.deepEqual(sepAfter, sepBefore)
      assert.deepEqual([sepBefore.usd, sepBefore.digital.usd], [8, 0], 'fixture: the 10 Sep shift took the $8 settle in cash')
      assert.deepEqual([Number((nowAfter.usd - nowBefore.usd).toFixed(2)), Number((nowAfter.digital.usd - nowBefore.digital.usd).toFixed(2))], [-8, 8])
    })
    const datedUndo = await H.historyStep(h, Number(datedCorrect.body.actionHistoryId), 'undo', 0, 'undo the dated correction')
    const [sepUndone, nowUndone] = [await sepShift(), await shiftCash(canonical(Date.now() - 3600 * 1000), null)]
    r.check(`L3 undoing that correction is dated now as well: 10 Sep unchanged, the current shift back to before (undo ${datedUndo.status}; sep ${JSON.stringify(sepUndone)}; now ${JSON.stringify(nowUndone)})`, () => {
      assert.equal(datedUndo.status, 200, JSON.stringify(datedUndo.body).slice(0, 200))
      assert.deepEqual(sepUndone, sepBefore)
      assert.deepEqual([nowUndone.usd, nowUndone.digital.usd], [nowBefore.usd, nowBefore.digital.usd])
    })

    // ---- X. exchange refund credit through instalment, settle, cancel and its undo (release review P2-1) --------
    await H.seedProduct(h, 406, 'PAY Lip', 10, 200)
    await H.seedProduct(h, 407, 'PAY Palette', 16, 200)
    const exchange = async (key) => {
      const original = await H.createSale(h, { key, status: 'awaiting_payment', lines: [{ productId: 406, quantity: 2 }], paymentDetails: [{ method: 'Cash', amount_usd: 15, amount_khr: 0 }], label: `${key}: Not Paid $20, $15 paid` })
      const [line] = await h.all('SELECT id FROM sale_items WHERE sale_id=?', original.body.id)
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: original.body.id, items: [{ sale_item_id: line.id, quantity: 1 }], replacement_items: [{ branch_id: 1, product_id: 407, quantity: 1 }] }, `${key}: quote`)
      const { customer_return_create_version: _c, customer_return_edit_version: _e, exchange: quoted, ...expected } = quote.body
      const created = await h.call('POST', '/api/returns', { client_request_id: `${key}-return`, money_precision_version: 1, sale_id: original.body.id, reason: 'pay exchange', expected_quote: expected, expected_exchange: quoted,
        exchange_payment: { details: [], change_currency: 'USD' }, items: [{ sale_item_id: line.id, quantity: 1, stock_action: 'restock', branch_id: 1 }], replacement_items: [{ branch_id: 1, product_id: 407, quantity: 1 }] }, `${key}: exchange`)
      assert.equal(created.status, 200, JSON.stringify(created.body).slice(0, 300))
      const returnRow = await h.one('SELECT * FROM returns WHERE id=?', created.body.id)
      return { returnId: Number(returnRow.id), saleId: Number(returnRow.replacement_sale_id) }
    }
    const cancelExchange = async (returnId, key) => {
      const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', returnId)
      return h.call('POST', '/api/returns/bulk', { client_request_id: key, field: 'status', source: 'completed', target: 'cancelled',
        items: [{ id: returnId, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null, replacement: { return_ids: [] } }] }, key)
    }
    const owing = async (id) => { const row = await sale(id); const total = (await h.one('SELECT total_usd FROM sales WHERE id=?', id)).total_usd; return { status: row.sale_status, paid: row.amount_paid_usd, owes: Number((total - row.amount_paid_usd).toFixed(4)), version: row.payments_version } }
    const mismatch = async () => (await health()).payment_events_mismatch
    const recentShift = () => shiftCash(canonical(Date.now() - 3600 * 1000), null)

    const xi = await exchange('pay-x-instalment')
    const xiBorn = await owing(xi.saleId)
    const xiPay = await pay(xi.saleId, [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }], {}, 'instalment $2 on the replacement sale')
    const xiPaid = await owing(xi.saleId)
    const xiShiftBefore = await recentShift()
    const xiCancel = await cancelExchange(xi.returnId, 'pay-x-cancel-1')
    const xiCancelled = await owing(xi.saleId)
    const xiShiftAfter = await recentShift()
    const xiMismatch = await mismatch()
    r.check(`X1 credit $5 + instalment $2, cancel the exchange: paid 2, owes 14, the credit left the drawer, mismatch 0 (born ${JSON.stringify(xiBorn)}, pay ${xiPay.status}, after ${JSON.stringify(xiPaid)}, cancel ${xiCancel.status} -> ${JSON.stringify(xiCancelled)}; cash ${xiShiftBefore.usd} -> ${xiShiftAfter.usd}; mismatch ${xiMismatch})`, () => {
      assert.deepEqual([xiBorn.paid, xiBorn.owes, xiPay.status, xiPaid.paid, xiPaid.version], [5, 11, 200, 7, 1])
      assert.equal(xiCancel.status, 200, JSON.stringify(xiCancel.body).slice(0, 200))
      assert.deepEqual([xiCancelled.status, xiCancelled.paid, xiCancelled.owes], ['awaiting_payment', 2, 14])
      assert.equal(Number((xiShiftBefore.usd - xiShiftAfter.usd).toFixed(2)), 5)
      assert.equal(xiMismatch, 0)
    })
    const xiHistory = Number(xiCancel.body.actionHistoryId || (await h.one("SELECT id FROM action_history WHERE label LIKE '%refund credit%' ORDER BY id DESC LIMIT 1")).id)
    const xiUndo = await H.historyStep(h, xiHistory, 'undo', 0, 'undo the exchange cancel')
    const xiRestored = await owing(xi.saleId)
    const xiUndoMismatch = await mismatch()
    const xiRedo = await H.historyStep(h, xiHistory, 'redo', 1, 'redo the exchange cancel')
    const xiRedone = await owing(xi.saleId)
    const xiRedoMismatch = await mismatch()
    const xiEvents = (await events(xi.saleId)).filter((e) => e.note && e.note.startsWith('exchange refund credit'))
    r.check(`X2 undo puts the credit back as an in, redo takes it out again; mismatch 0 each time (undo ${xiUndo.status} ${JSON.stringify(xiRestored)} ${xiUndoMismatch}; redo ${xiRedo.status} ${JSON.stringify(xiRedone)} ${xiRedoMismatch}; ${JSON.stringify(xiEvents.map((e) => [e.direction, e.amount_paid_usd, !!e.reverses_event_id]))})`, () => {
      assert.equal(xiUndo.status, 200, JSON.stringify(xiUndo.body).slice(0, 200))
      assert.deepEqual([xiRestored.paid, xiRestored.owes, xiUndoMismatch], [7, 9, 0])
      assert.equal(xiRedo.status, 200, JSON.stringify(xiRedo.body).slice(0, 200))
      assert.deepEqual([xiRedone.paid, xiRedone.owes, xiRedoMismatch], [2, 14, 0])
      assert.deepEqual(xiEvents.map((e) => [e.direction, e.amount_paid_usd, !!e.reverses_event_id]), [['out', 5, false], ['in', 5, true], ['out', 5, true]])
    })

    const xs = await exchange('pay-x-settle')
    const xsStored = JSON.parse((await sale(xs.saleId)).payment_details)
    const xsSettle = await settle(xs.saleId, [...xsStored.map((row) => ({ method: row.method, amount_usd: row.amount_usd, amount_khr: row.amount_khr })), { method: 'ABA', amount_usd: 11, amount_khr: 0 }], {}, 'settle the replacement sale $11 ABA')
    const xsKept = JSON.parse((await sale(xs.saleId)).payment_details)
    const xsCancel = await cancelExchange(xs.returnId, 'pay-x-cancel-2')
    const xsCancelled = await owing(xs.saleId)
    const xsMismatch = await mismatch()
    r.check(`X3 a settle keeps the refund_credit marker, so the cancel still finds the credit: paid 11, owes 5, mismatch 0 (settle ${xsSettle.status}; rows ${JSON.stringify(xsKept)}; cancel ${xsCancel.status} -> ${JSON.stringify(xsCancelled)}; ${xsMismatch})`, () => {
      assert.equal(xsSettle.status, 200, JSON.stringify(xsSettle.body).slice(0, 200))
      assert.ok(xsKept.some((row) => row.refund_credit === true), 'the settle kept the flag')
      assert.equal(xsCancel.status, 200, JSON.stringify(xsCancel.body).slice(0, 200))
      assert.deepEqual([xsCancelled.status, xsCancelled.paid, xsCancelled.owes, xsMismatch], ['awaiting_payment', 11, 5, 0])
    })

    // ---- X4/X5: a payment correction keeps the credit and replaces only the customer's money (release review 6.0.982 P2) --
    const plainRows = (rows) => rows.map((row) => ({ method: row.method, amount_usd: row.amount_usd, amount_khr: row.amount_khr }))
    const xc = await exchange('pay-x-correct')
    const xcStored = JSON.parse((await sale(xc.saleId)).payment_details)
    const xcSettle = await settle(xc.saleId, [...plainRows(xcStored), { method: 'ABA', amount_usd: 11, amount_khr: 0 }], {}, 'settle the replacement sale $11 ABA (to be corrected)')
    const xcReopen = await h.call('PATCH', `/api/sales/${xc.saleId}/status`, { sale_status: 'awaiting_payment', client_request_id: 'pay-x-correct-reopen' }, 'reopen the replacement sale')
    const xcEventsBefore = (await events(xc.saleId)).length
    const xcRevBefore = await revision(xc.saleId)
    const xcDropped = await settle(xc.saleId, [{ method: 'Cash', amount_usd: 16, amount_khr: 0 }], { replace_existing_payment: true }, 'correction that folds the credit into cash')
    const xcAltered = await settle(xc.saleId, [{ method: 'Cash', amount_usd: 4, amount_khr: 0 }, { method: 'Cash', amount_usd: 12, amount_khr: 0 }], { replace_existing_payment: true }, 'correction that changes the credit amount')
    const xcAfterRefusals = [(await events(xc.saleId)).length, await revision(xc.saleId)]
    r.check(`X5 a correction that drops or alters the credit row is refused and writes nothing (${xcDropped.status} ${xcDropped.body.code}, ${xcAltered.status} ${xcAltered.body.code})`, () => {
      assert.deepEqual([xcSettle.status, xcReopen.status], [200, 200])
      assert.deepEqual([xcDropped.status, xcDropped.body.code, xcAltered.status, xcAltered.body.code], [400, 'refund_credit_row_required', 400, 'refund_credit_row_required'])
      assert.deepEqual(xcAfterRefusals, [xcEventsBefore, xcRevBefore])
    })
    const xcShiftBefore = await recentShift()
    const xcCorrect = await settle(xc.saleId, [...plainRows(xcStored), { method: 'Cash', amount_usd: 11, amount_khr: 0 }], { replace_existing_payment: true }, 'correct the $11 ABA to cash, credit kept')
    const xcRows = JSON.parse((await sale(xc.saleId)).payment_details)
    const xcPair = (await events(xc.saleId)).filter((e) => e.origin === 'correction' && !String(e.note || '').startsWith('exchange'))
    const xcShiftMid = await recentShift()
    const xcCorrected = await owing(xc.saleId)
    const xcCancel = await cancelExchange(xc.returnId, 'pay-x-cancel-3')
    const xcCancelled = await owing(xc.saleId)
    const xcShiftAfter = await recentShift()
    const xcMismatch = await mismatch()
    r.check(`X4 credit -> settle -> correction keeps the credit; cancelling the exchange then leaves paid 11, Not Paid, owing 5 (correct ${xcCorrect.status} ${xcCorrect.body.code || ''}; rows ${JSON.stringify(xcRows)}; pair ${JSON.stringify(xcPair.map((e) => [e.direction, e.payment_method, e.amount_paid_usd]))}; cash ${xcShiftBefore.usd} -> ${xcShiftMid.usd} -> ${xcShiftAfter.usd}, ABA ${xcShiftBefore.digital.usd} -> ${xcShiftMid.digital.usd}; cancel ${xcCancel.status} -> ${JSON.stringify(xcCancelled)}; mismatch ${xcMismatch})`, () => {
      assert.equal(xcCorrect.status, 200, JSON.stringify(xcCorrect.body).slice(0, 200))
      assert.deepEqual(xcRows.map((row) => [row.method, row.amount_usd, row.refund_credit === true]), [['Cash', 5, true], ['Cash', 11, false]])
      // Only the customer's $11 goes out (ABA) and comes back in (cash); the $5 credit is not touched.
      assert.deepEqual(xcPair.map((e) => [e.direction, e.payment_method, e.amount_paid_usd]), [['out', 'ABA', 11], ['in', 'Cash', 11]])
      assert.deepEqual([xcCorrected.status, xcCorrected.paid, xcCorrected.owes], ['completed', 16, 0])
      assert.deepEqual([Number((xcShiftMid.usd - xcShiftBefore.usd).toFixed(2)), Number((xcShiftMid.digital.usd - xcShiftBefore.digital.usd).toFixed(2))], [11, -11])
      assert.equal(xcCancel.status, 200, JSON.stringify(xcCancel.body).slice(0, 200))
      assert.deepEqual([xcCancelled.status, xcCancelled.paid, xcCancelled.owes, xcMismatch], ['awaiting_payment', 11, 5, 0])
      assert.equal(Number((xcShiftMid.usd - xcShiftAfter.usd).toFixed(2)), 5, 'the credit leaves the drawer, nothing else does')
    })
    const xcHistory = Number(xcCancel.body.actionHistoryId || (await h.one("SELECT id FROM action_history WHERE label LIKE '%refund credit%' ORDER BY id DESC LIMIT 1")).id)
    const xcUndo = await H.historyStep(h, xcHistory, 'undo', 0, 'undo the exchange cancel after the correction')
    const xcRestored = [await owing(xc.saleId), await mismatch(), await recentShift()]
    const xcRedo = await H.historyStep(h, xcHistory, 'redo', 1, 'redo the exchange cancel after the correction')
    const xcRedone = [await owing(xc.saleId), await mismatch(), await recentShift()]
    r.check(`X6 undo and redo of that cancel: 16/0 then 11/5, the drawer follows the credit, mismatch 0 (undo ${xcUndo.status} ${JSON.stringify(xcRestored)}; redo ${xcRedo.status} ${JSON.stringify(xcRedone)})`, () => {
      assert.equal(xcUndo.status, 200, JSON.stringify(xcUndo.body).slice(0, 200))
      assert.deepEqual([xcRestored[0].status, xcRestored[0].paid, xcRestored[0].owes, xcRestored[1]], ['completed', 16, 0, 0])
      assert.equal(xcRestored[2].usd, xcShiftMid.usd)
      assert.equal(xcRedo.status, 200, JSON.stringify(xcRedo.body).slice(0, 200))
      assert.deepEqual([xcRedone[0].status, xcRedone[0].paid, xcRedone[0].owes, xcRedone[1]], ['awaiting_payment', 11, 5, 0])
      assert.equal(xcRedone[2].usd, xcShiftAfter.usd)
    })

    // ---- M. the correction takes back the change the events handed out, net (release review 6.0.982 P3) --------
    // Two payments that both gave change: a $4 instalment re-keyed in the fixture as $5 handed over with $1 back (the
    // instalment route only states change on a covering payment; restore mode is the only way to write that row), then a
    // covering instalment of $8 with $2 back, both stated as actual change so the drawer counts them. The sale's change
    // columns hold only the last payment's $2; the events hold $3.
    const mSale = await H.createSale(h, { key: 'pay-m-change', status: 'awaiting_payment', lines: [{ productId: 401, quantity: 5 }], label: 'Not Paid $10 for the change case' })
    const mId = Number(mSale.body.id)
    const mPay = await pay(mId, [{ method: 'Cash', amount_usd: 4, amount_khr: 0 }], {}, 'instalment $4 (re-keyed below as $5, $1 back)')
    const mSettle = await pay(mId, [{ method: 'Cash', amount_usd: 8, amount_khr: 0 }], { body: { change_is_actual: true, change_usd: 2, change_khr: 0 } }, 'covering instalment $8 cash with $2 back')
    const mFirst = (await events(mId)).find((event) => event.origin === 'collect')
    const { id: _mId, created_at: _mCreated, ...mColumns } = mFirst
    const mRekeyed = { ...mColumns, amount_paid_usd: 5, payment_details: JSON.stringify([{ method: 'Cash', amount_usd: 5, amount_khr: 0 }]), change_usd: 1, change_khr: 0, change_is_actual: 1, change_exchange_rate: 4000 }
    await h.db.batch([
      h.db.prepare(permit),
      h.db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance','{\"mode\":\"restore\"}')"),
      h.db.prepare('DELETE FROM sale_payment_events WHERE id=?').bind(mFirst.id),
      h.db.prepare(`INSERT INTO sale_payment_events(${Object.keys(mRekeyed).join(',')}) VALUES(${Object.keys(mRekeyed).map(() => '?').join(',')})`).bind(...Object.values(mRekeyed)),
      h.db.prepare("DELETE FROM system_flags WHERE key IN ('maintenance','stock_transaction_permit')"),
      h.db.prepare(`UPDATE sales SET amount_paid_usd=13, payment_details='[{"method":"Cash","amount_usd":13,"amount_khr":0}]' WHERE id=?`).bind(mId),
    ])
    const mColumnsChange = (await sale(mId)).change_usd
    const mShiftBefore = await recentShift()
    const mReopen = await h.call('PATCH', `/api/sales/${mId}/status`, { sale_status: 'awaiting_payment', client_request_id: 'pay-m-reopen' }, 'reopen the change sale')
    const mCorrect = await settle(mId, [{ method: 'ABA', amount_usd: 10, amount_khr: 0 }], { replace_existing_payment: true }, 'correct the whole payment to $10 ABA')
    const mOut = (await events(mId)).find((event) => event.origin === 'correction' && event.direction === 'out')
    const mShiftAfter = await recentShift()
    const mMismatch = await mismatch()
    r.check(`M1 the correction out takes back $3 change (both payments), not the $2 in the sale's columns; the drawer loses exactly the $10 net cash (pay ${mPay.status}, settle ${mSettle.status}, columns ${mColumnsChange}, reopen ${mReopen.status}, correct ${mCorrect.status} ${mCorrect.body.code || ''}; out ${JSON.stringify(mOut && [mOut.amount_paid_usd, mOut.change_usd])}; cash ${mShiftBefore.usd} -> ${mShiftAfter.usd}; mismatch ${mMismatch})`, () => {
      assert.deepEqual([mPay.status, mSettle.status, mColumnsChange, mReopen.status], [200, 200, 2, 200])
      assert.equal(mCorrect.status, 200, JSON.stringify(mCorrect.body).slice(0, 200))
      assert.deepEqual([mOut.amount_paid_usd, mOut.change_usd], [13, 3])
      assert.equal(Number((mShiftBefore.usd - mShiftAfter.usd).toFixed(2)), 10)
      assert.equal(mMismatch, 0)
    })

    // ---- P3: audit rows of the money writers carry no personal fields -----------------------------------------
    const named = await H.createSale(h, { key: 'pay-p3-named', status: 'awaiting_payment', lines: [{ productId: 402, quantity: 1 }], extra: { customer_name: 'Payprobe Person', customer_phone: '012999888' }, label: 'Not Paid $2 with a customer name and phone' })
    await pay(Number(named.body.id), [{ method: 'Cash', amount_usd: 1, amount_khr: 0 }], {}, 'instalment on the named sale')
    const namedSearchBefore = (await h.one('SELECT search_normalized FROM sales WHERE id=?', named.body.id)).search_normalized
    const namedSettle = await settle(Number(named.body.id), [{ method: 'Cash', amount_usd: 1, amount_khr: 0 }, { method: 'Cash', amount_usd: 1, amount_khr: 0 }], {}, 'settle the named sale')
    const namedAudit = await h.all("SELECT details FROM audit_logs WHERE action='sale_settlement' AND entity_id=?", String(named.body.id))
    r.check(`P3 the settle and instalment audit rows hold ids and money only (${namedAudit.length} rows)`, () => {
      assert.equal(namedAudit.length, 2)
      for (const row of namedAudit) {
        assert.ok(!/payprobe|012999888|search_normalized/i.test(row.details), row.details.slice(0, 300))
        assert.ok(/amount_paid_usd/.test(row.details))
      }
    })
    const namedReceipts = await h.all("SELECT before_json,after_json FROM sale_mutation_receipts WHERE mutation_kind='settlement' AND sale_id=?", Number(named.body.id))
    const namedUndo = await H.historyStep(h, Number(namedSettle.body.actionHistoryId), 'undo', 0, 'undo the named settle')
    const namedSearchUndone = (await h.one('SELECT search_normalized FROM sales WHERE id=?', named.body.id)).search_normalized
    r.check(`P4 the undo receipts hold no search text, and an undo recomputes it from the sale (${namedReceipts.length} receipts; undo ${namedUndo.status}; ${JSON.stringify([namedSearchBefore, namedSearchUndone])})`, () => {
      assert.equal(namedReceipts.length, 2)
      for (const row of namedReceipts) assert.ok(!/payprobe|012999888|search_normalized/i.test(row.before_json + row.after_json), row.before_json.slice(0, 300))
      assert.equal(namedUndo.status, 200, JSON.stringify(namedUndo.body).slice(0, 200))
      assert.ok(namedSearchBefore && /payprobe/i.test(namedSearchBefore), 'fixture: the sale is searchable by its customer')
      assert.equal(namedSearchUndone, namedSearchBefore)
    })

    // ---- H. permissions -------------------------------------------------------------------------------------
    const viewer = await h.addEmployee(960, 'pay_viewer', { sales: true, 'sales:status': false })
    const deniedPay = await h.call('POST', `/api/sales/${legacyId}/payments`, { client_request_id: 'pay-h-1', expected_exchange_rate: 4000, payment_details: [{ method: 'Cash', amount_usd: 1, amount_khr: 0 }] }, 'pay without sales:status', { cookie: viewer })
    const deniedSettle = await h.call('PATCH', `/api/sales/${legacyId}/status`, { sale_status: 'completed', client_request_id: 'pay-h-2', expected_exchange_rate: 4000, payment_details: [{ method: 'Cash', amount_usd: 1, amount_khr: 0 }] }, 'settle without sales:status', { cookie: viewer })
    const owner = await h.addEmployee(961, 'pay_status', { sales: true })
    const ownNotPaid = await H.createSale(h, { key: 'pay-h-sale', status: 'awaiting_payment', lines: [{ productId: 402, quantity: 1 }], label: 'Not Paid $2 for the permitted employee' })
    const allowedPay = await h.call('POST', `/api/sales/${ownNotPaid.body.id}/payments`, { client_request_id: 'pay-h-3', expected_exchange_rate: 4000, payment_details: [{ method: 'Cash', amount_usd: 1, amount_khr: 0 }] }, 'pay with sales:status Full', { cookie: owner })
    const [permittedEvent] = await events(Number(ownNotPaid.body.id))
    r.check(`H1 without sales:status both writers refuse (pay ${deniedPay.status}, settle ${deniedSettle.status}); with it the payment lands (${allowedPay.status}) as that cashier`, () => {
      assert.equal(deniedPay.status, 403)
      assert.equal(deniedSettle.status, 403)
      assert.equal(allowedPay.status, 200, JSON.stringify(allowedPay.body).slice(0, 200))
      assert.equal(permittedEvent.cashier_id, 961)
    })

    // ---- I. a settle and an instalment sent together (they serialise here; I2 below forces the stale read) ------
    const raceResults = []
    for (let n = 0; n < 4; n++) {
      const race = await H.createSale(h, { key: `pay-i-${n}`, status: 'awaiting_payment', lines: [{ productId: 401, quantity: 5 }], paymentDetails: [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }], label: `race sale ${n}` })
      const raceId = Number(race.body.id)
      const [a, b] = await Promise.all([
        settle(raceId, [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }, { method: 'Cash', amount_usd: 8, amount_khr: 0 }], {}, `race ${n}: settle $8`),
        pay(raceId, [{ method: 'ABA', amount_usd: 3, amount_khr: 0 }], {}, `race ${n}: instalment $3`),
      ])
      const row = await sale(raceId)
      raceResults.push({ raceId, a: a.status, b: b.status, codes: [a.body.code, b.body.code], paid: row.amount_paid_usd, net: net(await events(raceId)) })
    }
    r.check(`I1 never both on one revision: money is never counted twice and the events always equal the sale (${JSON.stringify(raceResults)})`, () => {
      for (const result of raceResults) {
        // Exactly one lands: after the settle the sale owes nothing (sale_not_owing); after the instalment the settle no longer
        // repeats every recorded row (partial_payment_reduced); on one revision the guard refuses the loser (write_conflict).
        assert.equal([result.a, result.b].filter((status) => status === 200).length, 1)
        assert.ok(result.paid === (result.a === 200 ? 10 : 5), `paid ${result.paid}`)
        assert.deepEqual(result.net, { usd: result.paid, khr: 0 })
      }
    })

    // ---- G. health ----------------------------------------------------------------------------------------
    const finalHealth = await health()
    r.check(`G1 payment_events_mismatch stays 0 after every writer above (${finalHealth.payment_events_mismatch})`, () => assert.equal(finalHealth.payment_events_mismatch, 0))
    await h.db.prepare('UPDATE sales SET amount_paid_usd=amount_paid_usd+1 WHERE id=?').bind(unpaidId).run()
    const tampered = await health()
    await h.db.prepare('UPDATE sales SET amount_paid_usd=amount_paid_usd-1 WHERE id=?').bind(unpaidId).run()
    r.check(`G2 positive control: a sale paid without its event is counted (${tampered.payment_events_mismatch})`, () => assert.equal(tampered.payment_events_mismatch, 1))

    const budget = H.budgetLine(h.metrics.filter((entry) => /instalment|settle|undo|redo|pay /.test(entry.label)))
    r.check(`budget: the worst payment request fits the Free plan (${budget.label}: ${budget.statements} statements)`, () => assert.ok(budget.statements <= H.FREE_QUERY_LIMIT))
  } finally {
    await h.mf.dispose()
  }
  await staleReadRace(r)
  await creditMethodSurvives(r)
  const failed = r.results.filter((result) => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} sale payment writers: ${r.results.length - failed.length}/${r.results.length} checks hold${mutation ? ` (PAY_MUTATION=${mutation}, expected RED)` : ''}`)
  if (failed.length) process.exitCode = 1
}

// I2. A deterministic stale read. A second Worker is bundled with a test-only hold: a writer whose request id starts
// with "hold-" stops after reading the sale until a writer whose id starts with "release-" has COMMITTED (5 s cap).
// The held writer then commits on the revision it read before the other write, which is exactly a concurrent
// settle + instalment on one sale. It must be refused (409 write_conflict) and leave nothing of its own.
const HOLD = "await new Promise<void>((resolve) => { (globalThis as any).__payRelease = resolve; setTimeout(resolve, 5000) })"
const RELEASE = '(globalThis as any).__payRelease?.()'
const RACE_HOOKS = [
  { name: 'hold-payment', file: 'src/routes/sales.ts', from: '  const before = await readSaleSettlementState(db, id)\n',
    to: `  const before = await readSaleSettlementState(db, id)\n  if (String(requestId).startsWith('hold-')) ${HOLD}\n` },
  { name: 'release-payment', file: 'src/routes/sales.ts', from: '    response.actionHistoryId = Number(results[historyIndex]?.meta?.last_row_id || 0)\n',
    to: `    response.actionHistoryId = Number(results[historyIndex]?.meta?.last_row_id || 0)\n    if (String(requestId).startsWith('release-')) ${RELEASE}\n` },
  { name: 'hold-settle', file: 'src/routes/sales.ts', from: '    const before = await readSaleSettlementState(db, Number(id))\n',
    to: `    const before = await readSaleSettlementState(db, Number(id))\n    if (String(settlementRequestId || '').startsWith('hold-')) ${HOLD}\n` },
  { name: 'release-settle', file: 'src/routes/sales.ts', from: '      settlementResponse.actionHistoryId = Number(results[settlementHistoryIndex]?.meta?.last_row_id || 0)\n',
    to: `      settlementResponse.actionHistoryId = Number(results[settlementHistoryIndex]?.meta?.last_row_id || 0)\n      if (String(settlementRequestId || '').startsWith('release-')) ${RELEASE}\n` },
]

// R. The refund credit keeps the method it was booked under (release review round 5). A bulk relabel or a linked Settings rename of
// that method must leave the credit row alone, and the exchange cancel must reverse the credit by the method on the credit row of the
// event that recorded it -- so the drawer's EXPECTED cash does not move across relabel + cancel, on version 1 and version 0 sales.
async function creditMethodSurvives(r) {
  const h = await H.startWorker({ patches: mutation ? MUTATIONS[mutation] : [] })
  const shiftReader = await loadShiftReader()
  const env = { DB: h.db }
  const session = { scope_mode: 'shop_wide', user_id: 901, branch_id: 1, opened_at: '2000-01-01 00:00:00', closed_at: null, cancelled_at: null, opening_float_usd: 0, opening_float_khr: 0 }
  const expectedCash = async () => { const result = await shiftReader.loadShiftReconciliation(env, session, Date.now() + 5000); return (result.reconciliation || result).expected.usd }
  const mismatch = async () => (await h.db.prepare(healthSql()).all()).results[0].payment_events_mismatch
  const tender = async (id) => JSON.parse((await h.one('SELECT payment_details FROM sales WHERE id=?', id)).payment_details || '[]')
  const creditRow = async (id) => (await tender(id)).find((row) => row.refund_credit === true) || null
  try {
    await H.seedProduct(h, 406, 'PAY Lip', 10, 200)
    await H.seedProduct(h, 407, 'PAY Palette', 16, 200)
    const exchange = async (key) => {
      const original = await H.createSale(h, { key, status: 'awaiting_payment', lines: [{ productId: 406, quantity: 2 }], paymentDetails: [{ method: 'Cash', amount_usd: 15, amount_khr: 0 }], label: `${key}: Not Paid $20, $15 paid` })
      const [line] = await h.all('SELECT id FROM sale_items WHERE sale_id=?', original.body.id)
      const quote = await h.call('POST', '/api/returns/quote', { sale_id: original.body.id, items: [{ sale_item_id: line.id, quantity: 1 }], replacement_items: [{ branch_id: 1, product_id: 407, quantity: 1 }] }, `${key}: quote`)
      const { customer_return_create_version: _c, customer_return_edit_version: _e, exchange: quoted, ...expected } = quote.body
      const created = await h.call('POST', '/api/returns', { client_request_id: `${key}-return`, money_precision_version: 1, sale_id: original.body.id, reason: 'pay exchange', expected_quote: expected, expected_exchange: quoted,
        exchange_payment: { details: [], change_currency: 'USD' }, items: [{ sale_item_id: line.id, quantity: 1, stock_action: 'restock', branch_id: 1 }], replacement_items: [{ branch_id: 1, product_id: 407, quantity: 1 }] }, `${key}: exchange`)
      assert.equal(created.status, 200, JSON.stringify(created.body).slice(0, 300))
      const returnRow = await h.one('SELECT * FROM returns WHERE id=?', created.body.id)
      return { returnId: Number(returnRow.id), saleId: Number(returnRow.replacement_sale_id) }
    }
    const cancelExchange = async (returnId, key) => {
      const row = await h.one('SELECT status,return_type,updated_at FROM returns WHERE id=?', returnId)
      return h.call('POST', '/api/returns/bulk', { client_request_id: key, field: 'status', source: 'completed', target: 'cancelled',
        items: [{ id: returnId, expected_status: String(row.status || 'completed'), expected_method: String(row.return_type || 'restock'), expected_updated_at: row.updated_at ?? null, replacement: { return_ids: [] } }] }, key)
    }
    const relabel = async (id, key) => {
      const row = await h.one('SELECT updated_at FROM sales WHERE id=?', id)
      return h.call('POST', '/api/sales/bulk-update', { client_request_id: key, items: [{ id, expected_updated_at: row.updated_at }], action: { kind: 'payment_method', source: 'Cash', target: 'ABA' } }, `${key}: relabel Cash -> ABA`)
    }
    const instalment = (id, key) => h.call('POST', `/api/sales/${id}/payments`, { client_request_id: key, expected_exchange_rate: 4000, payment_details: [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }] }, `${key}: instalment $2 cash`)
    const reversalMethod = async (id) => (await h.one("SELECT payment_method FROM sale_payment_events WHERE sale_id=? AND note='exchange refund credit reversed' ORDER BY id DESC LIMIT 1", id))?.payment_method ?? null

    // R1. A credit row relabelled BEFORE this fix (old data, written here directly): the reversal still goes out by the method on the event.
    const old = await exchange('pay-r1')
    const oldPay = await instalment(old.saleId, 'pay-r1-pay')
    await h.db.prepare("UPDATE sales SET payment_details=json_set(payment_details,'$[0].method','ABA') WHERE id=?").bind(old.saleId).run()
    const r1Before = await expectedCash()
    const r1Cancel = await cancelExchange(old.returnId, 'pay-r1-cancel')
    const r1After = await expectedCash()
    const r1Method = await reversalMethod(old.saleId)
    const r1Mismatch = await mismatch()
    r.check(`R1 an old relabelled credit is still reversed by its recorded method: out Cash, expected cash unchanged (pay ${oldPay.status}, cancel ${r1Cancel.status}; method ${r1Method}; expected ${r1Before} -> ${r1After}; mismatch ${r1Mismatch})`, () => {
      assert.deepEqual([oldPay.status, r1Cancel.status], [200, 200])
      assert.equal(r1Method, 'Cash')
      assert.equal(r1After, r1Before)
      assert.equal(r1Mismatch, 0)
    })

    // R2. Version 1: credit $5 + instalment $2 cash, relabel Cash -> ABA, cancel the exchange.
    const v1 = await exchange('pay-r2')
    const v1Pay = await instalment(v1.saleId, 'pay-r2-pay')
    const r2Before = await expectedCash()
    const r2Relabel = await relabel(v1.saleId, 'pay-r2-relabel')
    const r2Rows = await tender(v1.saleId)
    const r2Cancel = await cancelExchange(v1.returnId, 'pay-r2-cancel')
    const r2After = await expectedCash()
    const r2Mismatch = await mismatch()
    r.check(`R2 v1: the relabel leaves the credit on Cash and moves only the customer's $2; relabel + cancel leave expected cash unchanged (pay ${v1Pay.status}, relabel ${r2Relabel.status}, rows ${JSON.stringify(r2Rows)}, cancel ${r2Cancel.status}; expected ${r2Before} -> ${r2After}; mismatch ${r2Mismatch})`, () => {
      assert.deepEqual([v1Pay.status, r2Relabel.status, r2Cancel.status], [200, 200, 200])
      assert.deepEqual(r2Rows.map((row) => [row.method, row.refund_credit === true]), [['Cash', true], ['ABA', false]])
      assert.equal(r2After, r2Before)
      assert.equal(r2Mismatch, 0)
    })

    // R3. Version 0: the credit is the only tender, read from the columns. A relabel must not move it to digital.
    const v0 = await exchange('pay-r3')
    const r3Before = await expectedCash()
    const r3Relabel = await relabel(v0.saleId, 'pay-r3-relabel')
    const r3Mid = await expectedCash()
    const r3Credit = await creditRow(v0.saleId)
    const r3Cancel = await cancelExchange(v0.returnId, 'pay-r3-cancel')
    const r3After = await expectedCash()
    const r3Version = (await h.one('SELECT payments_version FROM sales WHERE id=?', v0.saleId)).payments_version
    r.check(`R3 v0: the relabel leaves the credit on Cash; expected cash moves neither after the relabel nor after the cancel (relabel ${r3Relabel.status}, cancel ${r3Cancel.status}, v${r3Version}; expected ${r3Before} -> ${r3Mid} -> ${r3After})`, () => {
      assert.equal(r3Version, 0, 'fixture: the replacement sale is still version 0')
      assert.equal(r3Credit && r3Credit.method, 'Cash')
      assert.equal(r3Cancel.status, 200, JSON.stringify(r3Cancel.body).slice(0, 200))
      assert.deepEqual([r3Mid, r3After], [r3Before, r3Before])
    })

    // R4. The linked Settings rename Cash -> Cash USD renames the customer's rows, never the credit row.
    const r4 = await exchange('pay-r4')
    const r4Pay = await instalment(r4.saleId, 'pay-r4-pay')
    const preview = await h.call('GET', '/api/settings/payment-methods/impact?from=Cash&to=Cash%20USD', undefined, 'rename preview')
    const renamed = await h.call('POST', '/api/settings/payment-methods/replace', { from: 'Cash', to: 'Cash USD', scope: 'linked', expected_updated_at: preview.body.settings_updated_at }, 'linked rename Cash -> Cash USD')
    const r4Rows = await tender(r4.saleId)
    r.check(`R4 a linked Settings rename leaves the credit row's method alone and renames the customer's row (pay ${r4Pay.status}, preview ${preview.status}, rename ${renamed.status} ${renamed.body.code || ''}; rows ${JSON.stringify(r4Rows)})`, () => {
      assert.equal(r4Pay.status, 200)
      assert.equal(renamed.status, 200, JSON.stringify(renamed.body).slice(0, 200))
      assert.deepEqual(r4Rows.map((row) => [row.method, row.refund_credit === true]), [['Cash', true], ['Cash USD', false]])
    })
  } finally {
    await h.mf.dispose()
  }
}

async function staleReadRace(r) {
  const h = await H.startWorker({ patches: [...RACE_HOOKS, ...(mutation ? MUTATIONS[mutation] : [])] })
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const row = async (id) => ({
    sale: await h.one('SELECT sale_status,amount_paid_usd,amount_paid_khr FROM sales WHERE id=?', id),
    events: await h.all('SELECT direction,origin,amount_paid_usd,amount_paid_khr FROM sale_payment_events WHERE sale_id=? ORDER BY id', id),
  })
  const payBody = (key) => ({ client_request_id: key, expected_exchange_rate: 4000, payment_details: [{ method: 'ABA', amount_usd: 3, amount_khr: 0 }] })
  const settleBody = (key) => ({ sale_status: 'completed', client_request_id: key, expected_exchange_rate: 4000,
    payment_details: [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }, { method: 'Cash', amount_usd: 8, amount_khr: 0 }] })
  try {
    await H.seedProduct(h, 401, 'PAY Balm', 2, 200)
    const results = []
    for (const order of ['payment-held', 'settle-held']) {
      const created = await H.createSale(h, { key: `race-${order}`, status: 'awaiting_payment', lines: [{ productId: 401, quantity: 5 }],
        paymentDetails: [{ method: 'Cash', amount_usd: 2, amount_khr: 0 }], label: `race sale (${order})` })
      const id = Number(created.body.id)
      const heldPayment = order === 'payment-held'
      const held = heldPayment
        ? h.call('POST', `/api/sales/${id}/payments`, payBody(`hold-${order}`), 'held instalment')
        : h.call('PATCH', `/api/sales/${id}/status`, settleBody(`hold-${order}`), 'held settle')
      await sleep(400)
      const winner = heldPayment
        ? await h.call('PATCH', `/api/sales/${id}/status`, settleBody(`release-${order}`), 'settle that commits first')
        : await h.call('POST', `/api/sales/${id}/payments`, payBody(`release-${order}`), 'instalment that commits first')
      const loser = await held
      const state = await row(id)
      results.push({ order, winner: winner.status, loser: loser.status, code: loser.body.code, state })
    }
    r.check(`I2 the writer that read before the other committed is refused and leaves nothing (${JSON.stringify(results)})`, () => {
      for (const result of results) {
        assert.equal(result.winner, 200)
        assert.equal(result.loser, 409)
        const paid = result.order === 'payment-held' ? 10 : 5
        assert.equal(result.state.sale.amount_paid_usd, paid, 'the loser did not overwrite the winner')
        assert.equal(result.state.sale.sale_status, result.order === 'payment-held' ? 'completed' : 'awaiting_payment')
        const sum = result.state.events.reduce((total, event) => total + (event.direction === 'out' ? -1 : 1) * event.amount_paid_usd, 0)
        assert.equal(sum, paid)
      }
    })
  } finally {
    await h.mf.dispose()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
