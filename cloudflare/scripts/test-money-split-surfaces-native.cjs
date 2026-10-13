'use strict'
// The Dashboard's payment-method and branch cards and the Sales export preview's
// by_status / by_product splits, mounted: the whole Worker on workerd + D1, sales and
// customer returns written through the real routes, then read through
//   GET /api/analytics            (Dashboard)
//   GET /api/reports/grouped      (Reports buckets, by payment method and by branch)
//   GET /api/reports/overview     (Reports headline)
//   GET /api/sales/export         (Sales export preview)
//
// One revenue definition, sliced (Sonnet area review of release 2, finding 4):
//   * every split row carries 4 decimals and equals the Reports bucket of its key,
//   * the rows of every split add up to the Reports buckets EXACTLY (4 places) and to the
//     headline within half a cent, and the headline itself stays in cents,
//   * the export's headline is the Dashboard's headline.
// The fixture is built so the OLD cards cannot pass: ten sales are priced $9.9955 and
// paid $10.00 (a +$0.0045 rounding adjustment each, which the old SQL left out), and
// two $29.9955 sales are refunded in part and in full.
//
// Budget: the Dashboard and export reads must not cost more D1 statements than they did
// (BASE_STATEMENTS, measured on dde1ba879 with this fixture).
//
// Run (from cloudflare/):  node scripts/test-money-split-surfaces-native.cjs
//   --base=<commit>   the red-on-the-base run: every src file that differs from that commit is bundled as
//                     that commit had it (nothing on disk changes), e.g. --base=dde1ba879
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const BASE = (process.argv.slice(2).find(arg => arg.startsWith('--base=')) || '').slice('--base='.length)
// Statements per request on dde1ba879 for this fixture (see the lane report).
const BASE_STATEMENTS = { analytics: 39, export: 22 }

const day = (date, hourUtc = 3) => `${date}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`
const DAY = '2026-10-05'
const RANGE = `startDate=${DAY}&endDate=${DAY}`
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const r4 = value => Number(Number(value).toFixed(4))
const sum = (rows, key) => r4(rows.reduce((total, row) => total + Number(row[key] || 0), 0))
const places = value => (String(value).split('.')[1] || '').length

