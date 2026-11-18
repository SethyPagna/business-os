'use strict'
// P1.8b on the real routes: GET /api/dashboard (every middleware, D1, the Workers Cache API) with read switch `dash_overview_5m` ON and then OFF.
//   - `stock_as_of` is on the summary, an ISO time no older than the 300 s window, and a repeat visit gets the SAME value back (not a fresh stamp);
//   - cost stays masked per role on a freshly computed answer and on a cached one: the Worker's cost mask runs after the cached body, and the
//     cost grant is also part of the key, so a no-cost reader and a cost reader each have their own entry;
//   - a sale leaves the stock block as it was within the window (ON) while everything else on the Dashboard moves at once; with the switch
//     OFF the same sale shows in the stock block on the next visit (the control);
//   - another branch scope is its own entry.
//
// Run (from cloudflare/): node scripts/test-dashboard-overview-5m-native.cjs
// Negative controls rewrite source text in memory at bundle time (--wrong=<name>); each must turn the run red:
//   stock-in-key   the five-minute key still carries the stock version (a sale ends the entry)
//   no-asker       the route does not name the cost grant (the five-minute copy is skipped, every visit recomputes)
// (The age guard on a stored entry needs an entry that lies about its age; test-dashboard-overview-5m-pure.cjs holds that mutant.)
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const WINDOW_MS = 300 * 1000
const SWITCH_MEMO_MS = 16 * 1000 // paid readSwitchMemoSeconds is 15
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// The five-minute bucket follows the real clock (UTC+7); a run that straddles a boundary would see ON recompute for a good reason, so wait it out.
async function clearOfBoundary(seconds = 90) {
  const left = WINDOW_MS - ((Date.now() + 7 * 3600 * 1000) % WINDOW_MS)
  if (left < seconds * 1000) { console.log(`  (waiting ${Math.ceil(left / 1000) + 1} s for the next 5-minute bucket)`); await sleep(left + 1000) }
}
const QUOTE = (total) => ({ gross_usd: total, product_discount_usd: 0, manual_discount_usd: 0, total_usd: total, total_khr: total * 4000 })
const businessToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const RANGE = `startDate=${businessToday()}&endDate=${businessToday()}`

