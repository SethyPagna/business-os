'use strict'
// AL-E (Requirement gap E, brief 2026-10-12 section 5): an exchange on a Not
// Paid sale, against the WHOLE Worker on workerd + D1.
//
// $10 Not Paid sale (5 x $2), 2 units ($4) come back and a $4 replacement goes
// out, and the customer hands over NO money. Owner rules: a Not Paid return
// lowers the debt and pays nothing out of the drawer; nothing was collected.
// So afterwards collected stays $0, the drawer is unchanged, and the customer
// still owes $10 in total -- however the debt is split between the original
// sale and the replacement. Paying that $10 later in dollars, in riel, or in a
// mix must clear it exactly and put exactly that tender in the drawer.
//
// Replacement items exist only on the legacy (money v0) return path on
// bf7408b49: a v1 body with replacement_items is refused outright (checked
// below). Every POS sale since the v1 rollout is v1, so the affected
// population is the pre-v1 Not Paid credit still open in production. The
// legacy Not Paid sale here is written by the REAL sales-import writer, the
// only producer of v0 sales today; the return/replacement money path does not
// depend on where the v0 sale came from (isMoneyV1 is false either way).
//
// Harness: test-al-money-c-native.cjs. Asserts the owner-correct outcome; a
// red check is the reproduction. AL_MUTATION=1 runs the negative control: the
// same return WITHOUT a replacement, where collected/drawer must already hold
// on bf7408b49 -- so a red here is caused by the replacement, not the return.
const assert = require('node:assert/strict')
const H = require('./test-al-money-c-native.cjs')

const RATE = 4000
const VARIANTS = [
  { name: 'USD', tender: owed => [{ method: 'Cash', amount_usd: owed, amount_khr: 0 }], drawer: { usd: 10, khr: 0 } },
  { name: 'KHR', tender: owed => [{ method: 'Cash', amount_usd: 0, amount_khr: Math.round(owed * RATE) }], drawer: { usd: 0, khr: 40000 } },
  { name: 'mixed', tender: owed => [{ method: 'Cash', amount_usd: owed / 2, amount_khr: Math.round(owed / 2 * RATE) }], drawer: { usd: 5, khr: 20000 } },
]

