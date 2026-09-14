// P3-L2 (2026-09-14): a stock-in session line's own reason is the reason on
// its inventory movement.
//
// commitStockSession used to write `Stock-in session <op>` on every movement
// it produced, so the Sessions list could never show WHY a line was
// received. The line contract now takes an optional `reason` (per line, or
// as a session-wide default expanded per line like every other default);
// what the operator typed lands on inventory_movements.reason as typed, a
// line without one keeps the generated label. The canonical request JSON is
// the idempotency fingerprint, so a request that sends no reason must
// serialize exactly as it did before this field existed -- otherwise every
// in-flight retry across the deploy would 409.
//
// Driven through the real commit against SQLite via the atomic harness, not
// through an extracted SQL template: the fallback lives in the TypeScript
// param, and that is what has to be right.
//
// Run: node scripts/test-stock-session-line-reason-pure.cjs
const assert = require('node:assert/strict')
const { fixture, loadStockSession, user, receiveRequest, seedDistinctProducts } = require('./test-stock-session-atomic.cjs')

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

function reasonsByLine(f, operationId) {
  return f.sql.prepare(`SELECT m.line_id, i.reason FROM stock_session_members m
    JOIN inventory_movements i ON i.id = m.movement_id WHERE m.operation_id = ? ORDER BY m.line_id`).all(operationId)
}

async function main() {
  const api = loadStockSession()

  await check('two lines with two different reasons write two different movement reasons, as typed; a blank line keeps the session label', async () => {
    const f = fixture()
    seedDistinctProducts(f, 3)
    const request = receiveRequest('reason-lines-001')
    request.items = [
      { line_id: 'line-a', kind: 'receive', product_id: 1, quantity: 2, unit_cost_usd: 2, reason: 'Damaged in transit' },
      { line_id: 'line-b', kind: 'receive', product_id: 2, quantity: 3, unit_cost_usd: 2, reason: '  Recount after audit  ' },
      { line_id: 'line-c', kind: 'receive', product_id: 3, quantity: 1, unit_cost_usd: 2 },
    ]
    const receipt = await api.commitStockSession(f.env, user, request)
    assert.equal(receipt.replayed, false)
    assert.deepEqual(reasonsByLine(f, receipt.operationId), [
      { line_id: 'line-a', reason: 'Damaged in transit' },
      { line_id: 'line-b', reason: 'Recount after audit' },
      { line_id: 'line-c', reason: `Stock-in session ${receipt.operationId}` },
    ])
    // The exact same request replays to the same receipt and writes nothing new.
    const again = await api.commitStockSession(f.env, user, JSON.parse(JSON.stringify(request)))
    assert.equal(again.replayed, true)
    assert.equal(again.operationId, receipt.operationId)
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 3)
  })

  await check('a session-wide default reason expands onto every line, and a line-level one overrides it', async () => {
    const f = fixture()
    seedDistinctProducts(f, 2)
    const request = receiveRequest('reason-default-001')
    request.defaults.reason = 'Opening stock'
    request.items = [
      { line_id: 'line-a', kind: 'receive', product_id: 1, quantity: 2, unit_cost_usd: 2 },
      { line_id: 'line-b', kind: 'receive', product_id: 2, quantity: 1, unit_cost_usd: 2, reason: 'Sample from rep' },
    ]
    const receipt = await api.commitStockSession(f.env, user, request)
    assert.deepEqual(reasonsByLine(f, receipt.operationId), [
      { line_id: 'line-a', reason: 'Opening stock' },
      { line_id: 'line-b', reason: 'Sample from rep' },
    ])
  })

  await check('a request without a reason serializes exactly as before -- no reason key in the canonical fingerprint', async () => {
    const f = fixture()
    const receipt = await api.commitStockSession(f.env, user, receiveRequest('reason-absent-001'))
    const stored = f.sql.prepare('SELECT request_json FROM stock_session_operations WHERE id = ?').get(receipt.operationId).request_json
    assert.doesNotMatch(stored, /"reason"/, stored)
    // A blank or whitespace-only reason is the same as none.
    const blank = receiveRequest('reason-blank-001')
    blank.items[0].reason = '   '
    const blankReceipt = await api.commitStockSession(f.env, user, blank)
    const blankStored = f.sql.prepare('SELECT request_json FROM stock_session_operations WHERE id = ?').get(blankReceipt.operationId).request_json
    assert.doesNotMatch(blankStored, /"reason"/)
    assert.equal(reasonsByLine(f, blankReceipt.operationId)[0].reason, `Stock-in session ${blankReceipt.operationId}`)
  })

  await check('a reason that is not text, or is over 500 bytes, is refused before anything is written', async () => {
    for (const [reason, code] of [[42, 'invalid_request'], ['x'.repeat(501), 'request_too_large']]) {
      const f = fixture()
      const request = receiveRequest('reason-bad-001')
      request.items[0].reason = reason
      await assert.rejects(() => api.commitStockSession(f.env, user, request), (error) => error.statusCode === 400 && error.code === code && /reason/.test(error.message))
      assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n, 0)
    }
  })

  if (failed > 0) {
    console.error(`${failed} stock-session line-reason check(s) failed`)
    process.exitCode = 1
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
