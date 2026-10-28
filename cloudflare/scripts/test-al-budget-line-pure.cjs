'use strict'
const assert = require('node:assert/strict')

// These imports load actual helpers; neither starts its native Worker on require.
const helpers = [
  ['legacy', require('./test-al-money-c-native.cjs')],
  ['shared', require('./harness/al_money_native.cjs')],
]
let checks = 0
function capture(helper, entries) {
  const original = console.log, lines = []
  console.log = (...args) => { lines.push(args.join(' ')) }
  try { return { worst: helper.budgetLine(entries), lines } }
  finally { console.log = original }
}
const metric = (label, calls, statements, extra = {}) => ({ label, status: 200, calls, statements, serverTimingStatements: statements, ...extra })

for (const [name, helper] of helpers) {
  assert.equal(helper.FREE_QUERY_LIMIT, 50)
  assert.equal(helper.PAID_QUERY_LIMIT, 1000)

  const callPeak = metric('call-peak', 51, 51, { serverTimingStatements: 7 })
  const batchPeak = metric('batch-peak', 2, 200)
  const mixed = capture(helper, [callPeak, batchPeak])
  assert.equal(mixed.worst, callPeak, name + ': statement-max selector would miss the actual51-call overage')
  assert.equal(mixed.worst.calls <= helper.FREE_QUERY_LIMIT, false)
  assert.ok(mixed.lines.some(line => line.includes('call-peak: status 200, 51 calls, 51 statements (Server-Timing q=7); Free EXCEEDS 50, Paid fits 1000')))
  assert.ok(mixed.lines.some(line => line.includes('batch-peak: status 200, 2 calls, 200 statements (Server-Timing q=200); Free fits 50, Paid fits 1000')))
  checks++

  const below = metric('below-free', 49, 49), largeBatch = metric('large-batch', 1, 100)
  const allowed = capture(helper, [below, largeBatch])
  assert.equal(allowed.worst, below)
  assert.equal(allowed.worst.calls <= helper.FREE_QUERY_LIMIT, true)
  assert.ok(allowed.lines.find(line => line.includes('large-batch:')).includes('Free fits 50'))
  checks++

  const boundaries = capture(helper, [
    metric('free-boundary', 50, 5000, { serverTimingStatements: 17 }),
    metric('over-free', 51, 1),
    metric('paid-boundary', 1000, 2000),
    metric('over-paid', 1001, 2),
  ])
  assert.equal(boundaries.worst.label, 'over-paid')
  assert.ok(boundaries.lines.find(line => line.includes('free-boundary:')).includes('50 calls, 5000 statements (Server-Timing q=17); Free fits 50, Paid fits 1000'))
  assert.ok(boundaries.lines.find(line => line.includes('over-free:')).includes('Free EXCEEDS 50, Paid fits 1000'))
  assert.ok(boundaries.lines.find(line => line.includes('paid-boundary:')).includes('1000 calls, 2000 statements (Server-Timing q=2000); Free EXCEEDS 50, Paid fits 1000'))
  assert.ok(boundaries.lines.find(line => line.includes('over-paid:')).includes('Free EXCEEDS 50, Paid EXCEEDS 1000'))
  checks++

  const first = metric('first-tie', 50, 1), second = metric('second-tie', 50, 500)
  const setup = metric('setup', 2000, 3000, { setup: true })
  const observation = metric('observation', 3000, 4000, { observe: true })
  const filtered = capture(helper, [setup, observation, first, second])
  assert.equal(filtered.worst, first, name + ': filter cohorts and preserve first-entry tie/identity')
  assert.equal(filtered.lines.length, 4, 'excluded setup/observation diagnostics remain visible')
  assert.ok(filtered.lines.some(line => line.startsWith('D1 (setup) setup:')))
  assert.ok(filtered.lines.some(line => line.startsWith('D1 (observation) observation:')))
  checks++

  assert.deepEqual(capture(helper, []).worst, { calls: 0, statements: 0 })
  assert.deepEqual(capture(helper, [setup, observation]).worst, { calls: 0, statements: 0 })
  const firstZero = metric('first-zero', 0, 2)
  assert.equal(capture(helper, [firstZero, metric('second-zero', 0, 500)]).worst, firstZero,
    'an eligible zero-call entry retains original first identity rather than the empty sentinel')
  checks++

  for (const calls of [undefined, NaN, Infinity, -1, 0.5, '1', null]) {
    assert.throws(() => capture(helper, [metric('invalid', calls, 1)]), /physical call count/, name + ': invalid calls must not pass as zero')
    assert.throws(() => capture(helper, [metric('invalid-setup', calls, 1, { setup: true })]), /physical call count/)
  }
  checks++

  const immutable = Object.freeze([Object.freeze(metric('zero', 0, 2)), Object.freeze(metric('positive', 1, 10))])
  const snapshot = structuredClone(immutable)
  assert.equal(capture(helper, immutable).worst, immutable[1])
  assert.deepEqual(immutable, snapshot, name + ': reporting must not mutate measurements')
  checks++
  console.log('PASS ' + name + ' actual AL budgetLine physical-selection/fit-label/diagnostic contract')
}
console.log('PASS ' + checks + ' AL budgetLine pure groups; no Worker started')