const LOADER = 'src/lib/dashboardStockOverview.ts'
const patchFor = (name) => ({
  'stock-in-key': [{ name, file: LOADER, from: "(fiveMinutes ? ['products'] : ['products', 'stock'])", to: "(['products', 'stock'])" },
    { name: name + '-key', file: LOADER, from: 'org: ctx.org, branchScope: ctx.branchScope, costGrant: ctx.costGrant }),', to: "org: ctx.org, branchScope: ctx.branchScope, costGrant: ctx.costGrant }) + '|s=' + versions[1]," }],
  'no-asker': [{ name, file: 'src/routes/compat.ts', from: "    costGrant: canViewAcquisitionCosts(c.get('user')) ? 'cost' : 'nocost',\n", to: '' }],
})[name]
const flag = (name) => (process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`)) || '').slice(name.length + 3)
const WRONG = flag('wrong')
if (WRONG && !patchFor(WRONG)) throw new Error(`unknown --wrong=${WRONG}`)

async function main() {
  const h = await H.startWorker({ patches: WRONG ? patchFor(WRONG) : [] })
  const r = H.recorder('DO5')
  try {
    await H.seedProduct(h, 901, 'DO5 Serum', 10, 10, 2)
    await H.seedProduct(h, 902, 'DO5 Toner', 8, 10, 3)
    const noCost = await h.addEmployee(31, 'do5_nocost', { dashboard: true })
    const withCost = await h.addEmployee(32, 'do5_cost', { dashboard: true, product_cost_view: true })
    const setSwitch = async (state) => {
      await h.db.prepare("INSERT OR REPLACE INTO system_flags(key, value) VALUES('read_switches', ?)").bind(JSON.stringify({ epoch: state === 'on' ? 1 : 2, switches: { dash_overview_5m: state } })).run()
      await sleep(SWITCH_MEMO_MS)
    }
    const visit = async (label, cookie, query = RANGE) => {
      const res = await h.call('GET', `/api/dashboard?${query}`, undefined, label, cookie === undefined ? {} : { cookie })
      assert.equal(res.status, 200, `${label}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`)
      return res.body
    }
    const stockBlock = (body) => JSON.stringify({ n: body.product_count, i: body.in_stock_count, l: body.low_stock_count, o: body.out_of_stock_count, v: body.stock_value_usd ?? null, e: body.expiring_count })

    await setSwitch('on')
    await clearOfBoundary()

    // ---- ON: as-of, repeat, masking ----------------------------------------------------------
    const first = await visit('ON no-cost reader, cold', noCost)
    const adminCold = await visit('ON admin, cold')
    const costCold = await visit('ON cost reader, cold', withCost)
    const noCostAgain = await visit('ON no-cost reader, again', noCost)
    const adminAgain = await visit('ON admin, again')
    r.check('stock_as_of is an ISO time inside the window; a repeat visit gets the same value, not a new stamp', () => {
      for (const body of [first, adminCold, costCold]) {
        assert.match(String(body.stock_as_of), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
        const age = Date.now() - Date.parse(body.stock_as_of)
        assert.ok(age >= 0 && age <= WINDOW_MS, `stock_as_of is ${age} ms old`)
      }
      assert.equal(noCostAgain.stock_as_of, first.stock_as_of, 'the no-cost reader\'s entry is reused')
      assert.equal(adminAgain.stock_as_of, adminCold.stock_as_of, 'the admin\'s entry is reused')
    })
    r.check('cost is masked per role on a fresh answer and on a cached one', () => {
      assert.equal(first.stock_value_usd, undefined, 'a reader without product_cost_view gets no stock value (fresh)')
      assert.equal(noCostAgain.stock_value_usd, undefined, 'and none from the cached entry either')
      for (const [name, body] of [['admin', adminCold], ['admin again', adminAgain], ['cost reader', costCold]]) {
        assert.equal(typeof body.stock_value_usd, 'number', `${name} sees the stock value`)
        assert.ok(body.stock_value_usd > 0, `${name}: ${body.stock_value_usd}`)
      }
      assert.equal(costCold.stock_value_usd, adminCold.stock_value_usd)
      assert.equal(stockBlock({ ...first, stock_value_usd: adminCold.stock_value_usd }), stockBlock(adminCold), 'the same stock figures, only the cost left out')
    })
    r.check('each cost grant has its own entry (computed separately, so a later stamp)', () => {
      assert.ok(Date.parse(adminCold.stock_as_of) >= Date.parse(first.stock_as_of))
      assert.equal(costCold.stock_as_of, adminCold.stock_as_of, 'readers with the same grant share the entry')
    })

    // ---- ON: a sale leaves the stock block alone; the rest moves -------------------------------
    const before = adminAgain
    const sale = await H.createSale(h, { key: 'do5-sale-1', customerId: undefined, lines: [{ productId: 901, quantity: 2, quote: QUOTE(20) }],
      paymentDetails: [{ method: 'Cash', amount_usd: 20, amount_khr: 0 }] })
    assert.equal(sale.status, 200, JSON.stringify(sale.body).slice(0, 300))
    const afterOn = await visit('ON admin, after a sale')
    r.check('ON: after a sale the stock block is the one already held, the sales figures are live', () => {
      assert.equal(afterOn.stock_as_of, before.stock_as_of, 'same stock_as_of: the stored entry was served')
      assert.equal(stockBlock(afterOn), stockBlock(before), 'same stock figures')
      assert.equal(afterOn.today_count, before.today_count + 1, 'the sale count moved at once')
      assert.equal(afterOn.recent_sales[0].id, sale.body.id, 'and the sale is first in the recent list')
    })

    // ---- another branch scope is its own entry ---------------------------------------------------
    const branchOne = await visit('ON admin, branch 1', undefined, `${RANGE}&branchId=1`)
    r.check('ON: another branch scope computes its own entry (a newer stamp) and sees the current stock', () => {
      assert.ok(Date.parse(branchOne.stock_as_of) > Date.parse(before.stock_as_of), `${branchOne.stock_as_of} vs ${before.stock_as_of}`)
      assert.ok(branchOne.stock_value_usd < before.stock_value_usd, `branch scope computed after the sale: ${branchOne.stock_value_usd} < ${before.stock_value_usd}`)
    })

    // ---- OFF: the control ---------------------------------------------------------------------------
    await setSwitch('off')
    const afterOff = await visit('OFF admin, after the sale')
    const afterOffAgain = await visit('OFF admin, again')
    r.check('OFF (control): the same sale is in the stock block on the next visit; a repeat keeps that stamp', () => {
      assert.notEqual(afterOff.stock_as_of, before.stock_as_of, 'recomputed')
      assert.ok(afterOff.stock_value_usd < before.stock_value_usd, `${afterOff.stock_value_usd} < ${before.stock_value_usd}`)
      assert.equal(afterOffAgain.stock_as_of, afterOff.stock_as_of, 'and then served from the entry, stamp kept')
      assert.equal(afterOff.today_count, afterOn.today_count)
    })
    const offNoCost = await visit('OFF no-cost reader', noCost)
    r.check('OFF: cost stays masked and stock_as_of is still on the summary', () => {
      assert.equal(offNoCost.stock_value_usd, undefined)
      assert.match(String(offNoCost.stock_as_of), /^\d{4}-\d\d-\d\dT/)
      assert.equal(offNoCost.stock_as_of, afterOff.stock_as_of)
    })
  } finally {
    await h.mf.dispose?.()
  }
  const failed = r.results.filter(entry => !entry.ok)
  console.log(`\n${failed.length ? 'RED' : 'GREEN'} dashboard overview 5m native: ${r.results.length - failed.length}/${r.results.length} checks hold${WRONG ? ` (mutant --wrong=${WRONG})` : ''}`)
  process.exitCode = failed.length ? 1 : 0
}

main().then(() => process.exit(process.exitCode || 0)).catch(error => { console.error(error); process.exit(1) })
