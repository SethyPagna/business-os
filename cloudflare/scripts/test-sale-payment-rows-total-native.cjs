'use strict'
// POST /api/sales stores the paid aggregate (amount_paid_usd / amount_paid_khr) AND the payment rows (payment_details). A request whose rows
// do not add up to its aggregate used to be stored as sent: rows of 1,000 riel beside an aggregate of 150 -- two different sales, one read
// by the shift drawer and the receipt, the other by the status and the balance. Review of MONEY-1 (REVIEW-MONEY-1.md, E2), 4 Nov 2026.
//
// The Worker now refuses the mismatch (400 sale_payment_rows_mismatch, nothing written). It does NOT refuse an odd aggregate as such:
// a bank row may hold any riel (owner, 27 Oct 2026), so ABA 150 riel with an aggregate of 150 is a valid sale.
// The whole Worker (src/index.ts bundled, every migration, Miniflare) is driven; every refusal is checked against "nothing written".
// DISCRIMINATING: RIEL_ROWS_MUTATION=check_removed bundles the Worker without the check and must turn every refusal red;
// RIEL_ROWS_BASE=<commit> bundles every changed src file from that commit (8110a7682 stored the mismatch as sent).
//
// Run (from cloudflare/scripts): node test-sale-payment-rows-total-native.cjs
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const MUTATIONS = {
  check_removed: [{ name: 'check_removed', file: 'src/routes/sales.ts',
    from: "  if (paymentDetails.length) {\n    const rowsUsd", to: "  if (false as boolean) {\n    const rowsUsd" }],
}
const base = process.env.RIEL_ROWS_BASE || ''
const mutation = process.env.RIEL_ROWS_MUTATION || (base ? `base:${base}` : '')
if (mutation && !base && !MUTATIONS[mutation]) throw new Error(`unknown RIEL_ROWS_MUTATION ${mutation}`)
const REFUSED = 'sale_payment_rows_mismatch'