async function main() {
  const started = Date.now()
  const h = await H.startWorker({ patches: BASE ? H.basePatches(BASE) : [] })
  const r = H.recorder('MSS')
  try {
    await H.seedProduct(h, 7100, 'MSS Serum', 10, 1000, 1)
    await H.seedProduct(h, 7101, 'MSS Cream', 10, 1000, 1)

    // ---- ten $9.9955 sales paid $10.00: a +$0.0045 rounding adjustment each ----
    const priced = (key, method) => H.createSale(h, { key, createdAt: day(DAY), label: `sale ${key}`,
      lines: [{ productId: 7100, quantity: 1, manualPrice: 10, fixedDiscount: 0.0045,
        quote: { gross_usd: 10, product_discount_usd: 0, manual_discount_usd: 0.0045, total_usd: 9.9955, total_khr: 39982 } }],
      paymentDetails: [{ method, amount_usd: 10, amount_khr: 0 }] })
    for (let i = 1; i <= 6; i++) assert.equal((await priced(`mss-cash-${i}`, 'Cash')).status, 200)
    for (let i = 1; i <= 4; i++) assert.equal((await priced(`mss-aba-${i}`, 'ABA')).status, 200)

    // ---- two 3 x $10 sales with a $0.0045 discount (total $29.9955, paid $30): one refunded in part, one in full ----
    const refunded = []
    for (const key of ['mss-part', 'mss-full']) {
      const sale = await H.createSale(h, { key, createdAt: day(DAY), label: `sale ${key}`,
        lines: [{ productId: 7101, quantity: 3, manualPrice: 10, fixedDiscount: 0.0045, quote: { gross_usd: 30, product_discount_usd: 0, manual_discount_usd: 0.0045, total_usd: 29.9955, total_khr: 119982 } }],
        paymentDetails: [{ method: 'Cash', amount_usd: 30, amount_khr: 0 }] })
      assert.equal(sale.status, 200, JSON.stringify(sale.body).slice(0, 300))
      refunded.push({ key, id: sale.body.id, itemId: (await h.one('SELECT id FROM sale_items WHERE sale_id=?', sale.body.id)).id })
    }
    for (const [sale, quantity] of [[refunded[0], 1], [refunded[1], 3]]) {
      await sleep(1100) // two returns in the same second would mint the same return number
      const made = await H.customerReturn(h, { key: `mss-ret-${sale.key}`, saleId: sale.id, lines: [{ saleItemId: sale.itemId, productId: 7101, quantity }] })
      assert.equal(made.created?.status, 200, JSON.stringify(made.created?.body || made.quote?.body).slice(0, 300))
    }

    // ---- a delivery sale with a customer-paid fee ----
    const delivery = await H.createSale(h, { key: 'mss-delivery', createdAt: day(DAY), label: 'sale mss-delivery',
      lines: [{ productId: 7100, quantity: 1, quote: { gross_usd: 10, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 10, total_khr: 40000 } }],
      paymentDetails: [{ method: 'ABA', amount_usd: 11.5, amount_khr: 0 }],
      extra: { is_delivery: true, delivery_fee_usd: 1.5, delivery_fee_paid_by: 'customer', delivery_actual_cost_usd: 1 } })
    assert.equal(delivery.status, 200, JSON.stringify(delivery.body).slice(0, 300))
    console.log(`TIME fixture ready at ${((Date.now() - started) / 1000).toFixed(1)} s (13 sales, 2 returns)`)

    const get = async (url, label) => {
      const res = await h.call('GET', H.fresh(url), undefined, label)
      assert.equal(res.status, 200, `${label} ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`)
      const metric = h.metrics[h.metrics.length - 1]
      return { body: res.body, statements: metric.statements }
    }
    const overview = (await get(`/api/reports/overview?${RANGE}`, 'reports overview')).body.sales.totals
    const analytics = await get(`/api/analytics?${RANGE}&granularity=day`, 'dashboard analytics')
    const grouped = async by => (await get(`/api/reports/grouped?by=${by}&${RANGE}`, `reports grouped ${by}`)).body
    const reportsPay = (await grouped('payment_method')).rows.filter(row => row.tx_count > 0)
    const reportsBranch = (await grouped('branch')).rows.filter(row => row.tx_count > 0)
    const exported = await get(`/api/sales/export?${RANGE}`, 'sales export')
    const { byPayment, byBranch, totals } = analytics.body
    const { by_status: byStatus, by_product: byProduct, summary } = exported.body
    const headline = overview.revenue_usd

    console.log(`INFO headline ${headline} (Reports) | ${totals.revenue_usd} (Dashboard) | ${summary.net_revenue_usd} (export)`)
    console.log(`INFO payment cards ${JSON.stringify(byPayment)}`)
    console.log(`INFO Reports payment buckets ${JSON.stringify(reportsPay.map(row => [row.label, row.tx_count, row.revenue_usd]))}`)
    console.log(`INFO branch cards ${JSON.stringify(byBranch)} | by_status ${JSON.stringify(byStatus)}`)
    console.log(`INFO by_product ${JSON.stringify(byProduct)}`)

    r.check('control: the fixture exercises 4 decimals and a rounding adjustment', () => {
      assert.ok(reportsPay.some(row => places(row.revenue_usd) >= 3), `no Reports payment bucket carries more than cents: ${JSON.stringify(reportsPay.map(row => row.revenue_usd))}`)
      assert.equal(reportsPay.reduce((acc, row) => acc + row.tx_count, 0), 13)
    })
    r.check('the headline stays in cents and is one number on the Dashboard, in Reports and in the export', () => {
      assert.equal(places(headline) <= 2, true, `headline ${headline}`)
      assert.equal(totals.revenue_usd, headline)
      assert.equal(summary.net_revenue_usd, headline)
    })
    r.check('the payment cards are the Reports payment buckets, row for row, 4 places', () => {
      assert.deepEqual(byPayment.map(row => [row.method, row.count, row.revenue_usd]).sort(),
        reportsPay.map(row => [row.label || 'Unknown', row.tx_count, row.revenue_usd]).sort())
    })
    r.check('the branch cards are the Reports branch buckets, row for row, 4 places', () => {
      assert.deepEqual(byBranch.map(row => [row.branch_id, row.count, row.tx_count, row.revenue_usd]).sort(),
        reportsBranch.map(row => [row.entity_id, row.tx_count, row.tx_count, row.revenue_usd]).sort())
    })
    r.check('the cards add up to the Reports buckets exactly and to the headline within half a cent', () => {
      const reports = sum(reportsPay, 'revenue_usd')
      assert.equal(sum(byPayment, 'revenue_usd'), reports)
      assert.equal(sum(byBranch, 'revenue_usd'), reports)
      assert.ok(Math.abs(reports - headline) <= 0.005 + 1e-9, `Reports buckets ${reports} vs headline ${headline}`)
      assert.equal(byPayment.reduce((acc, row) => acc + row.count, 0), totals.tx_count)
    })
    r.check('the export by_status rows add up to the Reports buckets exactly; a voided sale would keep a count and no revenue', () => {
      assert.equal(sum(byStatus, 'revenue'), sum(reportsPay, 'revenue_usd'))
      assert.equal(byStatus.reduce((acc, row) => acc + row.count, 0), 13)
    })
    r.check('the export by_product rows add up to the Reports buckets exactly, and the part refund moved only its own product', () => {
      assert.equal(sum(byProduct, 'revenue_usd'), sum(reportsPay, 'revenue_usd'))
      const serum = byProduct.find(row => row.product_name === 'MSS Serum')
      const cream = byProduct.find(row => row.product_name === 'MSS Cream')
      assert.equal(serum.qty_sold, 11)
      assert.equal(cream.qty_sold, 6)
      assert.ok(places(cream.revenue_usd) >= 3, `the refunded product's revenue keeps its 4 places: ${cream.revenue_usd}`)
    })
    r.check('the export preview and the Dashboard read no more D1 statements than they did', () => {
      console.log(`D1 /api/analytics ${analytics.statements} statements (base ${BASE_STATEMENTS.analytics}); /api/sales/export ${exported.statements} (base ${BASE_STATEMENTS.export})`)
      assert.ok(analytics.statements <= BASE_STATEMENTS.analytics, `${analytics.statements} > ${BASE_STATEMENTS.analytics}`)
      assert.ok(exported.statements <= BASE_STATEMENTS.export, `${exported.statements} > ${BASE_STATEMENTS.export}`)
    })
  } finally {
    await h.mf.dispose?.()
  }
  const failed = r.results.filter(entry => !entry.ok)
  console.log(`\n${failed.length ? 'RED' : 'GREEN'} money split surfaces: ${r.results.length - failed.length}/${r.results.length} checks hold${BASE ? ` (src as of ${BASE})` : ''}`)
  process.exitCode = failed.length ? 1 : 0
}

main().then(() => process.exit(process.exitCode || 0)).catch(error => { console.error(error); process.exit(1) })
