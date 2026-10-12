'use strict'
// AL-L (Requirement gap L, brief 2026-10-12 section 5): financial report and
// export completeness, against the WHOLE Worker on workerd + D1.
//
// Four counterexamples, each on its own business day so the report windows
// cannot see each other's sales:
//   L1 2026-10-01  100 sales of a $9.9955 line, charged and paid $10.00 and
//                  fully refunded $10.00. Nothing was earned: revenue and
//                  profit must be $0 -- not the $0.45 of sale-rounding left
//                  behind when the reversal subtracts only the $9.9955.
//   L1 control 2026-10-06  one $9.9955 sale kept plus two refunded: revenue
//                  must be the kept sale's $10.00 to the cent. bf7408b49 gives
//                  $10.01 (two $0.0045 residues), and so would a fix that
//                  merely clamps revenue at zero -- this is what separates a
//                  true cumulative reversal from a clamp.
//   L2 2026-10-02  501 customers each spend $1. The grouped "by customer"
//                  report the till requests (limit=500) must either return
//                  all 501 groups or say explicitly that it is incomplete;
//                  silently returning 500 makes the summed total/export $500.
//                  The first sale is a real POST /api/sales; the other 500
//                  are SQL clones of it (every column and its line copied,
//                  only id, receipt, request id and customer changed). The
//                  subject is the grouped READER; 501 real POS writes take
//                  about four minutes in workerd, past the native runner's
//                  240 s timeout.
//   L3 2026-10-03/04  two $1 sales whose COGS is $0.0050 each. The overall
//                  COGS is $0.01. Buckets (day rows, the week rollup, per
//                  customer rows) must reconcile to it exactly, or carry an
//                  explicit rounding explanation.
//   L4 2026-10-05  one delivery sale (fee $2 paid by the customer, courier
//                  actually paid $1.50). A cost-view employee is denied
//                  delivery_actual_cost_usd; it must not be recoverable by
//                  arithmetic from the figures the employee DOES receive.
//
// ROUNDING POLICY IS UNRESOLVED (round-up vs nearest-four-decimals; owner
// conflict recorded in REQUIREMENT-GAPS.md section 4). These checks are
// written so they hold under every plausible rule: a full refund reverses the
// whole sale whatever the sale was rounded to, and a bucketed report either
// adds up or says why it does not. The per-rule analysis is printed (INFO) and
// recorded in AL-MONEY-REPRO.md.
//
// Harness: test-al-money-c-native.cjs. Report reads are the subject here, so
// they count toward the D1 budget check.
const assert = require('node:assert/strict')
const H = require('./test-al-money-c-native.cjs')

const day = (date, hourUtc = 3) => `${date}T${String(hourUtc).padStart(2, '0')}:00:00.000Z` // 10:00 Cambodia
const range = date => `startDate=${date}&endDate=${date}`

const totalsOf = async (h, query, label, cookie) => {
  const result = await h.call('GET', H.fresh(`/api/reports/overview?${query}`), undefined, label, cookie ? { cookie } : {})
  assert.equal(result.status, 200, JSON.stringify(result.body).slice(0, 200))
  return result.body.sales.totals
}

