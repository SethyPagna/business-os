// S4-41: "paid means it is not Not-Paid" at sale CREATION, driven through the
// REAL POST /sales route against the real migrated schema.
//
// The owner's report: "A paid sale would usually already use a completed
// status, unless there was a loophole as we can choose status when making pos
// sale make sure this part is updated."
//
// Two holes existed at creation and each gets a case here:
//
//   1. POST /sales accepted "tender covers the total" + `awaiting_payment`
//      ("Not Paid"), so a settled sale was recorded as a debt. It is now
//      NORMALISED -- silently, because the customer has already paid and a
//      4xx would strand a rung-up sale (and an offline replay built by an
//      older client must still land).
//   2. POST /sales accepted `completed` / `awaiting_delivery` with NO money.
//      The POS has always refused that client-side; the Worker did not, so
//      the debt simply vanished from the Not-Paid list. Now
//      `insufficient_payment_for_status`.
//
// WHY awaiting_delivery SURVIVES. It is not a flag beside the status, it IS a
// status, and its own help text calls it a PAID state ("Paid, not yet
// delivered"). So a covered delivery resolves to `awaiting_delivery`, not to
// `completed` -- forcing `completed` would empty the shop's delivery queue.
// The delivery/non-delivery pair below is what pins that.
//
// WHY THERE IS NO MATCHING RULE ON PATCH /:id/status: see the last case.
//
// DISCRIMINATING: every assertion here is on a combination the pre-S4-41 tree
// produced the opposite answer for -- it recorded whatever status was asked
// for and never compared it to the money. Cases 1 and 2 are each red on the
// old route; the last case is red on the first (over-broad) attempt at this
// fix, which is why it is here.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const assert = require('node:assert/strict')

// Reuse the existing real-module Hono + migrated SQLite create fixture, the
// same way test-sale-money-writers-native.cjs does, rather than standing up a
// second copy of the sale-creation harness.
const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf(';(async () => {')
assert.ok(boundary > 0, 'create-atomic harness should expose a prelude')
const harness = new Module(file, module)
harness.filename = file
harness.paths = module.paths
harness._compile(
  source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },")
    + '\nmodule.exports={fixture,request,postSale,app,executionCtx,USER,setUser(value){currentUser=value},load};',
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

// The harness db takes named params; these reads use literals so the test
// never depends on that binding convention.
const saleRow = (f) => f.raw.prepare(
  'SELECT sale_status,amount_paid_usd,amount_paid_khr,total_usd,is_delivery FROM sales WHERE id=1',
).get()

const branchStock = (f) => f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity

// The create harness's default user carries only `pos`. PATCH /:id/status is
// gated on the `sales`/`status` action tier, so the status cases run as an
// administrator -- keeping the SAME id so the sale's recorded owner and
// cashier still match and nothing is refused for the wrong reason.
const STATUS_USER = { ...h.USER, username: 'admin', role_code: 'admin', permissions: { all: true } }

// A request whose tender exactly covers the $9.50 line.
function paidRequest(clientRequestId, overrides = {}) {
  return { ...h.request(clientRequestId), ...overrides }
}

// A request with no money at all.
function unpaidRequest(clientRequestId, overrides = {}) {
  const body = h.request(clientRequestId)
  delete body.payment_method
  return { ...body, amount_paid_usd: 0, payment_currency: 'USD', ...overrides }
}

