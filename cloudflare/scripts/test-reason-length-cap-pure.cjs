// P3-L2 (2026-09-14): ONE reason-length cap, one measure, one error code, on
// all four wires that write or edit a stock-movement reason.
//
// The first version of this cap was 500 on all four -- but not the same 500.
// The stock-session parser spent a UTF-8 BYTE budget (lib/stockSession.ts's
// text()), while POST /api/inventory/adjust, POST /api/batches and PATCH
// /movements/:id/reason counted code units. Khmer costs three bytes a
// character, so a 167-character Khmer reason -- comfortably inside the input
// box's own maxLength -- was accepted by three wires and refused by the
// session wire with `request_too_large`. And the undo path prepends 'Undo: '
// to the reason it is reversing, so a reason written at exactly the cap could
// not be undone: its own inverse was six characters too long.
//
// Both are fixed by lib/stockReason.ts: STOCK_REASON_MAX_LENGTH = 512 code
// units, one predicate, `reason_too_long` everywhere. This file therefore
// asserts BEHAVIOUR, not the literal number -- it sends real requests through
// the real wires and reads what comes back. Moving the constant is allowed;
// letting the four wires disagree again, or measuring bytes again, is not.
//
// Run: node scripts/test-reason-length-cap-pure.cjs
const assert = require('node:assert/strict')
const { fixture, loadStockSession, user, receiveRequest } = require('./test-stock-session-atomic.cjs')

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error instanceof Error ? error.stack || error.message : error) }
}

const { STOCK_REASON_MAX_LENGTH } = loadStockSession('lib/stockReason.ts')

// 167 Khmer characters = 501 UTF-8 bytes: the exact shape the byte budget
// refused and the three character-counting wires accepted.
const KHMER = 'ខូចនៅពេលដឹកជញ្ជូន'.repeat(20).slice(0, 167)
const AT_CAP = 'x'.repeat(STOCK_REASON_MAX_LENGTH)
const OVER_CAP = 'x'.repeat(STOCK_REASON_MAX_LENGTH + 1)
// What Inventory.tsx actually sends when the operator undoes an adjustment
// whose reason filled StockReasonField's 500-character box.
const UNDO_OF_A_FULL_REASON = `Undo: ${'x'.repeat(500)}`

// Every wire answers the same way, so every wire is read the same way.
async function refusedForLength(response) {
  if (response.status !== 400) return false
  const body = await response.json().catch(() => ({}))
  return body.code === 'reason_too_long'
}

