const assert = require('node:assert/strict')
const { fixture, loadStockSession, user, zeroCreateRequest, receiptState } = require('./test-stock-session-atomic.cjs')
const { commitStockSession } = loadStockSession()
function request(id, quantity, status) {
  const body = zeroCreateRequest(id, 'Serum')
  Object.assign(body.items[0], { quantity, unit_cost_usd: 2 })
  Object.assign(body.items[0].product, { stock_quantity: quantity, barcode: 'SER-1', ...(status === undefined ? {} : { is_active: status }) })
  return body
}
async function main() {
  for (const quantity of [0, 3]) for (const status of [false, 0]) {
    const f = fixture(); const before = receiptState(f.sql)
    await assert.rejects(() => commitStockSession(f.env, user, request(`refused-${quantity}-${status}`, quantity, status)), e => e.code === 'product_status_unsupported')
    assert.deepEqual(receiptState(f.sql), before)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM products').get().n, 1)
  }
  for (const quantity of [0, 3]) {
    const f = fixture(); const body = request(`control-${quantity}`, quantity)
    f.loseNextCommitAcknowledgement()
    const receipt = await commitStockSession(f.env, user, body)
    const after = receiptState(f.sql)
    assert.equal(after.product.stock_quantity, quantity)
    const retry = await commitStockSession(f.env, user, body)
    assert.equal(retry.replayed, true)
    assert.deepEqual(receiptState(f.sql), after)
    assert.equal(retry.operationId, receipt.operationId)
  }
  for (const quantity of [0, 3]) for (const status of [false, 0]) {
    const f = fixture(); const body = request(`legacy-${quantity}-${status}`, quantity, 1)
    await commitStockSession(f.env, user, body)
    const saved = f.sql.prepare('SELECT request_json FROM stock_session_operations').get()
    const legacyCanonical = JSON.parse(saved.request_json)
    legacyCanonical.items[0].product.is_active = 0
    f.sql.prepare('UPDATE stock_session_operations SET request_json=?').run(JSON.stringify(legacyCanonical))
    body.items[0].product.is_active = status
    const after = receiptState(f.sql)
    assert.equal((await commitStockSession(f.env, user, body)).replayed, true)
    assert.deepEqual(receiptState(f.sql), after)
  }
  console.log('product no-status stock session: 10 native controls PASS')
}
main().catch(e => { console.error(e); process.exitCode = 1 })