async function patchStatus(db, id, body) {
  const response = await h.app.request(`/${id}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, { DB: db }, h.executionCtx)
  let parsed
  const text = await response.text()
  try { parsed = JSON.parse(text) } catch { parsed = { error: text } }
  return { status: response.status, body: parsed }
}

;(async () => {
  await runTest('a fully-paid sale recorded as Not Paid becomes Completed', async () => {
    const f = h.fixture()
    const stockBefore = branchStock(f)
    const created = await h.postSale(f.route, paidRequest('paid-notpaid-1', { sale_status: 'awaiting_payment' }))
    assert.equal(created.status, 200, JSON.stringify(created.body))
    const row = saleRow(f)
    // The old route wrote 'awaiting_payment' here -- this is the whole defect.
    assert.equal(row.sale_status, 'completed')
    assert.equal(Number(row.amount_paid_usd), 9.5)
    // The stock plan is computed from the REQUESTED status and must be the
    // same either way: both statuses deduct, so the resolver cannot move
    // units. This pins the claim the route's comment makes.
    assert.equal(branchStock(f), stockBefore - 1)
  })

  await runTest('a fully-paid DELIVERY recorded as Not Paid becomes Awaiting Delivery, not Completed', async () => {
    const f = h.fixture()
    const created = await h.postSale(f.route, paidRequest('paid-notpaid-delivery', {
      sale_status: 'awaiting_payment',
      is_delivery: 1,
      delivery_fee_usd: 0,
      delivery_fee_paid_by: 'customer',
    }))
    assert.equal(created.status, 200, JSON.stringify(created.body))
    const row = saleRow(f)
    assert.equal(row.sale_status, 'awaiting_delivery', 'the delivery queue must survive the paid rule')
    assert.equal(Number(row.is_delivery), 1)
  })

  await runTest('a genuinely unpaid credit sale stays Not Paid', async () => {
    const f = h.fixture()
    const created = await h.postSale(f.route, unpaidRequest('unpaid-credit-1', { sale_status: 'awaiting_payment' }))
    assert.equal(created.status, 200, JSON.stringify(created.body))
    const row = saleRow(f)
    assert.equal(row.sale_status, 'awaiting_payment', 'the credit sale the shop actually wants must not be rewritten')
    assert.equal(Number(row.amount_paid_usd), 0)
  })

  await runTest('a partly-paid sale stays Not Paid -- partial payment is not payment', async () => {
    const f = h.fixture()
    const created = await h.postSale(f.route, unpaidRequest('partial-credit-1', {
      sale_status: 'awaiting_payment', payment_method: 'Cash', amount_paid_usd: 4,
    }))
    assert.equal(created.status, 200, JSON.stringify(created.body))
    assert.equal(saleRow(f).sale_status, 'awaiting_payment')
  })

  await runTest('Completed is refused server-side when the money does not cover it', async () => {
    const f = h.fixture()
    const stockBefore = branchStock(f)
    const created = await h.postSale(f.route, unpaidRequest('unpaid-completed-1', { sale_status: 'completed' }))
    // The old route accepted this and the debt disappeared from Not Paid.
    assert.equal(created.status, 400, JSON.stringify(created.body))
    assert.equal(created.body.code, 'insufficient_payment_for_status')
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM sales').get().n, 0, 'nothing may be written')
    assert.equal(branchStock(f), stockBefore, 'no stock may move for a refused sale')
  })

  await runTest('Awaiting Delivery is refused server-side when the money does not cover it', async () => {
    const f = h.fixture()
    const created = await h.postSale(f.route, unpaidRequest('unpaid-delivery-1', {
      sale_status: 'awaiting_delivery', is_delivery: 1, delivery_fee_usd: 0, delivery_fee_paid_by: 'customer',
    }))
    assert.equal(created.status, 400, JSON.stringify(created.body))
    assert.equal(created.body.code, 'insufficient_payment_for_status')
    assert.equal(f.raw.prepare('SELECT COUNT(*) n FROM sales').get().n, 0)
  })

  await runTest('a partly-paid Completed is refused too -- the boundary is coverage, not "some money"', async () => {
    const f = h.fixture()
    const created = await h.postSale(f.route, unpaidRequest('partial-completed-1', {
      sale_status: 'completed', payment_method: 'Cash', amount_paid_usd: 9.49,
    }))
    assert.equal(created.status, 400, JSON.stringify(created.body))
    assert.equal(created.body.code, 'insufficient_payment_for_status')
  })

  await runTest('an exactly-covering Completed is accepted (the everyday counter sale)', async () => {
    const f = h.fixture()
    const created = await h.postSale(f.route, paidRequest('paid-completed-1', { sale_status: 'completed' }))
    assert.equal(created.status, 200, JSON.stringify(created.body))
    assert.equal(saleRow(f).sale_status, 'completed')
  })

  // THE DELIBERATE NON-RULE. The obvious companion -- 'a paid sale cannot be
  // re-labelled Not Paid' -- was implemented and then removed, because on
  // PATCH /:id/status that transition IS the shop's payment-correction
  // reopen: it is the only thing that turns on `payment_correction_allowed`,
  // it writes the audit action `sale_payment_correction_opened`, and the
  // settlement editor's correction mode is reachable only through it.
  // Refusing it left a mis-keyed tender uncorrectable, and broke
  // test-d1-pattern-limit-native.cjs's reopen case. This pins that the
  // creation-time rule did NOT leak onto the status route.
  await runTest('a paid sale may still be reopened to Not Paid -- that is the payment-correction window', async () => {
    const f = h.fixture()
    const created = await h.postSale(f.route, paidRequest('reopen-paid-1', { sale_status: 'completed' }))
    assert.equal(created.status, 200, JSON.stringify(created.body))
    assert.equal(saleRow(f).sale_status, 'completed')
    const updatedAt = f.raw.prepare('SELECT updated_at FROM sales WHERE id=1').get().updated_at
    h.setUser(STATUS_USER)
    const reopened = await patchStatus(f.route, 1, {
      sale_status: 'awaiting_payment',
      client_request_id: 'reopen-paid-patch-1',
      expected_updated_at: updatedAt,
    })
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body))
    assert.equal(saleRow(f).sale_status, 'awaiting_payment')
    assert.equal(
      f.raw.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='sale_payment_correction_opened'").get().n, 1,
      'the reopen must still record the correction-window audit row the read query keys off',
    )
    h.setUser(h.USER)
  })
  if (failed > 0) {
    console.error(`${failed} test(s) failed`)
    process.exit(1)
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