function httpDriver(entry, f) {
  const app = loadStockSession(entry).default
  // Everything on these routes that is not the reason guard is stubbed by
  // this harness, so a request that PASSES the guard dies further down on a
  // stubbed import. That is exactly the signal wanted -- "not refused for
  // length" -- so it is turned into a status here rather than being printed
  // as a stack trace by Hono's default error handler.
  app.onError(() => new Response('reached past the reason guard', { status: 599 }))
  return (path, method, body) => app.request(`http://local${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, f.env, { waitUntil(promise) { promise?.catch?.(() => {}) } })
}

async function main() {
  await check('the Khmer reason under test is the one the byte budget refused (167 characters, 501 bytes)', () => {
    assert.equal(KHMER.length, 167)
    assert.equal(Buffer.byteLength(KHMER, 'utf8'), 501)
    assert.ok(Buffer.byteLength(KHMER, 'utf8') > 500, 'a byte-measured 500 cap must refuse this string')
    assert.ok(KHMER.length <= STOCK_REASON_MAX_LENGTH, 'a code-unit cap must accept it')
    assert.ok(UNDO_OF_A_FULL_REASON.length <= STOCK_REASON_MAX_LENGTH,
      'the cap must leave room for the six characters undo/redo prepends to a full 500-character reason')
  })

  // ---- Wire 1: POST /api/inventory/sessions (the stock-session parser) ----
  // Driven all the way through the real commit against SQLite, so acceptance
  // is proven by the reason landing on the movement row, not by a status code.
  const session = loadStockSession()
  const commitWithReason = async (requestId, reason) => {
    const f = fixture()
    const request = receiveRequest(requestId)
    request.items[0].reason = reason
    const receipt = await session.commitStockSession(f.env, user, request)
    return f.sql.prepare(`SELECT i.reason FROM stock_session_members m
      JOIN inventory_movements i ON i.id = m.movement_id WHERE m.operation_id = ?`).get(receipt.operationId).reason
  }

  await check('session wire: a 167-character Khmer reason (501 bytes) is written as typed', async () => {
    assert.equal(await commitWithReason('cap-khmer-001', KHMER), KHMER)
  })

  await check('session wire: a reason at the cap is accepted, one character over is refused as reason_too_long', async () => {
    assert.equal(await commitWithReason('cap-at-001', AT_CAP), AT_CAP)
    const f = fixture()
    const request = receiveRequest('cap-over-001')
    request.items[0].reason = OVER_CAP
    await assert.rejects(
      () => session.commitStockSession(f.env, user, request),
      (error) => error.statusCode === 400 && error.code === 'reason_too_long' && /reason/i.test(error.message),
      'the session wire must not answer request_too_large for an over-long reason',
    )
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 0, 'nothing is written when the reason is refused')
  })

  // ---- Wires 2 and 3: POST /adjust and PATCH /movements/:id/reason ----
  // The atomic harness stubs routes/inventory.ts's non-reason imports, so
  // these requests are driven as far as the reason guard and no further: an
  // over-long reason is refused there, and an accepted one is proven accepted
  // by NOT being refused there. The over-cap case is what proves the guard is
  // actually reached, so the accepted cases are not vacuous.
  const f = fixture()
  const inventory = httpDriver('routes/inventory.ts', f)
  const adjust = (reason) => inventory('/adjust', 'POST', { productId: 1, branchId: 1, type: 'remove', quantity: 1, reason })
  const editReason = (reason) => inventory('/movements/1/reason', 'PATCH', { reason })

  await check('POST /adjust: Khmer 501 bytes, a reason at the cap and the undo of a full 500-character reason all pass the length guard', async () => {
    for (const [label, reason] of [['Khmer', KHMER], ['at cap', AT_CAP], ['undo prefix', UNDO_OF_A_FULL_REASON]]) {
      assert.equal(await refusedForLength(await adjust(reason)), false, `${label} must not be refused as too long`)
    }
  })

  await check('POST /adjust: one character over the cap is refused as reason_too_long', async () => {
    assert.equal(await refusedForLength(await adjust(OVER_CAP)), true)
  })

  await check('PATCH /movements/:id/reason: the editor accepts everything the writers can store, and refuses one over the cap with a code', async () => {
    for (const [label, reason] of [['Khmer', KHMER], ['at cap', AT_CAP], ['undo prefix', UNDO_OF_A_FULL_REASON]]) {
      assert.equal(await refusedForLength(await editReason(reason)), false, `${label} must not be refused as too long`)
    }
    const refusal = await editReason(OVER_CAP)
    assert.equal(refusal.status, 400)
    // Before this lane the editor answered a bare message with no code, so a
    // client could not tell a too-long reason from any other 400.
    assert.equal((await refusal.json()).code, 'reason_too_long')
  })

  // ---- Wire 4: POST /api/batches ----
  await check('POST /api/batches: Khmer 501 bytes and a reason at the cap pass the length guard, one over is refused', async () => {
    const batchesFixture = fixture()
    const batches = httpDriver('routes/batches.ts', batchesFixture)
    const receive = (reason) => batches('/', 'POST', {
      product_id: 1, branch_id: 1, quantity: 1, unit_cost_usd: 2, supplier_name: 'Fixture Supplier', reason,
    })
    for (const [label, reason] of [['Khmer', KHMER], ['at cap', AT_CAP]]) {
      assert.equal(await refusedForLength(await receive(reason)), false, `${label} must not be refused as too long`)
    }
    assert.equal(await refusedForLength(await receive(OVER_CAP)), true)
  })

  if (failed > 0) {
    console.error(`${failed} reason-length cap check(s) failed`)
    process.exitCode = 1
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
