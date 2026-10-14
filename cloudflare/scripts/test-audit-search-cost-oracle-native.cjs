'use strict'
// The audit-log free-text search must not be an oracle for a cost the caller may not read.
//
// GET /api/system/audit-logs redacts the courier's actual cost and the product acquisition costs from the rows it
// returns, but the search ran as SQL LIKE over `details`, `old_value` and `new_value` BEFORE that redaction. A caller
// who may read the audit log and not the cost could type a candidate figure and learn from "one row" or "no rows"
// whether it occurs; digit by digit that recovers it (35 queries for $8.27, refute round 2b, SF-A). The redacted
// bytes were fine; the information was not.
//
// Fixture, on the real routes: a delivery sale with courier cost $7.13 corrected to $8.27 by an amendment (and its fee corrected, a row that names no cost), and a
// product-cost audit row (cost $3.1415 -> $3.1416) written the way the product routes write one.
// Accounts: an administrator, a reader with both costs, and three readers who each lack one or both. Every reader holds
// audit_log (the full tier, which is what the oracle needs).
//
// The oracle is the refuter's: recover `actual_cost_after":<digits>` one character at a time with the search box, and
// ask for the exact figures. A blind reader must recover nothing; a reader with the right keeps the search (controls).
//
// Run (from cloudflare/):  node scripts/test-audit-search-cost-oracle-native.cjs
// Red-on-the-base: --base=<commit> bundles every src file that differs from that commit as that commit had it,
//   e.g. --base=c7a221c29 (the tip this fix started from).
// Negative controls rewrite source text in memory at bundle time:
//   --wrong=unguarded     the hidden-text patterns are built and never applied
//   --wrong=details-only  only `details` is guarded; old_value and new_value still match
//   --wrong=courier-only  the acquisition-cost patterns are never passed
//   --wrong=acquisition-only  the courier pattern is never passed
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const QUERY = 'src/lib/auditLogQuery.ts'
const ROUTE = 'src/routes/compat.ts'
const MUTANTS = {
  unguarded: [{ name: 'unguarded', file: QUERY, from: 'if (!REDACTABLE_TEXT_COLUMNS.has(column) || !hiddenTextPatterns.length) return match', to: 'return match' }],
  'details-only': [{ name: 'details-only', file: QUERY, from: "new Set(['details', 'old_value', 'new_value'])", to: "new Set(['details'])" }],
  'courier-only': [{ name: 'courier-only', file: ROUTE, from: '...(canViewAcquisitionCosts(user) ? [] : ACQUISITION_COST_TEXT_PATTERNS)', to: '...[]' }],
  'acquisition-only': [{ name: 'acquisition-only', file: ROUTE, from: '...(canViewCourierCost(user) ? [] : [COURIER_COST_TEXT_PATTERN])', to: '...[]' }],
}
const flag = name => (process.argv.slice(2).find(arg => arg.startsWith(`--${name}=`)) || '').slice(name.length + 3)
const BASE = flag('base')
const WRONG = flag('wrong')
if (WRONG && !MUTANTS[WRONG]) throw new Error(`unknown --wrong=${WRONG}; choose one of ${Object.keys(MUTANTS).join(', ')}`)
const COST_TEXT = /actual.{0,3}cost|actual.{0,3}delivery.{0,3}cost|delivery.{0,3}actual.{0,3}cost/i
const day = (date, hourUtc = 3) => `${date}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`
const QUOTE = { gross_usd: 10, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 10, total_khr: 40000 }

