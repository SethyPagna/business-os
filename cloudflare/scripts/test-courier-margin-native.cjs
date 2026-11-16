'use strict'
// The DELIVERY margin (delivery fee charged minus the courier's actual cost) is courier money. It follows the courier
// rule (canViewCourierCost: administrator OR sales:view_courier_cost), never the product-cost rule (administrator only).
// Review finding A, 16 Nov 2026: the row key was a bare `margin_usd`, which the product-cost response filter on every
// Sales route strips as product margin, so a staff member holding the courier grant saw a real cost next to a $0.00
// delivery profit. The key is now `delivery_margin_usd`, on every courier row.
//
// Fixture: two delivery sales on one day for one courier. Every expected figure is computed from the fixture values.
// Surfaces: /api/sales/delivery-contact-report, /api/sales/day-report (delivery_contacts) and
// /api/reports/grouped?by=courier must agree for every account that may read them.
//
// Run (from cloudflare/):  node scripts/test-courier-margin-native.cjs
//   --wrong=product-rule   the delivery margin is read as product money (the bug)
//   --wrong=open           the courier row gate lets everyone through
//   --wrong=bare-key       the row key goes back to margin_usd
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const H = require('./harness/al_money_native.cjs')

const flag = name => (process.argv.slice(2).find(arg => arg.startsWith(`--${name}=`)) || '').slice(name.length + 3)
const WRONG = flag('wrong')
const ACQ = 'src/lib/acquisitionCostAccess.ts'
const MUTANTS = {
  'product-rule': [{ name: 'product-rule', file: ACQ, from: "if (/(^|_)(delivery|courier)(_|$)/.test(normalized)) return false",
    to: "if (/(^|_)(delivery|courier)(_|$)/.test(normalized) && !/margin/.test(normalized)) return false" }],
  open: [
    { name: 'open-sales', file: 'src/routes/sales.ts', from: 'if(canViewCourier)return row\n  const {actual_cost_usd', to: 'return row\n  const {actual_cost_usd' },
    { name: 'open-reports', file: 'src/routes/reports.ts', from: 'if (canViewCourier) return row\n  const {\n    actual_cost_usd', to: 'return row\n  const {\n    actual_cost_usd' },
  ],
  'bare-key': [
    { name: 'bare-key-merge', file: 'src/lib/salesAnalytics.ts', from: '      delivery_margin_usd: round2(row.charged_fee_usd - row.actual_cost_usd),', to: '      margin_usd: round2(row.charged_fee_usd - row.actual_cost_usd),' },
    { name: 'bare-key-bucket', file: 'src/lib/salesAnalytics.ts', from: '    delivery_margin_usd: group.charged.subtract(group.actual)', to: '    margin_usd: group.charged.subtract(group.actual)' },
  ],
}
if (WRONG && !MUTANTS[WRONG]) throw new Error(`unknown --wrong=${WRONG}; choose one of ${Object.keys(MUTANTS).join(', ')}`)

const seedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'roleDefaults.ts'), 'utf8')
const mod = { exports: {} }
new Function('module', 'exports', ts.transpileModule(seedSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(mod, mod.exports)
const SEED = mod.exports.DEFAULT_ROLE_PERMISSIONS

const DATE = '2026-11-10'
const RANGE = `startDate=${DATE}&endDate=${DATE}`
const QUOTE = { gross_usd: 10, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 10, total_khr: 40000 }
// [delivery fee charged, courier actual cost] per sale. The expected margin is computed from these, in whole cents.
const DELIVERIES = [[2, 0.83], [1.5, 0.41]]
const lit = n => String(n).split('.').join('[.]')
const cents = n => Math.round(n * 100)
const EXPECTED_FEE = DELIVERIES.reduce((s, [fee]) => s + cents(fee), 0) / 100
const EXPECTED_COST = DELIVERIES.reduce((s, [, cost]) => s + cents(cost), 0) / 100
const EXPECTED_MARGIN = (cents(EXPECTED_FEE) - cents(EXPECTED_COST)) / 100
// A product margin / profit / cost key anywhere in a non-administrator body. Only the exact courier row keys, inside a courier list, are exempt.
const PRODUCT_KEY = /(^|_)(cost|cogs|profit|margin|purchase_price|stock_value)(_|$)/i
const COURIER_ROW_KEY = /^(actual_cost_(usd|count)|delivery_margin_usd)$/
function productKeys(value, trail = '$', found = []) {
  if (Array.isArray(value)) value.forEach(item => productKeys(item, `${trail}[]`, found))
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const courierRow = COURIER_ROW_KEY.test(key) && /\.(delivery_contacts|couriers|contacts|rows)\[\]$/.test(trail)
      if (PRODUCT_KEY.test(key) && !/^(delivery|recognized|pending)_(actual|margin|net|delivery)/.test(key) && !courierRow) found.push(`${trail}.${key}`)
      productKeys(child, `${trail}.${key}`, found)
    }
  }
  return found
}