async function main() {
  const started = Date.now()
  const phase = label => console.log(`TIME AL-L ${label} at ${((Date.now() - started) / 1000).toFixed(1)} s`)
  const h = await H.startWorker()
  phase('worker ready')
  const r = H.recorder('AL-L')
  try {
    await H.seedProduct(h, 7100, 'AL-L1 Serum', 10, 1000)
    await H.seedProduct(h, 702, 'AL-L2 Sample', 1, 1000, 0.25)
    await H.seedProduct(h, 703, 'AL-L3 Tester', 1, 1000, 0.005)
    await H.seedProduct(h, 704, 'AL-L4 Delivered Cream', 10, 1000, 1)

    // ---- L1: 100 x $9.9955 sold at $10.00 and fully refunded ---------------
    let adjustments = 0
    let refundAdjustments = 0
    // Sequential on purpose: two returns recorded in the same second mint the
    // same RET-YYYYMMDD-HHMMSS candidate and the second is refused with
    // write_conflict (a separate, retryable race noted in the report).
    for (let i = 1; i <= 100; i++) {
      const sale = await H.createSale(h, { key: `al-l1-${i}`, status: 'completed', createdAt: day('2026-10-01'),
        lines: [{ productId: 7100, quantity: 1, manualPrice: 10, fixedDiscount: 0.0045,
          quote: { gross_usd: 10, product_discount_usd: 0, manual_discount_usd: 0.0045, total_usd: 9.9955, total_khr: 39982 } }],
        paymentDetails: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], label: 'L1 sale $9.9955 paid $10' })
      assert.equal(sale.status, 200, JSON.stringify(sale.body).slice(0, 300))
      adjustments += Number(sale.body.sale.rounding_adjustment_usd ?? 0)
      const back = await H.customerReturn(h, { key: `al-l1-r-${i}`, saleId: sale.body.id,
        lines: [{ saleItemId: sale.body.sale.items[0].id, productId: 7100, quantity: 1 }], label: 'L1 full refund' })
      assert.equal(back.created && back.created.status, 200, JSON.stringify(back.created && back.created.body))
      refundAdjustments += Number(back.quote.body.rounding_adjustment_usd)
      if (i === 1) {
        console.log(`INFO AL-L1 one sale: line $${sale.body.sale.items[0].total_usd}, calculated total $${sale.body.sale.calculated_total_usd}, charged $${sale.body.sale.total_usd} (adjustment $${sale.body.sale.rounding_adjustment_usd}); refund calculated $${back.quote.body.calculated_refund_usd}, paid back $${back.quote.body.total_refund_usd} (adjustment $${back.quote.body.rounding_adjustment_usd})`)
      }
    }
    phase('L1 100 sales + 100 refunds written')
    const l1 = await totalsOf(h, range('2026-10-01'), 'L1 overview 2026-10-01')
    const l1Stats = (await h.call('GET', H.fresh(`/api/sales/stats?${range('2026-10-01')}`), undefined, 'L1 sales stats')).body
    console.log(`INFO AL-L1 totals: net sales $${l1.net_sales_usd}, refund (recognition) $${l1.refund_usd}, refund charged $${l1.refund_charged_usd}, revenue $${l1.revenue_usd}, profit $${l1.profit_usd}, collected $${l1.collected_total_usd}; sale rounding adjustments sum $${adjustments.toFixed(4)}, refund rounding adjustments sum $${refundAdjustments.toFixed(4)}`)
    r.check(`L1: 100 fully refunded sales earn nothing -- revenue $${l1.revenue_usd}, profit $${l1.profit_usd}, Sales-page revenue $${l1Stats.revenue_usd}`, () => {
      assert.equal(l1.revenue_usd, 0)
      assert.equal(l1.profit_usd, 0)
      assert.equal(l1Stats.revenue_usd, 0)
    })
    r.check(`L1: cash in equals cash out (collected $${l1.collected_total_usd})`, () => {
      assert.equal(l1.collected_total_usd, 0)
    })
    for (let i = 1; i <= 3; i++) {
      const sale = await H.createSale(h, { key: `al-l1-control-${i}`, status: 'completed', createdAt: day('2026-10-06'),
        lines: [{ productId: 7100, quantity: 1, manualPrice: 10, fixedDiscount: 0.0045,
          quote: { gross_usd: 10, product_discount_usd: 0, manual_discount_usd: 0.0045, total_usd: 9.9955, total_khr: 39982 } }],
        paymentDetails: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], label: 'L1 control sale' })
      assert.equal(sale.status, 200, JSON.stringify(sale.body).slice(0, 300))
      if (i === 1) continue // the kept sale
      const back = await H.customerReturn(h, { key: `al-l1-control-r-${i}`, saleId: sale.body.id,
        lines: [{ saleItemId: sale.body.sale.items[0].id, productId: 7100, quantity: 1 }], label: 'L1 control refund' })
      assert.equal(back.created && back.created.status, 200)
    }
    const control = await totalsOf(h, range('2026-10-06'), 'L1 control overview 2026-10-06')
    r.check(`L1 control: 1 kept + 2 refunded earns exactly the kept $10.00 (revenue $${control.revenue_usd}, profit $${control.profit_usd}; a clamp would also show $10.01)`, () => {
      assert.ok(Math.abs(control.revenue_usd - 10) < 0.005, `revenue $${control.revenue_usd}`)
      assert.ok(Math.abs(control.profit_usd - 9) < 0.005, `profit $${control.profit_usd} (cost of the kept unit is $1)`)
    })

    // ---- L2: 501 customers x $1 ------------------------------------------
    await h.db.batch(Array.from({ length: 501 }, (_, index) => h.db.prepare('INSERT INTO customers(id,name,phone) VALUES(?,?,?)')
      .bind(10001 + index, `AL-L2 Customer ${index + 1}`, `0123${String(index + 1).padStart(5, '0')}`)))
    const template = await H.createSale(h, { key: 'al-l2-1', status: 'completed', createdAt: day('2026-10-02'), customerId: 10001,
      lines: [{ productId: 702, quantity: 1, quote: { gross_usd: 1, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 1, total_khr: 4000 } }],
      paymentDetails: [{ method: 'Cash', amount_usd: 1, amount_khr: 0 }], label: 'L2 $1 sale (real, cloned 500 times)' })
    assert.equal(template.status, 200, JSON.stringify(template.body).slice(0, 300))
    const columns = async table => (await h.all(`PRAGMA table_info(${table})`)).map(column => column.name).filter(name => name !== 'id')
    const saleColumns = await columns('sales')
    const itemColumns = (await columns('sale_items')).filter(name => name !== 'sale_id')
    const override = { receipt_number: '@receipt', client_request_id: '@key', customer_id: '@customer', customer_name: '@name' }
    const clones = []
    for (let i = 2; i <= 501; i++) {
      const id = 900000 + i
      const bind = { receipt: `AL-L2-${i}`, key: `al-l2-${i}`, customer: 10000 + i, name: `AL-L2 Customer ${i}` }
      clones.push(h.db.prepare(`INSERT INTO sales(id,${saleColumns.join(',')}) SELECT ?1,${saleColumns.map(name => override[name] ? `?${['receipt', 'key', 'customer', 'name'].indexOf(override[name].slice(1)) + 3}` : name).join(',')} FROM sales WHERE id=?2`)
        .bind(id, template.body.id, bind.receipt, bind.key, bind.customer, bind.name))
      clones.push(h.db.prepare(`INSERT INTO sale_items(sale_id,${itemColumns.join(',')}) SELECT ?1,${itemColumns.join(',')} FROM sale_items WHERE sale_id=?2`)
        .bind(id, template.body.id))
    }
    for (let start = 0; start < clones.length; start += 100) await h.db.batch(clones.slice(start, start + 100))
    const l2Count = await h.one("SELECT COUNT(*) n, COUNT(DISTINCT customer_id) customers FROM sales WHERE date(created_at,'+7 hours')='2026-10-02'")
    assert.deepEqual([l2Count.n, l2Count.customers], [501, 501])
    const l2Overview = await totalsOf(h, range('2026-10-02'), 'L2 overview 2026-10-02')
    const grouped = await h.call('GET', H.fresh(`/api/reports/grouped?by=customer&limit=500&${range('2026-10-02')}`), undefined, 'L2 grouped by customer (limit 500, as the till asks)')
    const groupedSum = Number(grouped.body.rows.reduce((sum, row) => sum + Number(row.revenue_usd), 0).toFixed(2))
    const metadataKeys = Object.keys(grouped.body).filter(key => !['by', 'is_admin', 'filters', 'rows'].includes(key))
    const flagged = grouped.body.truncated === true || grouped.body.complete === false || Number(grouped.body.total_groups) > grouped.body.rows.length
    r.check(`L2: 501 customer groups are all returned or the response says it is incomplete (${grouped.body.rows.length} rows, summed revenue $${groupedSum} vs overview $${l2Overview.revenue_usd}; extra response keys: ${metadataKeys.join(',') || 'none'})`, () => {
      assert.equal(grouped.status, 200)
      if (!flagged) {
        assert.equal(grouped.body.rows.length, 501)
        assert.equal(groupedSum, l2Overview.revenue_usd)
      }
    })
    const groupedAll = await h.call('GET', H.fresh(`/api/reports/grouped?by=customer&limit=1000&${range('2026-10-02')}`), undefined, 'L2 grouped by customer (limit 1000)')
    r.check(`L2 control: the data really holds 501 groups (limit 1000 returns ${groupedAll.body.rows.length})`, () => {
      assert.equal(groupedAll.body.rows.length, 501)
    })

    // ---- L3: two $1 sales, $0.0050 COGS each, different days -------------
    for (const [index, date] of ['2026-10-03', '2026-10-04'].entries()) {
      await h.db.prepare('INSERT INTO customers(id,name,phone) VALUES(?,?,?)').bind(20001 + index, `AL-L3 Customer ${index + 1}`, `0124${index + 1}`).run()
      const sale = await H.createSale(h, { key: `al-l3-${index + 1}`, status: 'completed', createdAt: day(date), customerId: 20001 + index,
        lines: [{ productId: 703, quantity: 1, quote: { gross_usd: 1, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 1, total_khr: 4000 } }],
        paymentDetails: [{ method: 'Cash', amount_usd: 1, amount_khr: 0 }], label: 'L3 $1 sale, COGS $0.005' })
      assert.equal(sale.status, 200, JSON.stringify(sale.body).slice(0, 300))
    }
    const l3Range = 'startDate=2026-10-03&endDate=2026-10-04'
    const l3 = await totalsOf(h, l3Range, 'L3 overview 03-04')
    const days = (await h.call('GET', H.fresh(`/api/reports/periods?granularity=day&${l3Range}`), undefined, 'L3 periods by day')).body.rows
    const weeks = (await h.call('GET', H.fresh(`/api/reports/periods?granularity=week&${l3Range}`), undefined, 'L3 periods by week')).body.rows
    const customers = (await h.call('GET', H.fresh(`/api/reports/grouped?by=customer&limit=500&${l3Range}`), undefined, 'L3 grouped by customer')).body.rows
    const sum = (rows, key) => Number(rows.reduce((total, row) => total + Number(row[key]), 0).toFixed(4))
    const explained = rows => rows.some(row => Object.keys(row).some(key => /rounding|residual|reconcil/i.test(key)))
    console.log(`INFO AL-L3 overview cost $${l3.cost_usd} profit $${l3.profit_usd}; day rows cost ${days.map(row => row.cost_usd).join(' + ')} = $${sum(days, 'cost_usd')}, profit ${days.map(row => row.profit_usd).join(' + ')}; week rows ${weeks.length} cost ${weeks.map(row => row.cost_usd).join(',')} profit ${weeks.map(row => row.profit_usd).join(',')}; customer rows cost ${customers.map(row => row.cost_usd).join(' + ')}`)
    r.check(`L3: the one week bucket covering both days equals the overview exactly (week cost $${weeks.map(row => row.cost_usd).join(',')} vs $${l3.cost_usd}; profit $${weeks.map(row => row.profit_usd).join(',')} vs $${l3.profit_usd})`, () => {
      assert.equal(weeks.length, 1)
      assert.equal(weeks[0].cost_usd, l3.cost_usd)
      assert.equal(weeks[0].profit_usd, l3.profit_usd)
    })
    r.check(`L3: day buckets add up to the overview or explain the rounding (cost $${sum(days, 'cost_usd')} vs $${l3.cost_usd}; profit $${sum(days, 'profit_usd')} vs $${l3.profit_usd})`, () => {
      if (explained(days)) return
      assert.equal(sum(days, 'cost_usd'), l3.cost_usd)
      assert.equal(sum(days, 'profit_usd'), l3.profit_usd)
    })
    r.check(`L3: customer buckets add up to the overview or explain the rounding (cost $${sum(customers, 'cost_usd')} vs $${l3.cost_usd}; profit $${sum(customers, 'profit_usd')} vs $${l3.profit_usd})`, () => {
      if (explained(customers)) return
      assert.equal(sum(customers, 'cost_usd'), l3.cost_usd)
      assert.equal(sum(customers, 'profit_usd'), l3.profit_usd)
    })

    // ---- L4: hidden courier cost ----------------------------------------
    await h.db.prepare("INSERT INTO delivery_contacts(id,name,phone) VALUES(1,'AL-L4 Driver','012000444')").run()
    const delivery = await H.createSale(h, { key: 'al-l4', status: 'completed', createdAt: day('2026-10-05'),
      lines: [{ productId: 704, quantity: 1, quote: { gross_usd: 10, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 10, total_khr: 40000 } }],
      paymentDetails: [{ method: 'Cash', amount_usd: 12, amount_khr: 0 }], label: 'L4 delivery sale',
      extra: { is_delivery: true, delivery_contact_id: 1, delivery_fee_usd: 2, delivery_fee_paid_by: 'customer', delivery_actual_cost_usd: 1.5 } })
    assert.equal(delivery.status, 200, JSON.stringify(delivery.body).slice(0, 300))
    const employee = await h.addEmployee(950, 'al_cost_viewer', { sales: true, reports: true, product_cost_view: true })
    const admin4 = await totalsOf(h, range('2026-10-05'), 'L4 admin overview')
    const seen = await totalsOf(h, range('2026-10-05'), 'L4 cost-view employee overview', employee)
    const seenDays = (await h.call('GET', H.fresh(`/api/reports/periods?granularity=day&${range('2026-10-05')}`), undefined, 'L4 cost-view employee periods', { cookie: employee })).body.rows
    const inferred = row => ['revenue_usd', 'cost_usd', 'profit_usd', 'recognized_delivery_usd'].every(key => typeof row[key] === 'number')
      ? Number((row.recognized_delivery_usd - (row.profit_usd - row.revenue_usd + row.cost_usd)).toFixed(4)) : null
    r.check(`L4 control: the administrator's courier cost is $${admin4.delivery_actual_cost_usd}`, () => {
      assert.equal(admin4.delivery_actual_cost_usd, 1.5)
    })
    r.check(`L4: the cost-view employee is not sent the courier cost (keys: ${['delivery_actual_cost_usd', 'delivery_net_usd', 'delivery_margin_usd'].filter(key => key in seen).join(',') || 'none'})`, () => {
      assert.ok(!('delivery_actual_cost_usd' in seen) && !('delivery_net_usd' in seen))
    })
    r.check(`L4: nor can it be recovered as fee - (profit - revenue + cost): overview gives $${inferred(seen)}, day row gives $${seenDays[0] ? inferred(seenDays[0]) : 'n/a'} (hidden value $1.5)`, () => {
      assert.notEqual(inferred(seen), 1.5)
      assert.ok(!seenDays.length || inferred(seenDays[0]) !== 1.5)
    })

    // The 700 bulk setup writes (L1, L2) are printed once per kind and kept
    // out of the worst case; the report reads are the subject of this file.
    const setupLabels = new Set(['L1 sale $9.9955 paid $10', 'quote L1 full refund', 'L1 full refund'])
    const printedSetup = new Set()
    const worst = H.budgetLine(h.metrics.filter(entry => {
      if (!setupLabels.has(entry.label)) return true
      entry.setup = true
      if (printedSetup.has(entry.label)) return false
      printedSetup.add(entry.label)
      return true
    }))
    r.check(`D1 budget: worst report request ${worst.label} used ${worst.statements} statements (Free ${H.FREE_QUERY_LIMIT}, Paid ${H.PAID_QUERY_LIMIT})`, () => {
      assert.ok(worst.statements <= H.FREE_QUERY_LIMIT, `exceeds the Free per-invocation limit of ${H.FREE_QUERY_LIMIT}`)
    })
  } finally {
    await h.mf.dispose()
  }
  phase('done')
  const failed = r.results.filter(result => !result.ok)
  console.log(`${failed.length ? 'RED' : 'GREEN'} AL-L report completeness: ${r.results.length - failed.length}/${r.results.length} owner-rule checks hold`)
  if (failed.length) process.exitCode = 1
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
