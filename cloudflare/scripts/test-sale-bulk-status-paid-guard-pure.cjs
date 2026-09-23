// S4-41 on POST /api/sales/bulk-status, driven through the REAL Hono route
// against the real migrated schema.
//
// The owner's rule: a paid sale carries the completed status, and the
// standing reading of it is that the paid statuses (completed and
// awaiting_delivery) mean the sale IS paid. The group "Status" action used to
// check only whether the transition was legal, so selecting Not Paid sales
// and choosing Completed turned every one of them into a paid sale -- and the
// money they still owed vanished from every Not Paid list at once.
//
// The rule on this route: a member that would move FROM awaiting_payment TO
// completed or awaiting_delivery is refused unless the payment already
// recorded on the sale covers its total. The group stays atomic, the same way
// every other per-sale refusal on this route works: one uncovered sale
// refuses the whole request, nothing is written, and the answer names the
// sales (code `insufficient_payment_for_status`, the code POST /sales uses,
// plus `sale_ids`).
//
// DISCRIMINATING: the refusal cases are each answered 200 by the pre-fix
// route (it wrote the paid status with the debt still on the sale). The
// control cases pass on both, and are here so an over-broad fix -- refusing
// every Not Paid -> Completed move, or refusing members the source filter
// leaves alone -- goes red too.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const assert = require('node:assert/strict')

