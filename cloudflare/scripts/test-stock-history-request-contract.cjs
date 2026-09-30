const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
const { fixture, loadStockSession, user, receiveRequest } = require('./test-stock-session-atomic.cjs')

const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/utils/actionHistory.ts'), 'utf8')
const helper = source.match(/export function buildServerReplayRequest[\s\S]*?\r?\n}\r?\n/)?.[0]
assert.ok(helper)
const buildRequest = new Function(stripTypeScriptTypes(helper.replace('export ', '')) + ';return buildServerReplayRequest')()
const tables = ['products', 'branch_stock', 'product_batches', 'branch_batch_stock', 'inventory_movements', 'stock_session_operations', 'stock_session_members', 'stock_session_revisions', 'action_history', 'undo_snapshots', 'audit_logs']
const state = f => tables.map(t => [t, f.sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])

async function main() {
  const f = fixture()
  try {
    const api = loadStockSession()
    const route = loadStockSession('routes/actionHistory.ts').default
    f.sql.exec("INSERT INTO suppliers(id,name) VALUES(1,'Fixture supplier'); INSERT INTO products(id,name,barcode,stock_quantity,is_active) VALUES(2,'Second product','SECOND',0,1); INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,0)")
    const request = receiveRequest('history-route-contract', 5)
    Object.assign(request.items[0], { supplier_id: 1, supplier_name: 'Fixture supplier', unit_cost_usd: 2, payment_status: 'credit', credit_due_date: '2026-10-15' })
    request.items.push({ ...request.items[0], line_id: 'second', product_id: 2, quantity: 3 })
    const receipt = await api.commitStockSession(f.env, user, request)
    const read = () => f.sql.prepare('SELECT * FROM action_history WHERE id=?').get(receipt.actionHistoryId)
    const call = async (direction, body, target = route) => {
      const response = await target.request(`/${receipt.actionHistoryId}/${direction}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, f.env, { waitUntil: p => p.catch(() => {}), passThroughOnException: () => {} })
      return { status: response.status, body: await response.json() }
    }
    const original = state(f)
    const missing = await call('undo', { require_applied: true })
    assert.equal(missing.status, 400)
    assert.deepEqual(state(f), original, 'missing generation cannot write')
    const undo = buildRequest(JSON.parse(read().undo_payload))
    const deniedRoute = loadStockSession('routes/actionHistory.ts', { ...user, role_code: 'cashier', role: 'cashier', permissions: JSON.stringify({ inventory: false, products: false }) }).default
    const denied = await call('undo', undo, deniedRoute)
    assert.ok([403, 404].includes(denied.status))
    assert.deepEqual(state(f), original, 'permission denial cannot write')
    const undone = await call('undo', undo)
    assert.equal(undone.status, 200, JSON.stringify(undone.body))
    assert.equal(undone.body.applied, true)
    assert.equal(read().status, 'redoable')
    assert.deepEqual(f.sql.prepare('SELECT stock_quantity FROM products ORDER BY id').all(), [{ stock_quantity: 0 }, { stock_quantity: 0 }])
    assert.equal(f.sql.prepare('SELECT SUM(received_cost_usd) total FROM product_batches').get().total, 0)
    const afterUndo = state(f)
    assert.equal((await call('undo', undo)).status, 200)
    assert.deepEqual(state(f), afterUndo, 'same undo response retry changes nothing')
    const redo = buildRequest(JSON.parse(read().redo_payload))
    assert.deepEqual(redo, { require_applied: true, expected_generation: 1 })
    const redone = await call('redo', redo)
    assert.equal(redone.status, 200, JSON.stringify(redone.body))
    assert.equal(redone.body.applied, true)
    assert.equal(read().status, 'undoable')
    assert.deepEqual(f.sql.prepare('SELECT stock_quantity FROM products ORDER BY id').all(), [{ stock_quantity: 5 }, { stock_quantity: 3 }])
    assert.equal(f.sql.prepare('SELECT SUM(received_cost_usd) total FROM product_batches').get().total, 16)
    const afterRedo = state(f)
    assert.equal((await call('redo', redo)).status, 200)
    assert.deepEqual(state(f), afterRedo, 'same redo response retry changes nothing')
    assert.equal((await call('undo', undo)).status, 409)
    assert.deepEqual(state(f), afterRedo, 'stale selection cannot reverse a later generation')
    console.log('PASS real frontend request and History route reverse both stock lines and supplier purchase totals; retries, missing/stale generation and permissions remain safe')
  } finally { f.sql.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