async function main() {
  const patches = base ? H.basePatches(base).filter((patch) => !/salePayments\.ts$/.test(patch.file)) : mutation ? MUTATIONS[mutation] : []
  const h = await H.startWorker({ patches })
  const r = H.recorder(mutation ? `ROWS [mutation ${mutation}]` : 'ROWS')
  let seq = 0
  const key = (prefix) => `${prefix}-${++seq}-rows`
  const count = async () => Number((await h.one('SELECT COUNT(*) AS n FROM sales')).n)
  const refused = (res) => { assert.equal(res.status, 400, `${res.status} ${JSON.stringify(res.body).slice(0, 240)}`); assert.equal(res.body.code, REFUSED) }
  try {
    for (let id = 801; id <= 820; id++) await H.seedProduct(h, id, `ROWS item ${id}`, 4.75, 50)
    let product = 800
    const sale = (details, extra = {}) => H.createSale(h, { key: key('sale'), lines: [{ productId: ++product, quantity: 1 }], paymentDetails: details, extra, label: `sale ${JSON.stringify(details)} ${JSON.stringify(extra)}` })

    // Rows of 1,000 riel beside an aggregate of 150 riel (the review's probe Q3: $4.50 + 1,000 riel rows, $4.71 + 150 riel aggregate).
    const before = await count()
    const q3 = await sale([{ method: 'Cash', amount_usd: 4.5, amount_khr: 1000 }], { amount_paid_usd: 4.71, amount_paid_khr: 150 })
    const afterQ3 = await count()
    r.check('R1 rows $4.50 + 1,000 riel beside an aggregate of $4.71 + 150 riel is refused and nothing is written', () => { refused(q3); assert.equal(afterQ3, before) })

    const khrOnly = await sale([{ method: 'ABA', amount_usd: 4.75, amount_khr: 1000 }], { amount_paid_usd: 4.75, amount_paid_khr: 150 })
    r.check('R2 a riel total that differs from its rows is refused even by a bank method', () => refused(khrOnly))

    const usdOnly = await sale([{ method: 'Cash', amount_usd: 4, amount_khr: 3000 }], { amount_paid_usd: 5, amount_paid_khr: 3000 })
    r.check('R3 a dollar total that differs from its rows is refused', () => refused(usdOnly))

    // Asked as Not Paid so the status guard (a short tender cannot be Completed) does not answer first: this is the rows-versus-aggregate answer.
    const rowsMissing = await H.createSale(h, { key: key('sale'), status: 'awaiting_payment', lines: [{ productId: ++product, quantity: 1 }],
      paymentDetails: [{ method: 'Cash', amount_usd: 4.75, amount_khr: 0 }], extra: { amount_paid_usd: 0, amount_paid_khr: 0 }, label: 'rows hold money, aggregate nothing' })
    r.check('R4 rows that hold money beside an aggregate of nothing are refused', () => refused(rowsMissing))

    const consistent = await sale([{ method: 'Cash', amount_usd: 4.5, amount_khr: 1000 }])
    const consistentRow = consistent.body.id ? await h.one('SELECT sale_status, amount_paid_usd, amount_paid_khr, payment_details FROM sales WHERE id=?', consistent.body.id) : {}
    r.check('R5 rows that add up to their aggregate are accepted: $4.50 + 1,000 riel is Completed with both stored', () => {
      assert.equal(consistent.status, 200, JSON.stringify(consistent.body).slice(0, 240))
      assert.deepEqual([consistentRow.sale_status, consistentRow.amount_paid_usd, consistentRow.amount_paid_khr], ['completed', 4.5, 1000])
    })

    const oddBank = await sale([{ method: 'ABA', amount_usd: 4.71, amount_khr: 150 }])
    const oddBankRow = oddBank.body.id ? await h.one('SELECT sale_status, amount_paid_khr FROM sales WHERE id=?', oddBank.body.id) : {}
    r.check('R6 an odd riel aggregate is not refused as such: ABA $4.71 + 150 riel adds up to its aggregate and is accepted', () => {
      assert.equal(oddBank.status, 200, JSON.stringify(oddBank.body).slice(0, 240))
      assert.deepEqual([oddBankRow.sale_status, oddBankRow.amount_paid_khr], ['completed', 150])
    })

    const split = await sale([{ method: 'Cash', amount_usd: 2, amount_khr: 0 }, { method: 'ABA', amount_usd: 2.75, amount_khr: 0 }])
    r.check('R7 two rows are summed: Cash $2 + ABA $2.75 beside $4.75 is accepted', () => assert.equal(split.status, 200, JSON.stringify(split.body).slice(0, 240)))
    const splitBad = await sale([{ method: 'Cash', amount_usd: 2, amount_khr: 0 }, { method: 'ABA', amount_usd: 2.75, amount_khr: 0 }], { amount_paid_usd: 4.8 })
    r.check('R8 two rows are summed: the same rows beside an aggregate of $4.80 are refused', () => refused(splitBad))

    // The single-row form carries no rows, so there is nothing to disagree with.
    const single = await sale(null, { payment_method: 'Cash', payment_currency: 'MIXED', amount_paid_usd: 4.5, amount_paid_khr: 1000 })
    r.check('R9 the single-row form (no payment_details) is built from the aggregate and is accepted', () => assert.equal(single.status, 200, JSON.stringify(single.body).slice(0, 240)))

    // A replay of an accepted sale is answered with that sale (the check sits after the replay answer), not with the refusal.
    const replayKey = key('replay')
    const first = await H.createSale(h, { key: replayKey, lines: [{ productId: ++product, quantity: 1 }], paymentDetails: [{ method: 'Cash', amount_usd: 4.75, amount_khr: 0 }], label: 'replay first' })
    const second = await H.createSale(h, { key: replayKey, lines: [{ productId: product, quantity: 1 }], paymentDetails: [{ method: 'Cash', amount_usd: 4.75, amount_khr: 0 }], label: 'replay second' })
    r.check('R10 an exact replay of an accepted sale still answers with that sale', () => {
      assert.equal(first.status, 200, JSON.stringify(first.body).slice(0, 200))
      assert.equal(second.status, 200, JSON.stringify(second.body).slice(0, 200))
      assert.equal(second.body.id, first.body.id)
    })
  } finally {
    await h.mf.dispose()
  }

  const failures = r.results.filter((result) => !result.ok)
  if (mutation) {
    const mustFail = r.results.filter((result) => /refused/.test(result.name) && !/accepted|not refused|is not/.test(result.name))
    const survived = mustFail.filter((result) => result.ok)
    console.log(`MUTANT ${mutation}: ${mustFail.length - survived.length}/${mustFail.length} refusal checks red`)
    if (survived.length) { console.log(`MUTANT SURVIVED on: ${survived.map((s) => s.name).join(' | ')}`); process.exit(1) }
    process.exit(0)
  }
  if (failures.length) { console.log(`RED sale payment rows total: ${failures.length} of ${r.results.length} checks failed`); process.exit(1) }
  console.log(`GREEN sale payment rows total: ${r.results.length}/${r.results.length} checks hold`)
}

main().catch((error) => { console.error(error); process.exit(1) })