// Reuse the bulk-status harness (its real-module loader and migrated SQLite
// fixture, everything above its run()), the same way
// test-sale-paid-status-resolution-pure.cjs reuses the create harness,
// rather than standing up a second copy of it.
const file = path.join(__dirname, 'test-sale-bulk-status-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf('async function run() {')
assert.ok(boundary > 0, 'bulk-status harness should expose a prelude')
const harness = new Module(file, module)
harness.filename = file
harness.paths = module.paths
harness._compile(
  `${source.slice(0, boundary)}\nmodule.exports={fixture,seed,request,snapshot,replay,sales,helper,user};`,
  file,
)
const h = harness.exports

let failed = 0
async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// seed() writes Not Paid sales 1..7 and completed sales 8..9 with the
// schema's money defaults ($0 total, $0 paid, rate 4100). These set the money
// a case is about.
function setMoney(f, id, { total, paidUsd = 0, paidKhr = 0, rate = 4100 }) {
  f.sql.prepare('UPDATE sales SET total_usd=?,amount_paid_usd=?,amount_paid_khr=?,exchange_rate=? WHERE id=?')
    .run(total, paidUsd, paidKhr, rate, id)
}
const statuses = (f) => f.sql.prepare('SELECT id,sale_status FROM sales ORDER BY id').all()
  .map((row) => `${row.id}:${row.sale_status}`)

;(async () => {
  await runTest('a group Completed containing an unpaid Not Paid sale is refused whole', async () => {
    const f = h.fixture(); h.seed(f, 3)
    setMoney(f, 1, { total: 10 })                  // owes all of it
    setMoney(f, 2, { total: 10, paidUsd: 10 })     // paid in dollars
    setMoney(f, 3, { total: 10, paidKhr: 41000 })  // paid to the riel at 4100
    const before = h.snapshot(f)
    const refused = await f.call(h.sales, '/bulk-status', h.request(f, 'completed', 'bulk-unpaid-completed'))
    // The pre-fix route answered 200 and wrote 'completed' on all three.
    assert.equal(refused.status, 400, JSON.stringify(refused))
    assert.equal(refused.body.code, 'insufficient_payment_for_status')
    assert.deepEqual(refused.body.sale_ids, [1], 'only the sale that owes money is named')
    assert.match(refused.body.error, /R1\b/, 'the message names the receipt the shop has to settle')
    assert.equal(h.snapshot(f), before, 'atomic: the two paid sales must not move either, and no history is written')
    assert.equal(f.metrics().batches, 0, 'refused before any write was attempted')
  })

  await runTest('a group Awaiting Delivery is refused for the same unpaid sale', async () => {
    const f = h.fixture(); h.seed(f, 2)
    setMoney(f, 1, { total: 10 })
    setMoney(f, 2, { total: 10, paidUsd: 10 })
    const before = h.snapshot(f)
    const refused = await f.call(h.sales, '/bulk-status', h.request(f, 'awaiting_delivery', 'bulk-unpaid-delivery'))
    assert.equal(refused.status, 400, JSON.stringify(refused))
    assert.equal(refused.body.code, 'insufficient_payment_for_status')
    assert.deepEqual(refused.body.sale_ids, [1])
    assert.equal(h.snapshot(f), before)
  })

  await runTest('every uncovered sale is named, including one short by a single riel', async () => {
    const f = h.fixture(); h.seed(f, 3)
    setMoney(f, 1, { total: 10, paidUsd: 4 })       // partly paid is not paid
    setMoney(f, 2, { total: 10, paidKhr: 40999 })   // one riel short at 4100
    setMoney(f, 3, { total: 10, paidUsd: 5, paidKhr: 20500 }) // mixed, exactly covered
    const before = h.snapshot(f)
    const refused = await f.call(h.sales, '/bulk-status', h.request(f, 'completed', 'bulk-short-by-a-riel'))
    assert.equal(refused.status, 400, JSON.stringify(refused))
    assert.equal(refused.body.code, 'insufficient_payment_for_status')
    assert.deepEqual(refused.body.sale_ids, [1, 2])
    assert.equal(h.snapshot(f), before)
  })

  // CONTROL: covered Not Paid sales (for example ones reopened for a payment
  // correction) still move as a group.
  await runTest('a group of Not Paid sales whose payment covers them still completes', async () => {
    const f = h.fixture(); h.seed(f, 2)
    setMoney(f, 1, { total: 10, paidUsd: 10 })
    setMoney(f, 2, { total: 10, paidKhr: 41000 })
    const applied = await f.call(h.sales, '/bulk-status', h.request(f, 'completed', 'bulk-covered-completed'))
    assert.equal(applied.status, 200, JSON.stringify(applied))
    assert.equal(applied.body.changedCount, 2)
    assert.deepEqual(statuses(f), ['1:completed', '2:completed'])
  })

  // CONTROL: only the paid statuses are gated. Cancelling a Not Paid sale
  // that owes money asserts no payment and must stay possible.
  await runTest('an unpaid Not Paid sale can still be cancelled in a group', async () => {
    const f = h.fixture(); h.seed(f, 1)
    setMoney(f, 1, { total: 10 })
    const applied = await f.call(h.sales, '/bulk-status', h.request(f, 'cancelled', 'bulk-unpaid-cancelled'))
    assert.equal(applied.status, 200, JSON.stringify(applied))
    assert.deepEqual(statuses(f), ['1:cancelled'])
  })

  // CONTROL: the guard applies to the members that actually change. With a
  // source filter of Completed, the unpaid Not Paid members are left alone
  // (reason `source_mismatch`) and must not refuse the group.
  await runTest('the source filter leaves unpaid Not Paid members alone instead of refusing the group', async () => {
    const f = h.fixture(); h.seed(f, 9)
    for (let id = 1; id <= 7; id++) setMoney(f, id, { total: 10 })
    const req = h.request(f, 'awaiting_delivery', 'bulk-source-completed')
    req.source_status = 'completed'
    const applied = await f.call(h.sales, '/bulk-status', req)
    assert.equal(applied.status, 200, JSON.stringify(applied))
    assert.deepEqual([applied.body.changedCount, applied.body.unchangedCount], [2, 7])
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sales WHERE id<=7 AND sale_status='awaiting_payment'").get().n, 7)
  })

  if (failed > 0) {
    console.error(`${failed} test(s) failed`)
    process.exit(1)
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