async function main() {
  const h = await H.startWorker({ patches: WRONG ? MUTANTS[WRONG] : BASE ? H.basePatches(BASE) : [] })
  const r = H.recorder('ASO')
  try {
    await H.seedProduct(h, 704, 'ASO Cream', 10, 1000, 1)
    await h.db.prepare("INSERT INTO delivery_contacts(id,name,phone) VALUES(1,'ASO Driver','012000777')").run()
    const sale = await H.createSale(h, { key: 'aso-a', createdAt: day('2026-10-05'), lines: [{ productId: 704, quantity: 1, quote: QUOTE }],
      paymentDetails: [{ method: 'Cash', amount_usd: 12, amount_khr: 0 }],
      extra: { is_delivery: true, delivery_contact_id: 1, delivery_fee_usd: 2, delivery_fee_paid_by: 'customer', delivery_actual_cost_usd: 7.13 } })
    assert.equal(sale.status, 200, JSON.stringify(sale.body).slice(0, 300))
    const amended = await H.amendSale(h, sale.body.id, { kind: 'delivery_actual_cost_changed', client_request_id: 'aso-a-cost', delivery_actual_cost_usd: 8.27 })
    assert.equal(amended.status, 200, JSON.stringify(amended.body).slice(0, 300))
    const feeChange = await H.amendSale(h, sale.body.id, { kind: 'delivery_fee_changed', client_request_id: 'aso-a-fee', delivery_fee_usd: 2.5, delivery_fee_paid_by: 'customer' })
    assert.equal(feeChange.status, 200, JSON.stringify(feeChange.body).slice(0, 300))
    const productCost = JSON.stringify({ field: 'cost_price_usd', cost_price_usd: 3.1415, note: 'cost corrected' })
    await h.db.prepare("INSERT INTO audit_logs(user_id,user_name,action,entity,entity_id,details,old_value,new_value,created_at) VALUES(901,'AL Admin','product_cost_update','product','704',?,?,?,?)")
      .bind(productCost, JSON.stringify({ cost_price_usd: 3.1415 }), JSON.stringify({ cost_price_usd: 3.1416 }), '2026-10-05 04:00:00').run()

    const OFF = { 'sales:view_courier_cost': false }
    const READS = { sales: 'view', reports: true, audit_log: true }
    const accounts = {
      admin: undefined,
      both: await h.addEmployee(970, 'aso_both', { ...READS, product_cost_view: true }),
      'no-courier': await h.addEmployee(971, 'aso_no_courier', { ...READS, product_cost_view: true, ...OFF }),
      'no-acquisition': await h.addEmployee(972, 'aso_no_acq', { ...READS }),
      blind: await h.addEmployee(973, 'aso_blind', { ...READS, ...OFF }),
    }
    const search = async (who, word, extra = '') => {
      const res = await h.call('GET', H.fresh(`/api/system/audit-logs?pageSize=100&search=${encodeURIComponent(word)}${extra}`), undefined, `${who} search ${word}`,
        accounts[who] ? { cookie: accounts[who] } : {})
      assert.equal(res.status, 200, `${who} search ${word} answered ${res.status} ${JSON.stringify(res.body).slice(0, 150)}`)
      return res.body.items || []
    }
    const recover = async (who) => {
      let known = ''
      for (let position = 0; position < 8; position += 1) {
        let found = null
        for (const digit of (position === 0 ? '0123456789' : '.0123456789')) {
          if ((await search(who, `actual_cost_after":${known}${digit}`, '&entity=sale')).length) { found = digit; break }
        }
        if (!found) break
        known += found
      }
      return known
    }

    // ---- controls: the instrument can see the figure where the reader may -------------
    for (const who of ['admin', 'both']) {
      const courier = await search(who, '8.27', '&entity=sale')
      const neighbour = await search(who, '8.28', '&entity=sale')
      const acquisition = await search(who, '3.1415', '&entity=product')
      const recovered = await recover(who)
      r.check(`control: ${who} finds the courier cost and the product cost by typing the figure, and not a neighbouring one`, () => {
        assert.ok(courier.length > 0, 'search 8.27 found no row')
        assert.equal(neighbour.length, 0, 'search 8.28 found a row')
        assert.ok(acquisition.length > 0, 'search 3.1415 found no row')
      })
      r.check(`control: ${who} recovers the courier cost digit by digit (the oracle is a real one)`, () => assert.equal(recovered, '8.27'))
    }

    // ---- the rule: with a cost hidden, its figure cannot be found by search -------------
    for (const who of ['no-courier', 'blind']) {
      const probes = {}
      for (const word of ['8.27', '8.28', '7.13', 'actual_cost_after', 'delivery_actual_cost']) probes[word] = await search(who, word)
      const recovered = await recover(who)
      r.check(`${who} cannot find the courier cost by typing it, its old figure or its key name`, () => {
        for (const [word, rows] of Object.entries(probes)) assert.equal(rows.length, 0, `search ${word} found ${rows.length} row(s)`)
      })
      r.check(`${who} recovers nothing of the courier cost digit by digit`, () => assert.equal(recovered, ''))
    }
    for (const who of ['no-acquisition', 'blind']) {
      const probes = {}
      for (const word of ['3.1415', '3.1416', 'cost_price_usd']) probes[word] = await search(who, word, '&entity=product')
      r.check(`${who} cannot find a product cost by typing it, its new figure or its key name`, () => {
        for (const [word, rows] of Object.entries(probes)) assert.equal(rows.length, 0, `search ${word} found ${rows.length} row(s)`)
      })
    }

    // ---- the audit trail itself is not hidden: only text search into the redacted columns is ----
    const adminSales = await search('admin', '', '&entity=sale')
    const adminFee = await search('admin', 'delivery_fee', '&entity=sale')
    const costFree = adminFee.filter(row => !COST_TEXT.test(`${row.details}${row.old_value}${row.new_value}`))
    for (const who of ['no-courier', 'no-acquisition', 'blind']) {
      const sales = await search(who, '', '&entity=sale')
      const products = await search(who, '', '&entity=product')
      const byAction = await search(who, 'product_cost_update')
      const byUser = await search(who, 'AL Admin')
      const fee = await search(who, 'delivery_fee', '&entity=sale')
      r.check(`${who} still lists every sale and product audit row, and finds them by user and by action`, () => {
        assert.deepEqual(sales.map(row => row.id), adminSales.map(row => row.id), 'the same sale rows as the administrator')
        assert.ok(products.some(row => row.action === 'product_cost_update'))
        assert.ok(byAction.length > 0, 'a row is found by its action name')
        assert.ok(byUser.length > 0, 'a row is found by its user')
      })
      r.check(`${who} still searches the text of rows that name no hidden cost`, () => {
        assert.ok(costFree.length > 0, 'the fixture has a fee-only row')
        for (const row of costFree) assert.ok(fee.some(item => item.id === row.id), `row ${row.id} lost to the search`)
      })
    }
    // The redacted rows come back as before: the figure is gone from the bytes too.
    const blindSales = await search('blind', '', '&entity=sale')
    const blindProducts = await search('blind', '', '&entity=product')
    r.check('a blind reader receives the rows redacted (the bytes were never the problem)', () => {
      assert.ok(blindSales.length >= 2)
      assert.equal(JSON.stringify(blindSales).includes('8.27'), false)
      assert.equal(JSON.stringify(blindSales).includes('7.13'), false)
      assert.equal(JSON.stringify(blindProducts).includes('3.1415'), false)
    })
  } finally {
    await h.mf.dispose?.()
  }
  const failed = r.results.filter(entry => !entry.ok)
  console.log(`\n${failed.length ? 'RED' : 'GREEN'} audit search cost oracle: ${r.results.length - failed.length}/${r.results.length} checks hold${WRONG ? ` (mutant --wrong=${WRONG})` : BASE ? ` (src as of ${BASE})` : ''}`)
  process.exitCode = failed.length ? 1 : 0
}

main().then(() => process.exit(process.exitCode || 0)).catch(error => { console.error(error); process.exit(1) })
