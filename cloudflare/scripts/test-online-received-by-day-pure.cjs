// KHQR S6a condition 2, the pure half: what the composers do with the online-received overlay. An online order is paid on day 1 and fulfilled on day 3. Money RECEIVED belongs to day 1
// (PayWay's paid_at), never again to day 3; revenue is the sale's and stays on day 3. The reports overview folds a sale-dated collected figure (collectedByPaymentDay); the Telegram
// overview's Received line folds a tender-based one (receivedWithOnlinePaid). The database half is scripts/test-online-received-by-payment-day-native.cjs.
// Run (from cloudflare/): node scripts/test-online-received-by-day-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(relative) {
  const filename = path.join(__dirname, '../src', relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename })
  const module = { exports: {} }
  const poisoned = new Proxy({}, { get: (_, key) => (key === '__esModule' ? true : () => { throw new Error(`the pure folds must not touch ${String(key)}`) }) })
  new Function('require', 'module', 'exports', outputText)(() => poisoned, module, module.exports)
  return module.exports
}
const { collectedByPaymentDay, receivedWithOnlinePaid, overlayApplies } = load('lib/onlineOrderReceived.ts')

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`) }

// The facts, by day: a $12.50 cash sale on day 1 and on day 3, a $25 online order paid on day 1 and Fulfilled by a sale on day 3.
const DAYS = {
  1: { saleDatedCollected: 12.5, tenderDigital: 0, overlay: { paidInWindowUsd: 25, recordedOnSalesUsd: 0 } },
  2: { saleDatedCollected: 0, tenderDigital: 0, overlay: { paidInWindowUsd: 0, recordedOnSalesUsd: 0 } },
  // The kernel's day-3 collected includes the Fulfil sale's tender (12.5 cash + 25 KHQR); the tender reader leaves the KHQR part out of the day's digital.
  3: { saleDatedCollected: 37.5, tenderDigital: 0, overlay: { paidInWindowUsd: 0, recordedOnSalesUsd: 25 } },
}

check('reports (sale-dated collected): day 1 receives the online money, day 3 does not, and the three days count it once', () => {
  const by = Object.fromEntries(Object.entries(DAYS).map(([day, d]) => [day, collectedByPaymentDay(d.saleDatedCollected, d.overlay)]))
  assert.deepEqual(by, { 1: 37.5, 2: 0, 3: 12.5 })
  assert.equal(Object.values(by).reduce((a, b) => a + b, 0), 50, 'the whole range is 12.5 + 12.5 + 25, the online $25 once')
})

check('Telegram overview Received (tender-based): the online money is added on its paid day only', () => {
  const by = Object.fromEntries(Object.entries(DAYS).map(([day, d]) => [day, receivedWithOnlinePaid({ usd: 12.5, khr: 0, digital: { usd: d.tenderDigital, khr: 0 } }, d.overlay).digital.usd]))
  assert.deepEqual(by, { 1: 25, 2: 0, 3: 0 })
  assert.equal(Object.values(by).reduce((a, b) => a + b, 0), 25, 'once across the days')
  const unchanged = { usd: 5, khr: 0, digital: { usd: 3, khr: 0 } }
  assert.equal(receivedWithOnlinePaid(unchanged, { paidInWindowUsd: 0 }), unchanged, 'nothing paid online that day: the very same figure')
  assert.equal(receivedWithOnlinePaid({ usd: 1, khr: 0, digital: { usd: 3.1, khr: 0 } }, { paidInWindowUsd: 0.2 }).digital.usd, 3.3, 'added to what the digital line already had')
})

check('the fold keeps everything else of the Received figure (cash, riel) and does not mutate its input', () => {
  const input = { usd: 40, khr: 8000, digital: { usd: 10, khr: 400 }, needsReview: false }
  const out = receivedWithOnlinePaid(input, { paidInWindowUsd: 25 })
  assert.deepEqual({ usd: out.usd, khr: out.khr, khr_digital: out.digital.khr, needsReview: out.needsReview }, { usd: 40, khr: 8000, khr_digital: 400, needsReview: false })
  assert.equal(input.digital.usd, 10)
})

check('the overlay applies only to unnarrowed views (a status, payment method or time-of-day filter keeps the kernel figure)', () => {
  assert.equal(overlayApplies({ startDate: '2026-11-02', endDate: '2026-11-04' }), true)
  for (const f of [{ status: 'completed' }, { paymentMethod: 'Cash' }, { startTime: '08:00', endTime: '12:00' }]) assert.equal(overlayApplies({ startDate: '2026-11-02', ...f }), false, JSON.stringify(f))
})

console.log(`${passed} passed`)