async function main() {
  const h = await H.startWorker({ patches: WRONG ? MUTANTS[WRONG] : [] })
  const r = H.recorder('CMG')
  try {
    await H.seedProduct(h, 720, 'CMG Cream', 10, 1000, 4)
    await h.db.prepare("INSERT INTO delivery_contacts(id,name,phone) VALUES(1,'CMG Driver','012000720')").run()
    for (const [index, [fee, cost]] of DELIVERIES.entries()) {
      const sale = await H.createSale(h, { key: `cmg-${index}`, backdateTo: `${DATE}T03:0${index}:00.000Z`, lines: [{ productId: 720, quantity: 1, quote: QUOTE }],
        paymentDetails: [{ method: 'Cash', amount_usd: 10 + fee, amount_khr: 0 }],
        extra: { is_delivery: true, delivery_contact_id: 1, delivery_fee_usd: fee, delivery_fee_paid_by: 'customer', delivery_actual_cost_usd: cost } })
      assert.equal(sale.status, 200, JSON.stringify(sale.body).slice(0, 300))
    }
    // The seeded Employee holds no contacts:financial_history (the delivery-contact report answers 403, correct); granted here so the grant under test is the only variable.
    const ON = { contacts: true, 'contacts:financial_history': true, reports: true, dashboard: true }
    const OFF = { 'sales:view_courier_cost': false }
    const accounts = {
      admin: undefined,
      manager: await h.addEmployee(930, 'cmg_manager', { ...SEED.manager, ...ON }),
      employee: await h.addEmployee(931, 'cmg_employee', { ...SEED.employee, ...ON }),
      'manager-off': await h.addEmployee(932, 'cmg_manager_off', { ...SEED.manager, ...ON, ...OFF }),
      'employee-off': await h.addEmployee(933, 'cmg_employee_off', { ...SEED.employee, ...ON, ...OFF }),
    }
    const granted = ['admin', 'manager', 'employee']
    const denied = ['manager-off', 'employee-off']
    const urls = {
      report: `/api/sales/delivery-contact-report?${RANGE}&contactId=1`,
      day: `/api/sales/day-report?date=${DATE}`,
      grouped: `/api/reports/grouped?by=courier&${RANGE}`,
    }
    const rowOf = (surface, body) => surface === 'report' ? (body.contacts || [])[0]
      : surface === 'day' ? (body.delivery_contacts || []).find(row => Number(row.delivery_contact_id) === 1)
        : (body.rows || body.couriers || []).find(row => Number(row.delivery_contact_id) === 1)
    const got = {}
    for (const who of Object.keys(accounts)) {
      for (const [surface, url] of Object.entries(urls)) {
        got[`${who}|${surface}`] = await h.call('GET', H.fresh(url), undefined, `${who} ${surface}`, accounts[who] ? { cookie: accounts[who] } : {})
      }
    }

    for (const who of granted) {
      for (const surface of Object.keys(urls)) {
        r.check(`${who} reads the exact delivery margin on ${surface}`, () => {
          const res = got[`${who}|${surface}`]
          assert.equal(res.status, 200, `${res.status} ${JSON.stringify(res.body).slice(0, 200)}`)
          const row = rowOf(surface, res.body)
          assert.ok(row, `no courier row: ${JSON.stringify(res.body).slice(0, 300)}`)
          assert.equal(row.actual_cost_usd, EXPECTED_COST)
          assert.equal(row.delivery_margin_usd, EXPECTED_MARGIN)
          assert.equal(Object.hasOwn(row, 'margin_usd'), false, 'the bare margin_usd key is retired')
        })
      }
      r.check(`${who}: the three surfaces agree on the same seed`, () => {
        const rows = Object.keys(urls).map(surface => rowOf(surface, got[`${who}|${surface}`].body))
        for (const field of ['charged_fee_usd', 'actual_cost_usd', 'delivery_margin_usd']) {
          assert.deepEqual(rows.map(row => row[field]), rows.map(() => rows[0][field]), `${field} differs across surfaces`)
        }
        assert.equal(rows[0].charged_fee_usd, EXPECTED_FEE)
        assert.equal(cents(rows[0].charged_fee_usd) - cents(rows[0].actual_cost_usd), cents(rows[0].delivery_margin_usd))
      })
    }
    for (const who of denied) {
      for (const surface of Object.keys(urls)) {
        r.check(`${who} (grant off) sees no courier figure on ${surface}`, () => {
          const res = got[`${who}|${surface}`]
          assert.equal(res.status, 200, `${res.status} ${JSON.stringify(res.body).slice(0, 200)}`)
          const row = rowOf(surface, res.body)
          assert.ok(row, 'the courier row itself (fee, deliveries) stays visible')
          assert.equal(row.charged_fee_usd, EXPECTED_FEE)
          for (const key of ['actual_cost_usd', 'actual_cost_count', 'delivery_margin_usd', 'margin_usd', 'linked_expense_usd']) {
            assert.equal(Object.hasOwn(row, key), false, `${key} reaches ${who}`)
          }
          const hit = JSON.stringify(res.body).match(new RegExp(`.{0,40}(?<![\\d.])(${lit(EXPECTED_COST)}|${lit(EXPECTED_MARGIN)})(?!\\d).{0,10}`))
          assert.equal(hit, null, `a courier figure appears as a value: ${hit && hit[0]}`)
        })
      }
    }
    for (const who of ['manager', 'employee', ...denied]) {
      for (const surface of Object.keys(urls)) {
        r.check(`${who}: no product margin, profit or cost reaches ${surface}`, () => {
          assert.deepEqual(productKeys(got[`${who}|${surface}`].body), [])
        })
      }
    }
    r.check('instrument control: the product-key scan sees a bare margin_usd and exempts only courier rows', () => {
      assert.deepEqual(productKeys({ totals: { margin_usd: 1 } }), ['$.totals.margin_usd'])
      assert.deepEqual(productKeys({ totals: { cost_usd: 1 } }), ['$.totals.cost_usd'])
      assert.deepEqual(productKeys({ delivery_contacts: [{ delivery_margin_usd: 1, actual_cost_usd: 2 }] }), [])
      assert.deepEqual(productKeys({ totals: { actual_cost_usd: 2 } }), ['$.totals.actual_cost_usd'])
    })
    r.check('control: the administrator day report carries product money (the scan can see it)', () => {
      assert.ok(productKeys(got['admin|day'].body).length > 0)
    })
  } finally { await h.mf.dispose() }
  const failed = r.results.filter(x => !x.ok)
  console.log(failed.length ? `RED ${failed.length} failed` : 'GREEN courier margin')
  if (failed.length) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exit(1) })