async function main() {
  const h = await H.startWorker()
  const mutation = process.env.AL_MUTATION === '1'
  const r = H.recorder(mutation ? 'AL-E [control: return without replacement]' : 'AL-E')
  try {
    await H.seedProduct(h, 301, 'AL-E Cushion', 2, 100)
    await H.seedProduct(h, 302, 'AL-E Replacement Palette', 4, 100)
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('shift_admin_exempt','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const opened = await h.call('POST', '/api/shifts/open', { branch_id: 1, opening_float_usd: 100, opening_float_khr: 100000 }, 'E open shift')
    assert.equal(opened.status, 201, JSON.stringify(opened.body).slice(0, 200))
    // Open-shift windows end at the current second, exclusive: wait past it.
    const drawer = async () => {
      await new Promise(resolve => setTimeout(resolve, 1100))
      return (await h.call('GET', '/api/shifts/current?branch_id=1', undefined, 'E shift drawer', { observe: true })).body.shift.reconciliation
    }
    const list = async () => (await h.call('GET', H.fresh('/api/sales?limit=100'), undefined, 'E sales list', { observe: true })).body
    const owed = row => Number((Number(row.net_total_usd) - Number(row.amount_paid_usd) - Number(row.amount_paid_khr || 0) / RATE).toFixed(4))
    const overview = async () => (await h.call('GET', H.fresh('/api/reports/overview'), undefined, 'E reports overview', { observe: true })).body.sales.totals

    // v1: replacement items are refused explicitly, nothing written.
    const v1 = await H.createSale(h, { key: 'al-e-v1', status: 'awaiting_payment', lines: [{ productId: 301, quantity: 5 }], label: 'E v1 Not Paid sale' })
    const v1Quote = await h.call('POST', '/api/returns/quote', { sale_id: v1.body.id, items: [{ sale_item_id: v1.body.sale.items[0].id, quantity: 2 }] }, 'E v1 quote')
    const { customer_return_create_version: _c, customer_return_edit_version: _e, ...v1Expected } = v1Quote.body
    const v1Exchange = await h.call('POST', '/api/returns', { client_request_id: 'al-e-v1-exchange', money_precision_version: 1, sale_id: v1.body.id,
      reason: 'AL-E exchange', expected_quote: v1Expected,
      items: [{ sale_item_id: v1.body.sale.items[0].id, product_id: 301, quantity: 2, stock_action: 'restock', branch_id: 1 }],
      replacement_items: [{ product_id: 302, quantity: 1, branch_id: 1, batch_id: 5302 }] }, 'E v1 exchange')
    const v1Returns = await h.one('SELECT COUNT(*) n FROM returns WHERE sale_id=?', v1.body.id)
    r.check(`v1 Not Paid sale: an exchange is refused explicitly and writes nothing (got ${v1Exchange.status} "${v1Exchange.body.error}")`, () => {
      assert.equal(v1Exchange.status, 400)
      assert.equal(v1Returns.n, 0)
    })
    await h.call('PATCH', `/api/sales/${v1.body.id}/status`, { sale_status: 'cancelled', cancel_reason: 'mistake', client_request_id: 'al-e-v1-cancel' }, 'E cancel v1 probe sale')

    for (const [index, variant] of VARIANTS.entries()) {
      const tag = `[${variant.name}]`
      const legacy = await H.importSale(h, 40 + index, 'awaiting_payment', [{ productId: 301, name: 'AL-E Cushion', quantity: 5, price: 2 }],
        { paidUsd: 0, jobId: 'al-e-job', createdAt: new Date().toISOString() })
      const drawerBefore = await drawer()
      const overviewBefore = await overview()
      const exchange = await h.call('POST', '/api/returns', { client_request_id: `al-e-exchange-${variant.name}`, sale_id: legacy.sale.id,
        reason: 'AL-E exchange', return_type: 'restock',
        items: [{ sale_item_id: legacy.items[0].id, product_id: 301, quantity: 2, applied_price_usd: 2, stock_action: 'restock', branch_id: 1 }],
        ...(mutation ? {} : { replacement_items: [{ product_id: 302, quantity: 1, branch_id: 1, batch_id: 5302, applied_price_usd: 4 }] }) },
      `E ${variant.name} return 2 ($4)${mutation ? '' : ' + $4 replacement'}`)
      assert.equal(exchange.status, 200, JSON.stringify(exchange.body).slice(0, 300))
      const replacementId = exchange.body.replacementSaleId
      const rows = await list()
      const original = rows.find(row => Number(row.id) === legacy.sale.id)
      const replacement = replacementId ? rows.find(row => Number(row.id) === Number(replacementId)) : null
      const cohortOwed = owed(original) + (replacement ? owed(replacement) : 0)
      const cohortPaid = Number(original.amount_paid_usd) + Number(original.amount_paid_khr || 0) / RATE
        + (replacement ? Number(replacement.amount_paid_usd) + Number(replacement.amount_paid_khr || 0) / RATE : 0)
      const overviewAfter = await overview()
      const drawerAfter = await drawer()
      r.check(`${tag} no tender is recorded for money nobody handed over (recorded paid $${cohortPaid}; replacement ${replacement ? `${replacement.sale_status}, ${replacement.payment_method} $${replacement.amount_paid_usd}` : 'none'})`, () => {
        assert.equal(cohortPaid, 0)
      })
      const collectedDelta = Number((overviewAfter.collected_total_usd - overviewBefore.collected_total_usd).toFixed(4))
      r.check(`${tag} collected stays $0 (reports collected moved by $${collectedDelta})`, () => {
        assert.equal(collectedDelta, 0)
      })
      // Component-wise on purpose: a fabricated $4 cash sale and a $4 refund
      // paid out of the drawer cancel in the expected total, which would read
      // as "unchanged" while both legs are wrong.
      const cashIn = { usd: Number((drawerAfter.cash_sales.usd - drawerBefore.cash_sales.usd).toFixed(2)), khr: drawerAfter.cash_sales.khr - drawerBefore.cash_sales.khr }
      const cashOut = Number((drawerAfter.refunds.usd - drawerBefore.refunds.usd).toFixed(2))
      r.check(`${tag} no cash comes into the drawer (cash sales moved by $${cashIn.usd} / ${cashIn.khr}៛)`, () => {
        assert.deepEqual(cashIn, { usd: 0, khr: 0 })
      })
      if (!mutation) {
        r.check(`${tag} no cash leaves the drawer for the Not Paid return (refunds moved by $${cashOut}; same defect as AL-D)`, () => {
          assert.equal(cashOut, 0)
        })
      }
      r.check(`${tag} total debt is conserved: $${mutation ? 6 : 10} (original owes $${owed(original)}${replacement ? `, replacement owes $${owed(replacement)}` : ''})`, () => {
        assert.equal(Number(cohortOwed.toFixed(4)), mutation ? 6 : 10)
      })

      // Settlement of the remaining debt. In the control run it is skipped:
      // a Not Paid sale with a return cannot be settled at all on bf7408b49,
      // which is AL-D's defect, not this one.
      if (mutation) { console.log(`SKIP AL-E ${tag} settlement (owned by AL-D)`); continue }
      const settlements = []
      for (const row of [original, replacement].filter(Boolean)) {
        const due = owed(row)
        if (!(due > 0)) continue
        settlements.push(await h.call('PATCH', `/api/sales/${row.id}/status`, { sale_status: 'completed', client_request_id: `al-e-settle-${variant.name}-${row.id}`,
          expected_exchange_rate: RATE, payment_details: variant.tender(due) }, `E ${variant.name} settle sale ${row.id} ($${due})`))
      }
      const settledRows = await list()
      const settledOwed = [original, replacement].filter(Boolean)
        .reduce((sum, row) => sum + owed(settledRows.find(candidate => Number(candidate.id) === Number(row.id))), 0)
      const drawerSettled = await drawer()
      const expectedDrawer = variant.drawer
      r.check(`${tag} paying the debt in ${variant.name} clears it (settlements ${settlements.map(s => s.status).join(',') || 'none'}${settlements.some(s => s.status !== 200) ? ` "${String(settlements.find(s => s.status !== 200).body.error).slice(0, 80)}"` : ''}; still owed $${Number(settledOwed.toFixed(4))})`, () => {
        assert.ok(settlements.length > 0 && settlements.every(s => s.status === 200))
        assert.equal(Number(settledOwed.toFixed(4)), 0)
      })
      r.check(`${tag} the drawer gains exactly the tender ($${expectedDrawer.usd} + ${expectedDrawer.khr}៛; got $${Number((drawerSettled.expected.usd - drawerAfter.expected.usd).toFixed(2))} + ${drawerSettled.expected.khr - drawerAfter.expected.khr}៛)`, () => {
        assert.equal(Number((drawerSettled.expected.usd - drawerAfter.expected.usd).toFixed(2)), expectedDrawer.usd)
        assert.equal(drawerSettled.expected.khr - drawerAfter.expected.khr, expectedDrawer.khr)
      })
    }

    const worst = H.budgetLine(h.metrics)
    r.check(`D1 budget: worst request ${worst.label} used ${worst.statements} statements (Free ${H.FREE_QUERY_LIMIT})`, () => {
      assert.ok(worst.statements <= H.FREE_QUERY_LIMIT, `exceeds the Free per-invocation limit of ${H.FREE_QUERY_LIMIT}`)
    })
  } finally {
    await h.mf.dispose()
  }
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} AL-E unpaid exchange tender: ${r.results.length - failed.length}/${r.results.length} owner-rule checks hold${mutation ? ' (AL_MUTATION=1 control run, no replacement)' : ''}`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
